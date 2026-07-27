-- Per-food Shopping List preferences, synced across devices (previously
-- logbook-shopping-name-overrides/logbook-shopping-exclusions, both
-- localStorage-only and device-local). One row per (user, food) holds
-- everything a user has customized about that food's shopping-list
-- appearance: a display-name override (e.g. "Original" -> "Weetabix
-- Original"), an exclude flag ("I buy this in bulk elsewhere, don't put it
-- on my grocery-run list"), and a package size in grams so the list can
-- round the buy quantity up to whole packages instead of a raw gram
-- estimate. All three are optional and independent; a row with all three
-- unset has no reason to exist, the client deletes it rather than leaving a
-- no-op row behind.
--
-- Simple owned collection, same shape as zane_food_favorites/
-- zane_food_recipes: no coach access, not part of any live-polling surface.

CREATE TABLE public.zane_food_shopping_prefs (
  id              text PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_id         text NOT NULL REFERENCES public.zane_foods(id) ON DELETE CASCADE,
  name_override   text,
  excluded        boolean NOT NULL DEFAULT false,
  package_size_g  numeric,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, food_id)
);

CREATE INDEX zane_food_shopping_prefs_user_idx ON public.zane_food_shopping_prefs (user_id);

ALTER TABLE zane_food_shopping_prefs ENABLE ROW LEVEL SECURITY;

-- (select auth.uid()) wrapping from the start (not the bare form 0187 used
-- and 0192 later had to fix), so Postgres caches it once per query instead
-- of re-evaluating per row (auth_rls_initplan).
CREATE POLICY "zane_food_shopping_prefs_own"
  ON zane_food_shopping_prefs FOR ALL
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
