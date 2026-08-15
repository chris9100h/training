-- Social foundation: friends, groups, messages, privacy and plan snapshots.
-- Friends deliberately do not reuse zane_coaching: coaching is an asymmetric
-- relationship with broad client-data access, while friends are opt-in and
-- metric-specific.

ALTER TABLE public.zane_user_settings
  ADD COLUMN IF NOT EXISTS show_friends_tab boolean NOT NULL DEFAULT false;

CREATE TABLE public.zane_social_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  handle text UNIQUE,
  friend_code text NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  steps_visible boolean NOT NULL DEFAULT false,
  workouts_visible boolean NOT NULL DEFAULT false,
  adherence_visible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zane_social_profiles_handle_check CHECK (handle IS NULL OR handle ~ '^[a-z0-9_]{3,20}$')
);

CREATE TABLE public.zane_social_friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zane_social_friendships_not_self CHECK (requester_id <> addressee_id),
  CONSTRAINT zane_social_friendships_pair UNIQUE (requester_id, addressee_id)
);

CREATE TABLE public.zane_social_blocks (
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT zane_social_blocks_not_self CHECK (blocker_id <> blocked_id)
);

CREATE TABLE public.zane_social_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 60),
  join_code text NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.zane_social_group_members (
  group_id uuid NOT NULL REFERENCES public.zane_social_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE public.zane_social_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id uuid REFERENCES public.zane_social_groups(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zane_social_messages_target_check CHECK ((recipient_id IS NOT NULL) <> (group_id IS NOT NULL)),
  CONSTRAINT zane_social_messages_content_check CHECK (char_length(body) > 0)
);

CREATE TABLE public.zane_social_message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.zane_social_messages(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.zane_social_message_reads (
  message_id uuid NOT NULL REFERENCES public.zane_social_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE public.zane_social_plan_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_name text NOT NULL CHECK (char_length(trim(plan_name)) BETWEEN 1 AND 120),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  imported_at timestamptz,
  CONSTRAINT zane_social_plan_shares_not_self CHECK (sender_id <> recipient_id)
);

CREATE TABLE public.zane_social_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.zane_social_messages(id) ON DELETE SET NULL,
  group_id uuid REFERENCES public.zane_social_groups(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('spam', 'harassment', 'unsafe', 'other')),
  details text NOT NULL DEFAULT '' CHECK (char_length(details) <= 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zane_social_reports_target_check CHECK (target_user_id IS NOT NULL OR message_id IS NOT NULL OR group_id IS NOT NULL)
);

CREATE INDEX zane_social_friendships_addressee_idx ON public.zane_social_friendships(addressee_id, status);
CREATE INDEX zane_social_friendships_requester_idx ON public.zane_social_friendships(requester_id, status);
CREATE INDEX zane_social_group_members_user_idx ON public.zane_social_group_members(user_id, group_id);
CREATE INDEX zane_social_messages_direct_idx ON public.zane_social_messages(recipient_id, created_at DESC);
CREATE INDEX zane_social_messages_group_idx ON public.zane_social_messages(group_id, created_at DESC);
CREATE INDEX zane_social_message_attachments_message_idx ON public.zane_social_message_attachments(message_id);
CREATE INDEX zane_social_reports_status_idx ON public.zane_social_reports(status, created_at DESC);
CREATE UNIQUE INDEX zane_social_friendships_canonical_pair_idx
  ON public.zane_social_friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));

-- Existing accounts receive a stable code immediately. New accounts are
-- created by the auth trigger below, before the client has loaded its store.
INSERT INTO public.zane_social_profiles (user_id)
SELECT p.id FROM public.zane_profiles p
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.zane_user_settings (user_id) VALUES (new.id)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.zane_social_profiles (user_id) VALUES (new.id)
  ON CONFLICT DO NOTHING;
  RETURN new;
END;
$function$;

-- Exact-handle/code lookup returns only the public identity fields needed for
-- an add flow. Privacy flags and health data never leave this function.
CREATE OR REPLACE FUNCTION public.social_lookup_profile(p_query text)
 RETURNS TABLE(user_id uuid, handle text, display_name text, friend_code text, relationship text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_query text := lower(trim(replace(coalesce(p_query, ''), '@', '')));
BEGIN
  IF v_uid IS NULL OR v_query = '' THEN RETURN; END IF;
  RETURN QUERY
  SELECT sp.user_id, sp.handle, coalesce(p.name, 'Zane athlete'), sp.friend_code,
    CASE
      WHEN EXISTS (SELECT 1 FROM zane_social_friendships f WHERE f.status = 'accepted' AND ((f.requester_id = v_uid AND f.addressee_id = sp.user_id) OR (f.requester_id = sp.user_id AND f.addressee_id = v_uid))) THEN 'friends'
      WHEN EXISTS (SELECT 1 FROM zane_social_friendships f WHERE f.status = 'pending' AND f.requester_id = v_uid AND f.addressee_id = sp.user_id) THEN 'outgoing'
      WHEN EXISTS (SELECT 1 FROM zane_social_friendships f WHERE f.status = 'pending' AND f.requester_id = sp.user_id AND f.addressee_id = v_uid) THEN 'incoming'
      ELSE 'none'
    END
  FROM zane_social_profiles sp
  LEFT JOIN zane_profiles p ON p.id = sp.user_id
  WHERE sp.user_id <> v_uid
    AND NOT EXISTS (SELECT 1 FROM zane_social_blocks b WHERE (b.blocker_id = v_uid AND b.blocked_id = sp.user_id) OR (b.blocker_id = sp.user_id AND b.blocked_id = v_uid))
    AND (lower(coalesce(sp.handle, '')) = v_query OR lower(sp.friend_code) = v_query)
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_get_dashboard(p_week_start date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_week_start IS NULL THEN RAISE EXCEPTION 'Week start required'; END IF;
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
        'adherence', CASE WHEN other.adherence_visible THEN (SELECT round(avg(dl.adherence)::numeric, 1) FROM zane_daily_logs dl WHERE dl.user_id = other.user_id AND dl.date::date >= p_week_start AND dl.date::date < p_week_start + 7 AND dl.adherence IS NOT NULL) END
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
          WHERE dl.user_id = gm.user_id AND dl.date::date >= p_week_start AND dl.date::date < p_week_start + 7 AND dl.adherence IS NOT NULL
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

CREATE OR REPLACE FUNCTION public.social_send_friend_request(p_target_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR p_target_id IS NULL OR v_uid = p_target_id THEN RAISE EXCEPTION 'Invalid friend target'; END IF;
  IF NOT EXISTS (SELECT 1 FROM zane_social_profiles WHERE user_id = p_target_id) THEN RAISE EXCEPTION 'User not found'; END IF;
  IF EXISTS (SELECT 1 FROM zane_social_blocks b WHERE (b.blocker_id = v_uid AND b.blocked_id = p_target_id) OR (b.blocker_id = p_target_id AND b.blocked_id = v_uid)) THEN RAISE EXCEPTION 'User unavailable'; END IF;
  IF EXISTS (SELECT 1 FROM zane_social_friendships f WHERE ((f.requester_id = v_uid AND f.addressee_id = p_target_id) OR (f.requester_id = p_target_id AND f.addressee_id = v_uid)) AND f.status IN ('pending', 'accepted')) THEN RAISE EXCEPTION 'Friend request already exists'; END IF;
  INSERT INTO zane_social_friendships (requester_id, addressee_id) VALUES (v_uid, p_target_id) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

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
    UPDATE zane_social_friendships SET status = 'accepted', updated_at = now()
    WHERE id = p_friendship_id AND addressee_id = v_uid AND status = 'pending';
  ELSE
    DELETE FROM zane_social_friendships WHERE id = p_friendship_id AND addressee_id = v_uid AND status = 'pending';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_remove_friend(p_target_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  DELETE FROM zane_social_friendships
  WHERE status = 'accepted' AND ((requester_id = auth.uid() AND addressee_id = p_target_id) OR (requester_id = p_target_id AND addressee_id = auth.uid()));
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_block_user(p_target_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_target_id IS NULL OR auth.uid() = p_target_id THEN RAISE EXCEPTION 'Invalid block target'; END IF;
  INSERT INTO zane_social_blocks (blocker_id, blocked_id) VALUES (auth.uid(), p_target_id) ON CONFLICT DO NOTHING;
  DELETE FROM zane_social_friendships WHERE (requester_id = auth.uid() AND addressee_id = p_target_id) OR (requester_id = p_target_id AND addressee_id = auth.uid());
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_create_group(p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR char_length(trim(coalesce(p_name, ''))) = 0 THEN RAISE EXCEPTION 'Group name required'; END IF;
  INSERT INTO zane_social_groups (owner_id, name) VALUES (auth.uid(), trim(p_name)) RETURNING id INTO v_id;
  INSERT INTO zane_social_group_members (group_id, user_id, role) VALUES (v_id, auth.uid(), 'owner');
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_join_group(p_join_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_group_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT id INTO v_group_id FROM zane_social_groups WHERE upper(join_code) = upper(trim(coalesce(p_join_code, '')));
  IF v_group_id IS NULL THEN RAISE EXCEPTION 'Group not found'; END IF;
  INSERT INTO zane_social_group_members (group_id, user_id) VALUES (v_group_id, auth.uid()) ON CONFLICT DO NOTHING;
  RETURN v_group_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_leave_group(p_group_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM zane_social_groups WHERE id = p_group_id AND owner_id = auth.uid()) THEN RAISE EXCEPTION 'Owner cannot leave group'; END IF;
  DELETE FROM zane_social_group_members WHERE group_id = p_group_id AND user_id = auth.uid();
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_create_plan_share(p_recipient_id uuid, p_plan_name text, p_snapshot jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_recipient_id IS NULL OR auth.uid() = p_recipient_id THEN RAISE EXCEPTION 'Invalid recipient'; END IF;
  IF char_length(trim(coalesce(p_plan_name, ''))) = 0 THEN RAISE EXCEPTION 'Plan name required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM zane_social_friendships f WHERE f.status = 'accepted' AND ((f.requester_id = auth.uid() AND f.addressee_id = p_recipient_id) OR (f.requester_id = p_recipient_id AND f.addressee_id = auth.uid()))) THEN RAISE EXCEPTION 'Friends only'; END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' OR octet_length(p_snapshot::text) > 100000 THEN RAISE EXCEPTION 'Invalid plan snapshot'; END IF;
  INSERT INTO zane_social_plan_shares (sender_id, recipient_id, plan_name, snapshot) VALUES (auth.uid(), p_recipient_id, trim(p_plan_name), p_snapshot) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_update_profile(
  p_handle text,
  p_steps_visible boolean,
  p_workouts_visible boolean,
  p_adherence_visible boolean
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_handle text := nullif(lower(trim(replace(coalesce(p_handle, ''), '@', ''))), '');
  v_uid uuid := auth.uid();
  v_profile zane_social_profiles;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_handle IS NOT NULL AND v_handle !~ '^[a-z0-9_]{3,20}$' THEN
    RAISE EXCEPTION 'Handle must be 3-20 letters, numbers or underscores';
  END IF;
  INSERT INTO zane_social_profiles (user_id, handle, steps_visible, workouts_visible, adherence_visible)
  VALUES (v_uid, v_handle, coalesce(p_steps_visible, false), coalesce(p_workouts_visible, false), coalesce(p_adherence_visible, false))
  ON CONFLICT (user_id) DO UPDATE SET
    handle = excluded.handle,
    steps_visible = excluded.steps_visible,
    workouts_visible = excluded.workouts_visible,
    adherence_visible = excluded.adherence_visible,
    updated_at = now()
  RETURNING * INTO v_profile;
  RETURN jsonb_build_object(
    'userId', v_profile.user_id, 'handle', v_profile.handle, 'friendCode', v_profile.friend_code,
    'stepsVisible', v_profile.steps_visible, 'workoutsVisible', v_profile.workouts_visible,
    'adherenceVisible', v_profile.adherence_visible
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_mark_plan_imported(p_share_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  UPDATE zane_social_plan_shares
  SET imported_at = coalesce(imported_at, now())
  WHERE id = p_share_id AND recipient_id = auth.uid();
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_report(p_target_user_id uuid, p_message_id uuid, p_group_id uuid, p_reason text, p_details text DEFAULT '')
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_reason NOT IN ('spam', 'harassment', 'unsafe', 'other') THEN RAISE EXCEPTION 'Invalid report'; END IF;
  INSERT INTO zane_social_reports (reporter_id, target_user_id, message_id, group_id, reason, details)
  VALUES (auth.uid(), p_target_user_id, p_message_id, p_group_id, p_reason, left(coalesce(p_details, ''), 2000))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

ALTER TABLE public.zane_social_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_social_friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_social_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_social_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_social_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_social_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_social_message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_social_message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_social_plan_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_social_reports ENABLE ROW LEVEL SECURITY;

-- Profile and relationship changes flow through the guarded RPCs. Direct
-- table access is intentionally not exposed for these identity tables.
CREATE POLICY "social own profile" ON public.zane_social_profiles FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
CREATE POLICY "social relationship participant read" ON public.zane_social_friendships FOR SELECT TO authenticated
USING (requester_id = (select auth.uid()) OR addressee_id = (select auth.uid()));
CREATE POLICY "social own blocks" ON public.zane_social_blocks FOR ALL TO authenticated USING (blocker_id = (select auth.uid())) WITH CHECK (blocker_id = (select auth.uid()));

CREATE OR REPLACE FUNCTION public.social_is_group_member(p_group_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.zane_social_group_members
    WHERE group_id = p_group_id AND user_id = coalesce(p_user_id, auth.uid())
  );
$function$;

CREATE POLICY "social group members read" ON public.zane_social_groups FOR SELECT TO authenticated USING (public.social_is_group_member(id, (select auth.uid())));
CREATE POLICY "social membership read" ON public.zane_social_group_members FOR SELECT TO authenticated USING (public.social_is_group_member(group_id, (select auth.uid())));

CREATE POLICY "social messages read" ON public.zane_social_messages FOR SELECT TO authenticated USING (
  sender_id = (select auth.uid()) OR recipient_id = (select auth.uid()) OR
  public.social_is_group_member(group_id, (select auth.uid()))
);
CREATE POLICY "social messages send" ON public.zane_social_messages FOR INSERT TO authenticated WITH CHECK (
  sender_id = (select auth.uid()) AND (
    (recipient_id IS NOT NULL AND EXISTS (SELECT 1 FROM zane_social_friendships f WHERE f.status = 'accepted' AND ((f.requester_id = (select auth.uid()) AND f.addressee_id = recipient_id) OR (f.requester_id = recipient_id AND f.addressee_id = (select auth.uid()))) AND NOT EXISTS (SELECT 1 FROM zane_social_blocks b WHERE (b.blocker_id = (select auth.uid()) AND b.blocked_id = recipient_id) OR (b.blocker_id = recipient_id AND b.blocked_id = (select auth.uid())))))
     OR (group_id IS NOT NULL AND public.social_is_group_member(group_id, (select auth.uid())))
  )
);

CREATE POLICY "social attachment read" ON public.zane_social_message_attachments FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM zane_social_messages m
  WHERE m.id = message_id AND (m.sender_id = (select auth.uid()) OR m.recipient_id = (select auth.uid()) OR public.social_is_group_member(m.group_id, (select auth.uid())))
));
CREATE POLICY "social attachment own insert" ON public.zane_social_message_attachments FOR INSERT TO authenticated WITH CHECK (uploaded_by = (select auth.uid()) AND EXISTS (SELECT 1 FROM zane_social_messages m WHERE m.id = message_id AND m.sender_id = (select auth.uid())));
CREATE POLICY "social attachment own delete" ON public.zane_social_message_attachments FOR DELETE TO authenticated USING (uploaded_by = (select auth.uid()));

CREATE POLICY "social own message reads" ON public.zane_social_message_reads FOR ALL TO authenticated USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "social plan share read" ON public.zane_social_plan_shares FOR SELECT TO authenticated USING (sender_id = (select auth.uid()) OR recipient_id = (select auth.uid()));
CREATE POLICY "social reports own read" ON public.zane_social_reports FOR SELECT TO authenticated USING (reporter_id = (select auth.uid()));
CREATE POLICY "social reports own insert" ON public.zane_social_reports FOR INSERT TO authenticated WITH CHECK (reporter_id = (select auth.uid()));
CREATE POLICY "social reports admin read" ON public.zane_social_reports FOR SELECT TO authenticated USING ((select auth.email()) = 'office@btc-prime.biz');

-- Explicit Data API grants. The project may have automatic exposure disabled.
GRANT SELECT ON public.zane_social_friendships, public.zane_social_groups, public.zane_social_group_members, public.zane_social_messages, public.zane_social_message_attachments, public.zane_social_message_reads, public.zane_social_plan_shares, public.zane_social_reports TO authenticated;
GRANT INSERT ON public.zane_social_messages, public.zane_social_message_attachments, public.zane_social_message_reads, public.zane_social_reports TO authenticated;
GRANT UPDATE ON public.zane_social_message_reads TO authenticated;
GRANT DELETE ON public.zane_social_message_attachments, public.zane_social_message_reads TO authenticated;

REVOKE ALL ON public.zane_social_profiles, public.zane_social_blocks FROM anon, authenticated;
REVOKE ALL ON public.zane_social_groups, public.zane_social_group_members, public.zane_social_messages, public.zane_social_message_attachments, public.zane_social_message_reads, public.zane_social_plan_shares, public.zane_social_reports FROM anon;

REVOKE EXECUTE ON FUNCTION public.social_lookup_profile(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_lookup_profile(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_get_dashboard(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_get_dashboard(date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_send_friend_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_send_friend_request(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_respond_friend_request(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_respond_friend_request(uuid, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_remove_friend(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_remove_friend(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_block_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_block_user(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_create_group(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_create_group(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_join_group(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_join_group(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_leave_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_leave_group(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_create_plan_share(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_create_plan_share(uuid, text, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_report(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_report(uuid, uuid, uuid, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_update_profile(text, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_update_profile(text, boolean, boolean, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_mark_plan_imported(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_mark_plan_imported(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_is_group_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_is_group_member(uuid, uuid) TO authenticated;

-- Private storage bucket for future social message media. Access is granted
-- only after the attachment row proves that the caller participates in the
-- linked message or group.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('social-chat-attachments', 'social-chat-attachments', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;

CREATE POLICY "social attachment storage insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'social-chat-attachments' AND (storage.foldername(name))[1] = (select auth.uid())::text);
CREATE POLICY "social attachment storage read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'social-chat-attachments' AND EXISTS (
  SELECT 1
  FROM public.zane_social_message_attachments a
  JOIN public.zane_social_messages m ON m.id = a.message_id
  WHERE a.storage_path = name
    AND (m.sender_id = (select auth.uid()) OR m.recipient_id = (select auth.uid()) OR public.social_is_group_member(m.group_id, (select auth.uid())))
));
CREATE POLICY "social attachment storage delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'social-chat-attachments' AND (storage.foldername(name))[1] = (select auth.uid())::text);

ALTER TABLE public.zane_social_profiles REPLICA IDENTITY FULL;
ALTER TABLE public.zane_social_friendships REPLICA IDENTITY FULL;
ALTER TABLE public.zane_social_groups REPLICA IDENTITY FULL;
ALTER TABLE public.zane_social_group_members REPLICA IDENTITY FULL;
ALTER TABLE public.zane_social_messages REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE
  public.zane_social_friendships,
  public.zane_social_groups,
  public.zane_social_group_members,
  public.zane_social_messages,
  public.zane_social_message_attachments,
  public.zane_social_plan_shares;
