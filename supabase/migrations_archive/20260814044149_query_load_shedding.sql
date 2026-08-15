-- Stage 2: make boot and Friends reads scale with the current user instead of
-- the whole installation.

CREATE INDEX IF NOT EXISTS zane_sets_user_entry_idx
  ON public.zane_sets(user_id, entry_id);

CREATE OR REPLACE FUNCTION public.get_exercise_best_e1rm(p_user_id uuid DEFAULT NULL)
RETURNS TABLE(ex_id text, best_e1rm double precision)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH uid AS (SELECT COALESCE(p_user_id, auth.uid()) AS id)
  SELECT e.ex_id,
    MAX(st.kg * (1 + (
      CASE WHEN st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL
           THEN LEAST(COALESCE(st.reps_l, st.reps_r), COALESCE(st.reps_r, st.reps_l))
           ELSE st.reps END
    )::numeric / 30.0))::float AS best_e1rm
  FROM zane_session_entries e
  JOIN zane_sets st
    ON st.entry_id = e.id
   AND st.user_id = (SELECT id FROM uid)
  JOIN zane_sessions s ON s.id = e.session_id
  LEFT JOIN zane_exercises ex ON ex.id = e.ex_id AND ex.user_id = e.user_id
  WHERE e.user_id = (SELECT id FROM uid)
    AND e.ex_id IS NOT NULL
    AND s.ended IS NOT NULL
    AND NOT s.is_deload
    AND NOT s.is_cleanup
    AND ex.movement_type IS DISTINCT FROM 'assisted'
    AND NOT st.warmup
    AND NOT st.skipped
    AND st.kg IS NOT NULL
    AND COALESCE(
      CASE WHEN st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL
           THEN LEAST(COALESCE(st.reps_l, st.reps_r), COALESCE(st.reps_r, st.reps_l))
           ELSE st.reps END,
      0
    ) > 0
  GROUP BY e.ex_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_exercise_best_e1rm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exercise_best_e1rm(uuid) TO authenticated;

-- CREATE OR REPLACE would create an overload because the argument list
-- changes. Drop and recreate in this migration transaction so old one-arg
-- callers continue to resolve through the default second argument.
DROP FUNCTION IF EXISTS public.get_session_stats(uuid);

CREATE FUNCTION public.get_session_stats(
  p_user_id uuid DEFAULT NULL,
  p_cutoff date DEFAULT NULL
)
RETURNS TABLE(session_id text, exercise_count integer, done_sets integer, volume double precision)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH uid AS (SELECT COALESCE(p_user_id, auth.uid()) AS id)
  SELECT s.id AS session_id,
    (SELECT COUNT(*) FROM zane_session_entries e WHERE e.session_id = s.id)::int AS exercise_count,
    (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id
       AND NOT st.warmup AND NOT st.skipped
       AND ((st.kg IS NOT NULL
             AND (st.reps IS NOT NULL OR st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL))
            OR st.time_sec IS NOT NULL))::int AS done_sets,
    COALESCE((SELECT SUM(
        CASE WHEN ex.movement_type = 'assisted'
             THEN GREATEST(0, COALESCE((
                    SELECT dl.weight FROM zane_daily_logs dl
                    WHERE dl.user_id = s.user_id AND dl.weight IS NOT NULL
                    ORDER BY abs(dl.date::date - s.date::date) LIMIT 1), 0) + st.kg)
             ELSE st.kg END
        * COALESCE(CASE WHEN st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL
             THEN LEAST(COALESCE(st.reps_l, st.reps_r), COALESCE(st.reps_r, st.reps_l))
             ELSE st.reps END, 0))
      FROM zane_sets st
      LEFT JOIN zane_session_entries e ON e.id = st.entry_id
      LEFT JOIN zane_exercises ex ON ex.id = e.ex_id
      WHERE st.session_id = s.id
        AND NOT st.warmup AND NOT st.skipped
        AND st.kg IS NOT NULL
        AND (st.reps IS NOT NULL OR st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL)
    ), 0)::float AS volume
  FROM zane_sessions s
  WHERE s.user_id = (SELECT id FROM uid)
    AND s.ended IS NOT NULL
    AND (p_cutoff IS NULL OR s.date::date < p_cutoff);
$function$;

REVOKE EXECUTE ON FUNCTION public.get_session_stats(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_session_stats(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.social_get_badge()
RETURNS TABLE(incoming_count integer, unread_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM app_private.require_social_available();

  RETURN QUERY
  SELECT
    (
      SELECT count(*)::integer
      FROM zane_social_friendships f
      WHERE f.addressee_id = v_uid
        AND f.status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM zane_social_blocks b
          WHERE (b.blocker_id = v_uid AND b.blocked_id = f.requester_id)
             OR (b.blocker_id = f.requester_id AND b.blocked_id = v_uid)
        )
    ),
    (
      SELECT count(*)::integer
      FROM zane_social_messages m
      WHERE m.sender_id <> v_uid
        AND (
          m.recipient_id = v_uid
          OR (
            m.group_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM zane_social_group_members own_member
              WHERE own_member.group_id = m.group_id AND own_member.user_id = v_uid
            )
            AND NOT EXISTS (
              SELECT 1
              FROM zane_social_group_members other_member
              JOIN zane_social_blocks b
                ON (b.blocker_id = v_uid AND b.blocked_id = other_member.user_id)
                OR (b.blocker_id = other_member.user_id AND b.blocked_id = v_uid)
              WHERE other_member.group_id = m.group_id AND other_member.user_id <> v_uid
            )
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM zane_social_message_reads mr
          WHERE mr.message_id = m.id AND mr.user_id = v_uid
        )
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_get_badge() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_badge() TO authenticated;

-- Precompute each visible person's requested metrics once. The previous
-- dashboard called social_health_metric_value repeatedly inside nested JSON
-- aggregates, including duplicate work for friends who also shared a group.
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
  v_metrics_by_user jsonb := '{}'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM app_private.require_social_available();

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

  WITH visible_users AS (
    SELECT CASE WHEN f.requester_id = v_uid THEN f.addressee_id ELSE f.requester_id END AS user_id
    FROM zane_social_friendships f
    WHERE f.status = 'accepted' AND (f.requester_id = v_uid OR f.addressee_id = v_uid)
    UNION
    SELECT gm.user_id
    FROM zane_social_group_members gm
    WHERE EXISTS (
      SELECT 1 FROM zane_social_group_members viewer
      WHERE viewer.group_id = gm.group_id AND viewer.user_id = v_uid
    )
  ), per_user AS (
    SELECT vu.user_id,
      jsonb_object_agg(metric_key,
        CASE WHEN lower(COALESCE(
          sp.metric_visibility->>metric_key,
          CASE metric_key
            WHEN 'steps' THEN sp.steps_visible::text
            WHEN 'workouts' THEN sp.workouts_visible::text
            WHEN 'adherence' THEN sp.adherence_visible::text
            ELSE 'false'
          END,
          'false'
        )) = 'true'
        THEN public.social_health_metric_value(vu.user_id, metric_key, NULL, NULL)
        ELSE NULL END
      ) AS metrics
    FROM visible_users vu
    JOIN zane_social_profiles sp ON sp.user_id = vu.user_id
    CROSS JOIN unnest(v_metric_keys) AS metric_key
    GROUP BY vu.user_id
  )
  SELECT COALESCE(jsonb_object_agg(user_id::text, metrics), '{}'::jsonb)
  INTO v_metrics_by_user
  FROM per_user;

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
    'friends', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'friendshipId', f.id, 'userId', other.user_id, 'name', COALESCE(p.name, 'Zane athlete'),
        'handle', other.handle, 'friendCode', other.friend_code, 'weightUnit', ous.unit,
        'stepsVisible', other.steps_visible, 'workoutsVisible', other.workouts_visible,
        'adherenceVisible', other.adherence_visible,
        'metricVisibility', COALESCE(other.metric_visibility, '{}'::jsonb) || jsonb_build_object(
          'steps', COALESCE(other.metric_visibility->'steps', to_jsonb(other.steps_visible)),
          'workouts', COALESCE(other.metric_visibility->'workouts', to_jsonb(other.workouts_visible)),
          'adherence', COALESCE(other.metric_visibility->'adherence', to_jsonb(other.adherence_visible))
        ),
        'metrics', COALESCE(v_metrics_by_user -> (other.user_id::text), '{}'::jsonb)
      ) ORDER BY f.updated_at DESC)
      FROM zane_social_friendships f
      JOIN zane_social_profiles other ON other.user_id = CASE WHEN f.requester_id = v_uid THEN f.addressee_id ELSE f.requester_id END
      LEFT JOIN zane_profiles p ON p.id = other.user_id
      LEFT JOIN zane_user_settings ous ON ous.user_id = other.user_id
      WHERE f.status = 'accepted' AND (f.requester_id = v_uid OR f.addressee_id = v_uid)
        AND NOT EXISTS (SELECT 1 FROM zane_social_blocks b WHERE (b.blocker_id = v_uid AND b.blocked_id = other.user_id) OR (b.blocker_id = other.user_id AND b.blocked_id = v_uid))
    ), '[]'::jsonb),
    'incoming', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'userId', f.requester_id, 'name', COALESCE(p.name, 'Zane athlete'), 'handle', sp.handle) ORDER BY f.created_at DESC)
      FROM zane_social_friendships f JOIN zane_social_profiles sp ON sp.user_id = f.requester_id LEFT JOIN zane_profiles p ON p.id = f.requester_id
      WHERE f.addressee_id = v_uid AND f.status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM zane_social_blocks b WHERE (b.blocker_id = v_uid AND b.blocked_id = f.requester_id) OR (b.blocker_id = f.requester_id AND b.blocked_id = v_uid))
    ), '[]'::jsonb),
    'outgoing', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'userId', f.addressee_id, 'name', COALESCE(p.name, 'Zane athlete'), 'handle', sp.handle) ORDER BY f.created_at DESC)
      FROM zane_social_friendships f JOIN zane_social_profiles sp ON sp.user_id = f.addressee_id LEFT JOIN zane_profiles p ON p.id = f.addressee_id
      WHERE f.requester_id = v_uid AND f.status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM zane_social_blocks b WHERE (b.blocker_id = v_uid AND b.blocked_id = f.addressee_id) OR (b.blocker_id = f.addressee_id AND b.blocked_id = v_uid))
    ), '[]'::jsonb),
    'groupMembers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'groupId', gm.group_id, 'userId', gm.user_id, 'role', gm.role, 'joinedAt', gm.joined_at,
        'name', COALESCE(p.name, 'Zane athlete'), 'handle', sp.handle,
        'steps', CASE WHEN sp.steps_visible THEN v_metrics_by_user -> (gm.user_id::text) -> 'steps' END,
        'workouts', CASE WHEN sp.workouts_visible THEN v_metrics_by_user -> (gm.user_id::text) -> 'workouts' END,
        'adherence', CASE WHEN sp.adherence_visible THEN v_metrics_by_user -> (gm.user_id::text) -> 'adherence' END
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

-- The full metrics RPC stays on demand, but it must fail before any expensive
-- work while the global maintenance switch is active.
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
  PERFORM app_private.require_social_available();
  IF NOT EXISTS (
    SELECT 1 FROM zane_social_friendships f
    WHERE f.status = 'accepted'
      AND ((f.requester_id = v_uid AND f.addressee_id = p_friend_id) OR (f.requester_id = p_friend_id AND f.addressee_id = v_uid))
      AND NOT EXISTS (SELECT 1 FROM zane_social_blocks b WHERE (b.blocker_id = v_uid AND b.blocked_id = p_friend_id) OR (b.blocker_id = p_friend_id AND b.blocked_id = v_uid))
  ) THEN RAISE EXCEPTION 'Friend not found'; END IF;

  SELECT COALESCE(sp.metric_visibility, '{}'::jsonb), us.unit,
         sp.steps_visible, sp.workouts_visible, sp.adherence_visible
    INTO v_metric_visibility, v_weight_unit, v_steps_visible, v_workouts_visible, v_adherence_visible
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
      WHERE lower(COALESCE(v_metric_visibility->>metric_key, 'false')) = 'true'
    ), '{}'::jsonb)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_get_friend_metrics(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_friend_metrics(uuid) TO authenticated;

-- Preserve the mature workout/profile implementations unchanged in the
-- private schema and put small guarded public wrappers in front of them. This
-- avoids duplicating security-sensitive access logic just to add maintenance
-- load shedding.
ALTER FUNCTION public.social_lookup_profile(text) SET SCHEMA app_private;
ALTER FUNCTION public.social_get_workout_feed() SET SCHEMA app_private;
ALTER FUNCTION public.social_get_workout_detail(uuid, text) SET SCHEMA app_private;

REVOKE EXECUTE ON FUNCTION app_private.social_lookup_profile(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION app_private.social_get_workout_feed() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION app_private.social_get_workout_detail(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.social_lookup_profile(p_query text)
RETURNS TABLE(user_id uuid, handle text, display_name text, friend_code text, relationship text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM app_private.require_social_available();
  RETURN QUERY SELECT * FROM app_private.social_lookup_profile(p_query);
END;
$function$;

CREATE FUNCTION public.social_get_workout_feed()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM app_private.require_social_available();
  RETURN app_private.social_get_workout_feed();
END;
$function$;

CREATE FUNCTION public.social_get_workout_detail(p_owner_id uuid, p_session_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM app_private.require_social_available();
  RETURN app_private.social_get_workout_detail(p_owner_id, p_session_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_lookup_profile(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_lookup_profile(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_get_workout_feed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_workout_feed() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_get_workout_detail(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_workout_detail(uuid, text) TO authenticated;

-- Every client-facing Social mutation gets the same cheap maintenance guard.
-- The mature implementations keep their existing validation and access logic
-- unchanged behind private wrappers.
ALTER FUNCTION public.social_add_workout_comment(text, text, text) SET SCHEMA app_private;
ALTER FUNCTION public.social_block_user(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.social_create_group(text) SET SCHEMA app_private;
ALTER FUNCTION public.social_create_group_plan_share(uuid, text, jsonb) SET SCHEMA app_private;
ALTER FUNCTION public.social_create_plan_share(uuid, text, jsonb) SET SCHEMA app_private;
ALTER FUNCTION public.social_delete_group(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.social_delete_plan_share(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.social_join_group(text) SET SCHEMA app_private;
ALTER FUNCTION public.social_leave_group(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.social_mark_plan_imported(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.social_remove_friend(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.social_report(uuid, uuid, uuid, text, text) SET SCHEMA app_private;
ALTER FUNCTION public.social_respond_friend_request(uuid, boolean) SET SCHEMA app_private;
ALTER FUNCTION public.social_send_friend_request(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.social_update_metric_preferences(jsonb, jsonb) SET SCHEMA app_private;
ALTER FUNCTION public.social_update_profile(text, boolean, boolean, boolean, jsonb, jsonb) SET SCHEMA app_private;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.social_available() TO authenticated;

CREATE FUNCTION public.social_add_workout_comment(p_session_id text, p_body text, p_kind text DEFAULT 'comment')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  PERFORM app_private.require_social_available();
  RETURN app_private.social_add_workout_comment(p_session_id, p_body, p_kind);
END;
$function$;

CREATE FUNCTION public.social_block_user(p_target_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN PERFORM app_private.require_social_available(); PERFORM app_private.social_block_user(p_target_id); END;
$function$;

CREATE FUNCTION public.social_create_group(p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN PERFORM app_private.require_social_available(); RETURN app_private.social_create_group(p_name); END;
$function$;

CREATE FUNCTION public.social_create_group_plan_share(p_group_id uuid, p_plan_name text, p_snapshot jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN PERFORM app_private.require_social_available(); RETURN app_private.social_create_group_plan_share(p_group_id, p_plan_name, p_snapshot); END;
$function$;

CREATE FUNCTION public.social_create_plan_share(p_recipient_id uuid, p_plan_name text, p_snapshot jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN PERFORM app_private.require_social_available(); RETURN app_private.social_create_plan_share(p_recipient_id, p_plan_name, p_snapshot); END;
$function$;

CREATE FUNCTION public.social_delete_group(p_group_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN PERFORM app_private.require_social_available(); PERFORM app_private.social_delete_group(p_group_id); END;
$function$;

CREATE FUNCTION public.social_delete_plan_share(p_share_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN PERFORM app_private.require_social_available(); PERFORM app_private.social_delete_plan_share(p_share_id); END;
$function$;

CREATE FUNCTION public.social_join_group(p_join_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN PERFORM app_private.require_social_available(); RETURN app_private.social_join_group(p_join_code); END;
$function$;

CREATE FUNCTION public.social_leave_group(p_group_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN PERFORM app_private.require_social_available(); PERFORM app_private.social_leave_group(p_group_id); END;
$function$;

CREATE FUNCTION public.social_mark_plan_imported(p_share_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN PERFORM app_private.require_social_available(); PERFORM app_private.social_mark_plan_imported(p_share_id); END;
$function$;

CREATE FUNCTION public.social_remove_friend(p_target_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN PERFORM app_private.require_social_available(); PERFORM app_private.social_remove_friend(p_target_id); END;
$function$;

CREATE FUNCTION public.social_report(p_target_user_id uuid, p_message_id uuid, p_group_id uuid, p_reason text, p_details text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  PERFORM app_private.require_social_available();
  RETURN app_private.social_report(p_target_user_id, p_message_id, p_group_id, p_reason, p_details);
END;
$function$;

CREATE FUNCTION public.social_respond_friend_request(p_friendship_id uuid, p_accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN PERFORM app_private.require_social_available(); PERFORM app_private.social_respond_friend_request(p_friendship_id, p_accept); END;
$function$;

CREATE FUNCTION public.social_send_friend_request(p_target_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN PERFORM app_private.require_social_available(); RETURN app_private.social_send_friend_request(p_target_id); END;
$function$;

CREATE FUNCTION public.social_update_metric_preferences(
  p_metric_visibility jsonb DEFAULT '{}'::jsonb,
  p_metric_slots jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  PERFORM app_private.require_social_available();
  RETURN app_private.social_update_metric_preferences(p_metric_visibility, p_metric_slots);
END;
$function$;

CREATE FUNCTION public.social_update_profile(
  p_handle text,
  p_steps_visible boolean,
  p_workouts_visible boolean,
  p_adherence_visible boolean,
  p_metric_visibility jsonb DEFAULT '{}'::jsonb,
  p_metric_slots jsonb DEFAULT '["steps", "workouts", "adherence"]'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  PERFORM app_private.require_social_available();
  RETURN app_private.social_update_profile(
    p_handle, p_steps_visible, p_workouts_visible, p_adherence_visible,
    p_metric_visibility, p_metric_slots
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_health_metric_value(uuid, text, date, date) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.social_add_workout_comment(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_block_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_create_group(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_create_group_plan_share(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_create_plan_share(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_delete_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_delete_plan_share(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_join_group(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_leave_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_mark_plan_imported(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_remove_friend(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_report(uuid, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_respond_friend_request(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_send_friend_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_update_metric_preferences(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_update_profile(text, boolean, boolean, boolean, jsonb, jsonb) TO authenticated;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default; all guarded Social
-- mutations are authenticated-only.
REVOKE EXECUTE ON FUNCTION public.social_add_workout_comment(text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_block_user(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_create_group(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_create_group_plan_share(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_create_plan_share(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_delete_group(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_delete_plan_share(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_join_group(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_leave_group(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_mark_plan_imported(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_remove_friend(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_report(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_respond_friend_request(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_send_friend_request(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_update_metric_preferences(jsonb, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_update_profile(text, boolean, boolean, boolean, jsonb, jsonb) FROM PUBLIC, anon;
