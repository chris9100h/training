-- Plan Mode (Food Tracker): opt-in per user (zane_user_settings.plan_mode,
-- off by default). When on, a food log entry can be "planned" (sitting in the
-- day's timeline but not yet eaten) rather than "logged". A planned entry does
-- NOT count toward the day's macro totals, the daily log, coaching targets, or
-- adherence until it is checked off (planned -> logged). Existing rows have no
-- planned flag -> default false -> logged, so all current data is unchanged.

ALTER TABLE public.zane_user_settings
  ADD COLUMN IF NOT EXISTS plan_mode boolean NOT NULL DEFAULT false;

ALTER TABLE public.zane_food_logs
  ADD COLUMN IF NOT EXISTS planned boolean NOT NULL DEFAULT false;

-- Soft back-reference to the template slot a planned entry was materialized
-- from (zane_food_template_slots, added in a later migration for the templates
-- layer), used to avoid re-materializing the same slot twice on a given day.
-- Deliberately a plain text column, not a foreign key: the reference is
-- advisory (a deleted slot must not cascade-delete or block already-planned
-- entries), and this keeps the two tables order-independent.
ALTER TABLE public.zane_food_logs
  ADD COLUMN IF NOT EXISTS template_slot_id text;
