-- Cardio quick-log table.
-- distance_m is stored in meters; clients convert for display.
-- pace_feeling: 1–6 (Stroll → Run), effort: 1–10.

CREATE TABLE IF NOT EXISTS zane_cardio_logs (
  id               text        PRIMARY KEY,
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date             text        NOT NULL,    -- YYYY-MM-DD (local calendar date)
  type             text,                    -- free-text activity type, e.g. "Running"
  duration_minutes int         NOT NULL,
  distance_m       numeric,
  pace_feeling     int         CHECK (pace_feeling BETWEEN 1 AND 6),
  effort           int         CHECK (effort BETWEEN 1 AND 10),
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE zane_cardio_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own cardio logs"
  ON zane_cardio_logs FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
