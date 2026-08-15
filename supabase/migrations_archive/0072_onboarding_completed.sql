ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false;
