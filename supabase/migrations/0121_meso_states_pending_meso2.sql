-- Add pending_meso2 flag to zane_meso_states.
-- Set when a mesocycle completes and the user has chosen to start a deload first;
-- cleared when the user responds to the "Start Meso 2?" prompt after the deload ends.
ALTER TABLE zane_meso_states ADD COLUMN IF NOT EXISTS pending_meso2 boolean DEFAULT false;
