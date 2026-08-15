-- Per-exercise affinity ("keeper, or would you swap it?"): a slow-moving
-- preference signal captured alongside the per-exercise joint/weight/pump
-- feedback. Stored per exId as { v: 'love'|'ok'|'dislike', streak: N }: `v` is
-- the sticky current value (pre-filled every session so it costs no taps in
-- steady state), `streak` counts consecutive 'dislike' confirms (reset by
-- love/ok) and drives the adherence swap suggestion at >= 2. It gates nothing,
-- it only feeds the swap hint, so a disliked-but-effective lift still earns its
-- weight. Not derived from any other column; carried in the user backup.
alter table public.zane_meso_states
  add column affinity jsonb not null default '{}'::jsonb;

-- sync_meso_states_batch (migration 0122, extended in 0130/0138/0165) must carry
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
    rep_miss_counts, affinity, completions, pending_meso2, updated_at
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
    completions       = excluded.completions,
    pending_meso2     = excluded.pending_meso2,
    updated_at        = excluded.updated_at
  where zane_meso_states.updated_at < excluded.updated_at;
$function$;
