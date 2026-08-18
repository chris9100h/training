-- Canonical repair after the Friends adversarial review.
--
-- Friend requests are the discovery mechanism for Friends itself, so they
-- must arrive even before the recipient has opened/enabled the Friends tab.
-- The recipient's dedicated friend-request preference is still enforced by
-- zane_social-notify. Blocking and pending-state checks remain server-side.
CREATE OR REPLACE FUNCTION public.social_can_notify_friend_request(p_friendship_id uuid, p_recipient_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.zane_social_friendships f
    WHERE f.id = p_friendship_id
      AND f.addressee_id = p_recipient_id
      AND f.status = 'pending'
      AND NOT EXISTS (
        SELECT 1
        FROM public.zane_social_blocks b
        WHERE (b.blocker_id = f.requester_id AND b.blocked_id = f.addressee_id)
           OR (b.blocker_id = f.addressee_id AND b.blocked_id = f.requester_id)
      )
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.social_can_notify_friend_request(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_can_notify_friend_request(uuid, uuid) TO service_role;

-- Keep one canonical implementation after duplicate definitions in the
-- historical baseline. The bounded opportunistic cleanup prevents the
-- delivery ledger from growing forever without adding another cron job.
CREATE OR REPLACE FUNCTION public.social_take_notification_rate_limit(p_caller_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_window timestamptz; v_attempts integer;
BEGIN
  IF p_caller_id IS NULL THEN RETURN false; END IF;
  INSERT INTO public.zane_social_notification_attempts(caller_id, window_started_at, attempts)
  VALUES (p_caller_id, now(), 0) ON CONFLICT (caller_id) DO NOTHING;
  SELECT window_started_at, attempts INTO v_window, v_attempts
    FROM public.zane_social_notification_attempts WHERE caller_id = p_caller_id FOR UPDATE;
  IF v_window < now() - interval '1 hour' THEN
    DELETE FROM public.zane_social_notification_deliveries WHERE created_at < now() - interval '30 days';
  END IF;
  IF v_window < now() - interval '1 minute' THEN
    UPDATE public.zane_social_notification_attempts SET window_started_at = now(), attempts = 1 WHERE caller_id = p_caller_id;
    RETURN true;
  END IF;
  IF v_attempts >= 120 THEN RETURN false; END IF;
  UPDATE public.zane_social_notification_attempts SET attempts = v_attempts + 1 WHERE caller_id = p_caller_id;
  RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_take_notification_rate_limit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_take_notification_rate_limit(uuid) TO service_role;
