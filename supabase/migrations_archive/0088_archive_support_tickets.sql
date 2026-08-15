-- Archive support tickets (admin only).
-- Adds archived boolean to zane_coaching; updates get_support_chats to exclude
-- archived tickets; new get_archived_support_chats + archive_support_ticket RPC.

ALTER TABLE public.zane_coaching
  ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;

-- get_support_chats: now excludes archived tickets
CREATE OR REPLACE FUNCTION get_support_chats()
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
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'office@btc-prime.biz' LIMIT 1;
  IF auth.uid() <> v_admin_id THEN RAISE EXCEPTION 'Unauthorized'; END IF;
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
  ORDER BY (SELECT MAX(n.created_at) FROM zane_coaching_notes n WHERE n.coaching_id = c.id) DESC NULLS LAST;
END;
$$;

-- get_archived_support_chats: archived-only inbox for admin
CREATE OR REPLACE FUNCTION get_archived_support_chats()
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
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'office@btc-prime.biz' LIMIT 1;
  IF auth.uid() <> v_admin_id THEN RAISE EXCEPTION 'Unauthorized'; END IF;
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
    AND COALESCE(c.archived, false)
  ORDER BY (SELECT MAX(n.created_at) FROM zane_coaching_notes n WHERE n.coaching_id = c.id) DESC NULLS LAST;
END;
$$;

-- archive_support_ticket: admin sets archived = true
CREATE OR REPLACE FUNCTION archive_support_ticket(p_coaching_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'office@btc-prime.biz' LIMIT 1;
  IF auth.uid() <> v_admin_id THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  UPDATE zane_coaching SET archived = true
  WHERE id = p_coaching_id AND id LIKE 'support_%';
END;
$$;
