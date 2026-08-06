-- Daily log reminder: once per local day, after a user-set time, nudge when
-- today's weight is still unlogged (zane_daily_logs.weight is null for the
-- user's local date). Delivered through the existing web-push + Pushover
-- infrastructure (same path as the training/water/meal/medication reminders),
-- gated on push_enabled like every other push.
--   daily_log_reminder_enabled: the user's on/off switch (store dailyLogReminderEnabled).
--   daily_log_reminder_time: HH:MM in the user's local wall clock (store dailyLogReminderTime).
--   daily_log_reminder_last_date: server-written daily throttle (local date of the
--     last nudge, null = never). The client never maps or writes it, so it is
--     allowlisted in tools/check-backup-coverage.cjs, not in the backup.
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS daily_log_reminder_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS daily_log_reminder_time text NOT NULL DEFAULT '19:00';
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS daily_log_reminder_last_date text;

-- Fail-closed guard, same as migration 0230: the Vault-backed CRON_SECRET
-- must already exist before the cron job below references it by name,
-- otherwise the Authorization header would resolve to a JSON null and the
-- job would silently 401 forever.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret'
  ) THEN
    RAISE EXCEPTION
      'Vault secret "cron_shared_secret" is missing. Run vault.create_secret(...) with a fresh random value BEFORE applying this migration -- see the numbered manual steps at the top of 0230_cron_shared_secret_auth.sql.';
  END IF;
END $$;

-- Fire the daily-log-reminder edge function every 15 minutes. pg_cron + pg_net,
-- same pattern as the water reminder (migration 0182, auth re-keyed in 0230).
-- The function decides who is due and throttles per local day via
-- daily_log_reminder_last_date, so a frequent tick is cheap.
SELECT cron.schedule(
  'daily-log-reminder',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://ebbuvdzgstrhrcsbrlez.supabase.co/functions/v1/daily-log-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);
