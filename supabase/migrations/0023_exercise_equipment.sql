ALTER TABLE zane_exercises
  ADD COLUMN IF NOT EXISTS equipment text;

ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS equipment_config jsonb;
