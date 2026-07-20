-- Water tracker: per-entry hydration log plus the tracker's per-user config.
-- Structurally mirrors zane_glucose_logs (migration 0101) and the bp/temp logs
-- (migration 0173): a dated log table with multiple entries per day, written
-- directly from the Water screen (no syncStore diff is required by the DB, but
-- the client keeps it as a synced store collection like cardio logs).
--
-- Each entry is one logged drink. category is null for plain water, 'other' for
-- named drinks (coffee, energy, whey, glasses, jug), or 'custom' for free entries.
-- The day's summed amount_ml is written back into zane_daily_logs.water_ml by the
-- client so the existing Health "Water" card and coaching hydration aggregate keep
-- working from one source of truth.
CREATE TABLE IF NOT EXISTS zane_water_logs (
  id         text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date       text NOT NULL,           -- YYYY-MM-DD (local day)
  time       text NOT NULL,           -- HH:MM (local time of the entry)
  amount_ml  integer NOT NULL,        -- always ml; convert for display only
  name       text,                    -- drink name (coffee, jug, custom label, ...)
  category   text,                    -- null = plain water | 'other' | 'custom'
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zane_water_logs_user_date
  ON zane_water_logs (user_id, date DESC, "time" DESC);

ALTER TABLE zane_water_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own water logs"
  ON zane_water_logs FOR ALL TO public
  USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
CREATE POLICY "coaches read client water logs"
  ON zane_water_logs FOR SELECT TO public
  USING (EXISTS ( SELECT 1 FROM zane_coaching zc
    WHERE zc.client_id = zane_water_logs.user_id
      AND zc.coach_id = (select auth.uid()) AND zc.coach_id <> zc.client_id AND zc.status = 'active' AND zc.id NOT LIKE 'support_%'));

-- Water tracker per-user config (mirrors the source app's single-row water_settings).
-- Goal and the daily start/end window drive the expected-vs-actual ramp; the bottle
-- counters are the "current bottle" gamification state (reset per day on the client).
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS water_goal_ml integer DEFAULT 2000;
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS water_start_time text DEFAULT '08:00';
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS water_end_time text DEFAULT '22:00';
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS water_bottles_today integer DEFAULT 0;
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS water_bottles_date text;
