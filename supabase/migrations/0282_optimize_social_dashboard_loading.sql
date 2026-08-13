-- Keep the first Friends payload small. The dashboard only calculates the
-- viewer's three card slots plus their standard fallbacks. Full shared metric
-- values are fetched by social_get_friend_metrics when a friend is opened.

CREATE OR REPLACE FUNCTION public.social_get_dashboard(p_week_start date, p_today date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_all_metric_keys text[] := ARRAY[
    'steps','workouts','adherence','calories','protein','carbs','fat','fiber',
    'water','cardioMinutes','cardioDistance','weight','bodyFatPct','waistCm',
    'hipsCm','chestCm','armCm','thighCm','calfCm','glucose','bloodPressure','bodyTemp'
  ];
  v_metric_keys text[] := ARRAY['steps','workouts','adherence'];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT ARRAY(
    SELECT DISTINCT candidate
    FROM unnest(
      ARRAY['steps','workouts','adherence']::text[] ||
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(sp.metric_slots, '[]'::jsonb)))
    ) AS candidate
    WHERE candidate = ANY(v_all_metric_keys)
  )
  INTO v_metric_keys
  FROM zane_social_profiles sp
  WHERE sp.user_id = v_uid;

  IF COALESCE(cardinality(v_metric_keys), 0) < 3 THEN
    v_metric_keys := ARRAY['steps','workouts','adherence'];
  END IF;

  RETURN jsonb_build_object(
    'profile', (
      SELECT jsonb_build_object(
        'userId', sp.user_id, 'handle', sp.handle, 'friendCode', sp.friend_code,
        'weightUnit', us.unit,
        'stepsVisible', sp.steps_visible, 'workoutsVisible', sp.workouts_visible,
        'adherenceVisible', sp.adherence_visible, 'metricVisibility', sp.metric_visibility,
        'metricSlots', sp.metric_slots
      )
      FROM zane_social_profiles sp LEFT JOIN zane_user_settings us ON us.user_id = sp.user_id
      WHERE sp.user_id = v_uid
    ),
    'friends', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'friendshipId', f.id, 'userId', other.user_id, 'name', coalesce(p.name, 'Zane athlete'),
        'handle', other.handle, 'friendCode', other.friend_code, 'weightUnit', ous.unit,
        'stepsVisible', other.steps_visible, 'workoutsVisible', other.workouts_visible,
        'adherenceVisible', other.adherence_visible,
        'metricVisibility', visibility.metric_visibility,
        'metrics', (SELECT jsonb_object_agg(metric_key, CASE WHEN lower(coalesce(visibility.metric_visibility->>metric_key, 'false')) = 'true' THEN public.social_health_metric_value(other.user_id, metric_key, NULL, NULL) ELSE NULL END) FROM unnest(v_metric_keys) AS metric_key)
      ) ORDER BY f.updated_at DESC)
      FROM zane_social_friendships f
      JOIN zane_social_profiles other ON other.user_id = CASE WHEN f.requester_id = v_uid THEN f.addressee_id ELSE f.requester_id END
      LEFT JOIN zane_profiles p ON p.id = other.user_id
      LEFT JOIN zane_user_settings ous ON ous.user_id = other.user_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(other.metric_visibility, '{}'::jsonb) || jsonb_build_object(
          'steps', COALESCE(other.metric_visibility->'steps', to_jsonb(other.steps_visible)),
          'workouts', COALESCE(other.metric_visibility->'workouts', to_jsonb(other.workouts_visible)),
          'adherence', COALESCE(other.metric_visibility->'adherence', to_jsonb(other.adherence_visible))
        ) AS metric_visibility
      ) visibility ON true
      WHERE f.status = 'accepted' AND (f.requester_id = v_uid OR f.addressee_id = v_uid)
        AND NOT EXISTS (SELECT 1 FROM zane_social_blocks b WHERE (b.blocker_id = v_uid AND b.blocked_id = other.user_id) OR (b.blocker_id = other.user_id AND b.blocked_id = v_uid))
    ), '[]'::jsonb),
    'incoming', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'userId', f.requester_id, 'name', coalesce(p.name, 'Zane athlete'), 'handle', sp.handle) ORDER BY f.created_at DESC)
      FROM zane_social_friendships f JOIN zane_social_profiles sp ON sp.user_id = f.requester_id LEFT JOIN zane_profiles p ON p.id = f.requester_id
      WHERE f.addressee_id = v_uid AND f.status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM zane_social_blocks b WHERE (b.blocker_id = v_uid AND b.blocked_id = f.requester_id) OR (b.blocker_id = f.requester_id AND b.blocked_id = v_uid))
    ), '[]'::jsonb),
    'outgoing', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'userId', f.addressee_id, 'name', coalesce(p.name, 'Zane athlete'), 'handle', sp.handle) ORDER BY f.created_at DESC)
      FROM zane_social_friendships f JOIN zane_social_profiles sp ON sp.user_id = f.addressee_id LEFT JOIN zane_profiles p ON p.id = f.addressee_id
      WHERE f.requester_id = v_uid AND f.status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM zane_social_blocks b WHERE (b.blocker_id = v_uid AND b.blocked_id = f.addressee_id) OR (b.blocker_id = f.addressee_id AND b.blocked_id = v_uid))
    ), '[]'::jsonb),
    'groupMembers', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'groupId', gm.group_id, 'userId', gm.user_id, 'role', gm.role, 'joinedAt', gm.joined_at,
        'name', coalesce(p.name, 'Zane athlete'), 'handle', sp.handle,
        'steps', CASE WHEN sp.steps_visible THEN public.social_health_metric_value(gm.user_id, 'steps', NULL, NULL) END,
        'workouts', CASE WHEN sp.workouts_visible THEN public.social_health_metric_value(gm.user_id, 'workouts', NULL, NULL) END,
        'adherence', CASE WHEN sp.adherence_visible THEN public.social_health_metric_value(gm.user_id, 'adherence', NULL, NULL) END
      ) ORDER BY gm.joined_at)
      FROM zane_social_group_members gm
      JOIN zane_social_profiles sp ON sp.user_id = gm.user_id
      LEFT JOIN zane_profiles p ON p.id = gm.user_id
      WHERE EXISTS (SELECT 1 FROM zane_social_group_members viewer WHERE viewer.group_id = gm.group_id AND viewer.user_id = v_uid)
        AND NOT EXISTS (
          SELECT 1
          FROM zane_social_group_members other_member
          JOIN zane_social_blocks b ON (b.blocker_id = v_uid AND b.blocked_id = other_member.user_id) OR (b.blocker_id = other_member.user_id AND b.blocked_id = v_uid)
          WHERE other_member.group_id = gm.group_id AND other_member.user_id <> v_uid
        )
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_get_friend_metrics(p_friend_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_metric_keys text[] := ARRAY[
    'steps','workouts','adherence','calories','protein','carbs','fat','fiber',
    'water','cardioMinutes','cardioDistance','weight','bodyFatPct','waistCm',
    'hipsCm','chestCm','armCm','thighCm','calfCm','glucose','bloodPressure','bodyTemp'
  ];
  v_metric_visibility jsonb;
  v_weight_unit text;
  v_steps_visible boolean;
  v_workouts_visible boolean;
  v_adherence_visible boolean;
BEGIN
  IF v_uid IS NULL OR p_friend_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM zane_social_friendships f
    WHERE f.status = 'accepted'
      AND ((f.requester_id = v_uid AND f.addressee_id = p_friend_id) OR (f.requester_id = p_friend_id AND f.addressee_id = v_uid))
      AND NOT EXISTS (
        SELECT 1 FROM zane_social_blocks b
        WHERE (b.blocker_id = v_uid AND b.blocked_id = p_friend_id)
           OR (b.blocker_id = p_friend_id AND b.blocked_id = v_uid)
      )
  ) THEN RAISE EXCEPTION 'Friend not found'; END IF;

  SELECT COALESCE(sp.metric_visibility, '{}'::jsonb), us.unit,
         sp.steps_visible, sp.workouts_visible, sp.adherence_visible
    INTO v_metric_visibility, v_weight_unit,
         v_steps_visible, v_workouts_visible, v_adherence_visible
    FROM zane_social_profiles sp
    LEFT JOIN zane_user_settings us ON us.user_id = sp.user_id
   WHERE sp.user_id = p_friend_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Friend not found'; END IF;

  v_metric_visibility := v_metric_visibility || jsonb_build_object(
    'steps', COALESCE(v_metric_visibility->'steps', to_jsonb(v_steps_visible)),
    'workouts', COALESCE(v_metric_visibility->'workouts', to_jsonb(v_workouts_visible)),
    'adherence', COALESCE(v_metric_visibility->'adherence', to_jsonb(v_adherence_visible))
  );

  RETURN jsonb_build_object(
    'userId', p_friend_id,
    'weightUnit', v_weight_unit,
    'stepsVisible', v_steps_visible,
    'workoutsVisible', v_workouts_visible,
    'adherenceVisible', v_adherence_visible,
    'metricVisibility', v_metric_visibility,
    'metrics', COALESCE((
      SELECT jsonb_object_agg(metric_key, public.social_health_metric_value(p_friend_id, metric_key, NULL, NULL))
      FROM unnest(v_metric_keys) AS metric_key
      WHERE lower(coalesce(v_metric_visibility->>metric_key, 'false')) = 'true'
    ), '{}'::jsonb)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_get_dashboard(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_dashboard(date, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_get_friend_metrics(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_friend_metrics(uuid) TO authenticated;
