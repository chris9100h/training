-- Fix: exercises where no set was ever confirmed (done=false for all) but seeds
-- have kg/reps from the previous session get their sets marked as skipped=true.
-- These were saved before the finish() client fix that now auto-marks such sets
-- on session close. Matches the same hasDone=false logic: if no set in an entry
-- has done=true, the exercise was never started — seed values are not real data.
UPDATE zane_sets st
SET skipped = true
WHERE st.skipped = false
  AND st.warmup = false
  AND st.done = false
  AND (st.kg IS NOT NULL
    OR st.reps IS NOT NULL
    OR st.reps_l IS NOT NULL
    OR st.reps_r IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM zane_sets st2
    WHERE st2.entry_id = st.entry_id
      AND st2.done = true
  );
