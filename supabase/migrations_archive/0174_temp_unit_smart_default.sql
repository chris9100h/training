-- temp_unit (migration 0173) was added with `DEFAULT 'c'`, which backfilled
-- every existing user to an explicit 'c' the moment the column was created,
-- indistinguishable from someone who actually chose Celsius. The feature is
-- brand new (no user has knowingly picked a unit yet), so it is safe to reset
-- that auto-backfilled value back to NULL: the app now derives a sensible
-- default from the weight unit (lbs -> F, else C) whenever temp_unit is NULL,
-- and only a real Settings toggle sets it explicitly from here on.
ALTER TABLE zane_user_settings ALTER COLUMN temp_unit DROP DEFAULT;
UPDATE zane_user_settings SET temp_unit = NULL WHERE temp_unit = 'c';
