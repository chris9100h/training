-- Lets a recipe be logged by cooked weight in grams instead of only by
-- portions: useful for batch cooking (a family pot, not neat individual
-- meal-prep boxes) where weighing out a serving is more natural than
-- guessing a portion fraction. cooked_weight_g is optional and freely typed
-- (never derived from the ingredient sum): water lost or gained during
-- cooking means the finished dish rarely weighs what its raw ingredients
-- did, the whole point of this field is to capture that actual number.
--
-- logged_cooked_grams/logged_cooked_weight_g on zane_food_logs and
-- zane_food_template_slots mirror the existing logged_total_portions
-- pattern: both null unless a batch was logged in grams mode, and both
-- frozen at log/slot-creation time so a later edit to the recipe's cooked
-- weight can never retroactively rescale a historical entry when it's
-- reopened for editing (same reasoning logged_total_portions already
-- documents for the portions case).

ALTER TABLE public.zane_food_recipes
  ADD COLUMN cooked_weight_g numeric;

ALTER TABLE public.zane_food_logs
  ADD COLUMN logged_cooked_grams numeric,
  ADD COLUMN logged_cooked_weight_g numeric;

ALTER TABLE public.zane_food_template_slots
  ADD COLUMN logged_cooked_grams numeric,
  ADD COLUMN logged_cooked_weight_g numeric;
