-- Snapshot of the tracked food's own name/brand (like zane_food_logs/
-- zane_food_favorites already do), so a Shopping List preference row stays
-- identifiable on its own. Needed for the Inventory tab (screens-food.jsx):
-- it lists every food with stock tracking on, independent of
-- fdBuildShoppingList's staple/projection filter, so a bulk item that falls
-- out of the last-14-days staple window (or ages out of the loaded
-- zane_food_logs window entirely) still has a name to show there.
--
-- Backfilled from zane_foods (the existing food_id FK target) for every row
-- that predates this migration, the FK guarantees a match exists for all of
-- them. food_name is NOT NULL from here on: every future write goes through
-- fdSetShoppingPref (screens-food.jsx), which always passes it alongside any
-- real change, the same "copied at write time" principle as the rest of
-- this table (see stock_baseline_g/stock_set_at, migration 0216).

ALTER TABLE public.zane_food_shopping_prefs
  ADD COLUMN food_name text,
  ADD COLUMN brand text;

UPDATE public.zane_food_shopping_prefs p
SET food_name = f.name, brand = f.brand
FROM public.zane_foods f
WHERE f.id = p.food_id AND p.food_name IS NULL;

ALTER TABLE public.zane_food_shopping_prefs
  ALTER COLUMN food_name SET NOT NULL;
