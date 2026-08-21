-- Admin usage dashboard. One server-side snapshot keeps the App stats sheet
-- cheap to refresh and avoids a collection of client-side table scans.
-- All windows use server time. Imported workout history is deliberately
-- excluded from workout and activity metrics.

CREATE OR REPLACE FUNCTION public.get_app_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_24_start timestamptz := v_now - INTERVAL '24 hours';
  v_7_start timestamptz := v_now - INTERVAL '7 days';
  v_14_start timestamptz := v_now - INTERVAL '14 days';
  v_30_start timestamptz := v_now - INTERVAL '30 days';
  v_today date := (v_now AT TIME ZONE 'UTC')::date;
  v_result jsonb;
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RETURN '{}'::jsonb;
  END IF;

  WITH workouts AS (
    SELECT
      s.id,
      s.user_id,
      s.started_at,
      s.ended,
      s.duration_minutes,
      COALESCE(s.completed_server_at, s.ended) AS completed_at
    FROM public.zane_sessions s
    WHERE COALESCE(s.imported, false) = false
  ),
  activity_events(user_id, event_at, feature) AS (
    SELECT w.user_id, w.started_at, 'workouts'::text
    FROM workouts w
    WHERE w.started_at IS NOT NULL AND w.started_at BETWEEN v_30_start AND v_now
    UNION ALL
    SELECT w.user_id, w.completed_at, 'workouts'::text
    FROM workouts w
    WHERE w.completed_at IS NOT NULL AND w.completed_at BETWEEN v_30_start AND v_now
    UNION ALL
    SELECT f.user_id, f.created_at, 'food'::text
    FROM public.zane_food_logs f
    WHERE f.created_at BETWEEN v_30_start AND v_now
    UNION ALL
    SELECT d.user_id, d.updated_at, 'health'::text
    FROM public.zane_daily_logs d
    WHERE d.updated_at BETWEEN v_30_start AND v_now
    UNION ALL
    SELECT c.user_id, c.created_at, 'cardio'::text
    FROM public.zane_cardio_logs c
    WHERE c.created_at BETWEEN v_30_start AND v_now
    UNION ALL
    SELECT m.user_id, m.created_at, 'medication'::text
    FROM public.zane_medication_logs m
    WHERE m.created_at BETWEEN v_30_start AND v_now
    UNION ALL
    SELECT sm.sender_id, sm.created_at, 'friends'::text
    FROM public.zane_social_messages sm
    WHERE sm.created_at BETWEEN v_30_start AND v_now
    UNION ALL
    SELECT wc.author_id, wc.created_at, 'friends'::text
    FROM public.zane_social_workout_comments wc
    WHERE wc.created_at BETWEEN v_30_start AND v_now
    UNION ALL
    SELECT sf.requester_id, sf.updated_at, 'friends'::text
    FROM public.zane_social_friendships sf
    WHERE sf.updated_at BETWEEN v_30_start AND v_now
    UNION ALL
    SELECT sf.addressee_id, sf.updated_at, 'friends'::text
    FROM public.zane_social_friendships sf
    WHERE sf.updated_at BETWEEN v_30_start AND v_now
    UNION ALL
    SELECT gm.user_id, gm.joined_at, 'friends'::text
    FROM public.zane_social_group_members gm
    WHERE gm.joined_at BETWEEN v_30_start AND v_now
    UNION ALL
    SELECT ci.client_id, ci.checked_in_at, 'coaching'::text
    FROM public.zane_checkins ci
    WHERE ci.checked_in_at BETWEEN v_30_start AND v_now
    UNION ALL
    SELECT n.author_id, n.created_at, 'coaching'::text
    FROM public.zane_coaching_notes n
    WHERE n.created_at BETWEEN v_30_start AND v_now
    UNION ALL
    SELECT t.created_by, t.created_at, 'coaching'::text
    FROM public.zane_coaching_threads t
    WHERE t.created_at BETWEEN v_30_start AND v_now
  ),
  window_stats AS (
    SELECT
      COUNT(DISTINCT user_id) FILTER (WHERE event_at >= v_24_start)::bigint AS active_users_24h,
      COUNT(DISTINCT user_id) FILTER (WHERE event_at >= v_7_start)::bigint AS active_users_7d,
      COUNT(DISTINCT user_id)::bigint AS active_users_30d
    FROM activity_events
  ),
  feature_stats AS (
    SELECT
      COUNT(DISTINCT user_id) FILTER (WHERE feature = 'food')::bigint AS food_users_30d,
      COUNT(DISTINCT user_id) FILTER (WHERE feature = 'health')::bigint AS health_users_30d,
      COUNT(DISTINCT user_id) FILTER (WHERE feature = 'cardio')::bigint AS cardio_users_30d,
      COUNT(DISTINCT user_id) FILTER (WHERE feature = 'medication')::bigint AS medication_users_30d,
      COUNT(DISTINCT user_id) FILTER (WHERE feature = 'friends')::bigint AS friends_users_30d,
      COUNT(DISTINCT user_id) FILTER (WHERE feature = 'coaching')::bigint AS coaching_users_30d
    FROM activity_events
  ),
  current_users AS (
    SELECT DISTINCT user_id FROM activity_events WHERE event_at >= v_7_start
  ),
  prior_users AS (
    SELECT DISTINCT user_id FROM activity_events WHERE event_at >= v_14_start AND event_at < v_7_start
  ),
  retention_stats AS (
    SELECT
      (SELECT COUNT(*)::bigint FROM prior_users) AS active_users_prior_7d,
      (SELECT COUNT(*)::bigint FROM current_users) AS active_users_current_7d,
      (SELECT COUNT(*)::bigint FROM prior_users p JOIN current_users c USING (user_id)) AS returning_users_7d
  ),
  activity_days AS (
    SELECT DISTINCT user_id, (event_at AT TIME ZONE 'UTC')::date AS activity_day
    FROM activity_events
  ),
  user_day_counts AS (
    SELECT user_id, COUNT(*)::bigint AS active_days
    FROM activity_days
    GROUP BY user_id
  ),
  day_groups AS (
    SELECT
      user_id,
      activity_day,
      activity_day - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY activity_day))::integer AS streak_group
    FROM activity_days
  ),
  streaks AS (
    SELECT user_id, MIN(activity_day) AS start_day, MAX(activity_day) AS end_day, COUNT(*)::bigint AS streak_days
    FROM day_groups
    GROUP BY user_id, streak_group
  ),
  activity_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE active_days >= 3)::bigint AS users_3_active_days_30d,
      COALESCE(MAX(streak_days) FILTER (WHERE end_day >= v_today - 1), 0)::bigint AS longest_current_streak_days
    FROM user_day_counts
    FULL JOIN streaks ON false
  ),
  workout_stats AS (
    SELECT
      COUNT(*) FILTER (
        WHERE (w.completed_at BETWEEN v_24_start AND v_now)
           OR (w.ended IS NULL AND w.started_at BETWEEN v_24_start AND v_now)
      )::bigint AS workouts_last_24h,
      COUNT(*) FILTER (WHERE w.started_at BETWEEN v_24_start AND v_now)::bigint AS workouts_started_24h,
      COUNT(*) FILTER (WHERE w.completed_at BETWEEN v_24_start AND v_now)::bigint AS workouts_completed_24h,
      ROUND(AVG(LEAST(480::numeric, GREATEST(0::numeric, COALESCE(w.duration_minutes::numeric, EXTRACT(EPOCH FROM (w.ended - w.started_at)) / 60)))) FILTER (
        WHERE w.completed_at BETWEEN v_30_start AND v_now
          AND w.started_at IS NOT NULL
          AND (w.duration_minutes IS NOT NULL OR (w.ended IS NOT NULL AND w.ended > w.started_at))
      ), 1)::numeric AS avg_workout_minutes_30d
    FROM workouts w
  ),
  set_counts AS (
    SELECT
      w.id,
      COUNT(st.id) FILTER (WHERE st.done AND NOT st.skipped)::numeric AS sets_count
    FROM workouts w
    LEFT JOIN public.zane_sets st ON st.session_id = w.id
    WHERE w.completed_at BETWEEN v_30_start AND v_now
    GROUP BY w.id
  ),
  avg_set_stats AS (
    SELECT ROUND(AVG(sets_count), 1)::numeric AS avg_sets_per_workout_30d
    FROM set_counts
  ),
  intervals AS (
    SELECT
      GREATEST(w.started_at, v_24_start) AS start_at,
      LEAST(COALESCE(w.ended, v_now), v_now) AS end_at
    FROM workouts w
    WHERE w.started_at IS NOT NULL
      AND w.started_at <= v_now
      AND (w.ended IS NULL OR w.ended > w.started_at)
      AND (w.ended IS NULL OR w.ended >= v_24_start)
  ),
  interval_events AS (
    SELECT i.start_at AS event_at, 1::bigint AS delta, 1 AS tie_order FROM intervals i WHERE i.end_at > i.start_at
    UNION ALL
    SELECT i.end_at AS event_at, -1::bigint AS delta, 0 AS tie_order FROM intervals i WHERE i.end_at > i.start_at
  ),
  running AS (
    SELECT SUM(delta) OVER (ORDER BY event_at, tie_order ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS concurrent_count
    FROM interval_events
  ),
  concurrency_stats AS (
    SELECT COALESCE(MAX(concurrent_count), 0)::bigint AS max_simultaneous_workouts
    FROM running
  ),
  peak_hour AS (
    SELECT EXTRACT(HOUR FROM event_at AT TIME ZONE 'UTC')::integer AS hour_utc
    FROM activity_events
    GROUP BY EXTRACT(HOUR FROM event_at AT TIME ZONE 'UTC')
    ORDER BY COUNT(*) DESC, hour_utc
    LIMIT 1
  ),
  activation_stats AS (
    SELECT COUNT(*)::bigint AS new_users_first_workout_30d
    FROM auth.users u
    WHERE u.created_at BETWEEN v_30_start AND v_now
      AND EXISTS (
        SELECT 1
        FROM workouts w
        WHERE w.user_id = u.id
          AND w.started_at BETWEEN GREATEST(v_30_start, u.created_at) AND v_now
      )
  )
  SELECT jsonb_build_object(
    'workouts_last_24h', ws.workouts_last_24h,
    'max_simultaneous_workouts', cs.max_simultaneous_workouts,
    'workouts_started_24h', ws.workouts_started_24h,
    'workouts_completed_24h', ws.workouts_completed_24h,
    'avg_workout_minutes_30d', ws.avg_workout_minutes_30d,
    'avg_sets_per_workout_30d', ass.avg_sets_per_workout_30d,
    'peak_usage_hour_utc', (SELECT hour_utc FROM peak_hour),
    'active_users_24h', win.active_users_24h,
    'active_users_7d', win.active_users_7d,
    'active_users_30d', win.active_users_30d,
    'new_users_first_workout_30d', act.new_users_first_workout_30d,
    'users_3_active_days_30d', ast.users_3_active_days_30d,
    'longest_current_streak_days', ast.longest_current_streak_days,
    'active_users_prior_7d', rs.active_users_prior_7d,
    'active_users_current_7d', rs.active_users_current_7d,
    'returning_users_7d', rs.returning_users_7d,
    'food_users_30d', fs.food_users_30d,
    'health_users_30d', fs.health_users_30d,
    'cardio_users_30d', fs.cardio_users_30d,
    'medication_users_30d', fs.medication_users_30d,
    'friends_users_30d', fs.friends_users_30d,
    'coaching_users_30d', fs.coaching_users_30d
  )
  INTO v_result
  FROM workout_stats ws
  CROSS JOIN avg_set_stats ass
  CROSS JOIN concurrency_stats cs
  CROSS JOIN window_stats win
  CROSS JOIN feature_stats fs
  CROSS JOIN retention_stats rs
  CROSS JOIN activity_stats ast
  CROSS JOIN activation_stats act;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_app_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_stats() TO authenticated;
