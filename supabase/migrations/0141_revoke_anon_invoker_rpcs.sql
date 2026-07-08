-- Live-audit follow-up to Migration 0132: that audit verified all
-- SECURITY DEFINER functions were locked for anon, but seven older
-- SECURITY INVOKER RPCs (created before 0132 removed the default-privileges
-- rule) still carried a direct anon EXECUTE grant, verified live via
-- has_function_privilege('anon', ...) = true.
--
-- Risk is low (SECURITY INVOKER + RLS: auth.uid() is NULL for anon, so reads
-- return nothing and writes fail on user_id), but the app never calls these
-- before login, so anon has no business executing them. Revoke both the
-- PUBLIC inheritance and the direct anon grant (a REVOKE FROM PUBLIC alone
-- does not remove a direct grant, see Migration 0132), keep authenticated.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.get_exercise_best_e1rm(uuid)',
    'public.get_exercise_history(text, text, int, uuid)',
    'public.get_user_volume_stats(uuid)',
    'public.get_session_stats(uuid)',
    'public.sync_sets_batch(jsonb)',
    'public.sync_daily_logs_batch(jsonb)',
    'public.sync_meso_states_batch(jsonb)'
  ]
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;

-- Verification (should return 7 rows, all false):
--   SELECT p.oid::regprocedure AS fn,
--          has_function_privilege('anon', p.oid, 'execute') AS anon_exec
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname IN (
--     'get_exercise_best_e1rm', 'get_exercise_history',
--     'get_user_volume_stats', 'get_session_stats', 'sync_sets_batch',
--     'sync_daily_logs_batch', 'sync_meso_states_batch');
