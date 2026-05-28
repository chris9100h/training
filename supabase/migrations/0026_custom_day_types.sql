ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS custom_day_types text[] NOT NULL DEFAULT '{}';
