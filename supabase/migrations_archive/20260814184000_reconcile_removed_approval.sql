-- Production no longer has the obsolete signup-approval column. A preview
-- created from an older migration snapshot can still carry it, which makes
-- the live schema differ from schema.sql and can resurrect removed RPCs.
BEGIN;

ALTER TABLE public.zane_profiles DROP COLUMN IF EXISTS approved;

COMMIT;
