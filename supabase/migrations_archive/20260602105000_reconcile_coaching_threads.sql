-- Migration 0034: named threads inside a coaching relationship.
CREATE TABLE IF NOT EXISTS public.zane_coaching_threads (
  id text PRIMARY KEY,
  coaching_id text NOT NULL REFERENCES public.zane_coaching(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zane_coaching_threads_coaching_created_idx
  ON public.zane_coaching_threads (coaching_id, created_at);

ALTER TABLE public.zane_coaching_notes
  ADD COLUMN IF NOT EXISTS thread_id text REFERENCES public.zane_coaching_threads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS zane_coaching_notes_thread_idx
  ON public.zane_coaching_notes (thread_id) WHERE thread_id IS NOT NULL;

ALTER TABLE public.zane_coaching_threads ENABLE ROW LEVEL SECURITY;

DO $policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'zane_coaching_threads' AND policyname = 'threads visible to participants') THEN
    CREATE POLICY "threads visible to participants" ON public.zane_coaching_threads FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.zane_coaching c WHERE c.id = coaching_id AND (c.coach_id = auth.uid() OR c.client_id = auth.uid())));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'zane_coaching_threads' AND policyname = 'participants can create threads') THEN
    CREATE POLICY "participants can create threads" ON public.zane_coaching_threads FOR INSERT
      WITH CHECK (created_by = auth.uid() AND EXISTS (
        SELECT 1 FROM public.zane_coaching c WHERE c.id = coaching_id AND c.status = 'active'
          AND (c.coach_id = auth.uid() OR c.client_id = auth.uid())
      ));
  END IF;
END
$policy$;
