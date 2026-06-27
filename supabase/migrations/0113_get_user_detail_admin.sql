-- Admin drill-down: plans with fully enriched days/items (names + movement type
-- from zane_exercises) for a given user.
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
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'id',               s.id,
            'name',             s.name,
            'archived',         s.archived,
            'is_flex',          s.is_flex,
            'sessions_per_week', s.sessions_per_week,
            'day_count',        jsonb_array_length(s.days),
            'days', (
              SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                  'id',    day->>'id',
                  'name',  day->>'name',
                  'items', (
                    SELECT COALESCE(jsonb_agg(
                      jsonb_build_object(
                        'exId',          item->>'exId',
                        'name',          COALESCE(ex.name, item->>'name', '—'),
                        'sets',          (item->>'sets')::int,
                        'reps',          (item->>'reps')::int,
                        'movement_type', ex.movement_type,
                        'unilateral',    ex.unilateral
                      )
                    ), '[]'::jsonb)
                    FROM jsonb_array_elements(day->'items') AS item
                    LEFT JOIN zane_exercises ex
                           ON ex.id = item->>'exId' AND ex.user_id = p_user_id
                  )
                )
              ), '[]'::jsonb)
              FROM jsonb_array_elements(s.days) AS day
            )
          ) ORDER BY s.archived, s.name
        ), '[]'::jsonb)
        FROM zane_schedules s WHERE s.user_id = p_user_id
      )
    )
  );
END;
$$;
