-- 0179_watermark_opacity.sql
-- User-controlled opacity override for the home-screen watermark (the
-- default ZANE logo, or an admin-assigned VIP background image). NULL
-- (the default, no existing user is affected on deploy) means "use the
-- app's built-in per-theme/per-image defaults", exactly today's behavior
-- (0.04 dark / 0.14 light for the logo, flat 0.16 for a VIP image, all
-- hardcoded in screens-home.jsx). A non-null value (0-100, a percentage)
-- is an explicit flat override applied to whichever image is showing,
-- regardless of theme, set via the Appearance sheet's slider.
ALTER TABLE zane_user_settings ADD COLUMN watermark_opacity integer;
