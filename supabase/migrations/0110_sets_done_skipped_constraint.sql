-- Fix existing rows where both done=true and skipped=true exist simultaneously
-- (DB inconsistency from sync races). done=true is authoritative: clear skipped.
UPDATE zane_sets
SET skipped = false
WHERE done = true AND skipped = true;

-- Prevent future inconsistency: a set cannot be both done and skipped.
ALTER TABLE zane_sets
  ADD CONSTRAINT check_not_done_and_skipped
  CHECK (NOT (done AND skipped));
