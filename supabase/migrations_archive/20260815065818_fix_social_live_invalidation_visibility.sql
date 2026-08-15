-- Ensure workout-start invalidations use the owner's visibility setting.
-- The recipient is only the broadcast target; their own profile must not
-- control whether the owner's live workout is announced.
CREATE OR REPLACE FUNCTION app_private.broadcast_social_workout_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner_id uuid := NEW.user_id;
  v_user_id uuid;
BEGIN
  IF TG_OP <> 'UPDATE'
     OR NEW.in_progress_session_id IS NOT DISTINCT FROM OLD.in_progress_session_id THEN
    RETURN NEW;
  END IF;

  PERFORM app_private.broadcast_social_user(v_owner_id, 'feed');

  FOR v_user_id IN
    SELECT DISTINCT friend.user_id
    FROM (
      SELECT CASE
        WHEN f.requester_id = v_owner_id THEN f.addressee_id
        ELSE f.requester_id
      END AS user_id
      FROM public.zane_social_friendships f
      WHERE f.status = 'accepted'
        AND f.accepted_at IS NOT NULL
        AND (f.requester_id = v_owner_id OR f.addressee_id = v_owner_id)
    ) friend
    JOIN public.zane_social_profiles sp ON sp.user_id = v_owner_id
    WHERE sp.workouts_visible
      AND NOT EXISTS (
        SELECT 1
        FROM public.zane_social_blocks b
        WHERE (b.blocker_id = v_owner_id AND b.blocked_id = friend.user_id)
           OR (b.blocker_id = friend.user_id AND b.blocked_id = v_owner_id)
      )
  LOOP
    PERFORM app_private.broadcast_social_user(v_user_id, 'feed');
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION app_private.broadcast_social_workout_change() FROM PUBLIC, anon, authenticated, service_role;
