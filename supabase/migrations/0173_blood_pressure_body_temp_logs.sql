-- Blood pressure logs: multiple readings per day (systolic/diastolic, mmHg).
-- Structurally mirrors zane_glucose_logs (migration 0101): a dated log table,
-- written directly from the Health tab (no syncStore diff).
CREATE TABLE IF NOT EXISTS zane_blood_pressure_logs (
  id         text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date       text NOT NULL,           -- YYYY-MM-DD
  time       text NOT NULL,           -- HH:MM (local time of the reading)
  systolic   integer NOT NULL,
  diastolic  integer NOT NULL,
  note       text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zane_blood_pressure_logs_user_date
  ON zane_blood_pressure_logs (user_id, date DESC, "time" DESC);

ALTER TABLE zane_blood_pressure_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own blood pressure logs"
  ON zane_blood_pressure_logs FOR ALL TO public
  USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
CREATE POLICY "coaches read client blood pressure logs"
  ON zane_blood_pressure_logs FOR SELECT TO public
  USING (EXISTS ( SELECT 1 FROM zane_coaching zc
    WHERE zc.client_id = zane_blood_pressure_logs.user_id
      AND zc.coach_id = (select auth.uid()) AND zc.coach_id <> zc.client_id AND zc.status = 'active' AND zc.id NOT LIKE 'support_%'));

-- Body temperature logs: multiple readings per day, stored always in Celsius.
-- The display unit (C vs F) is a per-user setting (zane_user_settings.temp_unit),
-- same pattern as glucose_unit for zane_glucose_logs.
CREATE TABLE IF NOT EXISTS zane_body_temp_logs (
  id         text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date       text NOT NULL,
  time       text NOT NULL,
  value_c    numeric NOT NULL,
  note       text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zane_body_temp_logs_user_date
  ON zane_body_temp_logs (user_id, date DESC, "time" DESC);

ALTER TABLE zane_body_temp_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own body temp logs"
  ON zane_body_temp_logs FOR ALL TO public
  USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));
CREATE POLICY "coaches read client body temp logs"
  ON zane_body_temp_logs FOR SELECT TO public
  USING (EXISTS ( SELECT 1 FROM zane_coaching zc
    WHERE zc.client_id = zane_body_temp_logs.user_id
      AND zc.coach_id = (select auth.uid()) AND zc.coach_id <> zc.client_id AND zc.status = 'active' AND zc.id NOT LIKE 'support_%'));

-- Display unit preference for body temperature: 'c' or 'f'.
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS temp_unit text DEFAULT 'c';

-- Which Health-tab cards the user has hidden (array of card ids, e.g. ["cardio"]).
-- Unlike card ORDER (per-device localStorage), visibility is a real preference
-- expected to carry over across devices, so it lives here as a synced setting.
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS hidden_health_cards jsonb;
