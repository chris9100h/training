-- Allow 'deload' as a valid value in the status_mode CHECK constraints.
-- Migration 0082 added status_mode with CHECK IN ('sick', 'vacation');
-- Migration 0083 added zane_status_periods.mode with the same constraint.
-- Migration 0108 introduced 'deload' as a third mode but forgot to update
-- these constraints, causing every startDeload/openStatusPeriod write to fail
-- with a constraint violation (red DB indicator in the app).

ALTER TABLE zane_user_settings
  DROP CONSTRAINT IF EXISTS zane_user_settings_status_mode_check;

ALTER TABLE zane_user_settings
  ADD CONSTRAINT zane_user_settings_status_mode_check
    CHECK (status_mode IN ('sick', 'vacation', 'deload'));

ALTER TABLE zane_status_periods
  DROP CONSTRAINT IF EXISTS zane_status_periods_mode_check;

ALTER TABLE zane_status_periods
  ADD CONSTRAINT zane_status_periods_mode_check
    CHECK (mode IN ('sick', 'vacation', 'deload'));
