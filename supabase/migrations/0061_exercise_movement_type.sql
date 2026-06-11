-- Add movement_type and no_weight_reps to exercises.
-- movement_type supersedes the unilateral boolean (kept for backward compat):
--   'bilateral' (default), 'unilateral', 'mobility'
-- no_weight_reps hides weight/reps inputs in the workout for mobility exercises.

ALTER TABLE zane_exercises
  ADD COLUMN IF NOT EXISTS movement_type text,
  ADD COLUMN IF NOT EXISTS no_weight_reps boolean DEFAULT false NOT NULL;

-- Backfill movement_type from the existing unilateral boolean.
UPDATE zane_exercises
SET movement_type = CASE WHEN unilateral = true THEN 'unilateral' ELSE 'bilateral' END
WHERE movement_type IS NULL;
