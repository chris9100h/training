-- Coach-level default check-in schema stored in user settings.
-- null = fall back to CHECKIN_DEFAULT_SCHEMA in the app.
ALTER TABLE zane_user_settings ADD COLUMN IF NOT EXISTS default_checkin_schema jsonb;
