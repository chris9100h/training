-- Bound Social push fan-out at the database boundary. One Edge invocation now
-- resolves recipients, claims every delivery and finalizes every result in
-- batches instead of multiplying HTTP/PostgREST calls per recipient.

DROP FUNCTION IF EXISTS public.social_take_notification_rate_limit(uuid);

CREATE TABLE IF NOT EXISTS public.zane_notification_maintenance (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_delivery_cleanup_at timestamptz NOT NULL DEFAULT '-infinity'::timestamptz
);
INSERT INTO public.zane_notification_maintenance(id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.zane_notification_maintenance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zane_notification_maintenance FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.social_take_notification_rate_limit(
  p_caller_id uuid,
  p_cost integer DEFAULT 1
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_window timestamptz;
  v_attempts integer;
  v_cost integer := GREATEST(1, LEAST(COALESCE(p_cost, 1), 60));
  v_cleanup_due boolean := false;
BEGIN
  IF p_caller_id IS NULL THEN RETURN false; END IF;
  INSERT INTO public.zane_social_notification_attempts(caller_id, window_started_at, attempts)
  VALUES (p_caller_id, now(), 0) ON CONFLICT (caller_id) DO NOTHING;
  SELECT window_started_at, attempts INTO v_window, v_attempts
    FROM public.zane_social_notification_attempts WHERE caller_id = p_caller_id FOR UPDATE;
  -- Maintenance is global, not tied to this caller's rate-limit window. A
  -- continuously active caller must not prevent delivery-ledger cleanup.
  IF pg_try_advisory_xact_lock(1786173915) THEN
    UPDATE public.zane_notification_maintenance
    SET last_delivery_cleanup_at = now()
    WHERE id = true
      AND last_delivery_cleanup_at < now() - interval '1 hour'
    RETURNING true INTO v_cleanup_due;
    IF COALESCE(v_cleanup_due, false) THEN
      DELETE FROM public.zane_social_notification_deliveries
      WHERE ctid IN (
        SELECT ctid
        FROM public.zane_social_notification_deliveries
        WHERE created_at < now() - interval '30 days'
          AND (last_attempt_at IS NULL OR last_attempt_at < now() - interval '2 minutes')
        ORDER BY created_at
        LIMIT 5000
      );
    END IF;
  END IF;
  IF v_window < now() - interval '1 minute' THEN
    UPDATE public.zane_social_notification_attempts
    SET window_started_at = now(), attempts = v_cost
    WHERE caller_id = p_caller_id;
    RETURN true;
  END IF;
  IF v_attempts + v_cost > 60 THEN RETURN false; END IF;
  UPDATE public.zane_social_notification_attempts
  SET attempts = v_attempts + v_cost
  WHERE caller_id = p_caller_id;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_pending_notification_recipients(
  p_event_key text,
  p_recipient_ids uuid[]
)
RETURNS TABLE(recipient_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT DISTINCT id
  FROM unnest(COALESCE(p_recipient_ids, ARRAY[]::uuid[])) AS ids(id)
  WHERE id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.zane_social_notification_deliveries delivery
      WHERE delivery.event_key = p_event_key
        AND delivery.recipient_id = id
        AND delivery.delivered_at IS NOT NULL
    )
  ORDER BY id;
$function$;

CREATE OR REPLACE FUNCTION public.social_notification_message_recipients(
  p_message_id uuid,
  p_caller_id uuid
)
RETURNS TABLE(recipient_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sender uuid;
  v_recipient uuid;
  v_group uuid;
  v_created timestamptz;
BEGIN
  SELECT m.sender_id, m.recipient_id, m.group_id, m.created_at
  INTO v_sender, v_recipient, v_group, v_created
  FROM public.zane_social_messages m
  WHERE m.id = p_message_id;

  IF NOT FOUND OR v_sender <> p_caller_id OR v_created < now() - interval '24 hours' THEN
    RETURN;
  END IF;

  IF v_recipient IS NOT NULL THEN
    RETURN QUERY
    SELECT v_recipient
    WHERE v_recipient <> v_sender
      AND app_private.social_tab_enabled(v_recipient)
      AND EXISTS (
        SELECT 1 FROM public.zane_social_friendships f
        WHERE f.status = 'accepted'
          AND f.accepted_at IS NOT NULL
          AND f.accepted_at <= v_created
          AND ((f.requester_id = v_sender AND f.addressee_id = v_recipient)
            OR (f.requester_id = v_recipient AND f.addressee_id = v_sender))
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.zane_social_blocks b
        WHERE (b.blocker_id = v_sender AND b.blocked_id = v_recipient)
           OR (b.blocker_id = v_recipient AND b.blocked_id = v_sender)
      );
    RETURN;
  END IF;

  IF v_group IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT gm.user_id
  FROM public.zane_social_group_members gm
  WHERE gm.group_id = v_group
    AND gm.user_id <> v_sender
    AND app_private.social_tab_enabled(gm.user_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.zane_social_group_members other_member
      JOIN public.zane_social_blocks b
        ON (b.blocker_id = gm.user_id AND b.blocked_id = other_member.user_id)
        OR (b.blocker_id = other_member.user_id AND b.blocked_id = gm.user_id)
      WHERE other_member.group_id = v_group
        AND other_member.user_id <> gm.user_id
    )
  ORDER BY gm.user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_notification_friend_started_recipients(
  p_session_id text,
  p_caller_id uuid
)
RETURNS TABLE(recipient_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_owner uuid;
  v_started timestamptz;
  v_ended timestamptz;
  v_visible boolean;
BEGIN
  SELECT s.user_id, s.started_at, s.ended, sp.workouts_visible
  INTO v_owner, v_started, v_ended, v_visible
  FROM public.zane_sessions s
  JOIN public.zane_social_profiles sp ON sp.user_id = s.user_id
  WHERE s.id = p_session_id;

  IF NOT FOUND OR v_owner <> p_caller_id OR v_started IS NULL OR v_ended IS NOT NULL
     OR v_started < now() - interval '24 hours' OR NOT COALESCE(v_visible, false)
     OR NOT app_private.social_tab_enabled(v_owner) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH friends AS (
    SELECT CASE WHEN f.requester_id = v_owner THEN f.addressee_id ELSE f.requester_id END AS friend_id
    FROM public.zane_social_friendships f
    WHERE f.status = 'accepted'
      AND f.accepted_at IS NOT NULL
      AND f.accepted_at <= v_started
      AND (f.requester_id = v_owner OR f.addressee_id = v_owner)
  )
  SELECT DISTINCT friends.friend_id
  FROM friends
  WHERE friends.friend_id <> v_owner
    AND app_private.social_tab_enabled(friends.friend_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.zane_social_blocks b
      WHERE (b.blocker_id = v_owner AND b.blocked_id = friends.friend_id)
         OR (b.blocker_id = friends.friend_id AND b.blocked_id = v_owner)
    )
  ORDER BY friends.friend_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_claim_notification_deliveries(
  p_event_key text,
  p_event_kind text,
  p_recipient_ids uuid[]
)
RETURNS TABLE(recipient_id uuid, claim_token timestamptz, state text)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH requested AS (
    SELECT DISTINCT id AS recipient_id
    FROM unnest(COALESCE(p_recipient_ids, ARRAY[]::uuid[])) AS ids(id)
    WHERE id IS NOT NULL
  ), stamp AS (
    SELECT clock_timestamp() AS claimed_at
  ), claimed AS (
    INSERT INTO public.zane_social_notification_deliveries AS delivery
      (event_key, recipient_id, event_kind, last_attempt_at)
    SELECT p_event_key, requested.recipient_id, p_event_kind, stamp.claimed_at
    FROM requested CROSS JOIN stamp
    WHERE NULLIF(trim(p_event_key), '') IS NOT NULL
    ON CONFLICT (event_key, recipient_id) DO UPDATE
      SET event_kind = EXCLUDED.event_kind,
          last_attempt_at = EXCLUDED.last_attempt_at
      WHERE delivery.delivered_at IS NULL
        AND (delivery.last_attempt_at IS NULL OR delivery.last_attempt_at < now() - interval '2 minutes')
    RETURNING delivery.recipient_id, delivery.last_attempt_at
  )
  SELECT requested.recipient_id,
         claimed.last_attempt_at AS claim_token,
         CASE
           WHEN claimed.recipient_id IS NOT NULL THEN 'claimed'
           WHEN delivery.delivered_at IS NOT NULL THEN 'delivered'
           ELSE 'busy'
         END AS state
  FROM requested
  LEFT JOIN claimed USING (recipient_id)
  LEFT JOIN public.zane_social_notification_deliveries delivery
    ON delivery.event_key = p_event_key AND delivery.recipient_id = requested.recipient_id
  ORDER BY requested.recipient_id;
$function$;

CREATE OR REPLACE FUNCTION public.social_finish_notification_deliveries(
  p_event_key text,
  p_results jsonb
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_changed integer;
  v_total integer := 0;
BEGIN
  IF jsonb_typeof(COALESCE(p_results, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'p_results must be an array';
  END IF;
  FOR v_result IN SELECT value FROM jsonb_array_elements(COALESCE(p_results, '[]'::jsonb))
  LOOP
    UPDATE public.zane_social_notification_deliveries
    SET delivered_at = CASE WHEN COALESCE((v_result->>'delivered')::boolean, false) THEN now() ELSE delivered_at END,
        last_attempt_at = CASE WHEN COALESCE((v_result->>'delivered')::boolean, false) THEN last_attempt_at ELSE NULL END
    WHERE event_key = p_event_key
      AND recipient_id = (v_result->>'recipient_id')::uuid
      AND delivered_at IS NULL
      AND last_attempt_at = (v_result->>'claim_token')::timestamptz;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    v_total := v_total + v_changed;
  END LOOP;
  RETURN v_total;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_take_notification_rate_limit(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.social_pending_notification_recipients(text, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.social_notification_message_recipients(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.social_notification_friend_started_recipients(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.social_claim_notification_deliveries(text, text, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.social_finish_notification_deliveries(text, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.social_take_notification_rate_limit(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.social_pending_notification_recipients(text, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.social_notification_message_recipients(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.social_notification_friend_started_recipients(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.social_claim_notification_deliveries(text, text, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.social_finish_notification_deliveries(text, jsonb) TO service_role;
