-- ─── COACHING TABLES ──────────────────────────────────────────────────────────

create table zane_coaching (
  id          text primary key,
  coach_id    uuid not null references auth.users(id) on delete cascade,
  client_id   uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'active')),
  created_at  timestamptz not null default now(),
  unique (coach_id, client_id)
);

create table zane_coaching_notes (
  id          text primary key,
  coaching_id text not null references zane_coaching(id) on delete cascade,
  author_id   uuid not null references auth.users(id) on delete cascade,
  type        text not null check (type in ('session', 'plan', 'general', 'change')),
  entity_id   text,           -- session_id or schedule_id, nullable
  entity_name text,           -- human-readable context (exercise name, plan name, …)
  body        text not null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index on zane_coaching (client_id);
create index on zane_coaching_notes (coaching_id, created_at desc);
create index on zane_coaching_notes (coaching_id, read_at) where read_at is null;

-- ─── RLS ──────────────────────────────────────────────────────────────────────

alter table zane_coaching       enable row level security;
alter table zane_coaching_notes enable row level security;

-- zane_coaching: visible to both parties
create policy "coaching visible to participants"
  on zane_coaching for select
  using (coach_id = auth.uid() or client_id = auth.uid());

-- coach can create an invite
create policy "coach can invite"
  on zane_coaching for insert
  with check (coach_id = auth.uid());

-- client can accept/reject (update status); coach can do nothing via update
create policy "client can respond to invite"
  on zane_coaching for update
  using (client_id = auth.uid());

-- either party can end coaching
create policy "participants can end coaching"
  on zane_coaching for delete
  using (coach_id = auth.uid() or client_id = auth.uid());

-- notes: visible to both participants in the coaching relationship
create policy "notes visible to participants"
  on zane_coaching_notes for select
  using (
    exists (
      select 1 from zane_coaching c
      where c.id = coaching_id
        and (c.coach_id = auth.uid() or c.client_id = auth.uid())
    )
  );

-- both parties can write notes
create policy "participants can write notes"
  on zane_coaching_notes for insert
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from zane_coaching c
      where c.id = coaching_id
        and c.status = 'active'
        and (c.coach_id = auth.uid() or c.client_id = auth.uid())
    )
  );

-- recipient can mark as read
create policy "recipient can mark read"
  on zane_coaching_notes for update
  using (
    author_id <> auth.uid()
    and exists (
      select 1 from zane_coaching c
      where c.id = coaching_id
        and (c.coach_id = auth.uid() or c.client_id = auth.uid())
    )
  );

-- ─── COACH ACCESS TO CLIENT DATA ──────────────────────────────────────────────

-- Helper: is the caller an active coach of the given user_id?
create or replace function zane_is_coach_of(p_client_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from zane_coaching
    where coach_id = auth.uid()
      and client_id = p_client_id
      and status = 'active'
  )
$$;

-- zane_user_settings
create policy "coach can read client settings"
  on zane_user_settings for select
  using (zane_is_coach_of(user_id));

create policy "coach can update client settings"
  on zane_user_settings for update
  using (zane_is_coach_of(user_id));

-- zane_schedules
create policy "coach can read client schedules"
  on zane_schedules for select
  using (zane_is_coach_of(user_id));

create policy "coach can write client schedules"
  on zane_schedules for insert
  with check (zane_is_coach_of(user_id));

create policy "coach can update client schedules"
  on zane_schedules for update
  using (zane_is_coach_of(user_id));

create policy "coach can delete client schedules"
  on zane_schedules for delete
  using (zane_is_coach_of(user_id));

-- zane_exercises
create policy "coach can read client exercises"
  on zane_exercises for select
  using (zane_is_coach_of(user_id));

create policy "coach can write client exercises"
  on zane_exercises for insert
  with check (zane_is_coach_of(user_id));

create policy "coach can update client exercises"
  on zane_exercises for update
  using (zane_is_coach_of(user_id));

-- zane_sessions
create policy "coach can read client sessions"
  on zane_sessions for select
  using (zane_is_coach_of(user_id));

create policy "coach can write client sessions"
  on zane_sessions for insert
  with check (zane_is_coach_of(user_id));

create policy "coach can update client sessions"
  on zane_sessions for update
  using (zane_is_coach_of(user_id));

-- zane_session_entries
create policy "coach can read client entries"
  on zane_session_entries for select
  using (zane_is_coach_of(user_id));

create policy "coach can write client entries"
  on zane_session_entries for insert
  with check (zane_is_coach_of(user_id));

create policy "coach can update client entries"
  on zane_session_entries for update
  using (zane_is_coach_of(user_id));

create policy "coach can delete client entries"
  on zane_session_entries for delete
  using (zane_is_coach_of(user_id));

-- zane_sets
create policy "coach can read client sets"
  on zane_sets for select
  using (zane_is_coach_of(user_id));

create policy "coach can write client sets"
  on zane_sets for insert
  with check (zane_is_coach_of(user_id));

create policy "coach can update client sets"
  on zane_sets for update
  using (zane_is_coach_of(user_id));

create policy "coach can delete client sets"
  on zane_sets for delete
  using (zane_is_coach_of(user_id));

-- zane_skips (read-only for coach)
create policy "coach can read client skips"
  on zane_skips for select
  using (zane_is_coach_of(user_id));

-- ─── RPCs ─────────────────────────────────────────────────────────────────────

-- Look up a user by email (needed to invite a client).
-- Security definer so it can query auth.users without exposing the table.
create or replace function find_user_by_email(p_email text)
returns uuid
language sql
security definer
stable
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1
$$;

-- Invite a client: creates a pending coaching row.
-- Fails if the target email doesn't exist or a relationship already exists.
create or replace function invite_client(p_email text)
returns text   -- returns coaching id, or error message prefixed with 'ERROR:'
language plpgsql
security definer
as $$
declare
  v_client_id uuid;
  v_id        text;
  v_existing  text;
begin
  v_client_id := find_user_by_email(p_email);
  if v_client_id is null then
    return 'ERROR:not_found';
  end if;
  if v_client_id = auth.uid() then
    return 'ERROR:self';
  end if;
  select id into v_existing from zane_coaching
    where coach_id = auth.uid() and client_id = v_client_id;
  if found then
    return 'ERROR:exists:' || v_existing;
  end if;
  v_id := 'cch_' || gen_random_uuid()::text;
  insert into zane_coaching (id, coach_id, client_id, status)
    values (v_id, auth.uid(), v_client_id, 'pending');
  return v_id;
end
$$;

-- Client responds to a pending invite.
create or replace function respond_to_coaching_invite(p_coaching_id text, p_accept boolean)
returns void
language plpgsql
security definer
as $$
begin
  if p_accept then
    -- If client already has an active coach, end that relationship first
    delete from zane_coaching
      where client_id = auth.uid()
        and status = 'active'
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

-- Get coach name for a client (joins auth.users via profiles)
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
$$;

-- Get clients list for a coach
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
$$;
