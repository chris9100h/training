-- Reverts the COALESCE on the body-measurement columns back to plain
-- EXCLUDED assignment (migration 0248 shipped the COALESCE variant in its
-- review-fix pass; this restores deletable measurements).
--
-- Why: the meal_of_choice precedent does not apply. meal_of_choice is a
-- boolean that no client ever sends as null (the payload always carries
-- `!!l.mealOfChoice`), so COALESCE there only guards key-absence. The body
-- measurements ARE sent as null for cleared fields (`waist_cm:
-- l.waistCm ?? null`), so COALESCE makes a deliberately cleared field
-- resurrect on every subsequent sync, forever. That permanent data-integrity
-- bug is worse than the short rollout-window wipe plain EXCLUDED accepts:
-- a pre-update client syncing a daily-log edit nulls the measurements of
-- that day, but only until the old client updates (the SW cache bump ships
-- the fix to all devices within days).
CREATE OR REPLACE FUNCTION public.sync_daily_logs_batch(p_logs jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  INSERT INTO zane_daily_logs (
    id, user_id, date, weight, waist_cm, hips_cm, chest_cm, arm_cm, thigh_cm,
    calf_cm, body_fat_pct, steps,
    calories, protein, carbs, fat, fiber,
    water_ml, note, off_plan_note, meal_of_choice, meal_of_choice_hour,
    adherence, targets_snap, daily_coach_fields, updated_at
  )
  SELECT
    l->>'id',
    auth.uid(),
    l->>'date',
    (l->>'weight')::numeric,
    (l->>'waist_cm')::numeric,
    (l->>'hips_cm')::numeric,
    (l->>'chest_cm')::numeric,
    (l->>'arm_cm')::numeric,
    (l->>'thigh_cm')::numeric,
    (l->>'calf_cm')::numeric,
    (l->>'body_fat_pct')::numeric,
    (l->>'steps')::int,
    (l->>'calories')::int,
    (l->>'protein')::int,
    (l->>'carbs')::int,
    (l->>'fat')::int,
    (l->>'fiber')::int,
    (l->>'water_ml')::int,
    l->>'note',
    l->>'off_plan_note',
    (l->>'meal_of_choice')::boolean,
    (l->>'meal_of_choice_hour')::smallint,
    (l->>'adherence')::numeric,
    CASE WHEN l->'targets_snap' IS NULL OR l->'targets_snap' = 'null'::jsonb THEN NULL ELSE l->'targets_snap' END,
    CASE WHEN l->'daily_coach_fields' IS NULL OR l->'daily_coach_fields' = 'null'::jsonb THEN NULL ELSE l->'daily_coach_fields' END,
    LEAST(COALESCE((l->>'updated_at')::timestamptz, now()), now())
  FROM jsonb_array_elements(p_logs) AS l
  ON CONFLICT (user_id, date) DO UPDATE SET
    weight             = EXCLUDED.weight,
    waist_cm           = EXCLUDED.waist_cm,
    hips_cm            = EXCLUDED.hips_cm,
    chest_cm           = EXCLUDED.chest_cm,
    arm_cm             = EXCLUDED.arm_cm,
    thigh_cm           = EXCLUDED.thigh_cm,
    calf_cm            = EXCLUDED.calf_cm,
    body_fat_pct       = EXCLUDED.body_fat_pct,
    steps              = EXCLUDED.steps,
    calories           = EXCLUDED.calories,
    protein            = EXCLUDED.protein,
    carbs              = EXCLUDED.carbs,
    fat                = EXCLUDED.fat,
    fiber              = EXCLUDED.fiber,
    water_ml           = EXCLUDED.water_ml,
    note               = EXCLUDED.note,
    off_plan_note      = EXCLUDED.off_plan_note,
    meal_of_choice     = COALESCE(EXCLUDED.meal_of_choice, zane_daily_logs.meal_of_choice),
    meal_of_choice_hour = EXCLUDED.meal_of_choice_hour,
    adherence          = EXCLUDED.adherence,
    targets_snap       = EXCLUDED.targets_snap,
    daily_coach_fields = EXCLUDED.daily_coach_fields,
    updated_at         = EXCLUDED.updated_at
  WHERE zane_daily_logs.updated_at < EXCLUDED.updated_at;
$function$;
