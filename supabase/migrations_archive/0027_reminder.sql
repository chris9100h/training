ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS reminder_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_time text NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS next_reminder_at timestamptz;
