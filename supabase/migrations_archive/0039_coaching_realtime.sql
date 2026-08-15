-- Enable Realtime on zane_coaching so clients receive live invite notifications.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'zane_coaching'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE zane_coaching;
  END IF;
END;
$$;
