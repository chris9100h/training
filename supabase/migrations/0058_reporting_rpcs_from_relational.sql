-- Drop the JSONB dual-write: the reporting RPCs now read from the relational
-- zane_session_entries / zane_sets tables instead of the zane_sessions.entries
-- JSONB snapshot. After this, the client stops writing the JSONB column
-- (see sessionToRow in store.js) and zane_sessions.entries becomes legacy.

-- Build the store-shaped (camelCase) entries array for a session from the
-- relational tables. Returns the same shape the app + spectator consume:
-- [{ exId, name, plannedSets, plannedReps, plannedRepsPerSet, note,
--    supersetGroup, sets: [{ kg, reps, repsL, repsR, done, skipped, warmup }] }]
CREATE OR REPLACE FUNCTION public.zane_entries_json(p_session_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'exId', e.ex_id,
      'name', e.name,
      'plannedSets', e.planned_sets,
      'plannedReps', e.planned_reps,
      'plannedRepsPerSet', e.planned_reps_per_set,
      'note', e.note,
      'supersetGroup', e.superset_group,
      'sets', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'kg', st.kg, 'reps', st.reps, 'repsL', st.reps_l, 'repsR', st.reps_r,
            'done', st.done, 'skipped', st.skipped, 'warmup', st.warmup
          ) ORDER BY st.set_idx)
        FROM zane_sets st WHERE st.entry_id = e.id
      ), '[]'::jsonb)
    ) ORDER BY e.entry_idx
  ), '[]'::jsonb)
  FROM zane_session_entries e
  WHERE e.session_id = p_session_id;
$function$;

-- ── get_active_sessions_overview (relational set counts) ───────────────────────
CREATE OR REPLACE FUNCTION public.get_active_sessions_overview()
 RETURNS TABLE(user_id uuid, session_id text, user_name text, day_name text, sets_done integer, sets_total integer, started_at timestamp with time zone, ended timestamp with time zone, is_finished boolean, avg_duration_seconds double precision, avg_sets_total double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND st.done)::int AS sets_done,
    (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND NOT st.skipped)::int AS sets_total,
    s.started_at,
    NULL::timestamptz AS ended,
    false AS is_finished,
    (
      SELECT AVG(
        CASE
          WHEN s2.duration_minutes IS NOT NULL THEN s2.duration_minutes * 60.0
          ELSE EXTRACT(EPOCH FROM (s2.ended - s2.started_at))
        END
      )
      FROM zane_sessions s2
      WHERE s2.user_id = us.user_id
        AND s2.day_id = s.day_id
        AND s2.ended IS NOT NULL
        AND (s2.duration_minutes IS NOT NULL OR (s2.started_at IS NOT NULL AND s2.ended > s2.started_at))
    )::float AS avg_duration_seconds,
    (
      SELECT AVG(sub.cnt)::float FROM (
        SELECT (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s2.id AND st.done) AS cnt
        FROM zane_sessions s2
        WHERE s2.user_id = us.user_id
          AND s2.day_id = s.day_id
          AND s2.ended IS NOT NULL
          AND (s2.duration_minutes IS NOT NULL OR (s2.started_at IS NOT NULL AND s2.ended > s2.started_at))
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
    (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = fs.id AND st.done)::int AS sets_done,
    (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = fs.id AND NOT st.skipped)::int AS sets_total,
    fs.started_at,
    fs.ended,
    true AS is_finished,
    (
      SELECT AVG(
        CASE
          WHEN s2.duration_minutes IS NOT NULL THEN s2.duration_minutes * 60.0
          ELSE EXTRACT(EPOCH FROM (s2.ended - s2.started_at))
        END
      )
      FROM zane_sessions s2
      WHERE s2.user_id = fs.user_id
        AND s2.day_id = fs.day_id
        AND s2.ended IS NOT NULL
        AND (s2.duration_minutes IS NOT NULL OR (s2.started_at IS NOT NULL AND s2.ended > s2.started_at))
    )::float AS avg_duration_seconds,
    (
      SELECT AVG(sub.cnt)::float FROM (
        SELECT (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s2.id AND st.done) AS cnt
        FROM zane_sessions s2
        WHERE s2.user_id = fs.user_id
          AND s2.day_id = fs.day_id
          AND s2.ended IS NOT NULL
          AND (s2.duration_minutes IS NOT NULL OR (s2.started_at IS NOT NULL AND s2.ended > s2.started_at))
      ) sub
    )::float AS avg_sets_total
  FROM (
    SELECT DISTINCT ON (s.user_id) s.*
    FROM zane_sessions s
    WHERE s.ended IS NOT NULL
      AND s.ended > NOW() - INTERVAL '24 hours'
      AND (s.duration_minutes IS NOT NULL OR (s.started_at IS NOT NULL AND s.ended > s.started_at))
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
$function$;

-- ── get_active_session_detail (relational entries + counts) ────────────────────
CREATE OR REPLACE FUNCTION public.get_active_session_detail(p_user_id uuid, p_session_id text DEFAULT NULL::text)
 RETURNS TABLE(user_name text, day_name text, started_at timestamp with time zone, ended timestamp with time zone, entries jsonb, avg_duration_seconds double precision, avg_sets_total double precision, last_session_entries jsonb, last_session_duration_seconds double precision)
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
$function$;
