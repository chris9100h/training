-- 0127 — Admin broadcast message
--
-- Lets the admin send a message to every user at once, reusing the existing
-- support-ticket infrastructure (zane_coaching rows with id 'support_<uid>' +
-- zane_coaching_notes) so it reaches users through already-deployed,
-- realtime-subscribed UI — no client update required to see it. Creates a
-- support ticket for any user who doesn't have one yet.
--
-- auth.uid() IS NULL is checked explicitly (not just <> v_admin_id) — see
-- 0128 for why a bare inequality check fails open for an anon caller.

CREATE OR REPLACE FUNCTION public.admin_broadcast_message(p_body text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_admin_id uuid;
  v_count int := 0;
  v_user record;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'office@btc-prime.biz' LIMIT 1;
  IF auth.uid() IS NULL OR auth.uid() <> v_admin_id THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_body IS NULL OR btrim(p_body) = '' THEN RAISE EXCEPTION 'Message body required'; END IF;

  FOR v_user IN
    SELECT id FROM auth.users WHERE id <> v_admin_id
  LOOP
    INSERT INTO zane_coaching (id, coach_id, client_id, status, support_status)
    VALUES ('support_' || v_user.id::text, v_admin_id, v_user.id, 'active', 'open')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO zane_coaching_notes (id, coaching_id, author_id, type, body)
    VALUES (
      'note_' || replace(gen_random_uuid()::text, '-', ''),
      'support_' || v_user.id::text,
      v_admin_id,
      'general',
      p_body
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_broadcast_message(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_broadcast_message(text) TO authenticated;
