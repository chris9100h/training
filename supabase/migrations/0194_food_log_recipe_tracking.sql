-- Two review-found gaps in how a recipe-derived food log entry tracks its
-- source recipe:
--
-- recipe_id: entries resolved their live recipe back by NAME only
-- (recipeEntryLiveRecipe in screens-food.jsx), so two recipes sharing a
-- name silently routed an edit to the wrong one. Nullable: only set for
-- entries logged from a recipe, matches recipe_items' own "null for
-- non-recipe entries" convention. ON DELETE SET NULL: deleting the source
-- recipe must never cascade into deleting historical log entries, same
-- reasoning as food_id's own FK onto zane_foods.
--
-- logged_total_portions: recipe.portions at the moment this entry was
-- logged, needed so editing a full-batch entry later rescales against the
-- portion count that was actually true then, not whatever the recipe's
-- portions has since become (see openEditRecipeEntry). Was already
-- computed and set on the client object with no column to land in, so it
-- was silently dropped on every reload.
ALTER TABLE zane_food_logs
  ADD COLUMN recipe_id text REFERENCES zane_food_recipes(id) ON DELETE SET NULL,
  ADD COLUMN logged_total_portions integer;
