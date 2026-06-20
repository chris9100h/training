-- Add sick/vacation status mode to user settings
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS status_mode text CHECK (status_mode IN ('sick', 'vacation')),
  ADD COLUMN IF NOT EXISTS status_mode_since timestamptz;

-- Update get_coach_clients_status to include status fields and all active clients
-- (previously only returned clients with an active session; now returns all active
-- clients so coaches can see sick/vacation status even when client isn't training)
CREATE OR REPLACE FUNCTION public.get_coach_clients_status()
 RETURNS TABLE(client_id uuid, in_progress_session_id text, status_mode text, status_mode_since timestamptz)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select us.user_id as client_id, us.in_progress_session_id, us.status_mode, us.status_mode_since
  from zane_user_settings us
  inner join zane_coaching zc on zc.client_id = us.user_id
  where zc.coach_id = auth.uid()
    and zc.coach_id <> zc.client_id
    and zc.status = 'active';
$function$;
