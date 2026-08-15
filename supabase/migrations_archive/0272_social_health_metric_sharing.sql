-- Social health metric sharing and viewer-selected circle card slots.
-- Sharing remains opt-in per metric. The dashboard RPC returns only weekly
-- aggregates/latest readings and never returns notes or reading timestamps.

ALTER TABLE public.zane_social_profiles
  ADD COLUMN IF NOT EXISTS metric_visibility jsonb NOT NULL DEFAULT '{"steps":false,"workouts":false,"adherence":false,"calories":false,"protein":false,"carbs":false,"fat":false,"fiber":false,"water":false,"cardioMinutes":false,"cardioDistance":false,"weight":false,"bodyFatPct":false,"waistCm":false,"hipsCm":false,"chestCm":false,"armCm":false,"thighCm":false,"calfCm":false,"glucose":false,"bloodPressure":false,"bodyTemp":false}'::jsonb,
  ADD COLUMN IF NOT EXISTS metric_slots jsonb NOT NULL DEFAULT '["steps","workouts","adherence"]'::jsonb;

UPDATE public.zane_social_profiles
SET metric_visibility = jsonb_build_object(
  'steps', steps_visible,
  'workouts', workouts_visible,
  'adherence', adherence_visible,
  'calories', false, 'protein', false, 'carbs', false, 'fat', false, 'fiber', false, 'water', false,
  'cardioMinutes', false, 'cardioDistance', false,
  'weight', false, 'bodyFatPct', false, 'waistCm', false, 'hipsCm', false, 'chestCm', false,
  'armCm', false, 'thighCm', false, 'calfCm', false,
  'glucose', false, 'bloodPressure', false, 'bodyTemp', false
);

CREATE OR REPLACE FUNCTION public.social_health_metric_value(
  p_user_id uuid,
  p_metric text,
  p_week_start date,
  p_today date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_value jsonb;
  v_week_end date := p_week_start + 7;
  v_adherence_end date := LEAST(p_week_start + 7, p_today);
BEGIN
  IF p_user_id IS NULL OR p_week_start IS NULL OR p_today IS NULL THEN RETURN NULL; END IF;

  CASE p_metric
    WHEN 'steps' THEN
      SELECT to_jsonb(CASE WHEN count(*) FILTER (WHERE dl.steps IS NOT NULL) = 0 THEN NULL::numeric ELSE coalesce(sum(dl.steps), 0)::numeric END)
      INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end;
    WHEN 'workouts' THEN
      SELECT to_jsonb(CASE WHEN count(*) = 0 THEN NULL::numeric ELSE count(*)::numeric END)
      INTO v_value FROM zane_sessions s
      WHERE s.user_id = p_user_id AND s.ended IS NOT NULL AND s.date::date >= p_week_start AND s.date::date < v_week_end;
    WHEN 'adherence' THEN
      SELECT to_jsonb(round(avg(dl.adherence)::numeric, 1)) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_adherence_end AND dl.adherence IS NOT NULL;
    WHEN 'calories' THEN
      SELECT to_jsonb(round(avg(dl.calories)::numeric, 0)) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.calories IS NOT NULL;
    WHEN 'protein' THEN
      SELECT to_jsonb(round(avg(dl.protein)::numeric, 0)) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.protein IS NOT NULL;
    WHEN 'carbs' THEN
      SELECT to_jsonb(round(avg(dl.carbs)::numeric, 0)) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.carbs IS NOT NULL;
    WHEN 'fat' THEN
      SELECT to_jsonb(round(avg(dl.fat)::numeric, 0)) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.fat IS NOT NULL;
    WHEN 'fiber' THEN
      SELECT to_jsonb(round(avg(dl.fiber)::numeric, 0)) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.fiber IS NOT NULL;
    WHEN 'water' THEN
      SELECT to_jsonb(round(avg(dl.water_ml)::numeric, 0)) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.water_ml IS NOT NULL;
    WHEN 'cardioMinutes' THEN
      SELECT to_jsonb(CASE WHEN count(*) = 0 THEN NULL::numeric ELSE coalesce(sum(cl.duration_minutes), 0)::numeric END)
      INTO v_value FROM zane_cardio_logs cl
      WHERE cl.user_id = p_user_id AND cl.date::date >= p_week_start AND cl.date::date < v_week_end;
    WHEN 'cardioDistance' THEN
      SELECT to_jsonb(round(sum(cl.distance_m)::numeric, 0)) INTO v_value FROM zane_cardio_logs cl
      WHERE cl.user_id = p_user_id AND cl.date::date >= p_week_start AND cl.date::date < v_week_end AND cl.distance_m IS NOT NULL;
    WHEN 'weight' THEN
      SELECT to_jsonb(dl.weight) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.weight IS NOT NULL
      ORDER BY dl.date DESC LIMIT 1;
    WHEN 'bodyFatPct' THEN
      SELECT to_jsonb(dl.body_fat_pct) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.body_fat_pct IS NOT NULL
      ORDER BY dl.date DESC LIMIT 1;
    WHEN 'waistCm' THEN
      SELECT to_jsonb(dl.waist_cm) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.waist_cm IS NOT NULL
      ORDER BY dl.date DESC LIMIT 1;
    WHEN 'hipsCm' THEN
      SELECT to_jsonb(dl.hips_cm) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.hips_cm IS NOT NULL
      ORDER BY dl.date DESC LIMIT 1;
    WHEN 'chestCm' THEN
      SELECT to_jsonb(dl.chest_cm) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.chest_cm IS NOT NULL
      ORDER BY dl.date DESC LIMIT 1;
    WHEN 'armCm' THEN
      SELECT to_jsonb(dl.arm_cm) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.arm_cm IS NOT NULL
      ORDER BY dl.date DESC LIMIT 1;
    WHEN 'thighCm' THEN
      SELECT to_jsonb(dl.thigh_cm) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.thigh_cm IS NOT NULL
      ORDER BY dl.date DESC LIMIT 1;
    WHEN 'calfCm' THEN
      SELECT to_jsonb(dl.calf_cm) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.calf_cm IS NOT NULL
      ORDER BY dl.date DESC LIMIT 1;
    WHEN 'glucose' THEN
      SELECT to_jsonb(gl.value_mmol) INTO v_value FROM zane_glucose_logs gl
      WHERE gl.user_id = p_user_id AND gl.date::date >= p_week_start AND gl.date::date < v_week_end
      ORDER BY gl.date DESC, gl.time DESC LIMIT 1;
    WHEN 'bloodPressure' THEN
      SELECT jsonb_build_object('systolic', bp.systolic, 'diastolic', bp.diastolic) INTO v_value FROM zane_blood_pressure_logs bp
      WHERE bp.user_id = p_user_id AND bp.date::date >= p_week_start AND bp.date::date < v_week_end
      ORDER BY bp.date DESC, bp.time DESC LIMIT 1;
    WHEN 'bodyTemp' THEN
      SELECT to_jsonb(bt.value_c) INTO v_value FROM zane_body_temp_logs bt
      WHERE bt.user_id = p_user_id AND bt.date::date >= p_week_start AND bt.date::date < v_week_end
      ORDER BY bt.date DESC, bt.time DESC LIMIT 1;
    ELSE
      RETURN NULL;
  END CASE;
  RETURN v_value;
END;
$function$;

DROP FUNCTION IF EXISTS public.social_get_dashboard(date);

CREATE OR REPLACE FUNCTION public.social_get_dashboard(p_week_start date, p_today date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_metric_keys text[] := ARRAY['steps','workouts','adherence','calories','protein','carbs','fat','fiber','water','cardioMinutes','cardioDistance','weight','bodyFatPct','waistCm','hipsCm','chestCm','armCm','thighCm','calfCm','glucose','bloodPressure','bodyTemp'];
  v_adherence_end date := LEAST(p_week_start + 7, p_today);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_week_start IS NULL OR p_today IS NULL THEN RAISE EXCEPTION 'Week dates required'; END IF;
  RETURN jsonb_build_object(
    'profile', (
      SELECT jsonb_build_object(
        'userId', sp.user_id, 'handle', sp.handle, 'friendCode', sp.friend_code,
        'weightUnit', us.unit,
        'stepsVisible', sp.steps_visible, 'workoutsVisible', sp.workouts_visible,
        'adherenceVisible', sp.adherence_visible,
        'metricVisibility', sp.metric_visibility,
        'metricSlots', sp.metric_slots
      )
      FROM zane_social_profiles sp LEFT JOIN zane_user_settings us ON us.user_id = sp.user_id
      WHERE sp.user_id = v_uid
    ),
    'friends', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'friendshipId', f.id, 'userId', other.user_id, 'name', coalesce(p.name, 'Zane athlete'),
        'handle', other.handle, 'friendCode', other.friend_code, 'weightUnit', ous.unit,
        'metricVisibility', other.metric_visibility,
        'metrics', (SELECT jsonb_object_agg(metric_key, CASE WHEN lower(coalesce(other.metric_visibility->>metric_key, 'false')) = 'true' THEN public.social_health_metric_value(other.user_id, metric_key, p_week_start, p_today) ELSE NULL END) FROM unnest(v_metric_keys) AS metric_key),
        'steps', CASE WHEN other.steps_visible THEN public.social_health_metric_value(other.user_id, 'steps', p_week_start, p_today) END,
        'workouts', CASE WHEN other.workouts_visible THEN public.social_health_metric_value(other.user_id, 'workouts', p_week_start, p_today) END,
        'adherence', CASE WHEN other.adherence_visible THEN public.social_health_metric_value(other.user_id, 'adherence', p_week_start, p_today) END
      ) ORDER BY f.updated_at DESC)
      FROM zane_social_friendships f
      JOIN zane_social_profiles other ON other.user_id = CASE WHEN f.requester_id = v_uid THEN f.addressee_id ELSE f.requester_id END
      LEFT JOIN zane_profiles p ON p.id = other.user_id
      LEFT JOIN zane_user_settings ous ON ous.user_id = other.user_id
      WHERE f.status = 'accepted' AND (f.requester_id = v_uid OR f.addressee_id = v_uid)
    ), '[]'::jsonb),
    'incoming', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'userId', f.requester_id, 'name', coalesce(p.name, 'Zane athlete'), 'handle', sp.handle) ORDER BY f.created_at DESC)
      FROM zane_social_friendships f JOIN zane_social_profiles sp ON sp.user_id = f.requester_id LEFT JOIN zane_profiles p ON p.id = f.requester_id
      WHERE f.addressee_id = v_uid AND f.status = 'pending'
    ), '[]'::jsonb),
    'outgoing', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'userId', f.addressee_id, 'name', coalesce(p.name, 'Zane athlete'), 'handle', sp.handle) ORDER BY f.created_at DESC)
      FROM zane_social_friendships f JOIN zane_social_profiles sp ON sp.user_id = f.addressee_id LEFT JOIN zane_profiles p ON p.id = f.addressee_id
      WHERE f.requester_id = v_uid AND f.status = 'pending'
    ), '[]'::jsonb),
    'groupMembers', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'groupId', gm.group_id, 'userId', gm.user_id, 'role', gm.role, 'joinedAt', gm.joined_at,
        'name', coalesce(p.name, 'Zane athlete'), 'handle', sp.handle,
        'steps', CASE WHEN sp.steps_visible THEN public.social_health_metric_value(gm.user_id, 'steps', p_week_start, p_today) END,
        'workouts', CASE WHEN sp.workouts_visible THEN public.social_health_metric_value(gm.user_id, 'workouts', p_week_start, p_today) END,
        'adherence', CASE WHEN sp.adherence_visible THEN public.social_health_metric_value(gm.user_id, 'adherence', p_week_start, p_today) END
      ) ORDER BY gm.joined_at)
      FROM zane_social_group_members gm
      JOIN zane_social_profiles sp ON sp.user_id = gm.user_id
      LEFT JOIN zane_profiles p ON p.id = gm.user_id
      WHERE EXISTS (SELECT 1 FROM zane_social_group_members viewer WHERE viewer.group_id = gm.group_id AND viewer.user_id = v_uid)
    ), '[]'::jsonb)
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.social_update_profile(text, boolean, boolean, boolean);

CREATE OR REPLACE FUNCTION public.social_update_profile(
  p_handle text,
  p_steps_visible boolean,
  p_workouts_visible boolean,
  p_adherence_visible boolean,
  p_metric_visibility jsonb DEFAULT '{}'::jsonb,
  p_metric_slots jsonb DEFAULT '["steps","workouts","adherence"]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_handle text := nullif(lower(trim(replace(coalesce(p_handle, ''), '@', ''))), '');
  v_uid uuid := auth.uid();
  v_profile zane_social_profiles;
  v_input jsonb := CASE WHEN jsonb_typeof(coalesce(p_metric_visibility, '{}'::jsonb)) = 'object' THEN p_metric_visibility ELSE '{}'::jsonb END;
  v_visibility jsonb;
  v_slots jsonb := coalesce(p_metric_slots, '["steps","workouts","adherence"]'::jsonb);
  v_allowed text[] := ARRAY['steps','workouts','adherence','calories','protein','carbs','fat','fiber','water','cardioMinutes','cardioDistance','weight','bodyFatPct','waistCm','hipsCm','chestCm','armCm','thighCm','calfCm','glucose','bloodPressure','bodyTemp'];
  v_slot_count integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_handle IS NOT NULL AND v_handle !~ '^[a-z0-9_]{3,20}$' THEN
    RAISE EXCEPTION 'Handle must be 3-20 letters, numbers or underscores';
  END IF;

  v_visibility := jsonb_build_object(
    'steps', CASE WHEN v_input ? 'steps' THEN lower(coalesce(v_input->>'steps', '')) = 'true' ELSE coalesce(p_steps_visible, false) END,
    'workouts', CASE WHEN v_input ? 'workouts' THEN lower(coalesce(v_input->>'workouts', '')) = 'true' ELSE coalesce(p_workouts_visible, false) END,
    'adherence', CASE WHEN v_input ? 'adherence' THEN lower(coalesce(v_input->>'adherence', '')) = 'true' ELSE coalesce(p_adherence_visible, false) END,
    'calories', lower(coalesce(v_input->>'calories', '')) = 'true', 'protein', lower(coalesce(v_input->>'protein', '')) = 'true',
    'carbs', lower(coalesce(v_input->>'carbs', '')) = 'true', 'fat', lower(coalesce(v_input->>'fat', '')) = 'true',
    'fiber', lower(coalesce(v_input->>'fiber', '')) = 'true', 'water', lower(coalesce(v_input->>'water', '')) = 'true',
    'cardioMinutes', lower(coalesce(v_input->>'cardioMinutes', '')) = 'true', 'cardioDistance', lower(coalesce(v_input->>'cardioDistance', '')) = 'true',
    'weight', lower(coalesce(v_input->>'weight', '')) = 'true', 'bodyFatPct', lower(coalesce(v_input->>'bodyFatPct', '')) = 'true',
    'waistCm', lower(coalesce(v_input->>'waistCm', '')) = 'true', 'hipsCm', lower(coalesce(v_input->>'hipsCm', '')) = 'true',
    'chestCm', lower(coalesce(v_input->>'chestCm', '')) = 'true', 'armCm', lower(coalesce(v_input->>'armCm', '')) = 'true',
    'thighCm', lower(coalesce(v_input->>'thighCm', '')) = 'true', 'calfCm', lower(coalesce(v_input->>'calfCm', '')) = 'true',
    'glucose', lower(coalesce(v_input->>'glucose', '')) = 'true', 'bloodPressure', lower(coalesce(v_input->>'bloodPressure', '')) = 'true',
    'bodyTemp', lower(coalesce(v_input->>'bodyTemp', '')) = 'true'
  );

  IF jsonb_typeof(v_slots) <> 'array' THEN
    v_slots := '["steps","workouts","adherence"]'::jsonb;
  ELSE
    SELECT count(DISTINCT value) INTO v_slot_count FROM jsonb_array_elements_text(v_slots) AS item(value);
    IF jsonb_array_length(v_slots) <> 3 OR v_slot_count <> 3 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_slots) AS item(value) WHERE NOT (item.value = ANY(v_allowed))
    ) THEN
      v_slots := '["steps","workouts","adherence"]'::jsonb;
    END IF;
  END IF;

  INSERT INTO zane_social_profiles (user_id, handle, steps_visible, workouts_visible, adherence_visible, metric_visibility, metric_slots)
  VALUES (v_uid, v_handle, (v_visibility->>'steps')::boolean, (v_visibility->>'workouts')::boolean, (v_visibility->>'adherence')::boolean, v_visibility, v_slots)
  ON CONFLICT (user_id) DO UPDATE SET
    handle = excluded.handle,
    steps_visible = excluded.steps_visible,
    workouts_visible = excluded.workouts_visible,
    adherence_visible = excluded.adherence_visible,
    metric_visibility = excluded.metric_visibility,
    metric_slots = excluded.metric_slots,
    updated_at = now()
  RETURNING * INTO v_profile;
  RETURN jsonb_build_object(
    'userId', v_profile.user_id, 'handle', v_profile.handle, 'friendCode', v_profile.friend_code,
    'stepsVisible', v_profile.steps_visible, 'workoutsVisible', v_profile.workouts_visible,
    'adherenceVisible', v_profile.adherence_visible, 'metricVisibility', v_profile.metric_visibility,
    'metricSlots', v_profile.metric_slots
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_health_metric_value(uuid, text, date, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.social_get_dashboard(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_dashboard(date, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_update_profile(text, boolean, boolean, boolean, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_update_profile(text, boolean, boolean, boolean, jsonb, jsonb) TO authenticated;
