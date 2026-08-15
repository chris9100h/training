-- Medications tracker: a personal (optionally coach-managed) log/schedule/
-- inventory system for medications, vitamins and supplements, modeled closely
-- on the Food Tracker's Plan Mode (zane_food_meal_plans/zane_food_template_
-- slots/zane_food_logs) but with its own weekday-based schedule (not tied to
-- training/rest day type) and its own inventory unit (package_size/
-- stock_baseline in whatever unit_label the medication is counted in, not
-- always grams).
--
-- Four tables, same "container -> items -> schedule -> log" shape as food:
--   zane_medication_plans:          named container (e.g. "Vitamins",
--     "Prep cycle Q1"), is_template/coach_id is the coach bucket flag exactly
--     like zane_food_meal_plans (My Plans vs. Client Templates, a push copies
--     a template plan + its medications + their schedule slots into the
--     client's account). Unlike food, a user can have MANY plans live at
--     once (no single active_*_id pointer): medications for different
--     purposes (vitamins, supplements, a coach-prescribed cycle) commonly run
--     concurrently, not as alternatives you switch between.
--   zane_medications:               the tracked thing itself. category is a
--     free-text field (UI offers presets, no DB CHECK, so a new category
--     never needs a migration); package_size/stock_baseline/stock_set_at are
--     the same derived-inventory shape as zane_food_shopping_prefs (current
--     stock = baseline minus everything logged since stock_set_at, computed
--     client-side at read time, never a live-decremented counter, see
--     fdConsumedSince's own reasoning in screens-food.jsx for why: no hook
--     needed in every logging path, self-corrects if a log entry is later
--     edited or deleted). medication_plan_id is a SOFT reference (no FK,
--     nullable), mirroring zane_food_template_slots.meal_plan_id: plan/
--     medication are both client-diffed personal collections, a hard cascade
--     here could race the client's own sync diff.
--   zane_medication_schedule_slots: recurring weekly dose(s). weekdays is an
--     integer[] using this codebase's existing weekday convention (see
--     isoWd in store.js: 0=Mon..6=Sun), default every day, so "every day"
--     needs one row instead of seven. start_date/end_date are OPTIONAL date
--     bounds for a real time-phased cycle (e.g. week 1-4 at one dose, week
--     5-12 at another, each its own slot row); both null (the default) means
--     the slot runs unbounded, identical to today's only behavior. medication_
--     id IS a hard FK with CASCADE here (unlike medication_plan_id above): a
--     schedule slot has no independent lifecycle without its medication, and
--     deleting a medication should always take its schedule with it.
--   zane_medication_logs:           the actual intake timeline, mirrors
--     zane_food_logs exactly (planned/logged distinction, date/time as local
--     strings, medication_name copied at write time so a log entry survives
--     the medication being edited or deleted). medication_id uses ON DELETE
--     SET NULL like zane_food_logs.food_id: history survives, only the live
--     reference goes.
--
-- Coach access mirrors zane_food_meal_plans/zane_food_template_slots exactly
-- (zane_is_coach_of, migration 0199): full SELECT/INSERT/UPDATE/DELETE on all
-- four tables, not just what a coach personally pushed, so a coach can see a
-- client's complete medication list, schedule and actual logged adherence.

CREATE TABLE public.zane_medication_plans (
  id          text        PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  archived    boolean     NOT NULL DEFAULT false,
  is_template boolean     NOT NULL DEFAULT false,
  coach_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX zane_medication_plans_user_idx
  ON public.zane_medication_plans USING btree (user_id, created_at DESC);

ALTER TABLE public.zane_medication_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own medication plans" ON public.zane_medication_plans
  FOR ALL TO public USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "coach can read client medication plans" ON public.zane_medication_plans
  FOR SELECT TO public USING (zane_is_coach_of(user_id));
CREATE POLICY "coach can write client medication plans" ON public.zane_medication_plans
  FOR INSERT TO public WITH CHECK (zane_is_coach_of(user_id));
CREATE POLICY "coach can update client medication plans" ON public.zane_medication_plans
  FOR UPDATE TO public USING (zane_is_coach_of(user_id));
CREATE POLICY "coach can delete client medication plans" ON public.zane_medication_plans
  FOR DELETE TO public USING (zane_is_coach_of(user_id));

CREATE TABLE public.zane_medications (
  id                 text        PRIMARY KEY,
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  medication_plan_id text,                              -- soft reference, see header
  name               text        NOT NULL,
  brand              text,
  category           text,                              -- free text, UI presets only (vitamin/supplement/compound/other)
  unit_label         text        NOT NULL DEFAULT 'pills',
  package_size       numeric,
  stock_baseline     numeric,
  stock_set_at       timestamptz,
  archived           boolean     NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX zane_medications_user_idx ON public.zane_medications USING btree (user_id);
CREATE INDEX zane_medications_plan_idx ON public.zane_medications USING btree (medication_plan_id);

ALTER TABLE public.zane_medications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own medications" ON public.zane_medications
  FOR ALL TO public USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "coach can read client medications" ON public.zane_medications
  FOR SELECT TO public USING (zane_is_coach_of(user_id));
CREATE POLICY "coach can write client medications" ON public.zane_medications
  FOR INSERT TO public WITH CHECK (zane_is_coach_of(user_id));
CREATE POLICY "coach can update client medications" ON public.zane_medications
  FOR UPDATE TO public USING (zane_is_coach_of(user_id));
CREATE POLICY "coach can delete client medications" ON public.zane_medications
  FOR DELETE TO public USING (zane_is_coach_of(user_id));

CREATE TABLE public.zane_medication_schedule_slots (
  id            text        PRIMARY KEY,
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  medication_id text        NOT NULL REFERENCES public.zane_medications(id) ON DELETE CASCADE,
  weekdays      integer[]   NOT NULL DEFAULT '{0,1,2,3,4,5,6}',  -- 0=Mon..6=Sun, see isoWd in store.js
  hour          integer     NOT NULL DEFAULT 8,                 -- 0-23
  dose_qty      numeric     NOT NULL,
  active        boolean     NOT NULL DEFAULT true,
  start_date    date,                                           -- null = unbounded (default/simple case)
  end_date      date,                                           -- null = unbounded
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX zane_medication_schedule_slots_user_idx ON public.zane_medication_schedule_slots USING btree (user_id);
CREATE INDEX zane_medication_schedule_slots_med_idx ON public.zane_medication_schedule_slots USING btree (medication_id);

ALTER TABLE public.zane_medication_schedule_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own medication schedule slots" ON public.zane_medication_schedule_slots
  FOR ALL TO public USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "coach can read client medication schedule slots" ON public.zane_medication_schedule_slots
  FOR SELECT TO public USING (zane_is_coach_of(user_id));
CREATE POLICY "coach can write client medication schedule slots" ON public.zane_medication_schedule_slots
  FOR INSERT TO public WITH CHECK (zane_is_coach_of(user_id));
CREATE POLICY "coach can update client medication schedule slots" ON public.zane_medication_schedule_slots
  FOR UPDATE TO public USING (zane_is_coach_of(user_id));
CREATE POLICY "coach can delete client medication schedule slots" ON public.zane_medication_schedule_slots
  FOR DELETE TO public USING (zane_is_coach_of(user_id));

CREATE TABLE public.zane_medication_logs (
  id               text        PRIMARY KEY,
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  medication_id    text        REFERENCES public.zane_medications(id) ON DELETE SET NULL,
  medication_name  text        NOT NULL,           -- copied at write time
  date             text        NOT NULL,           -- YYYY-MM-DD (local day)
  time             text        NOT NULL,           -- HH:MM (local time)
  dose_qty         numeric     NOT NULL,
  planned          boolean     NOT NULL DEFAULT false,
  schedule_slot_id text        REFERENCES public.zane_medication_schedule_slots(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX zane_medication_logs_user_date ON public.zane_medication_logs USING btree (user_id, date DESC, "time" DESC);

ALTER TABLE public.zane_medication_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own medication logs" ON public.zane_medication_logs
  FOR ALL TO public USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "coach can read client medication logs" ON public.zane_medication_logs
  FOR SELECT TO public USING (zane_is_coach_of(user_id));
CREATE POLICY "coach can write client medication logs" ON public.zane_medication_logs
  FOR INSERT TO public WITH CHECK (zane_is_coach_of(user_id));
CREATE POLICY "coach can update client medication logs" ON public.zane_medication_logs
  FOR UPDATE TO public USING (zane_is_coach_of(user_id));
CREATE POLICY "coach can delete client medication logs" ON public.zane_medication_logs
  FOR DELETE TO public USING (zane_is_coach_of(user_id));

-- Feature master switch (Settings, default off: "not everyone wants to deal
-- with medications") and its own push-reminder opt-in, exactly the
-- meal_reminder_enabled/plan_mode shape (migration 0201).
ALTER TABLE public.zane_user_settings
  ADD COLUMN IF NOT EXISTS meds_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS medication_reminder_enabled boolean NOT NULL DEFAULT false;
