-- Intensity techniques on sets: drop sets, rest-pause, myo-reps.
-- technique: identifies the technique used ('drop' | 'rest_pause' | 'myorep').
-- drops: for drop sets, stores the full sequence [{kg, reps}, ...].
--   drops[0].kg / drops[0].reps mirror the top-level kg / reps columns so
--   progression seeds always use the heaviest / first drop.
ALTER TABLE zane_sets ADD COLUMN IF NOT EXISTS technique TEXT;
ALTER TABLE zane_sets ADD COLUMN IF NOT EXISTS drops JSONB;
