-- Multiple named meal plans (Plan Mode), mirroring zane_schedules: a user has
-- many, exactly one active (zane_user_settings.active_meal_template_id, a
-- scalar pointer like active_schedule_id, never a per-row flag). is_template is
-- the coach-side bucket flag (My Plans / Client Templates); coach_id attributes
-- a coach-authored/pushed plan. The existing flat template slots are backfilled
-- into one default plan per user, so plan mode keeps working unchanged.

CREATE TABLE IF NOT EXISTS public.zane_food_meal_plans (
  id          text        PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  archived    boolean     NOT NULL DEFAULT false,
  is_template boolean     NOT NULL DEFAULT false,
  coach_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zane_food_meal_plans_user_idx
  ON public.zane_food_meal_plans USING btree (user_id, created_at DESC);

ALTER TABLE public.zane_food_meal_plans ENABLE ROW LEVEL SECURITY;

-- Own + coach-of-client policies, mirroring zane_schedules exactly.
CREATE POLICY "own meal plans"                ON public.zane_food_meal_plans FOR ALL    TO public USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "coach can read client meal plans"   ON public.zane_food_meal_plans FOR SELECT TO public USING (zane_is_coach_of(user_id));
CREATE POLICY "coach can write client meal plans"  ON public.zane_food_meal_plans FOR INSERT TO public WITH CHECK (zane_is_coach_of(user_id));
CREATE POLICY "coach can update client meal plans" ON public.zane_food_meal_plans FOR UPDATE TO public USING (zane_is_coach_of(user_id));
CREATE POLICY "coach can delete client meal plans" ON public.zane_food_meal_plans FOR DELETE TO public USING (zane_is_coach_of(user_id));

-- Slots belong to a plan. Soft reference (no FK): slot cleanup is client-managed
-- like the rest of the store, which avoids cross-table cascade races with the
-- sync diff.
ALTER TABLE public.zane_food_template_slots ADD COLUMN IF NOT EXISTS meal_plan_id text;

-- Coaches also read/write a client's slots (a push copies a plan AND its slots
-- into the client's account). The slot table only had an owner policy before.
CREATE POLICY "coach can read client meal slots"   ON public.zane_food_template_slots FOR SELECT TO public USING (zane_is_coach_of(user_id));
CREATE POLICY "coach can write client meal slots"  ON public.zane_food_template_slots FOR INSERT TO public WITH CHECK (zane_is_coach_of(user_id));
CREATE POLICY "coach can update client meal slots" ON public.zane_food_template_slots FOR UPDATE TO public USING (zane_is_coach_of(user_id));
CREATE POLICY "coach can delete client meal slots" ON public.zane_food_template_slots FOR DELETE TO public USING (zane_is_coach_of(user_id));

-- Active meal plan pointer, mirroring active_schedule_id.
ALTER TABLE public.zane_user_settings ADD COLUMN IF NOT EXISTS active_meal_template_id text;

-- Backfill: wrap each user's existing flat slots into one default plan
-- ('mp_<user_id>', deterministic), point the slots at it, and make it active.
INSERT INTO public.zane_food_meal_plans (id, user_id, name)
  SELECT 'mp_' || u.user_id::text, u.user_id, 'My meals'
  FROM (SELECT DISTINCT user_id FROM public.zane_food_template_slots WHERE meal_plan_id IS NULL) u
  ON CONFLICT (id) DO NOTHING;

UPDATE public.zane_food_template_slots
  SET meal_plan_id = 'mp_' || user_id::text
  WHERE meal_plan_id IS NULL;

UPDATE public.zane_user_settings s
  SET active_meal_template_id = 'mp_' || s.user_id::text
  WHERE s.active_meal_template_id IS NULL
    AND EXISTS (SELECT 1 FROM public.zane_food_template_slots t WHERE t.user_id = s.user_id);
