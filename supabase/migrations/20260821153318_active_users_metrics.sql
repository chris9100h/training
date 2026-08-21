-- Active-users admin metrics.
-- Both values use server timestamps and are gated exactly like the existing
-- active-users overview. The concurrency peak is limited to the same rolling
-- 24-hour window as the workout count so a very old session cannot make the
-- current usage summary unexpectedly expensive or misleading.

CREATE OR REPLACE FUNCTION public.get_active_users_metrics()
RETURNS TABLE(workouts_last_24h bigint, max_simultaneous_workouts bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_window_start timestamptz := v_now - INTERVAL '24 hours';
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz'
     AND NOT EXISTS (
       SELECT 1
       FROM public.zane_feature_grants
       WHERE feature = 'active_users' AND email = auth.email()
     )
  THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH completed_workouts AS (
    SELECT s.started_at, s.ended
    FROM public.zane_sessions s
    WHERE s.ended IS NOT NULL
      AND s.ended >= v_window_start
      AND s.ended <= v_now
      AND (s.duration_minutes IS NOT NULL OR (s.started_at IS NOT NULL AND s.ended > s.started_at))
  ),
  open_workouts AS (
    SELECT s.started_at, s.ended
    FROM public.zane_sessions s
    WHERE s.ended IS NULL
      AND s.started_at IS NOT NULL
      AND s.started_at >= v_window_start
      AND s.started_at <= v_now
  ),
  counted_workouts AS (
    SELECT started_at, ended FROM completed_workouts
    UNION ALL
    SELECT started_at, ended FROM open_workouts
  ),
  workout_count AS (
    SELECT COUNT(*)::bigint AS workouts_last_24h FROM counted_workouts
  ),
  intervals AS (
    SELECT GREATEST(s.started_at, v_window_start) AS start_at,
           LEAST(COALESCE(s.ended, v_now), v_now) AS end_at
    FROM public.zane_sessions s
    WHERE s.started_at IS NOT NULL
      AND s.started_at <= v_now
      AND (s.ended IS NULL OR s.ended > s.started_at)
      AND (s.ended IS NULL OR s.ended >= v_window_start)
  ),
  events AS (
    -- End events sort before start events at the same timestamp. A workout
    -- ending exactly as another begins therefore is not counted as overlap.
    SELECT i.start_at AS event_at, 1::bigint AS delta, 1 AS tie_order
    FROM intervals i
    WHERE i.end_at > i.start_at
    UNION ALL
    SELECT i.end_at AS event_at, -1::bigint AS delta, 0 AS tie_order
    FROM intervals i
    WHERE i.end_at > i.start_at
  ),
  running AS (
    SELECT SUM(e.delta) OVER (
      ORDER BY e.event_at, e.tie_order
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS concurrent_count
    FROM events e
  )
  SELECT wc.workouts_last_24h,
         COALESCE((SELECT MAX(r.concurrent_count) FROM running r), 0)::bigint
  FROM workout_count wc;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_active_users_metrics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_users_metrics() TO authenticated;
