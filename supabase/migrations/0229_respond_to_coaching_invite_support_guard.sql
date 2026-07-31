-- 0229_respond_to_coaching_invite_support_guard.sql
-- Live bug: accepting ANY coaching invite hard-deletes ALL of the accepting
-- user's active support tickets, not just superseded real coaching
-- relationships. Root cause: respond_to_coaching_invite's first delete ("end
-- previous active coaching relationships") matches on client_id, status =
-- 'active', coach_id <> client_id, and id <> the invite id being accepted.
-- Support tickets (zane_coaching rows with id LIKE 'support_%', see migration
-- 0085) stay at status = 'active' for their entire lifecycle (their own
-- separate support_status column tracks open/in_progress/resolved, not the
-- shared status column), have coach_id <> client_id (the support agent isn't
-- the ticket opener), and their id never equals the invite id being accepted.
-- So every support ticket a user has ever opened satisfies all four
-- conditions and gets silently wiped the moment that user accepts any
-- coaching invite.
--
-- The sibling function invite_client got the analogous fix in migration 0151
-- (`id NOT LIKE 'support_%'`), the same guard used dozens of times throughout
-- this codebase (e.g. 0085, 0088, 0091, 0148, 0149, 0173, 0180, 0186).
-- respond_to_coaching_invite was missed. Apply the same guard here, to the
-- same delete statement.
--
-- The second delete ("reject all other pending invites for this client")
-- does not need this guard: support tickets are created directly at status =
-- 'active' (see 0085) and are never in a pending status, so they can never
-- match that delete's status = 'pending' condition.

create or replace function respond_to_coaching_invite(p_coaching_id text, p_accept boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_accept then
    -- If client already has an active (real) coach, end that relationship first
    delete from zane_coaching
      where client_id = auth.uid()
        and status = 'active'
        and coach_id <> client_id
        and id <> p_coaching_id
        and id not like 'support_%';
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
