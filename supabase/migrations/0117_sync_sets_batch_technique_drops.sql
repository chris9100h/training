-- Add technique and drops to sync_sets_batch.
-- The function was written before migration 0115 added these columns and was
-- never updated, so intensity-technique data was silently dropped on every sync.

CREATE OR REPLACE FUNCTION public.sync_sets_batch(p_sets jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  INSERT INTO zane_sets (
    id, session_id, entry_id, user_id,
    set_idx, kg, reps, reps_l, reps_r,
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
    done       = EXCLUDED.done,
    skipped    = EXCLUDED.skipped,
    warmup     = EXCLUDED.warmup,
    technique  = EXCLUDED.technique,
    drops      = EXCLUDED.drops,
    updated_at = EXCLUDED.updated_at
  WHERE zane_sets.updated_at < EXCLUDED.updated_at;
$function$;
