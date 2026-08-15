-- The weekly drift check could only see HALF of the grant problem this project
-- keeps having. admin_schema_inventory reports anon_exec per function, so the
-- check catches a function that leaked to anon, and nothing at all about
-- `authenticated`.
--
-- That is the half that actually regressed. An ALTER DEFAULT PRIVILEGES rule
-- still hands EXECUTE straight to `authenticated` on every new function (see
-- docs/database.md, "Grant-Fallen"): migration 0132 removed the equivalent anon
-- rule and left this one standing, and 0208 had to revoke it by hand from
-- bump_api_usage after 0207 shipped believing a service_role grant was enough.
-- Every service-role-only function written since is one forgotten REVOKE away
-- from the same regression, with no signal anywhere.
--
-- Adding the column here lets check-db-live.cjs hold a small list of functions
-- that must never be callable by a logged-in user, and go red when one is. The
-- payload gains one boolean per function and nothing else changes.
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
               'authenticated_exec', has_function_privilege('authenticated', p.oid, 'execute'),
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

-- CREATE OR REPLACE keeps the existing grants, but restate them so this file
-- stands on its own and so the default-privileges rule described above cannot
-- quietly re-grant EXECUTE to authenticated on the replaced function.
REVOKE EXECUTE ON FUNCTION public.admin_schema_inventory() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_schema_inventory() TO service_role;

-- Verification (both must be false):
--   SELECT has_function_privilege('anon', 'public.admin_schema_inventory()', 'execute'),
--          has_function_privilege('authenticated', 'public.admin_schema_inventory()', 'execute');
