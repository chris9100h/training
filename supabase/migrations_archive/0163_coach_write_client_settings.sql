-- zane_user_settings was the only coach-writable table (0032_coaching.sql)
-- that only ever got SELECT + UPDATE, never INSERT, unlike the full
-- SELECT/INSERT/UPDATE(/DELETE) triplet every sibling table (schedules,
-- exercises, sessions, entries, sets) got. That never mattered until now: a
-- coach activating a plan for a client (PlanViewerScreen's "Push to client")
-- writes active_schedule_id/cycle_index/cycle_start_date/week_plan_start_date
-- via syncStore's zane_user_settings upsert, and Postgres RLS requires an
-- INSERT policy for the ON CONFLICT DO UPDATE arm even though the row always
-- already exists (handle_new_user() creates it at signup) — without one,
-- upsert fails outright with "new row violates row-level security policy"
-- before it ever reaches the existing UPDATE policy.
create policy "coach can insert client settings"
  on zane_user_settings for insert
  with check (zane_is_coach_of(user_id));
