-- Extend active session RPC functions with historical average duration per day_id.
-- This allows clients to estimate remaining workout time based on past sessions.

DROP FUNCTION IF EXISTS public.get_active_sessions_overview();
CREATE FUNCTION public.get_active_sessions_overview()
RETURNS TABLE (
  user_id              uuid,
  user_name            text,
  day_name             text,
  sets_done            int,
  sets_total           int,
  started_at           timestamptz,
  avg_duration_seconds float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' AND
     NOT EXISTS (
       SELECT 1 FROM zane_feature_grants
       WHERE feature = 'active_users' AND email = auth.email()
     )
  THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    us.user_id,
    p.name::text AS user_name,
    s.day_name::text,
    (SELECT COALESCE(SUM(
      (SELECT COUNT(*) FROM jsonb_array_elements(entry->'sets') AS st
       WHERE (st->>'done')::boolean IS NOT DISTINCT FROM true)
    ), 0) FROM jsonb_array_elements(s.entries) AS entry)::int AS sets_done,
    (SELECT COALESCE(SUM(
      jsonb_array_length(entry->'sets')
    ), 0) FROM jsonb_array_elements(s.entries) AS entry)::int AS sets_total,
    s.started_at,
    (
      SELECT AVG(EXTRACT(EPOCH FROM (s2.ended - s2.started_at)))
      FROM zane_sessions s2
      WHERE s2.user_id = us.user_id
        AND s2.day_id = s.day_id
        AND s2.ended IS NOT NULL
        AND s2.started_at IS NOT NULL
        AND s2.ended > s2.started_at
    )::float AS avg_duration_seconds
  FROM zane_user_settings us
  JOIN zane_sessions s ON s.id = us.in_progress_session_id
  JOIN zane_profiles p ON p.id = us.user_id
  WHERE us.in_progress_session_id IS NOT NULL
    AND s.ended IS NULL;
END;
$$;

DROP FUNCTION IF EXISTS public.get_active_session_detail(uuid);
CREATE FUNCTION public.get_active_session_detail(p_user_id uuid)
RETURNS TABLE (
  user_name            text,
  day_name             text,
  started_at           timestamptz,
  entries              jsonb,
  avg_duration_seconds float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' AND
     NOT EXISTS (
       SELECT 1 FROM zane_feature_grants
       WHERE feature = 'active_users' AND email = auth.email()
     )
  THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.name::text AS user_name,
    s.day_name::text,
    s.started_at,
    s.entries,
    (
      SELECT AVG(EXTRACT(EPOCH FROM (s2.ended - s2.started_at)))
      FROM zane_sessions s2
      WHERE s2.user_id = p_user_id
        AND s2.day_id = s.day_id
        AND s2.ended IS NOT NULL
        AND s2.started_at IS NOT NULL
        AND s2.ended > s2.started_at
    )::float AS avg_duration_seconds
  FROM zane_user_settings us
  JOIN zane_sessions s ON s.id = us.in_progress_session_id
  JOIN zane_profiles p ON p.id = us.user_id
  WHERE us.user_id = p_user_id
    AND us.in_progress_session_id IS NOT NULL
    AND s.ended IS NULL;
END;
$$;
