-- Growth-turn rotation for mesocycle volume progression.
--
-- Today, "Volume: Not enough" always grows the muscle group's main lift only
-- (up to base+4, via applyMesoSetDeltaFromState's existing per-exercise clamp
-- in screens-train.jsx) — other exercises for the same muscle can only shrink
-- or stay flat, never grow. growth_counts tracks, per exercise (exId_dayId
-- keyed, same shape as deltas/weight_boosts), how many "not enough" grants it
-- has received this mesocycle block — kept SEPARATE from deltas so an
-- unrelated shrink event (soreness/joint pain) never distorts turn fairness.
-- Whichever exercise in the muscle group has the fewest growth_counts (and is
-- still below its own existing per-exercise ceiling) wins the next grant,
-- distributing growth across a muscle's exercises instead of concentrating it
-- on one lift. Resets to {} alongside deltas/joint_flags/pump_low_counts at
-- the start of every new meso block.
--
-- IMPORTANT: sync_meso_states_batch (migration 0122) is a hand-written batch
-- upsert with an explicit column list — a bare ALTER TABLE would silently be
-- ignored by every sync, exactly like migration 0115 (zane_sets technique/
-- drops) was silently dropped by sync_sets_batch until migration 0117 caught
-- up two migrations later. This migration updates the RPC in the same step.

alter table zane_meso_states add column if not exists growth_counts jsonb not null default '{}';

CREATE OR REPLACE FUNCTION sync_meso_states_batch(p_states jsonb)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  INSERT INTO zane_meso_states (
    id, user_id, schedule_id, weeks, start_date, start_cycle_index,
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
    deltas            = EXCLUDED.deltas,
    joint_flags       = EXCLUDED.joint_flags,
    pump_low_counts   = EXCLUDED.pump_low_counts,
    weight_boosts     = EXCLUDED.weight_boosts,
    growth_counts     = EXCLUDED.growth_counts,
    completions       = EXCLUDED.completions,
    pending_meso2     = EXCLUDED.pending_meso2,
    updated_at        = EXCLUDED.updated_at
  WHERE zane_meso_states.updated_at < EXCLUDED.updated_at;
$$;
