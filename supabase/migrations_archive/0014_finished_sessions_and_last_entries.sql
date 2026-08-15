-- Extends active sessions RPC to:
-- 1. get_active_sessions_overview: also return recently finished sessions (24h),
--    add session_id / ended / is_finished columns
-- 2. get_active_session_detail: optional p_session_id param (for finished-session view),
--    add ended / last_session_entries / last_session_duration_seconds columns

DROP FUNCTION IF EXISTS public.get_active_sessions_overview();
CREATE FUNCTION public.get_active_sessions_overview()
RETURNS TABLE (
  user_id              uuid,
  session_id           text,
  user_name            text,
  day_name             text,
  sets_done            int,
  sets_total           int,
  started_at           timestamptz,
  ended                timestamptz,
  is_finished          boolean,
  avg_duration_seconds float,
  avg_sets_total       float
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

  -- Active sessions
  SELECT
    us.user_id,
    s.id::text AS session_id,
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
    NULL::timestamptz AS ended,
    false AS is_finished,
    (
      SELECT AVG(EXTRACT(EPOCH FROM (s2.ended - s2.started_at)))
      FROM zane_sessions s2
      WHERE s2.user_id = us.user_id
        AND s2.day_id = s.day_id
        AND s2.ended IS NOT NULL
        AND s2.started_at IS NOT NULL
        AND s2.ended > s2.started_at
    )::float AS avg_duration_seconds,
    (
      SELECT AVG(sub.set_count) FROM (
        SELECT COALESCE(SUM(jsonb_array_length(entry2->'sets')), 0)::float AS set_count
        FROM zane_sessions s2, jsonb_array_elements(s2.entries) AS entry2
        WHERE s2.user_id = us.user_id
          AND s2.day_id = s.day_id
          AND s2.ended IS NOT NULL
          AND s2.started_at IS NOT NULL
          AND s2.ended > s2.started_at
        GROUP BY s2.id
      ) sub
    )::float AS avg_sets_total
  FROM zane_user_settings us
  JOIN zane_sessions s ON s.id = us.in_progress_session_id
  LEFT JOIN zane_profiles p ON p.id = us.user_id
  WHERE us.in_progress_session_id IS NOT NULL
    AND s.ended IS NULL

  UNION ALL

  -- Recently finished sessions (most recent per user, last 24 h, no active session)
  SELECT
    fs.user_id,
    fs.id::text AS session_id,
    p.name::text AS user_name,
    fs.day_name::text,
    (SELECT COALESCE(SUM(
      (SELECT COUNT(*) FROM jsonb_array_elements(entry->'sets') AS st
       WHERE (st->>'done')::boolean IS NOT DISTINCT FROM true)
    ), 0) FROM jsonb_array_elements(fs.entries) AS entry)::int AS sets_done,
    (SELECT COALESCE(SUM(
      jsonb_array_length(entry->'sets')
    ), 0) FROM jsonb_array_elements(fs.entries) AS entry)::int AS sets_total,
    fs.started_at,
    fs.ended,
    true AS is_finished,
    (
      SELECT AVG(EXTRACT(EPOCH FROM (s2.ended - s2.started_at)))
      FROM zane_sessions s2
      WHERE s2.user_id = fs.user_id
        AND s2.day_id = fs.day_id
        AND s2.ended IS NOT NULL
        AND s2.started_at IS NOT NULL
        AND s2.ended > s2.started_at
    )::float AS avg_duration_seconds,
    (
      SELECT AVG(sub.set_count) FROM (
        SELECT COALESCE(SUM(jsonb_array_length(entry2->'sets')), 0)::float AS set_count
        FROM zane_sessions s2, jsonb_array_elements(s2.entries) AS entry2
        WHERE s2.user_id = fs.user_id
          AND s2.day_id = fs.day_id
          AND s2.ended IS NOT NULL
          AND s2.started_at IS NOT NULL
          AND s2.ended > s2.started_at
        GROUP BY s2.id
      ) sub
    )::float AS avg_sets_total
  FROM (
    SELECT DISTINCT ON (s.user_id) s.*
    FROM zane_sessions s
    WHERE s.ended IS NOT NULL
      AND s.ended > NOW() - INTERVAL '24 hours'
      AND s.started_at IS NOT NULL
      AND s.ended > s.started_at
    ORDER BY s.user_id, s.ended DESC
  ) fs
  LEFT JOIN zane_profiles p ON p.id = fs.user_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM zane_user_settings us2
    JOIN zane_sessions s2 ON s2.id = us2.in_progress_session_id
    WHERE us2.user_id = fs.user_id
      AND s2.ended IS NULL
  );
END;
$$;


DROP FUNCTION IF EXISTS public.get_active_session_detail(uuid);
DROP FUNCTION IF EXISTS public.get_active_session_detail(uuid, text);
CREATE FUNCTION public.get_active_session_detail(p_user_id uuid, p_session_id text DEFAULT NULL)
RETURNS TABLE (
  user_name                     text,
  day_name                      text,
  started_at                    timestamptz,
  ended                         timestamptz,
  entries                       jsonb,
  avg_duration_seconds          float,
  avg_sets_total                float,
  last_session_entries          jsonb,
  last_session_duration_seconds float
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
    s.ended,
    s.entries,
    (
      SELECT AVG(EXTRACT(EPOCH FROM (s2.ended - s2.started_at)))
      FROM zane_sessions s2
      WHERE s2.user_id = p_user_id
        AND s2.day_id = s.day_id
        AND s2.ended IS NOT NULL
        AND s2.started_at IS NOT NULL
        AND s2.ended > s2.started_at
        AND s2.id != s.id
    )::float AS avg_duration_seconds,
    (
      SELECT AVG(sub.set_count) FROM (
        SELECT COALESCE(SUM(jsonb_array_length(entry2->'sets')), 0)::float AS set_count
        FROM zane_sessions s2, jsonb_array_elements(s2.entries) AS entry2
        WHERE s2.user_id = p_user_id
          AND s2.day_id = s.day_id
          AND s2.ended IS NOT NULL
          AND s2.started_at IS NOT NULL
          AND s2.ended > s2.started_at
          AND s2.id != s.id
        GROUP BY s2.id
      ) sub
    )::float AS avg_sets_total,
    (
      SELECT s2.entries
      FROM zane_sessions s2
      WHERE s2.user_id = p_user_id
        AND s2.day_id = s.day_id
        AND s2.ended IS NOT NULL
        AND s2.started_at IS NOT NULL
        AND s2.ended > s2.started_at
        AND s2.id != s.id
      ORDER BY s2.ended DESC
      LIMIT 1
    ) AS last_session_entries,
    (
      SELECT EXTRACT(EPOCH FROM (s2.ended - s2.started_at))
      FROM zane_sessions s2
      WHERE s2.user_id = p_user_id
        AND s2.day_id = s.day_id
        AND s2.ended IS NOT NULL
        AND s2.started_at IS NOT NULL
        AND s2.ended > s2.started_at
        AND s2.id != s.id
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
