-- Final audit follow-up: make every multi-row plan transfer one transaction.

ALTER TABLE public.zane_social_plan_share_imports
  ADD COLUMN IF NOT EXISTS schedule_id text;

COMMENT ON COLUMN public.zane_social_plan_share_imports.schedule_id IS
  'The owned schedule created by the atomic import.';

CREATE OR REPLACE FUNCTION public.social_import_plan_share(
  p_share_id uuid,
  p_schedule jsonb,
  p_exercises jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_share public.zane_social_plan_shares%ROWTYPE;
  v_row jsonb;
  v_schedule_id text;
  v_existing_schedule_id text;
  v_claimed boolean := false;
  v_exercise_ids text[] := ARRAY[]::text[];
  v_ex_id text;
  v_day jsonb;
  v_item jsonb;
  v_tags text[];
BEGIN
  PERFORM app_private.require_social_available();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_schedule IS NULL OR jsonb_typeof(p_schedule) <> 'object'
     OR p_exercises IS NULL OR jsonb_typeof(p_exercises) <> 'array'
     OR octet_length(p_schedule::text) > 250000
     OR octet_length(p_exercises::text) > 250000
     OR jsonb_array_length(p_exercises) > 500 THEN
    RAISE EXCEPTION 'Invalid plan payload';
  END IF;

  SELECT s.* INTO v_share
  FROM public.zane_social_plan_shares s
  WHERE s.id = p_share_id
  FOR SHARE;

  IF v_share.id IS NULL
     OR NOT (
       v_share.recipient_id = v_uid
       OR (v_share.group_id IS NOT NULL AND public.social_is_group_member(v_share.group_id, v_uid))
     )
     OR EXISTS (
       SELECT 1
       FROM public.zane_social_blocks b
       WHERE (v_share.recipient_id IS NOT NULL AND (
         (b.blocker_id = v_uid AND b.blocked_id = v_share.sender_id)
         OR (b.blocker_id = v_share.sender_id AND b.blocked_id = v_uid)
       ))
       OR (v_share.group_id IS NOT NULL AND EXISTS (
         SELECT 1
         FROM public.zane_social_group_members gm
         WHERE gm.group_id = v_share.group_id
           AND gm.user_id <> v_uid
           AND (
             (b.blocker_id = v_uid AND b.blocked_id = gm.user_id)
             OR (b.blocker_id = gm.user_id AND b.blocked_id = v_uid)
           )
       ))
     ) THEN
    RAISE EXCEPTION 'Plan share not found';
  END IF;

  v_schedule_id := p_schedule->>'id';
  IF v_schedule_id IS NULL OR v_schedule_id !~ '^[A-Za-z0-9_.:-]{1,200}$'
     OR char_length(trim(coalesce(p_schedule->>'name', ''))) NOT BETWEEN 1 AND 140
     OR jsonb_typeof(coalesce(p_schedule->'days', '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(coalesce(p_schedule->'days', '[]'::jsonb)) > 14
     OR (p_schedule->'program_data' IS NOT NULL AND jsonb_typeof(p_schedule->'program_data') NOT IN ('object', 'null')) THEN
    RAISE EXCEPTION 'Invalid schedule';
  END IF;

  INSERT INTO public.zane_social_plan_share_imports (share_id, user_id, schedule_id)
  VALUES (p_share_id, v_uid, v_schedule_id)
  ON CONFLICT (share_id, user_id) DO NOTHING
  RETURNING true INTO v_claimed;

  IF NOT coalesce(v_claimed, false) THEN
    SELECT i.schedule_id INTO v_existing_schedule_id
    FROM public.zane_social_plan_share_imports i
    WHERE i.share_id = p_share_id AND i.user_id = v_uid;
    RETURN jsonb_build_object(
      'imported', false,
      'schedule_id', v_existing_schedule_id
    );
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_exercises)
  LOOP
    IF jsonb_typeof(v_row) <> 'object' THEN RAISE EXCEPTION 'Invalid exercise'; END IF;
    v_ex_id := v_row->>'id';
    IF v_ex_id IS NULL OR v_ex_id !~ '^[A-Za-z0-9_.:-]{1,200}$'
       OR char_length(trim(coalesce(v_row->>'name', ''))) NOT BETWEEN 1 AND 120
       OR jsonb_typeof(coalesce(v_row->'tags', '[]'::jsonb)) <> 'array'
       OR jsonb_array_length(coalesce(v_row->'tags', '[]'::jsonb)) > 20
       OR (nullif(v_row->>'progression_reps', '') IS NOT NULL
         AND (v_row->>'progression_reps')::integer NOT BETWEEN 0 AND 1000)
       OR (nullif(v_row->>'progression_increment', '') IS NOT NULL
         AND (v_row->>'progression_increment')::numeric NOT BETWEEN 0 AND 1000)
       OR jsonb_typeof(coalesce(v_row->'horn_labels', '[]'::jsonb)) NOT IN ('array', 'null') THEN
      RAISE EXCEPTION 'Invalid exercise';
    END IF;
    IF v_ex_id = ANY(v_exercise_ids) THEN RAISE EXCEPTION 'Duplicate exercise'; END IF;
    v_exercise_ids := array_append(v_exercise_ids, v_ex_id);
    SELECT coalesce(array_agg(value), ARRAY[]::text[]) INTO v_tags
    FROM jsonb_array_elements_text(coalesce(v_row->'tags', '[]'::jsonb));
    IF EXISTS (SELECT 1 FROM unnest(v_tags) tag WHERE char_length(tag) > 40) THEN
      RAISE EXCEPTION 'Invalid exercise tags';
    END IF;
    IF jsonb_typeof(v_row->'horn_labels') = 'array'
       AND (
         jsonb_array_length(v_row->'horn_labels') > 12
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements(v_row->'horn_labels') AS horn(label)
           WHERE jsonb_typeof(horn.label) <> 'string'
              OR char_length(horn.label #>> '{}') > 80
         )
       ) THEN
      RAISE EXCEPTION 'Invalid horn labels';
    END IF;
    IF v_row->>'bodyweight_mode' IS NOT NULL
       AND v_row->>'bodyweight_mode' NOT IN ('pull', 'plus_load') THEN
      RAISE EXCEPTION 'Invalid bodyweight mode';
    END IF;
    IF v_row->>'youtube_url' IS NOT NULL
       AND (char_length(v_row->>'youtube_url') > 500
         OR v_row->>'youtube_url' !~* '^https://([a-z0-9-]+\.)?(youtube\.com|youtu\.be)/') THEN
      RAISE EXCEPTION 'Invalid video URL';
    END IF;
    IF EXISTS (SELECT 1 FROM public.zane_exercises e WHERE e.id = v_ex_id AND e.user_id <> v_uid) THEN
      RAISE EXCEPTION 'Exercise identifier collision';
    END IF;
    INSERT INTO public.zane_exercises AS owned_exercise (
      id, user_id, name, tags, note, category, unilateral, equipment,
      progression_reps, movement_type, no_weight_reps, log_mode,
      pull_bodyweight, bodyweight_mode, youtube_url, note_pinned,
      progression_increment, horn_labels
    ) VALUES (
      v_ex_id, v_uid, trim(v_row->>'name'), v_tags,
      left(coalesce(v_row->>'note', ''), 2000), nullif(left(v_row->>'category', 80), ''),
      coalesce((v_row->>'unilateral')::boolean, false), nullif(left(v_row->>'equipment', 80), ''),
      (v_row->>'progression_reps')::integer, nullif(left(v_row->>'movement_type', 40), ''),
      coalesce((v_row->>'no_weight_reps')::boolean, false), nullif(left(v_row->>'log_mode', 40), ''),
      coalesce((v_row->>'pull_bodyweight')::boolean, false), nullif(v_row->>'bodyweight_mode', ''),
      nullif(v_row->>'youtube_url', ''), coalesce((v_row->>'note_pinned')::boolean, false),
      nullif((v_row->>'progression_increment')::numeric, 0), v_row->'horn_labels'
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      tags = EXCLUDED.tags,
      note = EXCLUDED.note,
      category = EXCLUDED.category,
      unilateral = EXCLUDED.unilateral,
      equipment = EXCLUDED.equipment,
      progression_reps = EXCLUDED.progression_reps,
      movement_type = EXCLUDED.movement_type,
      no_weight_reps = EXCLUDED.no_weight_reps,
      log_mode = EXCLUDED.log_mode,
      pull_bodyweight = EXCLUDED.pull_bodyweight,
      bodyweight_mode = EXCLUDED.bodyweight_mode,
      youtube_url = EXCLUDED.youtube_url,
      note_pinned = EXCLUDED.note_pinned,
      progression_increment = EXCLUDED.progression_increment,
      horn_labels = EXCLUDED.horn_labels
    WHERE owned_exercise.user_id = v_uid;
  END LOOP;

  FOR v_day IN SELECT value FROM jsonb_array_elements(coalesce(p_schedule->'days', '[]'::jsonb))
  LOOP
    IF jsonb_typeof(v_day) <> 'object'
       OR char_length(trim(coalesce(v_day->>'name', ''))) NOT BETWEEN 1 AND 80
       OR jsonb_typeof(coalesce(v_day->'items', '[]'::jsonb)) <> 'array'
       OR jsonb_array_length(coalesce(v_day->'items', '[]'::jsonb)) > 100 THEN
      RAISE EXCEPTION 'Invalid training day';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(v_day->'items', '[]'::jsonb))
    LOOP
      v_ex_id := v_item->>'exId';
      IF jsonb_typeof(v_item) <> 'object' OR v_ex_id IS NULL
         OR coalesce((v_item->>'sets')::integer, 0) NOT BETWEEN 0 AND 30
         OR NOT EXISTS (
           SELECT 1 FROM public.zane_exercises e
           WHERE e.id = v_ex_id AND e.user_id = v_uid
         ) THEN
        RAISE EXCEPTION 'Invalid training item';
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.zane_schedules s WHERE s.id = v_schedule_id AND s.user_id <> v_uid) THEN
    RAISE EXCEPTION 'Schedule identifier collision';
  END IF;
  INSERT INTO public.zane_schedules AS owned_schedule (
    id, user_id, name, days, archived, versions, is_flex,
    program_type, program_data, is_template
  ) VALUES (
    v_schedule_id, v_uid, trim(p_schedule->>'name'), coalesce(p_schedule->'days', '[]'::jsonb),
    false, '[]'::jsonb, false,
    CASE WHEN p_schedule->>'program_type' = '531' THEN '531' ELSE NULL END,
    p_schedule->'program_data', false
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    days = EXCLUDED.days,
    archived = false,
    versions = '[]'::jsonb,
    is_flex = false,
    program_type = EXCLUDED.program_type,
    program_data = EXCLUDED.program_data,
    is_template = false
  WHERE owned_schedule.user_id = v_uid;

  UPDATE public.zane_social_plan_shares
  SET imported_at = coalesce(imported_at, now())
  WHERE id = p_share_id AND recipient_id = v_uid;

  RETURN jsonb_build_object('imported', true, 'schedule_id', v_schedule_id);
END;
$function$;

-- Old receipts predate schedule_id and cannot identify their historical local
-- schedule. Remove only those legacy markers once, then make the invariant
-- explicit. A future import claims the share again and always receives a real
-- schedule id; no client can get a permanent null receipt.
DELETE FROM public.zane_social_plan_share_imports WHERE schedule_id IS NULL;
ALTER TABLE public.zane_social_plan_share_imports
  ALTER COLUMN schedule_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.push_training_plan_to_client(
  p_coaching_id text,
  p_operation_id text,
  p_schedule jsonb,
  p_exercises jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_client uuid;
  v_existing_schedule public.zane_schedules%ROWTYPE;
  v_row jsonb;
  v_version jsonb;
  v_days jsonb;
  v_day jsonb;
  v_item jsonb;
  v_schedule_id text := p_schedule->>'id';
  v_exercise_id text;
  v_exercise_ids text[] := ARRAY[]::text[];
  v_tags text[];
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT c.client_id INTO v_client
  FROM public.zane_coaching c
  WHERE c.id = p_coaching_id
    AND c.coach_id = v_caller
    AND c.status = 'active'
    AND c.id NOT LIKE 'support_%'
  FOR UPDATE;
  IF v_client IS NULL THEN RAISE EXCEPTION 'Active coaching relationship required'; END IF;

  IF p_schedule IS NULL OR jsonb_typeof(p_schedule) <> 'object'
     OR p_exercises IS NULL OR jsonb_typeof(p_exercises) <> 'array'
     OR p_operation_id IS DISTINCT FROM v_schedule_id
     OR v_schedule_id !~ '^[A-Za-z0-9_.:-]{1,200}$'
     OR char_length(trim(coalesce(p_schedule->>'name', ''))) NOT BETWEEN 1 AND 120
     OR jsonb_typeof(coalesce(p_schedule->'days', '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(coalesce(p_schedule->'days', '[]'::jsonb)) > 14
     OR jsonb_typeof(coalesce(p_schedule->'versions', '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(coalesce(p_schedule->'versions', '[]'::jsonb)) > 52
     OR jsonb_array_length(p_exercises) > 500
     OR octet_length((p_schedule || jsonb_build_object('exercises', p_exercises))::text) > 500000
     OR (p_schedule->'program_data' IS NOT NULL
       AND jsonb_typeof(p_schedule->'program_data') NOT IN ('object', 'null'))
     OR (p_schedule->>'program_type' IS NOT NULL AND p_schedule->>'program_type' <> '531')
     OR (p_schedule->>'mesocycle_autoregulate_mode' IS NOT NULL
       AND p_schedule->>'mesocycle_autoregulate_mode' <> 'load') THEN
    RAISE EXCEPTION 'Invalid training plan payload';
  END IF;

  SELECT s.* INTO v_existing_schedule
  FROM public.zane_schedules s
  WHERE s.id = v_schedule_id
  FOR UPDATE;
  IF v_existing_schedule.id IS NOT NULL THEN
    IF v_existing_schedule.user_id <> v_client THEN
      RAISE EXCEPTION 'Schedule identifier collision';
    END IF;
    RETURN v_schedule_id;
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_exercises)
  LOOP
    v_exercise_id := v_row->>'id';
    IF jsonb_typeof(v_row) <> 'object'
       OR v_exercise_id IS NULL OR v_exercise_id !~ '^[A-Za-z0-9_.:-]{1,200}$'
       OR char_length(trim(coalesce(v_row->>'name', ''))) NOT BETWEEN 1 AND 120
       OR jsonb_typeof(coalesce(v_row->'tags', '[]'::jsonb)) <> 'array'
       OR jsonb_array_length(coalesce(v_row->'tags', '[]'::jsonb)) > 20
       OR (nullif(v_row->>'progression_reps', '') IS NOT NULL
         AND (v_row->>'progression_reps')::integer NOT BETWEEN 0 AND 1000)
       OR (nullif(v_row->>'progression_increment', '') IS NOT NULL
         AND (v_row->>'progression_increment')::numeric NOT BETWEEN 0 AND 100000)
       OR jsonb_typeof(coalesce(v_row->'horn_labels', '[]'::jsonb)) NOT IN ('array', 'null')
       OR (v_row->>'movement_type' IS NOT NULL
         AND v_row->>'movement_type' NOT IN ('bilateral', 'unilateral', 'assisted', 'mobility', 'cardio'))
       OR (v_row->>'log_mode' IS NOT NULL
         AND v_row->>'log_mode' NOT IN ('checkbox', 'reps', 'time', 'weight', 'weight_reps'))
       OR (v_row->>'bodyweight_mode' IS NOT NULL
         AND v_row->>'bodyweight_mode' NOT IN ('pull', 'plus_load')) THEN
      RAISE EXCEPTION 'Invalid exercise';
    END IF;
    IF v_exercise_id = ANY(v_exercise_ids) THEN RAISE EXCEPTION 'Duplicate exercise'; END IF;
    v_exercise_ids := array_append(v_exercise_ids, v_exercise_id);
    SELECT coalesce(array_agg(value), ARRAY[]::text[]) INTO v_tags
    FROM jsonb_array_elements_text(coalesce(v_row->'tags', '[]'::jsonb));
    IF EXISTS (SELECT 1 FROM unnest(v_tags) tag WHERE char_length(tag) > 40) THEN
      RAISE EXCEPTION 'Invalid exercise tags';
    END IF;
    IF jsonb_typeof(v_row->'horn_labels') = 'array'
       AND (
         jsonb_array_length(v_row->'horn_labels') > 12
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_row->'horn_labels') AS horn(label)
           WHERE jsonb_typeof(horn.label) <> 'string'
              OR char_length(horn.label #>> '{}') > 80
         )
       ) THEN
      RAISE EXCEPTION 'Invalid horn labels';
    END IF;
    IF v_row->>'youtube_url' IS NOT NULL
       AND (char_length(v_row->>'youtube_url') > 500
         OR v_row->>'youtube_url' !~* '^https://([a-z0-9-]+\.)?(youtube\.com|youtu\.be)/') THEN
      RAISE EXCEPTION 'Invalid video URL';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.zane_exercises e
      WHERE e.id = v_exercise_id AND e.user_id <> v_client
    ) THEN
      RAISE EXCEPTION 'Exercise identifier collision';
    END IF;
    INSERT INTO public.zane_exercises AS owned_exercise (
      id, user_id, name, tags, note, category, unilateral, equipment,
      progression_reps, movement_type, no_weight_reps, log_mode,
      pull_bodyweight, bodyweight_mode, youtube_url, note_pinned,
      progression_increment, horn_labels
    ) VALUES (
      v_exercise_id, v_client, trim(v_row->>'name'), v_tags,
      left(coalesce(v_row->>'note', ''), 2000), nullif(left(v_row->>'category', 80), ''),
      coalesce((v_row->>'unilateral')::boolean, false), nullif(left(v_row->>'equipment', 80), ''),
      (v_row->>'progression_reps')::integer, nullif(v_row->>'movement_type', ''),
      coalesce((v_row->>'no_weight_reps')::boolean, false), nullif(v_row->>'log_mode', ''),
      coalesce((v_row->>'pull_bodyweight')::boolean, false), nullif(v_row->>'bodyweight_mode', ''),
      nullif(v_row->>'youtube_url', ''), coalesce((v_row->>'note_pinned')::boolean, false),
      nullif((v_row->>'progression_increment')::numeric, 0), v_row->'horn_labels'
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOR v_version IN SELECT value FROM jsonb_array_elements(coalesce(p_schedule->'versions', '[]'::jsonb))
  LOOP
    IF jsonb_typeof(v_version) <> 'object'
       OR coalesce(v_version->>'validFrom', '') !~ '^\d{4}-\d{2}-\d{2}$'
       OR jsonb_typeof(v_version->'days') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_version->'days') > 14 THEN
      RAISE EXCEPTION 'Invalid plan version';
    END IF;
  END LOOP;

  FOR v_days IN
    SELECT p_schedule->'days'
    UNION ALL
    SELECT value->'days'
    FROM jsonb_array_elements(coalesce(p_schedule->'versions', '[]'::jsonb))
  LOOP
    FOR v_day IN SELECT value FROM jsonb_array_elements(v_days)
    LOOP
      IF jsonb_typeof(v_day) <> 'object'
         OR coalesce(v_day->>'id', '') !~ '^[A-Za-z0-9_.:-]{1,200}$'
         OR char_length(trim(coalesce(v_day->>'name', ''))) NOT BETWEEN 1 AND 80
         OR jsonb_typeof(coalesce(v_day->'items', '[]'::jsonb)) <> 'array'
         OR jsonb_array_length(coalesce(v_day->'items', '[]'::jsonb)) > 100
         OR ((v_day->>'weekday') IS NOT NULL AND (v_day->>'weekday')::integer NOT BETWEEN 0 AND 6) THEN
        RAISE EXCEPTION 'Invalid training day';
      END IF;
      FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(v_day->'items', '[]'::jsonb))
      LOOP
        v_exercise_id := v_item->>'exId';
        IF jsonb_typeof(v_item) <> 'object'
           OR v_exercise_id IS NULL
           OR coalesce((v_item->>'sets')::integer, 0) NOT BETWEEN 0 AND 30
           OR NOT EXISTS (
             SELECT 1 FROM public.zane_exercises e
             WHERE e.id = v_exercise_id AND e.user_id = v_client
           ) THEN
          RAISE EXCEPTION 'Invalid training item';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  INSERT INTO public.zane_schedules (
    id, user_id, name, days, archived, versions, is_flex,
    sessions_per_week, mesocycle_weeks, mesocycle_start_rir,
    mesocycle_end_rir, mesocycle_rir_enabled, mesocycle_autoregulate,
    mesocycle_autoregulate_mode, program_type, program_data, is_template
  ) VALUES (
    v_schedule_id, v_client, trim(p_schedule->>'name'), p_schedule->'days', false,
    coalesce(p_schedule->'versions', '[]'::jsonb), coalesce((p_schedule->>'is_flex')::boolean, false),
    (p_schedule->>'sessions_per_week')::integer, (p_schedule->>'mesocycle_weeks')::integer,
    (p_schedule->>'mesocycle_start_rir')::integer, (p_schedule->>'mesocycle_end_rir')::integer,
    coalesce((p_schedule->>'mesocycle_rir_enabled')::boolean, true),
    coalesce((p_schedule->>'mesocycle_autoregulate')::boolean, false),
    nullif(p_schedule->>'mesocycle_autoregulate_mode', ''),
    nullif(p_schedule->>'program_type', ''), p_schedule->'program_data', false
  )
  ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT s.* INTO v_existing_schedule
    FROM public.zane_schedules s
    WHERE s.id = v_schedule_id;
    IF v_existing_schedule.id IS NULL OR v_existing_schedule.user_id <> v_client THEN
      RAISE EXCEPTION 'Schedule identifier collision';
    END IF;
  END IF;
  RETURN v_schedule_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.push_meal_plan_to_client(
  p_coaching_id text,
  p_operation_id text,
  p_plan jsonb,
  p_recipes jsonb,
  p_slots jsonb,
  p_activate boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_client uuid;
  v_existing_plan public.zane_food_meal_plans%ROWTYPE;
  v_row jsonb;
  v_id text;
  v_plan_id text := p_plan->>'id';
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT c.client_id INTO v_client
  FROM public.zane_coaching c
  WHERE c.id = p_coaching_id
    AND c.coach_id = v_caller
    AND c.status = 'active'
    AND c.id NOT LIKE 'support_%'
  FOR UPDATE;
  IF v_client IS NULL THEN RAISE EXCEPTION 'Active coaching relationship required'; END IF;
  IF p_plan IS NULL OR jsonb_typeof(p_plan) <> 'object'
     OR p_recipes IS NULL OR jsonb_typeof(p_recipes) <> 'array'
     OR p_slots IS NULL OR jsonb_typeof(p_slots) <> 'array'
     OR p_operation_id IS DISTINCT FROM v_plan_id
     OR v_plan_id !~ '^mealpush_[a-z0-9]{2,200}$'
     OR char_length(trim(coalesce(p_plan->>'name', ''))) NOT BETWEEN 1 AND 200
     OR jsonb_array_length(p_recipes) > 100
     OR jsonb_array_length(p_slots) > 500
     OR octet_length((p_plan || jsonb_build_object('recipes', p_recipes, 'slots', p_slots))::text) > 1000000 THEN
    RAISE EXCEPTION 'Invalid meal plan payload';
  END IF;

  SELECT p.* INTO v_existing_plan
  FROM public.zane_food_meal_plans p
  WHERE p.id = v_plan_id
  FOR UPDATE;
  IF v_existing_plan.id IS NOT NULL
     AND (v_existing_plan.user_id <> v_client OR v_existing_plan.coach_id IS DISTINCT FROM v_caller) THEN
    RAISE EXCEPTION 'Plan identifier collision';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_recipes)
  LOOP
    v_id := v_row->>'id';
    IF jsonb_typeof(v_row) <> 'object'
       OR v_id IS NULL
       OR v_id !~ '^mealrecipe_[a-z0-9]{2,200}$'
       OR char_length(trim(coalesce(v_row->>'name', ''))) NOT BETWEEN 1 AND 200
       OR jsonb_typeof(coalesce(v_row->'items', '[]'::jsonb)) <> 'array'
       OR coalesce((v_row->>'portions')::integer, 0) NOT BETWEEN 1 AND 10000
       OR octet_length(coalesce(v_row->'items', '[]'::jsonb)::text) > 500000 THEN
      RAISE EXCEPTION 'Invalid recipe';
    END IF;
    IF EXISTS (SELECT 1 FROM public.zane_food_recipes r WHERE r.id = v_id AND r.user_id <> v_client) THEN
      RAISE EXCEPTION 'Recipe identifier collision';
    END IF;
    INSERT INTO public.zane_food_recipes AS owned_recipe (id, user_id, name, items, portions, updated_at)
    VALUES (v_id, v_client, trim(v_row->>'name'), coalesce(v_row->'items', '[]'::jsonb), (v_row->>'portions')::integer, now())
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, items = EXCLUDED.items, portions = EXCLUDED.portions, updated_at = now()
    WHERE owned_recipe.user_id = v_client;
  END LOOP;

  INSERT INTO public.zane_food_meal_plans AS owned_plan (id, user_id, name, archived, is_template, coach_id, updated_at)
  VALUES (v_plan_id, v_client, trim(p_plan->>'name'), false, false, v_caller, now())
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, archived = false, is_template = false, coach_id = v_caller, updated_at = now()
  WHERE owned_plan.user_id = v_client AND owned_plan.coach_id = v_caller;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_slots)
  LOOP
    v_id := v_row->>'id';
    IF jsonb_typeof(v_row) <> 'object'
       OR v_id IS NULL
       OR v_id !~ '^mealslot_[a-z0-9]{2,200}$'
       OR v_row->>'meal_plan_id' IS DISTINCT FROM v_plan_id
       OR char_length(trim(coalesce(v_row->>'food_name', ''))) NOT BETWEEN 1 AND 200
       OR coalesce((v_row->>'quantity_g')::numeric, 0) <= 0
       OR coalesce((v_row->>'calories')::integer, -1) < 0
       OR coalesce((v_row->>'protein')::numeric, -1) < 0
       OR coalesce((v_row->>'carbs')::numeric, -1) < 0
       OR coalesce((v_row->>'fat')::numeric, -1) < 0
       OR coalesce((v_row->>'hour')::integer, -1) NOT BETWEEN 0 AND 23
       OR coalesce(v_row->>'day_type', 'any') NOT IN ('any', 'training', 'rest')
       OR (v_row->'recipe_items' IS NOT NULL AND jsonb_typeof(v_row->'recipe_items') NOT IN ('array', 'null')) THEN
      RAISE EXCEPTION 'Invalid meal plan slot';
    END IF;
    IF nullif(v_row->>'recipe_id', '') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM public.zane_food_recipes recipe
         WHERE recipe.id = v_row->>'recipe_id'
           AND recipe.user_id = v_client
       ) THEN
      RAISE EXCEPTION 'Invalid meal plan recipe';
    END IF;
    IF EXISTS (SELECT 1 FROM public.zane_food_template_slots s WHERE s.id = v_id AND s.user_id <> v_client) THEN
      RAISE EXCEPTION 'Meal slot identifier collision';
    END IF;
    INSERT INTO public.zane_food_template_slots AS owned_slot (
      id, user_id, food_id, food_name, brand, source, quantity_g, calories,
      protein, carbs, fat, fiber, sugar, sat_fat, sodium_mg, recipe_items,
      recipe_id, logged_total_portions, logged_cooked_grams,
      logged_cooked_weight_g, hour, day_type, sort_idx, meal_plan_id
    ) VALUES (
      v_id, v_client, nullif(v_row->>'food_id', ''), trim(v_row->>'food_name'),
      nullif(left(v_row->>'brand', 200), ''), nullif(left(v_row->>'source', 40), ''),
      (v_row->>'quantity_g')::numeric, (v_row->>'calories')::integer,
      (v_row->>'protein')::numeric, (v_row->>'carbs')::numeric, (v_row->>'fat')::numeric,
      (v_row->>'fiber')::numeric, (v_row->>'sugar')::numeric, (v_row->>'sat_fat')::numeric,
      (v_row->>'sodium_mg')::numeric, v_row->'recipe_items', nullif(v_row->>'recipe_id', ''),
      (v_row->>'logged_total_portions')::integer, (v_row->>'logged_cooked_grams')::numeric,
      (v_row->>'logged_cooked_weight_g')::numeric, (v_row->>'hour')::integer,
      coalesce(v_row->>'day_type', 'any'), coalesce((v_row->>'sort_idx')::integer, 0), v_plan_id
    )
    ON CONFLICT (id) DO UPDATE SET
      food_id = EXCLUDED.food_id, food_name = EXCLUDED.food_name, brand = EXCLUDED.brand,
      source = EXCLUDED.source, quantity_g = EXCLUDED.quantity_g, calories = EXCLUDED.calories,
      protein = EXCLUDED.protein, carbs = EXCLUDED.carbs, fat = EXCLUDED.fat,
      fiber = EXCLUDED.fiber, sugar = EXCLUDED.sugar, sat_fat = EXCLUDED.sat_fat,
      sodium_mg = EXCLUDED.sodium_mg, recipe_items = EXCLUDED.recipe_items,
      recipe_id = EXCLUDED.recipe_id, logged_total_portions = EXCLUDED.logged_total_portions,
      logged_cooked_grams = EXCLUDED.logged_cooked_grams,
      logged_cooked_weight_g = EXCLUDED.logged_cooked_weight_g, hour = EXCLUDED.hour,
      day_type = EXCLUDED.day_type, sort_idx = EXCLUDED.sort_idx, meal_plan_id = v_plan_id
    WHERE owned_slot.user_id = v_client;
  END LOOP;

  INSERT INTO public.zane_user_settings (user_id, plan_mode, active_meal_template_id)
  VALUES (v_client, true, CASE WHEN p_activate THEN v_plan_id ELSE NULL END)
  ON CONFLICT (user_id) DO UPDATE SET
    plan_mode = true,
    active_meal_template_id = CASE
      WHEN p_activate THEN v_plan_id
      ELSE public.zane_user_settings.active_meal_template_id
    END;
  RETURN v_plan_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.push_medication_plan_to_client(
  p_coaching_id text,
  p_operation_id text,
  p_plan jsonb,
  p_medications jsonb,
  p_plan_items jsonb,
  p_schedule_slots jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_client uuid;
  v_existing_plan public.zane_medication_plans%ROWTYPE;
  v_row jsonb;
  v_id text;
  v_medication_id text;
  v_plan_id text := p_plan->>'id';
  v_weekdays integer[];
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT c.client_id INTO v_client
  FROM public.zane_coaching c
  WHERE c.id = p_coaching_id
    AND c.coach_id = v_caller
    AND c.status = 'active'
    AND c.id NOT LIKE 'support_%'
  FOR UPDATE;
  IF v_client IS NULL THEN RAISE EXCEPTION 'Active coaching relationship required'; END IF;
  IF p_plan IS NULL OR jsonb_typeof(p_plan) <> 'object'
     OR p_medications IS NULL OR jsonb_typeof(p_medications) <> 'array'
     OR p_plan_items IS NULL OR jsonb_typeof(p_plan_items) <> 'array'
     OR p_schedule_slots IS NULL OR jsonb_typeof(p_schedule_slots) <> 'array'
     OR p_operation_id IS DISTINCT FROM v_plan_id
     OR v_plan_id !~ '^medpush_[a-z0-9]{2,200}$'
     OR char_length(trim(coalesce(p_plan->>'name', ''))) NOT BETWEEN 1 AND 200
     OR jsonb_array_length(p_medications) > 100
     OR jsonb_array_length(p_plan_items) > 500
     OR jsonb_array_length(p_schedule_slots) > 1000
     OR octet_length((p_plan || jsonb_build_object('medications', p_medications, 'items', p_plan_items, 'slots', p_schedule_slots))::text) > 1000000 THEN
    RAISE EXCEPTION 'Invalid medication plan payload';
  END IF;

  SELECT p.* INTO v_existing_plan
  FROM public.zane_medication_plans p
  WHERE p.id = v_plan_id
  FOR UPDATE;
  IF v_existing_plan.id IS NOT NULL
     AND (v_existing_plan.user_id <> v_client OR v_existing_plan.coach_id IS DISTINCT FROM v_caller) THEN
    RAISE EXCEPTION 'Plan identifier collision';
  END IF;
  -- The deterministic operation id makes a later response-loss retry a no-op.
  -- In particular, do not overwrite inventory preferences the client may have
  -- set after the first successful push.
  IF v_existing_plan.id IS NOT NULL THEN RETURN v_plan_id; END IF;

  INSERT INTO public.zane_medication_plans AS owned_plan (id, user_id, name, archived, is_template, coach_id, active, updated_at)
  VALUES (v_plan_id, v_client, trim(p_plan->>'name'), false, false, v_caller, true, now())
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, archived = false, is_template = false, coach_id = v_caller,
    active = true, updated_at = now()
  WHERE owned_plan.user_id = v_client AND owned_plan.coach_id = v_caller;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_medications)
  LOOP
    v_id := v_row->>'id';
    IF jsonb_typeof(v_row) <> 'object'
       OR v_id IS NULL
       OR v_id !~ '^pushmed_[a-z0-9]{2,200}$'
       OR char_length(trim(coalesce(v_row->>'name', ''))) NOT BETWEEN 1 AND 200
       OR char_length(coalesce(v_row->>'unit_label', 'pills')) NOT BETWEEN 1 AND 40
       OR ((v_row->>'package_size') IS NOT NULL AND (v_row->>'package_size')::numeric <= 0) THEN
      RAISE EXCEPTION 'Invalid medication';
    END IF;
    IF EXISTS (SELECT 1 FROM public.zane_medications m WHERE m.id = v_id AND m.user_id <> v_client) THEN
      RAISE EXCEPTION 'Medication identifier collision';
    END IF;
    INSERT INTO public.zane_medications AS owned_medication (
      id, user_id, name, brand, category, unit_label, package_size,
      stock_baseline, stock_set_at, archived, exclude_from_pillbox,
      low_stock_threshold, exclude_from_low_stock, track_stock, updated_at
    ) VALUES (
      v_id, v_client, trim(v_row->>'name'), nullif(left(v_row->>'brand', 200), ''),
      nullif(left(v_row->>'category', 80), ''), coalesce(nullif(left(v_row->>'unit_label', 40), ''), 'pills'),
      (v_row->>'package_size')::numeric, NULL, NULL, coalesce((v_row->>'archived')::boolean, false),
      false, NULL, false, false, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, brand = EXCLUDED.brand, category = EXCLUDED.category,
      unit_label = EXCLUDED.unit_label, package_size = EXCLUDED.package_size,
      stock_baseline = NULL, stock_set_at = NULL, archived = EXCLUDED.archived,
      exclude_from_pillbox = false, low_stock_threshold = NULL,
      exclude_from_low_stock = false, track_stock = false, updated_at = now()
    WHERE owned_medication.user_id = v_client;
  END LOOP;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_plan_items)
  LOOP
    v_id := v_row->>'id';
    v_medication_id := v_row->>'medication_id';
    IF jsonb_typeof(v_row) <> 'object'
       OR v_id IS NULL
       OR v_id !~ '^meditem_[a-z0-9]{2,200}$'
       OR v_row->>'medication_plan_id' IS DISTINCT FROM v_plan_id
       OR NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(p_medications) AS source_medication(value)
         WHERE source_medication.value->>'id' = v_medication_id
       )
       OR NOT EXISTS (
         SELECT 1
         FROM public.zane_medications m
         WHERE m.id = v_medication_id AND m.user_id = v_client
       ) THEN
      RAISE EXCEPTION 'Invalid medication plan item';
    END IF;
    IF EXISTS (SELECT 1 FROM public.zane_medication_plan_items i WHERE i.id = v_id AND i.user_id <> v_client) THEN
      RAISE EXCEPTION 'Medication plan item identifier collision';
    END IF;
    INSERT INTO public.zane_medication_plan_items AS owned_item (id, user_id, medication_plan_id, medication_id)
    VALUES (v_id, v_client, v_plan_id, v_medication_id)
    ON CONFLICT (id) DO UPDATE SET medication_plan_id = v_plan_id, medication_id = EXCLUDED.medication_id
    WHERE owned_item.user_id = v_client;
  END LOOP;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_schedule_slots)
  LOOP
    v_id := v_row->>'id';
    v_medication_id := v_row->>'medication_id';
    IF jsonb_typeof(v_row) <> 'object'
       OR v_id IS NULL
       OR v_id !~ '^medslot_[a-z0-9]{2,200}$'
       OR v_row->>'medication_plan_id' IS DISTINCT FROM v_plan_id
       OR jsonb_typeof(coalesce(v_row->'weekdays', '[0,1,2,3,4,5,6]'::jsonb)) <> 'array'
       OR coalesce((v_row->>'hour')::integer, -1) NOT BETWEEN 0 AND 23
       OR coalesce((v_row->>'dose_qty')::numeric, 0) <= 0
       OR ((v_row->>'interval_days') IS NOT NULL AND (v_row->>'interval_days')::integer <= 0)
       OR ((v_row->>'interval_days') IS NOT NULL AND (v_row->>'start_date') IS NULL)
       OR ((v_row->>'start_date') IS NOT NULL AND (v_row->>'end_date') IS NOT NULL
         AND (v_row->>'end_date')::date < (v_row->>'start_date')::date)
       OR NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(p_medications) AS source_medication(value)
         WHERE source_medication.value->>'id' = v_medication_id
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.zane_medications m
         WHERE m.id = v_medication_id AND m.user_id = v_client
       ) THEN
      RAISE EXCEPTION 'Invalid medication schedule slot';
    END IF;
    SELECT coalesce(array_agg(value::integer), ARRAY[]::integer[]) INTO v_weekdays
    FROM jsonb_array_elements_text(coalesce(v_row->'weekdays', '[0,1,2,3,4,5,6]'::jsonb));
    IF EXISTS (SELECT 1 FROM unnest(v_weekdays) weekday WHERE weekday NOT BETWEEN 0 AND 6) THEN
      RAISE EXCEPTION 'Invalid weekdays';
    END IF;
    IF EXISTS (SELECT 1 FROM public.zane_medication_schedule_slots s WHERE s.id = v_id AND s.user_id <> v_client) THEN
      RAISE EXCEPTION 'Medication slot identifier collision';
    END IF;
    INSERT INTO public.zane_medication_schedule_slots AS owned_slot (
      id, user_id, medication_id, medication_plan_id, weekdays, hour,
      dose_qty, interval_days, start_date, end_date, updated_at
    ) VALUES (
      v_id, v_client, v_medication_id, v_plan_id, v_weekdays,
      (v_row->>'hour')::integer, (v_row->>'dose_qty')::numeric,
      (v_row->>'interval_days')::integer, (v_row->>'start_date')::date,
      (v_row->>'end_date')::date, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      medication_id = EXCLUDED.medication_id, medication_plan_id = v_plan_id,
      weekdays = EXCLUDED.weekdays, hour = EXCLUDED.hour, dose_qty = EXCLUDED.dose_qty,
      interval_days = EXCLUDED.interval_days, start_date = EXCLUDED.start_date,
      end_date = EXCLUDED.end_date, updated_at = now()
    WHERE owned_slot.user_id = v_client;
  END LOOP;

  INSERT INTO public.zane_user_settings (user_id, meds_enabled)
  VALUES (v_client, true)
  ON CONFLICT (user_id) DO UPDATE SET meds_enabled = true;
  RETURN v_plan_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_import_plan_share(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_import_plan_share(uuid, jsonb, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.push_training_plan_to_client(text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.push_training_plan_to_client(text, text, jsonb, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.push_meal_plan_to_client(text, text, jsonb, jsonb, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.push_meal_plan_to_client(text, text, jsonb, jsonb, jsonb, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.push_medication_plan_to_client(text, text, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.push_medication_plan_to_client(text, text, jsonb, jsonb, jsonb, jsonb) TO authenticated;
