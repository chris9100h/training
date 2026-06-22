CREATE TABLE IF NOT EXISTS zane_cardio_plans (
  id              text        PRIMARY KEY,
  user_id         uuid        REFERENCES auth.users NOT NULL,
  name            text        NOT NULL,
  activity_type   text        NOT NULL,
  archived        boolean     NOT NULL DEFAULT false,
  mode            text        NOT NULL DEFAULT 'manual', -- 'manual' | 'goal'
  days            jsonb       NOT NULL DEFAULT '{}',      -- { mon: true, wed: true, ... }
  manual_targets  jsonb,      -- { mon: { target_type, distance_m, duration_minutes }, ... }
  goal            jsonb,      -- { type: 'distance'|'pace', target_distance_m, target_duration_minutes }
  goal_due_date   date,
  start_fitness   jsonb,      -- { distance_m, duration_minutes, pace_s_per_km }
  generated_weeks jsonb,      -- [{ distance_m, duration_minutes, pace_s_per_km }, ...]
  plan_start_date date,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE zane_cardio_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zane_cardio_plans_own"
  ON zane_cardio_plans
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
