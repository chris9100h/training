-- Live seat counter for the public landing page.
--
-- welcome.html sells the founding offer ("the first 75 never pay") and until now
-- had no way to say how many seats are actually left. A hardcoded number would
-- go stale the moment somebody qualifies, and on the one time-limited claim on
-- the page a stale number is worse than none.
--
-- welcome.html runs without a login, so this needs anon EXECUTE. That makes it
-- the second function ever granted to anon, after get_public_feature_map. Both
-- return only what the page renders anyway.
--
-- What leaves the database is two integers. No identity, no timestamps, nothing
-- per-account: you cannot tell from the answer WHO holds a seat, only how many
-- are gone. SECURITY DEFINER is required because anon can read neither
-- zane_profiles (RLS) nor zane_app_config.
--
-- The seat arithmetic deliberately duplicates grant_lifetime_if_qualified():
-- count of profiles at tier 'lifetime' against zane_app_config.lifetime_seats_total,
-- same fallback of 75 if the config row is missing. If that definition ever
-- changes, change it in both places or the page will advertise seats the trigger
-- will not hand out.

CREATE OR REPLACE FUNCTION public.get_founding_seats()
 RETURNS TABLE (total int, taken int, remaining int)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.total,
         s.taken,
         -- Clamped: lowering lifetime_seats_total below the number already
         -- granted must read as "none left", never as a negative count.
         GREATEST(t.total - s.taken, 0) AS remaining
    FROM (SELECT COALESCE((SELECT lifetime_seats_total FROM zane_app_config WHERE id = 1), 75)::int AS total) t,
         (SELECT COUNT(*)::int AS taken FROM zane_profiles WHERE tier = 'lifetime') s;
$function$;

-- Grant-Fallen: CREATE FUNCTION hands EXECUTE to PUBLIC, which anon inherits.
-- Revoke first, then grant deliberately. anon is intended here.
REVOKE EXECUTE ON FUNCTION public.get_founding_seats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_founding_seats() TO anon, authenticated;

COMMENT ON FUNCTION public.get_founding_seats() IS
  'Aggregate founding-seat count for the login-free landing page: total, taken, remaining. Granted to anon by design (second such function after get_public_feature_map). Returns no per-user data. Seat definition must stay in sync with grant_lifetime_if_qualified().';
