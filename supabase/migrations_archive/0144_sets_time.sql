-- Time-based exercises (HIIT / max-hold): a per-set duration in seconds.
-- An exercise with log_mode 'time' logs a duration instead of weight/reps, so
-- its sets carry time_sec. Add the column, thread it through the set-sync batch
-- upsert, and surface it in the coach/spectator entries payload.

ALTER TABLE public.zane_sets ADD COLUMN IF NOT EXISTS time_sec integer;

-- sync_sets_batch: add time_sec to the insert columns, the select, and the
-- staleness-guarded conflict update. Signature unchanged, so CREATE OR REPLACE
-- keeps the existing grants; re-assert them anyway (grant-trap hygiene).
CREATE OR REPLACE FUNCTION public.sync_sets_batch(p_sets jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  INSERT INTO zane_sets (
    id, session_id, entry_id, user_id,
    set_idx, kg, reps, reps_l, reps_r, time_sec,
    done, skipped, warmup, technique, drops, updated_at
  )
  SELECT
    s->>'id',
    s->>'session_id',
    s->>'entry_id',
    auth.uid(),
    (s->>'set_idx')::int,
    (s->>'kg')::numeric,
    (s->>'reps')::int,
    (s->>'reps_l')::int,
    (s->>'reps_r')::int,
    (s->>'time_sec')::int,
    COALESCE((s->>'done')::boolean,    false),
    COALESCE((s->>'skipped')::boolean, false),
    COALESCE((s->>'warmup')::boolean,  false),
    NULLIF(s->>'technique', ''),
    CASE WHEN s->'drops' IS NOT NULL AND s->'drops' != 'null'::jsonb THEN s->'drops' ELSE NULL END,
    (s->>'updated_at')::timestamptz
  FROM jsonb_array_elements(p_sets) AS s
  ON CONFLICT (id) DO UPDATE SET
    kg         = EXCLUDED.kg,
    reps       = EXCLUDED.reps,
    reps_l     = EXCLUDED.reps_l,
    reps_r     = EXCLUDED.reps_r,
    time_sec   = EXCLUDED.time_sec,
    done       = EXCLUDED.done,
    skipped    = EXCLUDED.skipped,
    warmup     = EXCLUDED.warmup,
    technique  = EXCLUDED.technique,
    drops      = EXCLUDED.drops,
    updated_at = EXCLUDED.updated_at
  WHERE zane_sets.updated_at < EXCLUDED.updated_at;
$function$;

REVOKE EXECUTE ON FUNCTION public.sync_sets_batch(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sync_sets_batch(jsonb) TO authenticated;

-- zane_entries_json: surface timeSec so the coach/spectator entries payload
-- shows time-based sets. Internal-only, so re-assert the full revoke.
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

REVOKE EXECUTE ON FUNCTION public.zane_entries_json(text) FROM PUBLIC, anon, authenticated;
