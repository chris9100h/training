-- Add exercise metadata (category, equipment, movement_type) to zane_entries_json
-- so the spectator/coach screens can show per-exercise configuration.
-- LEFT JOIN so entries without a matching exercise row (deleted/ad-hoc) still return.

CREATE OR REPLACE FUNCTION public.zane_entries_json(p_session_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'exId', e.ex_id,
      'name', e.name,
      'plannedSets', e.planned_sets,
      'plannedReps', e.planned_reps,
      'plannedRepsPerSet', e.planned_reps_per_set,
      'note', e.note,
      'supersetGroup', e.superset_group,
      'category', ex.category,
      'equipment', ex.equipment,
      'movementType', ex.movement_type,
      'sets', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'kg', st.kg, 'reps', st.reps, 'repsL', st.reps_l, 'repsR', st.reps_r,
            'done', st.done, 'skipped', st.skipped, 'warmup', st.warmup
          ) ORDER BY st.set_idx)
        FROM zane_sets st WHERE st.entry_id = e.id
      ), '[]'::jsonb)
    ) ORDER BY e.entry_idx
  ), '[]'::jsonb)
  FROM zane_session_entries e
  LEFT JOIN zane_exercises ex ON ex.id = e.ex_id
  WHERE e.session_id = p_session_id;
$function$;
