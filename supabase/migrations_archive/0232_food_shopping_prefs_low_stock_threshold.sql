-- Per-food override for the Running Low threshold, distinct from
-- package_size_g (migration 0216's default comparison). Some foods get
-- eaten through faster than one package lasts (a 500g tub of skyr going
-- down in a single day), so "below one package" alone fires too late to be
-- a useful heads-up. Nullable: null keeps the existing default behavior
-- (fdIsLowStock falls back to comparing against package_size_g), a value
-- here overrides it.
ALTER TABLE public.zane_food_shopping_prefs
  ADD COLUMN low_stock_threshold_g numeric;
