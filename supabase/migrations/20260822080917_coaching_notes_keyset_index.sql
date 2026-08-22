-- Thread/support chat pages filter by coaching + thread scope, then walk a
-- deterministic (created_at DESC, id DESC) cursor. The older indexes cover
-- either coaching chronology or non-null thread lookup, but not this complete
-- equality-prefix + keyset-order access path (including thread_id IS NULL).
CREATE INDEX IF NOT EXISTS zane_coaching_notes_thread_keyset_idx
  ON public.zane_coaching_notes USING btree
  (coaching_id, thread_id, created_at DESC, id DESC);
