-- Friends audit hardening. This migration is intentionally reversible through
-- admin_set_social_transport(): Broadcast is the normal transport, while the
-- legacy path restores the old publication and FULL replica identities.

BEGIN;

-- Server-only notification rate state. The service role is the only caller;
-- clients must never be able to manufacture notification attempts.
CREATE TABLE IF NOT EXISTS public.zane_social_notification_attempts (
  caller_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);

ALTER TABLE public.zane_social_notification_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zane_social_notification_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.zane_social_notification_attempts TO service_role;

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

-- These helpers are deliberately service-role-only. Edge Functions use them
-- after resolving the caller from its JWT; no client can ask whether an
-- arbitrary pair is currently entitled to a push.
CREATE OR REPLACE FUNCTION public.social_can_notify_message(p_message_id uuid, p_recipient_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sender uuid;
  v_recipient uuid;
  v_group uuid;
  v_created timestamptz;
BEGIN
  IF p_message_id IS NULL OR p_recipient_id IS NULL THEN RETURN false; END IF;
  SELECT sender_id, recipient_id, group_id, created_at
    INTO v_sender, v_recipient, v_group, v_created
    FROM public.zane_social_messages
   WHERE id = p_message_id;
  IF NOT FOUND OR v_sender = p_recipient_id OR v_created < now() - interval '24 hours' THEN RETURN false; END IF;

  IF v_recipient IS NOT NULL THEN
    RETURN v_recipient = p_recipient_id
      AND EXISTS (
        SELECT 1 FROM public.zane_social_friendships f
        WHERE f.status = 'accepted'
          AND f.accepted_at IS NOT NULL
          AND f.accepted_at <= v_created
          AND ((f.requester_id = v_sender AND f.addressee_id = p_recipient_id)
            OR (f.requester_id = p_recipient_id AND f.addressee_id = v_sender))
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.zane_social_blocks b
        WHERE (b.blocker_id = v_sender AND b.blocked_id = p_recipient_id)
           OR (b.blocker_id = p_recipient_id AND b.blocked_id = v_sender)
      );
  END IF;

  IF v_group IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.zane_social_group_members gm
    WHERE gm.group_id = v_group AND gm.user_id = p_recipient_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.zane_social_group_members gm
    JOIN public.zane_social_blocks b
      ON (b.blocker_id = p_recipient_id AND b.blocked_id = gm.user_id)
      OR (b.blocker_id = gm.user_id AND b.blocked_id = p_recipient_id)
    WHERE gm.group_id = v_group AND gm.user_id <> p_recipient_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_can_notify_finished_comment(p_comment_id uuid, p_recipient_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_author uuid;
  v_created timestamptz;
  v_owner uuid;
  v_started timestamptz;
  v_ended timestamptz;
  v_visible boolean;
BEGIN
  IF p_comment_id IS NULL OR p_recipient_id IS NULL THEN RETURN false; END IF;
  SELECT wc.author_id, wc.created_at, s.user_id, COALESCE(s.started_at, s.date::timestamptz), s.ended, sp.workouts_visible
    INTO v_author, v_created, v_owner, v_started, v_ended, v_visible
    FROM public.zane_social_workout_comments wc
    JOIN public.zane_sessions s ON s.id = wc.session_id
    JOIN public.zane_social_profiles sp ON sp.user_id = s.user_id
   WHERE wc.id = p_comment_id;
  IF NOT FOUND OR v_owner <> p_recipient_id OR v_author = p_recipient_id
     OR v_ended IS NULL OR v_created < v_ended OR v_created < now() - interval '7 days'
     OR NOT COALESCE(v_visible, false) THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.zane_social_friendships f
    WHERE f.status = 'accepted'
      AND f.accepted_at IS NOT NULL
      AND f.accepted_at <= v_started
      AND ((f.requester_id = p_recipient_id AND f.addressee_id = v_author)
        OR (f.requester_id = v_author AND f.addressee_id = p_recipient_id))
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.zane_social_blocks b
    WHERE (b.blocker_id = p_recipient_id AND b.blocked_id = v_author)
       OR (b.blocker_id = v_author AND b.blocked_id = p_recipient_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_can_notify_friend_started(p_session_id text, p_recipient_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_owner uuid;
  v_started timestamptz;
  v_ended timestamptz;
  v_visible boolean;
BEGIN
  IF NULLIF(trim(p_session_id), '') IS NULL OR p_recipient_id IS NULL THEN RETURN false; END IF;
  SELECT s.user_id, s.started_at, s.ended, sp.workouts_visible
    INTO v_owner, v_started, v_ended, v_visible
    FROM public.zane_sessions s
    JOIN public.zane_social_profiles sp ON sp.user_id = s.user_id
   WHERE s.id = p_session_id;
  IF NOT FOUND OR v_started IS NULL OR v_ended IS NOT NULL OR v_started < now() - interval '24 hours'
     OR v_owner = p_recipient_id OR NOT COALESCE(v_visible, false) THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.zane_social_friendships f
    WHERE f.status = 'accepted'
      AND f.accepted_at IS NOT NULL
      AND f.accepted_at <= v_started
      AND ((f.requester_id = v_owner AND f.addressee_id = p_recipient_id)
        OR (f.requester_id = p_recipient_id AND f.addressee_id = v_owner))
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.zane_social_blocks b
    WHERE (b.blocker_id = v_owner AND b.blocked_id = p_recipient_id)
       OR (b.blocker_id = p_recipient_id AND b.blocked_id = v_owner)
  );
END;
$function$;

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
        SELECT 1 FROM public.zane_social_blocks b
        WHERE (b.blocker_id = f.requester_id AND b.blocked_id = f.addressee_id)
           OR (b.blocker_id = f.addressee_id AND b.blocked_id = f.requester_id)
      )
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.social_can_notify_message(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.social_can_notify_finished_comment(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.social_can_notify_friend_started(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.social_can_notify_friend_request(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_can_notify_message(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.social_can_notify_finished_comment(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.social_can_notify_friend_started(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.social_can_notify_friend_request(uuid, uuid) TO service_role;

-- Do not expose group membership as an oracle for an arbitrary user id.
CREATE OR REPLACE FUNCTION public.social_is_group_member(p_group_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND p_group_id IS NOT NULL
    AND p_user_id IS NOT NULL
    AND p_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.zane_social_group_members
      WHERE group_id = p_group_id AND user_id = p_user_id
    );
$function$;

-- Current access is re-evaluated for both attachment metadata and the private
-- Storage object itself. A signed URL is not a substitute for this policy.
DROP POLICY IF EXISTS "social attachment read" ON public.zane_social_message_attachments;
CREATE POLICY "social attachment read" ON public.zane_social_message_attachments
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.zane_social_messages m
  WHERE m.id = message_id AND (
    m.sender_id = (select auth.uid())
    OR (m.recipient_id = (select auth.uid()) AND EXISTS (
      SELECT 1 FROM public.zane_social_friendships f
      WHERE f.status = 'accepted'
        AND ((f.requester_id = (select auth.uid()) AND f.addressee_id = m.sender_id)
          OR (f.requester_id = m.sender_id AND f.addressee_id = (select auth.uid())))
        AND NOT EXISTS (SELECT 1 FROM public.zane_social_blocks b WHERE (b.blocker_id = (select auth.uid()) AND b.blocked_id = m.sender_id) OR (b.blocker_id = m.sender_id AND b.blocked_id = (select auth.uid())))
    ))
    OR (m.group_id IS NOT NULL AND public.social_group_visible(m.group_id, (select auth.uid())))
  )
));

DROP POLICY IF EXISTS "social attachment storage read" ON storage.objects;
CREATE POLICY "social attachment storage read" ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'social-chat-attachments' AND EXISTS (
    SELECT 1
    FROM public.zane_social_message_attachments a
    JOIN public.zane_social_messages m ON m.id = a.message_id
    WHERE a.storage_path = name
      AND (
        m.sender_id = (select auth.uid())
        OR (m.recipient_id = (select auth.uid()) AND EXISTS (
          SELECT 1 FROM public.zane_social_friendships f
          WHERE f.status = 'accepted'
            AND ((f.requester_id = (select auth.uid()) AND f.addressee_id = m.sender_id)
              OR (f.requester_id = m.sender_id AND f.addressee_id = (select auth.uid())))
            AND NOT EXISTS (SELECT 1 FROM public.zane_social_blocks b WHERE (b.blocker_id = (select auth.uid()) AND b.blocked_id = m.sender_id) OR (b.blocker_id = m.sender_id AND b.blocked_id = (select auth.uid())))
        ))
        OR (m.group_id IS NOT NULL AND public.social_group_visible(m.group_id, (select auth.uid())))
      )
  )
);

DROP POLICY IF EXISTS "social own message reads" ON public.zane_social_message_reads;
CREATE POLICY "social own message reads" ON public.zane_social_message_reads
FOR ALL TO authenticated
USING (
  user_id = (select auth.uid()) AND EXISTS (
    SELECT 1 FROM public.zane_social_messages m
    WHERE m.id = message_id AND (
      m.sender_id = (select auth.uid())
      OR (m.recipient_id = (select auth.uid()) AND EXISTS (
        SELECT 1 FROM public.zane_social_friendships f
        WHERE f.status = 'accepted'
          AND ((f.requester_id = (select auth.uid()) AND f.addressee_id = m.sender_id)
            OR (f.requester_id = m.sender_id AND f.addressee_id = (select auth.uid())))
          AND NOT EXISTS (SELECT 1 FROM public.zane_social_blocks b WHERE (b.blocker_id = (select auth.uid()) AND b.blocked_id = m.sender_id) OR (b.blocker_id = m.sender_id AND b.blocked_id = (select auth.uid())))
      ))
      OR (m.group_id IS NOT NULL AND public.social_group_visible(m.group_id, (select auth.uid())))
    )
  )
)
WITH CHECK (
  user_id = (select auth.uid()) AND EXISTS (
    SELECT 1 FROM public.zane_social_messages m
    WHERE m.id = message_id AND (
      m.sender_id = (select auth.uid())
      OR (m.recipient_id = (select auth.uid()) AND EXISTS (
        SELECT 1 FROM public.zane_social_friendships f
        WHERE f.status = 'accepted'
          AND ((f.requester_id = (select auth.uid()) AND f.addressee_id = m.sender_id)
            OR (f.requester_id = m.sender_id AND f.addressee_id = (select auth.uid())))
          AND NOT EXISTS (SELECT 1 FROM public.zane_social_blocks b WHERE (b.blocker_id = (select auth.uid()) AND b.blocked_id = m.sender_id) OR (b.blocker_id = m.sender_id AND b.blocked_id = (select auth.uid())))
      ))
      OR (m.group_id IS NOT NULL AND public.social_group_visible(m.group_id, (select auth.uid())))
    )
  )
);

-- A read receipt is private to its writer. It must not fan out to every
-- participant and turn a single open-chat into a request storm.
CREATE OR REPLACE FUNCTION app_private.broadcast_social_read_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
  PERFORM app_private.broadcast_social_user((v_row->>'user_id')::uuid, 'messages');
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DROP TRIGGER IF EXISTS zane_social_broadcast_invalidate ON public.zane_social_message_reads;
CREATE TRIGGER zane_social_broadcast_invalidate
AFTER INSERT OR UPDATE OR DELETE ON public.zane_social_message_reads
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_social_read_change();
REVOKE EXECUTE ON FUNCTION app_private.broadcast_social_read_change() FROM PUBLIC, anon, authenticated, service_role;

-- The direct-message branch must obey the same current block relation as the
-- group branch. Otherwise a blocked DM kept the unread badge alive.
CREATE OR REPLACE FUNCTION public.social_get_badge()
RETURNS TABLE(incoming_count integer, unread_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM app_private.require_social_available();
  RETURN QUERY
  SELECT
    (SELECT count(*)::integer FROM public.zane_social_friendships f
      WHERE f.addressee_id = v_uid AND f.status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM public.zane_social_blocks b WHERE (b.blocker_id = v_uid AND b.blocked_id = f.requester_id) OR (b.blocker_id = f.requester_id AND b.blocked_id = v_uid))),
    (SELECT count(*)::integer FROM public.zane_social_messages m
      WHERE m.sender_id <> v_uid
        AND (
          (m.recipient_id = v_uid AND NOT EXISTS (SELECT 1 FROM public.zane_social_blocks b WHERE (b.blocker_id = v_uid AND b.blocked_id = m.sender_id) OR (b.blocker_id = m.sender_id AND b.blocked_id = v_uid)))
          OR (m.group_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.zane_social_group_members own_member WHERE own_member.group_id = m.group_id AND own_member.user_id = v_uid)
            AND NOT EXISTS (SELECT 1 FROM public.zane_social_group_members other_member JOIN public.zane_social_blocks b ON (b.blocker_id = v_uid AND b.blocked_id = other_member.user_id) OR (b.blocker_id = other_member.user_id AND b.blocked_id = v_uid) WHERE other_member.group_id = m.group_id AND other_member.user_id <> v_uid))
        )
        AND NOT EXISTS (SELECT 1 FROM public.zane_social_message_reads mr WHERE mr.message_id = m.id AND mr.user_id = v_uid));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_get_badge() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_badge() TO authenticated;

-- Keep group fan-out bounded even if a malformed or abandoned group grows.
CREATE OR REPLACE FUNCTION app_private.broadcast_social_group(
  p_group_id uuid,
  p_resource text,
  p_extra_user uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_user_id uuid;
BEGIN
  FOR v_user_id IN
    SELECT candidate.user_id
    FROM (
      SELECT p_extra_user AS user_id WHERE p_extra_user IS NOT NULL
      UNION
      SELECT gm.user_id FROM public.zane_social_group_members gm WHERE gm.group_id = p_group_id
    ) candidate
    WHERE candidate.user_id IS NOT NULL
    LIMIT 200
  LOOP
    PERFORM app_private.broadcast_social_user(v_user_id, p_resource);
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION app_private.broadcast_social_group(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Quotas on user-triggered mutations. The wrappers in public already enforce
-- the global Friends maintenance switch; these private bodies add cheap
-- per-user ceilings before any insert or fan-out can happen.
CREATE OR REPLACE FUNCTION app_private.social_send_friend_request(p_target_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_uid IS NULL OR p_target_id IS NULL OR v_uid = p_target_id THEN RAISE EXCEPTION 'Invalid friend target'; END IF;
  IF (SELECT count(*) FROM public.zane_social_friendships WHERE requester_id = v_uid AND status = 'pending') >= 50 THEN RAISE EXCEPTION 'Too many pending friend requests'; END IF;
  IF (SELECT count(*) FROM public.zane_social_friendships WHERE requester_id = v_uid AND created_at >= now() - interval '1 hour') >= 100 THEN RAISE EXCEPTION 'Friend request limit reached'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.zane_social_profiles WHERE user_id = p_target_id) THEN RAISE EXCEPTION 'User not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.zane_social_blocks b WHERE (b.blocker_id = v_uid AND b.blocked_id = p_target_id) OR (b.blocker_id = p_target_id AND b.blocked_id = v_uid)) THEN RAISE EXCEPTION 'User unavailable'; END IF;
  IF EXISTS (SELECT 1 FROM public.zane_social_friendships f WHERE ((f.requester_id = v_uid AND f.addressee_id = p_target_id) OR (f.requester_id = p_target_id AND f.addressee_id = v_uid)) AND f.status IN ('pending', 'accepted')) THEN RAISE EXCEPTION 'Friend request already exists'; END IF;
  INSERT INTO public.zane_social_friendships (requester_id, addressee_id) VALUES (v_uid, p_target_id) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.social_create_group(p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_uid IS NULL OR char_length(trim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'Group name required'; END IF;
  IF (SELECT count(*) FROM public.zane_social_groups WHERE owner_id = v_uid) >= 20 THEN RAISE EXCEPTION 'Group limit reached'; END IF;
  INSERT INTO public.zane_social_groups (owner_id, name) VALUES (v_uid, trim(p_name)) RETURNING id INTO v_id;
  INSERT INTO public.zane_social_group_members (group_id, user_id, role) VALUES (v_id, v_uid, 'owner');
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.social_join_group(p_join_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_group_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT id INTO v_group_id FROM public.zane_social_groups WHERE upper(join_code) = upper(trim(coalesce(p_join_code, '')));
  IF v_group_id IS NULL THEN RAISE EXCEPTION 'Group not found'; END IF;
  IF (SELECT count(*) FROM public.zane_social_group_members WHERE group_id = v_group_id) >= 200 THEN RAISE EXCEPTION 'Group is full'; END IF;
  IF EXISTS (SELECT 1 FROM public.zane_social_group_members gm JOIN public.zane_social_blocks b ON (b.blocker_id = v_uid AND b.blocked_id = gm.user_id) OR (b.blocker_id = gm.user_id AND b.blocked_id = v_uid) WHERE gm.group_id = v_group_id AND gm.user_id <> v_uid) THEN RAISE EXCEPTION 'You cannot join this group'; END IF;
  INSERT INTO public.zane_social_group_members (group_id, user_id) VALUES (v_group_id, v_uid) ON CONFLICT DO NOTHING;
  RETURN v_group_id;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.social_create_plan_share(p_recipient_id uuid, p_plan_name text, p_snapshot jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_uid IS NULL OR p_recipient_id IS NULL OR v_uid = p_recipient_id THEN RAISE EXCEPTION 'Invalid recipient'; END IF;
  IF (SELECT count(*) FROM public.zane_social_plan_shares WHERE sender_id = v_uid AND created_at >= now() - interval '24 hours') >= 100 THEN RAISE EXCEPTION 'Plan share limit reached'; END IF;
  IF char_length(trim(coalesce(p_plan_name, ''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Plan name required'; END IF;
  IF EXISTS (SELECT 1 FROM public.zane_social_blocks b WHERE (b.blocker_id = v_uid AND b.blocked_id = p_recipient_id) OR (b.blocker_id = p_recipient_id AND b.blocked_id = v_uid)) THEN RAISE EXCEPTION 'User unavailable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.zane_social_friendships f WHERE f.status = 'accepted' AND ((f.requester_id = v_uid AND f.addressee_id = p_recipient_id) OR (f.requester_id = p_recipient_id AND f.addressee_id = v_uid))) THEN RAISE EXCEPTION 'Friends only'; END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' OR octet_length(p_snapshot::text) > 100000 THEN RAISE EXCEPTION 'Invalid plan snapshot'; END IF;
  INSERT INTO public.zane_social_plan_shares (sender_id, recipient_id, plan_name, snapshot) VALUES (v_uid, p_recipient_id, trim(p_plan_name), p_snapshot) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.social_create_group_plan_share(p_group_id uuid, p_plan_name text, p_snapshot jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_uid IS NULL OR p_group_id IS NULL THEN RAISE EXCEPTION 'Invalid group'; END IF;
  IF (SELECT count(*) FROM public.zane_social_plan_shares WHERE sender_id = v_uid AND created_at >= now() - interval '24 hours') >= 100 THEN RAISE EXCEPTION 'Plan share limit reached'; END IF;
  IF char_length(trim(coalesce(p_plan_name, ''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Plan name required'; END IF;
  IF NOT public.social_is_group_member(p_group_id, v_uid) THEN RAISE EXCEPTION 'Group members only'; END IF;
  IF (SELECT count(*) FROM public.zane_social_group_members WHERE group_id = p_group_id) > 200 THEN RAISE EXCEPTION 'Group is too large'; END IF;
  IF EXISTS (SELECT 1 FROM public.zane_social_group_members gm JOIN public.zane_social_blocks b ON (b.blocker_id = v_uid AND b.blocked_id = gm.user_id) OR (b.blocker_id = gm.user_id AND b.blocked_id = v_uid) WHERE gm.group_id = p_group_id AND gm.user_id <> v_uid) THEN RAISE EXCEPTION 'Group unavailable'; END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' OR octet_length(p_snapshot::text) > 100000 THEN RAISE EXCEPTION 'Invalid plan snapshot'; END IF;
  INSERT INTO public.zane_social_plan_shares (sender_id, group_id, plan_name, snapshot) VALUES (v_uid, p_group_id, trim(p_plan_name), p_snapshot) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.social_report(p_target_user_id uuid, p_message_id uuid, p_group_id uuid, p_reason text, p_details text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_uid IS NULL OR p_reason NOT IN ('spam', 'harassment', 'unsafe', 'other') THEN RAISE EXCEPTION 'Invalid report'; END IF;
  IF (SELECT count(*) FROM public.zane_social_reports WHERE reporter_id = v_uid AND created_at >= now() - interval '1 hour') >= 20 THEN RAISE EXCEPTION 'Report limit reached'; END IF;
  IF p_target_user_id = v_uid THEN RAISE EXCEPTION 'Invalid report target'; END IF;
  IF p_message_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.zane_social_messages m WHERE m.id = p_message_id AND (m.sender_id = v_uid OR m.recipient_id = v_uid OR (m.group_id IS NOT NULL AND public.social_group_visible(m.group_id, v_uid)))) THEN RAISE EXCEPTION 'Message not visible'; END IF;
  IF p_group_id IS NOT NULL AND NOT public.social_group_visible(p_group_id, v_uid) THEN RAISE EXCEPTION 'Group not visible'; END IF;
  INSERT INTO public.zane_social_reports (reporter_id, target_user_id, message_id, group_id, reason, details)
  VALUES (v_uid, p_target_user_id, p_message_id, p_group_id, p_reason, left(coalesce(p_details, ''), 2000)) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- Deletion must also remove server-side push state, otherwise a later account
-- with reused identifiers could inherit stale delivery metadata.
CREATE OR REPLACE FUNCTION public.delete_my_social_data()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  DELETE FROM public.zane_social_notification_deliveries WHERE recipient_id = v_uid;
  DELETE FROM public.zane_social_notification_attempts WHERE caller_id = v_uid;
  DELETE FROM storage.objects o WHERE o.bucket_id = 'social-chat-attachments' AND (o.name LIKE v_uid::text || '/%' OR EXISTS (
    SELECT 1 FROM public.zane_social_message_attachments a LEFT JOIN public.zane_social_messages m ON m.id = a.message_id LEFT JOIN public.zane_social_groups g ON g.id = m.group_id
    WHERE a.storage_path = o.name AND (a.uploaded_by = v_uid OR m.sender_id = v_uid OR m.recipient_id = v_uid OR g.owner_id = v_uid)
  ));
  DELETE FROM public.zane_social_reports WHERE reporter_id = v_uid OR (target_user_id = v_uid AND message_id IS NULL AND group_id IS NULL);
  UPDATE public.zane_social_reports SET target_user_id = NULL WHERE target_user_id = v_uid;
  DELETE FROM public.zane_social_message_reads WHERE user_id = v_uid;
  DELETE FROM public.zane_social_plan_shares WHERE sender_id = v_uid OR recipient_id = v_uid OR group_id IN (SELECT id FROM public.zane_social_groups WHERE owner_id = v_uid);
  DELETE FROM public.zane_social_messages WHERE sender_id = v_uid OR recipient_id = v_uid OR group_id IN (SELECT id FROM public.zane_social_groups WHERE owner_id = v_uid);
  DELETE FROM public.zane_social_groups WHERE owner_id = v_uid;
  DELETE FROM public.zane_social_group_members WHERE user_id = v_uid;
  DELETE FROM public.zane_social_friendships WHERE requester_id = v_uid OR addressee_id = v_uid;
  DELETE FROM public.zane_social_blocks WHERE blocker_id = v_uid OR blocked_id = v_uid;
  DELETE FROM public.zane_social_workout_comments WHERE author_id = v_uid;
  DELETE FROM public.zane_social_message_attachments WHERE uploaded_by = v_uid;
  DELETE FROM public.zane_social_profiles WHERE user_id = v_uid;
END;
$function$;

-- Cover the FK joins used by RLS, the dashboard and report moderation.
CREATE INDEX IF NOT EXISTS zane_social_blocks_blocked_idx ON public.zane_social_blocks(blocked_id);
CREATE INDEX IF NOT EXISTS zane_social_groups_owner_idx ON public.zane_social_groups(owner_id);
CREATE INDEX IF NOT EXISTS zane_social_message_attachments_uploaded_idx ON public.zane_social_message_attachments(uploaded_by);
CREATE INDEX IF NOT EXISTS zane_social_message_reads_user_idx ON public.zane_social_message_reads(user_id, message_id);
CREATE INDEX IF NOT EXISTS zane_social_messages_sender_idx ON public.zane_social_messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS zane_social_plan_share_imports_user_idx ON public.zane_social_plan_share_imports(user_id, imported_at DESC);
CREATE INDEX IF NOT EXISTS zane_social_plan_shares_group_idx ON public.zane_social_plan_shares(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS zane_social_plan_shares_recipient_idx ON public.zane_social_plan_shares(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS zane_social_plan_shares_sender_idx ON public.zane_social_plan_shares(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS zane_social_reports_group_idx ON public.zane_social_reports(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS zane_social_reports_message_idx ON public.zane_social_reports(message_id, created_at DESC);
CREATE INDEX IF NOT EXISTS zane_social_reports_reporter_idx ON public.zane_social_reports(reporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS zane_social_reports_target_idx ON public.zane_social_reports(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS zane_social_notification_deliveries_created_idx ON public.zane_social_notification_deliveries(created_at);

-- A reversible transport switch must restore the publication before legacy
-- clients are allowed to use it, and must remove it before Broadcast becomes
-- the authoritative path.
CREATE OR REPLACE FUNCTION public.admin_set_social_transport(p_transport text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_transport text := lower(trim(coalesce(p_transport, ''))); v_table text;
BEGIN
  IF lower(coalesce((SELECT auth.email()), '')) <> 'office@btc-prime.biz' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF v_transport NOT IN ('legacy', 'broadcast') THEN RAISE EXCEPTION 'Invalid social transport'; END IF;
  FOREACH v_table IN ARRAY ARRAY['zane_social_friendships','zane_social_group_members','zane_social_groups','zane_social_message_attachments','zane_social_message_reads','zane_social_messages','zane_social_plan_share_imports','zane_social_plan_shares','zane_social_workout_comments'] LOOP
    IF v_transport = 'legacy' THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', v_table);
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', v_table);
      END IF;
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY DEFAULT', v_table);
    END IF;
  END LOOP;
  INSERT INTO public.zane_app_config (id, social_transport) VALUES (1, v_transport)
  ON CONFLICT (id) DO UPDATE SET social_transport = EXCLUDED.social_transport;
  RETURN v_transport;
END;
$function$;

-- Preview starts in Broadcast mode, matching the client default. The admin
-- function above is the only supported rollback path.
DO $publication$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['zane_social_friendships','zane_social_group_members','zane_social_groups','zane_social_message_attachments','zane_social_message_reads','zane_social_messages','zane_social_plan_share_imports','zane_social_plan_shares','zane_social_workout_comments'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', v_table);
    END IF;
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY DEFAULT', v_table);
  END LOOP;
END;
$publication$;

UPDATE public.zane_app_config SET social_transport = 'broadcast' WHERE id = 1;

COMMIT;
