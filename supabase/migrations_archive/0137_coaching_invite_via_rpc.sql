-- Migration 0137 (audit A2): coaching invites must go through invite_client.
--
-- The "coach can invite" INSERT policy only required
--   coach_id = auth.uid() AND status = 'pending' AND coach_id <> client_id
-- with no restriction on client_id or the other columns. A user could therefore
-- POST directly to /rest/v1/zane_coaching (bypassing the invite_client RPC and
-- its not-self / not-already-coached / no-duplicate guards) and spam arbitrary
-- users with unsolicited "X wants to coach you" pending rows. No data leaked
-- (rows stay pending; the zane_coaching_guard_update trigger lets only the
-- client flip them to active), but it's a nuisance/abuse vector.
--
-- Remove the broad direct INSERT so the only way to create a coaching row is via
-- the SECURITY DEFINER RPCs (invite_client, enable_self_coaching,
-- open_support_chat, admin_broadcast_message) — those run as the table owner and
-- keep working. Drop the now-inert policy too so a future re-grant can't silently
-- reopen the hole (RLS defaults to deny with no INSERT policy).
DROP POLICY IF EXISTS "coach can invite" ON public.zane_coaching;
REVOKE INSERT ON TABLE public.zane_coaching FROM anon, authenticated;
