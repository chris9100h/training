CREATE POLICY "participants can delete notes"
  ON zane_coaching_notes
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM zane_coaching c
      WHERE c.id = zane_coaching_notes.coaching_id
        AND (c.coach_id = auth.uid() OR c.client_id = auth.uid())
    )
  );
