-- Migration 0157: plan intensity techniques ahead of time
-- A coach/user can attach an intensity technique to a planned exercise so it is
-- auto-armed live during training instead of relying on the client to pick it.
--   planned_technique: null = none, else one of the set-level technique values
--     ('drop', 'myorep', 'myorep_match', 'amrap_variations',
--     'lengthened_partial', 'weighted_stretch'), same vocabulary as
--     zane_sets.technique.
--   planned_technique_scope: 'last' = only the last working set, 'all' = every
--     working set. Null when planned_technique is null.
-- Lives on the session entry (copied from the schedule day item at session
-- start, like the other planned_* columns) so a later plan edit does not
-- retroactively change an in-progress session. The zane_schedules.days and
-- zane_workout_templates.exercises JSONB carry plannedTechnique and
-- plannedTechniqueScope as passthrough, so no column change is needed there.
ALTER TABLE zane_session_entries ADD COLUMN planned_technique text;
ALTER TABLE zane_session_entries ADD COLUMN planned_technique_scope text;

-- Re-declare zane_entries_json so the coach's live session view carries the
-- planned technique too. CREATE OR REPLACE keeps the function's existing
-- REVOKE grants (internal-only, see migration 0136), so none are re-issued.
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
      'plannedTechnique', e.planned_technique,
      'plannedTechniqueScope', e.planned_technique_scope,
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
