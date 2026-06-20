-- Flexible plans: a cycle variant whose position advances only when the user
-- trains (or skips), never by calendar date. sessions_per_week is the weekly
-- training-frequency goal, used as the adherence denominator for flex plans.
ALTER TABLE public.zane_schedules
  ADD COLUMN IF NOT EXISTS is_flex           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sessions_per_week integer;
