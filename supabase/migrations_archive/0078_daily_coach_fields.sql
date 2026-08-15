-- Daily coach fields: coaches can mark numeric check-in fields as "track daily
-- in health log", which adds them to the client's daily log form and aggregates
-- them (avg or sum) into the weekly check-in prefill.
ALTER TABLE public.zane_daily_logs
  ADD COLUMN IF NOT EXISTS daily_coach_fields jsonb DEFAULT NULL;
