-- Server-side aggregate for the Stats screen's "Top Exercises" ranking, same
-- family as get_exercise_best_e1rm / get_session_stats (migration 0059/0147).
-- The client only ever holds session.entries for the 70-day boot window
-- (HISTORY_WINDOW_DAYS in store.js) plus whatever old sessions happen to be
-- cached from unrelated detail/compare-view visits, so counting entries
-- locally silently under-counts (and can mis-rank) for any account older than
-- 70 days. This counts zane_session_entries rows per exercise across every
-- ended session server-side, all-time, and returns the top p_limit.

CREATE OR REPLACE FUNCTION public.get_top_exercises(p_user_id uuid DEFAULT NULL, p_limit int DEFAULT 5)
 RETURNS TABLE(ex_id text, session_count bigint)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
  WITH uid AS (SELECT COALESCE(p_user_id, auth.uid()) AS id)
  SELECT e.ex_id, COUNT(*) AS session_count
  FROM zane_session_entries e
  JOIN zane_sessions s ON s.id = e.session_id
  WHERE e.user_id = (SELECT id FROM uid)
    AND e.ex_id IS NOT NULL
    AND s.ended IS NOT NULL
  GROUP BY e.ex_id
  ORDER BY session_count DESC
  LIMIT GREATEST(p_limit, 1);
$function$;

-- Matches the grant pattern established for the sibling SECURITY INVOKER
-- history-aggregate RPCs (see migration 0147 for get_session_stats, and the
-- 0141 live-audit note in docs/database.md): CREATE FUNCTION grants EXECUTE to
-- PUBLIC by default, which anon inherits regardless of a REVOKE targeted only
-- at anon, so PUBLIC must be revoked explicitly too.
REVOKE EXECUTE ON FUNCTION public.get_top_exercises(uuid, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_top_exercises(uuid, int) TO authenticated;
