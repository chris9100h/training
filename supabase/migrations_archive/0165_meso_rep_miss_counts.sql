-- Rep-target miss streak, per exercise: when a plan runs the autoregulation
-- engine (meso or unbounded autoregulate, weight-only mode included), missing
-- a working set's own rep target two sessions in a row now cuts that
-- exercise's weight by one increment for the next session -- the objective
-- counterpart to the existing subjective soreness/joint/volume signals, which
-- until now only ever held or grew weight, never reduced it based on actual
-- rep performance.
alter table public.zane_meso_states
  add column rep_miss_counts jsonb not null default '{}'::jsonb;

-- sync_meso_states_batch (migration 0122, extended in 0130/0138) must carry
-- the new column.
create or replace function public.sync_meso_states_batch(p_states jsonb)
 returns void
 language sql
 security invoker
 set search_path to 'public'
as $function$
  insert into zane_meso_states (
    id, user_id, schedule_id, weeks, start_date, start_cycle_index, started_at,
    deltas, joint_flags, pump_low_counts, weight_boosts, growth_counts,
    rep_miss_counts, completions, pending_meso2, updated_at
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
    completions       = excluded.completions,
    pending_meso2     = excluded.pending_meso2,
    updated_at        = excluded.updated_at
  where zane_meso_states.updated_at < excluded.updated_at;
$function$;
