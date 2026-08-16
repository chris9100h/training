-- Friend requests must reach the global in-app banner without requiring the
-- recipient to open the Friends tab first. Keep this read deliberately small:
-- it returns only pending requests addressed to the current user, not the
-- complete Friends dashboard.
CREATE OR REPLACE FUNCTION public.social_get_pending_friend_requests()
RETURNS TABLE(id uuid, user_id uuid, name text, handle text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM app_private.require_social_available();

  RETURN QUERY
  SELECT
    f.id,
    f.requester_id,
    COALESCE(p.name, 'Zane athlete'),
    sp.handle
  FROM public.zane_social_friendships f
  JOIN public.zane_social_profiles sp ON sp.user_id = f.requester_id
  LEFT JOIN public.zane_profiles p ON p.id = f.requester_id
  WHERE f.addressee_id = v_uid
    AND f.status = 'pending'
    AND NOT EXISTS (
      SELECT 1
      FROM public.zane_social_blocks b
      WHERE (b.blocker_id = v_uid AND b.blocked_id = f.requester_id)
         OR (b.blocker_id = f.requester_id AND b.blocked_id = v_uid)
    )
  ORDER BY f.created_at DESC
  LIMIT 100;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_get_pending_friend_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_pending_friend_requests() TO authenticated;
