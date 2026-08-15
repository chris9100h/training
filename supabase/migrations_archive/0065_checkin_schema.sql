-- 0065: Flexible check-in schema per coaching relationship
-- checkin_schema: coach-defined form (null = use app default)
-- responses: all field values as jsonb, keyed by field key

ALTER TABLE zane_coaching ADD COLUMN IF NOT EXISTS checkin_schema jsonb;
ALTER TABLE zane_checkins ADD COLUMN IF NOT EXISTS responses jsonb;

-- Backfill existing rows: copy fixed-column values into responses
UPDATE zane_checkins
SET responses = jsonb_strip_nulls(jsonb_build_object(
  'weight_today',             weight_today,
  'weight_avg_last_week',     weight_avg_last_week,
  'off_plan_notes',           off_plan_notes,
  'hydration_ml',             hydration_ml,
  'days_trained',             days_trained,
  'performance_vs_last_week', performance_vs_last_week,
  'steps',                    steps,
  'cardio_minutes',           cardio_minutes,
  'cardio_distance_m',        cardio_distance_m,
  'cardio_pace_feeling',      cardio_pace_feeling,
  'cardio_effort',            cardio_effort,
  'goal_note',                goal_note,
  'hunger',                   hunger,
  'sleep_quality',            sleep_quality,
  'life_stress',              life_stress,
  'work_stress',              work_stress,
  'tiredness',                tiredness,
  'issues_notes',             issues_notes,
  'general_note',             general_note
))
WHERE responses IS NULL;
