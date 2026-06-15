-- Net-carb tracking: optional fiber per daily log + a global net-carb toggle.
-- When net-carb mode is on and protein/carbs/fat/fiber are all present, the
-- Health tab computes calories as (protein + carbs - fiber)×4 + fat×9.
ALTER TABLE zane_daily_logs
  ADD COLUMN IF NOT EXISTS fiber integer;

ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS net_carbs boolean NOT NULL DEFAULT false;
