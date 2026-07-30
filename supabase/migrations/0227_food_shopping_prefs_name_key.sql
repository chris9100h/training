-- Lets a Shopping List preference row (exclude/rename/package size/stock
-- tracking) exist for a food with no real food_id, not just ones matched to
-- a zane_foods cache row. Recipe-exploded ingredients and Custom Items never
-- carried a food_id (nothing stable to key a row on), and "Describe a meal"
-- (the AI free-text logger, screens-food.jsx's commitMealItems) writes every
-- item with foodId: null by design, an AI estimate is never a real product
-- match. With food_id NOT NULL as the sole identity, none of those foods
-- could ever be excluded from the list or renamed, the checkbox was
-- hard-disabled and the row un-tappable.
--
-- shopping_key mirrors the client's existing fdShoppingKey() format
-- ('id:<foodId>' for a real product, 'name:<normalized name>' otherwise),
-- the exact key fdBuildShoppingList already tallies demand under, so a
-- name-keyed pref row now matches its item the same way an id-keyed one
-- always has. It replaces food_id as the table's identity column: food_id
-- stays as an informational nullable reference (still FK'd, still cascades
-- when the product it points at is deleted), but uniqueness and the upsert
-- conflict target move to shopping_key so a single non-partial unique index
-- covers both cases.
--
-- Backfilled from the existing food_id for every current row (all of them
-- have one, food_id was NOT NULL until this migration).

ALTER TABLE public.zane_food_shopping_prefs
  ADD COLUMN shopping_key text;

UPDATE public.zane_food_shopping_prefs
SET shopping_key = 'id:' || food_id
WHERE shopping_key IS NULL;

ALTER TABLE public.zane_food_shopping_prefs
  ALTER COLUMN shopping_key SET NOT NULL,
  ALTER COLUMN food_id DROP NOT NULL;

ALTER TABLE public.zane_food_shopping_prefs
  DROP CONSTRAINT zane_food_shopping_prefs_user_id_food_id_key;

ALTER TABLE public.zane_food_shopping_prefs
  ADD CONSTRAINT zane_food_shopping_prefs_user_id_shopping_key_key UNIQUE (user_id, shopping_key);
