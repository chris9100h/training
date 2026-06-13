-- Expose the trainee's weight unit ('kg' | 'lbs') in get_active_session_detail
-- so the coach's spectator / comparison views label weights in the CLIENT's unit
-- instead of the coach's. Stored weight numbers are never converted (an lbs user
-- enters lbs directly), so without the client's unit a coach watching an lbs
-- client sees their numbers labelled "kg". Adding a column changes the function
-- signature, so the old definition must be dropped first.

DROP FUNCTION IF EXISTS public.get_active_session_detail(uuid, text);

CREATE OR REPLACE FUNCTION public.get_active_session_detail(p_user_id uuid, p_session_id text DEFAULT NULL::text)
 RETURNS TABLE(user_name text, day_name text, started_at timestamp with time zone, ended timestamp with time zone, entries jsonb, avg_duration_seconds double precision, avg_sets_total double precision, last_session_entries jsonb, last_session_duration_seconds double precision, unit text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' AND
     NOT EXISTS (
       SELECT 1 FROM zane_feature_grants
       WHERE feature = 'active_users' AND email = auth.email()
     ) AND
     NOT zane_is_coach_of(p_user_id)
  THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.name::text AS user_name,
    s.day_name::text,
    s.started_at,
    s.ended,
    zane_entries_json(s.id) AS entries,
    (
      SELECT AVG(
        CASE
          WHEN s2.duration_minutes IS NOT NULL THEN s2.duration_minutes * 60.0
          ELSE EXTRACT(EPOCH FROM (s2.ended - s2.started_at))
        END
      )
      FROM zane_sessions s2
      WHERE s2.user_id = p_user_id
        AND s2.day_id = s.day_id
        AND s2.ended IS NOT NULL
        AND s2.id != s.id
        AND (s2.duration_minutes IS NOT NULL OR (s2.started_at IS NOT NULL AND s2.ended > s2.started_at))
    )::float AS avg_duration_seconds,
    (
      SELECT AVG(sub.cnt)::float FROM (
        SELECT (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s2.id AND st.done) AS cnt
        FROM zane_sessions s2
        WHERE s2.user_id = p_user_id
          AND s2.day_id = s.day_id
          AND s2.ended IS NOT NULL
          AND s2.id != s.id
          AND (s2.duration_minutes IS NOT NULL OR (s2.started_at IS NOT NULL AND s2.ended > s2.started_at))
      ) sub
    )::float AS avg_sets_total,
    zane_entries_json((
      SELECT s2.id
      FROM zane_sessions s2
      WHERE s2.user_id = p_user_id
        AND s2.day_id = s.day_id
        AND s2.ended IS NOT NULL
        AND s2.id != s.id
        AND (s2.duration_minutes IS NOT NULL OR (s2.started_at IS NOT NULL AND s2.ended > s2.started_at))
      ORDER BY s2.ended DESC
      LIMIT 1
    )) AS last_session_entries,
    (
      SELECT COALESCE(
        s2.duration_minutes * 60.0,
        EXTRACT(EPOCH FROM (s2.ended - s2.started_at))
      )
      FROM zane_sessions s2
      WHERE s2.user_id = p_user_id
        AND s2.day_id = s.day_id
        AND s2.ended IS NOT NULL
        AND s2.id != s.id
        AND (s2.duration_minutes IS NOT NULL OR (s2.started_at IS NOT NULL AND s2.ended > s2.started_at))
      ORDER BY s2.ended DESC
      LIMIT 1
    )::float AS last_session_duration_seconds,
    COALESCE(
      (SELECT us.unit FROM zane_user_settings us WHERE us.user_id = p_user_id),
      'kg'
    )::text AS unit
  FROM zane_sessions s
  LEFT JOIN zane_profiles p ON p.id = s.user_id
  WHERE s.user_id = p_user_id
    AND (
      (p_session_id IS NOT NULL AND s.id = p_session_id)
      OR
      (p_session_id IS NULL AND s.ended IS NULL AND s.id = (
        SELECT us.in_progress_session_id
        FROM zane_user_settings us
        WHERE us.user_id = p_user_id
      ))
    );
END;
$function$;
