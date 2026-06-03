-- Add show_coaching_tab setting so users can pin the coaching tab
-- even without active coaching relationships.
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS show_coaching_tab boolean DEFAULT false;

-- Update invite_client: block invite if client already has an active coach.
-- A pending invite can still be sent (client may decline their current coach),
-- but sending to someone actively coached is a no-op with a clear error.
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
  -- Block if client already has an active coach (anyone)
  PERFORM 1 FROM zane_coaching
    WHERE client_id = v_client_id AND status = 'active';
  IF FOUND THEN
    RETURN 'ERROR:already_coached';
  END IF;
  v_id := 'cch_' || gen_random_uuid()::text;
  INSERT INTO zane_coaching (id, coach_id, client_id, status)
    VALUES (v_id, auth.uid(), v_client_id, 'pending');
  RETURN v_id;
END
$$;
