-- Hardening for the asynchronous Coaching Drive archive.
-- No Google/network work happens in these triggers; they only keep the outbox
-- and private staging bucket consistent under races and retries.

CREATE OR REPLACE FUNCTION public.claim_coaching_drive_exports(p_limit integer DEFAULT 5, p_worker text DEFAULT '')
RETURNS SETOF public.zane_coaching_drive_exports
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_limit integer := greatest(1, least(coalesce(p_limit, 5), 10));
BEGIN
  IF coalesce(trim(p_worker), '') = '' THEN RAISE EXCEPTION 'worker id required'; END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT e.id
    FROM public.zane_coaching_drive_exports e
    WHERE (
      e.status IN ('pending','failed')
      OR (e.status = 'processing' AND e.locked_at IS NOT NULL AND e.locked_at < now() - interval '10 minutes')
    )
      AND e.next_attempt_at <= now()
      AND (e.locked_at IS NULL OR e.locked_at < now() - interval '10 minutes')
    ORDER BY e.next_attempt_at, e.created_at
    FOR UPDATE SKIP LOCKED LIMIT v_limit
  )
  UPDATE public.zane_coaching_drive_exports e
  SET status = 'processing', locked_at = now(), locked_by = p_worker,
      attempts = e.attempts + 1, updated_at = now()
  FROM picked WHERE e.id = picked.id
  RETURNING e.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finish_coaching_drive_export(
  p_export_id uuid, p_worker text, p_status text, p_spreadsheet_id text DEFAULT NULL,
  p_drive_file_id text DEFAULT NULL, p_client_folder_id text DEFAULT NULL,
  p_photo_count integer DEFAULT NULL, p_error text DEFAULT NULL,
  p_next_attempt_at timestamptz DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_changed_during_lease boolean;
BEGIN
  IF p_status NOT IN ('pending','succeeded','failed','needs_reauth') THEN RAISE EXCEPTION 'invalid export status'; END IF;
  UPDATE public.zane_coaching_drive_exports e
  SET status = CASE WHEN p_status = 'succeeded' AND e.updated_at > e.locked_at THEN 'pending' ELSE p_status END,
      spreadsheet_id = coalesce(p_spreadsheet_id, e.spreadsheet_id),
      drive_file_id = coalesce(p_drive_file_id, e.drive_file_id),
      client_folder_id = coalesce(p_client_folder_id, e.client_folder_id),
      photo_count = coalesce(p_photo_count, e.photo_count),
      last_error = CASE WHEN p_status = 'succeeded' AND e.updated_at > e.locked_at THEN 'changed while export was running; queued once more' ELSE nullif(p_error, '') END,
      next_attempt_at = CASE WHEN p_status = 'succeeded' AND e.updated_at > e.locked_at THEN now() ELSE coalesce(p_next_attempt_at, now()) END,
      locked_at = NULL, locked_by = NULL,
      exported_at = CASE WHEN p_status = 'succeeded' AND e.updated_at <= e.locked_at THEN now() ELSE e.exported_at END,
      updated_at = now()
  WHERE e.id = p_export_id AND e.locked_by = p_worker;
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_coaching_drive_export()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_coach uuid; v_enabled boolean;
BEGIN
  SELECT c.coach_id, dc.archive_enabled INTO v_coach, v_enabled
  FROM public.zane_coaching c
  LEFT JOIN public.zane_coaching_drive_connections dc ON dc.coach_id = c.coach_id
  WHERE c.id = NEW.coaching_id AND c.client_id = NEW.client_id
    AND c.coach_id <> c.client_id AND c.status = 'active' AND c.id NOT LIKE 'support_%';
  IF v_coach IS NULL OR coalesce(v_enabled, false) = false THEN RETURN NEW; END IF;
  INSERT INTO public.zane_coaching_drive_exports AS existing(coach_id, client_id, coaching_id, checkin_id, week_start)
  VALUES (v_coach, NEW.client_id, NEW.coaching_id, NEW.id, NEW.week_start)
  ON CONFLICT (coach_id, checkin_id) DO UPDATE SET
    client_id = excluded.client_id, coaching_id = excluded.coaching_id,
    week_start = excluded.week_start,
    status = CASE WHEN existing.status = 'processing' THEN existing.status ELSE 'pending' END,
    next_attempt_at = CASE WHEN existing.status = 'processing' THEN existing.next_attempt_at ELSE now() END,
    last_error = NULL,
    locked_at = CASE WHEN existing.status = 'processing' THEN existing.locked_at ELSE NULL END,
    locked_by = CASE WHEN existing.status = 'processing' THEN existing.locked_by ELSE NULL END,
    updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_coaching_drive_photo_export()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_coach uuid; v_week date; v_enabled boolean;
BEGIN
  SELECT c.coach_id, ci.week_start, dc.archive_enabled
    INTO v_coach, v_week, v_enabled
  FROM public.zane_checkins ci
  JOIN public.zane_coaching c ON c.id = ci.coaching_id AND c.client_id = ci.client_id
  LEFT JOIN public.zane_coaching_drive_connections dc ON dc.coach_id = c.coach_id
  WHERE ci.id = NEW.checkin_id AND ci.coaching_id = NEW.coaching_id
    AND ci.client_id = NEW.client_id AND c.coach_id <> c.client_id
    AND c.status = 'active' AND c.id NOT LIKE 'support_%';
  IF v_coach IS NULL OR coalesce(v_enabled, false) = false THEN RETURN NEW; END IF;
  INSERT INTO public.zane_coaching_drive_exports AS existing(coach_id, client_id, coaching_id, checkin_id, week_start)
  VALUES (v_coach, NEW.client_id, NEW.coaching_id, NEW.checkin_id, v_week)
  ON CONFLICT (coach_id, checkin_id) DO UPDATE SET
    client_id = excluded.client_id, coaching_id = excluded.coaching_id,
    week_start = excluded.week_start,
    status = CASE WHEN existing.status = 'processing' THEN existing.status ELSE 'pending' END,
    next_attempt_at = CASE WHEN existing.status = 'processing' THEN existing.next_attempt_at ELSE now() END,
    last_error = NULL,
    locked_at = CASE WHEN existing.status = 'processing' THEN existing.locked_at ELSE NULL END,
    locked_by = CASE WHEN existing.status = 'processing' THEN existing.locked_by ELSE NULL END,
    updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.coaching_drive_photo_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_client uuid; v_coaching text; v_count integer; v_parts text[];
BEGIN
  IF NEW.status <> 'staged' OR NEW.drive_file_id IS NOT NULL OR NEW.uploaded_at IS NOT NULL THEN
    RAISE EXCEPTION 'new photos must start in staged state';
  END IF;
  v_parts := string_to_array(NEW.staging_path, '/');
  IF array_length(v_parts, 1) <> 3
     OR v_parts[1] <> NEW.client_id::text
     OR v_parts[2] <> NEW.checkin_id
     OR v_parts[3] !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
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
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'coaching-drive-staging' AND o.name = NEW.staging_path) THEN
    RAISE EXCEPTION 'staging object is missing';
  END IF;
  SELECT count(*) INTO v_count FROM public.zane_coaching_drive_photos
  WHERE checkin_id = NEW.checkin_id AND status <> 'failed';
  IF v_count >= 8 THEN RAISE EXCEPTION 'a check-in can contain at most eight photos'; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_coaching_drive_exports(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_coaching_drive_export(uuid, text, text, text, text, text, integer, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_coaching_drive_export() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_coaching_drive_photo_export() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.coaching_drive_photo_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_coaching_drive_exports(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_coaching_drive_export(uuid, text, text, text, text, text, integer, text, timestamptz) TO service_role;

DROP TRIGGER IF EXISTS zane_coaching_drive_photo_export ON public.zane_coaching_drive_photos;
CREATE TRIGGER zane_coaching_drive_photo_export
  AFTER INSERT ON public.zane_coaching_drive_photos
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_coaching_drive_photo_export();

DROP TRIGGER IF EXISTS coaching_drive_photo_guard ON public.zane_coaching_drive_photos;
CREATE TRIGGER coaching_drive_photo_guard
  BEFORE INSERT ON public.zane_coaching_drive_photos
  FOR EACH ROW EXECUTE FUNCTION public.coaching_drive_photo_guard();

DROP POLICY IF EXISTS coaching_drive_photo_insert ON public.zane_coaching_drive_photos;
CREATE POLICY coaching_drive_photo_insert ON public.zane_coaching_drive_photos
  FOR INSERT TO authenticated WITH CHECK (
    client_id = (select auth.uid()) AND status = 'staged' AND drive_file_id IS NULL AND uploaded_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.zane_coaching c
      JOIN public.zane_checkins ci ON ci.coaching_id = c.id AND ci.client_id = c.client_id
      JOIN public.zane_coaching_drive_connections dc ON dc.coach_id = c.coach_id
      WHERE c.id = coaching_id AND ci.id = checkin_id AND ci.client_id = (select auth.uid())
        AND c.status = 'active' AND c.id NOT LIKE 'support_%'
        AND dc.status = 'connected' AND dc.archive_enabled = true AND dc.include_photos = true
    )
  );

DROP POLICY IF EXISTS coaching_drive_stage_insert ON storage.objects;
CREATE POLICY coaching_drive_stage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'coaching-drive-staging'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND array_length(storage.foldername(name), 1) = 3
    AND (storage.foldername(name))[3] ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
    AND position('..' in name) = 0
    AND EXISTS (
      SELECT 1
      FROM public.zane_checkins ci
      JOIN public.zane_coaching c ON c.id = ci.coaching_id AND c.client_id = ci.client_id
      JOIN public.zane_coaching_drive_connections dc ON dc.coach_id = c.coach_id
      WHERE ci.id = (storage.foldername(name))[2]
        AND ci.client_id = (select auth.uid()) AND c.status = 'active' AND c.id NOT LIKE 'support_%'
        AND dc.status = 'connected' AND dc.archive_enabled = true AND dc.include_photos = true
    )
    AND (SELECT count(*) FROM storage.objects old
         WHERE old.bucket_id = 'coaching-drive-staging'
           AND (storage.foldername(old.name))[1] = (select auth.uid())::text
           AND (storage.foldername(old.name))[2] = (storage.foldername(name))[2]) < 8
  );

DROP POLICY IF EXISTS coaching_drive_stage_read ON storage.objects;
CREATE POLICY coaching_drive_stage_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'coaching-drive-staging' AND (storage.foldername(name))[1] = (select auth.uid())::text);
DROP POLICY IF EXISTS coaching_drive_stage_delete ON storage.objects;
CREATE POLICY coaching_drive_stage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'coaching-drive-staging' AND (storage.foldername(name))[1] = (select auth.uid())::text);

CREATE INDEX IF NOT EXISTS idx_coaching_drive_photos_staged_age
  ON public.zane_coaching_drive_photos(status, created_at);
