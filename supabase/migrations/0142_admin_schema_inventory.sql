-- Read-only schema inventory for the scheduled db-drift workflow
-- (tools/check-db-live.cjs, stage 2). Returns everything the drift check
-- needs in one call: all public columns, per-function anon EXECUTE
-- privileges, and the supabase_realtime publication members.
--
-- SECURITY DEFINER so the catalog reads work regardless of the caller;
-- internal/ops-only: no grant for authenticated (house rule for internal
-- functions), EXECUTE only for service_role. The workflow calls it via
-- PostgREST with the service_role key stored as a GitHub Actions secret.

CREATE OR REPLACE FUNCTION public.admin_schema_inventory()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'columns', (
      SELECT jsonb_agg(jsonb_build_object('t', table_name, 'c', column_name)
                       ORDER BY table_name, ordinal_position)
      FROM information_schema.columns
      WHERE table_schema = 'public'
    ),
    'functions', (
      SELECT jsonb_agg(jsonb_build_object(
               'f', p.proname,
               'sig', p.oid::regprocedure::text,
               'anon_exec', has_function_privilege('anon', p.oid, 'execute'),
               'definer', p.prosecdef)
             ORDER BY p.proname)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
    ),
    'realtime', (
      SELECT COALESCE(jsonb_agg(tablename ORDER BY tablename), '[]'::jsonb)
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.admin_schema_inventory() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_schema_inventory() TO service_role;

-- Verification (both must be false):
--   SELECT has_function_privilege('anon', 'public.admin_schema_inventory()', 'execute'),
--          has_function_privilege('authenticated', 'public.admin_schema_inventory()', 'execute');
