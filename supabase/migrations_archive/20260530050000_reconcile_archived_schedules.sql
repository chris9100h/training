-- Migration 0030 was applied in the SQL editor and was missing from the
-- production history.  Keep it before the relational session migration.
ALTER TABLE public.zane_schedules
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
