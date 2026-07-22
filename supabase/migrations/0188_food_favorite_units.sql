-- Optional per-favorite unit size (e.g. "1 wrap = 62g"), so a favorite can be
-- relogged by count instead of typing grams. Null on both columns means no
-- unit is set, the favorite behaves exactly as before.
ALTER TABLE zane_food_favorites ADD COLUMN unit_label text;
ALTER TABLE zane_food_favorites ADD COLUMN unit_g numeric;
