-- Cleanup Week (overlay model, sibling of the deload overlay from 0108/0109).
-- A deliberate technique-rebuild week: loads seed at (100 - cleanup_percent)%
-- instead of a deload's fixed 50%, and unlike a deload the reduced weights DO
-- feed the seed chain, so the following week builds back up from them.
--
-- Reuses the existing status_mode mechanism (text column on zane_user_settings
-- + zane_status_periods history) with a fourth 'cleanup' value alongside
-- 'sick'/'vacation'/'deload'.
--
-- The CHECK constraints below are the whole reason this is one migration
-- rather than two: 0108 added 'deload' and forgot them, so every
-- startDeload/openStatusPeriod write failed with a constraint violation until
-- 0109 patched it. Adding the value and widening the constraints together is
-- what keeps that from repeating.

-- How much a cleanup week takes off the last logged load, in percent
-- (clamped 10-30 in the UI, default 20). Persists across activations so the
-- next cleanup starts from the user's last choice. Store field: cleanupPercent.
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS cleanup_percent integer NOT NULL DEFAULT 20;

-- Marks a session logged during a cleanup week. Deliberately NOT a mirror of
-- is_deload's effects: a cleanup session stays a full-signal exposure (so the
-- overreach detector's baseline moves down with it and the rebuild weeks don't
-- read as a regression) and stays in the seed chain. The flag exists to keep
-- the week out of earn/cut, PR baselines and stall detection.
-- Store field: isCleanup (stripped from the row when false on sync).
ALTER TABLE zane_sessions
  ADD COLUMN IF NOT EXISTS is_cleanup boolean NOT NULL DEFAULT false;

ALTER TABLE zane_user_settings
  DROP CONSTRAINT IF EXISTS zane_user_settings_status_mode_check;

ALTER TABLE zane_user_settings
  ADD CONSTRAINT zane_user_settings_status_mode_check
    CHECK (status_mode IN ('sick', 'vacation', 'deload', 'cleanup'));

ALTER TABLE zane_status_periods
  DROP CONSTRAINT IF EXISTS zane_status_periods_mode_check;

ALTER TABLE zane_status_periods
  ADD CONSTRAINT zane_status_periods_mode_check
    CHECK (mode IN ('sick', 'vacation', 'deload', 'cleanup'));
