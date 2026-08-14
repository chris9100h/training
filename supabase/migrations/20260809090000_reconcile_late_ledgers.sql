-- Late SQL-editor changes required by the reminder functions and by the
-- current client payloads.  These are all additive and therefore safe against
-- the already reconciled production schema.
ALTER TABLE public.zane_sets
  ADD COLUMN IF NOT EXISTS added_kg numeric,
  ADD COLUMN IF NOT EXISTS horn_loads jsonb;

ALTER TABLE public.zane_medication_logs
  ADD COLUMN IF NOT EXISTS skipped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;

ALTER TABLE public.zane_user_settings
  ADD COLUMN IF NOT EXISTS time_zone text,
  ADD COLUMN IF NOT EXISTS meal_categories jsonb;

CREATE TABLE IF NOT EXISTS public.zane_meal_reminder_deliveries (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_log_id text NOT NULL,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, food_log_id)
);
CREATE INDEX IF NOT EXISTS zane_meal_reminder_deliveries_user_idx
  ON public.zane_meal_reminder_deliveries (user_id, delivered_at);
ALTER TABLE public.zane_meal_reminder_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zane_meal_reminder_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.zane_meal_reminder_deliveries TO service_role;
