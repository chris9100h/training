-- Schedule backups: snapshot of a schedule's days whenever they change to a
-- valid non-empty array. Written fire-and-forget from syncStore (client-side),
-- never blocks the main sync. Used by the "Restore backup" UI in the plan viewer.

CREATE TABLE zane_schedule_backups (
  id            text        PRIMARY KEY,
  user_id       uuid        REFERENCES auth.users NOT NULL,
  schedule_id   text        NOT NULL,
  schedule_name text        NOT NULL,
  days          jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE zane_schedule_backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own backups"
  ON zane_schedule_backups FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Initial snapshot: back up every schedule that currently has a valid non-empty
-- days array, so users have at least one restore point right away.
INSERT INTO zane_schedule_backups (id, user_id, schedule_id, schedule_name, days)
SELECT
  gen_random_uuid()::text,
  user_id,
  id,
  name,
  days
FROM zane_schedules
WHERE jsonb_typeof(days) = 'array'
  AND jsonb_array_length(days) > 0;
