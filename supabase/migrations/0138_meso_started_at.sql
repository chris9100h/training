-- Migration 0138 (audit C1): persist the mesocycle block-start anchor.
--
-- mesoCurrentWeek prefers mesoState.startedAt (the exact block-start timestamp)
-- over the date-only start_date so that sessions from a PREVIOUS block, logged
-- the same calendar day a new block starts, don't leak into the new block's
-- count and fast-forward its week / RIR target. startedAt was client-only (never
-- round-tripped through the DB), so on a second device or after a cache wipe the
-- flex week counter fell back to the date comparison and could advance a session
-- early. Persist it.
ALTER TABLE public.zane_meso_states ADD COLUMN IF NOT EXISTS started_at timestamptz;

-- sync_meso_states_batch (migration 0122) must carry the new column. COALESCE on
-- update so a client that doesn't send started_at (older build) never nulls out
-- an existing anchor.
CREATE OR REPLACE FUNCTION public.sync_meso_states_batch(p_states jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  INSERT INTO zane_meso_states (
    id, user_id, schedule_id, weeks, start_date, start_cycle_index, started_at,
    deltas, joint_flags, pump_low_counts, weight_boosts, growth_counts,
    completions, pending_meso2, updated_at
  )
  SELECT
    m->>'id',
    auth.uid(),
    m->>'schedule_id',
    (m->>'weeks')::int,
    m->>'start_date',
    COALESCE((m->>'start_cycle_index')::int, 0),
    (m->>'started_at')::timestamptz,
    COALESCE(m->'deltas', '{}'::jsonb),
    COALESCE(m->'joint_flags', '{}'::jsonb),
    COALESCE(m->'pump_low_counts', '{}'::jsonb),
    COALESCE(m->'weight_boosts', '{}'::jsonb),
    COALESCE(m->'growth_counts', '{}'::jsonb),
    COALESCE((m->>'completions')::int, 0),
    COALESCE((m->>'pending_meso2')::boolean, false),
    COALESCE((m->>'updated_at')::timestamptz, now())
  FROM jsonb_array_elements(p_states) AS m
  ON CONFLICT (id) DO UPDATE SET
    weeks             = EXCLUDED.weeks,
    start_date        = EXCLUDED.start_date,
    start_cycle_index = EXCLUDED.start_cycle_index,
    started_at        = COALESCE(EXCLUDED.started_at, zane_meso_states.started_at),
    deltas            = EXCLUDED.deltas,
    joint_flags       = EXCLUDED.joint_flags,
    pump_low_counts   = EXCLUDED.pump_low_counts,
    weight_boosts     = EXCLUDED.weight_boosts,
    growth_counts     = EXCLUDED.growth_counts,
    completions       = EXCLUDED.completions,
    pending_meso2     = EXCLUDED.pending_meso2,
    updated_at        = EXCLUDED.updated_at
  WHERE zane_meso_states.updated_at < EXCLUDED.updated_at;
$function$;
