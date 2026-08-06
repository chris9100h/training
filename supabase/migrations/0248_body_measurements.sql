-- Body measurements: waist, hips, chest, upper arms, thighs and calves in cm,
-- body fat in percent, entered per day in the Daily Log's BODY section and
-- charted on a new "Body Measurements" Health card with a dropdown metric
-- switcher (plus a derived BMI segment when a height is set in the macro
-- estimator).
--
-- No new table: the values become nullable columns on zane_daily_logs, so
-- they ride the existing daily-log plumbing end to end (sync_daily_logs_batch
-- RPC, diff-based syncStore payload, backup round trip, coach read-only view).
-- They deliberately touch no reminder logic: the daily-log-reminder cron
-- gates on zane_daily_logs.weight only, so entering measurements without a
-- weight never suppresses the weight nudge.

ALTER TABLE zane_daily_logs
  ADD COLUMN IF NOT EXISTS waist_cm numeric,
  ADD COLUMN IF NOT EXISTS hips_cm numeric,
  ADD COLUMN IF NOT EXISTS chest_cm numeric,
  ADD COLUMN IF NOT EXISTS arm_cm numeric,
  ADD COLUMN IF NOT EXISTS thigh_cm numeric,
  ADD COLUMN IF NOT EXISTS calf_cm numeric,
  ADD COLUMN IF NOT EXISTS body_fat_pct numeric;

-- The sync RPC hardcodes its column list three times over (INSERT list,
-- SELECT projection, ON CONFLICT SET), so a new column that is not added here
-- syncs silently never (migration 0211's note, still no CI gate for it).
-- CREATE OR REPLACE with the identical signature preserves the existing
-- REVOKE/GRANT (PUBLIC + anon revoked in 0141, authenticated granted), no
-- grants need to be reapplied. The new columns are COALESCEd in the DO UPDATE
-- like meal_of_choice (0211), NOT plain EXCLUDED like weight/steps: old
-- clients never carried these keys (weight/steps were always in every
-- payload, these are brand-new columns), so a plain assignment would null
-- out a user's measurements whenever a pre-update device syncs a daily-log
-- edit during the rollout window. COALESCE keeps the existing value when the
-- key is absent, at the cost that a deliberate clear (saving an empty
-- field) cannot wipe the value either, the same accepted tradeoff as
-- meal_of_choice.
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
    waist_cm           = COALESCE(EXCLUDED.waist_cm, zane_daily_logs.waist_cm),
    hips_cm            = COALESCE(EXCLUDED.hips_cm, zane_daily_logs.hips_cm),
    chest_cm           = COALESCE(EXCLUDED.chest_cm, zane_daily_logs.chest_cm),
    arm_cm             = COALESCE(EXCLUDED.arm_cm, zane_daily_logs.arm_cm),
    thigh_cm           = COALESCE(EXCLUDED.thigh_cm, zane_daily_logs.thigh_cm),
    calf_cm            = COALESCE(EXCLUDED.calf_cm, zane_daily_logs.calf_cm),
    body_fat_pct       = COALESCE(EXCLUDED.body_fat_pct, zane_daily_logs.body_fat_pct),
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

-- Post-apply verification (same query as migration 0141): must return false.
-- SELECT has_function_privilege('anon', 'public.sync_daily_logs_batch(jsonb)', 'execute');
