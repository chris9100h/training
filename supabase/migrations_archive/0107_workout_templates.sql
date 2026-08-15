-- Reusable workout templates. A template is a saved set of exercises (structure
-- only — no logged sets) that can be used to start a freestyle session or
-- imported into a plan day. Typically saved from a finished freestyle session.
CREATE TABLE IF NOT EXISTS zane_workout_templates (
  id          text        PRIMARY KEY,
  user_id     uuid        REFERENCES auth.users NOT NULL,
  name        text        NOT NULL,
  exercises   jsonb       NOT NULL DEFAULT '[]',  -- [{ exId, name, sets, reps, repsPerSet, note, supersetGroup }]
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE zane_workout_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zane_workout_templates_own"
  ON zane_workout_templates
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
