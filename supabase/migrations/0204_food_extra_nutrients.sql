-- Sugar, saturated fat and sodium alongside the existing protein/carbs/fat/
-- fiber. Both nutrition sources already ship these values in the very same
-- response the search-foods Edge Function reads today (Open Food Facts:
-- sugars_100g, saturated-fat_100g, sodium_100g; USDA FoodData Central:
-- nutrient numbers 269, 606 and 307), they were simply never mapped, and the
-- label-scan prompt never asked for them although they sit on every nutrition
-- label being photographed.
--
-- Retroactive capture is impossible: zane_food_logs is denormalized at write
-- time on purpose (a later cache refresh must never rewrite history), so every
-- entry logged without these columns stays blind to them forever. Hence the
-- columns land on every table that carries such a write-time snapshot, not
-- just on the shared cache:
--   zane_foods                 the shared reference cache (per 100 g)
--   zane_food_logs             the actual entries (already scaled)
--   zane_food_favorites        re-added later, must not lose the values
--   zane_food_template_slots   materialized into planned entries
-- zane_food_recipes.items is jsonb and needs no DDL, its items grow the same
-- three keys.
--
-- All nullable with no default: null means "not known for this food", which is
-- the honest state for everything logged so far and for any source that does
-- not report a given value. Sodium is stored in MILLIGRAMS (the unit labels
-- print and the unit a user thinks in), unlike Open Food Facts, which reports
-- sodium in grams: the Edge Function converts.

alter table zane_foods
  add column sugar_per_100g     numeric,
  add column sat_fat_per_100g   numeric,
  add column sodium_mg_per_100g numeric;

comment on column zane_foods.sugar_per_100g is
  'Sugars per 100 g/ml, null when the source does not report it.';
comment on column zane_foods.sat_fat_per_100g is
  'Saturated fat per 100 g/ml, null when the source does not report it.';
comment on column zane_foods.sodium_mg_per_100g is
  'Sodium per 100 g/ml in milligrams (Open Food Facts reports grams, the Edge Function converts), null when the source does not report it.';

alter table zane_food_logs
  add column sugar     numeric,
  add column sat_fat   numeric,
  add column sodium_mg numeric;

comment on column zane_food_logs.sugar is
  'Sugars for the logged amount, copied at write time. Null for entries logged before this column existed or for foods without the value.';
comment on column zane_food_logs.sat_fat is
  'Saturated fat for the logged amount, copied at write time. Null when unknown.';
comment on column zane_food_logs.sodium_mg is
  'Sodium in milligrams for the logged amount, copied at write time. Null when unknown.';

alter table zane_food_favorites
  add column sugar     numeric,
  add column sat_fat   numeric,
  add column sodium_mg numeric;

comment on column zane_food_favorites.sugar is
  'Sugars at the quantity the food was favorited at, rescaled like every other macro on re-add. Null when unknown.';
comment on column zane_food_favorites.sat_fat is
  'Saturated fat at the quantity the food was favorited at. Null when unknown.';
comment on column zane_food_favorites.sodium_mg is
  'Sodium in milligrams at the quantity the food was favorited at. Null when unknown.';

alter table zane_food_template_slots
  add column sugar     numeric,
  add column sat_fat   numeric,
  add column sodium_mg numeric;

comment on column zane_food_template_slots.sugar is
  'Sugars for the slot amount, carried into the planned entry it materializes. Null when unknown.';
comment on column zane_food_template_slots.sat_fat is
  'Saturated fat for the slot amount, carried into the planned entry. Null when unknown.';
comment on column zane_food_template_slots.sodium_mg is
  'Sodium in milligrams for the slot amount, carried into the planned entry. Null when unknown.';
