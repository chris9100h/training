-- Keep the service-side notification ledger bounded. It is intentionally
-- pruned from the existing rate-limit path so no public cron endpoint is
-- needed and a quiet system does not create extra database work.
BEGIN;

CREATE OR REPLACE FUNCTION public.social_take_notification_rate_limit(p_caller_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_window timestamptz;
  v_attempts integer;
BEGIN
  IF p_caller_id IS NULL THEN RETURN false; END IF;

  INSERT INTO public.zane_social_notification_attempts(caller_id, window_started_at, attempts)
  VALUES (p_caller_id, now(), 0)
  ON CONFLICT (caller_id) DO NOTHING;

  SELECT window_started_at, attempts
    INTO v_window, v_attempts
    FROM public.zane_social_notification_attempts
   WHERE caller_id = p_caller_id
   FOR UPDATE;

  -- Notification deliveries are operational state, not user history. When a
  -- caller is active after an hour-long gap, prune entries older than 30 days
  -- using the supporting created_at index.
  IF v_window < now() - interval '1 hour' THEN
    DELETE FROM public.zane_social_notification_deliveries
     WHERE created_at < now() - interval '30 days';
  END IF;

  IF v_window < now() - interval '1 minute' THEN
    UPDATE public.zane_social_notification_attempts
       SET window_started_at = now(), attempts = 1
     WHERE caller_id = p_caller_id;
    RETURN true;
  END IF;

  IF v_attempts >= 120 THEN RETURN false; END IF;
  UPDATE public.zane_social_notification_attempts
     SET attempts = v_attempts + 1
   WHERE caller_id = p_caller_id;
  RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_take_notification_rate_limit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_take_notification_rate_limit(uuid) TO service_role;

COMMIT;
