-- Support ticket system
-- Reuses zane_coaching infrastructure with 'support_' prefixed IDs so that
-- existing RLS policies (coach + client can read their shared notes) apply
-- automatically. Support rows must be filtered out of all coaching RPCs.

-- 1. Two new columns on zane_coaching
ALTER TABLE zane_coaching
  ADD COLUMN IF NOT EXISTS support_status text
    CHECK (support_status IN ('open', 'in_progress', 'resolved')),
  ADD COLUMN IF NOT EXISTS support_category text
    CHECK (support_category IN ('feature_request', 'bug', 'question'));

-- 2. get_coach_info: exclude support rows (admin would otherwise appear as "coach")
DROP FUNCTION IF EXISTS get_coach_info();
CREATE OR REPLACE FUNCTION get_coach_info()
RETURNS TABLE (coaching_id text, coach_id uuid, coach_email text, coach_name text, status text)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT c.id, c.coach_id, u.email, COALESCE(p.name, u.email), c.status
  FROM zane_coaching c
  JOIN auth.users u ON u.id = c.coach_id
  LEFT JOIN zane_profiles p ON p.id = c.coach_id
  WHERE c.client_id = auth.uid()
    AND c.coach_id <> c.client_id
    AND c.id NOT LIKE 'support_%'
$$;

-- 3. get_coaching_clients: exclude support rows
DROP FUNCTION IF EXISTS get_coaching_clients();
CREATE OR REPLACE FUNCTION get_coaching_clients()
RETURNS TABLE (coaching_id text, client_id uuid, client_email text, client_name text, status text, checkin_enabled boolean)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT c.id, c.client_id, u.email, COALESCE(p.name, u.email), c.status, c.checkin_enabled
  FROM zane_coaching c
  JOIN auth.users u ON u.id = c.client_id
  LEFT JOIN zane_profiles p ON p.id = c.client_id
  WHERE c.coach_id = auth.uid()
    AND c.coach_id <> c.client_id
    AND c.id NOT LIKE 'support_%'
$$;

-- 4. get_coach_clients_status: exclude support rows
CREATE OR REPLACE FUNCTION public.get_coach_clients_status()
RETURNS TABLE(client_id uuid, in_progress_session_id text, status_mode text, status_mode_since timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT us.user_id, us.in_progress_session_id, us.status_mode, us.status_mode_since
  FROM zane_user_settings us
  INNER JOIN zane_coaching zc ON zc.client_id = us.user_id
  WHERE zc.coach_id = auth.uid()
    AND zc.coach_id <> zc.client_id
    AND zc.status = 'active'
    AND zc.id NOT LIKE 'support_%'
$$;

-- 5. get_coach_checkin_status: exclude support rows
DROP FUNCTION IF EXISTS public.get_coach_checkin_status();
CREATE OR REPLACE FUNCTION public.get_coach_checkin_status()
RETURNS TABLE(coaching_id text, checked_in_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_week_start date;
BEGIN
  v_week_start := current_date
    - (EXTRACT(DOW FROM current_date)::int) * INTERVAL '1 day'
    - INTERVAL '6 days';
  RETURN QUERY
  SELECT c.id,
    (SELECT ci.checked_in_at FROM zane_checkins ci
     WHERE ci.coaching_id = c.id AND ci.week_start = v_week_start LIMIT 1)
  FROM zane_coaching c
  WHERE c.coach_id = auth.uid()
    AND c.coach_id <> c.client_id
    AND c.status = 'active'
    AND c.id NOT LIKE 'support_%';
END;
$$;

-- 6. open_support_chat: idempotent — creates and returns the support coaching row id
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
  v_id := 'support_' || v_user_id::text;
  INSERT INTO zane_coaching (id, coach_id, client_id, status, support_status, support_category)
  VALUES (v_id, v_admin_id, v_user_id, 'active', 'open', p_category)
  ON CONFLICT (id) DO NOTHING;
  RETURN v_id;
END;
$$;

-- 7. get_support_chats: admin inbox — all support tickets with preview + unread count
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
  ORDER BY (SELECT MAX(n.created_at) FROM zane_coaching_notes n WHERE n.coaching_id = c.id) DESC NULLS LAST;
END;
$$;

-- 8. set_support_status: admin changes a ticket's status
CREATE OR REPLACE FUNCTION set_support_status(p_coaching_id text, p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'office@btc-prime.biz' LIMIT 1;
  IF auth.uid() <> v_admin_id THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_status NOT IN ('open', 'in_progress', 'resolved') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  UPDATE zane_coaching SET support_status = p_status
  WHERE id = p_coaching_id AND id LIKE 'support_%';
END;
$$;
