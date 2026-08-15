-- Optional X handles (migration 0262).
--
-- Handles live on the identity profile, not in user settings, because they
-- describe the account and are intended for future social surfaces. The
-- client canonicalizes them to @name; no X API verification is performed.

ALTER TABLE public.zane_profiles
  ADD COLUMN IF NOT EXISTS x_handle text,
  ADD COLUMN IF NOT EXISTS x_handle_public boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS x_handle_prompt_opted_out boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.zane_profiles.x_handle IS
  'Optional canonical X handle, stored as @name; accepted input is normalized client-side.';
COMMENT ON COLUMN public.zane_profiles.x_handle_public IS
  'Whether future public/social features may display the user X handle; admins can still see it.';
COMMENT ON COLUMN public.zane_profiles.x_handle_prompt_opted_out IS
  'Permanent opt-out from the optional X-handle prompt until the user adds a handle again.';

-- The return type of a TABLE-returning function cannot be changed with
-- CREATE OR REPLACE, so these admin RPCs are recreated with the added profile
-- fields. Their existing admin-only guards remain unchanged.
DROP FUNCTION IF EXISTS public.get_all_users_admin();
CREATE FUNCTION public.get_all_users_admin()
 RETURNS TABLE(
   user_id uuid,
   name text,
   email text,
   x_handle text,
   x_handle_public boolean,
   x_handle_prompt_opted_out boolean,
   sw_version text,
   created_at timestamptz,
   tier text,
   plan_count int,
   last_workout timestamptz
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT p.id, p.name, u.email::text, p.x_handle, p.x_handle_public,
           p.x_handle_prompt_opted_out, us.sw_version, u.created_at, p.tier,
           COALESCE(sc.plan_count, 0)::int AS plan_count, lw.last_workout
    FROM zane_profiles p
    JOIN auth.users u ON u.id = p.id
    LEFT JOIN zane_user_settings us ON us.user_id = p.id
    LEFT JOIN (
      SELECT s.user_id, COUNT(*) AS plan_count FROM zane_schedules s GROUP BY s.user_id
    ) sc ON sc.user_id = p.id
    LEFT JOIN (
      SELECT s.user_id, MAX(s.ended) AS last_workout FROM zane_sessions s WHERE s.ended IS NOT NULL GROUP BY s.user_id
    ) lw ON lw.user_id = p.id
    ORDER BY u.created_at DESC;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_all_users_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_users_admin() TO authenticated;

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
                  'id',    day->>'id',
                  'name',  day->>'name',
                  'items', (
                    SELECT COALESCE(jsonb_agg(
                      jsonb_build_object(
                        'exId',          item->>'exId',
                        'name',          COALESCE(ex.name, item->>'name', '-'),
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
REVOKE EXECUTE ON FUNCTION public.get_user_detail_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_detail_admin(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.get_support_chats();
CREATE FUNCTION public.get_support_chats()
RETURNS TABLE (
  coaching_id       text,
  client_id         uuid,
  client_name       text,
  client_email      text,
  x_handle          text,
  support_status    text,
  support_category  text,
  last_message_at   timestamptz,
  last_message_body text,
  unread_count      bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'office@btc-prime.biz' LIMIT 1;
  IF auth.uid() IS NULL OR auth.uid() <> v_admin_id THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  RETURN QUERY
  SELECT
    c.id,
    c.client_id,
    COALESCE(p.name, u.email)::text,
    u.email::text,
    p.x_handle,
    c.support_status,
    c.support_category,
    (SELECT MAX(n.created_at) FROM zane_coaching_notes n WHERE n.coaching_id = c.id),
    (SELECT n.body          FROM zane_coaching_notes n WHERE n.coaching_id = c.id ORDER BY n.created_at DESC LIMIT 1),
    (SELECT COUNT(*)        FROM zane_coaching_notes n WHERE n.coaching_id = c.id AND n.author_id <> v_admin_id AND n.read_at IS NULL)
  FROM zane_coaching c
  JOIN auth.users u ON u.id = c.client_id
  LEFT JOIN zane_profiles p ON p.id = c.client_id
  WHERE c.id LIKE 'support_%'
    AND NOT COALESCE(c.archived, false)
    AND EXISTS (SELECT 1 FROM zane_coaching_notes n WHERE n.coaching_id = c.id AND n.author_id <> v_admin_id)
  ORDER BY (SELECT MAX(n.created_at) FROM zane_coaching_notes n WHERE n.coaching_id = c.id) DESC NULLS LAST;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_support_chats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_support_chats() TO authenticated;

DROP FUNCTION IF EXISTS public.get_archived_support_chats();
CREATE FUNCTION public.get_archived_support_chats()
 RETURNS TABLE(
   coaching_id text,
   client_id uuid,
   client_name text,
   client_email text,
   x_handle text,
   support_status text,
   support_category text,
   last_message_at timestamptz,
   last_message_body text,
   unread_count bigint
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'office@btc-prime.biz' LIMIT 1;
  IF auth.uid() IS NULL OR auth.uid() <> v_admin_id THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  RETURN QUERY
  SELECT
    c.id,
    c.client_id,
    COALESCE(p.name, u.email)::text,
    u.email::text,
    p.x_handle,
    c.support_status,
    c.support_category,
    (SELECT MAX(n.created_at) FROM zane_coaching_notes n WHERE n.coaching_id = c.id),
    (SELECT n.body          FROM zane_coaching_notes n WHERE n.coaching_id = c.id ORDER BY n.created_at DESC LIMIT 1),
    (SELECT COUNT(*)        FROM zane_coaching_notes n WHERE n.coaching_id = c.id AND n.author_id <> v_admin_id AND n.read_at IS NULL)
  FROM zane_coaching c
  JOIN auth.users u ON u.id = c.client_id
  LEFT JOIN zane_profiles p ON p.id = c.client_id
  WHERE c.id LIKE 'support_%'
    AND COALESCE(c.archived, false)
  ORDER BY (SELECT MAX(n.created_at) FROM zane_coaching_notes n WHERE n.coaching_id = c.id) DESC NULLS LAST;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_archived_support_chats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_archived_support_chats() TO authenticated;
