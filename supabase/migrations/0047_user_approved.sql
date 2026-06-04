-- Add approved flag to profiles; existing users are already approved
ALTER TABLE public.zane_profiles ADD COLUMN IF NOT EXISTS approved boolean DEFAULT false;
UPDATE public.zane_profiles SET approved = true WHERE approved IS DISTINCT FROM true;

-- List unapproved users (admin only)
CREATE OR REPLACE FUNCTION public.get_pending_users()
RETURNS TABLE(user_id uuid, name text, email text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT p.id, p.name, u.email::text, u.created_at
    FROM zane_profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.approved = false
    ORDER BY u.created_at ASC;
END;
$$;

-- Approve a user (admin only)
CREATE OR REPLACE FUNCTION public.approve_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE zane_profiles SET approved = true WHERE id = p_user_id;
END;
$$;

-- Decline a pending user (admin only) — removes profile only; auth user stays but
-- lands on pending screen again if they log in, or gets a clean sign-out if profile
-- creation fails (handled in client code).
CREATE OR REPLACE FUNCTION public.decline_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM zane_profiles WHERE id = p_user_id AND approved = false) THEN
    RAISE EXCEPTION 'User not found or already approved';
  END IF;
  DELETE FROM zane_profiles WHERE id = p_user_id;
END;
$$;
