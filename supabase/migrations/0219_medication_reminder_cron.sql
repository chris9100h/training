-- Medication reminder push: "you haven't logged a scheduled dose yet" nudges,
-- same fire-once-via-window mechanism as the meal reminder (migration 0201):
-- schedule slots sit on the hour (zane_medication_schedule_slots.hour, 0-23),
-- so an hourly cron tick catches an on-the-hour dose exactly at its +1h grace
-- point with no throttle column needed. Gated on meds_enabled (the feature's
-- own master switch) the same way the meal reminder gates on plan_mode:
-- turning Medications off silently stops the nudges too.
SELECT cron.schedule(
  'medication-reminder',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://ebbuvdzgstrhrcsbrlez.supabase.co/functions/v1/medication-reminder',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
