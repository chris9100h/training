-- "Meal of choice": one meal on a deliberately marked day absorbs whatever
-- macros are left, while the rest of that day is eaten light and protein-heavy.
-- The coach protocol behind it is "memories over macros": at 35+ meals a week,
-- one off-plan meal does not matter, so the day must not be scored as a
-- failure.
--
-- Per-day, so it is a column on the row that already exists per (user, date)
-- rather than a new mode on zane_status_periods, which is an interval model
-- ("I was away nine days") with a second source of truth in
-- zane_user_settings.status_mode and four hand-rolled writer copies.
--
-- Nullable rather than NOT NULL DEFAULT false: null and false both read as
-- "not marked", and nullability is what lets the sync RPC below tell "an old
-- client did not send this key" apart from "the user cleared it".
alter table zane_daily_logs
  add column meal_of_choice boolean default false;

comment on column zane_daily_logs.meal_of_choice is
  'True when this day is a deliberately declared meal-of-choice day. Such a day is left UNSCORED: adherence is null so it drops out of every average, exactly like a sick/vacation day, but targets_snap is kept (a flex plan reads the day type back out of it). The meal name lives in off_plan_note, not here.';

-- The sync RPC hardcodes its column list three times over (INSERT list, SELECT
-- projection, ON CONFLICT SET), so a new column that is not added here syncs
-- silently never, with nothing in CI to catch it: check-db-docs only verifies
-- the column exists, and check-backup-coverage goes through .select()/.upsert()
-- and bypasses this function entirely. This is the first column added to
-- zane_daily_logs since the RPC shipped in 0096.
--
-- Note where the COALESCE sits. An older client still running SW-cached JS
-- sends a payload with no meal_of_choice key at all. Coalescing in the SELECT
-- (the idiom sync_sets_batch uses for `done`) would collapse "key absent" and
-- "explicitly cleared" into the same false, so an old device merely editing the
-- weight on a marked day would unmark it. Coalescing in the DO UPDATE against
-- the row already stored makes an absent key PRESERVE the flag, while an
-- explicit false from an up-to-date client still clears it. The INSERT path
-- needs no coalesce: a conflicting row goes down the UPDATE path, so the only
-- rows an old client can insert are new ones, which are legitimately unmarked.
CREATE OR REPLACE FUNCTION public.sync_daily_logs_batch(p_logs jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  INSERT INTO zane_daily_logs (
    id, user_id, date, weight, steps, calories, protein, carbs, fat, fiber,
    water_ml, note, off_plan_note, meal_of_choice, adherence, targets_snap,
    daily_coach_fields, updated_at
  )
  SELECT
    l->>'id',
    auth.uid(),
    l->>'date',
    (l->>'weight')::numeric,
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
    (l->>'adherence')::numeric,
    CASE WHEN l->'targets_snap' IS NULL OR l->'targets_snap' = 'null'::jsonb THEN NULL ELSE l->'targets_snap' END,
    CASE WHEN l->'daily_coach_fields' IS NULL OR l->'daily_coach_fields' = 'null'::jsonb THEN NULL ELSE l->'daily_coach_fields' END,
    COALESCE((l->>'updated_at')::timestamptz, now())
  FROM jsonb_array_elements(p_logs) AS l
  ON CONFLICT (user_id, date) DO UPDATE SET
    weight             = EXCLUDED.weight,
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
    adherence          = EXCLUDED.adherence,
    targets_snap       = EXCLUDED.targets_snap,
    daily_coach_fields = EXCLUDED.daily_coach_fields,
    updated_at         = EXCLUDED.updated_at
  WHERE zane_daily_logs.updated_at < EXCLUDED.updated_at;
$function$;
