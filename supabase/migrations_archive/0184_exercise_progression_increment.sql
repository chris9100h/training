-- Per-exercise override for the weight-bump increment used by Smart
-- Progression and the Meso/Autoregulation weight-boost engine.
--
-- Both currently derive the increment purely from the exercise's equipment
-- category (zane_user_settings.equipment_config[equipment].increment, with
-- each call site falling back to its own hardcoded default when that's
-- unset), so two exercises sharing an equipment type are forced to the same
-- bump size. NULL (the default here) keeps that exact existing behavior;
-- a value overrides it for this one exercise specifically, ahead of the
-- equipment-category config. Store field progression_increment (exercises
-- keep raw snake_case field names, no camelCase mapping layer).
--
-- Must be strictly positive: the app's LB.incrementForExercise already
-- treats 0/negative as unset and falls through the chain (a step size of 0
-- or less would flip the sign convention the Meso earn/cut logic depends
-- on), the CHECK just keeps that same invariant enforced at the DB level.
ALTER TABLE zane_exercises
  ADD COLUMN IF NOT EXISTS progression_increment numeric
    CHECK (progression_increment IS NULL OR progression_increment > 0);
