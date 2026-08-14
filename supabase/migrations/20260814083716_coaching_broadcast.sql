-- Replace the remaining app-owned Postgres Changes subscriptions with
-- content-free private Broadcast invalidations. door_events and motion_events
-- belong to another application and intentionally remain untouched.

ALTER TABLE public.zane_app_config
  ADD COLUMN IF NOT EXISTS coaching_transport text NOT NULL DEFAULT 'broadcast';

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.zane_app_config'::regclass
      AND conname = 'zane_app_config_coaching_transport_check'
  ) THEN
    ALTER TABLE public.zane_app_config
      ADD CONSTRAINT zane_app_config_coaching_transport_check
      CHECK (coaching_transport IN ('legacy', 'broadcast'));
  END IF;
END;
$constraint$;

CREATE OR REPLACE FUNCTION public.get_runtime_config()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
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
    'socialTransport', COALESCE(v_config.social_transport, 'broadcast'),
    'coachingTransport', COALESCE(v_config.coaching_transport, 'broadcast')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_coaching_transport(p_transport text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_transport text := lower(trim(COALESCE(p_transport, '')));
  v_table text;
BEGIN
  IF lower(COALESCE((SELECT auth.email()), '')) <> 'office@btc-prime.biz' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF v_transport NOT IN ('legacy', 'broadcast') THEN
    RAISE EXCEPTION 'Invalid coaching transport';
  END IF;

  -- A rollback must restore the publication before clients are told to use it.
  IF v_transport = 'legacy' THEN
    ALTER TABLE public.zane_coaching REPLICA IDENTITY FULL;
    FOREACH v_table IN ARRAY ARRAY[
      'zane_coaching',
      'zane_coaching_notes',
      'zane_user_settings',
      'zane_checkins'
    ]
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_publication_tables pt
        WHERE pt.pubname = 'supabase_realtime'
          AND pt.schemaname = 'public'
          AND pt.tablename = v_table
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.zane_app_config (id, coaching_transport)
  VALUES (1, v_transport)
  ON CONFLICT (id) DO UPDATE
  SET coaching_transport = EXCLUDED.coaching_transport;

  RETURN v_transport;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_runtime_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_runtime_config() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_coaching_transport(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_coaching_transport(text) TO authenticated;

DROP POLICY IF EXISTS "coaching users receive own invalidations" ON realtime.messages;
CREATE POLICY "coaching users receive own invalidations"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  extension = 'broadcast'
  AND (SELECT realtime.topic()) = 'coaching:user:' || (SELECT auth.uid())::text
);

CREATE OR REPLACE FUNCTION app_private.broadcast_coaching_user(
  p_user_id uuid,
  p_resource text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_user_id IS NULL OR p_resource NOT IN ('relationships', 'notes', 'support', 'status') THEN
    RETURN;
  END IF;

  BEGIN
    PERFORM realtime.send(
      jsonb_build_object('resource', p_resource),
      'coaching_invalidate',
      'coaching:user:' || p_user_id::text,
      true
    );
  EXCEPTION WHEN OTHERS THEN
    -- Realtime must never make the underlying coaching or training write fail.
    RAISE WARNING 'Coaching Broadcast invalidation failed for resource %', p_resource;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.broadcast_coaching_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_old jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  v_new jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN v_old ELSE v_new END;
  v_coaching public.zane_coaching%ROWTYPE;
  v_resource text;
  v_user_id uuid;
  v_coach_id uuid;
  v_client_id uuid;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'zane_coaching' THEN
      v_resource := CASE WHEN (v_row->>'id') LIKE 'support_%' THEN 'support' ELSE 'relationships' END;
      v_coach_id := (v_row->>'coach_id')::uuid;
      v_client_id := (v_row->>'client_id')::uuid;
      PERFORM app_private.broadcast_coaching_user(v_coach_id, v_resource);
      IF v_client_id IS DISTINCT FROM v_coach_id THEN
        PERFORM app_private.broadcast_coaching_user(v_client_id, v_resource);
      END IF;

      IF TG_OP = 'UPDATE' THEN
        IF (v_old->>'coach_id') IS DISTINCT FROM (v_new->>'coach_id')
           AND (v_old->>'coach_id')::uuid IS DISTINCT FROM v_client_id THEN
          PERFORM app_private.broadcast_coaching_user((v_old->>'coach_id')::uuid, v_resource);
        END IF;
        IF (v_old->>'client_id') IS DISTINCT FROM (v_new->>'client_id')
           AND (v_old->>'client_id')::uuid IS DISTINCT FROM v_coach_id THEN
          PERFORM app_private.broadcast_coaching_user((v_old->>'client_id')::uuid, v_resource);
        END IF;
      END IF;

    WHEN 'zane_coaching_notes' THEN
      SELECT * INTO v_coaching
      FROM public.zane_coaching c
      WHERE c.id = v_row->>'coaching_id';
      IF FOUND THEN
        v_resource := CASE WHEN v_coaching.id LIKE 'support_%' THEN 'support' ELSE 'notes' END;
        PERFORM app_private.broadcast_coaching_user(v_coaching.coach_id, v_resource);
        IF v_coaching.client_id IS DISTINCT FROM v_coaching.coach_id THEN
          PERFORM app_private.broadcast_coaching_user(v_coaching.client_id, v_resource);
        END IF;
      END IF;

    WHEN 'zane_user_settings' THEN
      IF (v_new->'in_progress_session_id') IS NOT DISTINCT FROM (v_old->'in_progress_session_id')
         AND (v_new->'status_mode') IS NOT DISTINCT FROM (v_old->'status_mode')
         AND (v_new->'status_mode_since') IS NOT DISTINCT FROM (v_old->'status_mode_since') THEN
        RETURN NEW;
      END IF;

      FOR v_user_id IN
        SELECT DISTINCT c.coach_id
        FROM public.zane_coaching c
        WHERE c.client_id = (v_new->>'user_id')::uuid
          AND c.coach_id <> c.client_id
          AND c.status = 'active'
          AND c.id NOT LIKE 'support_%'
      LOOP
        PERFORM app_private.broadcast_coaching_user(v_user_id, 'status');
      END LOOP;

    WHEN 'zane_checkins' THEN
      SELECT c.coach_id INTO v_user_id
      FROM public.zane_coaching c
      WHERE c.id = v_row->>'coaching_id'
        AND c.coach_id <> c.client_id
        AND c.status = 'active'
        AND c.id NOT LIKE 'support_%';
      IF FOUND THEN
        PERFORM app_private.broadcast_coaching_user(v_user_id, 'status');
      END IF;
  END CASE;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION app_private.broadcast_coaching_user(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION app_private.broadcast_coaching_change() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS zane_coaching_broadcast_invalidate ON public.zane_coaching;
CREATE TRIGGER zane_coaching_broadcast_invalidate
AFTER INSERT OR UPDATE OR DELETE ON public.zane_coaching
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_coaching_change();

DROP TRIGGER IF EXISTS zane_coaching_notes_broadcast_invalidate ON public.zane_coaching_notes;
CREATE TRIGGER zane_coaching_notes_broadcast_invalidate
AFTER INSERT OR UPDATE OR DELETE ON public.zane_coaching_notes
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_coaching_change();

DROP TRIGGER IF EXISTS zane_user_settings_coaching_broadcast_invalidate ON public.zane_user_settings;
CREATE TRIGGER zane_user_settings_coaching_broadcast_invalidate
AFTER UPDATE OF in_progress_session_id, status_mode, status_mode_since ON public.zane_user_settings
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_coaching_change();

DROP TRIGGER IF EXISTS zane_checkins_coaching_broadcast_invalidate ON public.zane_checkins;
CREATE TRIGGER zane_checkins_coaching_broadcast_invalidate
AFTER INSERT OR UPDATE ON public.zane_checkins
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_coaching_change();

-- The new client is deployed before this migration reaches production. Once
-- this transaction commits, all current clients select Broadcast from runtime
-- config and no app-owned table remains on Postgres Changes.
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
