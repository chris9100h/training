-- Social weekly adherence is complete through yesterday only.  Steps and
-- workouts keep their normal week-to-date window; only adherence avoids
-- rewarding or penalising an in-progress nutrition day.
DROP FUNCTION IF EXISTS public.social_get_dashboard(date);

CREATE OR REPLACE FUNCTION public.social_get_dashboard(p_week_start date, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_adherence_end date := LEAST(p_week_start + 7, p_today);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_week_start IS NULL OR p_today IS NULL THEN RAISE EXCEPTION 'Week dates required'; END IF;
  RETURN jsonb_build_object(
    'profile', (
      SELECT jsonb_build_object(
        'userId', sp.user_id, 'handle', sp.handle, 'friendCode', sp.friend_code,
        'stepsVisible', sp.steps_visible, 'workoutsVisible', sp.workouts_visible,
        'adherenceVisible', sp.adherence_visible
      ) FROM zane_social_profiles sp WHERE sp.user_id = v_uid
    ),
    'friends', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'friendshipId', f.id, 'userId', other.user_id, 'name', coalesce(p.name, 'Zane athlete'),
        'handle', other.handle, 'friendCode', other.friend_code,
        'steps', CASE WHEN other.steps_visible THEN (
          SELECT CASE WHEN count(*) FILTER (WHERE dl.steps IS NOT NULL) = 0 THEN NULL ELSE coalesce(sum(dl.steps), 0)::int END
          FROM zane_daily_logs dl WHERE dl.user_id = other.user_id AND dl.date::date >= p_week_start AND dl.date::date < p_week_start + 7
        ) END,
        'workouts', CASE WHEN other.workouts_visible THEN (
          SELECT CASE WHEN count(*) = 0 THEN NULL ELSE count(*)::int END
          FROM zane_sessions s WHERE s.user_id = other.user_id AND s.ended IS NOT NULL AND s.date::date >= p_week_start AND s.date::date < p_week_start + 7
        ) END,
        'adherence', CASE WHEN other.adherence_visible THEN (SELECT round(avg(dl.adherence)::numeric, 1) FROM zane_daily_logs dl WHERE dl.user_id = other.user_id AND dl.date::date >= p_week_start AND dl.date::date < v_adherence_end AND dl.adherence IS NOT NULL) END
      ) ORDER BY f.updated_at DESC)
      FROM zane_social_friendships f
      JOIN zane_social_profiles other ON other.user_id = CASE WHEN f.requester_id = v_uid THEN f.addressee_id ELSE f.requester_id END
      LEFT JOIN zane_profiles p ON p.id = other.user_id
      WHERE f.status = 'accepted' AND (f.requester_id = v_uid OR f.addressee_id = v_uid)
    ), '[]'::jsonb),
    'incoming', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'userId', f.requester_id, 'name', coalesce(p.name, 'Zane athlete'), 'handle', sp.handle) ORDER BY f.created_at DESC)
      FROM zane_social_friendships f JOIN zane_social_profiles sp ON sp.user_id = f.requester_id LEFT JOIN zane_profiles p ON p.id = f.requester_id
      WHERE f.addressee_id = v_uid AND f.status = 'pending'
    ), '[]'::jsonb),
    'outgoing', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'userId', f.addressee_id, 'name', coalesce(p.name, 'Zane athlete'), 'handle', sp.handle) ORDER BY f.created_at DESC)
      FROM zane_social_friendships f JOIN zane_social_profiles sp ON sp.user_id = f.addressee_id LEFT JOIN zane_profiles p ON p.id = f.addressee_id
      WHERE f.requester_id = v_uid AND f.status = 'pending'
    ), '[]'::jsonb),
    'groupMembers', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'groupId', gm.group_id, 'userId', gm.user_id, 'role', gm.role, 'joinedAt', gm.joined_at,
        'name', coalesce(p.name, 'Zane athlete'), 'handle', sp.handle,
        'steps', CASE WHEN sp.steps_visible THEN (
          SELECT CASE WHEN count(*) FILTER (WHERE dl.steps IS NOT NULL) = 0 THEN NULL ELSE coalesce(sum(dl.steps), 0)::int END
          FROM zane_daily_logs dl WHERE dl.user_id = gm.user_id AND dl.date::date >= p_week_start AND dl.date::date < p_week_start + 7
        ) END,
        'workouts', CASE WHEN sp.workouts_visible THEN (
          SELECT CASE WHEN count(*) = 0 THEN NULL ELSE count(*)::int END
          FROM zane_sessions s WHERE s.user_id = gm.user_id AND s.ended IS NOT NULL AND s.date::date >= p_week_start AND s.date::date < p_week_start + 7
        ) END,
        'adherence', CASE WHEN sp.adherence_visible THEN (
          SELECT round(avg(dl.adherence)::numeric, 1) FROM zane_daily_logs dl
          WHERE dl.user_id = gm.user_id AND dl.date::date >= p_week_start AND dl.date::date < v_adherence_end AND dl.adherence IS NOT NULL
        ) END
      ) ORDER BY gm.joined_at)
      FROM zane_social_group_members gm
      JOIN zane_social_profiles sp ON sp.user_id = gm.user_id
      LEFT JOIN zane_profiles p ON p.id = gm.user_id
      WHERE EXISTS (SELECT 1 FROM zane_social_group_members viewer WHERE viewer.group_id = gm.group_id AND viewer.user_id = v_uid)
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_get_dashboard(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_dashboard(date, date) TO authenticated;
