-- Stable keyset access for bounded coaching macro and thread history pages.
-- Equality scope comes first, followed by the descending chronology and the
-- unique text id used to break same-timestamp ties.
CREATE INDEX IF NOT EXISTS zane_coaching_macros_history_keyset_idx
  ON public.zane_coaching_macros (coaching_id, set_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS zane_coaching_threads_history_keyset_idx
  ON public.zane_coaching_threads (coaching_id, created_at DESC, id DESC);

-- The claims primary key starts with kind, so it cannot efficiently support
-- auth.users cascade/FK checks that filter by user_id alone.
CREATE INDEX IF NOT EXISTS zane_reminder_delivery_claims_user_idx
  ON public.zane_reminder_delivery_claims (user_id);
