-- Make zane_user_settings.unit nullable so NULL means "not yet chosen".
-- NULL → unit-picker modal fires on next load.
-- 'kg' / 'lbs' → never ask again.
-- Existing rows keep their current value ('kg' or 'lbs') untouched.
ALTER TABLE public.zane_user_settings
  ALTER COLUMN unit DROP NOT NULL,
  ALTER COLUMN unit SET DEFAULT NULL;
