-- Add week_plan_start_date to zane_user_settings for sequential week numbering.

ALTER TABLE public.zane_user_settings
  ADD COLUMN IF NOT EXISTS week_plan_start_date date;
