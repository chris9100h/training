-- Returns true if the caller has access to the active users overview.
CREATE OR REPLACE FUNCTION public.check_active_users_access()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.email() = 'office@btc-prime.biz' THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM feature_grants
    WHERE feature = 'active_users' AND email = auth.email()
  );
END;
$$;
