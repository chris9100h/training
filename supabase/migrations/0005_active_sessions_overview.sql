-- RPC function: returns in-progress sessions of other users.
-- Restricted to the admin user only; all other callers get an empty result set.
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
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
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
    AND s.ended IS NULL
    AND us.user_id != auth.uid();
END;
$$;
