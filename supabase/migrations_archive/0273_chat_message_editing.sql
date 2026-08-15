-- Chat message editing and deletion for social, coaching, and support chats.

ALTER TABLE public.zane_social_messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

ALTER TABLE public.zane_coaching_notes
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

DROP POLICY IF EXISTS "social messages edit own" ON public.zane_social_messages;
CREATE POLICY "social messages edit own" ON public.zane_social_messages
  FOR UPDATE TO authenticated
  USING (sender_id = (select auth.uid()))
  WITH CHECK (sender_id = (select auth.uid()));

DROP POLICY IF EXISTS "social messages delete own" ON public.zane_social_messages;
CREATE POLICY "social messages delete own" ON public.zane_social_messages
  FOR DELETE TO authenticated
  USING (sender_id = (select auth.uid()));

GRANT UPDATE, DELETE ON public.zane_social_messages TO authenticated;

DROP POLICY IF EXISTS "authors can edit notes" ON public.zane_coaching_notes;
CREATE POLICY "authors can edit notes" ON public.zane_coaching_notes
  FOR UPDATE TO public
  USING (
    author_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM zane_coaching c
      WHERE c.id = zane_coaching_notes.coaching_id
        AND (c.coach_id = (select auth.uid()) OR c.client_id = (select auth.uid()))
    )
  )
  WITH CHECK (
    author_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM zane_coaching c
      WHERE c.id = zane_coaching_notes.coaching_id
        AND (c.coach_id = (select auth.uid()) OR c.client_id = (select auth.uid()))
    )
  );

CREATE OR REPLACE FUNCTION public.zane_coaching_notes_guard_update()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
begin
  if (select auth.uid()) = old.author_id then
    if new.id             is distinct from old.id
       or new.coaching_id is distinct from old.coaching_id
       or new.author_id   is distinct from old.author_id
       or new.type        is distinct from old.type
       or new.entity_id   is distinct from old.entity_id
       or new.entity_name is distinct from old.entity_name
       or new.created_at  is distinct from old.created_at
       or new.read_at     is distinct from old.read_at
       or new.thread_id   is distinct from old.thread_id
       or new.attachments is distinct from old.attachments
    then
      raise exception 'author may only update body and edited_at';
    end if;
  else
    if new.id             is distinct from old.id
       or new.coaching_id is distinct from old.coaching_id
       or new.author_id   is distinct from old.author_id
       or new.type        is distinct from old.type
       or new.entity_id   is distinct from old.entity_id
       or new.entity_name is distinct from old.entity_name
       or new.body        is distinct from old.body
       or new.created_at  is distinct from old.created_at
       or new.edited_at   is distinct from old.edited_at
       or new.thread_id   is distinct from old.thread_id
       or new.attachments is distinct from old.attachments
    then
      raise exception 'recipient may only update read_at';
    end if;
  end if;
  return new;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.zane_coaching_notes_guard_update() FROM PUBLIC, anon, authenticated;

GRANT UPDATE, DELETE ON public.zane_coaching_notes TO authenticated;
