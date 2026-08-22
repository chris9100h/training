-- One short-lived claim per logical reminder event prevents overlapping cron
-- invocations from sending the same notification concurrently. Provider
-- failure releases the claim; provider success and the user-setting throttle
-- are finalized together.

CREATE TABLE IF NOT EXISTS public.zane_reminder_delivery_claims (
  kind text NOT NULL CHECK (kind IN ('generic', 'water', 'daily-log')),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_key text NOT NULL CHECK (length(event_key) BETWEEN 1 AND 200),
  expected_at timestamptz,
  expected_text text,
  target_text text,
  claim_token uuid NOT NULL,
  claimed_at timestamptz NOT NULL,
  delivered_at timestamptz,
  PRIMARY KEY (kind, user_id, event_key)
);

CREATE INDEX IF NOT EXISTS zane_reminder_delivery_claims_retention_idx
  ON public.zane_reminder_delivery_claims (coalesce(delivered_at, claimed_at));

ALTER TABLE public.zane_reminder_delivery_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zane_reminder_delivery_claims
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.zane_reminder_delivery_claims
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_reminder_delivery(
  p_kind text,
  p_user_id uuid,
  p_expected_at timestamptz,
  p_expected_text text,
  p_target_text text,
  p_claim_token uuid,
  p_claimed_at timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event_key text;
  v_claimed_key text;
BEGIN
  IF p_user_id IS NULL OR p_claim_token IS NULL OR p_claimed_at IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_kind = 'generic' THEN
    IF p_expected_at IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.zane_user_settings AS settings
      WHERE settings.user_id = p_user_id
        AND settings.push_enabled = true
        AND settings.reminder_enabled = true
        AND settings.next_reminder_at = p_expected_at
        AND settings.next_reminder_at <= p_claimed_at
        AND settings.next_reminder_at >= p_claimed_at - interval '1 hour'
    ) THEN
      RETURN NULL;
    END IF;
    v_event_key := to_char(
      p_expected_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    );
  ELSIF p_kind = 'water' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.zane_user_settings AS settings
      WHERE settings.user_id = p_user_id
        AND settings.push_enabled = true
        AND settings.water_reminder_enabled = true
        AND settings.water_last_push_at IS NOT DISTINCT FROM p_expected_at
        AND (
          settings.water_last_push_at IS NULL
          OR settings.water_last_push_at <= p_claimed_at - interval '1 hour'
        )
    ) THEN
      RETURN NULL;
    END IF;
    v_event_key := coalesce(
      to_char(p_expected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'never'
    );
  ELSIF p_kind = 'daily-log' THEN
    IF p_target_text IS NULL
       OR p_target_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR NOT EXISTS (
         SELECT 1
         FROM public.zane_user_settings AS settings
         WHERE settings.user_id = p_user_id
           AND settings.push_enabled = true
           AND settings.daily_log_reminder_enabled = true
           AND settings.daily_log_reminder_last_date IS NOT DISTINCT FROM p_expected_text
           AND settings.daily_log_reminder_last_date IS DISTINCT FROM p_target_text
       )
    THEN
      RETURN NULL;
    END IF;
    v_event_key := p_target_text;
  ELSE
    RETURN NULL;
  END IF;

  INSERT INTO public.zane_reminder_delivery_claims AS claim (
    kind, user_id, event_key, expected_at, expected_text, target_text,
    claim_token, claimed_at, delivered_at
  )
  VALUES (
    p_kind, p_user_id, v_event_key, p_expected_at, p_expected_text, p_target_text,
    p_claim_token, p_claimed_at, NULL
  )
  ON CONFLICT (kind, user_id, event_key) DO UPDATE
  SET expected_at = EXCLUDED.expected_at,
      expected_text = EXCLUDED.expected_text,
      target_text = EXCLUDED.target_text,
      claim_token = EXCLUDED.claim_token,
      claimed_at = EXCLUDED.claimed_at
  WHERE claim.delivered_at IS NULL
    AND claim.claimed_at < now() - interval '15 minutes'
  RETURNING event_key INTO v_claimed_key;

  IF v_claimed_key IS NOT NULL AND pg_try_advisory_xact_lock(1941726301) THEN
    DELETE FROM public.zane_reminder_delivery_claims
    WHERE ctid IN (
      SELECT ctid
      FROM public.zane_reminder_delivery_claims
      WHERE delivered_at < now() - interval '30 days'
      ORDER BY delivered_at
      LIMIT 500
    );
  END IF;

  RETURN v_claimed_key;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finish_reminder_delivery(
  p_kind text,
  p_user_id uuid,
  p_event_key text,
  p_claim_token uuid,
  p_delivered boolean
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_claim public.zane_reminder_delivery_claims%ROWTYPE;
BEGIN
  SELECT claim.*
  INTO v_claim
  FROM public.zane_reminder_delivery_claims AS claim
  WHERE claim.kind = p_kind
    AND claim.user_id = p_user_id
    AND claim.event_key = p_event_key
    AND claim.claim_token = p_claim_token
    AND claim.delivered_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT coalesce(p_delivered, false) THEN
    DELETE FROM public.zane_reminder_delivery_claims
    WHERE kind = p_kind
      AND user_id = p_user_id
      AND event_key = p_event_key
      AND claim_token = p_claim_token
      AND delivered_at IS NULL;
    RETURN FOUND;
  END IF;

  IF p_kind = 'generic' THEN
    UPDATE public.zane_user_settings
    SET next_reminder_at = NULL
    WHERE user_id = p_user_id
      AND next_reminder_at = v_claim.expected_at;
  ELSIF p_kind = 'water' THEN
    UPDATE public.zane_user_settings
    SET water_last_push_at = v_claim.claimed_at
    WHERE user_id = p_user_id
      AND water_last_push_at IS NOT DISTINCT FROM v_claim.expected_at;
  ELSIF p_kind = 'daily-log' THEN
    UPDATE public.zane_user_settings
    SET daily_log_reminder_last_date = v_claim.target_text
    WHERE user_id = p_user_id
      AND daily_log_reminder_last_date IS NOT DISTINCT FROM v_claim.expected_text;
  ELSE
    RETURN false;
  END IF;

  UPDATE public.zane_reminder_delivery_claims
  SET delivered_at = now()
  WHERE kind = p_kind
    AND user_id = p_user_id
    AND event_key = p_event_key
    AND claim_token = p_claim_token
    AND delivered_at IS NULL;
  RETURN FOUND;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.claim_reminder_delivery(
  text, uuid, timestamptz, text, text, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reminder_delivery(
  text, uuid, timestamptz, text, text, uuid, timestamptz
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.finish_reminder_delivery(
  text, uuid, text, uuid, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_reminder_delivery(
  text, uuid, text, uuid, boolean
) TO service_role;
