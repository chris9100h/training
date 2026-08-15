-- User-defined clock boundaries for the Food Tracker's meal categories
-- (Breakfast / Snack 1 / Lunch / Snack 2 / Dinner / Snack 3). They were hard
-- coded at 0-9 / 9-11 / 11-13 / 13-16 / 16-20 / 20-24, which is a guess about
-- when people eat: shift work, a late-eating household or any intermittent
-- fasting window puts "Breakfast" over meals nobody would call breakfast. Those
-- categories drive the timeline's grouping and the Manage-entries sheet, so a
-- bad fit is visible on every single day.
--
-- Stored as the six START hours in order, e.g. the previous fixed default
--   [0, 9, 11, 13, 16, 20]
-- Each category runs from its own start up to the next one's, the last to 24.
-- The first entry is always 0 so the day is covered with no gap. Six numbers
-- rather than six {start,end} pairs precisely so an overlap or a hole cannot be
-- represented at all.
--
-- null = use the built-in defaults, which is what every existing row means and
-- what a user who never touches this keeps meaning.

alter table zane_user_settings
  add column meal_windows jsonb;

comment on column zane_user_settings.meal_windows is
  'Six ascending start hours (0-23) for the food tracker meal categories, first always 0; each runs to the next start, the last to 24. Null = built-in defaults.';
