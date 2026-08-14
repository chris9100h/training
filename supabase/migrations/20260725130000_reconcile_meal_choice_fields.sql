-- The two meal-of-choice columns were installed in the SQL editor.  This row
-- follows the recorded migration that creates meal_of_choice and precedes the
-- recorded hour/function updates.
ALTER TABLE public.zane_daily_logs
  ADD COLUMN IF NOT EXISTS meal_of_choice boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS meal_of_choice_hour smallint;

ALTER TABLE public.zane_checkins
  ADD COLUMN IF NOT EXISTS ai_opinion text,
  ADD COLUMN IF NOT EXISTS ai_opinion_generated_at timestamptz;
