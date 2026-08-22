-- Keep upload and delete intent on one row so neither worker can invalidate
-- the other's lease. A delete requested during an upload is completed only
-- after that upload worker records the final Drive file id.

ALTER TABLE public.zane_drive_progress_photos
  ADD COLUMN IF NOT EXISTS delete_requested_at timestamptz;

DROP POLICY IF EXISTS drive_progress_stage_insert ON storage.objects;
CREATE POLICY drive_progress_stage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'drive-progress-staging'
    AND EXISTS (
      SELECT 1
      FROM public.zane_drive_progress_photos AS photo
      WHERE photo.user_id = (select auth.uid())
        AND photo.staging_path = name
        AND photo.status = 'staged'
    )
  );

DROP POLICY IF EXISTS drive_progress_stage_update ON storage.objects;
CREATE POLICY drive_progress_stage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'drive-progress-staging'
    AND EXISTS (
      SELECT 1
      FROM public.zane_drive_progress_photos AS photo
      WHERE photo.user_id = (select auth.uid())
        AND photo.staging_path = name
        AND photo.status = 'staged'
    )
  )
  WITH CHECK (
    bucket_id = 'drive-progress-staging'
    AND EXISTS (
      SELECT 1
      FROM public.zane_drive_progress_photos AS photo
      WHERE photo.user_id = (select auth.uid())
        AND photo.staging_path = name
        AND photo.status = 'staged'
    )
  );

DROP POLICY IF EXISTS drive_progress_stage_read ON storage.objects;
CREATE POLICY drive_progress_stage_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'drive-progress-staging'
    AND EXISTS (
      SELECT 1
      FROM public.zane_drive_progress_photos AS photo
      WHERE photo.user_id = (select auth.uid())
        AND photo.staging_path = name
    )
  );

DROP POLICY IF EXISTS drive_progress_stage_delete ON storage.objects;
CREATE POLICY drive_progress_stage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'drive-progress-staging'
    AND EXISTS (
      SELECT 1
      FROM public.zane_drive_progress_photos AS photo
      WHERE photo.user_id = (select auth.uid())
        AND photo.staging_path = name
    )
  );

CREATE OR REPLACE FUNCTION public.release_drive_progress_photo(p_photo_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.zane_drive_progress_photos
  SET delete_requested_at = now(),
      status = CASE WHEN status = 'uploading' THEN status ELSE 'deleting' END,
      next_attempt_at = now(),
      locked_at = CASE WHEN status = 'uploading' THEN locked_at ELSE NULL END,
      locked_by = CASE WHEN status = 'uploading' THEN locked_by ELSE NULL END,
      last_error = CASE
        WHEN drive_file_id IS NULL THEN 'Progress picture staging failed'
        ELSE 'Progress picture replacement staging failed'
      END,
      updated_at = now()
  WHERE id = p_photo_id
    AND user_id = auth.uid()
    AND status <> 'deleting';
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_drive_progress_deletion(
  p_photo_id uuid,
  p_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
BEGIN
  IF p_photo_id IS NULL OR p_user_id IS NULL THEN
    RETURN 'not_found';
  END IF;

  SELECT photo.status
  INTO v_status
  FROM public.zane_drive_progress_photos AS photo
  WHERE photo.id = p_photo_id
    AND photo.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF v_status = 'deleting' THEN
    RETURN 'deleting';
  END IF;

  UPDATE public.zane_drive_progress_photos
  SET delete_requested_at = now(),
      status = CASE WHEN v_status = 'uploading' THEN 'uploading' ELSE 'deleting' END,
      next_attempt_at = now(),
      locked_at = CASE WHEN v_status = 'uploading' THEN locked_at ELSE NULL END,
      locked_by = CASE WHEN v_status = 'uploading' THEN locked_by ELSE NULL END,
      last_error = NULL,
      updated_at = now()
  WHERE id = p_photo_id;
  RETURN 'queued';
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_drive_progress_uploads(
  p_limit integer DEFAULT 5,
  p_worker text DEFAULT ''
)
RETURNS SETOF public.zane_drive_progress_photos
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 5), 10));
BEGIN
  IF coalesce(trim(p_worker), '') = '' THEN
    RAISE EXCEPTION 'worker id required';
  END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT photo.id
    FROM public.zane_drive_progress_photos AS photo
    WHERE photo.next_attempt_at <= now()
      AND (
        (
          photo.status IN ('staged', 'failed')
          AND photo.delete_requested_at IS NULL
        )
        OR (
          photo.status = 'uploading'
          AND photo.locked_at < now() - interval '10 minutes'
        )
      )
    ORDER BY photo.next_attempt_at, photo.created_at, photo.id
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.zane_drive_progress_photos AS photo
  SET status = 'uploading',
      locked_at = now(),
      locked_by = p_worker,
      attempts = photo.attempts + 1,
      updated_at = now()
  FROM picked
  WHERE photo.id = picked.id
  RETURNING photo.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finish_drive_progress_upload(
  p_photo_id uuid,
  p_worker text,
  p_status text,
  p_drive_file_id text DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_next_attempt_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_status NOT IN ('uploaded', 'failed') THEN
    RAISE EXCEPTION 'invalid progress photo status';
  END IF;

  UPDATE public.zane_drive_progress_photos
  SET status = CASE WHEN delete_requested_at IS NULL THEN p_status ELSE 'deleting' END,
      drive_file_id = coalesce(p_drive_file_id, drive_file_id),
      last_error = CASE
        WHEN delete_requested_at IS NULL THEN nullif(p_error, '')
        ELSE NULL
      END,
      next_attempt_at = CASE
        WHEN delete_requested_at IS NULL THEN coalesce(p_next_attempt_at, now())
        ELSE now()
      END,
      locked_at = NULL,
      locked_by = NULL,
      uploaded_at = CASE WHEN p_status = 'uploaded' THEN now() ELSE uploaded_at END,
      updated_at = now()
  WHERE id = p_photo_id
    AND status = 'uploading'
    AND locked_by = p_worker;
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_drive_progress_deletions(
  p_limit integer DEFAULT 5,
  p_worker text DEFAULT ''
)
RETURNS SETOF public.zane_drive_progress_photos
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 5), 10));
BEGIN
  IF coalesce(trim(p_worker), '') = '' THEN
    RAISE EXCEPTION 'worker id required';
  END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT photo.id
    FROM public.zane_drive_progress_photos AS photo
    WHERE photo.status = 'deleting'
      AND photo.next_attempt_at <= now()
      AND (photo.locked_at IS NULL OR photo.locked_at < now() - interval '10 minutes')
    ORDER BY photo.next_attempt_at, photo.updated_at, photo.id
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.zane_drive_progress_photos AS photo
  SET locked_at = now(),
      locked_by = p_worker,
      updated_at = now()
  FROM picked
  WHERE photo.id = picked.id
  RETURNING photo.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_coaching_drive_connection(p_coach_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_coach_id IS NULL THEN
    RETURN false;
  END IF;

  -- Lock all mutable worker state in worker order before deleting the outbox
  -- and credentials.
  -- An already-running worker can finish its current provider request, but it
  -- cannot recreate these rows or acknowledge a deleted export afterwards.
  PERFORM 1
  FROM public.zane_coaching_drive_worker_leases
  WHERE coach_id = p_coach_id
  FOR UPDATE;
  PERFORM 1
  FROM public.zane_coaching_drive_exports
  WHERE coach_id = p_coach_id
  ORDER BY id
  FOR UPDATE;
  PERFORM 1
  FROM public.zane_coaching_drive_connections
  WHERE coach_id = p_coach_id
  FOR UPDATE;

  DELETE FROM public.zane_coaching_drive_exports
  WHERE coach_id = p_coach_id;
  DELETE FROM public.zane_coaching_drive_oauth_states
  WHERE coach_id = p_coach_id;
  DELETE FROM public.zane_coaching_drive_worker_leases
  WHERE coach_id = p_coach_id;
  DELETE FROM public.zane_coaching_drive_connections
  WHERE coach_id = p_coach_id;
  RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.release_drive_progress_photo(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_drive_progress_photo(uuid)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.request_drive_progress_deletion(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_drive_progress_deletion(uuid, uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_drive_progress_uploads(integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_drive_progress_uploads(integer, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.finish_drive_progress_upload(uuid, text, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_drive_progress_upload(uuid, text, text, text, text, timestamptz)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_drive_progress_deletions(integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_drive_progress_deletions(integer, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_coaching_drive_connection(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_coaching_drive_connection(uuid)
  TO service_role;
