-- Migration 0050: add planned_reps_per_set to zane_session_entries
-- Enables per-set rep targets (e.g. 10/8/6) in addition to uniform planned_reps.
ALTER TABLE zane_session_entries ADD COLUMN planned_reps_per_set integer[];
