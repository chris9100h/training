-- Close the photo reservation transaction-ordering bug and make the staging
-- lifecycle safe when check-ins are deleted before the Drive worker runs.

CREATE TABLE IF NOT EXISTS public.zane_coaching_drive_photo_cleanup (
  staging_path text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coaching_drive_photo_cleanup_created
  ON public.zane_coaching_drive_photo_cleanup(created_at);
ALTER TABLE public.zane_coaching_drive_photo_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zane_coaching_drive_photo_cleanup FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_coaching_drive_photo_reservations_client_expiry
  ON public.zane_coaching_drive_photo_reservations(client_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_coaching_drive_photos_client_status_age
  ON public.zane_coaching_drive_photos(client_id, status, created_at);
ALTER TABLE public.zane_coaching_drive_photos
  ADD COLUMN IF NOT EXISTS staging_cleaned_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_coaching_drive_photos_cleanup
  ON public.zane_coaching_drive_photos(status, staging_cleaned_at, created_at);

CREATE TABLE IF NOT EXISTS public.zane_coaching_drive_worker_leases (
  coach_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  worker text NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.zane_coaching_drive_worker_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zane_coaching_drive_worker_leases FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.zane_coaching_drive_maintenance (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  worker text NOT NULL DEFAULT '',
  locked_until timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.zane_coaching_drive_maintenance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zane_coaching_drive_maintenance FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_coaching_drive_exports_coach_week
  ON public.zane_coaching_drive_exports(coach_id, week_start DESC);

-- One worker may touch a coach's Drive at a time. The lease is deliberately
-- shorter than a cron outage window and is recovered automatically if an Edge
-- invocation dies mid-API call.
CREATE OR REPLACE FUNCTION public.claim_coaching_drive_exports(p_limit integer DEFAULT 5, p_worker text DEFAULT '')
RETURNS SETOF public.zane_coaching_drive_exports
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_limit integer := greatest(1, least(coalesce(p_limit, 5), 10));
BEGIN
  IF coalesce(trim(p_worker), '') = '' THEN RAISE EXCEPTION 'worker id required'; END IF;
  INSERT INTO public.zane_coaching_drive_worker_leases(coach_id, worker, locked_at, expires_at, updated_at)
  SELECT c.coach_id, p_worker, now(), now() + interval '12 minutes', now()
  FROM (
    SELECT e.coach_id, min(e.next_attempt_at) AS due_at
    FROM public.zane_coaching_drive_exports e
    JOIN public.zane_coaching c ON c.id = e.coaching_id
      AND c.coach_id = e.coach_id AND c.client_id = e.client_id AND c.status = 'active'
    JOIN public.zane_coaching_drive_connections dc ON dc.coach_id = e.coach_id
      AND dc.status = 'connected' AND dc.archive_enabled = true
    WHERE (
      e.status IN ('pending','failed')
      OR (e.status = 'processing' AND e.locked_at IS NOT NULL AND e.locked_at < now() - interval '10 minutes')
    ) AND e.next_attempt_at <= now()
    GROUP BY e.coach_id
    ORDER BY min(e.next_attempt_at)
    LIMIT 1
  ) c
  ON CONFLICT (coach_id) DO NOTHING;

  RETURN QUERY
  WITH lease_candidates AS (
    SELECT l.coach_id
    FROM public.zane_coaching_drive_worker_leases l
    WHERE (l.worker = p_worker OR l.expires_at <= now())
      AND EXISTS (
      SELECT 1 FROM public.zane_coaching_drive_exports e
        JOIN public.zane_coaching c ON c.id = e.coaching_id
          AND c.coach_id = e.coach_id AND c.client_id = e.client_id AND c.status = 'active'
        JOIN public.zane_coaching_drive_connections dc ON dc.coach_id = e.coach_id
          AND dc.status = 'connected' AND dc.archive_enabled = true
        WHERE e.coach_id = l.coach_id
          AND (
            e.status IN ('pending','failed')
            OR (e.status = 'processing' AND e.locked_at IS NOT NULL AND e.locked_at < now() - interval '10 minutes')
          ) AND e.next_attempt_at <= now()
      )
    ORDER BY l.updated_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ), acquired AS (
    UPDATE public.zane_coaching_drive_worker_leases l
    SET worker = p_worker, locked_at = now(), expires_at = now() + interval '12 minutes', updated_at = now()
    FROM lease_candidates c
    WHERE l.coach_id = c.coach_id
    RETURNING l.coach_id
  ), picked AS (
    SELECT e.id
    FROM public.zane_coaching_drive_exports e
    JOIN acquired a ON a.coach_id = e.coach_id
    JOIN public.zane_coaching c ON c.id = e.coaching_id
      AND c.coach_id = e.coach_id AND c.client_id = e.client_id AND c.status = 'active'
    JOIN public.zane_coaching_drive_connections dc ON dc.coach_id = e.coach_id
      AND dc.status = 'connected' AND dc.archive_enabled = true
    WHERE (
      e.status IN ('pending','failed')
      OR (e.status = 'processing' AND e.locked_at IS NOT NULL AND e.locked_at < now() - interval '10 minutes')
    ) AND e.next_attempt_at <= now()
    ORDER BY e.next_attempt_at, e.created_at
    FOR UPDATE OF e SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.zane_coaching_drive_exports e
  SET status = 'processing', locked_at = now(), locked_by = p_worker,
      attempts = e.attempts + 1, updated_at = now()
  FROM picked WHERE e.id = picked.id
  RETURNING e.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_coaching_drive_worker_lease(p_coach_id uuid, p_worker text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.zane_coaching_drive_worker_leases
  SET expires_at = now(), updated_at = now()
  WHERE coach_id = p_coach_id AND worker = p_worker;
  RETURN FOUND;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_coaching_drive_exports(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_coaching_drive_worker_lease(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_coaching_drive_exports(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_coaching_drive_worker_lease(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_coaching_drive_janitor(p_worker text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(trim(p_worker), '') = '' THEN RETURN false; END IF;
  INSERT INTO public.zane_coaching_drive_maintenance(id, worker, locked_until, updated_at)
  VALUES (true, '', now() - interval '1 minute', now())
  ON CONFLICT (id) DO NOTHING;
  UPDATE public.zane_coaching_drive_maintenance
  SET worker = p_worker, locked_until = now() + interval '45 seconds', updated_at = now()
  WHERE id = true AND locked_until <= now();
  RETURN FOUND;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_coaching_drive_janitor(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_coaching_drive_janitor(text) TO service_role;

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
  IF v_coach IS NULL OR coalesce(v_enabled, false) = false THEN
    UPDATE public.zane_coaching_drive_exports
    SET status = 'failed', next_attempt_at = '9999-12-31T00:00:00Z',
        last_error = 'Coaching relationship or Drive archive is no longer active',
        locked_at = NULL, locked_by = NULL, updated_at = now()
    WHERE checkin_id = NEW.id AND status IN ('pending','processing','failed','needs_reauth');
    RETURN NEW;
  END IF;
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
REVOKE ALL ON FUNCTION public.enqueue_coaching_drive_export() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reserve_coaching_drive_photo(
  p_coaching_id text, p_checkin_id text, p_file_name text, p_mime_type text, p_byte_size integer
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_count bigint;
  v_bytes bigint;
  v_recent_count bigint;
  v_recent_bytes bigint;
  v_checkin_count bigint;
  v_name text;
  v_path text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF coalesce(p_coaching_id, '') !~ '^[A-Za-z0-9_-]{1,120}$'
     OR coalesce(p_checkin_id, '') !~ '^[A-Za-z0-9_-]{1,120}$' THEN
    RAISE EXCEPTION 'invalid check-in reference';
  END IF;
  IF p_mime_type NOT IN ('image/jpeg','image/png','image/webp') THEN RAISE EXCEPTION 'unsupported photo type'; END IF;
  IF p_byte_size IS NULL OR p_byte_size <= 0 OR p_byte_size > 8388608 THEN RAISE EXCEPTION 'photo is too large'; END IF;
  IF NOT public.coaching_drive_photo_upload_allowed(p_coaching_id, p_checkin_id, v_uid) THEN
    RAISE EXCEPTION 'photo upload is not enabled for this check-in';
  END IF;

  -- Serialize all reservations for one user, not only one check-in. This
  -- prevents an attacker from multiplying the per-check-in cap across many
  -- valid check-in rows and bounds simultaneous private storage exposure.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 732492));

  SELECT count(*), coalesce(sum(byte_size), 0)
    INTO v_count, v_bytes
  FROM (
    SELECT byte_size
    FROM public.zane_coaching_drive_photos
    WHERE client_id = v_uid AND status = 'staged'
    UNION ALL
    SELECT byte_size
    FROM public.zane_coaching_drive_photo_reservations
    WHERE client_id = v_uid AND expires_at > now()
  ) active_rows;
  IF v_count >= 16 OR v_bytes + p_byte_size > 134217728 THEN
    RAISE EXCEPTION 'too many photos are already waiting to upload';
  END IF;

  SELECT count(*), coalesce(sum(byte_size), 0)
    INTO v_recent_count, v_recent_bytes
  FROM (
    SELECT byte_size
    FROM public.zane_coaching_drive_photos
    WHERE client_id = v_uid AND status <> 'failed'
      AND created_at > now() - interval '1 hour'
    UNION ALL
    SELECT byte_size
    FROM public.zane_coaching_drive_photo_reservations
    WHERE client_id = v_uid AND created_at > now() - interval '1 hour'
  ) recent_rows;
  IF v_recent_count >= 32 OR v_recent_bytes + p_byte_size > 268435456 THEN
    RAISE EXCEPTION 'photo upload rate limit reached; try again later';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_checkin_id, 732491));
  SELECT count(*) INTO v_checkin_count
  FROM public.zane_coaching_drive_photos
  WHERE checkin_id = p_checkin_id AND status <> 'failed';
  SELECT v_checkin_count + count(*) INTO v_checkin_count
  FROM public.zane_coaching_drive_photo_reservations
  WHERE checkin_id = p_checkin_id AND expires_at > now();
  IF v_checkin_count >= 8 THEN RAISE EXCEPTION 'a check-in can contain at most eight photos'; END IF;

  v_name := left(regexp_replace(coalesce(p_file_name, 'photo.jpg'), '[^A-Za-z0-9._-]+', '_', 'g'), 80);
  IF v_name !~ '^[A-Za-z0-9]' THEN v_name := left('photo-' || v_name, 80); END IF;
  IF v_name = '' THEN v_name := 'photo.jpg'; END IF;
  v_path := v_uid::text || '/' || p_checkin_id || '/' || gen_random_uuid()::text || '-' || v_name;
  INSERT INTO public.zane_coaching_drive_photo_reservations(staging_path, coaching_id, checkin_id, client_id, file_name, mime_type, byte_size)
  VALUES (v_path, p_coaching_id, p_checkin_id, v_uid, v_name, p_mime_type, p_byte_size);
  RETURN v_path;
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
  -- Reservation consumption happens in an AFTER trigger. RLS WITH CHECK is
  -- evaluated after BEFORE triggers, so deleting here would make the policy
  -- reject the otherwise valid metadata insert.
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.coaching_drive_photo_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.coaching_drive_photo_consume_reservation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.zane_coaching_drive_photo_reservations
  WHERE staging_path = NEW.staging_path;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.coaching_drive_photo_consume_reservation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS coaching_drive_photo_guard ON public.zane_coaching_drive_photos;
CREATE TRIGGER coaching_drive_photo_guard
  BEFORE INSERT ON public.zane_coaching_drive_photos
  FOR EACH ROW EXECUTE FUNCTION public.coaching_drive_photo_guard();
DROP TRIGGER IF EXISTS coaching_drive_photo_consume_reservation ON public.zane_coaching_drive_photos;
CREATE TRIGGER coaching_drive_photo_consume_reservation
  AFTER INSERT ON public.zane_coaching_drive_photos
  FOR EACH ROW EXECUTE FUNCTION public.coaching_drive_photo_consume_reservation();

CREATE OR REPLACE FUNCTION public.capture_coaching_drive_photo_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.zane_coaching_drive_photo_cleanup(staging_path)
  SELECT staging_path FROM public.zane_coaching_drive_photos WHERE checkin_id = OLD.id
  ON CONFLICT (staging_path) DO NOTHING;
  INSERT INTO public.zane_coaching_drive_photo_cleanup(staging_path)
  SELECT staging_path FROM public.zane_coaching_drive_photo_reservations WHERE checkin_id = OLD.id
  ON CONFLICT (staging_path) DO NOTHING;
  RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION public.capture_coaching_drive_photo_cleanup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zane_checkins_drive_photo_cleanup ON public.zane_checkins;
CREATE TRIGGER zane_checkins_drive_photo_cleanup
  BEFORE DELETE ON public.zane_checkins
  FOR EACH ROW EXECUTE FUNCTION public.capture_coaching_drive_photo_cleanup();

CREATE OR REPLACE FUNCTION public.capture_coaching_drive_photo_row_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.zane_coaching_drive_photo_cleanup(staging_path)
  VALUES (OLD.staging_path)
  ON CONFLICT (staging_path) DO NOTHING;
  RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION public.capture_coaching_drive_photo_row_cleanup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zane_coaching_drive_photo_cleanup ON public.zane_coaching_drive_photos;
CREATE TRIGGER zane_coaching_drive_photo_cleanup
  BEFORE DELETE ON public.zane_coaching_drive_photos
  FOR EACH ROW EXECUTE FUNCTION public.capture_coaching_drive_photo_row_cleanup();

REVOKE ALL ON TABLE public.zane_coaching_drive_photo_cleanup FROM PUBLIC, anon, authenticated;
