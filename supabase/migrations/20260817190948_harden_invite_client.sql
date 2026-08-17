-- invite_client(p_email) is reachable by ANY authenticated user, not only
-- coaches, and answers a distinguishable 'ERROR:not_found' for an address
-- nobody registered versus a coaching id or 'ERROR:exists'/'ERROR:already_
-- coached' for one that exists. That is a registration oracle: an attacker can
-- walk a list of addresses and learn which ones have an account here, and can
-- also spam a pending coaching invite at every address that does.
--
-- Two changes, deliberately leaving the error copy alone so a coach still
-- learns whether they mistyped an address:
--   1. A per-caller rate limit, so walking a list is no longer practical.
--   2. The explicit grants the function never had. Postgres grants EXECUTE to
--      PUBLIC on CREATE FUNCTION and an ALTER DEFAULT PRIVILEGES rule hands it
--      to authenticated, so this function's ACL was inherited rather than
--      intended (see the grant traps section in docs/database.md).

CREATE TABLE IF NOT EXISTS public.zane_invite_attempts (
  caller_id         uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempts          integer     NOT NULL DEFAULT 0
);
-- Only ever touched by this SECURITY DEFINER function, never by a client.
ALTER TABLE public.zane_invite_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zane_invite_attempts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.invite_client(p_email text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_client_id uuid;
  v_id        text;
  v_existing  text;
  v_schema    jsonb;
  v_window    timestamptz;
  v_attempts  integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Counted BEFORE the lookup, so a failed probe costs the attacker the same
  -- budget as a real invite. Counting only successes would leave the oracle
  -- wide open, since enumeration is built entirely out of misses.
  INSERT INTO public.zane_invite_attempts(caller_id, window_started_at, attempts)
  VALUES (auth.uid(), now(), 0) ON CONFLICT (caller_id) DO NOTHING;
  SELECT window_started_at, attempts INTO v_window, v_attempts
    FROM public.zane_invite_attempts WHERE caller_id = auth.uid() FOR UPDATE;
  IF v_window < now() - interval '1 hour' THEN
    UPDATE public.zane_invite_attempts
      SET window_started_at = now(), attempts = 1 WHERE caller_id = auth.uid();
  ELSIF v_attempts >= 10 THEN
    RETURN 'ERROR:rate_limited';
  ELSE
    UPDATE public.zane_invite_attempts
      SET attempts = v_attempts + 1 WHERE caller_id = auth.uid();
  END IF;

  v_client_id := find_user_by_email(p_email);
  IF v_client_id IS NULL THEN
    RETURN 'ERROR:not_found';
  END IF;
  IF v_client_id = auth.uid() THEN
    RETURN 'ERROR:self';
  END IF;
  SELECT id INTO v_existing FROM zane_coaching
    WHERE coach_id = auth.uid() AND client_id = v_client_id
      AND id NOT LIKE 'support_%';
  IF FOUND THEN
    RETURN 'ERROR:exists:' || v_existing;
  END IF;
  PERFORM 1 FROM zane_coaching
    WHERE client_id = v_client_id AND status = 'active'
      AND coach_id <> client_id AND id NOT LIKE 'support_%';
  IF FOUND THEN
    RETURN 'ERROR:already_coached';
  END IF;
  SELECT default_checkin_schema INTO v_schema
    FROM zane_user_settings WHERE user_id = auth.uid();
  v_id := 'cch_' || gen_random_uuid()::text;
  INSERT INTO zane_coaching (id, coach_id, client_id, status, checkin_schema)
    VALUES (v_id, auth.uid(), v_client_id, 'pending', v_schema);
  RETURN v_id;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.invite_client(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_client(text) TO authenticated;
