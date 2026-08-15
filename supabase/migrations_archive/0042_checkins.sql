CREATE TABLE public.zane_checkins (
  id                   text PRIMARY KEY,
  coaching_id          text NOT NULL REFERENCES zane_coaching(id) ON DELETE CASCADE,
  client_id            uuid NOT NULL REFERENCES zane_profiles(id) ON DELETE CASCADE,
  week_start           date NOT NULL,
  checked_in_at        timestamptz NOT NULL DEFAULT now(),

  -- Weight
  weight_today         numeric,
  weight_avg_last_week numeric,

  -- Nutrition
  off_plan_notes       text,
  hydration_ml         int,

  -- Activity
  days_trained         int,
  steps                int,
  cardio_minutes       int,
  cardio_distance_m    int,
  cardio_avg_pace      text,

  -- Goals
  goal_note            text,

  -- Markers (1–10, 1 = good, 10 = bad)
  hunger               int,
  sleep_quality        int,
  life_stress          int,
  work_stress          int,
  tiredness            int,

  -- Free text
  issues_notes         text,
  general_note         text,

  UNIQUE (coaching_id, week_start)
);

ALTER TABLE public.zane_checkins ENABLE ROW LEVEL SECURITY;

-- Client: full access to own check-ins
CREATE POLICY "checkins_client" ON public.zane_checkins
  FOR ALL TO authenticated
  USING (client_id = auth.uid())
  WITH CHECK (client_id = auth.uid());

-- Coach: read access to active clients' check-ins
CREATE POLICY "checkins_coach_read" ON public.zane_checkins
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM zane_coaching
      WHERE id = coaching_id
        AND coach_id = auth.uid()
        AND status = 'active'
    )
  );
