CREATE TABLE IF NOT EXISTS zane_status_periods (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('sick', 'vacation')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz
);

ALTER TABLE zane_status_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own status periods"
  ON zane_status_periods FOR ALL
  USING (user_id = auth.uid());
