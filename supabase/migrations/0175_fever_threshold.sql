-- Threshold (Celsius) for the Health-tab "mark yourself Sick?" nudge shown
-- after logging a body temperature reading. Storage stays Celsius: it is
-- compared directly against zane_body_temp_logs.value_c, which is also
-- always Celsius. The Settings UI (Body Temperature sheet) converts it
-- live to/from the user's chosen temp_unit for display and input, then
-- converts back to Celsius on write.
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS fever_threshold_c numeric DEFAULT 38;
