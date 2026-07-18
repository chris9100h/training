-- Threshold (Celsius) for the Health-tab "mark yourself Sick?" nudge shown
-- after logging a body temperature reading. Stays in Celsius: it is compared
-- directly against zane_body_temp_logs.value_c, which is also always Celsius.
-- The Settings UI always edits/shows it in Celsius too, regardless of the
-- user's chosen temp_unit display preference (kept simple: one canonical
-- unit for this admin-style threshold, no round-trip conversion drift).
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS fever_threshold_c numeric DEFAULT 38;
