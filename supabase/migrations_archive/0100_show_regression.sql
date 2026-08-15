ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS show_regression boolean NOT NULL DEFAULT true;
