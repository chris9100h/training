-- The meal-of-choice meal belongs in the timeline at the hour it is planned
-- for, inside its meal category, like every other meal, instead of floating in
-- a card above it. It was landing in one place while unconfirmed and jumping to
-- another once ticked off, because the confirmed entry gets a real time and the
-- unconfirmed one had nowhere to sit.
--
-- The unconfirmed meal stays derived rather than a stored planned entry (its
-- budget is computed against the day's projected totals, so a stored row would
-- sit inside its own input), which means the hour has to live with the marker
-- rather than on an entry. Nullable: null falls back to a sensible default in
-- the UI, and every row that predates this column has no hour to remember.
alter table zane_daily_logs
  add column meal_of_choice_hour smallint;

comment on column zane_daily_logs.meal_of_choice_hour is
  'Hour (0-23) the meal-of-choice meal is planned for, so the derived row renders in the right meal category. null = not chosen, the UI picks a default. Only meaningful while meal_of_choice is true.';

-- Same three lists as 0211, same reason: the column list is hardcoded in the
-- INSERT list, the SELECT projection and the ON CONFLICT SET, so a column added
-- to the table but not here syncs silently never and no CI gate notices.
--
-- Note the asymmetry with meal_of_choice above it. That one is COALESCEd
-- against the stored row so an older client, whose payload has no such key,
-- preserves the flag instead of clearing it. The hour does NOT need that: it is
-- only ever read while the flag is true, and the flag already survives the old
-- client, so a hour that reverts to null on such a write just falls back to the
-- default. Coalescing it too would make an intentional "no hour" unsettable.
CREATE OR REPLACE FUNCTION public.sync_daily_logs_batch(p_logs jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  INSERT INTO zane_daily_logs (
    id, user_id, date, weight, steps, calories, protein, carbs, fat, fiber,
    water_ml, note, off_plan_note, meal_of_choice, meal_of_choice_hour,
    adherence, targets_snap, daily_coach_fields, updated_at
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
    (l->>'meal_of_choice_hour')::smallint,
    (l->>'adherence')::numeric,
    CASE WHEN l->'targets_snap' IS NULL OR l->'targets_snap' = 'null'::jsonb THEN NULL ELSE l->'targets_snap' END,
    CASE WHEN l->'daily_coach_fields' IS NULL OR l->'daily_coach_fields' = 'null'::jsonb THEN NULL ELSE l->'daily_coach_fields' END,
    COALESCE((l->>'updated_at')::timestamptz, now())
  FROM jsonb_array_elements(p_logs) AS l
  ON CONFLICT (user_id, date) DO UPDATE SET
    weight              = EXCLUDED.weight,
    steps               = EXCLUDED.steps,
    calories            = EXCLUDED.calories,
    protein             = EXCLUDED.protein,
    carbs               = EXCLUDED.carbs,
    fat                 = EXCLUDED.fat,
    fiber               = EXCLUDED.fiber,
    water_ml            = EXCLUDED.water_ml,
    note                = EXCLUDED.note,
    off_plan_note       = EXCLUDED.off_plan_note,
    meal_of_choice      = COALESCE(EXCLUDED.meal_of_choice, zane_daily_logs.meal_of_choice),
    meal_of_choice_hour = EXCLUDED.meal_of_choice_hour,
    adherence           = EXCLUDED.adherence,
    targets_snap        = EXCLUDED.targets_snap,
    daily_coach_fields  = EXCLUDED.daily_coach_fields,
    updated_at          = EXCLUDED.updated_at
  WHERE zane_daily_logs.updated_at < EXCLUDED.updated_at;
$function$;
