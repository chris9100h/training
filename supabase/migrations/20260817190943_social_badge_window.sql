-- Badge counted every unread message ever; the inbox and mark-as-read only
-- ever see the newest 300. Anything unread below that window could not be
-- reached, let alone marked read, so the Social tile kept showing a number the
-- user had no way to clear: opening every visible chat left it unchanged and
-- returning Home showed it again. Cap the count to the same window the client
-- loads, so the badge and the reachable messages are the same set by
-- construction. The window matches the limit in loadSocialMessages (store.js).
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
      -- Newest 300 VISIBLE messages first (own ones included, exactly like the
      -- client's query), then count the unread ones among them. Filtering the
      -- sender out before the limit would widen the window past what the
      -- client can actually load and reintroduce the unclearable badge.
      SELECT count(*)::integer
      FROM (
        SELECT m.id, m.sender_id
        FROM zane_social_messages m
        WHERE (
          m.recipient_id = v_uid
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
