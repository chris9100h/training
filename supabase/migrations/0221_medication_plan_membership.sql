-- Multi-plan medication membership. Before this migration, a medication
-- belonged to at most one plan (zane_medications.medication_plan_id, a
-- single nullable scalar) and its schedule slots belonged only to the
-- medication, never to a plan. That breaks the "coach plans your cycle"
-- case: the same physical medication (one shared stock/inventory row) needs
-- to run under the user's own ongoing plan AND a coach-prescribed cycle
-- plan at the same time, each with its OWN dose/timing.
--
-- New shape:
--   zane_medication_plan_items: pure membership join (medication <-> plan,
--     no schedule info), many-to-many. medication_id is a hard FK (a
--     membership row has no life without its medication, same reasoning
--     zane_medication_schedule_slots.medication_id already uses);
--     medication_plan_id is a SOFT reference (no FK), same reasoning
--     zane_medications.medication_plan_id used before this migration: both
--     are client-diffed personal collections, a hard cascade here could
--     race the client's own sync diff.
--   zane_medication_schedule_slots gains its own medication_plan_id (soft
--     reference): a schedule slot is now scoped to one specific
--     (medication, plan) pair, which is what makes a per-plan-distinct
--     schedule for the same medication possible. zane_medications loses
--     medication_plan_id entirely: a medication is now pure identity +
--     inventory, zero plan awareness, all membership lives in the join
--     table.
--   zane_medication_plans gains "active" (default true, existing/new plans
--     unaffected): plans now have a real, user-facing on/off switch,
--     multiple can be active at once by design (this refines, it does not
--     reverse, the "no single active pointer, plans run concurrently"
--     principle this table already documented). Only an active plan's
--     schedule slots fire.
--
-- Also drops zane_medication_schedule_slots.active: a separate, unrelated
-- request in the same conversation to remove the per-slot pause toggle
-- (found confusing) in favor of "remove the medication from the plan"
-- being the only way to stop a dose. mdSlotAppliesOn (screens-medications.
-- jsx) now gates on the slot's plan being active instead.
--
-- Migration order matters: the two backfills (plan_items from medications,
-- slots.medication_plan_id from medications) must run before dropping
-- zane_medications.medication_plan_id, since they read it.

ALTER TABLE public.zane_medication_plans
  ADD COLUMN active boolean NOT NULL DEFAULT true;

CREATE TABLE public.zane_medication_plan_items (
  id                 text        PRIMARY KEY,
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  medication_plan_id text        NOT NULL,  -- soft reference, see header
  medication_id      text        NOT NULL REFERENCES public.zane_medications(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (medication_id, medication_plan_id)
);

CREATE INDEX zane_medication_plan_items_user_idx ON public.zane_medication_plan_items USING btree (user_id);
CREATE INDEX zane_medication_plan_items_plan_idx ON public.zane_medication_plan_items USING btree (medication_plan_id);
CREATE INDEX zane_medication_plan_items_med_idx  ON public.zane_medication_plan_items USING btree (medication_id);

ALTER TABLE public.zane_medication_plan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own medication plan items" ON public.zane_medication_plan_items
  FOR ALL TO public USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "coach can read client medication plan items" ON public.zane_medication_plan_items
  FOR SELECT TO public USING (zane_is_coach_of(user_id));
CREATE POLICY "coach can write client medication plan items" ON public.zane_medication_plan_items
  FOR INSERT TO public WITH CHECK (zane_is_coach_of(user_id));
CREATE POLICY "coach can update client medication plan items" ON public.zane_medication_plan_items
  FOR UPDATE TO public USING (zane_is_coach_of(user_id));
CREATE POLICY "coach can delete client medication plan items" ON public.zane_medication_plan_items
  FOR DELETE TO public USING (zane_is_coach_of(user_id));

DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_medication_plan_items;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_medication_plan_items
  FOR EACH ROW EXECUTE FUNCTION zane_guard_user_id_immutable();

ALTER TABLE public.zane_medication_schedule_slots
  ADD COLUMN medication_plan_id text;  -- soft reference, nullable, see header

-- Backfill membership rows from the about-to-be-dropped scalar.
INSERT INTO public.zane_medication_plan_items (id, user_id, medication_plan_id, medication_id)
SELECT gen_random_uuid()::text, user_id, medication_plan_id, id
FROM public.zane_medications
WHERE medication_plan_id IS NOT NULL;

-- Backfill each slot's plan from its medication's (about-to-be-dropped)
-- scalar. A slot whose medication currently has no plan keeps NULL here:
-- unreachable/dormant either way, no real production rows exist yet
-- (unreleased feature).
UPDATE public.zane_medication_schedule_slots s
SET medication_plan_id = m.medication_plan_id
FROM public.zane_medications m
WHERE m.id = s.medication_id;

ALTER TABLE public.zane_medications DROP COLUMN medication_plan_id;
ALTER TABLE public.zane_medication_schedule_slots DROP COLUMN active;
