-- Adherence and targets_snap are DERIVED: the client recomputes them from the
-- day's food entries and the active macro targets. They were written through
-- sync_daily_logs_batch like any user-entered field, which meant a pure
-- recompute had to bump updated_at to get past that RPC's staleness guard, and
-- bumping it made the whole row win last-write-wins. So a device holding a
-- stale copy of the day could recompute adherence and, in the same write, push
-- its outdated weight, steps, body measurements and macros over another
-- device's newer entries.
--
-- This gives the derived pair its own narrow write path: exactly two columns,
-- no updated_at, no ability to carry anything else along. A recompute can no
-- longer speak for the rest of the row.
--
-- Deliberately does NOT insert: adherence for a day with no row is meaningless,
-- and creating one here would resurrect days the user deleted. A missing row is
-- a no-op, the value is recomputed on the next boot anyway.
CREATE OR REPLACE FUNCTION public.update_daily_log_derived(
  p_date text,
  p_adherence numeric DEFAULT NULL,
  p_targets_snap jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  UPDATE zane_daily_logs
     SET adherence = p_adherence,
         targets_snap = p_targets_snap
   WHERE user_id = auth.uid()
     AND date = p_date;
$function$;

-- Grant hygiene (docs/database.md, "Grant-Fallen"): CREATE FUNCTION hands
-- EXECUTE to PUBLIC, which anon inherits. Revoke first, then grant only what
-- the app needs. SECURITY INVOKER plus the auth.uid() predicate means RLS still
-- applies, but an anon grant would still be wrong on principle.
REVOKE EXECUTE ON FUNCTION public.update_daily_log_derived(text, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_daily_log_derived(text, numeric, jsonb) TO authenticated;
