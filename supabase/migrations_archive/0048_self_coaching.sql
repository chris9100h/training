-- ─── SELF-COACHING ────────────────────────────────────────────────────────────
-- Lets any user "be their own coach": a zane_coaching row where
-- coach_id = client_id. This reuses the entire coaching dashboard (stats,
-- nutrition, check-ins, notes) for tracking one's own training — no second
-- person involved. The row is created on demand and kept even when the user
-- toggles the feature off, so check-ins/notes/macros survive.

-- Setting that drives the "Myself" view and the coaching-tab toggle coupling.
alter table public.zane_user_settings
  add column if not exists be_your_own_coach boolean not null default false;

-- Create (or re-activate) the caller's self-coaching row. Idempotent.
create or replace function enable_self_coaching()
returns text   -- returns the self-coaching id
language plpgsql
security definer
as $$
declare
  v_id       text;
  v_existing text;
begin
  select id into v_existing from zane_coaching
    where coach_id = auth.uid() and client_id = auth.uid();
  if found then
    update zane_coaching set status = 'active'
      where id = v_existing and status <> 'active';
    return v_existing;
  end if;
  v_id := 'self_' || gen_random_uuid()::text;
  insert into zane_coaching (id, coach_id, client_id, status)
    values (v_id, auth.uid(), auth.uid(), 'active');
  return v_id;
end
$$;

-- ─── KEEP SELF-COACHING OUT OF THE REAL COACH/CLIENT FLOWS ────────────────────

-- get_coach_info: a self row must never appear as "your coach".
create or replace function get_coach_info()
returns table (coaching_id text, coach_id uuid, coach_email text, coach_name text, status text)
language sql
security definer
stable
as $$
  select c.id, c.coach_id, u.email, coalesce(p.name, u.email), c.status
  from zane_coaching c
  join auth.users u on u.id = c.coach_id
  left join zane_profiles p on p.id = c.coach_id
  where c.client_id = auth.uid()
    and c.coach_id <> c.client_id
$$;

-- get_coaching_clients: a self row must never appear in the client list.
create or replace function get_coaching_clients()
returns table (coaching_id text, client_id uuid, client_email text, client_name text, status text)
language sql
security definer
stable
as $$
  select c.id, c.client_id, u.email, coalesce(p.name, u.email), c.status
  from zane_coaching c
  join auth.users u on u.id = c.client_id
  left join zane_profiles p on p.id = c.client_id
  where c.coach_id = auth.uid()
    and c.coach_id <> c.client_id
$$;

-- get_coach_clients_status: exclude the self row from live client status.
create or replace function public.get_coach_clients_status()
returns table(client_id uuid, in_progress_session_id text)
language sql
security definer
set search_path = public
as $$
  select us.user_id as client_id, us.in_progress_session_id
  from zane_user_settings us
  inner join zane_coaching zc on zc.client_id = us.user_id
  where zc.coach_id = auth.uid()
    and zc.coach_id <> zc.client_id
    and zc.status = 'active'
    and us.in_progress_session_id is not null;
$$;

-- get_coach_checkin_status: exclude the self row from the coach-side
-- check-in aggregation (self check-ins are handled in the "Myself" view).
create or replace function public.get_coach_checkin_status()
returns table(coaching_id text, has_checkin boolean)
language plpgsql security definer
set search_path = public
as $$
declare
  v_week_start date;
begin
  v_week_start := current_date
    - (extract(dow from current_date)::int) * interval '1 day'
    - interval '6 days';

  return query
  select
    c.id as coaching_id,
    exists (
      select 1 from zane_checkins ci
      where ci.coaching_id = c.id
        and ci.week_start = v_week_start
    ) as has_checkin
  from zane_coaching c
  where c.coach_id = auth.uid()
    and c.coach_id <> c.client_id
    and c.status = 'active';
end;
$$;

-- respond_to_coaching_invite: accepting a real coach must not delete the
-- caller's self-coaching row (which is also an active row with client_id =
-- auth.uid()). Guard the "end previous active coaching" delete with
-- coach_id <> client_id.
create or replace function respond_to_coaching_invite(p_coaching_id text, p_accept boolean)
returns void
language plpgsql
security definer
as $$
begin
  if p_accept then
    -- If client already has an active (real) coach, end that relationship first
    delete from zane_coaching
      where client_id = auth.uid()
        and status = 'active'
        and coach_id <> client_id
        and id <> p_coaching_id;
    update zane_coaching
      set status = 'active'
      where id = p_coaching_id and client_id = auth.uid() and status = 'pending';
    -- Reject all other pending invites for this client
    delete from zane_coaching
      where client_id = auth.uid()
        and status = 'pending'
        and id <> p_coaching_id;
  else
    delete from zane_coaching
      where id = p_coaching_id and client_id = auth.uid();
  end if;
end
$$;
