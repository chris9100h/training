DROP FUNCTION IF EXISTS public.get_coach_checkin_status();

-- get_coach_checkin_status: return checked_in_at timestamp instead of a
-- boolean so the client can detect delete-and-resubmit within the same week.
-- A null means no check-in for the current week; a timestamp means one exists
-- and the client stores that exact value as the "seen" marker in localStorage.
CREATE OR REPLACE FUNCTION public.get_coach_checkin_status()
 RETURNS TABLE(coaching_id text, checked_in_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_week_start date;
BEGIN
  v_week_start := current_date
    - (EXTRACT(DOW FROM current_date)::int) * INTERVAL '1 day'
    - INTERVAL '6 days';

  RETURN QUERY
  SELECT
    c.id AS coaching_id,
    (
      SELECT ci.checked_in_at FROM zane_checkins ci
      WHERE ci.coaching_id = c.id
        AND ci.week_start = v_week_start
      LIMIT 1
    ) AS checked_in_at
  FROM zane_coaching c
  WHERE c.coach_id = auth.uid()
    AND c.coach_id <> c.client_id
    AND c.status = 'active';
END;
$function$;
