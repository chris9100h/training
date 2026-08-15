-- Columns that were added between the relational-table migration and the
-- first recorded RPC rewrites.  The later RPCs remain authoritative; these
-- columns make their replay safe on a clean database.
ALTER TABLE public.zane_session_entries
  ADD COLUMN IF NOT EXISTS planned_reps_max integer;

ALTER TABLE public.zane_sets
  ADD COLUMN IF NOT EXISTS technique text,
  ADD COLUMN IF NOT EXISTS drops jsonb,
  ADD COLUMN IF NOT EXISTS time_sec integer;
