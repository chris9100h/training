-- Follow-up hardening for the DB/Edge audit. This migration is deliberately
-- additive because the preceding audit migrations have already been applied
-- to the preview project.

-- A failed replacement upload must only discard its new staging object. The
-- already-uploaded Drive file remains the valid photo until a replacement is
-- actually finished.
UPDATE public.zane_drive_progress_photos
SET status = 'uploaded',
    delete_requested_at = NULL,
    next_attempt_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    last_error = 'Progress picture replacement staging failed; existing Drive file preserved',
    updated_at = now()
WHERE status = 'deleting'
  AND drive_file_id IS NOT NULL
  AND locked_at IS NULL
  AND last_error = 'Progress picture replacement staging failed';

CREATE OR REPLACE FUNCTION public.release_drive_progress_photo(p_photo_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.zane_drive_progress_photos
  SET delete_requested_at = CASE
        WHEN drive_file_id IS NOT NULL THEN NULL
        WHEN status = 'uploading' THEN delete_requested_at
        ELSE now()
      END,
      status = CASE
        WHEN status = 'uploading' THEN status
        WHEN drive_file_id IS NOT NULL THEN 'uploaded'
        ELSE 'deleting'
      END,
      next_attempt_at = CASE
        WHEN status = 'uploading' THEN next_attempt_at
        ELSE now()
      END,
      locked_at = CASE WHEN status = 'uploading' THEN locked_at ELSE NULL END,
      locked_by = CASE WHEN status = 'uploading' THEN locked_by ELSE NULL END,
      last_error = CASE
        WHEN drive_file_id IS NULL THEN 'Progress picture staging failed'
        ELSE 'Progress picture replacement staging failed; existing Drive file preserved'
      END,
      updated_at = now()
  WHERE id = p_photo_id
    AND user_id = auth.uid()
    AND status <> 'deleting';
  RETURN FOUND;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.release_drive_progress_photo(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_drive_progress_photo(uuid)
  TO authenticated;

-- Parse both stable attachment paths and the public/signed URL forms stored by
-- old clients. Keep this helper out of the exposed API schema.
CREATE OR REPLACE FUNCTION app_private.coaching_chat_attachment_path(p_attachment jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN jsonb_typeof(p_attachment) IS DISTINCT FROM 'object' THEN NULL
    ELSE coalesce(
      nullif(btrim(p_attachment->>'path'), ''),
      nullif(
        regexp_replace(
          split_part(
            split_part(btrim(coalesce(p_attachment->>'url', '')), '?', 1),
            '#',
            1
          ),
          '^.*/chat-attachments/',
          ''
        ),
        ''
      )
    )
  END;
$function$;

REVOKE EXECUTE ON FUNCTION app_private.coaching_chat_attachment_path(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- Rows created by the earlier bulk cleanup function have no trustworthy
-- author provenance. Production has not received that migration yet; on the
-- preview project discard any such pending rows instead of risking deletion
-- of an object that was only named by untrusted attachment JSON.
ALTER TABLE public.zane_chat_attachment_cleanup
  ADD COLUMN IF NOT EXISTS owner_id uuid;
DELETE FROM public.zane_chat_attachment_cleanup
WHERE owner_id IS NULL;
ALTER TABLE public.zane_chat_attachment_cleanup
  ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE public.zane_chat_attachment_cleanup
  DROP CONSTRAINT IF EXISTS zane_chat_attachment_cleanup_owner_path_check;
ALTER TABLE public.zane_chat_attachment_cleanup
  ADD CONSTRAINT zane_chat_attachment_cleanup_owner_path_check
  CHECK (owner_id::text = split_part(path, '/', 1));

-- Every newly referenced object must live in the author's folder, carry the
-- author's Storage owner metadata and not already be pending deletion. The
-- advisory lock is shared with the delete trigger so a last-reference delete
-- cannot race a new reference to the same object path.
CREATE OR REPLACE FUNCTION public.zane_coaching_notes_guard_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_attachment jsonb;
  v_path text;
BEGIN
  NEW.created_at := now();

  IF NEW.attachments IS NULL THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.attachments) <> 'array' THEN
    RAISE EXCEPTION 'attachments must be an array';
  END IF;

  FOR v_attachment IN
    SELECT value FROM jsonb_array_elements(NEW.attachments)
  LOOP
    v_path := app_private.coaching_chat_attachment_path(v_attachment);
    IF v_path IS NULL
       OR v_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$'
       OR split_part(v_path, '/', 1) <> NEW.author_id::text
    THEN
      RAISE EXCEPTION 'invalid coaching attachment path';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(v_path, 19088743));

    IF EXISTS (
      SELECT 1
      FROM public.zane_chat_attachment_cleanup AS cleanup
      WHERE cleanup.path = v_path
    ) THEN
      RAISE EXCEPTION 'coaching attachment is pending deletion';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM storage.objects AS object
      WHERE object.bucket_id = 'chat-attachments'
        AND object.name = v_path
        AND object.owner_id::text = NEW.author_id::text
    ) THEN
      RAISE EXCEPTION 'coaching attachment object is not owned by the author';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.zane_coaching_notes_guard_insert()
  FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS chat_attachment_read_participant ON storage.objects;
CREATE POLICY chat_attachment_read_participant ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND EXISTS (
      SELECT 1
      FROM public.zane_coaching_notes AS note
      JOIN public.zane_coaching AS coaching
        ON coaching.id = note.coaching_id
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(note.attachments) = 'array' THEN note.attachments
          ELSE '[]'::jsonb
        END
      ) AS attachment(value)
      CROSS JOIN LATERAL (
        SELECT coalesce(
          nullif(btrim(attachment.value->>'path'), ''),
          nullif(
            regexp_replace(
              split_part(
                split_part(btrim(coalesce(attachment.value->>'url', '')), '?', 1),
                '#',
                1
              ),
              '^.*/chat-attachments/',
              ''
            ),
            ''
          )
        ) AS path
      ) AS candidate
      WHERE (
          coaching.coach_id = (select auth.uid())
          OR coaching.client_id = (select auth.uid())
        )
        AND candidate.path = name
        AND note.author_id::text = split_part(name, '/', 1)
        AND owner_id::text = note.author_id::text
    )
  );

-- Capture object cleanup for every note deletion, including the existing
-- direct single-note REST path. Only the final legitimate reference queues an
-- author-owned object.
CREATE OR REPLACE FUNCTION app_private.capture_coaching_note_attachment_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attachment jsonb;
  v_path text;
BEGIN
  FOR v_attachment IN
    SELECT value
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(OLD.attachments) = 'array' THEN OLD.attachments
        ELSE '[]'::jsonb
      END
    )
  LOOP
    v_path := app_private.coaching_chat_attachment_path(v_attachment);
    IF v_path IS NULL
       OR v_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$'
       OR split_part(v_path, '/', 1) <> OLD.author_id::text
    THEN
      CONTINUE;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_path, 19088743)
    );

    IF EXISTS (
      SELECT 1
      FROM storage.objects AS object
      WHERE object.bucket_id = 'chat-attachments'
        AND object.name = v_path
        AND object.owner_id::text = OLD.author_id::text
    ) AND NOT EXISTS (
      SELECT 1
      FROM public.zane_coaching_notes AS survivor
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(survivor.attachments) = 'array' THEN survivor.attachments
          ELSE '[]'::jsonb
        END
      ) AS survivor_attachment(value)
      WHERE survivor.id <> OLD.id
        AND app_private.coaching_chat_attachment_path(survivor_attachment.value) = v_path
    ) THEN
      INSERT INTO public.zane_chat_attachment_cleanup(path, owner_id)
      VALUES (v_path, OLD.author_id)
      ON CONFLICT (path) DO UPDATE
      SET owner_id = EXCLUDED.owner_id
      WHERE zane_chat_attachment_cleanup.owner_id = EXCLUDED.owner_id;
    END IF;
  END LOOP;

  RETURN OLD;
END;
$function$;

REVOKE EXECUTE ON FUNCTION app_private.capture_coaching_note_attachment_cleanup()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS zane_coaching_notes_capture_attachment_cleanup
  ON public.zane_coaching_notes;
CREATE TRIGGER zane_coaching_notes_capture_attachment_cleanup
BEFORE DELETE ON public.zane_coaching_notes
FOR EACH ROW
EXECUTE FUNCTION app_private.capture_coaching_note_attachment_cleanup();

-- The Edge worker never consumes the cleanup table directly. This service-only
-- RPC drops stale unsafe/shared tombstones and returns only absent objects or
-- objects whose Storage owner still matches the UUID path prefix.
CREATE OR REPLACE FUNCTION public.claim_chat_attachment_cleanup(p_limit integer DEFAULT 100)
RETURNS TABLE(path text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
BEGIN
  DELETE FROM public.zane_chat_attachment_cleanup AS cleanup
  WHERE cleanup.path IN (
    SELECT candidate.path
    FROM public.zane_chat_attachment_cleanup AS candidate
    WHERE EXISTS (
        SELECT 1
        FROM storage.objects AS object
        WHERE object.bucket_id = 'chat-attachments'
          AND object.name = candidate.path
          AND (
            object.owner_id::text IS DISTINCT FROM candidate.owner_id::text
            OR candidate.owner_id::text IS DISTINCT FROM split_part(candidate.path, '/', 1)
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.zane_coaching_notes AS survivor
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(survivor.attachments) = 'array' THEN survivor.attachments
            ELSE '[]'::jsonb
          END
        ) AS attachment(value)
        WHERE app_private.coaching_chat_attachment_path(attachment.value) = candidate.path
      )
    ORDER BY candidate.created_at, candidate.path
    LIMIT v_limit
  );

  RETURN QUERY
  SELECT cleanup.path
  FROM public.zane_chat_attachment_cleanup AS cleanup
  WHERE (
      NOT EXISTS (
        SELECT 1
        FROM storage.objects AS object
        WHERE object.bucket_id = 'chat-attachments'
          AND object.name = cleanup.path
      )
      OR EXISTS (
        SELECT 1
        FROM storage.objects AS object
        WHERE object.bucket_id = 'chat-attachments'
          AND object.name = cleanup.path
          AND object.owner_id::text = cleanup.owner_id::text
          AND cleanup.owner_id::text = split_part(cleanup.path, '/', 1)
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.zane_coaching_notes AS survivor
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(survivor.attachments) = 'array' THEN survivor.attachments
          ELSE '[]'::jsonb
        END
      ) AS attachment(value)
      WHERE app_private.coaching_chat_attachment_path(attachment.value) = cleanup.path
    )
  ORDER BY cleanup.created_at, cleanup.path
  LIMIT v_limit;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.claim_chat_attachment_cleanup(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_chat_attachment_cleanup(integer)
  TO service_role;

-- Whole-scope deletion now relies on the same per-note trigger as direct note
-- deletion. This removes the old, untrusted JSON-to-tombstone bulk insert.
CREATE OR REPLACE FUNCTION public.delete_coaching_chat_scope(
  p_caller_id uuid,
  p_scope text,
  p_scope_id text
)
RETURNS text[]
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_paths text[] := ARRAY[]::text[];
  v_allowed boolean := false;
  v_exists boolean := false;
  v_is_admin boolean := false;
BEGIN
  IF p_caller_id IS NULL OR p_scope_id IS NULL THEN
    RAISE EXCEPTION 'invalid chat cleanup request';
  END IF;

  IF p_scope = 'thread' THEN
    SELECT true,
           p_caller_id IN (coaching.coach_id, coaching.client_id)
    INTO v_exists, v_allowed
    FROM public.zane_coaching_threads AS thread
    JOIN public.zane_coaching AS coaching
      ON coaching.id = thread.coaching_id
    WHERE thread.id = p_scope_id
    FOR UPDATE OF thread, coaching;

    IF NOT coalesce(v_exists, false) THEN
      RETURN v_paths;
    END IF;
    IF NOT coalesce(v_allowed, false) THEN
      RAISE EXCEPTION 'not allowed to delete this thread';
    END IF;

    PERFORM 1
    FROM public.zane_coaching_notes AS note
    WHERE note.thread_id = p_scope_id
    ORDER BY note.id
    FOR UPDATE;

    SELECT coalesce(array_agg(candidate.path ORDER BY candidate.path), ARRAY[]::text[])
    INTO v_paths
    FROM (
      SELECT DISTINCT app_private.coaching_chat_attachment_path(attachment.value) AS path
      FROM public.zane_coaching_notes AS note
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(note.attachments) = 'array'
          THEN note.attachments ELSE '[]'::jsonb END
      ) AS attachment(value)
      WHERE note.thread_id = p_scope_id
    ) AS candidate
    WHERE candidate.path IS NOT NULL;

    DELETE FROM public.zane_coaching_notes WHERE thread_id = p_scope_id;
    DELETE FROM public.zane_coaching_threads WHERE id = p_scope_id;
    RETURN v_paths;
  ELSIF p_scope = 'note' THEN
    SELECT true,
           note.author_id = p_caller_id
             AND note.created_at >= now() - interval '60 minutes'
    INTO v_exists, v_allowed
    FROM public.zane_coaching_notes AS note
    WHERE note.id = p_scope_id
    FOR UPDATE;

    IF NOT coalesce(v_exists, false) THEN
      RETURN v_paths;
    END IF;
    IF NOT coalesce(v_allowed, false) THEN
      RAISE EXCEPTION 'not allowed to delete this note';
    END IF;

    SELECT coalesce(array_agg(candidate.path ORDER BY candidate.path), ARRAY[]::text[])
    INTO v_paths
    FROM (
      SELECT DISTINCT app_private.coaching_chat_attachment_path(attachment.value) AS path
      FROM public.zane_coaching_notes AS note
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(note.attachments) = 'array'
          THEN note.attachments ELSE '[]'::jsonb END
      ) AS attachment(value)
      WHERE note.id = p_scope_id
    ) AS candidate
    WHERE candidate.path IS NOT NULL;

    DELETE FROM public.zane_coaching_notes WHERE id = p_scope_id;
    RETURN v_paths;
  ELSIF p_scope = 'support-ticket' THEN
    SELECT EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = p_caller_id
        AND email = 'office@btc-prime.biz'
    ) INTO v_is_admin;
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'admin access required';
    END IF;
    IF p_scope_id NOT LIKE 'support\_%' ESCAPE '\' THEN
      RAISE EXCEPTION 'not a support ticket';
    END IF;

    SELECT true INTO v_exists
    FROM public.zane_coaching AS coaching
    WHERE coaching.id = p_scope_id
    FOR UPDATE;
    IF NOT coalesce(v_exists, false) THEN
      RETURN v_paths;
    END IF;

    PERFORM 1
    FROM public.zane_coaching_notes AS note
    WHERE note.coaching_id = p_scope_id
    ORDER BY note.id
    FOR UPDATE;

    SELECT coalesce(array_agg(candidate.path ORDER BY candidate.path), ARRAY[]::text[])
    INTO v_paths
    FROM (
      SELECT DISTINCT app_private.coaching_chat_attachment_path(attachment.value) AS path
      FROM public.zane_coaching_notes AS note
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(note.attachments) = 'array'
          THEN note.attachments ELSE '[]'::jsonb END
      ) AS attachment(value)
      WHERE note.coaching_id = p_scope_id
    ) AS candidate
    WHERE candidate.path IS NOT NULL;

    DELETE FROM public.zane_coaching_notes WHERE coaching_id = p_scope_id;
    DELETE FROM public.zane_coaching_threads WHERE coaching_id = p_scope_id;
    DELETE FROM public.zane_coaching WHERE id = p_scope_id;
    RETURN v_paths;
  END IF;

  RAISE EXCEPTION 'invalid chat cleanup scope';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.delete_coaching_chat_scope(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_coaching_chat_scope(uuid, text, text)
  TO service_role;

-- Set mutations take a key-share lock on their parent session. The sweeper's
-- existing FOR UPDATE lock on that row is therefore the serialization point:
-- a mutation commits before the sweep and is observed, or waits until after
-- the session has been closed/deleted.
CREATE OR REPLACE FUNCTION app_private.zane_sets_lock_session_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM 1
    FROM public.zane_sessions AS session
    WHERE session.id = OLD.session_id
    FOR KEY SHARE;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.session_id IS DISTINCT FROM OLD.session_id THEN
    PERFORM 1
    FROM public.zane_sessions AS session
    WHERE session.id IN (OLD.session_id, NEW.session_id)
    ORDER BY session.id
    FOR KEY SHARE;
  ELSE
    PERFORM 1
    FROM public.zane_sessions AS session
    WHERE session.id = NEW.session_id
    FOR KEY SHARE;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION app_private.zane_sets_lock_session_activity()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS zane_sets_lock_session_activity ON public.zane_sets;
CREATE TRIGGER zane_sets_lock_session_activity
BEFORE INSERT OR UPDATE OR DELETE ON public.zane_sets
FOR EACH ROW EXECUTE FUNCTION app_private.zane_sets_lock_session_activity();

-- Boot cleanup may only delete a sufficiently old caller-owned session after
-- locking the session and settings pointer and rechecking every emptiness
-- predicate in the DELETE itself.
REVOKE EXECUTE ON FUNCTION public.delete_empty_orphan_session(text)
  FROM PUBLIC, anon, authenticated;
DROP FUNCTION public.delete_empty_orphan_session(text);

CREATE OR REPLACE FUNCTION public.delete_empty_orphan_session(
  p_session_id text,
  p_started_before timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session_id text;
BEGIN
  IF v_uid IS NULL OR p_session_id IS NULL OR p_started_before IS NULL THEN
    RETURN false;
  END IF;

  SELECT session.id
  INTO v_session_id
  FROM public.zane_sessions AS session
  WHERE session.id = p_session_id
    AND session.user_id = v_uid
    AND session.ended IS NULL
    AND session.started_at IS NOT NULL
    AND session.started_at < p_started_before
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM public.zane_user_settings AS settings
  WHERE settings.user_id = v_uid
  FOR UPDATE;

  DELETE FROM public.zane_sessions AS session
  WHERE session.id = v_session_id
    AND session.user_id = v_uid
    AND session.ended IS NULL
    AND session.started_at IS NOT NULL
    AND session.started_at < p_started_before
    AND NOT EXISTS (
      SELECT 1
      FROM public.zane_user_settings AS settings
      WHERE settings.user_id = v_uid
        AND settings.in_progress_session_id = session.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.zane_session_entries AS entry
      WHERE entry.session_id = session.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.zane_sets AS sets
      WHERE sets.session_id = session.id
    );
  RETURN FOUND;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.delete_empty_orphan_session(text, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_empty_orphan_session(text, timestamptz)
  TO authenticated;

-- Claiming a reminder is latency-sensitive and may run once per due user. Move
-- retention to one bounded RPC call per cron invocation and give it a directly
-- usable partial index.
DROP INDEX IF EXISTS public.zane_reminder_delivery_claims_retention_idx;
CREATE INDEX zane_reminder_delivery_claims_retention_idx
  ON public.zane_reminder_delivery_claims (delivered_at)
  WHERE delivered_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_reminder_delivery(
  p_kind text,
  p_user_id uuid,
  p_expected_at timestamptz,
  p_expected_text text,
  p_target_text text,
  p_claim_token uuid,
  p_claimed_at timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event_key text;
  v_claimed_key text;
BEGIN
  IF p_user_id IS NULL OR p_claim_token IS NULL OR p_claimed_at IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_kind = 'generic' THEN
    IF p_expected_at IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.zane_user_settings AS settings
      WHERE settings.user_id = p_user_id
        AND settings.push_enabled = true
        AND settings.reminder_enabled = true
        AND settings.next_reminder_at = p_expected_at
        AND settings.next_reminder_at <= p_claimed_at
        AND settings.next_reminder_at >= p_claimed_at - interval '1 hour'
    ) THEN
      RETURN NULL;
    END IF;
    v_event_key := to_char(
      p_expected_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    );
  ELSIF p_kind = 'water' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.zane_user_settings AS settings
      WHERE settings.user_id = p_user_id
        AND settings.push_enabled = true
        AND settings.water_reminder_enabled = true
        AND settings.water_last_push_at IS NOT DISTINCT FROM p_expected_at
        AND (
          settings.water_last_push_at IS NULL
          OR settings.water_last_push_at <= p_claimed_at - interval '1 hour'
        )
    ) THEN
      RETURN NULL;
    END IF;
    v_event_key := coalesce(
      to_char(p_expected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'never'
    );
  ELSIF p_kind = 'daily-log' THEN
    IF p_target_text IS NULL
       OR p_target_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR NOT EXISTS (
         SELECT 1
         FROM public.zane_user_settings AS settings
         WHERE settings.user_id = p_user_id
           AND settings.push_enabled = true
           AND settings.daily_log_reminder_enabled = true
           AND settings.daily_log_reminder_last_date IS NOT DISTINCT FROM p_expected_text
           AND settings.daily_log_reminder_last_date IS DISTINCT FROM p_target_text
       )
    THEN
      RETURN NULL;
    END IF;
    v_event_key := p_target_text;
  ELSE
    RETURN NULL;
  END IF;

  INSERT INTO public.zane_reminder_delivery_claims AS claim (
    kind, user_id, event_key, expected_at, expected_text, target_text,
    claim_token, claimed_at, delivered_at
  )
  VALUES (
    p_kind, p_user_id, v_event_key, p_expected_at, p_expected_text, p_target_text,
    p_claim_token, p_claimed_at, NULL
  )
  ON CONFLICT (kind, user_id, event_key) DO UPDATE
  SET expected_at = EXCLUDED.expected_at,
      expected_text = EXCLUDED.expected_text,
      target_text = EXCLUDED.target_text,
      claim_token = EXCLUDED.claim_token,
      claimed_at = EXCLUDED.claimed_at
  WHERE claim.delivered_at IS NULL
    AND claim.claimed_at < now() - interval '15 minutes'
  RETURNING event_key INTO v_claimed_key;

  RETURN v_claimed_key;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prune_reminder_delivery_claims(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 5000));
  v_deleted integer := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(1941726301) THEN
    RETURN 0;
  END IF;

  WITH doomed AS (
    SELECT claim.kind, claim.user_id, claim.event_key
    FROM public.zane_reminder_delivery_claims AS claim
    WHERE claim.delivered_at < now() - interval '30 days'
    ORDER BY claim.delivered_at, claim.kind, claim.user_id, claim.event_key
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  DELETE FROM public.zane_reminder_delivery_claims AS claim
  USING doomed
  WHERE claim.kind = doomed.kind
    AND claim.user_id = doomed.user_id
    AND claim.event_key = doomed.event_key;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.claim_reminder_delivery(
  text, uuid, timestamptz, text, text, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reminder_delivery(
  text, uuid, timestamptz, text, text, uuid, timestamptz
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.prune_reminder_delivery_claims(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_reminder_delivery_claims(integer)
  TO service_role;
