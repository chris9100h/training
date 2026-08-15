-- Admin overview: users who have created at least one training plan (schedule).
-- "Onboarded" — they went past just signing up and actually set up their training.
CREATE OR REPLACE FUNCTION public.get_users_with_plans()
RETURNS TABLE(user_id uuid, name text, email text, joined_at timestamptz, approved boolean, plan_count int)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT p.id, p.name, u.email::text, u.created_at, p.approved,
           COUNT(s.id)::int AS plan_count
    FROM zane_profiles p
    JOIN auth.users u ON u.id = p.id
    JOIN zane_schedules s ON s.user_id = p.id
    GROUP BY p.id, p.name, u.email, u.created_at, p.approved
    ORDER BY u.created_at DESC;
END;
$$;
