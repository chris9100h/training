-- Cleanup-week/session flags were applied in the SQL editor.  The load-
-- shedding RPCs use them to exclude non-training sessions from history work.
ALTER TABLE public.zane_sessions
  ADD COLUMN IF NOT EXISTS is_bonus boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_freestyle boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_deload boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_cleanup boolean NOT NULL DEFAULT false;
