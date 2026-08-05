-- Remove the signup approval system entirely. Registration is open and stays
-- open: no pending screen, no admin approval queue, and no auto-approve budget
-- that silently closed registration again once it ran out.
--
-- Safe to drop: no RLS policy anywhere referenced zane_profiles.approved
-- (verified against pg_policies), it was purely an application-level gate in
-- app.jsx. Nothing else keys off it.
--
-- The three admin listing RPCs returned `approved` in their result set, so they
-- are recreated without that column. Their callers in screens-settings.jsx are
-- updated in the same change.

-- ── 1. The auto-approve budget mechanic ──────────────────────────────────────
-- A trigger decremented auto_approve_remaining on every signup and flipped
-- signup_requires_approval back to true when it hit zero. That is the whole
-- "open for N more registrations" behaviour, and it is going away.
DROP TRIGGER IF EXISTS zane_profiles_consume_budget ON public.zane_profiles;
DROP FUNCTION IF EXISTS public.signup_consume_budget();

-- The column default calls signup_default_approved(), so it has to be detached
-- before that function can be dropped.
ALTER TABLE public.zane_profiles ALTER COLUMN approved DROP DEFAULT;
DROP FUNCTION IF EXISTS public.signup_default_approved();

-- ── 2. Admin-facing approval RPCs ────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_pending_users();
DROP FUNCTION IF EXISTS public.approve_user(uuid);
DROP FUNCTION IF EXISTS public.decline_user(uuid);
DROP FUNCTION IF EXISTS public.get_signup_requires_approval();
DROP FUNCTION IF EXISTS public.set_signup_requires_approval(boolean);
DROP FUNCTION IF EXISTS public.get_signup_config();
DROP FUNCTION IF EXISTS public.set_auto_approve_budget(integer);

-- ── 3. Admin listings, rebuilt without the approved column ───────────────────
-- Return types change, so these need a drop rather than CREATE OR REPLACE.

DROP FUNCTION IF EXISTS public.get_recent_signups(int);
CREATE FUNCTION public.get_recent_signups(p_limit int DEFAULT 50)
 RETURNS TABLE(user_id uuid, name text, email text, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT p.id, p.name, u.email::text, u.created_at
    FROM zane_profiles p
    JOIN auth.users u ON u.id = p.id
    ORDER BY u.created_at DESC
    LIMIT GREATEST(p_limit, 1);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_recent_signups(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recent_signups(int) TO authenticated;

DROP FUNCTION IF EXISTS public.get_all_users_admin();
CREATE FUNCTION public.get_all_users_admin()
 RETURNS TABLE(user_id uuid, name text, email text, sw_version text, created_at timestamptz, tier text, plan_count int, last_workout timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT p.id, p.name, u.email::text, us.sw_version, u.created_at, p.tier,
           COALESCE(sc.plan_count, 0)::int AS plan_count, lw.last_workout
    FROM zane_profiles p
    JOIN auth.users u ON u.id = p.id
    LEFT JOIN zane_user_settings us ON us.user_id = p.id
    LEFT JOIN (
      SELECT s.user_id, COUNT(*)::int AS plan_count
      FROM zane_schedules s GROUP BY s.user_id
    ) sc ON sc.user_id = p.id
    LEFT JOIN (
      SELECT ss.user_id, MAX(ss.date) AS last_workout
      FROM zane_sessions ss WHERE ss.ended IS NOT NULL GROUP BY ss.user_id
    ) lw ON lw.user_id = p.id
    ORDER BY u.created_at DESC;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_all_users_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_all_users_admin() TO authenticated;

DROP FUNCTION IF EXISTS public.get_users_with_plans();
CREATE FUNCTION public.get_users_with_plans()
 RETURNS TABLE(user_id uuid, name text, email text, joined_at timestamptz, plan_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT p.id, p.name, u.email::text, u.created_at,
           COUNT(s.id)::int AS plan_count
    FROM zane_profiles p
    JOIN auth.users u ON u.id = p.id
    JOIN zane_schedules s ON s.user_id = p.id
    GROUP BY p.id, p.name, u.email, u.created_at
    ORDER BY u.created_at DESC;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_users_with_plans() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_users_with_plans() TO authenticated;

-- ── 4. The columns themselves ────────────────────────────────────────────────
ALTER TABLE public.zane_profiles  DROP COLUMN IF EXISTS approved;
ALTER TABLE public.zane_app_config DROP COLUMN IF EXISTS signup_requires_approval;
ALTER TABLE public.zane_app_config DROP COLUMN IF EXISTS auto_approve_remaining;
