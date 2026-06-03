-- Returns live training status (in_progress_session_id) for all active clients
-- of the calling coach. SECURITY DEFINER bypasses RLS on zane_user_settings.
CREATE OR REPLACE FUNCTION public.get_coach_clients_status()
RETURNS TABLE(client_id uuid, in_progress_session_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT us.user_id AS client_id, us.in_progress_session_id
  FROM zane_user_settings us
  INNER JOIN zane_coaching zc ON zc.client_id = us.user_id
  WHERE zc.coach_id = auth.uid()
    AND zc.status = 'active'
    AND us.in_progress_session_id IS NOT NULL;
$$;
