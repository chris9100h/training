-- A dose the user deliberately removed from the timeline had no way to stay
-- removed. Rows for a schedule slot are re-created by the medication-reminder
-- cron (and by the client's own auto-fill) from the slot definition, and both
-- decide "does a row exist for this slot on this date". A hard delete leaves no
-- trace, so the dose came straight back on the next run, with its reminder
-- counters reset, and could nudge the user again for something they had
-- explicitly taken off the list.
--
-- skipped is that trace: the row stays, so every "already materialised" check
-- keeps seeing it, while planned=false keeps it out of the reminder query and
-- out of the pending tallies. Deliberately distinct from planned=false alone,
-- which means "taken".
--
-- Only slot-materialised rows need this. A hand-logged dose carries no
-- schedule_slot_id, nothing re-creates it, and it is still hard-deleted.
ALTER TABLE public.zane_medication_logs
  ADD COLUMN IF NOT EXISTS skipped boolean NOT NULL DEFAULT false;
