-- Health tab: daily log table + user settings columns.

-- ── zane_daily_logs ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS zane_daily_logs (
  id          text        PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date        text        NOT NULL,   -- YYYY-MM-DD (local calendar date)
  weight      numeric,
  steps       integer,
  calories    integer,
  protein     integer,
  carbs       integer,
  fat         integer,
  water_ml    integer,
  note        text,
  adherence   numeric,               -- macro adherence % persisted at save time
  targets_snap jsonb,                -- { protein, carbs, fat, calories, dayType } snapshot
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

ALTER TABLE zane_daily_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own daily logs"
  ON zane_daily_logs FOR ALL TO authenticated
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "coach can read client daily logs"
  ON zane_daily_logs FOR SELECT TO authenticated
  USING (zane_is_coach_of(user_id));

-- ── zane_user_settings additions ─────────────────────────────────────────────

ALTER TABLE zane_user_settings
  ADD COLUMN IF NOT EXISTS macro_targets  jsonb,
  ADD COLUMN IF NOT EXISTS show_health_tab boolean NOT NULL DEFAULT false;
