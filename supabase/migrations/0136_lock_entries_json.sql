-- Migration 0136 (audit A1): lock zane_entries_json to internal use only.
--
-- zane_entries_json(text) is SECURITY DEFINER (runs RLS-exempt as its owner) and
-- filters ONLY by session_id — no auth.uid() owner check, no zane_is_coach_of().
-- It was EXECUTE-granted to `authenticated`, so any logged-in user could read
-- ANY session's full detail (exercises, weights, reps, notes, techniques) over
-- PostgREST (/rest/v1/rpc/zane_entries_json) just by passing another user's
-- session id — a cross-tenant read (IDOR) that RLS on the underlying tables
-- would otherwise deny.
--
-- The function is never called from client code — only internally by
-- get_active_session_detail / get_active_sessions_overview, which are themselves
-- SECURITY DEFINER and enforce admin / active_users-grant / coach-of access.
-- A definer function runs as its owner, who retains EXECUTE regardless of role
-- grants, so those internal callers keep working after the revoke (same
-- internal-only pattern as find_user_by_email).
REVOKE EXECUTE ON FUNCTION public.zane_entries_json(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.zane_entries_json(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.zane_entries_json(text) FROM authenticated;
