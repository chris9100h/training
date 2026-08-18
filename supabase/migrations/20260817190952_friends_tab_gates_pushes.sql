-- show_friends_tab was a client-only flag: app.jsx skips LOADING social data
-- when it is off, but nothing server-side ever read it. A user who switched
-- the Friends tab off therefore still received friend requests and still got
-- lock-screen pushes carrying message bodies for a feature whose UI they had
-- hidden, with no way to stop them short of hunting down the per-event
-- social_push_* switches.
--
-- Scope deliberately limited to INCOMING notifications. Making the flag
-- authoritative for lookup and visibility as well would silently drop the user
-- out of existing friendships, which is a different decision than "hide the
-- tab". The four helpers below are what zane_social-notify consults before it
-- sends anything, so gating them there covers every push channel at once and
-- the edge function itself needs no change.

CREATE OR REPLACE FUNCTION app_private.social_tab_enabled(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Defaults to FALSE, matching the column default: show_friends_tab is an
  -- opt-in preview flag, so "no row" means the user never turned Friends on
  -- and should not be pushed about it. handle_new_user creates a settings row
  -- for every account anyway, so this fallback is a belt-and-braces case.
  SELECT COALESCE(
    (SELECT us.show_friends_tab FROM public.zane_user_settings us WHERE us.user_id = p_user_id),
    false
  );
$function$;

REVOKE EXECUTE ON FUNCTION app_private.social_tab_enabled(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.social_can_notify_message(p_message_id uuid, p_recipient_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_sender uuid; v_recipient uuid; v_group uuid; v_created timestamptz;
BEGIN
  IF p_message_id IS NULL OR p_recipient_id IS NULL THEN RETURN false; END IF;
  IF NOT app_private.social_tab_enabled(p_recipient_id) THEN RETURN false; END IF;
  SELECT sender_id, recipient_id, group_id, created_at INTO v_sender, v_recipient, v_group, v_created FROM public.zane_social_messages WHERE id = p_message_id;
  IF NOT FOUND OR v_sender = p_recipient_id OR v_created < now() - interval '24 hours' THEN RETURN false; END IF;
  IF v_recipient IS NOT NULL THEN
    RETURN v_recipient = p_recipient_id
      AND EXISTS (SELECT 1 FROM public.zane_social_friendships f WHERE f.status = 'accepted' AND f.accepted_at IS NOT NULL AND f.accepted_at <= v_created AND ((f.requester_id = v_sender AND f.addressee_id = p_recipient_id) OR (f.requester_id = p_recipient_id AND f.addressee_id = v_sender)))
      AND NOT EXISTS (SELECT 1 FROM public.zane_social_blocks b WHERE (b.blocker_id = v_sender AND b.blocked_id = p_recipient_id) OR (b.blocker_id = p_recipient_id AND b.blocked_id = v_sender));
  END IF;
  IF v_group IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.zane_social_group_members gm WHERE gm.group_id = v_group AND gm.user_id = p_recipient_id)
    AND NOT EXISTS (SELECT 1 FROM public.zane_social_group_members gm JOIN public.zane_social_blocks b ON (b.blocker_id = p_recipient_id AND b.blocked_id = gm.user_id) OR (b.blocker_id = gm.user_id AND b.blocked_id = p_recipient_id) WHERE gm.group_id = v_group AND gm.user_id <> p_recipient_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_can_notify_finished_comment(p_comment_id uuid, p_recipient_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_author uuid; v_created timestamptz; v_owner uuid; v_started timestamptz; v_ended timestamptz; v_visible boolean;
BEGIN
  IF p_comment_id IS NULL OR p_recipient_id IS NULL THEN RETURN false; END IF;
  IF NOT app_private.social_tab_enabled(p_recipient_id) THEN RETURN false; END IF;
  SELECT wc.author_id, wc.created_at, s.user_id, COALESCE(s.started_at, s.date::timestamptz), s.ended, sp.workouts_visible INTO v_author, v_created, v_owner, v_started, v_ended, v_visible
    FROM public.zane_social_workout_comments wc JOIN public.zane_sessions s ON s.id = wc.session_id JOIN public.zane_social_profiles sp ON sp.user_id = s.user_id WHERE wc.id = p_comment_id;
  IF NOT FOUND OR v_owner <> p_recipient_id OR v_author = p_recipient_id OR v_ended IS NULL OR v_created < v_ended OR v_created < now() - interval '7 days' OR NOT COALESCE(v_visible, false) THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.zane_social_friendships f WHERE f.status = 'accepted' AND f.accepted_at IS NOT NULL AND f.accepted_at <= v_started AND ((f.requester_id = p_recipient_id AND f.addressee_id = v_author) OR (f.requester_id = v_author AND f.addressee_id = p_recipient_id)))
    AND NOT EXISTS (SELECT 1 FROM public.zane_social_blocks b WHERE (b.blocker_id = p_recipient_id AND b.blocked_id = v_author) OR (b.blocker_id = v_author AND b.blocked_id = p_recipient_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_can_notify_friend_started(p_session_id text, p_recipient_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_owner uuid; v_started timestamptz; v_ended timestamptz; v_visible boolean;
BEGIN
  IF NULLIF(trim(p_session_id), '') IS NULL OR p_recipient_id IS NULL THEN RETURN false; END IF;
  IF NOT app_private.social_tab_enabled(p_recipient_id) THEN RETURN false; END IF;
  SELECT s.user_id, s.started_at, s.ended, sp.workouts_visible INTO v_owner, v_started, v_ended, v_visible FROM public.zane_sessions s JOIN public.zane_social_profiles sp ON sp.user_id = s.user_id WHERE s.id = p_session_id;
  IF NOT FOUND OR v_started IS NULL OR v_ended IS NOT NULL OR v_started < now() - interval '24 hours' OR v_owner = p_recipient_id OR NOT COALESCE(v_visible, false) THEN RETURN false; END IF;
  -- The sender's own switch counts here too: an opted-out user should not be
  -- broadcasting workout starts to other people's lock screens either.
  IF NOT app_private.social_tab_enabled(v_owner) THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.zane_social_friendships f WHERE f.status = 'accepted' AND f.accepted_at IS NOT NULL AND f.accepted_at <= v_started AND ((f.requester_id = v_owner AND f.addressee_id = p_recipient_id) OR (f.requester_id = p_recipient_id AND f.addressee_id = v_owner)))
    AND NOT EXISTS (SELECT 1 FROM public.zane_social_blocks b WHERE (b.blocker_id = v_owner AND b.blocked_id = p_recipient_id) OR (b.blocker_id = p_recipient_id AND b.blocked_id = v_owner));
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_can_notify_friend_request(p_friendship_id uuid, p_recipient_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.social_tab_enabled(p_recipient_id)
    AND EXISTS (SELECT 1 FROM public.zane_social_friendships f WHERE f.id = p_friendship_id AND f.addressee_id = p_recipient_id AND f.status = 'pending' AND NOT EXISTS (SELECT 1 FROM public.zane_social_blocks b WHERE (b.blocker_id = f.requester_id AND b.blocked_id = f.addressee_id) OR (b.blocker_id = f.addressee_id AND b.blocked_id = f.requester_id)));
$function$;

-- Service-role only, exactly as before: CREATE OR REPLACE keeps the existing
-- ACL, these are restated so the intent is visible in the migration itself.
REVOKE EXECUTE ON FUNCTION public.social_can_notify_message(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.social_can_notify_finished_comment(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.social_can_notify_friend_started(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.social_can_notify_friend_request(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_can_notify_message(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.social_can_notify_finished_comment(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.social_can_notify_friend_started(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.social_can_notify_friend_request(uuid, uuid) TO service_role;
