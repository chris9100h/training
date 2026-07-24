-- Plan Mode meal-template auto-fill marker. One row per (user, date) once the
-- template has been auto-materialized for that day, so a day is filled exactly
-- once ACROSS DEVICES (previously a per-device localStorage flag), and deleting
-- an auto-planned entry never brings it back on any device. id is deterministic
-- (`<user_id>_<date>`) so two devices marking the same day upsert the same row
-- instead of racing in duplicates. Derived device state, not user content: it
-- is synced but deliberately kept out of the personal-data backup.

CREATE TABLE IF NOT EXISTS public.zane_food_template_days (
  id         text        PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date       text        NOT NULL,             -- YYYY-MM-DD, the day auto-filled
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zane_food_template_days_user_idx
  ON public.zane_food_template_days USING btree (user_id, date);

ALTER TABLE public.zane_food_template_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zane_food_template_days_own"
  ON public.zane_food_template_days FOR ALL
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
