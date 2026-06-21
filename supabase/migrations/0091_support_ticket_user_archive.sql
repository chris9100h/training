-- Auto-archive resolved support tickets on the user side after 7 days.
-- Adds archived_at to track when admin archived a ticket;
-- get_user_support_chats returns archived + archived_at so the client
-- can split the list into active vs. user-archived.

ALTER TABLE public.zane_coaching
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- archive_support_ticket: now also records when archiving happened
CREATE OR REPLACE FUNCTION archive_support_ticket(p_coaching_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'office@btc-prime.biz' LIMIT 1;
  IF auth.uid() <> v_admin_id THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  UPDATE zane_coaching SET archived = true, archived_at = now()
  WHERE id = p_coaching_id AND id LIKE 'support_%';
END;
$$;

-- get_user_support_chats: now returns archived + archived_at
CREATE OR REPLACE FUNCTION get_user_support_chats()
RETURNS TABLE (
  coaching_id       text,
  support_status    text,
  support_category  text,
  created_at        timestamptz,
  last_message_at   timestamptz,
  last_message_body text,
  unread_count      bigint,
  archived          boolean,
  archived_at       timestamptz
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
    (SELECT COUNT(*)        FROM zane_coaching_notes n WHERE n.coaching_id = c.id AND n.author_id <> auth.uid() AND n.read_at IS NULL),
    COALESCE(c.archived, false),
    c.archived_at
  FROM zane_coaching c
  WHERE c.client_id = auth.uid()
    AND c.id LIKE 'support_%'
  ORDER BY COALESCE(
    (SELECT MAX(n.created_at) FROM zane_coaching_notes n WHERE n.coaching_id = c.id),
    c.created_at
  ) DESC;
END;
$$;
