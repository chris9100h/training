-- Personal Google Drive progress pictures.
--
-- The existing coaching-drive connection is deliberately reused so users do
-- not need a second OAuth consent.  These rows are metadata only; image bytes
-- live briefly in the private staging bucket and permanently in the user's
-- own Google Drive.

ALTER TABLE public.zane_coaching_drive_connections
  ADD COLUMN IF NOT EXISTS progress_folder_id text;

CREATE TABLE IF NOT EXISTS public.zane_drive_progress_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_date date NOT NULL,
  connection_id uuid REFERENCES public.zane_coaching_drive_connections(id) ON DELETE SET NULL,
  staging_path text UNIQUE,
  drive_file_id text,
  file_name text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 8388608),
  status text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','uploading','uploaded','failed','deleting')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  uploaded_at timestamptz,
  UNIQUE (user_id, photo_date)
);

CREATE INDEX IF NOT EXISTS idx_drive_progress_photos_user_date
  ON public.zane_drive_progress_photos(user_id, photo_date DESC);
CREATE INDEX IF NOT EXISTS idx_drive_progress_photos_due
  ON public.zane_drive_progress_photos(status, next_attempt_at, locked_at);

ALTER TABLE public.zane_drive_progress_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS drive_progress_photo_select_own ON public.zane_drive_progress_photos;
CREATE POLICY drive_progress_photo_select_own ON public.zane_drive_progress_photos
  FOR SELECT TO authenticated USING (user_id = (select auth.uid()));

-- Clients reserve and remove rows through the narrowly scoped functions below.
-- They never get direct UPDATE access to drive_file_id/status/lock columns.
REVOKE ALL ON TABLE public.zane_drive_progress_photos FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.zane_drive_progress_photos FROM authenticated;
GRANT SELECT ON TABLE public.zane_drive_progress_photos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.zane_drive_progress_photos TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('drive-progress-staging', 'drive-progress-staging', false, 8388608,
        ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 8388608,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

DROP POLICY IF EXISTS drive_progress_stage_insert ON storage.objects;
CREATE POLICY drive_progress_stage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'drive-progress-staging'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND array_length(storage.foldername(name), 1) = 2
    AND (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
    AND storage.filename(name) ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
    AND position('..' in name) = 0
  );
DROP POLICY IF EXISTS drive_progress_stage_update ON storage.objects;
CREATE POLICY drive_progress_stage_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'drive-progress-staging' AND (storage.foldername(name))[1] = (select auth.uid())::text)
  WITH CHECK (
    bucket_id = 'drive-progress-staging'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND array_length(storage.foldername(name), 1) = 2
    AND (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
    AND storage.filename(name) ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
    AND position('..' in name) = 0
  );
DROP POLICY IF EXISTS drive_progress_stage_read ON storage.objects;
CREATE POLICY drive_progress_stage_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'drive-progress-staging' AND (storage.foldername(name))[1] = (select auth.uid())::text);
DROP POLICY IF EXISTS drive_progress_stage_delete ON storage.objects;
CREATE POLICY drive_progress_stage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'drive-progress-staging' AND (storage.foldername(name))[1] = (select auth.uid())::text);

CREATE OR REPLACE FUNCTION public.reserve_drive_progress_photo(
  p_photo_date date, p_file_name text, p_mime_type text, p_byte_size integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_connection uuid;
  v_id uuid;
  v_name text;
  v_path text;
  v_drive_id text;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_photo_date IS NULL OR p_photo_date < current_date - 3650 OR p_photo_date > current_date + 1 THEN
    RAISE EXCEPTION 'invalid photo date';
  END IF;
  IF p_mime_type NOT IN ('image/jpeg','image/png','image/webp') THEN RAISE EXCEPTION 'unsupported photo type'; END IF;
  IF p_byte_size IS NULL OR p_byte_size <= 0 OR p_byte_size > 8388608 THEN RAISE EXCEPTION 'photo is too large'; END IF;
  SELECT id INTO v_connection
  FROM public.zane_coaching_drive_connections
  WHERE coach_id = v_uid AND status = 'connected'
  LIMIT 1;
  IF v_connection IS NULL THEN RAISE EXCEPTION 'connect Google Drive before uploading a progress picture'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_photo_date::text, 732493));
  SELECT id, drive_file_id, status INTO v_id, v_drive_id, v_status
  FROM public.zane_drive_progress_photos
  WHERE user_id = v_uid AND photo_date = p_photo_date
  FOR UPDATE;
  v_id := coalesce(v_id, gen_random_uuid());
  -- Do not race a worker that is currently uploading or deleting this day.
  -- The UI can safely ask the user to retry after that short background job;
  -- allowing the replacement through here could make the old worker finish
  -- against the new row and either resurrect an old image or orphan a file.
  IF v_status IN ('uploading', 'deleting') THEN
    RAISE EXCEPTION 'progress picture is still processing';
  END IF;
  v_name := left(regexp_replace(coalesce(p_file_name, 'progress-picture.jpg'), '[^A-Za-z0-9._-]+', '_', 'g'), 100);
  IF v_name !~ '^[A-Za-z0-9]' THEN v_name := left('progress-' || v_name, 100); END IF;
  IF v_name = '' THEN v_name := 'progress-picture.jpg'; END IF;
  -- One stable object per row keeps rapid replacements from leaving old
  -- staging objects behind. The Drive filename is set by the worker and does
  -- not depend on this internal object name.
  v_path := v_uid::text || '/' || v_id::text || '/current';
  INSERT INTO public.zane_drive_progress_photos(id, user_id, photo_date, connection_id, staging_path, drive_file_id, file_name, mime_type, byte_size, status, attempts, next_attempt_at, locked_at, locked_by, last_error, updated_at, uploaded_at)
  VALUES (v_id, v_uid, p_photo_date, v_connection, v_path, v_drive_id, v_name, p_mime_type, p_byte_size, 'staged', 0, now(), NULL, NULL, NULL, now(), NULL)
  ON CONFLICT (user_id, photo_date) DO UPDATE SET
    connection_id = excluded.connection_id, staging_path = excluded.staging_path,
    drive_file_id = public.zane_drive_progress_photos.drive_file_id,
    file_name = excluded.file_name, mime_type = excluded.mime_type,
    byte_size = excluded.byte_size, status = 'staged', attempts = 0,
    next_attempt_at = now(), locked_at = NULL, locked_by = NULL,
    last_error = NULL, updated_at = now(), uploaded_at = NULL;
  RETURN jsonb_build_object('id', v_id, 'staging_path', v_path, 'drive_file_id', v_drive_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_drive_progress_photo(p_photo_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.zane_drive_progress_photos
  SET status = CASE WHEN drive_file_id IS NULL THEN 'deleting' ELSE 'uploaded' END,
      next_attempt_at = now(), locked_at = NULL, locked_by = NULL,
      -- Keep the staging path until the janitor has removed it. If this was a
      -- replacement, the old Drive file remains the visible source of truth;
      -- a failed staging attempt must never delete that old picture.
      last_error = CASE WHEN drive_file_id IS NULL THEN 'Progress picture staging failed' ELSE 'Progress picture replacement staging failed' END,
      updated_at = now()
  WHERE id = p_photo_id AND user_id = auth.uid();
  RETURN FOUND;
END;
$function$;

-- Account deletion goes through a SECURITY DEFINER function rather than a
-- broad client DELETE grant.  Storage objects are removed by the client first;
-- this function then removes only the signed-in user's metadata rows.
CREATE OR REPLACE FUNCTION public.delete_owned_drive_progress_photos()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_count integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  DELETE FROM public.zane_drive_progress_photos WHERE user_id = v_uid;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_drive_progress_uploads(p_limit integer DEFAULT 5, p_worker text DEFAULT '')
RETURNS SETOF public.zane_drive_progress_photos
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_limit integer := greatest(1, least(coalesce(p_limit, 5), 10));
BEGIN
  IF coalesce(trim(p_worker), '') = '' THEN RAISE EXCEPTION 'worker id required'; END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT p.id FROM public.zane_drive_progress_photos p
    WHERE p.status IN ('staged','failed') AND p.next_attempt_at <= now()
      AND (p.locked_at IS NULL OR p.locked_at < now() - interval '10 minutes')
    ORDER BY p.next_attempt_at, p.created_at FOR UPDATE SKIP LOCKED LIMIT v_limit
  )
  UPDATE public.zane_drive_progress_photos p
  SET status = 'uploading', locked_at = now(), locked_by = p_worker,
      attempts = p.attempts + 1, updated_at = now()
  FROM picked WHERE p.id = picked.id RETURNING p.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finish_drive_progress_upload(
  p_photo_id uuid, p_worker text, p_status text, p_drive_file_id text DEFAULT NULL,
  p_error text DEFAULT NULL, p_next_attempt_at timestamptz DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF p_status NOT IN ('uploaded','failed') THEN RAISE EXCEPTION 'invalid progress photo status'; END IF;
  UPDATE public.zane_drive_progress_photos
  SET status = p_status, drive_file_id = coalesce(p_drive_file_id, drive_file_id),
      last_error = nullif(p_error, ''), next_attempt_at = coalesce(p_next_attempt_at, now()),
      locked_at = NULL, locked_by = NULL, uploaded_at = CASE WHEN p_status = 'uploaded' THEN now() ELSE uploaded_at END,
      updated_at = now()
  WHERE id = p_photo_id AND locked_by = p_worker;
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_drive_progress_deletions(p_limit integer DEFAULT 5, p_worker text DEFAULT '')
RETURNS SETOF public.zane_drive_progress_photos
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_limit integer := greatest(1, least(coalesce(p_limit, 5), 10));
BEGIN
  IF coalesce(trim(p_worker), '') = '' THEN RAISE EXCEPTION 'worker id required'; END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT p.id FROM public.zane_drive_progress_photos p
    WHERE p.status = 'deleting' AND (p.locked_at IS NULL OR p.locked_at < now() - interval '10 minutes')
    ORDER BY p.updated_at FOR UPDATE SKIP LOCKED LIMIT v_limit
  )
  UPDATE public.zane_drive_progress_photos p
  SET locked_at = now(), locked_by = p_worker, updated_at = now()
  FROM picked WHERE p.id = picked.id RETURNING p.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finish_drive_progress_deletion(p_photo_id uuid, p_worker text, p_success boolean, p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF p_success THEN
    DELETE FROM public.zane_drive_progress_photos WHERE id = p_photo_id AND locked_by = p_worker;
    RETURN FOUND;
  END IF;
  UPDATE public.zane_drive_progress_photos SET status = 'deleting', last_error = nullif(p_error, ''), next_attempt_at = now() + interval '15 minutes', locked_at = NULL, locked_by = NULL, updated_at = now()
  WHERE id = p_photo_id AND locked_by = p_worker;
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_drive_progress_photo(date,text,text,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_drive_progress_photo(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_owned_drive_progress_photos() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_drive_progress_uploads(integer,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_drive_progress_upload(uuid,text,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_drive_progress_deletions(integer,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_drive_progress_deletion(uuid,text,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_drive_progress_photo(date,text,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_drive_progress_photo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_owned_drive_progress_photos() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_drive_progress_uploads(integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_drive_progress_upload(uuid,text,text,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_drive_progress_deletions(integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_drive_progress_deletion(uuid,text,boolean,text) TO service_role;
