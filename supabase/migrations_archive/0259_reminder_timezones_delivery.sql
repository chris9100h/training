-- Reminder reliability: store the user's IANA zone so server-side wall-clock
-- calculations survive DST and travel. Keep tz_offset_minutes as a fallback
-- for older clients/rows until every client has written its zone.
ALTER TABLE public.zane_user_settings
  ADD COLUMN IF NOT EXISTS time_zone text;

COMMENT ON COLUMN public.zane_user_settings.time_zone IS
  'IANA time-zone name supplied by the client, e.g. Europe/Vienna; used by reminder crons with tz_offset_minutes as fallback.';

-- A meal reminder is a per-food-log event, not a per-user event. The ledger
-- makes a failed provider call retryable without sending a successfully
-- delivered reminder again on the next hourly cron tick. It is deliberately
-- service-role-only and excluded from user backups because it is derived
-- delivery state, not user content.
CREATE TABLE IF NOT EXISTS public.zane_meal_reminder_deliveries (
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_log_id    text NOT NULL,
  last_attempt_at timestamptz,
  delivered_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, food_log_id)
);

CREATE INDEX IF NOT EXISTS zane_meal_reminder_deliveries_user_idx
  ON public.zane_meal_reminder_deliveries (user_id, delivered_at);

ALTER TABLE public.zane_meal_reminder_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zane_meal_reminder_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.zane_meal_reminder_deliveries TO service_role;
