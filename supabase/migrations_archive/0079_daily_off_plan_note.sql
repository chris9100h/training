-- Off-plan note in the daily log: client can note what they ate off-plan each
-- day; dailyLogsWeekPrefill accumulates them (date-prefixed) into off_plan_notes
-- for the weekly check-in.
ALTER TABLE public.zane_daily_logs
  ADD COLUMN IF NOT EXISTS off_plan_note text DEFAULT NULL;
