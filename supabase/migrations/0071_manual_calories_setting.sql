-- Allow users to enter calories manually (e.g. for net-carb tracking)
-- instead of the default auto-calculation from macros (P×4 + C×4 + F×9).
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS manual_calories boolean NOT NULL DEFAULT false;
