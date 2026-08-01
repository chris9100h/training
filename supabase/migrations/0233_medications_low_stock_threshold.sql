-- Per-medication override for the Running Low threshold, same idea as
-- zane_food_shopping_prefs.low_stock_threshold_g (migration 0232): some
-- medications get used up faster than one package lasts, so "below one
-- package" alone can fire too late. Nullable: null keeps the existing
-- default behavior (mdIsLowStock falls back to comparing against
-- package_size), a value here overrides it.
ALTER TABLE public.zane_medications
  ADD COLUMN low_stock_threshold numeric;
