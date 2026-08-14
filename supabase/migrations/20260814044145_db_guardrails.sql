-- Stage 1: runtime isolation, emergency controls and database health probes.

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;

ALTER TABLE public.zane_app_config
  ADD COLUMN IF NOT EXISTS social_mode text NOT NULL DEFAULT 'normal'
  CONSTRAINT zane_app_config_social_mode_check
  CHECK (social_mode IN ('normal', 'maintenance'));

INSERT INTO public.zane_app_config (id, social_mode)
VALUES (1, 'normal')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION app_private.social_available()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT (SELECT auth.uid()) IS NOT NULL
     AND COALESCE((
       SELECT c.social_mode = 'normal'
       FROM public.zane_app_config c
       WHERE c.id = 1
     ), true);
$function$;

CREATE OR REPLACE FUNCTION app_private.require_social_available()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT app_private.social_available() THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Friends is temporarily under maintenance';
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION app_private.social_available() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.social_available() TO authenticated;
REVOKE EXECUTE ON FUNCTION app_private.require_social_available() FROM PUBLIC, anon, authenticated, service_role;

-- A restrictive policy is ANDed with every existing permissive policy. This
-- keeps all current ownership and relationship checks intact while providing
-- one cheap global emergency brake.
DO $policies$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'zane_social_profiles',
    'zane_social_friendships',
    'zane_social_blocks',
    'zane_social_groups',
    'zane_social_group_members',
    'zane_social_messages',
    'zane_social_message_attachments',
    'zane_social_message_reads',
    'zane_social_plan_shares',
    'zane_social_plan_share_imports',
    'zane_social_reports',
    'zane_social_workout_comments'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "social runtime gate" ON public.%I', v_table);
    EXECUTE format(
      'CREATE POLICY "social runtime gate" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT app_private.social_available())) WITH CHECK ((SELECT app_private.social_available()))',
      v_table
    );
  END LOOP;
END;
$policies$;

DROP POLICY IF EXISTS "social attachment runtime gate" ON storage.objects;
CREATE POLICY "social attachment runtime gate" ON storage.objects
AS RESTRICTIVE
FOR ALL TO authenticated
USING (
  bucket_id <> 'social-chat-attachments'
  OR (SELECT app_private.social_available())
)
WITH CHECK (
  bucket_id <> 'social-chat-attachments'
  OR (SELECT app_private.social_available())
);

CREATE OR REPLACE FUNCTION public.get_runtime_config()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_email text := lower(COALESCE((SELECT auth.email()), ''));
  v_config public.zane_app_config%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_config
  FROM public.zane_app_config
  WHERE id = 1;

  RETURN jsonb_build_object(
    'forceUpdateNonce', v_config.force_update_nonce,
    'socialMode', COALESCE(v_config.social_mode, 'normal'),
    'socialTransport', CASE WHEN EXISTS (
      SELECT 1
      FROM public.zane_feature_grants fg
      WHERE fg.feature = 'social_broadcast_canary'
        AND lower(fg.email) = v_email
    ) THEN 'broadcast' ELSE 'legacy' END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_social_mode(p_mode text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_mode text := lower(trim(COALESCE(p_mode, '')));
BEGIN
  IF lower(COALESCE((SELECT auth.email()), '')) <> 'office@btc-prime.biz' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF v_mode NOT IN ('normal', 'maintenance') THEN
    RAISE EXCEPTION 'Invalid social mode';
  END IF;

  INSERT INTO public.zane_app_config (id, social_mode)
  VALUES (1, v_mode)
  ON CONFLICT (id) DO UPDATE SET social_mode = EXCLUDED.social_mode;
  RETURN v_mode;
END;
$function$;

CREATE OR REPLACE FUNCTION public.db_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_connections integer;
  v_max_connections integer := current_setting('max_connections')::integer;
  v_waiting integer;
  v_long_running integer;
  v_net_response_bytes bigint := 0;
  v_critical boolean;
BEGIN
  SELECT count(*)::integer
    INTO v_connections
  FROM pg_catalog.pg_stat_activity
  WHERE datname = current_database();

  SELECT count(*)::integer
    INTO v_waiting
  FROM pg_catalog.pg_stat_activity
  WHERE datname = current_database()
    AND pid <> pg_backend_pid()
    AND state = 'active'
    AND wait_event_type IS NOT NULL;

  SELECT count(*)::integer
    INTO v_long_running
  FROM pg_catalog.pg_stat_activity
  WHERE datname = current_database()
    AND pid <> pg_backend_pid()
    AND state = 'active'
    AND query_start < clock_timestamp() - interval '5 seconds';

  IF to_regclass('net._http_response') IS NOT NULL THEN
    v_net_response_bytes := pg_catalog.pg_total_relation_size('net._http_response'::regclass);
  END IF;

  v_critical := v_connections >= 45 OR v_waiting > 0 OR v_long_running > 0;

  RETURN jsonb_build_object(
    'ok', NOT v_critical,
    'checkedAt', clock_timestamp(),
    'connections', v_connections,
    'maxConnections', v_max_connections,
    'connectionRatio', round(v_connections::numeric / GREATEST(v_max_connections, 1), 4),
    'waitingQueries', v_waiting,
    'longRunningQueries', v_long_running,
    'pgNetResponseBytes', v_net_response_bytes
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_runtime_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_runtime_config() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_social_mode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_social_mode(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.db_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.db_health() TO service_role;

-- pg_net already expires responses internally. Its ttl is a SIGHUP-level
-- Supabase setting and cannot be changed inside a transactional migration.
-- Apply it separately with postgres-config during rollout, then verify with
-- SHOW "pg_net.ttl". Remove only the redundant hand-made cleanup job here.

DO $cron$
DECLARE
  v_job_id bigint;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    SELECT jobid INTO v_job_id
    FROM cron.job
    WHERE jobname = 'cleanup-net-http-response'
    LIMIT 1;

    IF v_job_id IS NOT NULL THEN
      EXECUTE 'SELECT cron.unschedule($1)' USING v_job_id;
    END IF;
  END IF;
END;
$cron$;
