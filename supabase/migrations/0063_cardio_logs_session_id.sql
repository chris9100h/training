-- Add session_id to zane_cardio_logs so session-originated logs can be
-- cleaned up when their parent session is deleted.
-- Nullable: manually-logged cardio entries have no associated session.
alter table zane_cardio_logs
  add column if not exists session_id text;
