-- Plan Mode meal templates: recurring "fixum" slots that auto-fill a day's
-- plan. One row per slot. A slot carries the same denormalized food/recipe
-- snapshot a food log entry does (so materializing a planned entry from it
-- needs no re-fetch), plus a fixed hour (0-23) and a day_type filter
-- ('any' | 'training' | 'rest'). Owner-only, like zane_food_favorites /
-- zane_food_recipes (a coach has no use for another user's personal template).

CREATE TABLE IF NOT EXISTS public.zane_food_template_slots (
  id           text        PRIMARY KEY,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_id      text,                                  -- nullable: custom items and recipes have none
  food_name    text        NOT NULL,
  brand        text,
  source       text,                                  -- 'off' | 'usda' | 'custom' | 'recipe' | null
  quantity_g   numeric     NOT NULL,
  calories     integer     NOT NULL,
  protein      numeric     NOT NULL,
  carbs        numeric     NOT NULL,
  fat          numeric     NOT NULL,
  fiber        numeric,
  recipe_items jsonb,                                 -- ingredient snapshot for a source:'recipe' slot, null otherwise
  recipe_id    text,                                  -- source recipe id for a recipe slot (soft ref, no FK: a deleted recipe must not drop the slot)
  logged_total_portions integer,                      -- recipe batch total at slot-creation time, recipe slots only
  hour         integer     NOT NULL DEFAULT 12,       -- 0-23, the fixed time the materialized planned entry lands at
  day_type     text        NOT NULL DEFAULT 'any',    -- 'any' | 'training' | 'rest'
  sort_idx     integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zane_food_template_slots_user_idx
  ON public.zane_food_template_slots USING btree (user_id, sort_idx);

ALTER TABLE public.zane_food_template_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zane_food_template_slots_own"
  ON public.zane_food_template_slots FOR ALL
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
