-- Extend get_all_users_admin() with plan_count so the "All users" admin
-- sheet can filter/show onboarding status itself, folding in what the
-- separate get_users_with_plans() view covered (LEFT JOIN here instead of
-- its INNER JOIN, so users with zero plans still appear with plan_count=0
-- rather than being excluded).
-- Return type changed (new plan_count column), so the old signature must be
-- dropped first -- CREATE OR REPLACE alone can't change OUT parameters.
DROP FUNCTION IF EXISTS public.get_all_users_admin();

CREATE FUNCTION public.get_all_users_admin()
 RETURNS TABLE(user_id uuid, name text, email text, sw_version text, created_at timestamptz, approved boolean, plan_count int)
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
           COALESCE(sc.plan_count, 0)::int AS plan_count
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
    ORDER BY u.created_at DESC;
END;
$function$;
