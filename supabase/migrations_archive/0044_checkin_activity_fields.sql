ALTER TABLE public.zane_checkins
  DROP COLUMN IF EXISTS cardio_avg_pace,
  ADD COLUMN IF NOT EXISTS cardio_pace_feeling int,
  ADD COLUMN IF NOT EXISTS cardio_effort int,
  ADD COLUMN IF NOT EXISTS performance_vs_last_week text;
