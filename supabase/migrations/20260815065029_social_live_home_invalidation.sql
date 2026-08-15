-- Keep the Home live-workout banner fresh without polling the full Friends
-- dashboard. A change to a user's active session invalidates the feed for
-- that user and for accepted friends who opted into workout visibility.
CREATE OR REPLACE FUNCTION app_private.broadcast_social_workout_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner_id uuid := NEW.user_id;
  v_user_id uuid;
BEGIN
  IF TG_OP <> 'UPDATE'
     OR NEW.in_progress_session_id IS NOT DISTINCT FROM OLD.in_progress_session_id THEN
    RETURN NEW;
  END IF;

  -- The owner may have their own commented workout in the Activity feed.
  PERFORM app_private.broadcast_social_user(v_owner_id, 'feed');

  FOR v_user_id IN
    SELECT DISTINCT friend.user_id
    FROM (
      SELECT CASE
        WHEN f.requester_id = v_owner_id THEN f.addressee_id
        ELSE f.requester_id
      END AS user_id
      FROM public.zane_social_friendships f
      WHERE f.status = 'accepted'
        AND f.accepted_at IS NOT NULL
        AND (f.requester_id = v_owner_id OR f.addressee_id = v_owner_id)
    ) friend
    JOIN public.zane_social_profiles sp ON sp.user_id = v_owner_id
    WHERE sp.workouts_visible
      AND NOT EXISTS (
        SELECT 1
        FROM public.zane_social_blocks b
        WHERE (b.blocker_id = v_owner_id AND b.blocked_id = friend.user_id)
           OR (b.blocker_id = friend.user_id AND b.blocked_id = v_owner_id)
      )
  LOOP
    PERFORM app_private.broadcast_social_user(v_user_id, 'feed');
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION app_private.broadcast_social_workout_change() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS zane_social_workout_status_broadcast ON public.zane_user_settings;
CREATE TRIGGER zane_social_workout_status_broadcast
AFTER UPDATE OF in_progress_session_id ON public.zane_user_settings
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_social_workout_change();

-- The Home banner needs only current live friend summaries. Keep history and
-- the rest of the Friends dashboard behind the Friends route's full feed RPC.
CREATE FUNCTION public.social_get_live_workouts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM app_private.require_social_available();

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'sessionId', s.id,
        'ownerId', s.user_id,
        'ownerName', COALESCE(p.name, 'Zane athlete'),
        'dayName', s.day_name,
        'date', s.date,
        'startedAt', s.started_at,
        'ended', s.ended,
        'live', true,
        'acceptedAt', f.accepted_at,
        'setsDone', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND st.done)::int,
        'setsTotal', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND NOT st.skipped)::int,
        'exerciseCount', (SELECT COUNT(*) FROM zane_session_entries e WHERE e.session_id = s.id)::int
      )
      ORDER BY COALESCE(s.started_at, s.date) DESC
    )
    FROM zane_social_friendships f
    JOIN zane_social_profiles sp
      ON sp.user_id = CASE WHEN f.requester_id = v_uid THEN f.addressee_id ELSE f.requester_id END
    JOIN zane_user_settings us ON us.user_id = sp.user_id
    JOIN zane_sessions s ON s.id = us.in_progress_session_id AND s.user_id = sp.user_id
    LEFT JOIN zane_profiles p ON p.id = s.user_id
    WHERE f.status = 'accepted'
      AND f.accepted_at IS NOT NULL
      AND (f.requester_id = v_uid OR f.addressee_id = v_uid)
      AND sp.workouts_visible
      AND s.ended IS NULL
      AND COALESCE(s.started_at, s.date) IS NOT NULL
      AND f.accepted_at <= COALESCE(s.started_at, s.date)
      AND NOT EXISTS (
        SELECT 1
        FROM zane_social_blocks b
        WHERE (b.blocker_id = v_uid AND b.blocked_id = s.user_id)
           OR (b.blocker_id = s.user_id AND b.blocked_id = v_uid)
      )
  ), '[]'::jsonb);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_get_live_workouts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_live_workouts() TO authenticated;
