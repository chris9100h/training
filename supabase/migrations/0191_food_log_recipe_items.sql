-- A recipe logged to zane_food_logs only ever stored the summed totals
-- (name/quantity/calories/macros), never which ingredients made it up, so
-- the timeline had nothing to expand. Snapshot the ingredient breakdown at
-- log time (scaled to the portions actually logged), same "copy at write
-- time" principle as the rest of this table: editing the source recipe
-- later must never retroactively change what a past entry shows it was.
-- Shape: [{ foodName, quantityG, calories, protein, carbs, fat, fiber }].
-- Null for every non-recipe entry.
ALTER TABLE zane_food_logs ADD COLUMN recipe_items jsonb;
