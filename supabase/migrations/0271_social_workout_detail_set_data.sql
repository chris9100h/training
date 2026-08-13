-- Include the logged set data in social workout detail.  Weight values are
-- stored in the owner's display unit, so the client also needs that unit to
-- render another user's workout in the viewer's unit.
CREATE OR REPLACE FUNCTION public.social_get_workout_detail(p_owner_id uuid, p_session_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session zane_sessions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_session FROM zane_sessions WHERE id = p_session_id AND user_id = p_owner_id;
  IF NOT FOUND OR NOT public.social_workout_access(v_session.user_id, COALESCE(v_session.started_at, v_session.date)) THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'session', jsonb_build_object(
      'sessionId', v_session.id, 'ownerId', v_session.user_id,
      'ownerName', COALESCE((SELECT p.name FROM zane_profiles p WHERE p.id = v_session.user_id), 'Zane athlete'),
      'dayName', v_session.day_name, 'date', v_session.date,
      'startedAt', v_session.started_at, 'ended', v_session.ended,
      'weightUnit', COALESCE((SELECT CASE WHEN us.unit = 'lbs' THEN 'lbs' ELSE 'kg' END FROM zane_user_settings us WHERE us.user_id = v_session.user_id), 'kg'),
      'durationMinutes', v_session.duration_minutes,
      'setsDone', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = v_session.id AND st.done)::int,
      'setsTotal', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = v_session.id AND NOT st.skipped)::int,
      'exerciseCount', (SELECT COUNT(*) FROM zane_session_entries e WHERE e.session_id = v_session.id)::int
    ),
    'entries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', e.name, 'plannedSets', e.planned_sets, 'plannedReps', e.planned_reps,
        'supersetGroup', e.superset_group,
        'sets', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'done', st.done, 'skipped', st.skipped, 'warmup', st.warmup,
            'kg', st.kg, 'reps', st.reps, 'repsL', st.reps_l, 'repsR', st.reps_r,
            'timeSec', st.time_sec, 'addedKg', st.added_kg
          ) ORDER BY st.set_idx)
          FROM zane_sets st WHERE st.entry_id = e.id
        ), '[]'::jsonb)
      ) ORDER BY e.entry_idx)
      FROM zane_session_entries e WHERE e.session_id = v_session.id
    ), '[]'::jsonb),
    'comments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'authorId', c.author_id,
        'authorName', COALESCE(p.name, 'Zane athlete'),
        'kind', c.kind, 'body', c.body, 'createdAt', c.created_at
      ) ORDER BY c.created_at)
      FROM zane_social_workout_comments c
      LEFT JOIN zane_profiles p ON p.id = c.author_id
      WHERE c.session_id = v_session.id
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_get_workout_detail(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_workout_detail(uuid, text) TO authenticated;
