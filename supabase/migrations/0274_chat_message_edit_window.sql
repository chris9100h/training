-- Enforce the message edit and delete window server-side.

DROP POLICY IF EXISTS "social messages edit own" ON public.zane_social_messages;
CREATE POLICY "social messages edit own" ON public.zane_social_messages
  FOR UPDATE TO authenticated
  USING (
    sender_id = (select auth.uid())
    AND created_at >= now() - interval '60 minutes'
  )
  WITH CHECK (
    sender_id = (select auth.uid())
    AND created_at >= now() - interval '60 minutes'
  );

DROP POLICY IF EXISTS "social messages delete own" ON public.zane_social_messages;
CREATE POLICY "social messages delete own" ON public.zane_social_messages
  FOR DELETE TO authenticated
  USING (
    sender_id = (select auth.uid())
    AND created_at >= now() - interval '60 minutes'
  );

CREATE OR REPLACE FUNCTION public.zane_social_messages_guard_update()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
BEGIN
  IF (select auth.uid()) = old.sender_id THEN
    IF new.id           IS DISTINCT FROM old.id
       OR new.sender_id IS DISTINCT FROM old.sender_id
       OR new.recipient_id IS DISTINCT FROM old.recipient_id
       OR new.group_id   IS DISTINCT FROM old.group_id
       OR new.created_at IS DISTINCT FROM old.created_at
    THEN
      RAISE EXCEPTION 'senders may only update body and edited_at';
    END IF;
  END IF;
  RETURN new;
END;
$function$;

DROP TRIGGER IF EXISTS zane_social_messages_guard_update ON public.zane_social_messages;
CREATE TRIGGER zane_social_messages_guard_update
  BEFORE UPDATE ON public.zane_social_messages
  FOR EACH ROW EXECUTE FUNCTION public.zane_social_messages_guard_update();

REVOKE EXECUTE ON FUNCTION public.zane_social_messages_guard_update() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "authors can edit notes" ON public.zane_coaching_notes;
CREATE POLICY "authors can edit notes" ON public.zane_coaching_notes
  FOR UPDATE TO public
  USING (
    author_id = (select auth.uid())
    AND created_at >= now() - interval '60 minutes'
    AND EXISTS (
      SELECT 1 FROM zane_coaching c
      WHERE c.id = zane_coaching_notes.coaching_id
        AND (c.coach_id = (select auth.uid()) OR c.client_id = (select auth.uid()))
    )
  )
  WITH CHECK (
    author_id = (select auth.uid())
    AND created_at >= now() - interval '60 minutes'
    AND EXISTS (
      SELECT 1 FROM zane_coaching c
      WHERE c.id = zane_coaching_notes.coaching_id
        AND (c.coach_id = (select auth.uid()) OR c.client_id = (select auth.uid()))
    )
  );

-- Direct message deletion is author-only and time-limited. Whole-thread deletion
-- uses the dedicated function below so it can still remove the thread's history.
DROP POLICY IF EXISTS "participants can delete notes" ON public.zane_coaching_notes;
DROP POLICY IF EXISTS "authors can delete notes" ON public.zane_coaching_notes;
CREATE POLICY "authors can delete notes" ON public.zane_coaching_notes
  FOR DELETE TO public
  USING (
    author_id = (select auth.uid())
    AND created_at >= now() - interval '60 minutes'
    AND EXISTS (
      SELECT 1 FROM zane_coaching c
      WHERE c.id = zane_coaching_notes.coaching_id
        AND (c.coach_id = (select auth.uid()) OR c.client_id = (select auth.uid()))
    )
  );

CREATE OR REPLACE FUNCTION public.delete_coaching_thread(p_thread_id text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
DECLARE
  v_coach_id uuid;
  v_client_id uuid;
BEGIN
  SELECT c.coach_id, c.client_id
    INTO v_coach_id, v_client_id
    FROM zane_coaching_threads t
    JOIN zane_coaching c ON c.id = t.coaching_id
   WHERE t.id = p_thread_id;

  IF v_coach_id IS NULL OR (select auth.uid()) IS NULL
     OR (select auth.uid()) NOT IN (v_coach_id, v_client_id) THEN
    RAISE EXCEPTION 'Not allowed to delete this thread';
  END IF;

  DELETE FROM zane_coaching_notes WHERE thread_id = p_thread_id;
  DELETE FROM zane_coaching_threads WHERE id = p_thread_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_coaching_thread(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_coaching_thread(text) TO authenticated;
