-- Close the final notification races at the database boundary:
-- 1. medication reminder claims revalidate the live schedule atomically;
-- 2. browser push registrations are provider-allowlisted and capped;
-- 3. delivery-ledger retention has an index that cannot turn recovery into a
--    table scan storm.

CREATE INDEX IF NOT EXISTS zane_social_notification_deliveries_created_idx
  ON public.zane_social_notification_deliveries (created_at);

ALTER TABLE public.zane_medication_logs
  ADD COLUMN IF NOT EXISTS reminder_claim_token uuid,
  ADD COLUMN IF NOT EXISTS reminder_claimed_at timestamptz;

DROP FUNCTION IF EXISTS public.claim_medication_reminders(uuid, jsonb, timestamptz);
CREATE OR REPLACE FUNCTION public.claim_medication_reminders(
  p_user_id uuid,
  p_claims jsonb,
  p_claim_token uuid,
  p_claimed_at timestamptz DEFAULT now()
)
RETURNS TABLE(id text)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH claims AS (
    SELECT *
    FROM jsonb_to_recordset(
      CASE WHEN jsonb_typeof(COALESCE(p_claims, '[]'::jsonb)) = 'array'
        THEN COALESCE(p_claims, '[]'::jsonb)
        ELSE '[]'::jsonb
      END
    ) AS claim(
      id text,
      expected_reminder_count integer,
      expected_snoozed_until timestamptz,
      target_reminder_count integer,
      expected_time text
    )
  ), claimed AS (
    UPDATE public.zane_medication_logs AS log
    SET reminder_claim_token = p_claim_token,
        reminder_claimed_at = p_claimed_at
    FROM claims AS claim
    WHERE log.id = claim.id
      AND log.user_id = p_user_id
      AND p_claim_token IS NOT NULL
      AND log.planned = true
      AND log.skipped = false
      AND log.schedule_slot_id IS NOT NULL
      AND log.reminder_count = claim.expected_reminder_count
      AND log.snoozed_until IS NOT DISTINCT FROM claim.expected_snoozed_until
      AND (
        log.reminder_claim_token IS NULL
        OR log.reminder_claimed_at IS NULL
        OR log.reminder_claimed_at < now() - interval '15 minutes'
      )
      AND claim.target_reminder_count = claim.expected_reminder_count + 1
      AND claim.target_reminder_count BETWEEN 1 AND 2
      AND EXISTS (
        SELECT 1
        FROM public.zane_medication_schedule_slots AS slot
        JOIN public.zane_medication_plans AS plan
          ON plan.id = slot.medication_plan_id
         AND plan.user_id = p_user_id
         AND plan.active = true
         AND plan.archived = false
         AND plan.is_template = false
        JOIN public.zane_medications AS medication
          ON medication.id = slot.medication_id
         AND medication.user_id = p_user_id
         AND medication.archived = false
        WHERE slot.id = log.schedule_slot_id
          AND slot.user_id = p_user_id
          AND slot.medication_id = log.medication_id
          AND to_char(make_time(slot.hour, 0, 0), 'HH24:MI') = claim.expected_time
          AND (slot.start_date IS NULL OR log.date::date >= slot.start_date)
          AND (slot.end_date IS NULL OR log.date::date <= slot.end_date)
          AND (
            (
              slot.interval_days IS NOT NULL
              AND slot.interval_days > 0
              AND slot.start_date IS NOT NULL
              AND ((log.date::date - slot.start_date) % slot.interval_days) = 0
            )
            OR (
              (slot.interval_days IS NULL OR slot.interval_days <= 0)
              AND ((extract(isodow FROM log.date::date)::integer - 1) = ANY(slot.weekdays))
            )
          )
      )
    RETURNING log.id
  )
  SELECT claimed.id FROM claimed ORDER BY claimed.id;
$function$;

CREATE TABLE IF NOT EXISTS public.zane_push_schedule_claims (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('web-push', 'pushover')),
  nonce text NOT NULL CHECK (length(nonce) BETWEEN 1 AND 200),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel)
);
ALTER TABLE public.zane_push_schedule_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zane_push_schedule_claims FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_push_schedule(
  p_user_id uuid,
  p_channel text,
  p_nonce text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_changed integer := 0;
BEGIN
  IF p_user_id IS NULL
     OR p_channel NOT IN ('web-push', 'pushover')
     OR p_nonce IS NULL
     OR length(p_nonce) NOT BETWEEN 1 AND 200
  THEN
    RETURN false;
  END IF;

  INSERT INTO public.zane_push_schedule_claims(user_id, channel, nonce, updated_at)
  VALUES (p_user_id, p_channel, p_nonce, now())
  ON CONFLICT (user_id, channel) DO UPDATE
  SET nonce = EXCLUDED.nonce,
      updated_at = now()
  WHERE zane_push_schedule_claims.nonce IS DISTINCT FROM EXCLUDED.nonce;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_allowed_web_push_endpoint(p_endpoint text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_host text;
BEGIN
  IF p_endpoint IS NULL
     OR length(p_endpoint) > 2048
     OR p_endpoint !~ '^https://[A-Za-z0-9.-]+(:443)?/[^[:space:]]+$'
  THEN
    RETURN false;
  END IF;
  v_host := lower(substring(p_endpoint FROM '^https://([^/:?#]+)'));
  RETURN v_host IN (
      'fcm.googleapis.com',
      'updates.push.services.mozilla.com',
      'push.services.mozilla.com',
      'web.push.apple.com'
    )
    OR v_host LIKE '%.push.apple.com'
    OR v_host LIKE '%.notify.windows.com';
END;
$function$;

-- Remove only registrations that could never have been produced by a valid
-- browser PushSubscription. Current production rows use web.push.apple.com or
-- fcm.googleapis.com and fit comfortably inside these limits.
DELETE FROM public.zane_push_subscriptions
WHERE id <> endpoint
   OR NOT public.is_allowed_web_push_endpoint(endpoint)
   OR length(p256dh) NOT BETWEEN 40 AND 256
   OR p256dh !~ '^[A-Za-z0-9_-]+={0,2}$'
   OR length(auth) NOT BETWEEN 8 AND 128
   OR auth !~ '^[A-Za-z0-9_-]+={0,2}$';

ALTER TABLE public.zane_push_subscriptions
  DROP CONSTRAINT IF EXISTS zane_push_subscriptions_valid_registration;
ALTER TABLE public.zane_push_subscriptions
  ADD CONSTRAINT zane_push_subscriptions_valid_registration CHECK (
    id = endpoint
    AND public.is_allowed_web_push_endpoint(endpoint)
    AND length(p256dh) BETWEEN 40 AND 256
    AND p256dh ~ '^[A-Za-z0-9_-]+={0,2}$'
    AND length(auth) BETWEEN 8 AND 128
    AND auth ~ '^[A-Za-z0-9_-]+={0,2}$'
  );

DROP POLICY IF EXISTS "users manage own push subscriptions" ON public.zane_push_subscriptions;
DROP POLICY IF EXISTS "users read own push subscriptions" ON public.zane_push_subscriptions;
DROP POLICY IF EXISTS "users delete own push subscriptions" ON public.zane_push_subscriptions;
CREATE POLICY "users read own push subscriptions"
  ON public.zane_push_subscriptions FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);
CREATE POLICY "users delete own push subscriptions"
  ON public.zane_push_subscriptions FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

REVOKE ALL ON TABLE public.zane_push_subscriptions FROM anon, authenticated;
GRANT SELECT, DELETE ON TABLE public.zane_push_subscriptions TO authenticated;

CREATE OR REPLACE FUNCTION public.register_web_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_existing_user_id uuid;
  v_existing_p256dh text;
  v_existing_auth text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF NOT public.is_allowed_web_push_endpoint(p_endpoint)
     OR length(p_p256dh) NOT BETWEEN 40 AND 256
     OR p_p256dh !~ '^[A-Za-z0-9_-]+={0,2}$'
     OR length(p_auth) NOT BETWEEN 8 AND 128
     OR p_auth !~ '^[A-Za-z0-9_-]+={0,2}$'
  THEN
    RAISE EXCEPTION 'invalid push subscription';
  END IF;

  -- Serialize both by endpoint and account. A foreign endpoint can move to a
  -- new login only when the caller also proves possession of its exact browser
  -- subscription keys; knowing a capability URL alone must not evict it.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_endpoint, 934762));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 934761));
  SELECT user_id, p256dh, auth
  INTO v_existing_user_id, v_existing_p256dh, v_existing_auth
  FROM public.zane_push_subscriptions
  WHERE id = p_endpoint
  FOR UPDATE;
  IF FOUND
     AND v_existing_user_id <> v_user_id
     AND (v_existing_p256dh IS DISTINCT FROM p_p256dh OR v_existing_auth IS DISTINCT FROM p_auth)
  THEN
    RAISE EXCEPTION 'invalid push subscription';
  END IF;
  DELETE FROM public.zane_push_subscriptions
  WHERE id = p_endpoint AND user_id <> v_user_id;
  DELETE FROM public.zane_push_subscriptions
  WHERE user_id = v_user_id
    AND id <> p_endpoint
    AND id NOT IN (
      SELECT id
      FROM public.zane_push_subscriptions
      WHERE user_id = v_user_id AND id <> p_endpoint
      ORDER BY created_at DESC, id
      LIMIT 7
    );

  INSERT INTO public.zane_push_subscriptions(id, user_id, endpoint, p256dh, auth, created_at)
  VALUES (p_endpoint, v_user_id, p_endpoint, p_p256dh, p_auth, now())
  ON CONFLICT (id) DO UPDATE
  SET user_id = EXCLUDED.user_id,
      endpoint = EXCLUDED.endpoint,
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      created_at = now();
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.claim_medication_reminders(uuid, jsonb, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_medication_reminders(uuid, jsonb, uuid, timestamptz) TO service_role;
REVOKE EXECUTE ON FUNCTION public.claim_push_schedule(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_schedule(uuid, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.is_allowed_web_push_endpoint(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_allowed_web_push_endpoint(text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.register_web_push_subscription(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_web_push_subscription(text, text, text) TO authenticated;
