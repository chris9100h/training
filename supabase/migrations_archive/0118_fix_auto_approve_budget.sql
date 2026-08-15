-- Fix: set_auto_approve_budget now approves all currently-pending users first
-- and deducts them from the budget, so the budget means "total approvals to
-- grant" rather than "new signups only". Previously the INSERT-only trigger
-- did not count already-pending users against the budget, causing more users
-- to be let through than intended.
CREATE OR REPLACE FUNCTION public.set_auto_approve_budget(p_count int)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v int := NULLIF(GREATEST(COALESCE(p_count, 0), 0), 0);
  pending_count int;
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Approve all currently-pending users and count them against the budget.
  SELECT COUNT(*) INTO pending_count FROM zane_profiles WHERE approved = false;
  IF pending_count > 0 THEN
    UPDATE zane_profiles SET approved = true WHERE approved = false;
  END IF;

  -- Deduct the pending approvals from the requested budget.
  IF v IS NOT NULL THEN
    v := GREATEST(v - pending_count, 0);
    v := NULLIF(v, 0); -- budget of 0 means re-lock immediately
  END IF;

  INSERT INTO zane_app_config (id, signup_requires_approval, auto_approve_remaining)
  VALUES (1, v IS NULL, v)
  ON CONFLICT (id) DO UPDATE
    SET signup_requires_approval = (v IS NULL),
        auto_approve_remaining = v;
END;
$$;
