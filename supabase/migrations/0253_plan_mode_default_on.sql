-- Plan Mode (Food Tracker) becomes the default experience. It shipped as
-- opt-in in migration 0196 (zane_user_settings.plan_mode, NOT NULL DEFAULT
-- false).
--
-- Two statements, because a column default only governs rows created from
-- here on: every existing settings row already carries an explicit false, so
-- flipping the default alone would leave Plan Mode off for the entire current
-- user base forever.
--
-- The explicit false is also why the backfill is a product decision rather
-- than a recoverable migration: "deliberately switched it off" and "never
-- touched it" were never distinguishable in this column, so a user who had
-- opted out gets Plan Mode back and has to switch it off again under
-- Settings -> Health. Accepted deliberately.
--
-- No push side effect: the meal reminder cron selects on
-- meal_reminder_enabled AND plan_mode AND push_enabled (migration 0201), and
-- meal_reminder_enabled remains its own opt-in with a false default, so this
-- change starts no nudges on its own.
--
-- Food entries themselves are untouched: zane_food_logs.planned keeps its
-- false default, so no existing entry becomes planned retroactively and no
-- macro total, daily log or adherence score shifts because of this migration.

ALTER TABLE public.zane_user_settings
  ALTER COLUMN plan_mode SET DEFAULT true;

UPDATE public.zane_user_settings
  SET plan_mode = true
  WHERE plan_mode = false;
