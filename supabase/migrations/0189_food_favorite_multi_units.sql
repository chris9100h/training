-- Replaces the single unit_label/unit_g pair (migration 0188) with a jsonb
-- array so a favorite can carry more than one unit (e.g. "Pc" = 62g AND
-- "Pack" = 500g), and the quantity sheet can offer a picker instead of
-- fixed 1x-4x presets for a single unit.
ALTER TABLE zane_food_favorites ADD COLUMN units jsonb NOT NULL DEFAULT '[]';

UPDATE zane_food_favorites
SET units = jsonb_build_array(jsonb_build_object('label', unit_label, 'grams', unit_g))
WHERE unit_label IS NOT NULL AND unit_g IS NOT NULL;

ALTER TABLE zane_food_favorites DROP COLUMN unit_label;
ALTER TABLE zane_food_favorites DROP COLUMN unit_g;
