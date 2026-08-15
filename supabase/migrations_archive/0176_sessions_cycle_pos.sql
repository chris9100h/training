-- cyclePos (a flex-plan session's absolute rotation position, e.g. the Nth
-- day ever trained on that plan) was never persisted: store.js's session
-- upload explicitly destructured it out of the write row. It only ever lived
-- in the local cache, so any full reload from Supabase (a cleared cache after
-- sign-out, a new device, ...) lost it, breaking the flex "was this rotation
-- slot completed" lookups in screens-home.jsx that match sessions by it.
-- Existing rows stay NULL (no retroactive backfill: reconstructing historical
-- rotation math for old sessions risks being wrong); the app falls back to a
-- dayId + most-recent heuristic for those, see screens-home.jsx.
ALTER TABLE zane_sessions
  ADD COLUMN IF NOT EXISTS cycle_pos integer;
