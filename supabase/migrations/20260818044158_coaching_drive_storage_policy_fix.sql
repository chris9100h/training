-- Supabase's storage.foldername() returns folders only; it excludes the
-- filename. Re-apply the staging policy with the correct two-folder shape.

CREATE TABLE IF NOT EXISTS public.zane_coaching_drive_photo_reservations (
  staging_path text PRIMARY KEY,
  coaching_id text NOT NULL REFERENCES public.zane_coaching(id) ON DELETE CASCADE,
  checkin_id text NOT NULL REFERENCES public.zane_checkins(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 8388608),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coaching_drive_photo_reservations_expiry
  ON public.zane_coaching_drive_photo_reservations(expires_at);
CREATE INDEX IF NOT EXISTS idx_coaching_drive_photo_reservations_checkin
  ON public.zane_coaching_drive_photo_reservations(checkin_id, expires_at);
ALTER TABLE public.zane_coaching_drive_photo_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zane_coaching_drive_photo_reservations FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.coaching_drive_photo_upload_allowed(
  p_coaching_id text, p_checkin_id text, p_client_id uuid
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND auth.uid() = p_client_id AND EXISTS (
    SELECT 1
    FROM public.zane_checkins ci
    JOIN public.zane_coaching c ON c.id = ci.coaching_id AND c.client_id = ci.client_id
    JOIN public.zane_coaching_drive_connections dc ON dc.coach_id = c.coach_id
    WHERE ci.id = p_checkin_id AND ci.client_id = p_client_id
      AND (p_coaching_id IS NULL OR c.id = p_coaching_id)
      AND c.status = 'active' AND c.id NOT LIKE 'support_%'
      AND dc.status = 'connected' AND dc.archive_enabled = true AND dc.include_photos = true
  );
$function$;
REVOKE ALL ON FUNCTION public.coaching_drive_photo_upload_allowed(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coaching_drive_photo_upload_allowed(text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reserve_coaching_drive_photo(
  p_coaching_id text, p_checkin_id text, p_file_name text, p_mime_type text, p_byte_size integer
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
  v_name text;
  v_path text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_mime_type NOT IN ('image/jpeg','image/png','image/webp') THEN RAISE EXCEPTION 'unsupported photo type'; END IF;
  IF p_byte_size IS NULL OR p_byte_size <= 0 OR p_byte_size > 8388608 THEN RAISE EXCEPTION 'photo is too large'; END IF;
  IF NOT public.coaching_drive_photo_upload_allowed(p_coaching_id, p_checkin_id, v_uid) THEN
    RAISE EXCEPTION 'photo upload is not enabled for this check-in';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_checkin_id, 732491));
  SELECT count(*) INTO v_count
  FROM public.zane_coaching_drive_photos
  WHERE checkin_id = p_checkin_id AND status <> 'failed';
  SELECT v_count + count(*) INTO v_count
  FROM public.zane_coaching_drive_photo_reservations
  WHERE checkin_id = p_checkin_id AND expires_at > now();
  IF v_count >= 8 THEN RAISE EXCEPTION 'a check-in can contain at most eight photos'; END IF;
  v_name := left(regexp_replace(coalesce(p_file_name, 'photo.jpg'), '[^A-Za-z0-9._-]+', '_', 'g'), 80);
  IF v_name !~ '^[A-Za-z0-9]' THEN v_name := left('photo-' || v_name, 80); END IF;
  IF v_name = '' THEN v_name := 'photo.jpg'; END IF;
  v_path := v_uid::text || '/' || p_checkin_id || '/' || gen_random_uuid()::text || '-' || v_name;
  INSERT INTO public.zane_coaching_drive_photo_reservations(staging_path, coaching_id, checkin_id, client_id, file_name, mime_type, byte_size)
  VALUES (v_path, p_coaching_id, p_checkin_id, v_uid, v_name, p_mime_type, p_byte_size);
  RETURN v_path;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_coaching_drive_photo_reservation(p_staging_path text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.zane_coaching_drive_photo_reservations
  SET expires_at = least(expires_at, now())
  WHERE staging_path = p_staging_path AND client_id = auth.uid();
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.coaching_drive_photo_reservation_allowed(p_staging_path text, p_client_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND auth.uid() = p_client_id AND EXISTS (
    SELECT 1 FROM public.zane_coaching_drive_photo_reservations r
    WHERE r.staging_path = p_staging_path AND r.client_id = p_client_id AND r.expires_at > now()
  );
$function$;

REVOKE ALL ON FUNCTION public.reserve_coaching_drive_photo(text, text, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_coaching_drive_photo_reservation(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.coaching_drive_photo_reservation_allowed(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_coaching_drive_photo(text, text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_coaching_drive_photo_reservation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coaching_drive_photo_reservation_allowed(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.coaching_drive_photo_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_client uuid; v_coaching text; v_count integer;
BEGIN
  IF NEW.status <> 'staged' OR NEW.drive_file_id IS NOT NULL OR NEW.uploaded_at IS NOT NULL THEN
    RAISE EXCEPTION 'new photos must start in staged state';
  END IF;
  IF string_to_array(NEW.staging_path, '/') IS NULL
     OR array_length(string_to_array(NEW.staging_path, '/'), 1) <> 3
     OR (string_to_array(NEW.staging_path, '/'))[1] <> NEW.client_id::text
     OR (string_to_array(NEW.staging_path, '/'))[2] <> NEW.checkin_id
     OR (string_to_array(NEW.staging_path, '/'))[3] !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
     OR position('..' in NEW.staging_path) > 0
     OR length(NEW.file_name) > 120
     OR NEW.file_name !~ '^[A-Za-z0-9._ -]{1,120}$'
  THEN RAISE EXCEPTION 'invalid private staging path or file name'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.checkin_id, 732491));
  SELECT client_id, coaching_id INTO v_client, v_coaching
  FROM public.zane_checkins WHERE id = NEW.checkin_id;
  IF v_client IS NULL OR v_coaching IS DISTINCT FROM NEW.coaching_id OR v_client IS DISTINCT FROM NEW.client_id THEN
    RAISE EXCEPTION 'photo is not attached to this check-in';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.zane_coaching_drive_photo_reservations r
    WHERE r.staging_path = NEW.staging_path AND r.coaching_id = NEW.coaching_id
      AND r.checkin_id = NEW.checkin_id AND r.client_id = NEW.client_id
      AND r.file_name = NEW.file_name AND r.mime_type = NEW.mime_type
      AND r.byte_size = NEW.byte_size AND r.expires_at > now()
  ) THEN RAISE EXCEPTION 'photo upload reservation is missing or expired'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'coaching-drive-staging' AND o.name = NEW.staging_path) THEN
    RAISE EXCEPTION 'staging object is missing';
  END IF;
  SELECT count(*) INTO v_count FROM public.zane_coaching_drive_photos
  WHERE checkin_id = NEW.checkin_id AND status <> 'failed';
  IF v_count >= 8 THEN RAISE EXCEPTION 'a check-in can contain at most eight photos'; END IF;
  DELETE FROM public.zane_coaching_drive_photo_reservations WHERE staging_path = NEW.staging_path;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.coaching_drive_photo_guard() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS coaching_drive_photo_insert ON public.zane_coaching_drive_photos;
CREATE POLICY coaching_drive_photo_insert ON public.zane_coaching_drive_photos
  FOR INSERT TO authenticated WITH CHECK (
    client_id = (select auth.uid()) AND status = 'staged' AND drive_file_id IS NULL AND uploaded_at IS NULL
    AND public.coaching_drive_photo_upload_allowed(coaching_id, checkin_id, client_id)
    AND public.coaching_drive_photo_reservation_allowed(staging_path, client_id)
  );

DROP POLICY IF EXISTS coaching_drive_stage_insert ON storage.objects;
CREATE POLICY coaching_drive_stage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'coaching-drive-staging'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND array_length(storage.foldername(name), 1) = 2
    AND storage.filename(name) ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
    AND position('..' in name) = 0
    AND public.coaching_drive_photo_upload_allowed(NULL, (storage.foldername(name))[2], (select auth.uid()))
    AND public.coaching_drive_photo_reservation_allowed(name, (select auth.uid()))
  );

DROP POLICY IF EXISTS coaching_drive_stage_read ON storage.objects;
CREATE POLICY coaching_drive_stage_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'coaching-drive-staging' AND (storage.foldername(name))[1] = (select auth.uid())::text);
DROP POLICY IF EXISTS coaching_drive_stage_delete ON storage.objects;
CREATE POLICY coaching_drive_stage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'coaching-drive-staging' AND (storage.foldername(name))[1] = (select auth.uid())::text);
