-- 0125 — Security hardening (app audit)
--
-- Fixes an authenticated-user privilege-escalation chain in the coaching
-- feature plus assorted advisor hardening.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Coaching consent bypass (critical).
-- The INSERT policy only checked `coach_id = auth.uid()`, so any authenticated
-- user could insert a row {coach_id: me, client_id: victim, status: 'active'}
-- directly via PostgREST. Because zane_is_coach_of() only requires
-- status='active', that granted full read/write on the victim's training data.
-- Require the row to start as a pending invite for someone else; activation is
-- the client's job (respond_to_coaching_invite).
drop policy if exists "coach can invite" on public.zane_coaching;
create policy "coach can invite" on public.zane_coaching
  for insert to public
  with check (
    coach_id = (select auth.uid())
    and status = 'pending'
    and coach_id <> client_id
  );

-- 2) Coach could self-activate a pending invite.
-- "coach can update coaching row" had USING (coach_id = auth.uid()) and NO
-- WITH CHECK, so a coach could flip status pending→active without the client
-- ever accepting. RLS WITH CHECK can't compare OLD vs NEW, so status/party
-- immutability is enforced by a BEFORE UPDATE trigger; the WITH CHECK just
-- keeps the coach from reassigning the row's coach_id to someone else.
drop policy if exists "coach can update coaching row" on public.zane_coaching;
create policy "coach can update coaching row" on public.zane_coaching
  for update to public
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

drop policy if exists "client can respond to invite" on public.zane_coaching;
create policy "client can respond to invite" on public.zane_coaching
  for update to public
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

-- coach_id/client_id are immutable; only the client may change status (the
-- pending→active acceptance). Blocks both self-activation vectors above even
-- if a future policy is loosened.
create or replace function public.zane_coaching_guard_update()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if new.coach_id <> old.coach_id or new.client_id <> old.client_id then
    raise exception 'coach_id/client_id are immutable';
  end if;
  if new.status is distinct from old.status and (select auth.uid()) <> old.client_id then
    raise exception 'only the client may change coaching status';
  end if;
  return new;
end;
$$;

drop trigger if exists zane_coaching_guard_update on public.zane_coaching;
create trigger zane_coaching_guard_update
  before update on public.zane_coaching
  for each row execute function public.zane_coaching_guard_update();

-- ─────────────────────────────────────────────────────────────────────────
-- 3) find_user_by_email was an ungated email→UUID oracle callable by any
-- authenticated user. It only needs to run inside invite_client (SECURITY
-- DEFINER, runs as owner), so revoke direct execute from clients.
revoke execute on function public.find_user_by_email(text) from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) The anon (unauthenticated) role should not be able to invoke any public
-- RPC — the app calls none before sign-in. Removes anon from the attack
-- surface of every SECURITY DEFINER function (advisor 0028).
revoke execute on all functions in schema public from anon;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Pin search_path on every SECURITY DEFINER function that still has a
-- mutable one (advisor 0011). `public, pg_temp` is fixed and keeps unqualified
-- references resolving.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
      )
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) chat-attachments is a public bucket (images served via public CDN URL),
-- so it does not need a SELECT policy — the broad one only let clients LIST
-- every file (advisor 0025). Upload/delete policies are unchanged.
drop policy if exists "chat_attach_select" on storage.objects;
