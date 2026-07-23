-- 0187's own-row RLS policies for zane_food_favorites and zane_food_recipes
-- used bare auth.uid(), unlike the sibling zane_food_logs policy from the
-- same day (0186), which already wraps it as (select auth.uid()) so Postgres
-- caches it once per query instead of re-evaluating per row
-- (auth_rls_initplan, same fix as 0126). ALTER POLICY is atomic, so there is
-- no window where either policy is absent.

ALTER POLICY "zane_food_favorites_own"
  ON zane_food_favorites
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "zane_food_recipes_own"
  ON zane_food_recipes
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
