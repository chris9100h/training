-- Food Tracker: optional display toggle to hide the meal-category header
-- cards (Breakfast/Lunch/...) in the daily timeline, showing a single
-- continuous hour 0-23 timeline instead. Purely cosmetic: categories stay the
-- underlying grouping for "Repeat yesterday" and Manage Entries regardless,
-- and every hour (filled or empty) still renders with its own "+", same as
-- today, so Plan Mode's tap-an-empty-hour-to-plan workflow is unaffected.
alter table zane_user_settings
  add column hide_food_categories boolean not null default false;

comment on column zane_user_settings.hide_food_categories is
  'Food Tracker: hide the meal-category header cards in the daily timeline, show a flat hour 0-23 list instead. Display-only, off by default.';
