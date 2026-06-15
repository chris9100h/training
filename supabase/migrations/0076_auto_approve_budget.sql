-- Auto-approve budget guard: open registration for a limited number of signups,
-- then re-lock automatically. A nullable counter on the global config drives it.
ALTER TABLE public.zane_app_config
  ADD COLUMN IF NOT EXISTS auto_approve_remaining int;

-- Consume one unit of budget on each genuinely new signup. AFTER INSERT so it
-- fires only for real inserts (not the ON CONFLICT update path of the profile
-- upsert). When the last unit is consumed, registration re-locks itself
-- (signup_requires_approval flips back on, budget cleared).
CREATE OR REPLACE FUNCTION public.signup_consume_budget()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg record;
BEGIN
  SELECT signup_requires_approval, auto_approve_remaining INTO cfg
  FROM zane_app_config WHERE id = 1 FOR UPDATE;
  IF cfg.signup_requires_approval = false AND cfg.auto_approve_remaining IS NOT NULL THEN
    IF cfg.auto_approve_remaining <= 1 THEN
      UPDATE zane_app_config SET signup_requires_approval = true, auto_approve_remaining = NULL WHERE id = 1;
    ELSE
      UPDATE zane_app_config SET auto_approve_remaining = auto_approve_remaining - 1 WHERE id = 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zane_profiles_consume_budget ON public.zane_profiles;
CREATE TRIGGER zane_profiles_consume_budget
AFTER INSERT ON public.zane_profiles
FOR EACH ROW EXECUTE FUNCTION public.signup_consume_budget();

-- Admin read: master flag + remaining budget in one call.
CREATE OR REPLACE FUNCTION public.get_signup_config()
RETURNS TABLE(requires_approval boolean, auto_approve_remaining int)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT c.signup_requires_approval, c.auto_approve_remaining
    FROM zane_app_config c WHERE c.id = 1;
END;
$$;

-- Admin write: open registration for a batch of p_count signups, then re-lock.
-- p_count <= 0 re-locks immediately (clears any budget).
CREATE OR REPLACE FUNCTION public.set_auto_approve_budget(p_count int)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v int := NULLIF(GREATEST(COALESCE(p_count, 0), 0), 0);
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  INSERT INTO zane_app_config (id, signup_requires_approval, auto_approve_remaining)
  VALUES (1, v IS NULL, v)
  ON CONFLICT (id) DO UPDATE
    SET signup_requires_approval = (v IS NULL),
        auto_approve_remaining = v;
END;
$$;

-- Manually toggling approval clears any active budget (it overrides the guard).
CREATE OR REPLACE FUNCTION public.set_signup_requires_approval(p_value boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  INSERT INTO zane_app_config (id, signup_requires_approval, auto_approve_remaining)
  VALUES (1, p_value, NULL)
  ON CONFLICT (id) DO UPDATE
    SET signup_requires_approval = EXCLUDED.signup_requires_approval,
        auto_approve_remaining = NULL;
END;
$$;
