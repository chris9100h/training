-- Add zane_ prefix to all app tables.

ALTER TABLE public.profiles        RENAME TO zane_profiles;
ALTER TABLE public.exercises       RENAME TO zane_exercises;
ALTER TABLE public.schedules       RENAME TO zane_schedules;
ALTER TABLE public.sessions        RENAME TO zane_sessions;
ALTER TABLE public.user_settings   RENAME TO zane_user_settings;
ALTER TABLE public.pushover_active RENAME TO zane_pushover_active;
ALTER TABLE public.feature_grants  RENAME TO zane_feature_grants;

-- Update trigger function to reference the renamed table.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.zane_user_settings (user_id) VALUES (new.id)
  ON CONFLICT DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate all RPC functions that reference renamed tables.
-- get_active_sessions_overview must be dropped first because the return type changed in 0009.
DROP FUNCTION IF EXISTS public.get_active_sessions_overview();
CREATE FUNCTION public.get_active_sessions_overview()
RETURNS TABLE (
  user_id    uuid,
  user_name  text,
  day_name   text,
  sets_done  int,
  sets_total int
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
    ), 0) FROM jsonb_array_elements(s.entries) AS entry)::int AS sets_total
  FROM zane_user_settings us
  JOIN zane_sessions s ON s.id = us.in_progress_session_id
  JOIN zane_profiles p ON p.id = us.user_id
  WHERE us.in_progress_session_id IS NOT NULL
    AND s.ended IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_session_detail(p_user_id uuid)
RETURNS TABLE (
  user_name  text,
  day_name   text,
  started_at timestamptz,
  entries    jsonb
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
    s.entries
  FROM zane_user_settings us
  JOIN zane_sessions s ON s.id = us.in_progress_session_id
  JOIN zane_profiles p ON p.id = us.user_id
  WHERE us.user_id = p_user_id
    AND us.in_progress_session_id IS NOT NULL
    AND s.ended IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_active_users_access()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
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

CREATE OR REPLACE FUNCTION public.get_active_users_grants()
RETURNS TABLE (email text)
LANGUAGE plpgsql
SECURITY DEFINER
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

CREATE OR REPLACE FUNCTION public.set_active_users_grant(p_email text, p_granted boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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
