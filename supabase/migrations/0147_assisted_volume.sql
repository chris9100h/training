-- Assisted exercises (movement_type = 'assisted') store the machine/band
-- assistance as a NEGATIVE load. The weight actually moved is the user's
-- bodyweight minus that assistance (= bodyweight + kg). The server aggregates
-- summed raw kg, so assisted sets subtracted from a session's volume once it
-- aged out of the client's 70-day window (and added nothing while inside it).
--
-- Count assisted sets as GREATEST(0, bodyweight + kg) * reps, using the logged
-- bodyweight closest (in calendar days) to the session date (zane_daily_logs).
-- Without a logged bodyweight the term collapses to GREATEST(0, kg), matching the
-- client fallback (assistance adds 0, a graduated positive load counts on its
-- own). Non-assisted sets are unchanged. Mirrors the client entryVolume() /
-- totalVolume() semantics so windowed and in-window volume stay consistent.
--
-- The bodyweight lookup lives inside the CASE, so it only runs for assisted sets.
-- SECURITY INVOKER: reads of zane_session_entries / zane_exercises /
-- zane_daily_logs run under the caller's RLS (own rows, or coach-of-client, which
-- the coach client-load already relies on for these same tables).

CREATE OR REPLACE FUNCTION public.get_session_stats(p_user_id uuid DEFAULT NULL)
 RETURNS TABLE(session_id text, exercise_count integer, done_sets integer, volume double precision)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
  WITH uid AS (SELECT COALESCE(p_user_id, auth.uid()) AS id)
  SELECT s.id AS session_id,
    (SELECT COUNT(*) FROM zane_session_entries e WHERE e.session_id = s.id)::int AS exercise_count,
    (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id
       AND NOT st.warmup AND NOT st.skipped
       AND ((st.kg IS NOT NULL
             AND (st.reps IS NOT NULL OR st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL))
            OR st.time_sec IS NOT NULL))::int AS done_sets,
    COALESCE((SELECT SUM(
        CASE WHEN ex.movement_type = 'assisted'
             THEN GREATEST(0, COALESCE((
                    SELECT dl.weight FROM zane_daily_logs dl
                    WHERE dl.user_id = s.user_id AND dl.weight IS NOT NULL
                    ORDER BY abs(dl.date::date - s.date::date) LIMIT 1), 0) + st.kg)
             ELSE st.kg END
        * COALESCE(CASE WHEN st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL
             THEN LEAST(COALESCE(st.reps_l, st.reps_r), COALESCE(st.reps_r, st.reps_l))
             ELSE st.reps END, 0))
      FROM zane_sets st
      LEFT JOIN zane_session_entries e ON e.id = st.entry_id
      LEFT JOIN zane_exercises ex ON ex.id = e.ex_id
      WHERE st.session_id = s.id
        AND NOT st.warmup AND NOT st.skipped
        AND st.kg IS NOT NULL
        AND (st.reps IS NOT NULL OR st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL)
    ), 0)::float AS volume
  FROM zane_sessions s
  WHERE s.user_id = (SELECT id FROM uid)
    AND s.ended IS NOT NULL;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_session_stats(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_session_stats(uuid) TO authenticated;

-- All-time totals (not currently called by the client, but its volume semantics
-- are documented to match totalVolume(); keep it in sync). ended gains user_id +
-- date so the assisted bodyweight lookup can correlate per session.
CREATE OR REPLACE FUNCTION public.get_user_volume_stats(p_user_id uuid DEFAULT NULL)
 RETURNS TABLE(session_count bigint, total_volume double precision, total_minutes bigint, total_done_sets bigint)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
  WITH uid AS (SELECT COALESCE(p_user_id, auth.uid()) AS id),
  ended AS (
    SELECT s.id, s.user_id, s.date, s.duration_minutes, s.started_at, s.ended
    FROM zane_sessions s WHERE s.user_id = (SELECT id FROM uid) AND s.ended IS NOT NULL
  )
  SELECT
    (SELECT COUNT(*) FROM ended)::bigint AS session_count,
    COALESCE((
      SELECT SUM(
        CASE WHEN ex.movement_type = 'assisted'
             THEN GREATEST(0, COALESCE((
                    SELECT dl.weight FROM zane_daily_logs dl
                    WHERE dl.user_id = en.user_id AND dl.weight IS NOT NULL
                    ORDER BY abs(dl.date::date - en.date::date) LIMIT 1), 0) + st.kg)
             ELSE st.kg END
        * (CASE WHEN st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL
             THEN LEAST(COALESCE(st.reps_l, st.reps_r), COALESCE(st.reps_r, st.reps_l))
             ELSE st.reps END))
      FROM zane_sets st
      JOIN ended en ON en.id = st.session_id
      LEFT JOIN zane_session_entries e ON e.id = st.entry_id
      LEFT JOIN zane_exercises ex ON ex.id = e.ex_id
      WHERE NOT st.warmup AND NOT st.skipped AND st.kg IS NOT NULL
        AND COALESCE(CASE WHEN st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL
             THEN LEAST(COALESCE(st.reps_l, st.reps_r), COALESCE(st.reps_r, st.reps_l))
             ELSE st.reps END, 0) > 0
    ), 0)::float AS total_volume,
    COALESCE((SELECT SUM(COALESCE(en.duration_minutes,
        CASE WHEN en.started_at IS NOT NULL AND en.ended > en.started_at
             THEN EXTRACT(EPOCH FROM (en.ended - en.started_at))/60 ELSE 0 END))::bigint FROM ended en), 0)::bigint AS total_minutes,
    COALESCE((SELECT COUNT(*) FROM zane_sets st JOIN ended en ON en.id = st.session_id
              WHERE st.done AND NOT st.warmup AND NOT st.skipped), 0)::bigint AS total_done_sets;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_user_volume_stats(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_user_volume_stats(uuid) TO authenticated;
