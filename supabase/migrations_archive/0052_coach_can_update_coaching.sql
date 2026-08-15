-- Coach needs UPDATE on zane_coaching to set checkin_requested_at and checkin_enabled.
-- The existing "client can respond to invite" policy only covers client_id = auth.uid().
CREATE POLICY "coach can update coaching row"
  ON zane_coaching FOR UPDATE
  USING (coach_id = auth.uid());
