-- Migration 0284: close the remaining Friends social preview audit gaps.
-- Keep metric preference writes separate from handle/profile writes, and make
-- the explicit delete-all flow remove social data without putting it in
-- personal backups.

CREATE OR REPLACE FUNCTION public.social_update_metric_preferences(
  p_metric_visibility jsonb DEFAULT '{}'::jsonb,
  p_metric_slots jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.zane_social_profiles;
  v_input jsonb := CASE
    WHEN jsonb_typeof(coalesce(p_metric_visibility, '{}'::jsonb)) = 'object' THEN p_metric_visibility
    ELSE '{}'::jsonb
  END;
  v_existing jsonb;
  v_visibility jsonb;
  v_slots jsonb;
  v_allowed text[] := ARRAY[
    'steps','workouts','adherence','calories','protein','carbs','fat','fiber',
    'water','cardioMinutes','cardioDistance','weight','bodyFatPct','waistCm',
    'hipsCm','chestCm','armCm','thighCm','calfCm','glucose','bloodPressure','bodyTemp'
  ];
  v_slot_count integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  INSERT INTO public.zane_social_profiles (user_id)
  VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_profile
  FROM public.zane_social_profiles
  WHERE user_id = v_uid;

  v_existing := coalesce(v_profile.metric_visibility, '{}'::jsonb);
  SELECT jsonb_object_agg(item.key, to_jsonb(lower(coalesce(v_input ->> item.key, v_existing ->> item.key, 'false')) = 'true'))
    INTO v_visibility
  FROM unnest(v_allowed) AS item(key);

  v_slots := coalesce(p_metric_slots, v_profile.metric_slots, '["steps","workouts","adherence"]'::jsonb);
  IF jsonb_typeof(v_slots) <> 'array' THEN
    v_slots := '["steps","workouts","adherence"]'::jsonb;
  ELSE
    SELECT count(DISTINCT value) INTO v_slot_count
    FROM jsonb_array_elements_text(v_slots) AS item(value);
    IF jsonb_array_length(v_slots) <> 3 OR v_slot_count <> 3 OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(v_slots) AS item(value)
      WHERE NOT (item.value = ANY(v_allowed))
    ) THEN
      v_slots := '["steps","workouts","adherence"]'::jsonb;
    END IF;
  END IF;

  UPDATE public.zane_social_profiles
  SET steps_visible = (v_visibility->>'steps')::boolean,
      workouts_visible = (v_visibility->>'workouts')::boolean,
      adherence_visible = (v_visibility->>'adherence')::boolean,
      metric_visibility = v_visibility,
      metric_slots = v_slots,
      updated_at = now()
  WHERE user_id = v_uid
  RETURNING * INTO v_profile;

  RETURN jsonb_build_object(
    'userId', v_profile.user_id,
    'handle', v_profile.handle,
    'friendCode', v_profile.friend_code,
    'stepsVisible', v_profile.steps_visible,
    'workoutsVisible', v_profile.workouts_visible,
    'adherenceVisible', v_profile.adherence_visible,
    'metricVisibility', v_profile.metric_visibility,
    'metricSlots', v_profile.metric_slots
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_update_metric_preferences(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_update_metric_preferences(jsonb, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_my_social_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  -- Remove both owned uploads and objects attached to conversations that are
  -- about to disappear. This also cleans up objects left by an interrupted
  -- attachment insert.
  DELETE FROM storage.objects o
  WHERE o.bucket_id = 'social-chat-attachments'
    AND (
      o.name LIKE v_uid::text || '/%'
      OR EXISTS (
        SELECT 1
        FROM public.zane_social_message_attachments a
        LEFT JOIN public.zane_social_messages m ON m.id = a.message_id
        LEFT JOIN public.zane_social_groups g ON g.id = m.group_id
        WHERE a.storage_path = o.name
          AND (
            a.uploaded_by = v_uid
            OR m.sender_id = v_uid
            OR m.recipient_id = v_uid
            OR g.owner_id = v_uid
          )
      )
    );

  -- Keep reports that still refer to a message or group, but remove the
  -- user's identity from them. Reports with no remaining target are deleted
  -- so the target-user foreign key check remains valid.
  DELETE FROM public.zane_social_reports
  WHERE reporter_id = v_uid
     OR (target_user_id = v_uid AND message_id IS NULL AND group_id IS NULL);
  UPDATE public.zane_social_reports
  SET target_user_id = NULL
  WHERE target_user_id = v_uid;

  DELETE FROM public.zane_social_message_reads WHERE user_id = v_uid;
  DELETE FROM public.zane_social_plan_shares
  WHERE sender_id = v_uid
     OR recipient_id = v_uid
     OR group_id IN (SELECT id FROM public.zane_social_groups WHERE owner_id = v_uid);
  DELETE FROM public.zane_social_messages
  WHERE sender_id = v_uid
     OR recipient_id = v_uid
     OR group_id IN (SELECT id FROM public.zane_social_groups WHERE owner_id = v_uid);
  DELETE FROM public.zane_social_groups WHERE owner_id = v_uid;
  DELETE FROM public.zane_social_group_members WHERE user_id = v_uid;
  DELETE FROM public.zane_social_friendships
  WHERE requester_id = v_uid OR addressee_id = v_uid;
  DELETE FROM public.zane_social_blocks
  WHERE blocker_id = v_uid OR blocked_id = v_uid;
  DELETE FROM public.zane_social_workout_comments WHERE author_id = v_uid;
  DELETE FROM public.zane_social_message_attachments WHERE uploaded_by = v_uid;
  DELETE FROM public.zane_social_profiles WHERE user_id = v_uid;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.delete_my_social_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_social_data() TO authenticated;

DROP POLICY IF EXISTS "social attachment own insert" ON public.zane_social_message_attachments;
CREATE POLICY "social attachment own insert" ON public.zane_social_message_attachments
FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = (select auth.uid())
  AND storage_path LIKE ((select auth.uid())::text || '/%')
  AND EXISTS (
    SELECT 1
    FROM public.zane_social_messages m
    WHERE m.id = message_id
      AND m.sender_id = (select auth.uid())
      AND (
        (
          m.recipient_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.zane_social_friendships f
            WHERE f.status = 'accepted'
              AND ((f.requester_id = (select auth.uid()) AND f.addressee_id = m.recipient_id)
                OR (f.requester_id = m.recipient_id AND f.addressee_id = (select auth.uid())))
              AND NOT EXISTS (
                SELECT 1 FROM public.zane_social_blocks b
                WHERE (b.blocker_id = (select auth.uid()) AND b.blocked_id = m.recipient_id)
                   OR (b.blocker_id = m.recipient_id AND b.blocked_id = (select auth.uid()))
              )
          )
        )
        OR (m.group_id IS NOT NULL AND public.social_group_visible(m.group_id, (select auth.uid())))
      )
  )
);

DROP POLICY IF EXISTS "social attachment storage insert" ON storage.objects;
CREATE POLICY "social attachment storage insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'social-chat-attachments'
  AND (storage.foldername(name))[1] = (select auth.uid())::text
  AND EXISTS (
    SELECT 1
    FROM public.zane_social_messages m
    WHERE m.id::text = (storage.foldername(name))[2]
      AND m.sender_id = (select auth.uid())
      AND (
        (
          m.recipient_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.zane_social_friendships f
            WHERE f.status = 'accepted'
              AND ((f.requester_id = (select auth.uid()) AND f.addressee_id = m.recipient_id)
                OR (f.requester_id = m.recipient_id AND f.addressee_id = (select auth.uid())))
              AND NOT EXISTS (
                SELECT 1 FROM public.zane_social_blocks b
                WHERE (b.blocker_id = (select auth.uid()) AND b.blocked_id = m.recipient_id)
                   OR (b.blocker_id = m.recipient_id AND b.blocked_id = (select auth.uid()))
              )
          )
        )
        OR (m.group_id IS NOT NULL AND public.social_group_visible(m.group_id, (select auth.uid())))
      )
  )
);

ALTER TABLE public.zane_social_plan_share_imports REPLICA IDENTITY FULL;
DO $publication$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'zane_social_plan_share_imports'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.zane_social_plan_share_imports;
  END IF;
END;
$publication$;
