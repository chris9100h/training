ALTER TABLE zane_exercises
  ADD COLUMN IF NOT EXISTS equipment text;

ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS smart_progression boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS progression_range_top int DEFAULT 4,
  ADD COLUMN IF NOT EXISTS equipment_config jsonb;
