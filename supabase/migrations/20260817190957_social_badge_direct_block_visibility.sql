-- Keep the badge visibility window aligned with the message RLS policy. A
-- direct recipient must not keep seeing unread counts from a sender after
-- either side blocks the other.
CREATE OR REPLACE FUNCTION public.social_get_badge()
RETURNS TABLE(incoming_count integer, unread_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
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
      FROM (
        SELECT m.id, m.sender_id
        FROM zane_social_messages m
        WHERE (
          (
            m.recipient_id = v_uid
            AND NOT EXISTS (
              SELECT 1 FROM zane_social_blocks direct_block
              WHERE (direct_block.blocker_id = v_uid AND direct_block.blocked_id = m.sender_id)
                 OR (direct_block.blocker_id = m.sender_id AND direct_block.blocked_id = v_uid)
            )
          )
          OR m.sender_id = v_uid
          OR (
            m.group_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM zane_social_group_members own_member
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
        ORDER BY m.created_at DESC
        LIMIT 300
      ) visible
      WHERE visible.sender_id <> v_uid
        AND NOT EXISTS (
          SELECT 1
          FROM zane_social_message_reads mr
          WHERE mr.message_id = visible.id AND mr.user_id = v_uid
        )
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_get_badge() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_badge() TO authenticated;
