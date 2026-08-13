-- Fix the history feed after adding the owner's own workouts.  Once the
-- friend and owner queries are UNIONed, the source table alias is no longer
-- visible to the inner ORDER BY; sort by the projected column instead.
CREATE OR REPLACE FUNCTION public.social_get_workout_feed()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  RETURN jsonb_build_object(
    'live', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY sort_at DESC)
      FROM (
        SELECT jsonb_build_object(
          'sessionId', s.id, 'ownerId', s.user_id,
          'ownerName', COALESCE(p.name, 'Zane athlete'),
          'dayName', s.day_name, 'date', s.date, 'startedAt', s.started_at,
          'ended', s.ended, 'live', true,
          'acceptedAt', f.accepted_at,
          'setsDone', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND st.done)::int,
          'setsTotal', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND NOT st.skipped)::int,
          'exerciseCount', (SELECT COUNT(*) FROM zane_session_entries e WHERE e.session_id = s.id)::int
        ) AS row_data,
        s.started_at AS sort_at
        FROM zane_social_friendships f
        JOIN zane_social_profiles sp ON sp.user_id = CASE WHEN f.requester_id = v_uid THEN f.addressee_id ELSE f.requester_id END
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
        UNION ALL
        SELECT jsonb_build_object(
          'sessionId', s.id, 'ownerId', s.user_id,
          'ownerName', COALESCE(p.name, 'Zane athlete'),
          'dayName', s.day_name, 'date', s.date, 'startedAt', s.started_at,
          'ended', s.ended, 'live', true, 'acceptedAt', NULL,
          'setsDone', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND st.done)::int,
          'setsTotal', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND NOT st.skipped)::int,
          'exerciseCount', (SELECT COUNT(*) FROM zane_session_entries e WHERE e.session_id = s.id)::int
        ) AS row_data,
        s.started_at AS sort_at
        FROM zane_sessions s
        LEFT JOIN zane_profiles p ON p.id = s.user_id
        WHERE s.user_id = v_uid
          AND s.ended IS NULL
          AND COALESCE(s.started_at, s.date) IS NOT NULL
      ) live_rows
    ), '[]'::jsonb),
    'history', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY sort_at DESC)
      FROM (
        SELECT jsonb_build_object(
          'sessionId', s.id, 'ownerId', s.user_id,
          'ownerName', COALESCE(p.name, 'Zane athlete'),
          'dayName', s.day_name, 'date', s.date, 'startedAt', s.started_at,
          'ended', s.ended, 'live', false,
          'acceptedAt', f.accepted_at,
          'setsDone', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND st.done)::int,
          'setsTotal', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND NOT st.skipped)::int,
          'exerciseCount', (SELECT COUNT(*) FROM zane_session_entries e WHERE e.session_id = s.id)::int
        ) AS row_data,
        COALESCE(s.ended, s.date) AS sort_at
        FROM zane_social_friendships f
        JOIN zane_social_profiles sp ON sp.user_id = CASE WHEN f.requester_id = v_uid THEN f.addressee_id ELSE f.requester_id END
        JOIN zane_sessions s ON s.user_id = sp.user_id
        LEFT JOIN zane_profiles p ON p.id = s.user_id
        WHERE f.status = 'accepted'
          AND f.accepted_at IS NOT NULL
          AND (f.requester_id = v_uid OR f.addressee_id = v_uid)
          AND sp.workouts_visible
          AND s.ended IS NOT NULL
          AND COALESCE(s.started_at, s.date) IS NOT NULL
          AND f.accepted_at <= COALESCE(s.started_at, s.date)
          AND (s.duration_minutes IS NOT NULL OR (s.started_at IS NOT NULL AND s.ended > s.started_at))
        UNION ALL
        SELECT jsonb_build_object(
          'sessionId', s.id, 'ownerId', s.user_id,
          'ownerName', COALESCE(p.name, 'Zane athlete'),
          'dayName', s.day_name, 'date', s.date, 'startedAt', s.started_at,
          'ended', s.ended, 'live', false, 'acceptedAt', NULL,
          'setsDone', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND st.done)::int,
          'setsTotal', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND NOT st.skipped)::int,
          'exerciseCount', (SELECT COUNT(*) FROM zane_session_entries e WHERE e.session_id = s.id)::int
        ) AS row_data,
        COALESCE(s.ended, s.date) AS sort_at
        FROM zane_sessions s
        LEFT JOIN zane_profiles p ON p.id = s.user_id
        WHERE s.user_id = v_uid
          AND s.ended IS NOT NULL
          AND COALESCE(s.started_at, s.date) IS NOT NULL
          AND (s.duration_minutes IS NOT NULL OR (s.started_at IS NOT NULL AND s.ended > s.started_at))
        ORDER BY sort_at DESC
        LIMIT 100
      ) history_rows
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_get_workout_feed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_workout_feed() TO authenticated;
