-- get_exercise_history projected a fixed field list per set and never carried
-- added_kg (migration 0243) or horn_loads (migration 0254). Both describe HOW a
-- load was made up rather than how big it was, and both are what the seeder
-- repeats into the next session: the belt load of a plus_load exercise, and the
-- per-horn distribution of a multi-horn machine.
--
-- Consequence before this: the server history path handed buildSeedSets sets
-- that had already lost those fields, so seeding fell back to "no previous
-- value" every time. kg was unaffected, so nothing looked broken, the belt load
-- and the horn split simply never pre-filled. Same silent-omission class as the
-- sync_sets_batch bug that migration 0245 fixed, one layer up.
--
-- Nothing else about the function changes, so the existing REVOKE/GRANT is
-- preserved by CREATE OR REPLACE (identical signature).
CREATE OR REPLACE FUNCTION public.get_exercise_history(p_ex_id text, p_day_id text DEFAULT NULL, p_limit int DEFAULT 12, p_user_id uuid DEFAULT NULL)
 RETURNS TABLE(session_id text, day_id text, date timestamptz, ended timestamptz, sets jsonb)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
  WITH uid AS (SELECT COALESCE(p_user_id, auth.uid()) AS id)
  SELECT s.id AS session_id, s.day_id, s.date, s.ended,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kg', st.kg, 'reps', st.reps, 'repsL', st.reps_l, 'repsR', st.reps_r,
        'timeSec', st.time_sec, 'addedKg', st.added_kg, 'hornLoads', st.horn_loads,
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
  ORDER BY s.ended DESC
  LIMIT p_limit;
$function$;
