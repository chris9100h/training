-- Migration 0265: friends live workout feed, history and encouragement.
--
-- A friendship's acceptance time is the privacy boundary for workout history.
-- The feed/detail RPCs are SECURITY DEFINER and return a deliberately redacted
-- exercise payload (names and set state, never loads/reps) so the client never
-- needs broad cross-user SELECT policies on the workout tables.

ALTER TABLE public.zane_social_friendships
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

-- Existing accepted rows predate the acceptance marker.  In 0264 the only
-- mutation after creation was accepting the request, which also updates
-- updated_at, so this is the closest server-side boundary available for them.
UPDATE public.zane_social_friendships
SET accepted_at = COALESCE(accepted_at, updated_at, created_at)
WHERE status = 'accepted' AND accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS zane_social_friendships_accepted_at_idx
  ON public.zane_social_friendships (accepted_at)
  WHERE status = 'accepted';

CREATE OR REPLACE FUNCTION public.social_respond_friend_request(p_friendship_id uuid, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_accept THEN
    UPDATE zane_social_friendships
    SET status = 'accepted', accepted_at = COALESCE(accepted_at, now()), updated_at = now()
    WHERE id = p_friendship_id AND addressee_id = v_uid AND status = 'pending';
  ELSE
    DELETE FROM zane_social_friendships
    WHERE id = p_friendship_id AND addressee_id = v_uid AND status = 'pending';
  END IF;
END;
$function$;

CREATE TABLE public.zane_social_workout_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL REFERENCES public.zane_sessions(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'cheer')),
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 400),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX zane_social_workout_comments_session_idx
  ON public.zane_social_workout_comments (session_id, created_at);
CREATE INDEX zane_social_workout_comments_author_idx
  ON public.zane_social_workout_comments (author_id, created_at DESC);

-- The helper is intentionally the single access rule used by the feed, detail,
-- comment RPC and Realtime SELECT policy.  A friend sees only workouts made
-- after the friendship was accepted and only while the owner shares workouts.
CREATE OR REPLACE FUNCTION public.social_workout_access(p_owner_id uuid, p_started_at timestamptz)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    auth.uid() = p_owner_id
    OR EXISTS (
      SELECT 1
      FROM zane_social_friendships f
      JOIN zane_social_profiles sp ON sp.user_id = p_owner_id
      WHERE f.status = 'accepted'
        AND f.accepted_at IS NOT NULL
        AND p_started_at IS NOT NULL
        AND f.accepted_at <= p_started_at
        AND sp.workouts_visible
        AND (
          (f.requester_id = auth.uid() AND f.addressee_id = p_owner_id)
          OR (f.requester_id = p_owner_id AND f.addressee_id = auth.uid())
        )
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.social_can_view_workout_session(p_session_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM zane_sessions s
    WHERE s.id = p_session_id
      AND public.social_workout_access(s.user_id, COALESCE(s.started_at, s.date))
  );
$function$;

-- Returns only summary cards.  Detail is loaded separately when a friend taps
-- a card, which keeps the Friends dashboard small even for long histories.
CREATE OR REPLACE FUNCTION public.social_get_workout_feed()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  RETURN jsonb_build_object(
    'live', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY sort_at DESC)
      FROM (
        SELECT jsonb_build_object(
          'sessionId', s.id, 'ownerId', s.user_id,
          'ownerName', COALESCE(p.name, 'Zane athlete'),
          'dayName', s.day_name, 'date', s.date, 'startedAt', s.started_at,
          'ended', s.ended, 'live', true,
          'acceptedAt', f.accepted_at,
          'setsDone', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND st.done)::int,
          'setsTotal', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND NOT st.skipped)::int,
          'exerciseCount', (SELECT COUNT(*) FROM zane_session_entries e WHERE e.session_id = s.id)::int
        ) AS row_data,
        s.started_at AS sort_at
        FROM zane_social_friendships f
        JOIN zane_social_profiles sp ON sp.user_id = CASE WHEN f.requester_id = v_uid THEN f.addressee_id ELSE f.requester_id END
        JOIN zane_user_settings us ON us.user_id = sp.user_id
        JOIN zane_sessions s ON s.id = us.in_progress_session_id AND s.user_id = sp.user_id
        LEFT JOIN zane_profiles p ON p.id = s.user_id
        WHERE f.status = 'accepted'
          AND f.accepted_at IS NOT NULL
          AND (f.requester_id = v_uid OR f.addressee_id = v_uid)
          AND sp.workouts_visible
          AND s.ended IS NULL
          AND COALESCE(s.started_at, s.date) IS NOT NULL
          AND f.accepted_at <= COALESCE(s.started_at, s.date)
      ) live_rows
    ), '[]'::jsonb),
    'history', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY sort_at DESC)
      FROM (
        SELECT jsonb_build_object(
          'sessionId', s.id, 'ownerId', s.user_id,
          'ownerName', COALESCE(p.name, 'Zane athlete'),
          'dayName', s.day_name, 'date', s.date, 'startedAt', s.started_at,
          'ended', s.ended, 'live', false,
          'acceptedAt', f.accepted_at,
          'setsDone', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND st.done)::int,
          'setsTotal', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id AND NOT st.skipped)::int,
          'exerciseCount', (SELECT COUNT(*) FROM zane_session_entries e WHERE e.session_id = s.id)::int
        ) AS row_data,
        COALESCE(s.ended, s.date) AS sort_at
        FROM zane_social_friendships f
        JOIN zane_social_profiles sp ON sp.user_id = CASE WHEN f.requester_id = v_uid THEN f.addressee_id ELSE f.requester_id END
        JOIN zane_sessions s ON s.user_id = sp.user_id
        LEFT JOIN zane_profiles p ON p.id = s.user_id
        WHERE f.status = 'accepted'
          AND f.accepted_at IS NOT NULL
          AND (f.requester_id = v_uid OR f.addressee_id = v_uid)
          AND sp.workouts_visible
          AND s.ended IS NOT NULL
          AND COALESCE(s.started_at, s.date) IS NOT NULL
          AND f.accepted_at <= COALESCE(s.started_at, s.date)
          AND (s.duration_minutes IS NOT NULL OR (s.started_at IS NOT NULL AND s.ended > s.started_at))
        ORDER BY COALESCE(s.ended, s.date) DESC
        LIMIT 100
      ) history_rows
    ), '[]'::jsonb)
  );
END;
$function$;

-- Redacted workout detail: exercise names, planned set counts and completion
-- state are useful for encouragement; kg/reps/horn loads/notes are private.
CREATE OR REPLACE FUNCTION public.social_get_workout_detail(p_owner_id uuid, p_session_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session zane_sessions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_session FROM zane_sessions WHERE id = p_session_id AND user_id = p_owner_id;
  IF NOT FOUND OR NOT public.social_workout_access(v_session.user_id, COALESCE(v_session.started_at, v_session.date)) THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'session', jsonb_build_object(
      'sessionId', v_session.id, 'ownerId', v_session.user_id,
      'ownerName', COALESCE((SELECT p.name FROM zane_profiles p WHERE p.id = v_session.user_id), 'Zane athlete'),
      'dayName', v_session.day_name, 'date', v_session.date,
      'startedAt', v_session.started_at, 'ended', v_session.ended,
      'durationMinutes', v_session.duration_minutes,
      'setsDone', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = v_session.id AND st.done)::int,
      'setsTotal', (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = v_session.id AND NOT st.skipped)::int,
      'exerciseCount', (SELECT COUNT(*) FROM zane_session_entries e WHERE e.session_id = v_session.id)::int
    ),
    'entries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', e.name, 'plannedSets', e.planned_sets, 'plannedReps', e.planned_reps,
        'supersetGroup', e.superset_group,
        'sets', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('done', st.done, 'skipped', st.skipped, 'warmup', st.warmup) ORDER BY st.set_idx)
          FROM zane_sets st WHERE st.entry_id = e.id
        ), '[]'::jsonb)
      ) ORDER BY e.entry_idx)
      FROM zane_session_entries e WHERE e.session_id = v_session.id
    ), '[]'::jsonb),
    'comments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'authorId', c.author_id,
        'authorName', COALESCE(p.name, 'Zane athlete'),
        'kind', c.kind, 'body', c.body, 'createdAt', c.created_at
      ) ORDER BY c.created_at)
      FROM zane_social_workout_comments c
      LEFT JOIN zane_profiles p ON p.id = c.author_id
      WHERE c.session_id = v_session.id
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_add_workout_comment(p_session_id text, p_body text, p_kind text DEFAULT 'comment')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_started_at timestamptz;
  v_comment zane_social_workout_comments%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_kind NOT IN ('comment', 'cheer') THEN RAISE EXCEPTION 'Invalid comment kind'; END IF;
  IF char_length(trim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 400 THEN RAISE EXCEPTION 'Comment must be 1-400 characters'; END IF;
  SELECT s.user_id, COALESCE(s.started_at, s.date) INTO v_owner, v_started_at
  FROM zane_sessions s WHERE s.id = p_session_id;
  IF NOT FOUND OR NOT public.social_workout_access(v_owner, v_started_at) THEN RAISE EXCEPTION 'Workout unavailable'; END IF;

  INSERT INTO zane_social_workout_comments (session_id, author_id, kind, body)
  VALUES (p_session_id, v_uid, p_kind, trim(p_body))
  RETURNING * INTO v_comment;

  RETURN jsonb_build_object(
    'id', v_comment.id, 'authorId', v_comment.author_id,
    'authorName', COALESCE((SELECT p.name FROM zane_profiles p WHERE p.id = v_comment.author_id), 'Zane athlete'),
    'kind', v_comment.kind, 'body', v_comment.body, 'createdAt', v_comment.created_at
  );
END;
$function$;

ALTER TABLE public.zane_social_workout_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "social workout comments read" ON public.zane_social_workout_comments
  FOR SELECT TO authenticated
  USING (public.social_can_view_workout_session(session_id));

GRANT SELECT ON public.zane_social_workout_comments TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.zane_social_workout_comments FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.social_workout_access(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.social_can_view_workout_session(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.social_get_workout_feed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_workout_feed() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_get_workout_detail(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_workout_detail(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_add_workout_comment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_add_workout_comment(text, text, text) TO authenticated;

ALTER TABLE public.zane_social_workout_comments REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.zane_social_workout_comments;
