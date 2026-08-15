-- Fix invite_client RPC: exclude self-coaching rows (coach_id = client_id)
-- from the "already has an active coach" check so users with be-your-own-coach
-- enabled can still receive a real coach invite.

CREATE OR REPLACE FUNCTION invite_client(p_email text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_client_id uuid;
  v_id        text;
  v_existing  text;
BEGIN
  v_client_id := find_user_by_email(p_email);
  IF v_client_id IS NULL THEN
    RETURN 'ERROR:not_found';
  END IF;
  IF v_client_id = auth.uid() THEN
    RETURN 'ERROR:self';
  END IF;
  -- Check if this exact coach-client pair already exists
  SELECT id INTO v_existing FROM zane_coaching
    WHERE coach_id = auth.uid() AND client_id = v_client_id;
  IF FOUND THEN
    RETURN 'ERROR:exists:' || v_existing;
  END IF;
  -- Block if client already has an active coach (exclude self-coaching rows)
  PERFORM 1 FROM zane_coaching
    WHERE client_id = v_client_id AND status = 'active' AND coach_id != client_id;
  IF FOUND THEN
    RETURN 'ERROR:already_coached';
  END IF;
  v_id := 'cch_' || gen_random_uuid()::text;
  INSERT INTO zane_coaching (id, coach_id, client_id, status)
    VALUES (v_id, auth.uid(), v_client_id, 'pending');
  RETURN v_id;
END
$$;
