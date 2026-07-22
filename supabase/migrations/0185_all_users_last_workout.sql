-- Extend get_all_users_admin() with last_workout (most recent ended session
-- per user) so the "All users" admin sheet can show "last workout" instead
-- of the email address on the card, and filter to users trained in the
-- last 7 days.
-- Return type changed (new last_workout column), so the old signature must
-- be dropped first -- CREATE OR REPLACE alone can't change OUT parameters.
DROP FUNCTION IF EXISTS public.get_all_users_admin();

CREATE FUNCTION public.get_all_users_admin()
 RETURNS TABLE(user_id uuid, name text, email text, sw_version text, created_at timestamptz, approved boolean, plan_count int, last_workout timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT p.id, p.name, u.email::text, us.sw_version, u.created_at, p.approved,
           COALESCE(sc.plan_count, 0)::int AS plan_count, lw.last_workout
    FROM zane_profiles p
    JOIN auth.users u ON u.id = p.id
    LEFT JOIN zane_user_settings us ON us.user_id = p.id
    LEFT JOIN (
      -- Table-qualified: an unqualified "user_id" here is ambiguous against
      -- the function's own user_id OUT parameter (PL/pgSQL resolves bare
      -- column names against local variables first) and fails at call time
      -- with "column reference is ambiguous", even though a plain top-level
      -- SELECT of the same query runs fine outside the function body.
      SELECT s.user_id, COUNT(*) AS plan_count FROM zane_schedules s GROUP BY s.user_id
    ) sc ON sc.user_id = p.id
    LEFT JOIN (
      SELECT s.user_id, MAX(s.ended) AS last_workout FROM zane_sessions s WHERE s.ended IS NOT NULL GROUP BY s.user_id
    ) lw ON lw.user_id = p.id
    ORDER BY u.created_at DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_all_users_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_users_admin() TO authenticated;
