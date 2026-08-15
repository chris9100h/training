-- Allow coaches to read their clients' glucose logs (consistent with cardio_logs / daily_logs RLS).
CREATE POLICY "coaches read client glucose logs"
  ON zane_glucose_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM zane_coaching zc
      WHERE zc.client_id = zane_glucose_logs.user_id
        AND zc.coach_id = auth.uid()
        AND zc.coach_id <> zc.client_id
        AND zc.status = 'active'
    )
  );
