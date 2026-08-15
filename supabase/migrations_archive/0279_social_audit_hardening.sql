-- Security and correctness hardening for the Friends preview.
-- Client supplied dates remain accepted for API compatibility, but all shared
-- metrics are calculated from each profile owner's local day and week.

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
  v_zone text;
  v_offset integer;
  v_owner_today date;
  v_week_start date;
  v_week_end date;
  v_adherence_end date;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT nullif(trim(us.time_zone), ''), us.tz_offset_minutes
    INTO v_zone, v_offset
    FROM zane_user_settings us
   WHERE us.user_id = p_user_id;

  IF v_zone IS NOT NULL AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_zone) THEN
    v_owner_today := (now() AT TIME ZONE v_zone)::date;
  ELSE
    v_owner_today := ((now() AT TIME ZONE 'UTC') + make_interval(mins => coalesce(v_offset, 0)))::date;
  END IF;
  v_week_start := date_trunc('week', v_owner_today)::date;
  v_week_end := v_week_start + 7;
  v_adherence_end := least(v_week_end, v_owner_today);

  CASE p_metric
    WHEN 'steps' THEN
      SELECT to_jsonb(CASE WHEN count(*) FILTER (WHERE dl.steps IS NOT NULL) = 0 THEN NULL::numeric ELSE coalesce(sum(dl.steps), 0)::numeric END)
        INTO v_value FROM zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_week_end;
    WHEN 'workouts' THEN
      SELECT to_jsonb(CASE WHEN count(*) = 0 THEN NULL::numeric ELSE count(*)::numeric END)
        INTO v_value FROM zane_sessions s
       WHERE s.user_id = p_user_id AND s.ended IS NOT NULL AND s.date::date >= v_week_start AND s.date::date < v_week_end;
    WHEN 'adherence' THEN
      SELECT to_jsonb(round(avg(dl.adherence)::numeric, 1)) INTO v_value FROM zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_adherence_end AND dl.adherence IS NOT NULL;
    WHEN 'calories' THEN
      SELECT to_jsonb(round(avg(dl.calories)::numeric, 0)) INTO v_value FROM zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_adherence_end AND dl.calories IS NOT NULL;
    WHEN 'protein' THEN
      SELECT to_jsonb(round(avg(dl.protein)::numeric, 0)) INTO v_value FROM zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_adherence_end AND dl.protein IS NOT NULL;
    WHEN 'carbs' THEN
      SELECT to_jsonb(round(avg(dl.carbs)::numeric, 0)) INTO v_value FROM zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_adherence_end AND dl.carbs IS NOT NULL;
    WHEN 'fat' THEN
      SELECT to_jsonb(round(avg(dl.fat)::numeric, 0)) INTO v_value FROM zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_adherence_end AND dl.fat IS NOT NULL;
    WHEN 'fiber' THEN
      SELECT to_jsonb(round(avg(dl.fiber)::numeric, 0)) INTO v_value FROM zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_adherence_end AND dl.fiber IS NOT NULL;
    WHEN 'water' THEN
      SELECT to_jsonb(round(avg(dl.water_ml)::numeric, 0)) INTO v_value FROM zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_adherence_end AND dl.water_ml IS NOT NULL;
    WHEN 'cardioMinutes' THEN
      SELECT to_jsonb(CASE WHEN count(*) = 0 THEN NULL::numeric ELSE coalesce(sum(cl.duration_minutes), 0)::numeric END)
        INTO v_value FROM zane_cardio_logs cl
       WHERE cl.user_id = p_user_id AND cl.date::date >= v_week_start AND cl.date::date < v_week_end;
    WHEN 'cardioDistance' THEN
      SELECT to_jsonb(round(sum(cl.distance_m)::numeric, 0)) INTO v_value FROM zane_cardio_logs cl
       WHERE cl.user_id = p_user_id AND cl.date::date >= v_week_start AND cl.date::date < v_week_end AND cl.distance_m IS NOT NULL;
    WHEN 'weight' THEN
      SELECT to_jsonb(dl.weight) INTO v_value FROM zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_week_end AND dl.weight IS NOT NULL
       ORDER BY dl.date DESC LIMIT 1;
    WHEN 'bodyFatPct' THEN
      SELECT to_jsonb(dl.body_fat_pct) INTO v_value FROM zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_week_end AND dl.body_fat_pct IS NOT NULL
       ORDER BY dl.date DESC LIMIT 1;
    WHEN 'waistCm' THEN
      SELECT to_jsonb(dl.waist_cm) INTO v_value FROM zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_week_end AND dl.waist_cm IS NOT NULL
       ORDER BY dl.date DESC LIMIT 1;
    WHEN 'hipsCm' THEN
      SELECT to_jsonb(dl.hips_cm) INTO v_value FROM zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_week_end AND dl.hips_cm IS NOT NULL
       ORDER BY dl.date DESC LIMIT 1;
    WHEN 'chestCm' THEN
      SELECT to_jsonb(dl.chest_cm) INTO v_value FROM zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_week_end AND dl.chest_cm IS NOT NULL
       ORDER BY dl.date DESC LIMIT 1;
    WHEN 'armCm' THEN
      SELECT to_jsonb(dl.arm_cm) INTO v_value FROM zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_week_end AND dl.arm_cm IS NOT NULL
       ORDER BY dl.date DESC LIMIT 1;
    WHEN 'thighCm' THEN
      SELECT to_jsonb(dl.thigh_cm) INTO v_value FROM zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_week_end AND dl.thigh_cm IS NOT NULL
       ORDER BY dl.date DESC LIMIT 1;
    WHEN 'calfCm' THEN
      SELECT to_jsonb(dl.calf_cm) INTO v_value FROM zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_week_end AND dl.calf_cm IS NOT NULL
       ORDER BY dl.date DESC LIMIT 1;
    WHEN 'glucose' THEN
      SELECT to_jsonb(gl.value_mmol) INTO v_value FROM zane_glucose_logs gl
       WHERE gl.user_id = p_user_id AND gl.date::date >= v_week_start AND gl.date::date < v_week_end
       ORDER BY gl.date DESC, gl.time DESC LIMIT 1;
    WHEN 'bloodPressure' THEN
      SELECT jsonb_build_object('systolic', bp.systolic, 'diastolic', bp.diastolic) INTO v_value FROM zane_blood_pressure_logs bp
       WHERE bp.user_id = p_user_id AND bp.date::date >= v_week_start AND bp.date::date < v_week_end
       ORDER BY bp.date DESC, bp.time DESC LIMIT 1;
    WHEN 'bodyTemp' THEN
      SELECT to_jsonb(bt.value_c) INTO v_value FROM zane_body_temp_logs bt
       WHERE bt.user_id = p_user_id AND bt.date::date >= v_week_start AND bt.date::date < v_week_end
       ORDER BY bt.date DESC, bt.time DESC LIMIT 1;
    ELSE
      RETURN NULL;
  END CASE;
  RETURN v_value;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_health_metric_value(uuid, text, date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.social_get_dashboard(p_week_start date, p_today date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_metric_keys text[] := ARRAY['steps','workouts','adherence','calories','protein','carbs','fat','fiber','water','cardioMinutes','cardioDistance','weight','bodyFatPct','waistCm','hipsCm','chestCm','armCm','thighCm','calfCm','glucose','bloodPressure','bodyTemp'];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
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
        'metricVisibility', other.metric_visibility,
        'metrics', (SELECT jsonb_object_agg(metric_key, CASE WHEN lower(coalesce(other.metric_visibility->>metric_key, 'false')) = 'true' THEN public.social_health_metric_value(other.user_id, metric_key, NULL, NULL) ELSE NULL END) FROM unnest(v_metric_keys) AS metric_key),
        'steps', CASE WHEN other.steps_visible THEN public.social_health_metric_value(other.user_id, 'steps', NULL, NULL) END,
        'workouts', CASE WHEN other.workouts_visible THEN public.social_health_metric_value(other.user_id, 'workouts', NULL, NULL) END,
        'adherence', CASE WHEN other.adherence_visible THEN public.social_health_metric_value(other.user_id, 'adherence', NULL, NULL) END
      ) ORDER BY f.updated_at DESC)
      FROM zane_social_friendships f
      JOIN zane_social_profiles other ON other.user_id = CASE WHEN f.requester_id = v_uid THEN f.addressee_id ELSE f.requester_id END
      LEFT JOIN zane_profiles p ON p.id = other.user_id
      LEFT JOIN zane_user_settings ous ON ous.user_id = other.user_id
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

REVOKE EXECUTE ON FUNCTION public.social_get_dashboard(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_dashboard(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.social_block_user(p_target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_target_id IS NULL OR auth.uid() = p_target_id THEN RAISE EXCEPTION 'Invalid block target'; END IF;
  INSERT INTO zane_social_blocks (blocker_id, blocked_id) VALUES (auth.uid(), p_target_id) ON CONFLICT DO NOTHING;
  DELETE FROM zane_social_friendships WHERE (requester_id = auth.uid() AND addressee_id = p_target_id) OR (requester_id = p_target_id AND addressee_id = auth.uid());
  DELETE FROM zane_social_group_members own_members
   USING zane_social_group_members target_members
   WHERE own_members.group_id = target_members.group_id
     AND own_members.user_id = auth.uid()
     AND target_members.user_id = p_target_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_join_group(p_join_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_group_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT id INTO v_group_id FROM zane_social_groups WHERE upper(join_code) = upper(trim(coalesce(p_join_code, '')));
  IF v_group_id IS NULL THEN RAISE EXCEPTION 'Group not found'; END IF;
  IF EXISTS (
    SELECT 1 FROM zane_social_group_members gm
    JOIN zane_social_blocks b ON (b.blocker_id = auth.uid() AND b.blocked_id = gm.user_id) OR (b.blocker_id = gm.user_id AND b.blocked_id = auth.uid())
    WHERE gm.group_id = v_group_id AND gm.user_id <> auth.uid()
  ) THEN RAISE EXCEPTION 'You cannot join this group'; END IF;
  INSERT INTO zane_social_group_members (group_id, user_id) VALUES (v_group_id, auth.uid()) ON CONFLICT DO NOTHING;
  RETURN v_group_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_workout_access(p_owner_id uuid, p_started_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    auth.uid() = p_owner_id
    OR EXISTS (
      SELECT 1
      FROM zane_social_friendships f
      JOIN zane_social_profiles sp ON sp.user_id = p_owner_id
      WHERE f.status = 'accepted'
        AND f.accepted_at IS NOT NULL
        AND p_started_at IS NOT NULL
        AND f.accepted_at <= p_started_at
        AND sp.workouts_visible
        AND NOT EXISTS (SELECT 1 FROM zane_social_blocks b WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p_owner_id) OR (b.blocker_id = p_owner_id AND b.blocked_id = auth.uid()))
        AND ((f.requester_id = auth.uid() AND f.addressee_id = p_owner_id) OR (f.requester_id = p_owner_id AND f.addressee_id = auth.uid()))
    )
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.social_workout_access(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- Keep profile changes visible through the already subscribed friendship rows.
CREATE OR REPLACE FUNCTION public.social_profile_touch_friendships()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE zane_social_friendships
     SET updated_at = now()
   WHERE status = 'accepted' AND (requester_id = NEW.user_id OR addressee_id = NEW.user_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zane_social_profile_touch_friendships ON public.zane_social_profiles;
CREATE TRIGGER zane_social_profile_touch_friendships
AFTER UPDATE ON public.zane_social_profiles
FOR EACH ROW EXECUTE FUNCTION public.social_profile_touch_friendships();
REVOKE EXECUTE ON FUNCTION public.social_profile_touch_friendships() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.zane_social_messages_guard_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.created_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zane_social_messages_guard_insert ON public.zane_social_messages;
CREATE TRIGGER zane_social_messages_guard_insert
BEFORE INSERT ON public.zane_social_messages
FOR EACH ROW EXECUTE FUNCTION public.zane_social_messages_guard_insert();
REVOKE EXECUTE ON FUNCTION public.zane_social_messages_guard_insert() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.zane_coaching_notes_guard_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.created_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zane_coaching_notes_guard_insert ON public.zane_coaching_notes;
CREATE TRIGGER zane_coaching_notes_guard_insert
BEFORE INSERT ON public.zane_coaching_notes
FOR EACH ROW EXECUTE FUNCTION public.zane_coaching_notes_guard_insert();
REVOKE EXECUTE ON FUNCTION public.zane_coaching_notes_guard_insert() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "social group members read" ON public.zane_social_groups;
CREATE POLICY "social group members read" ON public.zane_social_groups FOR SELECT TO authenticated USING (
  public.social_is_group_member(id, (select auth.uid()))
  AND NOT EXISTS (
    SELECT 1 FROM zane_social_group_members gm
    JOIN zane_social_blocks b ON (b.blocker_id = (select auth.uid()) AND b.blocked_id = gm.user_id) OR (b.blocker_id = gm.user_id AND b.blocked_id = (select auth.uid()))
    WHERE gm.group_id = id AND gm.user_id <> (select auth.uid())
  )
);

DROP POLICY IF EXISTS "social membership read" ON public.zane_social_group_members;
CREATE POLICY "social membership read" ON public.zane_social_group_members FOR SELECT TO authenticated USING (
  public.social_is_group_member(group_id, (select auth.uid()))
  AND NOT EXISTS (
    SELECT 1 FROM zane_social_group_members gm
    JOIN zane_social_blocks b ON (b.blocker_id = (select auth.uid()) AND b.blocked_id = gm.user_id) OR (b.blocker_id = gm.user_id AND b.blocked_id = (select auth.uid()))
    WHERE gm.group_id = zane_social_group_members.group_id AND gm.user_id <> (select auth.uid())
  )
);

DROP POLICY IF EXISTS "social messages read" ON public.zane_social_messages;
CREATE POLICY "social messages read" ON public.zane_social_messages FOR SELECT TO authenticated USING (
  sender_id = (select auth.uid())
  OR (recipient_id = (select auth.uid()) AND NOT EXISTS (SELECT 1 FROM zane_social_blocks b WHERE (b.blocker_id = (select auth.uid()) AND b.blocked_id = sender_id) OR (b.blocker_id = sender_id AND b.blocked_id = (select auth.uid()))))
  OR (
    group_id IS NOT NULL AND public.social_is_group_member(group_id, (select auth.uid()))
    AND NOT EXISTS (
      SELECT 1 FROM zane_social_group_members gm
      JOIN zane_social_blocks b ON (b.blocker_id = (select auth.uid()) AND b.blocked_id = gm.user_id) OR (b.blocker_id = gm.user_id AND b.blocked_id = (select auth.uid()))
      WHERE gm.group_id = zane_social_messages.group_id AND gm.user_id <> (select auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "social messages send" ON public.zane_social_messages;
CREATE POLICY "social messages send" ON public.zane_social_messages FOR INSERT TO authenticated WITH CHECK (
  sender_id = (select auth.uid()) AND (
    (recipient_id IS NOT NULL AND EXISTS (SELECT 1 FROM zane_social_friendships f WHERE f.status = 'accepted' AND ((f.requester_id = (select auth.uid()) AND f.addressee_id = recipient_id) OR (f.requester_id = recipient_id AND f.addressee_id = (select auth.uid()))) AND NOT EXISTS (SELECT 1 FROM zane_social_blocks b WHERE (b.blocker_id = (select auth.uid()) AND b.blocked_id = recipient_id) OR (b.blocker_id = recipient_id AND b.blocked_id = (select auth.uid())))))
    OR (group_id IS NOT NULL AND public.social_is_group_member(group_id, (select auth.uid())) AND NOT EXISTS (
      SELECT 1 FROM zane_social_group_members gm
      JOIN zane_social_blocks b ON (b.blocker_id = (select auth.uid()) AND b.blocked_id = gm.user_id) OR (b.blocker_id = gm.user_id AND b.blocked_id = (select auth.uid()))
      WHERE gm.group_id = zane_social_messages.group_id AND gm.user_id <> (select auth.uid())
    ))
  )
);

DROP POLICY IF EXISTS "social attachment read" ON public.zane_social_message_attachments;
CREATE POLICY "social attachment read" ON public.zane_social_message_attachments FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM zane_social_messages m
  WHERE m.id = message_id AND (
    m.sender_id = (select auth.uid())
    OR (m.recipient_id = (select auth.uid()) AND NOT EXISTS (SELECT 1 FROM zane_social_blocks b WHERE (b.blocker_id = (select auth.uid()) AND b.blocked_id = m.sender_id) OR (b.blocker_id = m.sender_id AND b.blocked_id = (select auth.uid()))))
    OR (m.group_id IS NOT NULL AND public.social_is_group_member(m.group_id, (select auth.uid())) AND NOT EXISTS (
      SELECT 1 FROM zane_social_group_members gm
      JOIN zane_social_blocks b ON (b.blocker_id = (select auth.uid()) AND b.blocked_id = gm.user_id) OR (b.blocker_id = gm.user_id AND b.blocked_id = (select auth.uid()))
      WHERE gm.group_id = m.group_id AND gm.user_id <> (select auth.uid())
    ))
  )
));

DROP POLICY IF EXISTS "social attachment own insert" ON public.zane_social_message_attachments;
CREATE POLICY "social attachment own insert" ON public.zane_social_message_attachments FOR INSERT TO authenticated WITH CHECK (
  uploaded_by = (select auth.uid())
  AND storage_path LIKE ((select auth.uid())::text || '/%')
  AND EXISTS (SELECT 1 FROM zane_social_messages m WHERE m.id = message_id AND m.sender_id = (select auth.uid()))
);

DROP POLICY IF EXISTS "social plan share read" ON public.zane_social_plan_shares;
CREATE POLICY "social plan share read" ON public.zane_social_plan_shares FOR SELECT TO authenticated USING (
  sender_id = (select auth.uid())
  OR (recipient_id = (select auth.uid()) AND NOT EXISTS (SELECT 1 FROM zane_social_blocks b WHERE (b.blocker_id = (select auth.uid()) AND b.blocked_id = sender_id) OR (b.blocker_id = sender_id AND b.blocked_id = (select auth.uid()))))
  OR (group_id IS NOT NULL AND public.social_is_group_member(group_id, (select auth.uid())) AND NOT EXISTS (
    SELECT 1 FROM zane_social_group_members gm
    JOIN zane_social_blocks b ON (b.blocker_id = (select auth.uid()) AND b.blocked_id = gm.user_id) OR (b.blocker_id = gm.user_id AND b.blocked_id = (select auth.uid()))
    WHERE gm.group_id = zane_social_plan_shares.group_id AND gm.user_id <> (select auth.uid())
  ))
);

DROP POLICY IF EXISTS "social messages edit own" ON public.zane_social_messages;
CREATE POLICY "social messages edit own" ON public.zane_social_messages FOR UPDATE TO authenticated USING (sender_id = (select auth.uid()) AND created_at >= now() - interval '60 minutes') WITH CHECK (sender_id = (select auth.uid()) AND created_at >= now() - interval '60 minutes');
DROP POLICY IF EXISTS "social messages delete own" ON public.zane_social_messages;
CREATE POLICY "social messages delete own" ON public.zane_social_messages FOR DELETE TO authenticated USING (sender_id = (select auth.uid()) AND created_at >= now() - interval '60 minutes');

DROP POLICY IF EXISTS "authors can edit notes" ON public.zane_coaching_notes;
CREATE POLICY "authors can edit notes" ON public.zane_coaching_notes FOR UPDATE TO public USING (
  author_id = (select auth.uid()) AND created_at >= now() - interval '60 minutes'
  AND EXISTS (SELECT 1 FROM zane_coaching c WHERE c.id = zane_coaching_notes.coaching_id AND (c.coach_id = (select auth.uid()) OR c.client_id = (select auth.uid())))
) WITH CHECK (
  author_id = (select auth.uid()) AND created_at >= now() - interval '60 minutes'
  AND EXISTS (SELECT 1 FROM zane_coaching c WHERE c.id = zane_coaching_notes.coaching_id AND (c.coach_id = (select auth.uid()) OR c.client_id = (select auth.uid())))
);

DROP POLICY IF EXISTS "authors can delete notes" ON public.zane_coaching_notes;
CREATE POLICY "authors can delete notes" ON public.zane_coaching_notes FOR DELETE TO public USING (
  author_id = (select auth.uid()) AND created_at >= now() - interval '60 minutes'
  AND EXISTS (SELECT 1 FROM zane_coaching c WHERE c.id = zane_coaching_notes.coaching_id AND (c.coach_id = (select auth.uid()) OR c.client_id = (select auth.uid())))
);

CREATE OR REPLACE FUNCTION public.social_create_plan_share(p_recipient_id uuid, p_plan_name text, p_snapshot jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_recipient_id IS NULL OR auth.uid() = p_recipient_id THEN RAISE EXCEPTION 'Invalid recipient'; END IF;
  IF char_length(trim(coalesce(p_plan_name, ''))) = 0 THEN RAISE EXCEPTION 'Plan name required'; END IF;
  IF EXISTS (SELECT 1 FROM zane_social_blocks b WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p_recipient_id) OR (b.blocker_id = p_recipient_id AND b.blocked_id = auth.uid())) THEN RAISE EXCEPTION 'User unavailable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM zane_social_friendships f WHERE f.status = 'accepted' AND ((f.requester_id = auth.uid() AND f.addressee_id = p_recipient_id) OR (f.requester_id = p_recipient_id AND f.addressee_id = auth.uid()))) THEN RAISE EXCEPTION 'Friends only'; END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' OR octet_length(p_snapshot::text) > 100000 THEN RAISE EXCEPTION 'Invalid plan snapshot'; END IF;
  INSERT INTO zane_social_plan_shares (sender_id, recipient_id, plan_name, snapshot) VALUES (auth.uid(), p_recipient_id, trim(p_plan_name), p_snapshot) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_create_group_plan_share(p_group_id uuid, p_plan_name text, p_snapshot jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_group_id IS NULL THEN RAISE EXCEPTION 'Invalid group'; END IF;
  IF char_length(trim(coalesce(p_plan_name, ''))) = 0 THEN RAISE EXCEPTION 'Plan name required'; END IF;
  IF NOT public.social_is_group_member(p_group_id, auth.uid()) THEN RAISE EXCEPTION 'Group members only'; END IF;
  IF EXISTS (
    SELECT 1 FROM zane_social_group_members gm
    JOIN zane_social_blocks b ON (b.blocker_id = auth.uid() AND b.blocked_id = gm.user_id) OR (b.blocker_id = gm.user_id AND b.blocked_id = auth.uid())
    WHERE gm.group_id = p_group_id AND gm.user_id <> auth.uid()
  ) THEN RAISE EXCEPTION 'Group unavailable'; END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' OR octet_length(p_snapshot::text) > 100000 THEN RAISE EXCEPTION 'Invalid plan snapshot'; END IF;
  INSERT INTO zane_social_plan_shares (sender_id, group_id, plan_name, snapshot) VALUES (auth.uid(), p_group_id, trim(p_plan_name), p_snapshot) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_mark_plan_imported(p_share_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM zane_social_plan_shares s
    WHERE s.id = p_share_id
      AND (s.recipient_id = v_uid OR (s.group_id IS NOT NULL AND public.social_is_group_member(s.group_id, v_uid)))
      AND NOT EXISTS (
        SELECT 1 FROM zane_social_blocks b
        WHERE (s.recipient_id IS NOT NULL AND ((b.blocker_id = v_uid AND b.blocked_id = s.sender_id) OR (b.blocker_id = s.sender_id AND b.blocked_id = v_uid)))
           OR (s.group_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM zane_social_group_members gm
             WHERE gm.group_id = s.group_id AND gm.user_id <> v_uid
               AND ((b.blocker_id = v_uid AND b.blocked_id = gm.user_id) OR (b.blocker_id = gm.user_id AND b.blocked_id = v_uid))
           ))
      )
  ) THEN RAISE EXCEPTION 'Plan share not found'; END IF;
  INSERT INTO zane_social_plan_share_imports (share_id, user_id) VALUES (p_share_id, v_uid) ON CONFLICT (share_id, user_id) DO NOTHING;
  UPDATE zane_social_plan_shares SET imported_at = coalesce(imported_at, now()) WHERE id = p_share_id AND recipient_id = v_uid;
END;
$function$;

ALTER TABLE public.zane_social_message_reads REPLICA IDENTITY FULL;
DO $publication$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'zane_social_message_reads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.zane_social_message_reads;
  END IF;
END;
$publication$;

-- The feed RPC runs as SECURITY DEFINER, so the block check must also live in
-- the query instead of relying on the table policies used by the client.
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
          'sessionId', s.id, 'ownerId', s.user_id, 'ownerName', COALESCE(p.name, 'Zane athlete'),
          'dayName', s.day_name, 'date', s.date, 'startedAt', s.started_at, 'ended', s.ended,
          'live', true, 'acceptedAt', f.accepted_at,
          'setsDone', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND st.done)::int,
          'setsTotal', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND NOT st.skipped)::int,
          'exerciseCount', (SELECT COUNT(*) FROM zane_session_entries e WHERE e.session_id = s.id)::int
        ) AS row_data, s.started_at AS sort_at
        FROM zane_social_friendships f
        JOIN zane_social_profiles sp ON sp.user_id = CASE WHEN f.requester_id = v_uid THEN f.addressee_id ELSE f.requester_id END
        JOIN zane_user_settings us ON us.user_id = sp.user_id
        JOIN zane_sessions s ON s.id = us.in_progress_session_id AND s.user_id = sp.user_id
        LEFT JOIN zane_profiles p ON p.id = s.user_id
        WHERE f.status = 'accepted' AND f.accepted_at IS NOT NULL
          AND (f.requester_id = v_uid OR f.addressee_id = v_uid)
          AND sp.workouts_visible AND s.ended IS NULL
          AND COALESCE(s.started_at, s.date) IS NOT NULL
          AND f.accepted_at <= COALESCE(s.started_at, s.date)
          AND NOT EXISTS (SELECT 1 FROM zane_social_blocks b WHERE (b.blocker_id = v_uid AND b.blocked_id = s.user_id) OR (b.blocker_id = s.user_id AND b.blocked_id = v_uid))
        UNION ALL
        SELECT jsonb_build_object(
          'sessionId', s.id, 'ownerId', s.user_id, 'ownerName', COALESCE(p.name, 'Zane athlete'),
          'dayName', s.day_name, 'date', s.date, 'startedAt', s.started_at, 'ended', s.ended,
          'live', true, 'acceptedAt', NULL,
          'setsDone', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND st.done)::int,
          'setsTotal', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND NOT st.skipped)::int,
          'exerciseCount', (SELECT COUNT(*) FROM zane_session_entries e WHERE e.session_id = s.id)::int
        ) AS row_data, s.started_at AS sort_at
        FROM zane_sessions s LEFT JOIN zane_profiles p ON p.id = s.user_id
        WHERE s.user_id = v_uid AND s.ended IS NULL AND COALESCE(s.started_at, s.date) IS NOT NULL
          AND EXISTS (SELECT 1 FROM zane_social_workout_comments wc WHERE wc.session_id = s.id)
      ) live_rows
    ), '[]'::jsonb),
    'history', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY sort_at DESC)
      FROM (
        SELECT jsonb_build_object(
          'sessionId', s.id, 'ownerId', s.user_id, 'ownerName', COALESCE(p.name, 'Zane athlete'),
          'dayName', s.day_name, 'date', s.date, 'startedAt', s.started_at, 'ended', s.ended,
          'live', false, 'acceptedAt', f.accepted_at,
          'setsDone', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND st.done)::int,
          'setsTotal', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND NOT st.skipped)::int,
          'exerciseCount', (SELECT COUNT(*) FROM zane_session_entries e WHERE e.session_id = s.id)::int
        ) AS row_data, COALESCE(s.ended, s.date) AS sort_at
        FROM zane_social_friendships f
        JOIN zane_social_profiles sp ON sp.user_id = CASE WHEN f.requester_id = v_uid THEN f.addressee_id ELSE f.requester_id END
        JOIN zane_sessions s ON s.user_id = sp.user_id
        LEFT JOIN zane_profiles p ON p.id = s.user_id
        WHERE f.status = 'accepted' AND f.accepted_at IS NOT NULL
          AND (f.requester_id = v_uid OR f.addressee_id = v_uid)
          AND sp.workouts_visible AND s.ended IS NOT NULL
          AND COALESCE(s.started_at, s.date) IS NOT NULL
          AND f.accepted_at <= COALESCE(s.started_at, s.date)
          AND (s.duration_minutes IS NOT NULL OR (s.started_at IS NOT NULL AND s.ended > s.started_at))
          AND NOT EXISTS (SELECT 1 FROM zane_social_blocks b WHERE (b.blocker_id = v_uid AND b.blocked_id = s.user_id) OR (b.blocker_id = s.user_id AND b.blocked_id = v_uid))
        UNION ALL
        SELECT jsonb_build_object(
          'sessionId', s.id, 'ownerId', s.user_id, 'ownerName', COALESCE(p.name, 'Zane athlete'),
          'dayName', s.day_name, 'date', s.date, 'startedAt', s.started_at, 'ended', s.ended,
          'live', false, 'acceptedAt', NULL,
          'setsDone', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND st.done)::int,
          'setsTotal', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND NOT st.skipped)::int,
          'exerciseCount', (SELECT COUNT(*) FROM zane_session_entries e WHERE e.session_id = s.id)::int
        ) AS row_data, COALESCE(s.ended, s.date) AS sort_at
        FROM zane_sessions s LEFT JOIN zane_profiles p ON p.id = s.user_id
        WHERE s.user_id = v_uid AND s.ended IS NOT NULL
          AND COALESCE(s.started_at, s.date) IS NOT NULL
          AND (s.duration_minutes IS NOT NULL OR (s.started_at IS NOT NULL AND s.ended > s.started_at))
          AND EXISTS (SELECT 1 FROM zane_social_workout_comments wc WHERE wc.session_id = s.id)
        ORDER BY sort_at DESC LIMIT 100
      ) history_rows
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_get_workout_feed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_workout_feed() TO authenticated;
