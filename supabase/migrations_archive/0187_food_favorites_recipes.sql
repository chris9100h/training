-- Food Tracker quick-add: favorites and recipes, both owned collections
-- (mirrors zane_workout_templates/zane_cardio_plans: simple per-user list,
-- boot-loaded + synced whole, no coach visibility, not part of the Health
-- tab's live-refresh polling).
--
-- zane_food_favorites: a user-starred food, snapshotted the same shape as a
--   zane_food_logs row (minus date/time). Re-adding one derives a per-100g
--   rate from quantity_g the same way the client already does for the
--   Recent strip (rate = value / quantity_g * 100), so a favorite is still
--   scalable to a different amount, not locked to the amount it was
--   favorited at.
-- zane_food_recipes: a named list of ingredients (each shaped like a food
--   log entry) a user logs together in one tap. items is a jsonb snapshot,
--   not a child table, same "structured content as jsonb" pattern this app
--   already uses for e.g. zane_schedules' days/exercises and
--   zane_workout_templates.exercises.

CREATE TABLE public.zane_food_favorites (
  id          text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_id     text REFERENCES public.zane_foods(id) ON DELETE SET NULL,  -- null for a favorited Custom Item
  food_name   text NOT NULL,
  brand       text,
  source      text,                    -- 'off' | 'usda' | 'custom' | null
  quantity_g  numeric NOT NULL,
  calories    integer NOT NULL,
  protein     numeric NOT NULL,
  carbs       numeric NOT NULL,
  fat         numeric NOT NULL,
  fiber       numeric,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX zane_food_favorites_user_idx ON public.zane_food_favorites (user_id, created_at DESC);

ALTER TABLE zane_food_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zane_food_favorites_own"
  ON zane_food_favorites FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.zane_food_recipes (
  id          text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  items       jsonb NOT NULL DEFAULT '[]',   -- [{ foodId, foodName, brand, source, quantityG, calories, protein, carbs, fat, fiber }, ...]
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX zane_food_recipes_user_idx ON public.zane_food_recipes (user_id, created_at DESC);

ALTER TABLE zane_food_recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zane_food_recipes_own"
  ON zane_food_recipes FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
