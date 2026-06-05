-- Add per-client check-in enable/disable flag to zane_coaching
ALTER TABLE zane_coaching ADD COLUMN IF NOT EXISTS checkin_enabled boolean NOT NULL DEFAULT true;

-- Return type changed — must drop before recreating
DROP FUNCTION IF EXISTS get_coaching_clients();

CREATE OR REPLACE FUNCTION get_coaching_clients()
RETURNS TABLE (coaching_id text, client_id uuid, client_email text, client_name text, status text, checkin_enabled boolean)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT c.id, c.client_id, u.email, COALESCE(p.name, u.email), c.status, c.checkin_enabled
  FROM zane_coaching c
  JOIN auth.users u ON u.id = c.client_id
  LEFT JOIN zane_profiles p ON p.id = c.client_id
  WHERE c.coach_id = auth.uid()
    AND c.coach_id <> c.client_id
$$;
