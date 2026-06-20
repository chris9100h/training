-- Allow multiple coaching rows per coach-client pair.
-- Required for multi-ticket support (each ticket is a separate zane_coaching row).
-- Real coaching relationships are guarded by RLS + application logic, not this constraint.
ALTER TABLE public.zane_coaching DROP CONSTRAINT IF EXISTS zane_coaching_coach_id_client_id_key;
