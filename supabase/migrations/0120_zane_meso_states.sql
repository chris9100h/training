-- Mesocycle state per user per plan.
-- Replaces the per-device logbook-meso-state localStorage key so meso progress
-- (set deltas, joint flags, pump counts, weight boosts, completion count) is
-- synced across all devices. One row per (user, schedule), upserted on id.
-- id = user_id || '_' || schedule_id for deterministic upserts without a prior lookup.

create table zane_meso_states (
  id                 text        primary key,
  user_id            uuid        not null references auth.users on delete cascade,
  schedule_id        text        not null,
  weeks              int         not null,
  start_date         text        not null,
  start_cycle_index  int         not null default 0,
  deltas             jsonb       not null default '{}',
  joint_flags        jsonb       not null default '{}',
  pump_low_counts    jsonb       not null default '{}',
  weight_boosts      jsonb       not null default '{}',
  completions        int         not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table zane_meso_states enable row level security;

create policy "Users manage own meso states"
  on zane_meso_states for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
