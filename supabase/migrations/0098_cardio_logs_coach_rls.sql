-- Allow coaches to read their clients' cardio logs (consistent with daily_logs RLS).
CREATE POLICY "coaches read client cardio logs"
  ON zane_cardio_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM zane_coaching zc
      WHERE zc.client_id = zane_cardio_logs.user_id
        AND zc.coach_id = auth.uid()
        AND zc.coach_id <> zc.client_id
        AND zc.status = 'active'
    )
  );
