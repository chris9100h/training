-- Logbook – Supabase Schema (current as of 2026-05-27)
-- Full snapshot including all migrations. Use this to set up a fresh project.

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.zane_profiles (
  id   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.zane_exercises (
  id         text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL DEFAULT '',
  tags       text[] NOT NULL DEFAULT '{}',
  note       text NOT NULL DEFAULT '',
  category   text,
  unilateral boolean NOT NULL DEFAULT false,
  equipment  text
);

CREATE TABLE IF NOT EXISTS public.zane_schedules (
  id      text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name    text NOT NULL DEFAULT '',
  days    jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS public.zane_sessions (
  id               text PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  schedule_id      text,
  day_id           text,
  day_name         text,
  date             timestamptz,
  started_at       timestamptz,
  ended            timestamptz,
  entries          jsonb NOT NULL DEFAULT '[]',
  duration_minutes integer
);

CREATE TABLE IF NOT EXISTS public.zane_user_settings (
  user_id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active_schedule_id     text,
  cycle_index            integer NOT NULL DEFAULT 0,
  cycle_start_date       text,
  last_advanced_date     date,
  week_plan_start_date   date,
  in_progress_session_id text,
  unit                   text NOT NULL DEFAULT 'kg',
  rest_default           integer NOT NULL DEFAULT 120,
  rest_big               integer DEFAULT 180,
  rest_medium            integer DEFAULT 120,
  rest_small             integer DEFAULT 90,
  push_enabled           boolean DEFAULT false,
  pushover_user_key      text,
  cycle_week_view        boolean DEFAULT false,
  accent_color           text DEFAULT 'gold',
  dark_mode              text DEFAULT 'dark',
  tempo_enabled          boolean DEFAULT false,
  tempo_eccentric        numeric DEFAULT 4,
  tempo_concentric       numeric DEFAULT 1,
  smart_progression      boolean DEFAULT false,
  progression_range_top  integer DEFAULT 4,
  equipment_config       jsonb
);

-- Pushover cancellation token — no RLS, never exposed to clients directly.
CREATE TABLE IF NOT EXISTS public.zane_pushover_active (
  id    text PRIMARY KEY DEFAULT 'singleton',
  nonce text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.zane_feature_grants (
  feature text NOT NULL,
  email   text NOT NULL,
  PRIMARY KEY (feature, email)
);

CREATE TABLE IF NOT EXISTS public.zane_skips (
  id         text PRIMARY KEY,
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  date       text NOT NULL,
  day_id     text,
  day_name   text,
  skip_reason text,
  skipped_at  timestamptz DEFAULT now()
);

-- ── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE public.zane_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_exercises     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_schedules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_feature_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_skips         ENABLE ROW LEVEL SECURITY;
-- zane_pushover_active: no RLS by design (service role only)

CREATE POLICY "own profile"        ON public.zane_profiles      FOR ALL USING (auth.uid() = id);
CREATE POLICY "own exercises"      ON public.zane_exercises     FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own schedules"      ON public.zane_schedules     FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own sessions"       ON public.zane_sessions      FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own settings"       ON public.zane_user_settings FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "read feature grants" ON public.zane_feature_grants FOR SELECT USING (true);
CREATE POLICY "own skips"          ON public.zane_skips         FOR ALL USING (auth.uid() = user_id);

-- ── Trigger: create user_settings row on signup ──────────────────────────────

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.zane_user_settings (user_id) VALUES (new.id)
  ON CONFLICT DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_new_user();

-- ── RPCs ─────────────────────────────────────────────────────────────────────

-- Returns true if the calling user has access to the active_users feature.
CREATE OR REPLACE FUNCTION public.check_active_users_access()
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.email() = 'office@btc-prime.biz' THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM zane_feature_grants
    WHERE feature = 'active_users' AND email = auth.email()
  );
END;
$$;

-- Returns the list of emails granted the active_users feature (admin only).
CREATE OR REPLACE FUNCTION public.get_active_users_grants()
RETURNS TABLE(email text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT fg.email FROM zane_feature_grants fg WHERE fg.feature = 'active_users' ORDER BY fg.email;
END;
$$;

-- Grants or revokes the active_users feature for an email (admin only).
CREATE OR REPLACE FUNCTION public.set_active_users_grant(p_email text, p_granted boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_granted THEN
    INSERT INTO zane_feature_grants (feature, email)
    VALUES ('active_users', lower(trim(p_email)))
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM zane_feature_grants
    WHERE feature = 'active_users' AND email = lower(trim(p_email));
  END IF;
END;
$$;

-- Returns active + recently finished sessions for all users (gated by feature grant).
CREATE OR REPLACE FUNCTION public.get_active_sessions_overview()
RETURNS TABLE(
  user_id              uuid,
  session_id           text,
  user_name            text,
  day_name             text,
  sets_done            integer,
  sets_total           integer,
  started_at           timestamptz,
  ended                timestamptz,
  is_finished          boolean,
  avg_duration_seconds double precision,
  avg_sets_total       double precision
)
LANGUAGE plpgsql SECURITY DEFINER
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
      (SELECT COUNT(*) FROM jsonb_array_elements(entry->'sets') AS st
       WHERE (st->>'skipped')::boolean IS NOT TRUE)
    ), 0) FROM jsonb_array_elements(s.entries) AS entry)::int AS sets_total,
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
      SELECT AVG(sub.set_count) FROM (
        SELECT COALESCE(SUM(
          (SELECT COUNT(*) FROM jsonb_array_elements(entry2->'sets') AS st
           WHERE (st->>'done')::boolean IS NOT DISTINCT FROM true)
        ), 0)::float AS set_count
        FROM zane_sessions s2, jsonb_array_elements(s2.entries) AS entry2
        WHERE s2.user_id = us.user_id
          AND s2.day_id = s.day_id
          AND s2.ended IS NOT NULL
          AND (s2.duration_minutes IS NOT NULL OR (s2.started_at IS NOT NULL AND s2.ended > s2.started_at))
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
      (SELECT COUNT(*) FROM jsonb_array_elements(entry->'sets') AS st
       WHERE (st->>'skipped')::boolean IS NOT TRUE)
    ), 0) FROM jsonb_array_elements(fs.entries) AS entry)::int AS sets_total,
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
      SELECT AVG(sub.set_count) FROM (
        SELECT COALESCE(SUM(
          (SELECT COUNT(*) FROM jsonb_array_elements(entry2->'sets') AS st
           WHERE (st->>'done')::boolean IS NOT DISTINCT FROM true)
        ), 0)::float AS set_count
        FROM zane_sessions s2, jsonb_array_elements(s2.entries) AS entry2
        WHERE s2.user_id = fs.user_id
          AND s2.day_id = fs.day_id
          AND s2.ended IS NOT NULL
          AND (s2.duration_minutes IS NOT NULL OR (s2.started_at IS NOT NULL AND s2.ended > s2.started_at))
        GROUP BY s2.id
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
$$;

-- Returns full detail of a single active or past session (gated by feature grant).
CREATE OR REPLACE FUNCTION public.get_active_session_detail(p_user_id uuid, p_session_id text)
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

-- ── Realtime ──────────────────────────────────────────────────────────────────

-- Enable Realtime on zane_sessions for cross-device live sync.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'zane_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE zane_sessions;
  END IF;
END;
$$;
