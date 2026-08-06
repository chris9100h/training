-- Medication reminder follow-up: state-based nudging (second nudge, snooze,
-- 2-per-day cap). The medication-reminder cron (migration 0219, auth
-- re-keyed in 0230) used to fire exactly once per missed dose via a 1h
-- window predicate and wrote no state. These columns are that state:
--   reminder_sent_at  when the last nudge for this row fired (null = never)
--   reminder_count    nudges sent so far, hard-capped at 2 by the cron
--   snoozed_until     client-set via the timeline "Snooze 1h" button; the
--                     cron skips the row until this instant, then resumes
--                     nudging (count rules still apply)
-- reminder_sent_at / reminder_count are written only by the edge function
-- (service role); the client deliberately never writes them (syncStore's
-- medicationLogs upsert omits them so a stale device cannot roll the nudge
-- counter back and extend the daily cap). snoozed_until is client-written
-- through the normal log sync, so it propagates cross-device like any other
-- log edit. The per-row count is naturally per-day: each local date
-- materializes its own planned row, so no separate daily reset is needed.
ALTER TABLE public.zane_medication_logs
  ADD COLUMN reminder_sent_at timestamptz,
  ADD COLUMN reminder_count integer NOT NULL DEFAULT 0,
  ADD COLUMN snoozed_until timestamptz;
