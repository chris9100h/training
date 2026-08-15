-- Configurable mesocycle RIR taper: start (week 1) and end (peak week) RIR.
-- Previously hardcoded to 3 → 0. Now the user can pick both endpoints:
--   start_rir: 0..3  (default 3 — the classic submaximal start)
--   end_rir:  -3..0  (default 0 — to-failure peak; negative = beyond failure)
-- A negative end drives auto-prescribed lengthened partials during training
-- (|RIR| partials per working set) — an advanced, opt-in "beyond failure" block.
-- Nullable with an app-side fallback (3 / 0) so every existing meso plan keeps
-- its current 3 → 0 behavior untouched.
ALTER TABLE zane_schedules
  ADD COLUMN IF NOT EXISTS mesocycle_start_rir int,
  ADD COLUMN IF NOT EXISTS mesocycle_end_rir   int;
