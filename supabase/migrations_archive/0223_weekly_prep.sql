-- Weekly Prep: a pillbox-packing checklist for Medications. Lets a user
-- define their own physical pillbox compartments (e.g. Morning/Evening, or
-- Morning/Noon/Evening, arbitrary count) and see, for the coming week, what
-- needs to go in each one, derived entirely from existing schedule slots.
--
-- pillbox_slots: user-defined compartments, jsonb array of
-- { id, label, startHour, endHour }, same "small user-managed config array"
-- shape as water_drinks/water_coffee_sizes (migration 0181). Null/empty until
-- the user configures it.
ALTER TABLE public.zane_user_settings
  ADD COLUMN pillbox_slots jsonb;

-- exclude_from_pillbox: per-medication flag for anything that never goes in
-- a physical pill organizer (an injectable, for instance). zane_medications
-- is already a per-user owned table (unlike zane_foods), so a direct column
-- is simpler than a separate prefs table.
ALTER TABLE public.zane_medications
  ADD COLUMN exclude_from_pillbox boolean NOT NULL DEFAULT false;

-- zane_medication_pillbox_checks: which (date, schedule slot) pairs have
-- already been packed this week, cross-device. Deterministic id
-- (<user_id>_<date>_<schedule_slot_id>) so two devices checking the same box
-- upsert the same row instead of racing in duplicates; unchecking deletes
-- the row, existence = packed, no update path ever needed. schedule_slot_id
-- is a SOFT reference (no FK): both this table and
-- zane_medication_schedule_slots are client-diffed personal collections, a
-- hard cascade here could race the client's own sync diff (same reasoning
-- medication_plan_id already uses elsewhere in this table family). Own-
-- rows-only RLS, unlike the other five Medications tables: packing your own
-- pillbox isn't something a coach needs to see or edit, so no
-- zane_guard_user_id_immutable trigger either, that trigger only matters
-- where a coach's own UPDATE policy exists (see migration 0220's header),
-- which this table deliberately has none of. Derived per-week state, not
-- durable user content: synced but excluded from the personal-data backup,
-- same as zane_food_template_days (migration 0198).
CREATE TABLE public.zane_medication_pillbox_checks (
  id               text        PRIMARY KEY,
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date             text        NOT NULL,  -- YYYY-MM-DD
  schedule_slot_id text        NOT NULL,  -- soft reference, see header
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX zane_medication_pillbox_checks_user_idx
  ON public.zane_medication_pillbox_checks USING btree (user_id, date);

ALTER TABLE public.zane_medication_pillbox_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zane_medication_pillbox_checks_own"
  ON public.zane_medication_pillbox_checks FOR ALL
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
