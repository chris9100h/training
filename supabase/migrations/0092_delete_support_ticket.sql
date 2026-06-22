-- Admin-only RPC to permanently delete a support ticket.
-- Cascades to zane_coaching_notes and zane_coaching_threads via FK.
-- The caller (admin UI) is responsible for sending the push notification
-- to the user BEFORE calling this, since the coaching row must still
-- exist for zane_coaching-notify to resolve the recipient.

CREATE OR REPLACE FUNCTION delete_support_ticket(p_coaching_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'office@btc-prime.biz' LIMIT 1;
  IF auth.uid() <> v_admin_id THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_coaching_id NOT LIKE 'support_%' THEN RAISE EXCEPTION 'Not a support ticket'; END IF;
  DELETE FROM zane_coaching_notes  WHERE coaching_id = p_coaching_id;
  DELETE FROM zane_coaching_threads WHERE coaching_id = p_coaching_id;
  DELETE FROM zane_coaching         WHERE id           = p_coaching_id;
END;
$$;
