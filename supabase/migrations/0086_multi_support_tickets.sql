-- Multiple support tickets per user.
-- open_support_chat now creates a fresh ticket each call (random UUID suffix).
-- Adds get_user_support_chats() for the user-side ticket list.

-- 1. open_support_chat: always creates a new ticket
CREATE OR REPLACE FUNCTION open_support_chat(p_category text DEFAULT 'question')
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_id uuid;
  v_user_id  uuid;
  v_id       text;
BEGIN
  v_user_id := auth.uid();
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'office@btc-prime.biz' LIMIT 1;
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Support unavailable'; END IF;
  IF v_user_id = v_admin_id THEN RAISE EXCEPTION 'Admin cannot open support chat'; END IF;
  IF p_category NOT IN ('feature_request', 'bug', 'question') THEN p_category := 'question'; END IF;
  v_id := 'support_' || gen_random_uuid()::text;
  INSERT INTO zane_coaching (id, coach_id, client_id, status, support_status, support_category)
  VALUES (v_id, v_admin_id, v_user_id, 'active', 'open', p_category);
  RETURN v_id;
END;
$$;

-- 2. get_user_support_chats: user's own ticket list, newest activity first
CREATE OR REPLACE FUNCTION get_user_support_chats()
RETURNS TABLE (
  coaching_id       text,
  support_status    text,
  support_category  text,
  created_at        timestamptz,
  last_message_at   timestamptz,
  last_message_body text,
  unread_count      bigint
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.support_status,
    c.support_category,
    c.created_at,
    (SELECT MAX(n.created_at) FROM zane_coaching_notes n WHERE n.coaching_id = c.id),
    (SELECT n.body          FROM zane_coaching_notes n WHERE n.coaching_id = c.id ORDER BY n.created_at DESC LIMIT 1),
    (SELECT COUNT(*)        FROM zane_coaching_notes n WHERE n.coaching_id = c.id AND n.author_id <> auth.uid() AND n.read_at IS NULL)
  FROM zane_coaching c
  WHERE c.client_id = auth.uid()
    AND c.id LIKE 'support_%'
  ORDER BY COALESCE(
    (SELECT MAX(n.created_at) FROM zane_coaching_notes n WHERE n.coaching_id = c.id),
    c.created_at
  ) DESC;
END;
$$;
