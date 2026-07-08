-- Time-based exercises: the in-training exercise-history sheet reads
-- get_exercise_history (fetchExerciseHistory). Migration 0144 threaded time_sec
-- through the set sync and the coach entries payload but not this INVOKER
-- reporting RPC, so a time-only session was excluded by the "has kg/reps" EXISTS
-- guard and no timeSec was returned. Include time_sec in the payload and count a
-- logged duration as a real set.
CREATE OR REPLACE FUNCTION public.get_exercise_history(p_ex_id text, p_day_id text DEFAULT NULL, p_limit int DEFAULT 12, p_user_id uuid DEFAULT NULL)
 RETURNS TABLE(session_id text, day_id text, date timestamptz, ended timestamptz, sets jsonb)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
  WITH uid AS (SELECT COALESCE(p_user_id, auth.uid()) AS id)
  SELECT s.id AS session_id, s.day_id, s.date, s.ended,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kg', st.kg, 'reps', st.reps, 'repsL', st.reps_l, 'repsR', st.reps_r,
        'timeSec', st.time_sec,
        'done', st.done, 'skipped', st.skipped, 'warmup', st.warmup
      ) ORDER BY st.set_idx)
      FROM zane_sets st WHERE st.entry_id = e.id
    ), '[]'::jsonb) AS sets
  FROM zane_sessions s
  JOIN zane_session_entries e ON e.session_id = s.id
  WHERE e.user_id = (SELECT id FROM uid)
    AND e.ex_id = p_ex_id
    AND s.ended IS NOT NULL
    AND (p_day_id IS NULL OR s.day_id = p_day_id)
    AND EXISTS (SELECT 1 FROM zane_sets st2 WHERE st2.entry_id = e.id
                AND (st2.kg IS NOT NULL OR st2.reps IS NOT NULL OR st2.reps_l IS NOT NULL OR st2.reps_r IS NOT NULL OR st2.time_sec IS NOT NULL))
  ORDER BY s.ended DESC
  LIMIT GREATEST(p_limit, 1);
$function$;

REVOKE EXECUTE ON FUNCTION public.get_exercise_history(text, text, int, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_exercise_history(text, text, int, uuid) TO authenticated;
