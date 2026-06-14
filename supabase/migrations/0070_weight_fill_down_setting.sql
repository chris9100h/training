-- Add weight_fill_down setting (default true = fill down enabled, existing behaviour)
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS weight_fill_down boolean NOT NULL DEFAULT true;
