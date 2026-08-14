-- Stage 3: emit content-free invalidations to one private topic per user.
-- Postgres Changes remains active during the canary and is removed only by
-- the documented finalization step after production observation.

CREATE OR REPLACE FUNCTION public.admin_set_social_broadcast_canary(
  p_email text,
  p_enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_email text := lower(trim(COALESCE(p_email, '')));
BEGIN
  IF lower(COALESCE((SELECT auth.email()), '')) <> 'office@btc-prime.biz' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF v_email = '' THEN RAISE EXCEPTION 'Email required'; END IF;

  IF COALESCE(p_enabled, false) THEN
    INSERT INTO public.zane_feature_grants (feature, email)
    VALUES ('social_broadcast_canary', v_email)
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.zane_feature_grants
    WHERE feature = 'social_broadcast_canary' AND lower(email) = v_email;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_set_social_broadcast_canary(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_social_broadcast_canary(text, boolean) TO authenticated;

DROP POLICY IF EXISTS "social users receive own invalidations" ON realtime.messages;
CREATE POLICY "social users receive own invalidations"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  extension = 'broadcast'
  AND (SELECT realtime.topic()) = 'social:user:' || (SELECT auth.uid())::text
);

CREATE OR REPLACE FUNCTION app_private.broadcast_social_user(
  p_user_id uuid,
  p_resource text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_user_id IS NULL OR p_resource IS NULL THEN RETURN; END IF;
  IF COALESCE((
    SELECT c.social_mode = 'normal'
    FROM public.zane_app_config c
    WHERE c.id = 1
  ), true) THEN
    PERFORM realtime.send(
      jsonb_build_object('resource', p_resource),
      'social_invalidate',
      'social:user:' || p_user_id::text,
      true
    );
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.broadcast_social_group(
  p_group_id uuid,
  p_resource text,
  p_extra_user uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  IF p_extra_user IS NOT NULL THEN
    PERFORM app_private.broadcast_social_user(p_extra_user, p_resource);
  END IF;
  FOR v_user_id IN
    SELECT gm.user_id
    FROM public.zane_social_group_members gm
    WHERE gm.group_id = p_group_id
  LOOP
    PERFORM app_private.broadcast_social_user(v_user_id, p_resource);
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.broadcast_social_participants(
  p_sender_id uuid,
  p_recipient_id uuid,
  p_group_id uuid,
  p_resource text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM app_private.broadcast_social_user(p_sender_id, p_resource);
  IF p_recipient_id IS NOT NULL THEN
    PERFORM app_private.broadcast_social_user(p_recipient_id, p_resource);
  ELSIF p_group_id IS NOT NULL THEN
    PERFORM app_private.broadcast_social_group(p_group_id, p_resource, p_sender_id);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.broadcast_social_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_message public.zane_social_messages%ROWTYPE;
  v_share public.zane_social_plan_shares%ROWTYPE;
  v_owner_id uuid;
  v_user_id uuid;
  v_group_id uuid;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'zane_social_profiles' THEN
      v_owner_id := (v_row->>'user_id')::uuid;
      PERFORM app_private.broadcast_social_user(v_owner_id, 'dashboard');
      FOR v_user_id IN
        SELECT CASE WHEN f.requester_id = v_owner_id THEN f.addressee_id ELSE f.requester_id END
        FROM public.zane_social_friendships f
        WHERE f.status = 'accepted'
          AND (f.requester_id = v_owner_id OR f.addressee_id = v_owner_id)
        UNION
        SELECT gm.user_id
        FROM public.zane_social_group_members own_membership
        JOIN public.zane_social_group_members gm ON gm.group_id = own_membership.group_id
        WHERE own_membership.user_id = v_owner_id
      LOOP
        PERFORM app_private.broadcast_social_user(v_user_id, 'dashboard');
      END LOOP;

    WHEN 'zane_social_friendships' THEN
      PERFORM app_private.broadcast_social_user((v_row->>'requester_id')::uuid, 'dashboard');
      PERFORM app_private.broadcast_social_user((v_row->>'addressee_id')::uuid, 'dashboard');

    WHEN 'zane_social_blocks' THEN
      PERFORM app_private.broadcast_social_user((v_row->>'blocker_id')::uuid, 'dashboard');
      PERFORM app_private.broadcast_social_user((v_row->>'blocked_id')::uuid, 'dashboard');

    WHEN 'zane_social_groups' THEN
      v_group_id := (v_row->>'id')::uuid;
      PERFORM app_private.broadcast_social_group(v_group_id, 'groups', (v_row->>'owner_id')::uuid);

    WHEN 'zane_social_group_members' THEN
      v_group_id := (v_row->>'group_id')::uuid;
      PERFORM app_private.broadcast_social_group(v_group_id, 'groups', (v_row->>'user_id')::uuid);

    WHEN 'zane_social_messages' THEN
      PERFORM app_private.broadcast_social_participants(
        (v_row->>'sender_id')::uuid,
        NULLIF(v_row->>'recipient_id', '')::uuid,
        NULLIF(v_row->>'group_id', '')::uuid,
        'messages'
      );

    WHEN 'zane_social_message_attachments' THEN
      SELECT * INTO v_message
      FROM public.zane_social_messages m
      WHERE m.id = (v_row->>'message_id')::uuid;
      IF FOUND THEN
        PERFORM app_private.broadcast_social_participants(v_message.sender_id, v_message.recipient_id, v_message.group_id, 'messages');
      ELSE
        PERFORM app_private.broadcast_social_user(NULLIF(v_row->>'uploaded_by', '')::uuid, 'messages');
      END IF;

    WHEN 'zane_social_message_reads' THEN
      SELECT * INTO v_message
      FROM public.zane_social_messages m
      WHERE m.id = (v_row->>'message_id')::uuid;
      IF FOUND THEN
        PERFORM app_private.broadcast_social_participants(v_message.sender_id, v_message.recipient_id, v_message.group_id, 'messages');
      END IF;
      PERFORM app_private.broadcast_social_user((v_row->>'user_id')::uuid, 'messages');

    WHEN 'zane_social_plan_shares' THEN
      PERFORM app_private.broadcast_social_participants(
        (v_row->>'sender_id')::uuid,
        NULLIF(v_row->>'recipient_id', '')::uuid,
        NULLIF(v_row->>'group_id', '')::uuid,
        'shares'
      );

    WHEN 'zane_social_plan_share_imports' THEN
      SELECT * INTO v_share
      FROM public.zane_social_plan_shares ps
      WHERE ps.id = (v_row->>'share_id')::uuid;
      IF FOUND THEN
        PERFORM app_private.broadcast_social_participants(v_share.sender_id, v_share.recipient_id, v_share.group_id, 'shares');
      END IF;
      PERFORM app_private.broadcast_social_user((v_row->>'user_id')::uuid, 'shares');

    WHEN 'zane_social_workout_comments' THEN
      SELECT s.user_id INTO v_owner_id
      FROM public.zane_sessions s
      WHERE s.id = v_row->>'session_id';
      PERFORM app_private.broadcast_social_user(v_owner_id, 'feed');
      PERFORM app_private.broadcast_social_user((v_row->>'author_id')::uuid, 'feed');
      FOR v_user_id IN
        SELECT CASE WHEN f.requester_id = v_owner_id THEN f.addressee_id ELSE f.requester_id END
        FROM public.zane_social_friendships f
        JOIN public.zane_social_profiles sp ON sp.user_id = v_owner_id
        WHERE f.status = 'accepted'
          AND sp.workouts_visible
          AND (f.requester_id = v_owner_id OR f.addressee_id = v_owner_id)
      LOOP
        PERFORM app_private.broadcast_social_user(v_user_id, 'feed');
      END LOOP;
  END CASE;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION app_private.broadcast_social_user(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION app_private.broadcast_social_group(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION app_private.broadcast_social_participants(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION app_private.broadcast_social_change() FROM PUBLIC, anon, authenticated, service_role;

DO $triggers$
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
    'zane_social_workout_comments'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zane_social_broadcast_invalidate ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER zane_social_broadcast_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_social_change()',
      v_table
    );
  END LOOP;
END;
$triggers$;
