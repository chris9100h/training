-- Migration 0139: per-exercise logging mode + opt-in bodyweight weight source
--
-- Supersedes the single no_weight_reps boolean with a three-way log_mode so a
-- plain (non-mobility) bodyweight movement can be logged reps-only, and adds an
-- explicit opt-in for pulling the user's logged bodyweight as the set weight
-- (previously implicit on equipment='bodyweight', which silently did nothing for
-- users who never log their weight).
--   log_mode: 'checkbox' (tick only) | 'reps' (reps, no weight) | 'weight' (both)
--   pull_bodyweight: only meaningful for equipment='bodyweight' + log_mode='weight'
-- no_weight_reps is kept and written in sync by the client (no_weight_reps =
-- log_mode <> 'weight') so older cached clients keep rendering these correctly.

ALTER TABLE zane_exercises
  ADD COLUMN IF NOT EXISTS log_mode text,
  ADD COLUMN IF NOT EXISTS pull_bodyweight boolean DEFAULT false NOT NULL;

-- Backfill from the legacy flag: reps-only exercises keep their reps behaviour.
UPDATE zane_exercises SET log_mode = CASE WHEN no_weight_reps THEN 'reps' ELSE 'weight' END
  WHERE log_mode IS NULL;

-- Preserve today's implicit auto-pull for existing bodyweight exercises.
UPDATE zane_exercises SET pull_bodyweight = true WHERE equipment = 'bodyweight';
