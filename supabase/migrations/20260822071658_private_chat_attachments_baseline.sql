-- The coaching/support chat upload path existed in the client but the active
-- migration baseline never created its bucket. Keep legacy public URL strings
-- parseable as object locators, while making object delivery private.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

DROP POLICY IF EXISTS chat_attachment_insert_own ON storage.objects;
CREATE POLICY chat_attachment_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND array_length(storage.foldername(name), 1) = 1
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND storage.filename(name) ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$'
    AND position('..' in name) = 0
  );

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
      WHERE (
          coaching.coach_id = (select auth.uid())
          OR coaching.client_id = (select auth.uid())
        )
        AND (
          attachment.value->>'path' = name
          OR right(
            split_part(coalesce(attachment.value->>'url', ''), '?', 1),
            length(name) + 1
          ) = '/' || name
        )
    )
  );

DROP POLICY IF EXISTS chat_attachment_delete_owner_or_admin ON storage.objects;
CREATE POLICY chat_attachment_delete_owner_or_admin ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (
      (storage.foldername(name))[1] = (select auth.uid())::text
      OR (select auth.email()) = 'office@btc-prime.biz'
    )
  );

-- Deleting a whole coaching thread or support ticket can remove notes written
-- by both participants. Preserve their object paths transactionally before
-- the note rows disappear, then let the authenticated Edge cleanup endpoint
-- delete the private objects with the service role. Failed Storage deletes
-- remain as idempotent tombstones for a later endpoint invocation.
CREATE TABLE IF NOT EXISTS public.zane_chat_attachment_cleanup (
  path text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (path ~ '^[0-9A-Fa-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$')
);

ALTER TABLE public.zane_chat_attachment_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zane_chat_attachment_cleanup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.zane_chat_attachment_cleanup
  TO service_role;

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

    WITH attachment_paths AS (
      SELECT DISTINCT candidate.path
      FROM public.zane_coaching_notes AS note
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(note.attachments) = 'array'
          THEN note.attachments ELSE '[]'::jsonb END
      ) AS attachment(value)
      CROSS JOIN LATERAL (
        SELECT coalesce(
          nullif(trim(attachment.value->>'path'), ''),
          nullif(
            regexp_replace(
              split_part(trim(coalesce(attachment.value->>'url', '')), '?', 1),
              '^.*/chat-attachments/',
              ''
            ),
            ''
          )
        ) AS path
      ) AS candidate
      WHERE note.thread_id = p_scope_id
        AND candidate.path ~ '^[0-9A-Fa-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$'
    ), inserted AS (
      INSERT INTO public.zane_chat_attachment_cleanup(path)
      SELECT path FROM attachment_paths
      ON CONFLICT (path) DO NOTHING
      RETURNING path
    )
    SELECT coalesce(array_agg(path ORDER BY path), ARRAY[]::text[])
    INTO v_paths
    FROM attachment_paths;

    DELETE FROM public.zane_coaching_notes WHERE thread_id = p_scope_id;
    DELETE FROM public.zane_coaching_threads WHERE id = p_scope_id;
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

    WITH attachment_paths AS (
      SELECT DISTINCT candidate.path
      FROM public.zane_coaching_notes AS note
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(note.attachments) = 'array'
          THEN note.attachments ELSE '[]'::jsonb END
      ) AS attachment(value)
      CROSS JOIN LATERAL (
        SELECT coalesce(
          nullif(trim(attachment.value->>'path'), ''),
          nullif(
            regexp_replace(
              split_part(trim(coalesce(attachment.value->>'url', '')), '?', 1),
              '^.*/chat-attachments/',
              ''
            ),
            ''
          )
        ) AS path
      ) AS candidate
      WHERE note.coaching_id = p_scope_id
        AND candidate.path ~ '^[0-9A-Fa-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$'
    ), inserted AS (
      INSERT INTO public.zane_chat_attachment_cleanup(path)
      SELECT path FROM attachment_paths
      ON CONFLICT (path) DO NOTHING
      RETURNING path
    )
    SELECT coalesce(array_agg(path ORDER BY path), ARRAY[]::text[])
    INTO v_paths
    FROM attachment_paths;

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
