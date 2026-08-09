-- Multi-horn plate loading (PRIME-style machines).
--
-- Plate-loaded lever machines from PRIME and similar carry several loading
-- horns at different distances from the pivot. Resistance is torque, so the
-- same plate produces a different load depending on which horn it sits on, and
-- the distribution between horns also shifts where in the range of motion the
-- resistance peaks. The leverage ratios are model-specific and not published,
-- so ANY computed "effective load" would be an invented number that then feeds
-- e1RM, PRs, volume and the autoregulation grades. We deliberately do not
-- compute one.
--
-- What we do instead: let the user name their machine's horns once, log a
-- weight per horn per set, and store the plain SUM in kg. The sum is the one
-- honest number available (it is literally the plates on the machine), and the
-- per-horn breakdown makes the setup reproducible, which is what the user
-- actually needs. Seeding carries it into the next session.

-- Ordered horn names for a multi-horn exercise, e.g. ["Standard","Mid","High"].
-- Non-empty = this exercise logs per horn. Deliberately NOT a second mode
-- column: no_weight_reps vs log_mode already shows what a derived duplicate
-- costs in this schema.
ALTER TABLE public.zane_exercises
  ADD COLUMN IF NOT EXISTS horn_labels jsonb;

-- Per-set breakdown, [{"label": "Mid", "kg": 20}, ...]. Self-describing rather
-- than positional on purpose: renaming or reordering an exercise's horns later
-- must not silently re-label the sets already in history. Same shape philosophy
-- as zane_sets.drops (migration 0115).
--
-- kg keeps carrying the SUM, so volume, e1RM, PR detection and the whole
-- autoregulation path read the same column with the same meaning they always
-- had. Exactly the added_kg arrangement from migration 0243.
ALTER TABLE public.zane_sets
  ADD COLUMN IF NOT EXISTS horn_loads jsonb;

-- sync_sets_batch has to reference the new column in ALL THREE places: the
-- INSERT column list, the SELECT projection and the ON CONFLICT UPDATE SET.
-- p_sets jsonb keys the function does not reference are silently ignored, not
-- an error, so a missing reference means every set synced through the normal
-- incremental path lands with horn_loads = NULL while the client thinks it sent
-- it. That is exactly what happened to added_kg between migrations 0243 and
-- 0245, and it went unnoticed for ten migrations because kg itself stayed
-- correct.
--
-- CREATE OR REPLACE preserves the existing REVOKE/GRANT (identical signature),
-- no grants need to be reapplied.
CREATE OR REPLACE FUNCTION public.sync_sets_batch(p_sets jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  INSERT INTO zane_sets (
    id, session_id, entry_id, user_id,
    set_idx, kg, reps, reps_l, reps_r, time_sec, added_kg,
    done, skipped, warmup, technique, drops, horn_loads, updated_at
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
    CASE WHEN s->'horn_loads' IS NOT NULL AND s->'horn_loads' != 'null'::jsonb THEN s->'horn_loads' ELSE NULL END,
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
    horn_loads = EXCLUDED.horn_loads,
    updated_at = EXCLUDED.updated_at
  WHERE zane_sets.updated_at < EXCLUDED.updated_at;
$function$;
