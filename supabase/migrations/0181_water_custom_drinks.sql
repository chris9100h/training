-- Water tracker config: user-configurable "other drinks" plus the bottle tracker.
--
-- water_drinks: up to 6 entries the user defines themselves (name + ml), shown as
--   one-tap add buttons on the Water screen. jsonb array [{ name, ml }, ...]. No
--   presets, default none. Store field waterDrinks.
-- water_bottle_enabled / water_bottle_ml: the "current bottle" counter is now
--   switchable and its size configurable (default on, 1500 ml). Store fields
--   waterBottleEnabled / waterBottleMl.
-- water_coffee_sizes: the coffee button stays a preset (size + milk flow), but
--   its size options are user-configurable, jsonb array [{ label, ml }, ...].
--   Null falls back to the built-in defaults in the client. Store waterCoffeeSizes.
-- All wired through the four settings touchpoints in store.js.
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS water_drinks jsonb;
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS water_bottle_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS water_bottle_ml integer DEFAULT 1500;
ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS water_coffee_sizes jsonb;
