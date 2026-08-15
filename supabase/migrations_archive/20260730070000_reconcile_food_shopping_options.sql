-- Migrations 0231/0232 were applied manually and follow the recorded 0227
-- shopping-key migration.
ALTER TABLE public.zane_food_shopping_prefs
  ADD COLUMN IF NOT EXISTS excluded_until timestamptz,
  ADD COLUMN IF NOT EXISTS low_stock_threshold_g numeric;
