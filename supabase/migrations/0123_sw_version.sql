-- Tracks the last SW cache version each device reported at boot, so an admin
-- can tell whether a user reporting a bug is stuck on a stale/broken cache
-- without having to ask them to check Settings themselves.
ALTER TABLE zane_user_settings ADD COLUMN IF NOT EXISTS sw_version text;

-- All-users admin lookup (name/email/last-known SW version), independent of
-- whether the user is currently training or a recent sign-up — the existing
-- admin views (Active users, Recent sign-ups) only cover those two subsets.
CREATE OR REPLACE FUNCTION public.get_all_users_admin()
 RETURNS TABLE(user_id uuid, name text, email text, sw_version text, created_at timestamptz, approved boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT p.id, p.name, u.email::text, us.sw_version, u.created_at, p.approved
    FROM zane_profiles p
    JOIN auth.users u ON u.id = p.id
    LEFT JOIN zane_user_settings us ON us.user_id = p.id
    ORDER BY u.created_at DESC;
END;
$function$;
