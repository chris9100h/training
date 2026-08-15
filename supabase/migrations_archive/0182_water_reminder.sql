-- Water reminder push: server-side "you are behind your hydration goal" nudges,
-- delivered through the existing web-push + Pushover infrastructure (same path
-- as the training reminder, migration 0027/0028). Enabled per user, independent
-- of the training reminder, and gated on push_enabled like every other push.
--   water_reminder_enabled: the user's on/off switch (store waterReminderEnabled).
--   water_last_push_at: throttle so at most one nudge per cooldown window.
--   tz_offset_minutes: the user's UTC offset in minutes, written by the client
--     (store tzOffsetMinutes), so the cron can place "now" on the local
--     start/end ramp without having to guess a timezone.
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS water_reminder_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS water_last_push_at timestamptz;
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS tz_offset_minutes integer;

-- Fire the water-reminder edge function every 15 minutes. pg_cron + pg_net,
-- same pattern as the training reminder (migration 0028). The function decides
-- who is behind their ramp and throttles via water_last_push_at, so a frequent
-- tick is cheap. pg_cron must be enabled (Dashboard, Database, Extensions).
SELECT cron.schedule(
  'water-reminder',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://ebbuvdzgstrhrcsbrlez.supabase.co/functions/v1/water-reminder',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
