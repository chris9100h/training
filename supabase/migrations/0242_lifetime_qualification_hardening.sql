-- Harden the founding-member qualification against forged session data.
--
-- The rule shipped in 0240 was "5 completed workouts AND 150 total minutes",
-- read straight from zane_sessions.duration_minutes. Every input to that is a
-- client-supplied value: duration_minutes, ended and date are all written by the
-- app and therefore by anyone holding the anon key. The intended bar of "you
-- actually trained" was clickable in about ten seconds:
--
--   click five sessions through, set one of them to 150 minutes, done.
--
-- No amount of arithmetic over client columns fixes that, so this adds the one
-- thing the client cannot forge: a server-side timestamp, written by a trigger
-- with now(), immutable once set.
--
-- The rule becomes:
--   * >= 5 completed workouts                      (unchanged)
--   * >= 150 minutes, counting at most 120 per session
--   * completed on >= 3 distinct days, by SERVER date
--
-- The per-session cap kills the "one 150-minute session" shortcut and also
-- discards genuinely absurd values already in the data (one real account has a
-- 1475-minute session, a workout left open overnight and closed by the cron).
-- The day spread is the real defence: forging it now costs three calendar days
-- of real waiting, which is far more effort than simply training, especially for
-- an account tier whose only benefit is a product that is currently free anyway.
--
-- Verified against live data before changing anything: all 21 accounts holding a
-- seat legitimately clear the stricter rule, with the lowest at 293 capped
-- minutes over 11 distinct days. Exactly one account fails it, the test account
-- that demonstrated the exploit.

-- ── 1. The one column a client cannot write ──────────────────────────────────
ALTER TABLE public.zane_sessions
  ADD COLUMN IF NOT EXISTS completed_server_at timestamptz;

COMMENT ON COLUMN public.zane_sessions.completed_server_at IS
  'Server clock at the moment this session was first seen as completed. Written only by zane_sessions_stamp_completion, immutable afterwards, never accepted from the client. The founding-member day-spread check reads this rather than `ended`, which is client-supplied.';

-- Backfill from `ended` for rows that predate the column. These are trusted:
-- they were written before the qualification rule existed, so there was nothing
-- to game at the time.
UPDATE public.zane_sessions
   SET completed_server_at = ended
 WHERE ended IS NOT NULL
   AND completed_server_at IS NULL;

-- ── 2. Stamp it, and refuse client writes to it ──────────────────────────────
CREATE OR REPLACE FUNCTION public.zane_sessions_stamp_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Whatever the client sent for this column is discarded outright.
    NEW.completed_server_at := CASE WHEN NEW.ended IS NOT NULL THEN now() ELSE NULL END;
    RETURN NEW;
  END IF;

  -- Once stamped, the value is frozen: reopening and re-closing a session
  -- cannot mint a second qualifying day.
  IF OLD.completed_server_at IS NOT NULL THEN
    NEW.completed_server_at := OLD.completed_server_at;
  ELSIF NEW.ended IS NOT NULL THEN
    NEW.completed_server_at := now();
  ELSE
    NEW.completed_server_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.zane_sessions_stamp_completion() FROM PUBLIC, anon, authenticated;

-- BEFORE, so the stamp is in place by the time the AFTER grant trigger reads it.
DROP TRIGGER IF EXISTS zane_sessions_stamp_completion ON public.zane_sessions;
CREATE TRIGGER zane_sessions_stamp_completion
  BEFORE INSERT OR UPDATE ON public.zane_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.zane_sessions_stamp_completion();

-- ── 3. The stricter grant ────────────────────────────────────────────────────
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
  v_days      int;
  v_taken     int;
  v_total     int;
BEGIN
  IF NEW.ended IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tier INTO v_tier FROM zane_profiles WHERE id = NEW.user_id;
  IF v_tier IS NULL OR v_tier <> 'free' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) FILTER (WHERE ended IS NOT NULL),
         -- Cap per session: a single long entry cannot carry the whole total.
         COALESCE(SUM(LEAST(COALESCE(duration_minutes, 0), 120))
                  FILTER (WHERE ended IS NOT NULL), 0),
         -- Server dates only. `ended` is client-supplied and would be trivial
         -- to spread across three days in a single request.
         COUNT(DISTINCT date(completed_server_at)) FILTER (WHERE completed_server_at IS NOT NULL)
    INTO v_workouts, v_minutes, v_days
    FROM zane_sessions
   WHERE user_id = NEW.user_id;

  IF v_workouts < 5 OR v_minutes < 150 OR v_days < 3 THEN
    RETURN NEW;
  END IF;

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

-- ── 4. Reclaim seats that the old rule handed out by mistake ─────────────────
-- Scoped to accounts that fail the stricter rule, which is only the account that
-- demonstrated the exploit. Every legitimately held seat clears it comfortably,
-- so no real user is demoted. Freeing the seat also returns it to the pool.
WITH stats AS (
  SELECT user_id,
         COUNT(*) FILTER (WHERE ended IS NOT NULL) AS workouts,
         COALESCE(SUM(LEAST(COALESCE(duration_minutes, 0), 120))
                  FILTER (WHERE ended IS NOT NULL), 0) AS capped_minutes,
         COUNT(DISTINCT date(completed_server_at)) FILTER (WHERE completed_server_at IS NOT NULL) AS days
  FROM zane_sessions
  GROUP BY user_id
)
UPDATE zane_profiles p
   SET tier = 'free',
       tier_granted_at = NULL
 WHERE p.tier = 'lifetime'
   AND NOT EXISTS (
     SELECT 1 FROM stats s
      WHERE s.user_id = p.id
        AND s.workouts >= 5
        AND s.capped_minutes >= 150
        AND s.days >= 3
   );
