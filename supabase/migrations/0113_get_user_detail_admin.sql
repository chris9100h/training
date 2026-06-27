-- Admin drill-down: plans (with their days/exercises) for a given user.
CREATE OR REPLACE FUNCTION public.get_user_detail_admin(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RETURN NULL;
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'plans', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', s.id,
          'name', s.name,
          'archived', s.archived,
          'is_flex', s.is_flex,
          'sessions_per_week', s.sessions_per_week,
          'day_count', jsonb_array_length(s.days),
          'days', s.days
        ) ORDER BY s.archived, s.name), '[]'::jsonb)
        FROM zane_schedules s WHERE s.user_id = p_user_id
      )
    )
  );
END;
$$;
