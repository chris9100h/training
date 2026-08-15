-- 0152_checkin_schema_templates.sql
-- Coach feature request: saving a check-in schema for "All clients" instantly
-- overwrote the coach's default with no confirmation and no way back to the
-- previous form. Give coaches up to 5 named, reusable schema templates
-- (save/apply/delete), and let the "All clients" save flow offer to snapshot
-- the OUTGOING default as a template before it's replaced. Mirrors
-- zane_workout_templates exactly (owner-only table, no realtime, synced via
-- the normal syncStore diff, no dedicated RPC).

CREATE TABLE IF NOT EXISTS zane_checkin_schema_templates (
  id          text        PRIMARY KEY,
  user_id     uuid        REFERENCES auth.users NOT NULL,
  name        text        NOT NULL,
  schema      jsonb       NOT NULL DEFAULT '[]',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zane_checkin_schema_templates_user_id ON public.zane_checkin_schema_templates(user_id);

ALTER TABLE zane_checkin_schema_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zane_checkin_schema_templates_own"
  ON zane_checkin_schema_templates FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
