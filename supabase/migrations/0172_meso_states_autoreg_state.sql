-- Autoreg v2 P2: a versioned per-plan autoregulation blob on the meso state.
-- Holds cross-block / anti-nag governance that must survive both the 70-day
-- history windowing and a device switch. In P2 it carries the deload-nudge
-- cooldown (spec 5.3): { version, deloadNudge: { block: { declinedAt,
-- cooldownUntil, escalation } } }. Nullable (no NOT NULL default): a plan that
-- has never declined a deload reads null, so an unset row costs nothing and an
-- older client that omits the field can never wipe live nag state (COALESCE-
-- preserved on update, same guard as started_at, migration 0138). Later phases
-- (P3) extend the same blob with landmarks / overreach / block snapshots.
-- Carried in the user backup (it is real per-user training governance: a restore
-- must not reset an active cooldown into a re-prompt loop).
alter table public.zane_meso_states
  add column autoreg_state jsonb;

-- sync_meso_states_batch (migration 0122, extended in 0130/0138/0165/0169) must
-- carry the new column. Same (jsonb) signature, so CREATE OR REPLACE preserves
-- the existing grants (see migration 0169) and no REVOKE/GRANT is re-issued.
create or replace function public.sync_meso_states_batch(p_states jsonb)
 returns void
 language sql
 security invoker
 set search_path to 'public'
as $function$
  insert into zane_meso_states (
    id, user_id, schedule_id, weeks, start_date, start_cycle_index, started_at,
    deltas, joint_flags, pump_low_counts, weight_boosts, growth_counts,
    rep_miss_counts, affinity, autoreg_state, completions, pending_meso2, updated_at
  )
  select
    m->>'id',
    auth.uid(),
    m->>'schedule_id',
    (m->>'weeks')::int,
    m->>'start_date',
    coalesce((m->>'start_cycle_index')::int, 0),
    (m->>'started_at')::timestamptz,
    coalesce(m->'deltas', '{}'::jsonb),
    coalesce(m->'joint_flags', '{}'::jsonb),
    coalesce(m->'pump_low_counts', '{}'::jsonb),
    coalesce(m->'weight_boosts', '{}'::jsonb),
    coalesce(m->'growth_counts', '{}'::jsonb),
    coalesce(m->'rep_miss_counts', '{}'::jsonb),
    coalesce(m->'affinity', '{}'::jsonb),
    nullif(m->'autoreg_state', 'null'::jsonb),
    coalesce((m->>'completions')::int, 0),
    coalesce((m->>'pending_meso2')::boolean, false),
    coalesce((m->>'updated_at')::timestamptz, now())
  from jsonb_array_elements(p_states) as m
  on conflict (id) do update set
    weeks             = excluded.weeks,
    start_date        = excluded.start_date,
    start_cycle_index = excluded.start_cycle_index,
    started_at        = coalesce(excluded.started_at, zane_meso_states.started_at),
    deltas            = excluded.deltas,
    joint_flags       = excluded.joint_flags,
    pump_low_counts   = excluded.pump_low_counts,
    weight_boosts     = excluded.weight_boosts,
    growth_counts     = excluded.growth_counts,
    rep_miss_counts   = excluded.rep_miss_counts,
    affinity          = excluded.affinity,
    autoreg_state     = coalesce(nullif(excluded.autoreg_state, 'null'::jsonb), zane_meso_states.autoreg_state),
    completions       = excluded.completions,
    pending_meso2     = excluded.pending_meso2,
    updated_at        = excluded.updated_at
  where zane_meso_states.updated_at < excluded.updated_at;
$function$;
