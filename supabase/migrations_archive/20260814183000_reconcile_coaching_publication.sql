-- The runtime config already selects Broadcast, but a manual migration apply
-- left the old Coaching tables in Postgres Changes. Keep the publication and
-- the runtime transport consistent on fresh branches.
BEGIN;

DO $publication$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'zane_coaching',
    'zane_coaching_notes',
    'zane_user_settings',
    'zane_checkins'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_publication_tables pt
      WHERE pt.pubname = 'supabase_realtime'
        AND pt.schemaname = 'public'
        AND pt.tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', v_table);
    END IF;
  END LOOP;
END;
$publication$;

ALTER TABLE public.zane_coaching REPLICA IDENTITY DEFAULT;

COMMIT;
