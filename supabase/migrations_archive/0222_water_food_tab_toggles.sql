-- Health, Water, Food and Medications used to share one bundled visibility
-- switch (show_health_tab, plus meds_enabled separately for Medications):
-- turning Health on always meant Water and Food came along too. This splits
-- Water and Food into their own independent switches, matching the pattern
-- meds_enabled already established, so any combination of the four can be
-- shown or hidden on its own.
--
-- Existing users who already had show_health_tab on relied on that single
-- switch to mean Water and Food were visible too (they always were, bundled
-- together): backfill both new columns to true wherever show_health_tab is
-- currently true, so nobody's visible tabs silently disappear the moment
-- this ships. New signups default both to false, the same opt-in posture
-- show_health_tab itself already has.
ALTER TABLE zane_user_settings ADD COLUMN show_water_tab boolean NOT NULL DEFAULT false;
ALTER TABLE zane_user_settings ADD COLUMN show_food_tab boolean NOT NULL DEFAULT false;

UPDATE zane_user_settings SET show_water_tab = true, show_food_tab = true WHERE show_health_tab = true;
