-- Allow coaches to call get_active_session_detail for their own clients.
-- Previously only admin / active_users-granted users could call this, so
-- regular coaches always received an empty result ("Not training right now").
CREATE OR REPLACE FUNCTION public.get_active_session_detail(p_user_id uuid, p_session_id text DEFAULT NULL)
RETURNS TABLE(
  user_name                    text,
  day_name                     text,
  started_at                   timestamptz,
  ended                        timestamptz,
  entries                      jsonb,
  avg_duration_seconds         double precision,
  avg_sets_total               double precision,
  last_session_entries         jsonb,
  last_session_duration_seconds double precision
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
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
    s.entries,
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
      SELECT AVG(sub.set_count) FROM (
        SELECT COALESCE(SUM(
          (SELECT COUNT(*) FROM jsonb_array_elements(entry2->'sets') AS st
           WHERE (st->>'done')::boolean IS NOT DISTINCT FROM true)
        ), 0)::float AS set_count
        FROM zane_sessions s2, jsonb_array_elements(s2.entries) AS entry2
        WHERE s2.user_id = p_user_id
          AND s2.day_id = s.day_id
          AND s2.ended IS NOT NULL
          AND s2.id != s.id
          AND (s2.duration_minutes IS NOT NULL OR (s2.started_at IS NOT NULL AND s2.ended > s2.started_at))
        GROUP BY s2.id
      ) sub
    )::float AS avg_sets_total,
    (
      SELECT s2.entries
      FROM zane_sessions s2
      WHERE s2.user_id = p_user_id
        AND s2.day_id = s.day_id
        AND s2.ended IS NOT NULL
        AND s2.id != s.id
        AND (s2.duration_minutes IS NOT NULL OR (s2.started_at IS NOT NULL AND s2.ended > s2.started_at))
      ORDER BY s2.ended DESC
      LIMIT 1
    ) AS last_session_entries,
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
    )::float AS last_session_duration_seconds
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
$$;
