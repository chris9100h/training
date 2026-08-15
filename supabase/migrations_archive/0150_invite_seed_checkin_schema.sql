-- 0150_invite_seed_checkin_schema.sql
-- Follow-up to the coaching audit (#1): saveDefaultCheckinSchema only stamps
-- checkin_schema onto coaching rows that exist at save time, and invite_client
-- did not copy it, so a client invited AFTER the coach set a custom default got
-- a null row and therefore fell back to the built-in default (diverging from the
-- coach's intent). Seed the new row's checkin_schema from the coach's current
-- default at invite time so a newly invited client immediately uses the coach's
-- form. Null default keeps the null-row / built-in-default behaviour unchanged.
CREATE OR REPLACE FUNCTION public.invite_client(p_email text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client_id uuid;
  v_id        text;
  v_existing  text;
  v_schema    jsonb;
BEGIN
  v_client_id := find_user_by_email(p_email);
  IF v_client_id IS NULL THEN
    RETURN 'ERROR:not_found';
  END IF;
  IF v_client_id = auth.uid() THEN
    RETURN 'ERROR:self';
  END IF;
  SELECT id INTO v_existing FROM zane_coaching
    WHERE coach_id = auth.uid() AND client_id = v_client_id;
  IF FOUND THEN
    RETURN 'ERROR:exists:' || v_existing;
  END IF;
  PERFORM 1 FROM zane_coaching
    WHERE client_id = v_client_id AND status = 'active';
  IF FOUND THEN
    RETURN 'ERROR:already_coached';
  END IF;
  SELECT default_checkin_schema INTO v_schema
    FROM zane_user_settings WHERE user_id = auth.uid();
  v_id := 'cch_' || gen_random_uuid()::text;
  INSERT INTO zane_coaching (id, coach_id, client_id, status, checkin_schema)
    VALUES (v_id, auth.uid(), v_client_id, 'pending', v_schema);
  RETURN v_id;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.invite_client(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_client(text) TO authenticated;
