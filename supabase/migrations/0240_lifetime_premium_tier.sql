-- Account tier, and the founding-member grant that fills it.
--
-- The first 75 accounts to genuinely use the app keep everything for free
-- permanently. "Genuinely use" is deliberately two conditions, not one:
--
--   * 5 completed workouts, and
--   * 150 minutes of logged training time in total
--
-- The workout count alone is trivially gameable now that the landing page
-- states it publicly: someone could start and end five sessions in under a
-- minute. The time floor is not advertised anywhere, and it is set low enough
-- that anyone actually training clears it without thinking (accounts that
-- already qualify average around 25 hours) while a click-through run does not.
--
-- `tier` is intentionally a text enum rather than a boolean, because the same
-- column has to carry 'premium' once paid plans exist, and the chip in the app
-- reads it directly.

-- ── 1. The column ────────────────────────────────────────────────────────────
ALTER TABLE public.zane_profiles
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS tier_granted_at timestamptz;

ALTER TABLE public.zane_profiles
  DROP CONSTRAINT IF EXISTS zane_profiles_tier_check;
ALTER TABLE public.zane_profiles
  ADD CONSTRAINT zane_profiles_tier_check CHECK (tier IN ('free', 'lifetime', 'premium'));

COMMENT ON COLUMN public.zane_profiles.tier IS
  'Account tier: free (default), lifetime (founding member, never pays), premium (paid). Granted automatically by grant_lifetime_if_qualified(); never written by the client.';

-- ── 2. Seat count lives in config so it can be raised without a deploy ───────
ALTER TABLE public.zane_app_config
  ADD COLUMN IF NOT EXISTS lifetime_seats_total int NOT NULL DEFAULT 75;

-- ── 3. Backfill everyone who already qualifies ───────────────────────────────
-- Ordered by when each account crossed the line, so if there were ever more
-- qualifying accounts than seats the earliest ones would win. Currently 21 of
-- 75, so the ordering is academic, but it makes the rule explicit.
WITH qualified AS (
  SELECT s.user_id,
         MIN(s.ended) AS first_ended,
         COUNT(*) FILTER (WHERE s.ended IS NOT NULL) AS workouts,
         COALESCE(SUM(s.duration_minutes) FILTER (WHERE s.ended IS NOT NULL), 0) AS mins
  FROM zane_sessions s
  GROUP BY s.user_id
  HAVING COUNT(*) FILTER (WHERE s.ended IS NOT NULL) >= 5
     AND COALESCE(SUM(s.duration_minutes) FILTER (WHERE s.ended IS NOT NULL), 0) >= 150
),
ranked AS (
  SELECT user_id, ROW_NUMBER() OVER (ORDER BY first_ended ASC) AS rn
  FROM qualified
)
UPDATE zane_profiles p
   SET tier = 'lifetime',
       tier_granted_at = now()
  FROM ranked r
 WHERE p.id = r.user_id
   AND p.tier = 'free'
   AND r.rn <= (SELECT lifetime_seats_total FROM zane_app_config WHERE id = 1);

-- ── 4. The grant, evaluated whenever a session is finished ───────────────────
-- SECURITY DEFINER because it writes zane_profiles, which the training user
-- cannot update directly under RLS. The function is closed: it takes no
-- arguments, reads only the row being touched, and can only ever move an
-- account from 'free' to 'lifetime'.
CREATE OR REPLACE FUNCTION public.grant_lifetime_if_qualified()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tier      text;
  v_workouts  int;
  v_minutes   int;
  v_taken     int;
  v_total     int;
BEGIN
  -- Only a finished session can push someone over the line.
  IF NEW.ended IS NULL THEN
    RETURN NEW;
  END IF;

  -- Cheapest possible exit for the overwhelming majority of writes: anyone who
  -- already holds a tier is done, and this runs on every session update.
  SELECT tier INTO v_tier FROM zane_profiles WHERE id = NEW.user_id;
  IF v_tier IS NULL OR v_tier <> 'free' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) FILTER (WHERE ended IS NOT NULL),
         COALESCE(SUM(duration_minutes) FILTER (WHERE ended IS NOT NULL), 0)
    INTO v_workouts, v_minutes
    FROM zane_sessions
   WHERE user_id = NEW.user_id;

  IF v_workouts < 5 OR v_minutes < 150 THEN
    RETURN NEW;
  END IF;

  -- Serialise the seat check so two accounts qualifying at the same moment
  -- cannot both take the last seat.
  PERFORM pg_advisory_xact_lock(hashtext('zane_lifetime_seats'));

  SELECT COUNT(*) INTO v_taken FROM zane_profiles WHERE tier = 'lifetime';
  SELECT lifetime_seats_total INTO v_total FROM zane_app_config WHERE id = 1;

  IF v_taken >= COALESCE(v_total, 75) THEN
    RETURN NEW;
  END IF;

  UPDATE zane_profiles
     SET tier = 'lifetime',
         tier_granted_at = now()
   WHERE id = NEW.user_id
     AND tier = 'free';

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.grant_lifetime_if_qualified() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zane_sessions_grant_lifetime ON public.zane_sessions;
CREATE TRIGGER zane_sessions_grant_lifetime
  AFTER INSERT OR UPDATE OF ended ON public.zane_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.grant_lifetime_if_qualified();

-- ── 5. Guard: the client owns its profile row, but not its own tier ──────────
-- zane_profiles' "own profile" policy is FOR ALL with auth.uid() = id, so the
-- account holder can write their own row. Without this trigger anyone holding
-- the anon key could PATCH their profile to tier = 'lifetime' directly against
-- the REST API and skip the workouts entirely.
--
-- The check is on current_user rather than a session flag: client traffic
-- always arrives as anon/authenticated, while the grant above runs SECURITY
-- DEFINER as the function owner and service_role tooling as service_role.
-- Silently reverting rather than raising keeps ordinary profile updates (name
-- changes) working even when the client round-trips the whole row.
CREATE OR REPLACE FUNCTION public.zane_profiles_protect_tier()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF NEW.tier IS DISTINCT FROM OLD.tier
     OR NEW.tier_granted_at IS DISTINCT FROM OLD.tier_granted_at THEN
    NEW.tier := OLD.tier;
    NEW.tier_granted_at := OLD.tier_granted_at;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.zane_profiles_protect_tier() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zane_profiles_protect_tier ON public.zane_profiles;
CREATE TRIGGER zane_profiles_protect_tier
  BEFORE UPDATE ON public.zane_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.zane_profiles_protect_tier();
