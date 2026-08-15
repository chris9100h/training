-- Migration 0285: include group-share import receipts in explicit social
-- deletion. These rows belong to the importing user even when the sender or
-- group remains after the account's personal data is wiped.

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
          AND (a.uploaded_by = v_uid OR m.sender_id = v_uid OR m.recipient_id = v_uid OR g.owner_id = v_uid)
      )
    );

  DELETE FROM public.zane_social_reports
  WHERE reporter_id = v_uid OR (target_user_id = v_uid AND message_id IS NULL AND group_id IS NULL);
  UPDATE public.zane_social_reports SET target_user_id = NULL WHERE target_user_id = v_uid;
  DELETE FROM public.zane_social_message_reads WHERE user_id = v_uid;
  DELETE FROM public.zane_social_plan_share_imports WHERE user_id = v_uid;
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
  DELETE FROM public.zane_social_friendships WHERE requester_id = v_uid OR addressee_id = v_uid;
  DELETE FROM public.zane_social_blocks WHERE blocker_id = v_uid OR blocked_id = v_uid;
  DELETE FROM public.zane_social_workout_comments WHERE author_id = v_uid;
  DELETE FROM public.zane_social_message_attachments WHERE uploaded_by = v_uid;
  DELETE FROM public.zane_social_profiles WHERE user_id = v_uid;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.delete_my_social_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_social_data() TO authenticated;
