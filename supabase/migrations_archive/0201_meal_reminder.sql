-- Meal reminder push (Plan Mode): server-side "you haven't logged your planned
-- meal yet" nudges, delivered through the existing web-push + Pushover path
-- (same as the training/water reminders, migrations 0027/0028 and 0182).
-- Enabled per user, gated on plan_mode and push_enabled by the edge function.
--   meal_reminder_enabled: the user's on/off switch (store mealReminderEnabled).
-- No throttle column is needed: the function fires each meal exactly once, on the
-- cron tick where "now" first crosses (planned time + 1h), reusing the already
-- present tz_offset_minutes (migration 0182) to work in the user's local clock.
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS meal_reminder_enabled boolean NOT NULL DEFAULT false;

-- Fire the meal-reminder edge function hourly. pg_cron + pg_net, same pattern as
-- the water reminder (migration 0182) but at an hourly cadence: planned meals sit
-- on the hour (a template slot's time is always HH:00), so an hourly tick catches
-- an on-the-hour meal exactly at its +1h grace point. The function's fire-once
-- window is widened to match this 1h cadence.
SELECT cron.schedule(
  'meal-reminder',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://ebbuvdzgstrhrcsbrlez.supabase.co/functions/v1/meal-reminder',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
