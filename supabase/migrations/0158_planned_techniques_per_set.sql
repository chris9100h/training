-- Migration 0158: per-set planned intensity techniques
-- Replaces the coarse single-technique + scope model from 0157 with a per-set
-- array: one technique slot per planned set (NULL where a set has no technique),
-- so a coach/user can prescribe e.g. Drop on set 1, Myo on set 2, Myo Match on
-- set 3, or a technique on just the last two sets. Same per-set shape as
-- planned_reps_per_set. The feature shipped only on a branch with no production
-- data, so the two 0157 columns are dropped rather than migrated.
ALTER TABLE zane_session_entries DROP COLUMN IF EXISTS planned_technique;
ALTER TABLE zane_session_entries DROP COLUMN IF EXISTS planned_technique_scope;
ALTER TABLE zane_session_entries ADD COLUMN planned_techniques text[];

-- Re-declare zane_entries_json so the coach's live session view carries the
-- per-set techniques. CREATE OR REPLACE keeps the function's existing REVOKE
-- grants (internal-only, see migration 0136).
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
