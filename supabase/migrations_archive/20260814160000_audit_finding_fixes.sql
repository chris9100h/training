-- Audit finding fixes. Apply this migration on a preview branch first; it is
-- deliberately independent of the production rollout.

BEGIN;

-- A NULL auth.uid() must never pass the admin comparison (SQL NULL would make
-- the IF condition unknown and therefore skip the exception).
CREATE OR REPLACE FUNCTION public.get_archived_support_chats()
RETURNS TABLE(
  coaching_id text,
  client_id uuid,
  client_name text,
  client_email text,
  x_handle text,
  support_status text,
  support_category text,
  last_message_at timestamptz,
  last_message_body text,
  unread_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'office@btc-prime.biz' LIMIT 1;
  IF auth.uid() IS NULL OR auth.uid() <> v_admin_id THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  RETURN QUERY
  SELECT
    c.id,
    c.client_id,
    COALESCE(p.name, u.email)::text,
    u.email::text,
    p.x_handle,
    c.support_status,
    c.support_category,
    (SELECT MAX(n.created_at) FROM zane_coaching_notes n WHERE n.coaching_id = c.id),
    (SELECT n.body FROM zane_coaching_notes n WHERE n.coaching_id = c.id ORDER BY n.created_at DESC LIMIT 1),
    (SELECT COUNT(*) FROM zane_coaching_notes n WHERE n.coaching_id = c.id AND n.author_id <> v_admin_id AND n.read_at IS NULL)
  FROM zane_coaching c
  JOIN auth.users u ON u.id = c.client_id
  LEFT JOIN zane_profiles p ON p.id = c.client_id
  WHERE c.id LIKE 'support_%'
    AND COALESCE(c.archived, false)
  ORDER BY (SELECT MAX(n.created_at) FROM zane_coaching_notes n WHERE n.coaching_id = c.id) DESC NULLS LAST;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_archived_support_chats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_archived_support_chats() TO authenticated;

-- Blocking a user in another person's group must not delete the blocker from
-- that third party's group. The visibility helper already hides a group when
-- it contains a blocked pair, so only an owner may remove the target member.
CREATE OR REPLACE FUNCTION app_private.social_block_user(p_target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_target_id IS NULL OR auth.uid() = p_target_id THEN
    RAISE EXCEPTION 'Invalid block target';
  END IF;

  INSERT INTO zane_social_blocks (blocker_id, blocked_id)
  VALUES (auth.uid(), p_target_id)
  ON CONFLICT DO NOTHING;

  DELETE FROM zane_social_friendships
  WHERE (requester_id = auth.uid() AND addressee_id = p_target_id)
     OR (requester_id = p_target_id AND addressee_id = auth.uid());

  DELETE FROM zane_social_group_members victim
  USING zane_social_groups shared_group
  WHERE victim.group_id = shared_group.id
    AND shared_group.owner_id = auth.uid()
    AND victim.user_id = p_target_id
    AND EXISTS (
      SELECT 1 FROM zane_social_group_members actor_members
      WHERE actor_members.group_id = shared_group.id AND actor_members.user_id = auth.uid()
    );
END;
$function$;

-- Realtime is an auxiliary invalidation channel. A transient Realtime error
-- must never roll back the chat/friend/group write that caused the signal.
CREATE OR REPLACE FUNCTION app_private.broadcast_social_user(p_user_id uuid, p_resource text)
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
    BEGIN
      PERFORM realtime.send(
        jsonb_build_object('resource', p_resource),
        'social_invalidate',
        'social:user:' || p_user_id::text,
        true
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'social broadcast skipped (%): %', SQLSTATE, SQLERRM;
    END;
  END IF;
END;
$function$;

-- Reports remain available to the moderator while Friends is in maintenance;
-- the reporting table has its own owner/admin policies.
DROP POLICY IF EXISTS "social runtime gate" ON public.zane_social_reports;

-- Keep the badge query index-friendly while retaining the block-aware group
-- visibility contract previously provided by social_group_visible().
CREATE OR REPLACE FUNCTION public.social_get_badge()
RETURNS TABLE(incoming_count integer, unread_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM app_private.require_social_available();

  RETURN QUERY
  SELECT
    (
      SELECT count(*)::integer
      FROM zane_social_friendships f
      WHERE f.addressee_id = v_uid
        AND f.status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM zane_social_blocks b
          WHERE (b.blocker_id = v_uid AND b.blocked_id = f.requester_id)
             OR (b.blocker_id = f.requester_id AND b.blocked_id = v_uid)
        )
    ),
    (
      SELECT count(*)::integer
      FROM zane_social_messages m
      WHERE m.sender_id <> v_uid
        AND (
          m.recipient_id = v_uid
          OR (
            m.group_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM zane_social_group_members own_member
              WHERE own_member.group_id = m.group_id AND own_member.user_id = v_uid
            )
            AND NOT EXISTS (
              SELECT 1
              FROM zane_social_group_members other_member
              JOIN zane_social_blocks b
                ON (b.blocker_id = v_uid AND b.blocked_id = other_member.user_id)
                OR (b.blocker_id = other_member.user_id AND b.blocked_id = v_uid)
              WHERE other_member.group_id = m.group_id AND other_member.user_id <> v_uid
            )
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM zane_social_message_reads mr
          WHERE mr.message_id = m.id AND mr.user_id = v_uid
        )
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_get_badge() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_badge() TO authenticated;

-- The composite index covers both the user filter and entry join. The old
-- single-column index is redundant and only adds write amplification.
DROP INDEX IF EXISTS public.idx_zane_sets_user_id;

COMMIT;
