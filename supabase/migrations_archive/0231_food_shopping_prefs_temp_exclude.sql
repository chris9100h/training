-- Temporary "snooze" exclude for the Shopping List, distinct from the
-- existing permanent `excluded` flag: nullable timestamp, derived at read
-- time like stock_set_at (migration 0216), no cron needed. A food counts as
-- temporarily excluded while excluded_until is set and still in the future
-- (screens-food.jsx's fdApplyShoppingPrefs), and reverts to included on its
-- own once that passes, no manual re-toggle required.
ALTER TABLE public.zane_food_shopping_prefs
  ADD COLUMN excluded_until timestamptz;
