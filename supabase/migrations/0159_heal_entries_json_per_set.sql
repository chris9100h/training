-- Migration 0159: heal a partial apply of 0158.
-- On the live DB the ALTER TABLE parts of 0158 ran (planned_technique and
-- planned_technique_scope dropped, planned_techniques text[] added) but the
-- CREATE OR REPLACE FUNCTION zane_entries_json did not take, so the live
-- function was still the 0157 version referencing the now-dropped columns. It
-- threw "column e.planned_technique does not exist" at runtime, which took down
-- get_active_session_detail (built on zane_entries_json) and left the admin
-- Active Users detail and the coach live session view stuck on an empty
-- "not training" state, even though the overview list still showed the user.
--
-- This re-asserts the correct per-set function (identical to 0158) and, as a
-- safety net for a fresh DB, ensures the column exists. CREATE OR REPLACE keeps
-- the function's internal-only REVOKE grants (see migration 0136), so no grants
-- are re-issued and anon stays without EXECUTE.
ALTER TABLE zane_session_entries ADD COLUMN IF NOT EXISTS planned_techniques text[];

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
      'plannedRepsMax', e.planned_reps_max,
      'plannedProgressionOffset', e.planned_progression_offset,
      'plannedTechniques', e.planned_techniques,
      'note', e.note,
      'supersetGroup', e.superset_group,
      'category', ex.category,
      'equipment', ex.equipment,
      'movementType', ex.movement_type,
      'sets', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'kg', st.kg, 'reps', st.reps, 'repsL', st.reps_l, 'repsR', st.reps_r,
            'timeSec', st.time_sec,
            'done', st.done, 'skipped', st.skipped, 'warmup', st.warmup,
            'technique', st.technique, 'drops', st.drops
          ) ORDER BY st.set_idx)
        FROM zane_sets st WHERE st.entry_id = e.id
      ), '[]'::jsonb)
    ) ORDER BY e.entry_idx
  ), '[]'::jsonb)
  FROM zane_session_entries e
  LEFT JOIN zane_exercises ex ON ex.id = e.ex_id
  WHERE e.session_id = p_session_id;
$function$;
