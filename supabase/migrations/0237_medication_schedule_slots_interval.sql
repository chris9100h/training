-- Interval-based recurrence for a medication schedule slot, alongside the
-- existing weekday-based one: many compounds (peptides etc.) are dosed every
-- N days rather than on fixed weekdays. NULL (default, all existing rows)
-- keeps the current weekdays-driven behavior unchanged; a set value switches
-- the slot to "every interval_days days, counted from start_date" (start_date
-- becomes the mandatory anchor in that mode, enforced client-side). The two
-- modes are mutually exclusive per slot, never combined.
ALTER TABLE public.zane_medication_schedule_slots
  ADD COLUMN interval_days integer;
