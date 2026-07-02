-- 0129 — Hide unreplied broadcast tickets from the admin support inbox
--
-- admin_broadcast_message (0127) creates/touches a support ticket per user,
-- which otherwise floods get_support_chats() with entries that don't need
-- attention (admin sent the only message so far), burying genuine open
-- support requests. Exclude a ticket until the user actually replies — the
-- moment they send any message of their own, it reappears normally.

CREATE OR REPLACE FUNCTION public.get_support_chats()
RETURNS TABLE (
  coaching_id       text,
  client_id         uuid,
  client_name       text,
  client_email      text,
  support_status    text,
  support_category  text,
  last_message_at   timestamptz,
  last_message_body text,
  unread_count      bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
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
    c.support_status,
    c.support_category,
    (SELECT MAX(n.created_at) FROM zane_coaching_notes n WHERE n.coaching_id = c.id),
    (SELECT n.body          FROM zane_coaching_notes n WHERE n.coaching_id = c.id ORDER BY n.created_at DESC LIMIT 1),
    (SELECT COUNT(*)        FROM zane_coaching_notes n WHERE n.coaching_id = c.id AND n.author_id <> v_admin_id AND n.read_at IS NULL)
  FROM zane_coaching c
  JOIN auth.users u ON u.id = c.client_id
  LEFT JOIN zane_profiles p ON p.id = c.client_id
  WHERE c.id LIKE 'support_%'
    AND NOT COALESCE(c.archived, false)
    AND EXISTS (SELECT 1 FROM zane_coaching_notes n WHERE n.coaching_id = c.id AND n.author_id <> v_admin_id)
  ORDER BY (SELECT MAX(n.created_at) FROM zane_coaching_notes n WHERE n.coaching_id = c.id) DESC NULLS LAST;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_support_chats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_support_chats() TO authenticated;
