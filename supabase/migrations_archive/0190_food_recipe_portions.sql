-- A recipe's items are the whole batch as cooked; portions says how many
-- servings that batch splits into. Adding a recipe to the log now asks how
-- many of those portions to log (1 by default), scaling the batch totals
-- down accordingly instead of always logging the entire batch as one entry.
ALTER TABLE zane_food_recipes ADD COLUMN portions integer NOT NULL DEFAULT 1;
