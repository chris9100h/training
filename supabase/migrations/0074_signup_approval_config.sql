-- Admin-controlled toggle: do new signups need manual approval?
-- A single-row global config table drives the default value of
-- zane_profiles.approved, so flipping it changes future registrations only —
-- existing pending/approved users are untouched.

CREATE TABLE IF NOT EXISTS public.zane_app_config (
  id int PRIMARY KEY DEFAULT 1,
  signup_requires_approval boolean NOT NULL DEFAULT true,
  CONSTRAINT zane_app_config_singleton CHECK (id = 1)
);

INSERT INTO public.zane_app_config (id, signup_requires_approval)
  VALUES (1, true)
  ON CONFLICT (id) DO NOTHING;

-- Locked down: only SECURITY DEFINER functions below touch this table.
ALTER TABLE public.zane_app_config ENABLE ROW LEVEL SECURITY;

-- New profiles are approved automatically unless approval is currently required.
-- Used as the dynamic column DEFAULT for zane_profiles.approved, so the existing
-- client setup (upsert {id, name}, no approved) picks the right value on INSERT.
CREATE OR REPLACE FUNCTION public.signup_default_approved()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT NOT COALESCE((SELECT signup_requires_approval FROM zane_app_config WHERE id = 1), true);
$$;

ALTER TABLE public.zane_profiles
  ALTER COLUMN approved SET DEFAULT public.signup_default_approved();

-- Admin read of the current setting (for the Settings toggle state).
CREATE OR REPLACE FUNCTION public.get_signup_requires_approval()
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN COALESCE((SELECT signup_requires_approval FROM zane_app_config WHERE id = 1), true);
END;
$$;

-- Admin write of the setting.
CREATE OR REPLACE FUNCTION public.set_signup_requires_approval(p_value boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  INSERT INTO zane_app_config (id, signup_requires_approval)
  VALUES (1, p_value)
  ON CONFLICT (id) DO UPDATE SET signup_requires_approval = EXCLUDED.signup_requires_approval;
END;
$$;
