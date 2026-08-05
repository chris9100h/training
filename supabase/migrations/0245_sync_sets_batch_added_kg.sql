-- sync_sets_batch was never updated when Migration 0243 added zane_sets.
-- added_kg (the plus_load-mode belt/dip-belt load, typed separately from
-- the total kg): the RPC's INSERT column list, SELECT projection, and ON
-- CONFLICT UPDATE SET never referenced it. p_sets jsonb keys the RPC
-- doesn't reference are silently ignored (not an error), so every set
-- synced through the normal incremental path (i.e. every write after the
-- very first boot import) landed with added_kg = NULL, even though the
-- client (store.js's allSets builder) already sends the typed value
-- correctly. Only the one-time import path (a plain zane_sets upsert, used
-- exclusively when there is no previous local session state to diff
-- against) ever actually persisted it. kg itself was never affected (it
-- still carries the total load, so volume/e1RM/PR math is untouched), but
-- the belt-load number a plus_load user actually typed was silently
-- dropped on every normal sync since 0243 shipped.
--
-- CREATE OR REPLACE preserves the existing REVOKE/GRANT (identical
-- signature), no grants need to be reapplied.

CREATE OR REPLACE FUNCTION public.sync_sets_batch(p_sets jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  INSERT INTO zane_sets (
    id, session_id, entry_id, user_id,
    set_idx, kg, reps, reps_l, reps_r, time_sec, added_kg,
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
    (s->>'added_kg')::numeric,
    COALESCE((s->>'done')::boolean,    false),
    COALESCE((s->>'skipped')::boolean, false),
    COALESCE((s->>'warmup')::boolean,  false),
    NULLIF(s->>'technique', ''),
    CASE WHEN s->'drops' IS NOT NULL AND s->'drops' != 'null'::jsonb THEN s->'drops' ELSE NULL END,
    LEAST(COALESCE((s->>'updated_at')::timestamptz, now()), now())
  FROM jsonb_array_elements(p_sets) AS s
  ON CONFLICT (id) DO UPDATE SET
    kg         = EXCLUDED.kg,
    reps       = EXCLUDED.reps,
    reps_l     = EXCLUDED.reps_l,
    reps_r     = EXCLUDED.reps_r,
    time_sec   = EXCLUDED.time_sec,
    added_kg   = EXCLUDED.added_kg,
    done       = EXCLUDED.done,
    skipped    = EXCLUDED.skipped,
    warmup     = EXCLUDED.warmup,
    technique  = EXCLUDED.technique,
    drops      = EXCLUDED.drops,
    updated_at = EXCLUDED.updated_at
  WHERE zane_sets.updated_at < EXCLUDED.updated_at;
$function$;
