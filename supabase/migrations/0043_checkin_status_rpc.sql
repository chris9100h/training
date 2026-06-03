-- Returns whether each active client has submitted their check-in
-- for the current reporting week (last completed Mon–Sun).
-- Week start calculation mirrors checkinWeekStart() in store.js:
--   week_start = current_date - DOW_offset - 6
--   where DOW_offset = EXTRACT(DOW) gives 0=Sun, 1=Mon, ..., 6=Sat
CREATE OR REPLACE FUNCTION public.get_coach_checkin_status()
RETURNS TABLE(coaching_id text, has_checkin boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_start date;
BEGIN
  v_week_start := current_date
    - (EXTRACT(DOW FROM current_date)::int) * interval '1 day'
    - interval '6 days';

  RETURN QUERY
  SELECT
    c.id AS coaching_id,
    EXISTS (
      SELECT 1 FROM zane_checkins ci
      WHERE ci.coaching_id = c.id
        AND ci.week_start = v_week_start
    ) AS has_checkin
  FROM zane_coaching c
  WHERE c.coach_id = auth.uid()
    AND c.status = 'active';
END;
$$;
