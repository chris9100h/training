-- zane_food_recipes only had an owner-only policy, so pushMealPlanToClient's
-- recipe copy (INSERT as the coach, targeting the client's user_id) failed
-- RLS ("new row violates row level security policy"), and its own dedup read
-- against the client's existing recipes silently came back empty too. Same
-- coach-of-client policy set already added for zane_food_meal_plans and
-- zane_food_template_slots in migration 0199.

CREATE POLICY "coach can read client recipes"   ON public.zane_food_recipes FOR SELECT TO public USING (zane_is_coach_of(user_id));
CREATE POLICY "coach can write client recipes"  ON public.zane_food_recipes FOR INSERT TO public WITH CHECK (zane_is_coach_of(user_id));
CREATE POLICY "coach can update client recipes" ON public.zane_food_recipes FOR UPDATE TO public USING (zane_is_coach_of(user_id));
CREATE POLICY "coach can delete client recipes" ON public.zane_food_recipes FOR DELETE TO public USING (zane_is_coach_of(user_id));
