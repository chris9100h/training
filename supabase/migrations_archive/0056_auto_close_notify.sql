-- Stores pending auto-close notification for the user's next app start.
-- Cleared by the app after display (write-once by edge function, read-once by app).
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS auto_close_notify jsonb DEFAULT NULL;
