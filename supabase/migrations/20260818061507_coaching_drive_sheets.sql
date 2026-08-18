-- Coaching Drive archive
--
-- Check-ins are the source of truth. This migration only adds a durable,
-- service-role-only outbox for the optional Google Drive/Sheets mirror. No
-- trigger performs network I/O and a Drive outage can never make a check-in
-- write fail.

CREATE TABLE IF NOT EXISTS public.zane_coaching_drive_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  google_account_email text,
  root_folder_id text,
  overview_spreadsheet_id text,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','needs_reauth','paused','error')),
  archive_enabled boolean NOT NULL DEFAULT true,
  include_photos boolean NOT NULL DEFAULT false,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.zane_coaching_drive_tokens (
  connection_id uuid PRIMARY KEY REFERENCES public.zane_coaching_drive_connections(id) ON DELETE CASCADE,
  refresh_token_ciphertext text NOT NULL,
  refresh_token_iv text NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.zane_coaching_drive_oauth_states (
  state text PRIMARY KEY,
  coach_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.zane_coaching_drive_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coaching_id text NOT NULL REFERENCES public.zane_coaching(id) ON DELETE CASCADE,
  checkin_id text NOT NULL REFERENCES public.zane_checkins(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed','needs_reauth')),
  spreadsheet_id text,
  drive_file_id text,
  client_folder_id text,
  photo_count integer NOT NULL DEFAULT 0 CHECK (photo_count >= 0 AND photo_count <= 8),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  exported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coach_id, checkin_id)
);

CREATE TABLE IF NOT EXISTS public.zane_coaching_drive_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coaching_id text NOT NULL REFERENCES public.zane_coaching(id) ON DELETE CASCADE,
  checkin_id text NOT NULL REFERENCES public.zane_checkins(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staging_path text NOT NULL UNIQUE,
  drive_file_id text,
  file_name text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 8388608),
  status text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','uploaded','failed')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  uploaded_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_coaching_drive_exports_due
  ON public.zane_coaching_drive_exports(status, next_attempt_at, locked_at);
CREATE INDEX IF NOT EXISTS idx_coaching_drive_exports_coach
  ON public.zane_coaching_drive_exports(coach_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_coaching_drive_photos_checkin
  ON public.zane_coaching_drive_photos(checkin_id, status);

ALTER TABLE public.zane_coaching_drive_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_coaching_drive_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_coaching_drive_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_coaching_drive_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_coaching_drive_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coaching_drive_connection_own ON public.zane_coaching_drive_connections;
CREATE POLICY coaching_drive_connection_own ON public.zane_coaching_drive_connections
  FOR SELECT TO authenticated USING (coach_id = (select auth.uid()));

DROP POLICY IF EXISTS coaching_drive_export_own ON public.zane_coaching_drive_exports;
CREATE POLICY coaching_drive_export_own ON public.zane_coaching_drive_exports
  FOR SELECT TO authenticated USING (coach_id = (select auth.uid()));

DROP POLICY IF EXISTS coaching_drive_photo_own ON public.zane_coaching_drive_photos;
CREATE POLICY coaching_drive_photo_own ON public.zane_coaching_drive_photos
  FOR SELECT TO authenticated USING (client_id = (select auth.uid()) OR EXISTS (
    SELECT 1 FROM public.zane_coaching c
    WHERE c.id = coaching_id AND c.coach_id = (select auth.uid())
      AND c.status = 'active' AND c.id NOT LIKE 'support_%'
  ));

DROP POLICY IF EXISTS coaching_drive_photo_insert ON public.zane_coaching_drive_photos;
CREATE POLICY coaching_drive_photo_insert ON public.zane_coaching_drive_photos
  FOR INSERT TO authenticated WITH CHECK (
    client_id = (select auth.uid()) AND EXISTS (
      SELECT 1 FROM public.zane_coaching c
      WHERE c.id = coaching_id AND c.client_id = (select auth.uid())
        AND c.status = 'active' AND c.id NOT LIKE 'support_%'
    )
  );

REVOKE ALL ON TABLE public.zane_coaching_drive_tokens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.zane_coaching_drive_oauth_states FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.zane_coaching_drive_connections FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.zane_coaching_drive_exports FROM anon, authenticated;
REVOKE UPDATE, DELETE ON TABLE public.zane_coaching_drive_photos FROM anon, authenticated;

-- Claim a small batch with a lease. Only the Edge worker (service role) may
-- execute this function; callers never receive token ciphertext.
CREATE OR REPLACE FUNCTION public.claim_coaching_drive_exports(p_limit integer DEFAULT 5, p_worker text DEFAULT '')
RETURNS SETOF public.zane_coaching_drive_exports
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_limit integer := greatest(1, least(coalesce(p_limit, 5), 10));
BEGIN
  IF coalesce(trim(p_worker), '') = '' THEN RAISE EXCEPTION 'worker id required'; END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT e.id FROM public.zane_coaching_drive_exports e
    WHERE e.status IN ('pending','failed')
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
BEGIN
  IF p_status NOT IN ('pending','succeeded','failed','needs_reauth') THEN RAISE EXCEPTION 'invalid export status'; END IF;
  UPDATE public.zane_coaching_drive_exports
  SET status = p_status,
      spreadsheet_id = coalesce(p_spreadsheet_id, spreadsheet_id),
      drive_file_id = coalesce(p_drive_file_id, drive_file_id),
      client_folder_id = coalesce(p_client_folder_id, client_folder_id),
      photo_count = coalesce(p_photo_count, photo_count),
      last_error = nullif(p_error, ''),
      next_attempt_at = coalesce(p_next_attempt_at, now()),
      locked_at = NULL, locked_by = NULL,
      exported_at = CASE WHEN p_status = 'succeeded' THEN now() ELSE exported_at END,
      updated_at = now()
  WHERE id = p_export_id AND locked_by = p_worker;
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
  INSERT INTO public.zane_coaching_drive_exports(coach_id, client_id, coaching_id, checkin_id, week_start)
  VALUES (v_coach, NEW.client_id, NEW.coaching_id, NEW.id, NEW.week_start)
  ON CONFLICT (coach_id, checkin_id) DO UPDATE SET
    client_id = excluded.client_id, coaching_id = excluded.coaching_id,
    week_start = excluded.week_start, status = 'pending', next_attempt_at = now(),
    last_error = NULL, locked_at = NULL, locked_by = NULL, updated_at = now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_coaching_drive_exports(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_coaching_drive_export(uuid, text, text, text, text, text, integer, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_coaching_drive_export() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_coaching_drive_exports(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_coaching_drive_export(uuid, text, text, text, text, text, integer, text, timestamptz) TO service_role;

DROP TRIGGER IF EXISTS zane_checkins_drive_export ON public.zane_checkins;
CREATE TRIGGER zane_checkins_drive_export
  AFTER INSERT OR UPDATE OF responses, checked_in_at, week_start ON public.zane_checkins
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_coaching_drive_export();

-- Explicitly repeat these after trigger creation. Supabase's default
-- privileges can otherwise reintroduce authenticated EXECUTE for a freshly
-- created SECURITY DEFINER trigger helper.
REVOKE ALL ON FUNCTION public.claim_coaching_drive_exports(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_coaching_drive_export(uuid, text, text, text, text, text, integer, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_coaching_drive_export() FROM PUBLIC, anon, authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('coaching-drive-staging', 'coaching-drive-staging', false, 8388608,
        ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 8388608,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

DROP POLICY IF EXISTS coaching_drive_stage_insert ON storage.objects;
CREATE POLICY coaching_drive_stage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'coaching-drive-staging' AND (storage.foldername(name))[1] = (select auth.uid())::text);
DROP POLICY IF EXISTS coaching_drive_stage_read ON storage.objects;
CREATE POLICY coaching_drive_stage_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'coaching-drive-staging' AND (storage.foldername(name))[1] = (select auth.uid())::text);
DROP POLICY IF EXISTS coaching_drive_stage_delete ON storage.objects;
CREATE POLICY coaching_drive_stage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'coaching-drive-staging' AND (storage.foldername(name))[1] = (select auth.uid())::text);

-- The production cron schedule is deliberately configured separately after
-- deployment. A migration cannot safely hardcode a project URL because the
-- same file is replayed on Supabase preview branches. Configure a one-minute
-- pg_cron/net.http_post job against that environment's function URL, using
-- the existing Vault-backed cron_shared_secret as its Bearer value.
