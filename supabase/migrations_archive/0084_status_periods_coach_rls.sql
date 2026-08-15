-- Allow coaches to read their clients' status periods (for training adherence calculation).
CREATE POLICY "coaches read client status periods"
  ON zane_status_periods FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM zane_coaching zc
      WHERE zc.client_id = zane_status_periods.user_id
        AND zc.coach_id = auth.uid()
        AND zc.coach_id <> zc.client_id
        AND zc.status = 'active'
    )
  );
