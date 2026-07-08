-- Time-based exercises: get_session_stats feeds the aggDoneSets fallback for
-- sessions outside the 70-day boot window, but its done_sets count required
-- kg + reps, so a time-only session read as "0 sets" once it aged out of the
-- window (the client-side doneSetCount counts a logged duration). Count a set
-- with a logged time_sec as done. Volume math is unchanged: time sets carry
-- no load, they contribute 0 volume on both sides.
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
    COALESCE((SELECT SUM(st.kg * COALESCE(
        CASE WHEN st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL
             THEN LEAST(COALESCE(st.reps_l, st.reps_r), COALESCE(st.reps_r, st.reps_l))
             ELSE st.reps END, 0))
      FROM zane_sets st WHERE st.session_id = s.id
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
