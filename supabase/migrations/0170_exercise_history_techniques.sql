-- Include intensity-technique data (technique + drops) in the server-side
-- exercise history so the in-training history sheet (tap the exercise name) can
-- annotate myo-rep / drop / partial sets instead of showing only the top set's
-- reps. The columns already exist on zane_sets; the RPC just never selected
-- them, so once the server rows loaded they replaced the local (annotated) ones
-- and the technique badge/total silently disappeared.

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
        'done', st.done, 'skipped', st.skipped, 'warmup', st.warmup,
        'technique', st.technique, 'drops', st.drops
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

-- CREATE OR REPLACE preserves existing privileges, but re-assert the lockout so a
-- fresh apply can never leave anon with the PUBLIC-inherited default EXECUTE.
REVOKE EXECUTE ON FUNCTION public.get_exercise_history(text, text, int, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exercise_history(text, text, int, uuid) TO authenticated;
