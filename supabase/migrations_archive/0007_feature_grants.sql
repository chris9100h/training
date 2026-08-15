-- Table storing per-feature access grants for non-admin users.
-- No direct RLS access — all reads/writes go through SECURITY DEFINER functions.
CREATE TABLE IF NOT EXISTS public.feature_grants (
  feature text NOT NULL,
  email   text NOT NULL,
  PRIMARY KEY (feature, email)
);
ALTER TABLE public.feature_grants ENABLE ROW LEVEL SECURITY;

-- Update overview function: also allow emails listed in feature_grants.
CREATE OR REPLACE FUNCTION public.get_active_sessions_overview()
RETURNS TABLE (
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
       SELECT 1 FROM feature_grants
       WHERE feature = 'active_users' AND email = auth.email()
     )
  THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.name::text AS user_name,
    s.day_name::text,
    (SELECT COALESCE(SUM(
      (SELECT COUNT(*) FROM jsonb_array_elements(entry->'sets') AS st
       WHERE (st->>'done')::boolean IS NOT DISTINCT FROM true)
    ), 0) FROM jsonb_array_elements(s.entries) AS entry)::int AS sets_done,
    (SELECT COALESCE(SUM(
      jsonb_array_length(entry->'sets')
    ), 0) FROM jsonb_array_elements(s.entries) AS entry)::int AS sets_total
  FROM user_settings us
  JOIN sessions s ON s.id = us.in_progress_session_id
  JOIN profiles p ON p.id = us.user_id
  WHERE us.in_progress_session_id IS NOT NULL
    AND s.ended IS NULL;
END;
$$;

-- List all emails that have been granted access (admin only).
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
  SELECT fg.email FROM feature_grants fg WHERE fg.feature = 'active_users' ORDER BY fg.email;
END;
$$;

-- Add or remove an access grant (admin only).
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
    INSERT INTO feature_grants (feature, email)
    VALUES ('active_users', lower(trim(p_email)))
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM feature_grants
    WHERE feature = 'active_users' AND email = lower(trim(p_email));
  END IF;
END;
$$;
