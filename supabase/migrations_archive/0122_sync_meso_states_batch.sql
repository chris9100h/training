-- Multi-device safety for mesocycle state.
--
-- zane_meso_states was synced via a plain upsert with no staleness check.
-- Since id is deterministic (user_id || '_' || schedule_id), two devices
-- training the same mesocycle plan around the same time each flush their own
-- full snapshot at session end and the later network write silently wins,
-- discarding the other device's deltas/jointFlags/pumpLowCounts/weightBoosts
-- outright. This adds a batch upsert RPC that only overwrites when the
-- incoming updated_at is newer than what's stored, mirroring
-- sync_daily_logs_batch (migration 0096) and sync_sets_batch (migration 0031).
--
-- Additive & backward-compatible: older clients keep using the plain upsert
-- until they update.

CREATE OR REPLACE FUNCTION sync_meso_states_batch(p_states jsonb)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  INSERT INTO zane_meso_states (
    id, user_id, schedule_id, weeks, start_date, start_cycle_index,
    deltas, joint_flags, pump_low_counts, weight_boosts,
    completions, pending_meso2, updated_at
  )
  SELECT
    m->>'id',
    auth.uid(),
    m->>'schedule_id',
    (m->>'weeks')::int,
    m->>'start_date',
    COALESCE((m->>'start_cycle_index')::int, 0),
    COALESCE(m->'deltas', '{}'::jsonb),
    COALESCE(m->'joint_flags', '{}'::jsonb),
    COALESCE(m->'pump_low_counts', '{}'::jsonb),
    COALESCE(m->'weight_boosts', '{}'::jsonb),
    COALESCE((m->>'completions')::int, 0),
    COALESCE((m->>'pending_meso2')::boolean, false),
    COALESCE((m->>'updated_at')::timestamptz, now())
  FROM jsonb_array_elements(p_states) AS m
  ON CONFLICT (id) DO UPDATE SET
    weeks             = EXCLUDED.weeks,
    start_date        = EXCLUDED.start_date,
    start_cycle_index = EXCLUDED.start_cycle_index,
    deltas            = EXCLUDED.deltas,
    joint_flags       = EXCLUDED.joint_flags,
    pump_low_counts   = EXCLUDED.pump_low_counts,
    weight_boosts     = EXCLUDED.weight_boosts,
    completions       = EXCLUDED.completions,
    pending_meso2     = EXCLUDED.pending_meso2,
    updated_at        = EXCLUDED.updated_at
  WHERE zane_meso_states.updated_at < EXCLUDED.updated_at;
$$;
