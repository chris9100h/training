-- Plan edit drafts for multi-device autosave.
--
-- The plan editor (ScheduleEditScreen) holds all in-progress edits in a local
-- React `draft` and only writes them to zane_schedules on an explicit Save.
-- Until then the work lives nowhere durable: an app kill, a closed tab or a
-- device switch loses it (exactly the reported data-loss).
--
-- This table holds the in-progress draft, synced across devices, DECOUPLED from
-- the committed plan on purpose:
--   * a frequent (debounced) autosave writes only this small row, never the
--     large zane_schedules row, and can never touch/clobber the committed
--     days/versions (different table);
--   * it stays out of the zane_schedules boot-merge entirely, so a schedule
--     merge quirk can't drop the draft and a draft write can't corrupt a plan;
--   * simple last-write-wins over updated_at, cleaned up (row deleted) the
--     moment the editor Saves or Discards.
--
-- One draft per (user, plan). Transient in-progress state, deliberately NOT in
-- user backups. No FK to zane_schedules so the two stay independent; the app
-- deletes a plan's draft row when the plan itself is deleted.
create table if not exists zane_plan_drafts (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  schedule_id text        not null,
  draft       jsonb       not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, schedule_id)
);

alter table zane_plan_drafts enable row level security;

-- Owner-only: a user reads and writes only their own drafts. `to authenticated`
-- keeps anon out entirely (anon has no auth.uid()).
create policy "plan drafts owner" on zane_plan_drafts
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on zane_plan_drafts to authenticated;
