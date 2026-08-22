-- Preserve weekday-plan metadata in the admin plan detail payload.
-- The admin viewer already distinguishes weekday plans from cycle plans by
-- checking days[].weekday; the old RPC omitted that field and classified every
-- non-flex plan as a cycle.
CREATE OR REPLACE FUNCTION public.get_user_detail_admin(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RETURN NULL;
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'x_handle', (SELECT p.x_handle FROM zane_profiles p WHERE p.id = p_user_id),
      'x_handle_public', (SELECT p.x_handle_public FROM zane_profiles p WHERE p.id = p_user_id),
      'x_handle_prompt_opted_out', (SELECT p.x_handle_prompt_opted_out FROM zane_profiles p WHERE p.id = p_user_id),
      'active_schedule_id', (
        SELECT us.active_schedule_id FROM zane_user_settings us WHERE us.user_id = p_user_id
      ),
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
                  'id',      day->>'id',
                  'name',    day->>'name',
                  'weekday', day->'weekday',
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
$function$;
