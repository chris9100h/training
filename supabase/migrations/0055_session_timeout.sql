-- Session auto-close timeout setting per user (minutes, default 90)
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS session_timeout_minutes int DEFAULT 90;
