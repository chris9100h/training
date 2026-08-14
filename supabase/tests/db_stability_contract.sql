-- Run against the synthetic Preview database after all stability
-- migrations. Every failed contract raises and stops the rollout.

DO $test$
DECLARE
  v_count integer;
  v_expected integer;
BEGIN
  IF has_function_privilege('anon', 'public.get_runtime_config()', 'execute') THEN
    RAISE EXCEPTION 'anon can execute get_runtime_config';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_runtime_config()', 'execute') THEN
    RAISE EXCEPTION 'authenticated cannot execute get_runtime_config';
  END IF;
  IF has_function_privilege('anon', 'public.admin_set_social_transport(text)', 'execute') THEN
    RAISE EXCEPTION 'anon can execute admin_set_social_transport';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_set_social_transport(text)', 'execute') THEN
    RAISE EXCEPTION 'authenticated cannot execute admin_set_social_transport';
  END IF;
  IF position(
    'v_config.social_transport'
    IN pg_get_functiondef('public.get_runtime_config()'::regprocedure)
  ) = 0 THEN
    RAISE EXCEPTION 'get_runtime_config does not use the global Social transport';
  END IF;
  IF position(
    'zane_feature_grants'
    IN pg_get_functiondef('public.get_runtime_config()'::regprocedure)
  ) > 0 THEN
    RAISE EXCEPTION 'get_runtime_config still depends on per-user Broadcast grants';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'zane_app_config'
      AND column_name = 'social_transport'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'zane_app_config.social_transport is missing or nullable';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.zane_app_config
    WHERE social_transport NOT IN ('legacy', 'broadcast')
  ) THEN
    RAISE EXCEPTION 'zane_app_config contains an invalid Social transport';
  END IF;
  IF has_function_privilege('anon', 'public.admin_set_coaching_transport(text)', 'execute') THEN
    RAISE EXCEPTION 'anon can execute admin_set_coaching_transport';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_set_coaching_transport(text)', 'execute') THEN
    RAISE EXCEPTION 'authenticated cannot execute admin_set_coaching_transport';
  END IF;
  IF position(
    'v_config.coaching_transport'
    IN pg_get_functiondef('public.get_runtime_config()'::regprocedure)
  ) = 0 THEN
    RAISE EXCEPTION 'get_runtime_config does not use the global Coaching transport';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'zane_app_config'
      AND column_name = 'coaching_transport'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'zane_app_config.coaching_transport is missing or nullable';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.zane_app_config
    WHERE coaching_transport NOT IN ('legacy', 'broadcast')
  ) THEN
    RAISE EXCEPTION 'zane_app_config contains an invalid Coaching transport';
  END IF;
  IF has_function_privilege('anon', 'public.social_get_badge()', 'execute') THEN
    RAISE EXCEPTION 'anon can execute social_get_badge';
  END IF;
  IF has_function_privilege('authenticated', 'public.db_health()', 'execute') THEN
    RAISE EXCEPTION 'authenticated can execute db_health';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.db_health()', 'execute') THEN
    RAISE EXCEPTION 'service_role cannot execute db_health';
  END IF;
  IF position(
    'backend_type = ''client backend'''
    IN pg_get_functiondef('public.db_health()'::regprocedure)
  ) = 0 THEN
    RAISE EXCEPTION 'db_health does not exclude infrastructure backends';
  END IF;
  IF has_function_privilege('authenticated', 'public.social_health_metric_value(uuid, text, date, date)', 'execute') THEN
    RAISE EXCEPTION 'authenticated can execute internal health metric helper';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_session_stats';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'get_session_stats overload count is %, expected 1', v_count;
  END IF;

  IF to_regclass('public.zane_sets_user_entry_idx') IS NULL THEN
    RAISE EXCEPTION 'zane_sets_user_entry_idx is missing';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'realtime'
    AND tablename = 'messages'
    AND policyname = 'social users receive own invalidations';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'private Social Broadcast policy is missing';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'realtime'
    AND tablename = 'messages'
    AND policyname = 'coaching users receive own invalidations';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'private Coaching Broadcast policy is missing';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND t.tgname = 'zane_social_broadcast_invalidate'
    AND NOT t.tgisinternal;
  IF v_count <> 11 THEN
    RAISE EXCEPTION 'Social Broadcast trigger count is %, expected 11', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND t.tgname = ANY(ARRAY[
      'zane_coaching_broadcast_invalidate',
      'zane_coaching_notes_broadcast_invalidate',
      'zane_user_settings_coaching_broadcast_invalidate',
      'zane_checkins_coaching_broadcast_invalidate'
    ])
    AND NOT t.tgisinternal;
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'Coaching Broadcast trigger count is %, expected 4', v_count;
  END IF;
  IF has_function_privilege('authenticated', 'app_private.broadcast_coaching_user(uuid, text)', 'execute')
     OR has_function_privilege('service_role', 'app_private.broadcast_coaching_user(uuid, text)', 'execute') THEN
    RAISE EXCEPTION 'internal Coaching Broadcast sender is directly executable';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = ANY(ARRAY[
      'zane_coaching',
      'zane_coaching_notes',
      'zane_user_settings',
      'zane_checkins'
    ]);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Postgres Changes still contains % app-owned Coaching tables', v_count;
  END IF;
  IF (SELECT relreplident FROM pg_class WHERE oid = 'public.zane_coaching'::regclass) <> 'd' THEN
    RAISE EXCEPTION 'zane_coaching replica identity is not DEFAULT';
  END IF;

  SELECT count(*) INTO v_expected
  FROM unnest(ARRAY['door_events', 'motion_events']) AS foreign_table(name)
  WHERE to_regclass('public.' || foreign_table.name) IS NOT NULL;

  SELECT count(*) INTO v_count
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = ANY(ARRAY['door_events', 'motion_events']);
  IF v_count <> v_expected THEN
    RAISE EXCEPTION 'App-foreign Realtime table count is %, expected %', v_count, v_expected;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = ANY(ARRAY[
      'zane_social_friendships',
      'zane_social_groups',
      'zane_social_group_members',
      'zane_social_messages',
      'zane_social_message_attachments',
      'zane_social_plan_shares',
      'zane_social_message_reads',
      'zane_social_plan_share_imports',
      'zane_social_workout_comments'
    ]);
  IF v_count <> 9 THEN
    RAISE EXCEPTION 'Rollback publication has % Social tables, expected 9', v_count;
  END IF;
END;
$test$;

SELECT public.db_health();

-- Query-plan acceptance uses synthetic UUIDs that own enough history:
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM public.get_exercise_best_e1rm('<user-id>'::uuid);
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM public.get_session_stats('<user-id>'::uuid, current_date - 70);
