-- 0178_weight_boost_declines.sql
-- New exId_dayId-keyed lever on zane_meso_states, alongside weight_boosts:
-- records a session-scoped user decline of an earned Meso weight bump (the
-- "Next session" gains sheet gets a per-exercise Decline button). Cleared
-- automatically whenever that exId_dayId is re-earned/re-evaluated the next
-- session (see clearMesoWeightBoostDeclines in store.js), so a decline never
-- persists past the session that set it: the user is asked again every time
-- a bump is earned, never a standing cooldown. Also reconciled by
-- revertMesoSessionBoosts on session delete and remapMesoStateExId on an
-- exercise-swap re-key, alongside weight_boosts/rep_miss_counts/etc.
ALTER TABLE zane_meso_states ADD COLUMN weight_boost_declines jsonb NOT NULL DEFAULT '{}';

-- sync_meso_states_batch (migration 0122, extended in 0130/0138/0165/0169/0172)
-- must carry the new column. Same (jsonb) signature, so CREATE OR REPLACE
-- preserves the existing grants (see migration 0169) and no REVOKE/GRANT is
-- re-issued.
create or replace function public.sync_meso_states_batch(p_states jsonb)
 returns void
 language sql
 security invoker
 set search_path to 'public'
as $function$
  insert into zane_meso_states (
    id, user_id, schedule_id, weeks, start_date, start_cycle_index, started_at,
    deltas, joint_flags, pump_low_counts, weight_boosts, weight_boost_declines,
    growth_counts, rep_miss_counts, affinity, autoreg_state, completions,
    pending_meso2, updated_at
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
    coalesce(m->'weight_boost_declines', '{}'::jsonb),
    coalesce(m->'growth_counts', '{}'::jsonb),
    coalesce(m->'rep_miss_counts', '{}'::jsonb),
    coalesce(m->'affinity', '{}'::jsonb),
    nullif(m->'autoreg_state', 'null'::jsonb),
    coalesce((m->>'completions')::int, 0),
    coalesce((m->>'pending_meso2')::boolean, false),
    coalesce((m->>'updated_at')::timestamptz, now())
  from jsonb_array_elements(p_states) as m
  on conflict (id) do update set
    weeks                 = excluded.weeks,
    start_date            = excluded.start_date,
    start_cycle_index     = excluded.start_cycle_index,
    started_at            = coalesce(excluded.started_at, zane_meso_states.started_at),
    deltas                = excluded.deltas,
    joint_flags           = excluded.joint_flags,
    pump_low_counts       = excluded.pump_low_counts,
    weight_boosts         = excluded.weight_boosts,
    weight_boost_declines = excluded.weight_boost_declines,
    growth_counts         = excluded.growth_counts,
    rep_miss_counts       = excluded.rep_miss_counts,
    affinity              = excluded.affinity,
    autoreg_state         = coalesce(nullif(excluded.autoreg_state, 'null'::jsonb), zane_meso_states.autoreg_state),
    completions           = excluded.completions,
    pending_meso2         = excluded.pending_meso2,
    updated_at            = excluded.updated_at
  where zane_meso_states.updated_at < excluded.updated_at;
$function$;
