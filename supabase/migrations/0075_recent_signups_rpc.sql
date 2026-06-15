-- Admin overview: recent sign-ups (approved or not) for the Account-tab list.
-- get_pending_users only returns unapproved accounts, so auto-approved signups
-- (when approval is off) would never appear anywhere. This returns the latest
-- registrations with their approval status for a simple admin "who joined" feed.
CREATE OR REPLACE FUNCTION public.get_recent_signups(p_limit int DEFAULT 50)
RETURNS TABLE(user_id uuid, name text, email text, created_at timestamptz, approved boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT p.id, p.name, u.email::text, u.created_at, p.approved
    FROM zane_profiles p
    JOIN auth.users u ON u.id = p.id
    ORDER BY u.created_at DESC
    LIMIT GREATEST(p_limit, 1);
END;
$$;
