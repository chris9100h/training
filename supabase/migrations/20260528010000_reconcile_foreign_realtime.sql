-- Reconcile the two app-foreign device-event tables that were installed in
-- the SQL editor before migrations were tracked. Production publishes both
-- through supabase_realtime; clean branches need the same publication shape.
-- The guards keep this safe when a branch already contains either object.
DO $publication$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF to_regclass('public.motion_events') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = 'motion_events'
       ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.motion_events;
    END IF;
    IF to_regclass('public.door_events') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = 'door_events'
       ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.door_events;
    END IF;
  END IF;
END
$publication$;
