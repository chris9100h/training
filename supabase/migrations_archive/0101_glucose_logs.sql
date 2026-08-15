-- Blood glucose logs: multiple readings per day, stored always in mmol/L.
-- The display unit (mmol vs mg/dL) is a per-user setting in zane_user_settings.
CREATE TABLE IF NOT EXISTS zane_glucose_logs (
  id          text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  date        text NOT NULL,           -- YYYY-MM-DD
  time        text NOT NULL,           -- HH:MM (local time of the reading)
  value_mmol  numeric NOT NULL,        -- always mmol/L; convert for display only
  context     text NOT NULL DEFAULT 'other', -- fasted | fed | other
  note        text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zane_glucose_logs_user_date
  ON zane_glucose_logs (user_id, date DESC, time DESC);

ALTER TABLE zane_glucose_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own glucose logs"
  ON zane_glucose_logs FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Display unit preference: 'mmol' (mmol/L) or 'mgdl' (mg/dL)
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS glucose_unit text DEFAULT 'mmol';
