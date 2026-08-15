-- Admin-assigned VIP background image per user.
-- The value is a repo-relative file path (e.g. 'Background/Appy.png').
-- Null = standard Zane logo watermark.
ALTER TABLE zane_user_settings ADD COLUMN IF NOT EXISTS vip_background text;

-- Set or clear a VIP background for a user by email (admin only).
-- Returns 'ok' on success or 'ERROR:not_found' when the email doesn't match any account.
CREATE OR REPLACE FUNCTION set_user_vip_background(p_email text, p_bg_key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(trim(p_email))
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN 'ERROR:not_found';
  END IF;

  INSERT INTO zane_user_settings (user_id, vip_background)
  VALUES (v_user_id, NULLIF(trim(p_bg_key), ''))
  ON CONFLICT (user_id) DO UPDATE SET vip_background = NULLIF(trim(p_bg_key), '');

  RETURN 'ok';
END;
$$;

-- List all current VIP background assignments (admin only).
CREATE OR REPLACE FUNCTION get_user_vip_backgrounds()
RETURNS TABLE (email text, bg_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT u.email::text, us.vip_background::text
  FROM zane_user_settings us
  JOIN auth.users u ON u.id = us.user_id
  WHERE us.vip_background IS NOT NULL
  ORDER BY u.email;
END;
$$;
