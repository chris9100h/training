-- Keep coach-side check-in due status on the client's local reporting date.
-- This prevents a boundary-day report from waiting for database UTC midnight.

CREATE OR REPLACE FUNCTION public.get_coach_checkin_status()
RETURNS TABLE(coaching_id text, checked_in_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS coaching_id,
    (
      SELECT ci.checked_in_at
        FROM public.zane_checkins ci
       WHERE ci.coaching_id = c.id
         AND ci.week_start = cfg.client_today
           - ((extract(isodow FROM cfg.client_today)::int - 1
               - cfg.week_start_day + 7) % 7)
       LIMIT 1
    ) AS checked_in_at
    FROM public.zane_coaching c
    LEFT JOIN public.zane_user_settings us ON us.user_id = c.client_id
    CROSS JOIN LATERAL (
      SELECT
        CASE
          WHEN nullif(trim(us.time_zone), '') IS NOT NULL
           AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = trim(us.time_zone))
            THEN (now() AT TIME ZONE trim(us.time_zone))::date
          ELSE ((now() AT TIME ZONE 'UTC') + make_interval(mins => coalesce(us.tz_offset_minutes, 0)))::date
        END AS client_today,
        coalesce(greatest(0, least(6, us.week_start_day)), 0)::integer AS week_start_day
    ) cfg
   WHERE c.coach_id = auth.uid()
     AND c.coach_id <> c.client_id
     AND c.status = 'active'
     AND c.id NOT LIKE 'support_%';
END;
$function$;
