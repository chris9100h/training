-- Atomic, resumable personal-backup restore.
--
-- Uploading is intentionally separate from applying: authenticated callers stage
-- bounded, canonically hashed chunks in app_private, then one final RPC validates
-- the complete normalized payload and replaces only the documented personal-data
-- tables in a single transaction.  The staging protocol is versioned independently
-- from the backup-file format so older files can be normalized client-side without
-- weakening the database contract.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS app_private.zane_backup_restore_jobs (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_id text NOT NULL,
  manifest jsonb NOT NULL,
  manifest_hash text NOT NULL,
  status text NOT NULL DEFAULT 'staging'
    CHECK (status IN ('staging', 'committed')),
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  committed_at timestamptz,
  PRIMARY KEY (owner_id, operation_id),
  CHECK (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  CHECK ((status = 'staging' AND receipt IS NULL AND committed_at IS NULL)
      OR (status = 'committed' AND receipt IS NOT NULL AND committed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS app_private.zane_backup_restore_chunks (
  owner_id uuid NOT NULL,
  operation_id text NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  section text NOT NULL,
  section_offset integer NOT NULL CHECK (section_offset >= 0),
  row_count integer NOT NULL CHECK (row_count >= 0),
  chunk_hash text NOT NULL CHECK (chunk_hash ~ '^[0-9a-f]{64}$'),
  byte_count integer NOT NULL CHECK (byte_count > 0 AND byte_count <= 245760),
  chunk jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, operation_id, chunk_index),
  FOREIGN KEY (owner_id, operation_id)
    REFERENCES app_private.zane_backup_restore_jobs(owner_id, operation_id)
    ON DELETE CASCADE
);

ALTER TABLE app_private.zane_backup_restore_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.zane_backup_restore_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.zane_backup_restore_jobs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON app_private.zane_backup_restore_chunks FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.backup_restore_sections()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT ARRAY[
    'profile',
    'exercises',
    'schedules',
    'sessions',
    'session_entries',
    'sets',
    'settings',
    'skips',
    'cardio_logs',
    'daily_logs',
    'water_logs',
    'adaptive_tdee_history',
    'food_recipes',
    'food_meal_plans',
    'food_template_slots',
    'food_logs',
    'food_favorites',
    'food_barcode_overrides',
    'food_shopping_prefs',
    'food_template_days',
    'medication_plans',
    'medications',
    'medication_plan_items',
    'medication_schedule_slots',
    'medication_logs',
    'workout_templates',
    'checkin_schema_templates',
    'glucose_logs',
    'blood_pressure_logs',
    'body_temp_logs',
    'cardio_plans',
    'status_periods',
    'meso_states'
  ]::text[];
$function$;

CREATE OR REPLACE FUNCTION app_private.backup_restore_allowed_columns(p_section text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE p_section
    WHEN 'profile' THEN ARRAY['name','x_handle','x_handle_public','x_handle_prompt_opted_out']
    WHEN 'exercises' THEN ARRAY['id','name','tags','note','category','unilateral','equipment','progression_reps','movement_type','no_weight_reps','log_mode','pull_bodyweight','bodyweight_mode','youtube_url','note_pinned','progression_increment','horn_labels']
    WHEN 'schedules' THEN ARRAY['id','name','days','archived','versions','is_flex','sessions_per_week','mesocycle_weeks','mesocycle_start_rir','mesocycle_end_rir','mesocycle_rir_enabled','mesocycle_autoregulate','mesocycle_autoregulate_mode','program_type','program_data','is_template']
    WHEN 'sessions' THEN ARRAY['id','schedule_id','day_id','day_name','date','ended','started_at','duration_minutes','feel','is_bonus','is_freestyle','is_deload','is_cleanup','meso_recap','readiness','signal_weight','cycle_pos','imported']
    WHEN 'session_entries' THEN ARRAY['id','session_id','entry_idx','ex_id','name','planned_sets','planned_reps','planned_reps_per_set','planned_reps_max','planned_progression_offset','planned_techniques','note','superset_group']
    WHEN 'sets' THEN ARRAY['id','session_id','entry_id','set_idx','kg','reps','reps_l','reps_r','time_sec','added_kg','done','skipped','warmup','technique','drops','horn_loads']
    WHEN 'settings' THEN ARRAY['active_schedule_id','active_meal_template_id','cycle_index','cycle_start_date','week_plan_start_date','last_advanced_date','in_progress_session_id','unit','rest_default','rest_big','rest_medium','rest_small','auto_open_rest_timer','cycle_week_view','week_start_day','accent_color','dark_mode','custom_day_types','reminder_enabled','reminder_time','tempo_enabled','tempo_eccentric','tempo_concentric','smart_progression','progression_range_top','equipment_config','weight_fill_down','net_carbs','food_force_grams','plan_mode','hide_food_categories','show_warmup_in_summary','session_timeout_minutes','macro_targets','macro_calc','meal_windows','meal_categories','fasting_protocol','show_health_tab','show_water_tab','show_food_tab','onboarding_completed','show_regression','pin_all_notes','glucose_unit','temp_unit','hidden_health_cards','fever_threshold_c','cleanup_percent','watermark_opacity','default_checkin_schema','vip_background','active_cardio_plan_id','status_mode','status_mode_since','deload_prompt_dismissed_at','water_goal_ml','water_start_time','water_end_time','water_bottles_today','water_bottles_date','water_drinks','water_coffee_sizes','water_bottle_enabled','water_bottle_ml','water_reminder_enabled','meal_reminder_enabled','meds_enabled','medication_reminder_enabled','daily_log_reminder_enabled','daily_log_reminder_time','pillbox_slots']
    WHEN 'skips' THEN ARRAY['id','date','day_id','day_name','skip_reason','skipped_at']
    WHEN 'cardio_logs' THEN ARRAY['id','date','type','duration_minutes','distance_m','pace_feeling','effort','note','session_id']
    WHEN 'daily_logs' THEN ARRAY['id','date','weight','steps','waist_cm','hips_cm','chest_cm','arm_cm','thigh_cm','calf_cm','body_fat_pct','calories','protein','carbs','fat','fiber','water_ml','note','off_plan_note','meal_of_choice','meal_of_choice_hour','food_day_closed','adherence','targets_snap','daily_coach_fields','ai_summary','ai_summary_generated_at']
    WHEN 'water_logs' THEN ARRAY['id','date','time','amount_ml','name','category','breakdown']
    WHEN 'adaptive_tdee_history' THEN ARRAY['as_of_date','window_start','window_end','tdee_kcal','avg_calories_kcal','weight_start_kg','weight_end_kg','weight_change_kg','weight_rate_kg_week','day_span','calorie_days','weigh_ins','decision','source','targets_snapshot','calculated_at','decided_at','created_at','updated_at']
    WHEN 'food_recipes' THEN ARRAY['id','name','items','portions','cooked_weight_g','updated_at']
    WHEN 'food_meal_plans' THEN ARRAY['id','name','archived','is_template','updated_at']
    WHEN 'food_template_slots' THEN ARRAY['id','food_id','food_name','brand','source','quantity_g','calories','protein','carbs','fat','fiber','sugar','sat_fat','sodium_mg','recipe_items','recipe_id','logged_total_portions','logged_cooked_grams','logged_cooked_weight_g','hour','day_type','sort_idx','meal_plan_id']
    WHEN 'food_logs' THEN ARRAY['id','date','time','food_id','food_name','brand','source','quantity_g','calories','protein','carbs','fat','fiber','sugar','sat_fat','sodium_mg','recipe_items','recipe_id','logged_total_portions','logged_cooked_grams','logged_cooked_weight_g','logged_unit','split_batch','planned','template_slot_id']
    WHEN 'food_favorites' THEN ARRAY['id','food_id','food_name','brand','source','quantity_g','calories','protein','carbs','fat','fiber','sugar','sat_fat','sodium_mg','units']
    WHEN 'food_barcode_overrides' THEN ARRAY['source','source_id','food_name','brand','kcal_per_100g','protein_per_100g','carbs_per_100g','fat_per_100g','created_at','updated_at']
    WHEN 'food_shopping_prefs' THEN ARRAY['id','food_id','shopping_key','name_override','excluded','excluded_until','package_size_g','low_stock_threshold_g','stock_baseline_g','stock_set_at','food_name','brand','updated_at']
    WHEN 'food_template_days' THEN ARRAY['id','date']
    WHEN 'medication_plans' THEN ARRAY['id','name','archived','is_template','active','updated_at']
    WHEN 'medications' THEN ARRAY['id','name','brand','category','unit_label','package_size','low_stock_threshold','stock_baseline','stock_set_at','archived','exclude_from_pillbox','exclude_from_low_stock','track_stock','updated_at']
    WHEN 'medication_plan_items' THEN ARRAY['id','medication_plan_id','medication_id']
    WHEN 'medication_schedule_slots' THEN ARRAY['id','medication_id','medication_plan_id','weekdays','hour','dose_qty','interval_days','start_date','end_date','updated_at']
    WHEN 'medication_logs' THEN ARRAY['id','medication_id','medication_name','date','time','dose_qty','planned','skipped','schedule_slot_id','reminder_sent_at','reminder_count','snoozed_until']
    WHEN 'workout_templates' THEN ARRAY['id','name','exercises']
    WHEN 'checkin_schema_templates' THEN ARRAY['id','name','schema']
    WHEN 'glucose_logs' THEN ARRAY['id','date','time','value_mmol','context','note']
    WHEN 'blood_pressure_logs' THEN ARRAY['id','date','time','systolic','diastolic','note']
    WHEN 'body_temp_logs' THEN ARRAY['id','date','time','value_c','note']
    WHEN 'cardio_plans' THEN ARRAY['id','name','activity_type','archived','mode','days','manual_targets','goal','goal_due_date','start_fitness','generated_weeks','plan_start_date']
    WHEN 'status_periods' THEN ARRAY['id','mode','started_at','ended_at']
    WHEN 'meso_states' THEN ARRAY['schedule_id','weeks','start_date','start_cycle_index','started_at','deltas','weight_boosts','weight_boost_declines','joint_flags','pump_low_counts','growth_counts','rep_miss_counts','affinity','autoreg_state','completions','pending_meso2']
    ELSE NULL::text[]
  END;
$function$;

CREATE OR REPLACE FUNCTION app_private.backup_restore_canonical_json(p_value jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
DECLARE
  v_type text := pg_catalog.jsonb_typeof(p_value);
  v_result text;
BEGIN
  IF v_type = 'object' THEN
    SELECT '{' || COALESCE(pg_catalog.string_agg(
      pg_catalog.to_jsonb(item.key)::text || ':' || app_private.backup_restore_canonical_json(item.value),
      ',' ORDER BY item.key COLLATE "C"
    ), '') || '}'
    INTO v_result
    FROM pg_catalog.jsonb_each(p_value) AS item;
    RETURN v_result;
  ELSIF v_type = 'array' THEN
    SELECT '[' || COALESCE(pg_catalog.string_agg(
      app_private.backup_restore_canonical_json(item.value),
      ',' ORDER BY item.ordinality
    ), '') || ']'
    INTO v_result
    FROM pg_catalog.jsonb_array_elements(p_value) WITH ORDINALITY AS item(value, ordinality);
    RETURN v_result;
  END IF;
  RETURN p_value::text;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.backup_restore_hash(p_value jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(app_private.backup_restore_canonical_json(p_value), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$function$;

CREATE OR REPLACE FUNCTION app_private.backup_restore_validate_manifest(
  p_operation_id text,
  p_manifest jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_chunks jsonb;
  v_totals jsonb;
  v_chunk_count integer;
  v_row_count bigint;
  v_byte_count bigint;
  v_profile_rows bigint;
  v_settings_rows bigint;
BEGIN
  IF p_operation_id IS NULL
     OR p_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  THEN
    RAISE EXCEPTION 'invalid backup restore operation_id';
  END IF;
  IF p_manifest IS NULL OR pg_catalog.jsonb_typeof(p_manifest) <> 'object' THEN
    RAISE EXCEPTION 'backup restore manifest must be an object';
  END IF;
  IF (SELECT pg_catalog.array_agg(key ORDER BY key)
      FROM pg_catalog.jsonb_object_keys(p_manifest) AS key)
     IS DISTINCT FROM ARRAY['chunks','normalizer_version','operation_id','totals','version']::text[]
  THEN
    RAISE EXCEPTION 'backup restore manifest has unknown or missing keys';
  END IF;
  IF p_manifest->>'operation_id' IS DISTINCT FROM p_operation_id
     OR pg_catalog.jsonb_typeof(p_manifest->'version') <> 'number'
     OR p_manifest->>'version' <> '1'
     OR pg_catalog.jsonb_typeof(p_manifest->'normalizer_version') <> 'number'
     OR p_manifest->>'normalizer_version' <> '1'
  THEN
    RAISE EXCEPTION 'unsupported backup restore manifest version';
  END IF;

  v_chunks := p_manifest->'chunks';
  v_totals := p_manifest->'totals';
  IF pg_catalog.jsonb_typeof(v_chunks) <> 'array'
     OR pg_catalog.jsonb_typeof(v_totals) <> 'object'
  THEN
    RAISE EXCEPTION 'backup restore manifest chunks/totals are malformed';
  END IF;
  IF (SELECT pg_catalog.array_agg(key ORDER BY key)
      FROM pg_catalog.jsonb_object_keys(v_totals) AS key)
     IS DISTINCT FROM ARRAY['byte_count','chunk_count','row_count']::text[]
  THEN
    RAISE EXCEPTION 'backup restore totals have unknown or missing keys';
  END IF;
  IF pg_catalog.jsonb_typeof(v_totals->'chunk_count') <> 'number'
     OR pg_catalog.jsonb_typeof(v_totals->'row_count') <> 'number'
     OR pg_catalog.jsonb_typeof(v_totals->'byte_count') <> 'number'
     OR v_totals->>'chunk_count' !~ '^[0-9]+$'
     OR v_totals->>'row_count' !~ '^[0-9]+$'
     OR v_totals->>'byte_count' !~ '^[0-9]+$'
  THEN
    RAISE EXCEPTION 'backup restore totals must be non-negative integers';
  END IF;
  v_chunk_count := (v_totals->>'chunk_count')::integer;
  v_row_count := (v_totals->>'row_count')::bigint;
  v_byte_count := (v_totals->>'byte_count')::bigint;
  IF v_chunk_count < 33 OR v_chunk_count > 512
     OR pg_catalog.jsonb_array_length(v_chunks) <> v_chunk_count
     OR v_row_count < 1 OR v_row_count > 500000
     OR v_byte_count < 1 OR v_byte_count > 33554432
  THEN
    RAISE EXCEPTION 'backup restore totals exceed protocol limits';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_chunks) AS descriptor
    WHERE pg_catalog.jsonb_typeof(descriptor) <> 'object'
       OR (SELECT pg_catalog.array_agg(key ORDER BY key)
           FROM pg_catalog.jsonb_object_keys(descriptor) AS key)
          IS DISTINCT FROM ARRAY['hash','index','offset','row_count','section']::text[]
       OR pg_catalog.jsonb_typeof(descriptor->'index') <> 'number'
       OR descriptor->>'index' !~ '^[0-9]+$'
       OR pg_catalog.jsonb_typeof(descriptor->'offset') <> 'number'
       OR descriptor->>'offset' !~ '^[0-9]+$'
       OR pg_catalog.jsonb_typeof(descriptor->'row_count') <> 'number'
       OR descriptor->>'row_count' !~ '^[0-9]+$'
       OR (descriptor->>'index')::bigint > 511
       OR (descriptor->>'row_count')::bigint > 10000
       OR NOT (descriptor->>'section' = ANY(app_private.backup_restore_sections()))
       OR descriptor->>'hash' !~ '^[0-9a-f]{64}$'
  ) THEN
    RAISE EXCEPTION 'backup restore chunk descriptor is malformed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(app_private.backup_restore_sections()) AS required(section)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(v_chunks) AS descriptor
      WHERE descriptor->>'section' = required.section
    )
  ) THEN
    RAISE EXCEPTION 'backup restore manifest omits a required section';
  END IF;

  IF (SELECT pg_catalog.count(DISTINCT (descriptor->>'index')::integer)
      FROM pg_catalog.jsonb_array_elements(v_chunks) AS descriptor) <> v_chunk_count
     OR (SELECT pg_catalog.min((descriptor->>'index')::integer)
         FROM pg_catalog.jsonb_array_elements(v_chunks) AS descriptor) <> 0
     OR (SELECT pg_catalog.max((descriptor->>'index')::integer)
         FROM pg_catalog.jsonb_array_elements(v_chunks) AS descriptor) <> v_chunk_count - 1
  THEN
    RAISE EXCEPTION 'backup restore chunk indexes must be unique and contiguous';
  END IF;

  IF EXISTS (
    WITH descriptors AS (
      SELECT descriptor->>'section' AS section,
             (descriptor->>'index')::integer AS chunk_index,
             (descriptor->>'offset')::integer AS section_offset,
             (descriptor->>'row_count')::integer AS row_count
      FROM pg_catalog.jsonb_array_elements(v_chunks) AS descriptor
    ), ordered AS (
      SELECT *, COALESCE(pg_catalog.sum(row_count) OVER (
        PARTITION BY section ORDER BY section_offset, chunk_index
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0) AS expected_offset
      FROM descriptors
    )
    SELECT 1 FROM ordered WHERE section_offset <> expected_offset
  ) THEN
    RAISE EXCEPTION 'backup restore section offsets must be contiguous from zero';
  END IF;

  IF (SELECT pg_catalog.sum((descriptor->>'row_count')::bigint)
      FROM pg_catalog.jsonb_array_elements(v_chunks) AS descriptor) <> v_row_count
  THEN
    RAISE EXCEPTION 'backup restore manifest row_count mismatch';
  END IF;

  SELECT COALESCE(pg_catalog.sum((descriptor->>'row_count')::bigint), 0)
  INTO v_profile_rows
  FROM pg_catalog.jsonb_array_elements(v_chunks) AS descriptor
  WHERE descriptor->>'section' = 'profile';
  SELECT COALESCE(pg_catalog.sum((descriptor->>'row_count')::bigint), 0)
  INTO v_settings_rows
  FROM pg_catalog.jsonb_array_elements(v_chunks) AS descriptor
  WHERE descriptor->>'section' = 'settings';
  IF v_profile_rows > 1 OR v_settings_rows <> 1 THEN
    RAISE EXCEPTION 'backup restore requires at most one profile and exactly one settings row';
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION app_private.backup_restore_sections()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION app_private.backup_restore_allowed_columns(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION app_private.backup_restore_canonical_json(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION app_private.backup_restore_hash(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION app_private.backup_restore_validate_manifest(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.begin_backup_restore(
  p_operation_id text,
  p_manifest jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_manifest_hash text;
  v_job app_private.zane_backup_restore_jobs%ROWTYPE;
  v_staged_indexes jsonb;
  v_declared_bytes bigint;
  v_active_jobs bigint;
  v_active_declared_bytes bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM app_private.backup_restore_validate_manifest(p_operation_id, p_manifest);
  v_manifest_hash := app_private.backup_restore_hash(p_manifest);
  v_declared_bytes := (p_manifest->'totals'->>'byte_count')::bigint;

  -- Serialize staging lifecycle changes per owner. Without this lock a caller
  -- could race many distinct operation IDs past the quota checks below.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_uid::text, 20260822120716)
  );

  SELECT job.*
  INTO v_job
  FROM app_private.zane_backup_restore_jobs AS job
  WHERE job.owner_id = v_uid
    AND job.operation_id = p_operation_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_job.manifest_hash IS DISTINCT FROM v_manifest_hash
       OR v_job.manifest IS DISTINCT FROM p_manifest
    THEN
      RAISE EXCEPTION 'backup restore operation_id is already bound to another manifest';
    END IF;
    IF v_job.status = 'committed' THEN
      -- Receipts support lost-response replay, but they are not an unbounded
      -- permanent audit log. Keep the current receipt and prune older ones.
      DELETE FROM app_private.zane_backup_restore_jobs AS old_job
      WHERE old_job.owner_id = v_uid
        AND old_job.status = 'committed'
        AND old_job.operation_id <> p_operation_id
        AND (
          old_job.committed_at < now() - interval '30 days'
          OR old_job.operation_id IN (
            SELECT ranked.operation_id
            FROM app_private.zane_backup_restore_jobs AS ranked
            WHERE ranked.owner_id = v_uid
              AND ranked.status = 'committed'
              AND ranked.operation_id <> p_operation_id
            ORDER BY ranked.committed_at DESC, ranked.operation_id DESC
            OFFSET 19
          )
        );
      RETURN v_job.receipt;
    END IF;
    IF v_job.expires_at > now() THEN
      UPDATE app_private.zane_backup_restore_jobs
      SET updated_at = now(),
          expires_at = now() + interval '24 hours'
      WHERE owner_id = v_uid
        AND operation_id = p_operation_id;

      SELECT COALESCE(pg_catalog.jsonb_agg(chunk.chunk_index ORDER BY chunk.chunk_index), '[]'::jsonb)
      INTO v_staged_indexes
      FROM app_private.zane_backup_restore_chunks AS chunk
      WHERE chunk.owner_id = v_uid
        AND chunk.operation_id = p_operation_id;

      RETURN pg_catalog.jsonb_build_object(
        'operation_id', p_operation_id,
        'status', 'staging',
        'manifest_hash', v_manifest_hash,
        'staged_indexes', v_staged_indexes
      );
    END IF;

    -- Restarting the same expired operation discards its inert chunks first.
    DELETE FROM app_private.zane_backup_restore_jobs
    WHERE owner_id = v_uid
      AND operation_id = p_operation_id;
  END IF;

  -- Expired uploads are physically removed, including chunks through CASCADE.
  DELETE FROM app_private.zane_backup_restore_jobs AS expired_job
  WHERE expired_job.owner_id = v_uid
    AND expired_job.status = 'staging'
    AND expired_job.expires_at <= now();

  -- Bound the otherwise durable idempotency receipts independently from the
  -- active-upload quota.
  DELETE FROM app_private.zane_backup_restore_jobs AS old_job
  WHERE old_job.owner_id = v_uid
    AND old_job.status = 'committed'
    AND (
      old_job.committed_at < now() - interval '30 days'
      OR old_job.operation_id IN (
        SELECT ranked.operation_id
        FROM app_private.zane_backup_restore_jobs AS ranked
        WHERE ranked.owner_id = v_uid
          AND ranked.status = 'committed'
        ORDER BY ranked.committed_at DESC, ranked.operation_id DESC
        OFFSET 20
      )
    );

  SELECT pg_catalog.count(*),
         COALESCE(pg_catalog.sum((job.manifest->'totals'->>'byte_count')::bigint), 0)
  INTO v_active_jobs, v_active_declared_bytes
  FROM app_private.zane_backup_restore_jobs AS job
  WHERE job.owner_id = v_uid
    AND job.status = 'staging'
    AND job.expires_at > now();

  IF v_active_jobs >= 2 THEN
    RAISE EXCEPTION 'backup restore already has the maximum of two active uploads';
  END IF;
  IF v_active_declared_bytes + v_declared_bytes > 41943040 THEN
    RAISE EXCEPTION 'backup restore active uploads exceed the 40 MiB owner limit';
  END IF;

  INSERT INTO app_private.zane_backup_restore_jobs (
    owner_id, operation_id, manifest, manifest_hash
  ) VALUES (
    v_uid, p_operation_id, p_manifest, v_manifest_hash
  );

  RETURN pg_catalog.jsonb_build_object(
    'operation_id', p_operation_id,
    'status', 'staging',
    'manifest_hash', v_manifest_hash,
    'staged_indexes', '[]'::jsonb
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.stage_backup_restore_chunk(
  p_operation_id text,
  p_chunk_index integer,
  p_chunk jsonb,
  p_chunk_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_job app_private.zane_backup_restore_jobs%ROWTYPE;
  v_descriptor jsonb;
  v_section text;
  v_offset integer;
  v_row_count integer;
  v_byte_count integer;
  v_allowed_columns text[];
  v_existing app_private.zane_backup_restore_chunks%ROWTYPE;
  v_staged_indexes jsonb;
  v_staged_bytes bigint;
  v_owner_staged_bytes bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_operation_id IS NULL
     OR p_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
     OR p_chunk_index IS NULL OR p_chunk_index < 0
     OR p_chunk_hash IS NULL OR p_chunk_hash !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'invalid backup restore chunk identity';
  END IF;

  -- Serialize owner-wide actual-byte accounting with begin and every other
  -- chunk upload. Manifest byte counts are produced by browser JSON while
  -- Postgres stores jsonb canonically, so only actual server bytes enforce the
  -- hard quota below.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_uid::text, 20260822120716)
  );

  SELECT job.*
  INTO v_job
  FROM app_private.zane_backup_restore_jobs AS job
  WHERE job.owner_id = v_uid
    AND job.operation_id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'backup restore operation not found';
  END IF;
  IF v_job.status = 'committed' THEN
    RETURN v_job.receipt;
  END IF;
  IF v_job.expires_at <= now() THEN
    RAISE EXCEPTION 'backup restore staging operation expired';
  END IF;

  SELECT descriptor
  INTO v_descriptor
  FROM pg_catalog.jsonb_array_elements(v_job.manifest->'chunks') AS descriptor
  WHERE (descriptor->>'index')::integer = p_chunk_index;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chunk index is not declared by the manifest';
  END IF;

  IF p_chunk IS NULL OR pg_catalog.jsonb_typeof(p_chunk) <> 'object'
     OR (SELECT pg_catalog.array_agg(key ORDER BY key)
         FROM pg_catalog.jsonb_object_keys(p_chunk) AS key)
        IS DISTINCT FROM ARRAY['offset','rows','section']::text[]
     OR pg_catalog.jsonb_typeof(p_chunk->'offset') <> 'number'
     OR p_chunk->>'offset' !~ '^[0-9]+$'
     OR pg_catalog.jsonb_typeof(p_chunk->'rows') <> 'array'
     OR pg_catalog.jsonb_typeof(p_chunk->'section') <> 'string'
  THEN
    RAISE EXCEPTION 'backup restore chunk is malformed';
  END IF;

  v_section := p_chunk->>'section';
  v_offset := (p_chunk->>'offset')::integer;
  v_row_count := pg_catalog.jsonb_array_length(p_chunk->'rows');
  IF v_section IS DISTINCT FROM v_descriptor->>'section'
     OR v_offset IS DISTINCT FROM (v_descriptor->>'offset')::integer
     OR v_row_count IS DISTINCT FROM (v_descriptor->>'row_count')::integer
     OR p_chunk_hash IS DISTINCT FROM v_descriptor->>'hash'
  THEN
    RAISE EXCEPTION 'backup restore chunk does not match its manifest descriptor';
  END IF;

  v_allowed_columns := app_private.backup_restore_allowed_columns(v_section);
  IF v_allowed_columns IS NULL THEN
    RAISE EXCEPTION 'unknown backup restore section';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_chunk->'rows') AS row_data
    WHERE pg_catalog.jsonb_typeof(row_data) <> 'object'
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.jsonb_object_keys(row_data) AS row_key
         WHERE NOT (row_key = ANY(v_allowed_columns))
       )
  ) THEN
    RAISE EXCEPTION 'backup restore row has an invalid shape or forbidden column';
  END IF;

  v_byte_count := pg_catalog.octet_length(
    pg_catalog.convert_to(app_private.backup_restore_canonical_json(p_chunk), 'UTF8')
  );
  IF v_byte_count <= 0 OR v_byte_count > 245760 THEN
    RAISE EXCEPTION 'backup restore chunk exceeds the 245760-byte limit';
  END IF;

  SELECT chunk.*
  INTO v_existing
  FROM app_private.zane_backup_restore_chunks AS chunk
  WHERE chunk.owner_id = v_uid
    AND chunk.operation_id = p_operation_id
    AND chunk.chunk_index = p_chunk_index;
  IF FOUND THEN
    IF v_existing.chunk_hash IS DISTINCT FROM p_chunk_hash
       OR v_existing.chunk IS DISTINCT FROM p_chunk
    THEN
      RAISE EXCEPTION 'staged backup restore chunks are immutable';
    END IF;
  ELSE
    INSERT INTO app_private.zane_backup_restore_chunks (
      owner_id, operation_id, chunk_index, section, section_offset,
      row_count, chunk_hash, byte_count, chunk
    ) VALUES (
      v_uid, p_operation_id, p_chunk_index, v_section, v_offset,
      v_row_count, p_chunk_hash, v_byte_count, p_chunk
    );
  END IF;

  SELECT COALESCE(pg_catalog.sum(chunk.byte_count), 0)
  INTO v_staged_bytes
  FROM app_private.zane_backup_restore_chunks AS chunk
  WHERE chunk.owner_id = v_uid
    AND chunk.operation_id = p_operation_id;
  IF v_staged_bytes > 33554432 THEN
    RAISE EXCEPTION 'backup restore operation exceeds the 32 MiB server-byte limit';
  END IF;

  SELECT COALESCE(pg_catalog.sum(chunk.byte_count), 0)
  INTO v_owner_staged_bytes
  FROM app_private.zane_backup_restore_chunks AS chunk
  JOIN app_private.zane_backup_restore_jobs AS job
    ON job.owner_id = chunk.owner_id
   AND job.operation_id = chunk.operation_id
  WHERE chunk.owner_id = v_uid
    AND job.status = 'staging'
    AND job.expires_at > now();
  IF v_owner_staged_bytes > 41943040 THEN
    RAISE EXCEPTION 'backup restore active uploads exceed the 40 MiB owner limit';
  END IF;

  UPDATE app_private.zane_backup_restore_jobs
  SET updated_at = now()
  WHERE owner_id = v_uid
    AND operation_id = p_operation_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(chunk.chunk_index ORDER BY chunk.chunk_index), '[]'::jsonb)
  INTO v_staged_indexes
  FROM app_private.zane_backup_restore_chunks AS chunk
  WHERE chunk.owner_id = v_uid
    AND chunk.operation_id = p_operation_id;

  RETURN pg_catalog.jsonb_build_object(
    'operation_id', p_operation_id,
    'status', 'staging',
    'chunk_index', p_chunk_index,
    'chunk_hash', p_chunk_hash,
    'staged_indexes', v_staged_indexes
  );
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.backup_restore_rows(
  p_owner_id uuid,
  p_operation_id text,
  p_section text
)
RETURNS TABLE(row_data jsonb)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT element.value
  FROM app_private.zane_backup_restore_chunks AS chunk
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(chunk.chunk->'rows')
    WITH ORDINALITY AS element(value, ordinality)
  WHERE chunk.owner_id = p_owner_id
    AND chunk.operation_id = p_operation_id
    AND chunk.section = p_section
  ORDER BY chunk.section_offset, chunk.chunk_index, element.ordinality;
$function$;

-- Every normal direct write to a restorable table takes the same per-owner
-- transaction lock as commit_backup_restore.  That makes the final replacement
-- mutually exclusive with existing PostgREST sync writes; staging does not take
-- the lock because it never touches live account data.
CREATE OR REPLACE FUNCTION app_private.backup_restore_lock_owner(p_owner_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'backup restore owner lock requires an owner';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_id::text, 20260822120716)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.backup_restore_owner_lock_trigger()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_old_owner uuid;
  v_new_owner uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_owner := CASE WHEN TG_TABLE_NAME = 'zane_profiles'
      THEN (pg_catalog.to_jsonb(OLD)->>'id')::uuid
      ELSE (pg_catalog.to_jsonb(OLD)->>'user_id')::uuid END;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_owner := CASE WHEN TG_TABLE_NAME = 'zane_profiles'
      THEN (pg_catalog.to_jsonb(NEW)->>'id')::uuid
      ELSE (pg_catalog.to_jsonb(NEW)->>'user_id')::uuid END;
  END IF;

  IF v_old_owner IS NOT NULL AND v_new_owner IS NOT NULL
     AND v_old_owner IS DISTINCT FROM v_new_owner
  THEN
    IF v_old_owner::text < v_new_owner::text THEN
      PERFORM app_private.backup_restore_lock_owner(v_old_owner);
      PERFORM app_private.backup_restore_lock_owner(v_new_owner);
    ELSE
      PERFORM app_private.backup_restore_lock_owner(v_new_owner);
      PERFORM app_private.backup_restore_lock_owner(v_old_owner);
    END IF;
  ELSE
    PERFORM app_private.backup_restore_lock_owner(COALESCE(v_new_owner, v_old_owner));
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

DO $do$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'zane_profiles','zane_exercises','zane_schedules','zane_sessions',
    'zane_session_entries','zane_sets','zane_user_settings','zane_skips',
    'zane_cardio_logs','zane_daily_logs','zane_water_logs','zane_adaptive_tdee_history',
    'zane_food_recipes','zane_food_meal_plans','zane_food_template_slots','zane_food_logs',
    'zane_food_favorites','zane_food_barcode_overrides','zane_food_shopping_prefs',
    'zane_food_template_days','zane_medication_plans','zane_medications',
    'zane_medication_plan_items','zane_medication_schedule_slots','zane_medication_logs',
    'zane_workout_templates','zane_checkin_schema_templates','zane_glucose_logs',
    'zane_blood_pressure_logs','zane_body_temp_logs','zane_cardio_plans',
    'zane_status_periods','zane_meso_states'
  ]::text[] LOOP
    EXECUTE pg_catalog.format(
      'DROP TRIGGER IF EXISTS zane_backup_restore_owner_lock ON public.%I',
      v_table
    );
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER zane_backup_restore_owner_lock '
      'BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION app_private.backup_restore_owner_lock_trigger()',
      v_table
    );
  END LOOP;
END;
$do$;

REVOKE EXECUTE ON FUNCTION public.begin_backup_restore(text, jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.begin_backup_restore(text, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.stage_backup_restore_chunk(text, integer, jsonb, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.stage_backup_restore_chunk(text, integer, jsonb, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION app_private.backup_restore_rows(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION app_private.backup_restore_lock_owner(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION app_private.backup_restore_owner_lock_trigger()
  FROM PUBLIC, anon, authenticated, service_role;

-- The restore marker is transaction-local and can only affect work inside the
-- SECURITY DEFINER commit RPC.  Existing sessions keep their immutable server
-- completion stamp; newly restored history gets no stamp, and restored rows do
-- not run the founding-member grant aggregate once per inserted session.
CREATE OR REPLACE FUNCTION public.zane_sessions_stamp_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF pg_catalog.current_setting('zane.backup_restore', true) = 'on' THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.completed_server_at := OLD.completed_server_at;
    ELSE
      NEW.completed_server_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.imported THEN
    NEW.imported := true;
  ELSIF NEW.id LIKE 'import\_%' ESCAPE '\' THEN
    NEW.imported := true;
  ELSE
    NEW.imported := false;
  END IF;
  IF NEW.imported THEN
    NEW.completed_server_at := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.completed_server_at := CASE WHEN NEW.ended IS NOT NULL THEN now() ELSE NULL END;
    RETURN NEW;
  END IF;
  IF OLD.completed_server_at IS NOT NULL THEN
    NEW.completed_server_at := OLD.completed_server_at;
  ELSIF NEW.ended IS NOT NULL THEN
    NEW.completed_server_at := now();
  ELSE
    NEW.completed_server_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.grant_lifetime_if_qualified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tier      text;
  v_workouts  int;
  v_minutes   int;
  v_days      int;
  v_taken     int;
  v_total     int;
BEGIN
  IF pg_catalog.current_setting('zane.backup_restore', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.ended IS NULL OR NEW.imported THEN
    RETURN NEW;
  END IF;

  SELECT tier INTO v_tier FROM public.zane_profiles WHERE id = NEW.user_id;
  IF v_tier IS NULL OR v_tier <> 'free' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) FILTER (WHERE ended IS NOT NULL AND NOT imported),
         COALESCE(SUM(LEAST(COALESCE(duration_minutes, 0), 120))
                  FILTER (WHERE ended IS NOT NULL AND NOT imported), 0),
         COUNT(DISTINCT date(completed_server_at))
           FILTER (WHERE completed_server_at IS NOT NULL AND NOT imported)
    INTO v_workouts, v_minutes, v_days
    FROM public.zane_sessions
   WHERE user_id = NEW.user_id;

  IF v_workouts < 5 OR v_minutes < 150 OR v_days < 3 THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('zane_lifetime_seats'));
  SELECT COUNT(*) INTO v_taken FROM public.zane_profiles WHERE tier = 'lifetime';
  SELECT lifetime_seats_total INTO v_total FROM public.zane_app_config WHERE id = 1;

  IF v_taken >= COALESCE(v_total, 75) THEN
    RETURN NEW;
  END IF;

  UPDATE public.zane_profiles
     SET tier = 'lifetime',
         tier_granted_at = now()
   WHERE id = NEW.user_id
     AND tier = 'free';
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.zane_sessions_stamp_completion()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.grant_lifetime_if_qualified()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.commit_backup_restore(p_operation_id text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_job app_private.zane_backup_restore_jobs%ROWTYPE;
  v_expected_chunks integer;
  v_expected_rows bigint;
  v_actual_chunks bigint;
  v_actual_rows bigint;
  v_actual_bytes bigint;
  v_declared_digest text;
  v_staged_digest text;
  v_bad_section text;
  v_table_counts jsonb;
  v_receipt jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_operation_id IS NULL
     OR p_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  THEN
    RAISE EXCEPTION 'invalid backup restore operation_id';
  END IF;

  SELECT job.*
  INTO v_job
  FROM app_private.zane_backup_restore_jobs AS job
  WHERE job.owner_id = v_uid
    AND job.operation_id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'backup restore operation not found';
  END IF;

  -- Exact serialization point shared with every restorable-table write trigger.
  PERFORM app_private.backup_restore_lock_owner(v_uid);
  IF v_job.status = 'committed' THEN
    RETURN v_job.receipt;
  END IF;
  IF v_job.expires_at <= now() THEN
    RAISE EXCEPTION 'backup restore staging operation expired';
  END IF;
  PERFORM app_private.backup_restore_validate_manifest(p_operation_id, v_job.manifest);

  v_expected_chunks := (v_job.manifest->'totals'->>'chunk_count')::integer;
  v_expected_rows := (v_job.manifest->'totals'->>'row_count')::bigint;

  SELECT pg_catalog.count(*),
         COALESCE(pg_catalog.sum(chunk.row_count), 0),
         COALESCE(pg_catalog.sum(chunk.byte_count), 0)
  INTO v_actual_chunks, v_actual_rows, v_actual_bytes
  FROM app_private.zane_backup_restore_chunks AS chunk
  WHERE chunk.owner_id = v_uid
    AND chunk.operation_id = p_operation_id;
  IF v_actual_chunks <> v_expected_chunks
     OR v_actual_rows <> v_expected_rows
     OR v_actual_bytes <= 0
     OR v_actual_bytes > 33554432
  THEN
    RAISE EXCEPTION 'backup restore staging is incomplete or exceeds the server-byte limit';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM app_private.zane_backup_restore_chunks AS chunk
    LEFT JOIN LATERAL (
      SELECT descriptor
      FROM pg_catalog.jsonb_array_elements(v_job.manifest->'chunks') AS descriptor
      WHERE (descriptor->>'index')::integer = chunk.chunk_index
    ) AS declared ON true
    WHERE chunk.owner_id = v_uid
      AND chunk.operation_id = p_operation_id
      AND (
        declared.descriptor IS NULL
        OR chunk.section IS DISTINCT FROM declared.descriptor->>'section'
        OR chunk.section_offset IS DISTINCT FROM (declared.descriptor->>'offset')::integer
        OR chunk.row_count IS DISTINCT FROM (declared.descriptor->>'row_count')::integer
        OR chunk.chunk_hash IS DISTINCT FROM declared.descriptor->>'hash'
        OR chunk.section IS DISTINCT FROM chunk.chunk->>'section'
        OR chunk.section_offset IS DISTINCT FROM (chunk.chunk->>'offset')::integer
        OR chunk.row_count IS DISTINCT FROM pg_catalog.jsonb_array_length(chunk.chunk->'rows')
      )
  ) THEN
    RAISE EXCEPTION 'staged backup restore chunk no longer matches its manifest';
  END IF;

  SELECT pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(
               pg_catalog.string_agg(descriptor->>'hash', '' ORDER BY (descriptor->>'index')::integer),
               'UTF8'
             ),
             'sha256'
           ),
           'hex'
         )
  INTO v_declared_digest
  FROM pg_catalog.jsonb_array_elements(v_job.manifest->'chunks') AS descriptor;
  SELECT pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(
               pg_catalog.string_agg(chunk.chunk_hash, '' ORDER BY chunk.chunk_index),
               'UTF8'
             ),
             'sha256'
           ),
           'hex'
         )
  INTO v_staged_digest
  FROM app_private.zane_backup_restore_chunks AS chunk
  WHERE chunk.owner_id = v_uid
    AND chunk.operation_id = p_operation_id;
  IF v_staged_digest IS DISTINCT FROM v_declared_digest THEN
    RAISE EXCEPTION 'backup restore digest mismatch';
  END IF;

  -- Materialize and cast the complete payload before touching live rows. LIKE
  -- copies NOT NULL/check/PK/unique rules, so malformed values and duplicates
  -- fail while all current account data is still untouched.
  CREATE TEMP TABLE pg_temp.br_profile
    (LIKE public.zane_profiles INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_exercises
    (LIKE public.zane_exercises INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_schedules
    (LIKE public.zane_schedules INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_sessions
    (LIKE public.zane_sessions INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_session_entries
    (LIKE public.zane_session_entries INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_sets
    (LIKE public.zane_sets INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_settings
    (LIKE public.zane_user_settings INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_skips
    (LIKE public.zane_skips INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_cardio_logs
    (LIKE public.zane_cardio_logs INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_daily_logs
    (LIKE public.zane_daily_logs INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_water_logs
    (LIKE public.zane_water_logs INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_adaptive_tdee_history
    (LIKE public.zane_adaptive_tdee_history INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_food_recipes
    (LIKE public.zane_food_recipes INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_food_meal_plans
    (LIKE public.zane_food_meal_plans INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_food_template_slots
    (LIKE public.zane_food_template_slots INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_food_logs
    (LIKE public.zane_food_logs INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_food_favorites
    (LIKE public.zane_food_favorites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_food_barcode_overrides
    (LIKE public.zane_food_barcode_overrides INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_food_shopping_prefs
    (LIKE public.zane_food_shopping_prefs INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_food_template_days
    (LIKE public.zane_food_template_days INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_medication_plans
    (LIKE public.zane_medication_plans INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_medications
    (LIKE public.zane_medications INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_medication_plan_items
    (LIKE public.zane_medication_plan_items INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_medication_schedule_slots
    (LIKE public.zane_medication_schedule_slots INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_medication_logs
    (LIKE public.zane_medication_logs INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_workout_templates
    (LIKE public.zane_workout_templates INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_checkin_schema_templates
    (LIKE public.zane_checkin_schema_templates INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_glucose_logs
    (LIKE public.zane_glucose_logs INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_blood_pressure_logs
    (LIKE public.zane_blood_pressure_logs INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_body_temp_logs
    (LIKE public.zane_body_temp_logs INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_cardio_plans
    (LIKE public.zane_cardio_plans INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_status_periods
    (LIKE public.zane_status_periods INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.br_meso_states
    (LIKE public.zane_meso_states INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    ON COMMIT DROP;

  INSERT INTO pg_temp.br_profile (id, name, x_handle, x_handle_public, x_handle_prompt_opted_out)
  SELECT v_uid, (r.row_value).name, (r.row_value).x_handle,
         (r.row_value).x_handle_public, (r.row_value).x_handle_prompt_opted_out
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_profiles, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'profile') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_exercises (
    id,user_id,name,tags,note,category,unilateral,equipment,progression_reps,
    movement_type,no_weight_reps,log_mode,pull_bodyweight,bodyweight_mode,
    youtube_url,note_pinned,progression_increment,horn_labels
  )
  SELECT (r.row_value).id,v_uid,(r.row_value).name,(r.row_value).tags,(r.row_value).note,
         (r.row_value).category,(r.row_value).unilateral,(r.row_value).equipment,
         (r.row_value).progression_reps,(r.row_value).movement_type,
         (r.row_value).no_weight_reps,(r.row_value).log_mode,(r.row_value).pull_bodyweight,
         (r.row_value).bodyweight_mode,(r.row_value).youtube_url,(r.row_value).note_pinned,
         (r.row_value).progression_increment,(r.row_value).horn_labels
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_exercises, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'exercises') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_schedules (
    id,user_id,name,days,archived,versions,is_flex,sessions_per_week,
    mesocycle_weeks,mesocycle_start_rir,mesocycle_end_rir,mesocycle_rir_enabled,
    mesocycle_autoregulate,mesocycle_autoregulate_mode,program_type,program_data,is_template
  )
  SELECT (r.row_value).id,v_uid,(r.row_value).name,(r.row_value).days,
         (r.row_value).archived,(r.row_value).versions,(r.row_value).is_flex,
         (r.row_value).sessions_per_week,(r.row_value).mesocycle_weeks,
         (r.row_value).mesocycle_start_rir,(r.row_value).mesocycle_end_rir,
         (r.row_value).mesocycle_rir_enabled,(r.row_value).mesocycle_autoregulate,
         (r.row_value).mesocycle_autoregulate_mode,(r.row_value).program_type,
         (r.row_value).program_data,(r.row_value).is_template
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_schedules, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'schedules') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_sessions (
    id,user_id,schedule_id,day_id,day_name,date,ended,started_at,duration_minutes,feel,
    is_bonus,is_freestyle,is_deload,is_cleanup,meso_recap,readiness,signal_weight,cycle_pos,imported
  )
  SELECT (r.row_value).id,v_uid,(r.row_value).schedule_id,(r.row_value).day_id,
         (r.row_value).day_name,(r.row_value).date,(r.row_value).ended,
         (r.row_value).started_at,(r.row_value).duration_minutes,(r.row_value).feel,
         (r.row_value).is_bonus,(r.row_value).is_freestyle,(r.row_value).is_deload,
         (r.row_value).is_cleanup,(r.row_value).meso_recap,(r.row_value).readiness,
         (r.row_value).signal_weight,(r.row_value).cycle_pos,(r.row_value).imported
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_sessions, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'sessions') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_session_entries (
    id,session_id,user_id,entry_idx,ex_id,name,planned_sets,planned_reps,
    planned_reps_per_set,planned_reps_max,planned_progression_offset,
    planned_techniques,note,superset_group
  )
  SELECT (r.row_value).id,(r.row_value).session_id,v_uid,(r.row_value).entry_idx,
         (r.row_value).ex_id,(r.row_value).name,(r.row_value).planned_sets,
         (r.row_value).planned_reps,(r.row_value).planned_reps_per_set,
         (r.row_value).planned_reps_max,(r.row_value).planned_progression_offset,
         (r.row_value).planned_techniques,(r.row_value).note,(r.row_value).superset_group
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_session_entries, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'session_entries') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_sets (
    id,session_id,entry_id,user_id,set_idx,kg,reps,reps_l,reps_r,time_sec,added_kg,
    done,skipped,warmup,technique,drops,horn_loads,updated_at
  )
  SELECT (r.row_value).id,(r.row_value).session_id,(r.row_value).entry_id,v_uid,
         (r.row_value).set_idx,(r.row_value).kg,(r.row_value).reps,(r.row_value).reps_l,
         (r.row_value).reps_r,(r.row_value).time_sec,(r.row_value).added_kg,
         (r.row_value).done,(r.row_value).skipped,(r.row_value).warmup,
         (r.row_value).technique,(r.row_value).drops,(r.row_value).horn_loads,now()
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_sets, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'sets') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_settings (
    user_id,active_schedule_id,active_meal_template_id,cycle_index,cycle_start_date,
    week_plan_start_date,last_advanced_date,in_progress_session_id,unit,rest_default,
    rest_big,rest_medium,rest_small,auto_open_rest_timer,cycle_week_view,week_start_day,
    accent_color,dark_mode,custom_day_types,
    reminder_enabled,reminder_time,tempo_enabled,tempo_eccentric,tempo_concentric,
    smart_progression,progression_range_top,equipment_config,weight_fill_down,net_carbs,
    food_force_grams,plan_mode,hide_food_categories,show_warmup_in_summary,
    session_timeout_minutes,macro_targets,macro_calc,meal_windows,meal_categories,
    fasting_protocol,show_health_tab,show_water_tab,show_food_tab,onboarding_completed,
    show_regression,pin_all_notes,glucose_unit,temp_unit,hidden_health_cards,
    fever_threshold_c,cleanup_percent,watermark_opacity,default_checkin_schema,
    vip_background,active_cardio_plan_id,status_mode,status_mode_since,
    deload_prompt_dismissed_at,water_goal_ml,water_start_time,water_end_time,
    water_bottles_today,water_bottles_date,water_drinks,water_coffee_sizes,
    water_bottle_enabled,water_bottle_ml,water_reminder_enabled,meal_reminder_enabled,
    meds_enabled,medication_reminder_enabled,daily_log_reminder_enabled,
    daily_log_reminder_time,pillbox_slots
  )
  SELECT v_uid,(r.row_value).active_schedule_id,(r.row_value).active_meal_template_id,
    (r.row_value).cycle_index,(r.row_value).cycle_start_date,(r.row_value).week_plan_start_date,
    (r.row_value).last_advanced_date,(r.row_value).in_progress_session_id,(r.row_value).unit,
    (r.row_value).rest_default,(r.row_value).rest_big,(r.row_value).rest_medium,
    (r.row_value).rest_small,(r.row_value).auto_open_rest_timer,(r.row_value).cycle_week_view,
    (r.row_value).week_start_day,(r.row_value).accent_color,(r.row_value).dark_mode,
    (r.row_value).custom_day_types,(r.row_value).reminder_enabled,(r.row_value).reminder_time,
    (r.row_value).tempo_enabled,(r.row_value).tempo_eccentric,(r.row_value).tempo_concentric,
    (r.row_value).smart_progression,(r.row_value).progression_range_top,
    (r.row_value).equipment_config,(r.row_value).weight_fill_down,(r.row_value).net_carbs,
    (r.row_value).food_force_grams,(r.row_value).plan_mode,(r.row_value).hide_food_categories,
    (r.row_value).show_warmup_in_summary,(r.row_value).session_timeout_minutes,
    (r.row_value).macro_targets,(r.row_value).macro_calc,
    (r.row_value).meal_windows,(r.row_value).meal_categories,(r.row_value).fasting_protocol,
    (r.row_value).show_health_tab,(r.row_value).show_water_tab,(r.row_value).show_food_tab,
    (r.row_value).onboarding_completed,(r.row_value).show_regression,
    (r.row_value).pin_all_notes,(r.row_value).glucose_unit,(r.row_value).temp_unit,
    (r.row_value).hidden_health_cards,(r.row_value).fever_threshold_c,
    (r.row_value).cleanup_percent,(r.row_value).watermark_opacity,
    (r.row_value).default_checkin_schema,(r.row_value).vip_background,
    (r.row_value).active_cardio_plan_id,(r.row_value).status_mode,
    (r.row_value).status_mode_since,(r.row_value).deload_prompt_dismissed_at,
    (r.row_value).water_goal_ml,(r.row_value).water_start_time,(r.row_value).water_end_time,
    (r.row_value).water_bottles_today,(r.row_value).water_bottles_date,
    (r.row_value).water_drinks,(r.row_value).water_coffee_sizes,
    (r.row_value).water_bottle_enabled,(r.row_value).water_bottle_ml,
    (r.row_value).water_reminder_enabled,(r.row_value).meal_reminder_enabled,
    (r.row_value).meds_enabled,(r.row_value).medication_reminder_enabled,
    (r.row_value).daily_log_reminder_enabled,(r.row_value).daily_log_reminder_time,
    (r.row_value).pillbox_slots
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_user_settings, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'settings') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_skips (id,user_id,date,day_id,day_name,skip_reason,skipped_at)
  SELECT (r.row_value).id,v_uid,(r.row_value).date,(r.row_value).day_id,
         (r.row_value).day_name,(r.row_value).skip_reason,(r.row_value).skipped_at
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_skips, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'skips') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_cardio_logs (
    id,user_id,date,type,duration_minutes,distance_m,pace_feeling,effort,note,session_id
  )
  SELECT (r.row_value).id,v_uid,(r.row_value).date,(r.row_value).type,
         (r.row_value).duration_minutes,(r.row_value).distance_m,(r.row_value).pace_feeling,
         (r.row_value).effort,(r.row_value).note,(r.row_value).session_id
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_cardio_logs, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'cardio_logs') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_daily_logs (
    id,user_id,date,weight,steps,waist_cm,hips_cm,chest_cm,arm_cm,thigh_cm,calf_cm,
    body_fat_pct,calories,protein,carbs,fat,fiber,water_ml,note,off_plan_note,
    meal_of_choice,meal_of_choice_hour,food_day_closed,adherence,targets_snap,
    daily_coach_fields,ai_summary,ai_summary_generated_at
  )
  SELECT (r.row_value).id,v_uid,(r.row_value).date,(r.row_value).weight,
    (r.row_value).steps,(r.row_value).waist_cm,(r.row_value).hips_cm,(r.row_value).chest_cm,
    (r.row_value).arm_cm,(r.row_value).thigh_cm,(r.row_value).calf_cm,
    (r.row_value).body_fat_pct,(r.row_value).calories,(r.row_value).protein,
    (r.row_value).carbs,(r.row_value).fat,(r.row_value).fiber,(r.row_value).water_ml,
    (r.row_value).note,(r.row_value).off_plan_note,(r.row_value).meal_of_choice,
    (r.row_value).meal_of_choice_hour,(r.row_value).food_day_closed,(r.row_value).adherence,
    (r.row_value).targets_snap,(r.row_value).daily_coach_fields,(r.row_value).ai_summary,
    (r.row_value).ai_summary_generated_at
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_daily_logs, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'daily_logs') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_water_logs (id,user_id,date,time,amount_ml,name,category,breakdown)
  SELECT (r.row_value).id,v_uid,(r.row_value).date,(r.row_value).time,
         (r.row_value).amount_ml,(r.row_value).name,(r.row_value).category,(r.row_value).breakdown
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_water_logs, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'water_logs') AS staged
  ) AS r;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT (parsed.row_value).as_of_date
      FROM (
        SELECT pg_catalog.jsonb_populate_record(
          NULL::public.zane_adaptive_tdee_history,
          staged.row_data
        ) AS row_value
        FROM app_private.backup_restore_rows(
          v_uid, p_operation_id, 'adaptive_tdee_history'
        ) AS staged
      ) AS parsed
      GROUP BY (parsed.row_value).as_of_date
      HAVING pg_catalog.count(*) > 1
    ) AS duplicate_tdee_date
  ) THEN
    RAISE EXCEPTION 'backup restore adaptive TDEE dates must be unique';
  END IF;

  INSERT INTO pg_temp.br_adaptive_tdee_history (
    id,user_id,as_of_date,window_start,window_end,tdee_kcal,avg_calories_kcal,
    weight_start_kg,weight_end_kg,weight_change_kg,weight_rate_kg_week,day_span,
    calorie_days,weigh_ins,decision,source,targets_snapshot,calculated_at,decided_at,
    created_at,updated_at
  )
  SELECT 'tdee_' || v_uid::text || '_' || (r.row_value).as_of_date::text,
    v_uid,(r.row_value).as_of_date,(r.row_value).window_start,
    (r.row_value).window_end,(r.row_value).tdee_kcal,(r.row_value).avg_calories_kcal,
    (r.row_value).weight_start_kg,(r.row_value).weight_end_kg,(r.row_value).weight_change_kg,
    (r.row_value).weight_rate_kg_week,(r.row_value).day_span,(r.row_value).calorie_days,
    (r.row_value).weigh_ins,(r.row_value).decision,(r.row_value).source,
    (r.row_value).targets_snapshot,(r.row_value).calculated_at,(r.row_value).decided_at,
    (r.row_value).created_at,(r.row_value).updated_at
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_adaptive_tdee_history, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'adaptive_tdee_history') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_food_recipes (id,user_id,name,items,portions,cooked_weight_g,updated_at)
  SELECT (r.row_value).id,v_uid,(r.row_value).name,(r.row_value).items,
         (r.row_value).portions,(r.row_value).cooked_weight_g,(r.row_value).updated_at
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_food_recipes, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'food_recipes') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_food_meal_plans (id,user_id,name,archived,is_template,coach_id,updated_at)
  SELECT (r.row_value).id,v_uid,(r.row_value).name,(r.row_value).archived,
         (r.row_value).is_template,NULL::uuid,(r.row_value).updated_at
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_food_meal_plans, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'food_meal_plans') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_food_template_slots (
    id,user_id,food_id,food_name,brand,source,quantity_g,calories,protein,carbs,fat,
    fiber,sugar,sat_fat,sodium_mg,recipe_items,recipe_id,logged_total_portions,
    logged_cooked_grams,logged_cooked_weight_g,hour,day_type,sort_idx,meal_plan_id
  )
  SELECT (r.row_value).id,v_uid,(r.row_value).food_id,(r.row_value).food_name,
    (r.row_value).brand,(r.row_value).source,(r.row_value).quantity_g,(r.row_value).calories,
    (r.row_value).protein,(r.row_value).carbs,(r.row_value).fat,(r.row_value).fiber,
    (r.row_value).sugar,(r.row_value).sat_fat,(r.row_value).sodium_mg,
    (r.row_value).recipe_items,(r.row_value).recipe_id,(r.row_value).logged_total_portions,
    (r.row_value).logged_cooked_grams,(r.row_value).logged_cooked_weight_g,
    (r.row_value).hour,(r.row_value).day_type,(r.row_value).sort_idx,(r.row_value).meal_plan_id
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_food_template_slots, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'food_template_slots') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_food_logs (
    id,user_id,date,time,food_id,food_name,brand,source,quantity_g,calories,protein,
    carbs,fat,fiber,sugar,sat_fat,sodium_mg,recipe_items,recipe_id,
    logged_total_portions,logged_cooked_grams,logged_cooked_weight_g,logged_unit,
    split_batch,planned,template_slot_id
  )
  SELECT (r.row_value).id,v_uid,(r.row_value).date,(r.row_value).time,
    (r.row_value).food_id,(r.row_value).food_name,(r.row_value).brand,(r.row_value).source,
    (r.row_value).quantity_g,(r.row_value).calories,(r.row_value).protein,
    (r.row_value).carbs,(r.row_value).fat,(r.row_value).fiber,(r.row_value).sugar,
    (r.row_value).sat_fat,(r.row_value).sodium_mg,(r.row_value).recipe_items,
    (r.row_value).recipe_id,(r.row_value).logged_total_portions,
    (r.row_value).logged_cooked_grams,(r.row_value).logged_cooked_weight_g,
    (r.row_value).logged_unit,(r.row_value).split_batch,(r.row_value).planned,
    (r.row_value).template_slot_id
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_food_logs, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'food_logs') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_food_favorites (
    id,user_id,food_id,food_name,brand,source,quantity_g,calories,protein,carbs,fat,
    fiber,sugar,sat_fat,sodium_mg,units
  )
  SELECT (r.row_value).id,v_uid,(r.row_value).food_id,(r.row_value).food_name,
    (r.row_value).brand,(r.row_value).source,(r.row_value).quantity_g,
    (r.row_value).calories,(r.row_value).protein,(r.row_value).carbs,(r.row_value).fat,
    (r.row_value).fiber,(r.row_value).sugar,(r.row_value).sat_fat,
    (r.row_value).sodium_mg,(r.row_value).units
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_food_favorites, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'food_favorites') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_food_barcode_overrides (
    user_id,source,source_id,food_name,brand,kcal_per_100g,protein_per_100g,
    carbs_per_100g,fat_per_100g,created_at,updated_at
  )
  SELECT v_uid,(r.row_value).source,(r.row_value).source_id,(r.row_value).food_name,
    (r.row_value).brand,(r.row_value).kcal_per_100g,(r.row_value).protein_per_100g,
    (r.row_value).carbs_per_100g,(r.row_value).fat_per_100g,
    (r.row_value).created_at,(r.row_value).updated_at
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_food_barcode_overrides, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'food_barcode_overrides') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_food_shopping_prefs (
    id,user_id,food_id,shopping_key,name_override,excluded,excluded_until,package_size_g,
    low_stock_threshold_g,stock_baseline_g,stock_set_at,food_name,brand,updated_at
  )
  SELECT (r.row_value).id,v_uid,(r.row_value).food_id,(r.row_value).shopping_key,
    (r.row_value).name_override,(r.row_value).excluded,(r.row_value).excluded_until,
    (r.row_value).package_size_g,(r.row_value).low_stock_threshold_g,
    (r.row_value).stock_baseline_g,(r.row_value).stock_set_at,(r.row_value).food_name,
    (r.row_value).brand,(r.row_value).updated_at
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_food_shopping_prefs, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'food_shopping_prefs') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_food_template_days (id,user_id,date)
  SELECT (r.row_value).id,v_uid,(r.row_value).date
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_food_template_days, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'food_template_days') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_medication_plans (id,user_id,name,archived,is_template,coach_id,active,updated_at)
  SELECT (r.row_value).id,v_uid,(r.row_value).name,(r.row_value).archived,
         (r.row_value).is_template,NULL::uuid,(r.row_value).active,(r.row_value).updated_at
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_medication_plans, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'medication_plans') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_medications (
    id,user_id,name,brand,category,unit_label,package_size,low_stock_threshold,
    stock_baseline,stock_set_at,archived,exclude_from_pillbox,exclude_from_low_stock,
    track_stock,updated_at
  )
  SELECT (r.row_value).id,v_uid,(r.row_value).name,(r.row_value).brand,
    (r.row_value).category,(r.row_value).unit_label,(r.row_value).package_size,
    (r.row_value).low_stock_threshold,(r.row_value).stock_baseline,(r.row_value).stock_set_at,
    (r.row_value).archived,(r.row_value).exclude_from_pillbox,
    (r.row_value).exclude_from_low_stock,(r.row_value).track_stock,(r.row_value).updated_at
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_medications, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'medications') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_medication_plan_items (id,user_id,medication_plan_id,medication_id)
  SELECT (r.row_value).id,v_uid,(r.row_value).medication_plan_id,(r.row_value).medication_id
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_medication_plan_items, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'medication_plan_items') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_medication_schedule_slots (
    id,user_id,medication_id,medication_plan_id,weekdays,hour,dose_qty,
    interval_days,start_date,end_date,updated_at
  )
  SELECT (r.row_value).id,v_uid,(r.row_value).medication_id,(r.row_value).medication_plan_id,
    (r.row_value).weekdays,(r.row_value).hour,(r.row_value).dose_qty,
    (r.row_value).interval_days,(r.row_value).start_date,(r.row_value).end_date,
    (r.row_value).updated_at
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_medication_schedule_slots, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'medication_schedule_slots') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_medication_logs (
    id,user_id,medication_id,medication_name,date,time,dose_qty,planned,skipped,
    schedule_slot_id,reminder_sent_at,reminder_count,snoozed_until
  )
  SELECT (r.row_value).id,v_uid,(r.row_value).medication_id,(r.row_value).medication_name,
    (r.row_value).date,(r.row_value).time,(r.row_value).dose_qty,(r.row_value).planned,
    (r.row_value).skipped,(r.row_value).schedule_slot_id,(r.row_value).reminder_sent_at,
    (r.row_value).reminder_count,(r.row_value).snoozed_until
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_medication_logs, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'medication_logs') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_workout_templates (id,user_id,name,exercises)
  SELECT (r.row_value).id,v_uid,(r.row_value).name,(r.row_value).exercises
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_workout_templates, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'workout_templates') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_checkin_schema_templates (id,user_id,name,schema)
  SELECT (r.row_value).id,v_uid,(r.row_value).name,(r.row_value).schema
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_checkin_schema_templates, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'checkin_schema_templates') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_glucose_logs (id,user_id,date,time,value_mmol,context,note)
  SELECT (r.row_value).id,v_uid,(r.row_value).date,(r.row_value).time,
         (r.row_value).value_mmol,(r.row_value).context,(r.row_value).note
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_glucose_logs, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'glucose_logs') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_blood_pressure_logs (id,user_id,date,time,systolic,diastolic,note)
  SELECT (r.row_value).id,v_uid,(r.row_value).date,(r.row_value).time,
         (r.row_value).systolic,(r.row_value).diastolic,(r.row_value).note
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_blood_pressure_logs, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'blood_pressure_logs') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_body_temp_logs (id,user_id,date,time,value_c,note)
  SELECT (r.row_value).id,v_uid,(r.row_value).date,(r.row_value).time,
         (r.row_value).value_c,(r.row_value).note
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_body_temp_logs, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'body_temp_logs') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_cardio_plans (
    id,user_id,name,activity_type,archived,mode,days,manual_targets,goal,
    goal_due_date,start_fitness,generated_weeks,plan_start_date
  )
  SELECT (r.row_value).id,v_uid,(r.row_value).name,(r.row_value).activity_type,
    (r.row_value).archived,(r.row_value).mode,(r.row_value).days,
    (r.row_value).manual_targets,(r.row_value).goal,(r.row_value).goal_due_date,
    (r.row_value).start_fitness,(r.row_value).generated_weeks,(r.row_value).plan_start_date
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_cardio_plans, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'cardio_plans') AS staged
  ) AS r;

  INSERT INTO pg_temp.br_status_periods (id,user_id,mode,started_at,ended_at)
  SELECT (r.row_value).id,v_uid,(r.row_value).mode,(r.row_value).started_at,(r.row_value).ended_at
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_status_periods, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'status_periods') AS staged
  ) AS r;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT (parsed.row_value).schedule_id
      FROM (
        SELECT pg_catalog.jsonb_populate_record(
          NULL::public.zane_meso_states,
          staged.row_data
        ) AS row_value
        FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'meso_states') AS staged
      ) AS parsed
      GROUP BY (parsed.row_value).schedule_id
      HAVING pg_catalog.count(*) > 1
    ) AS duplicate_meso_schedule
  ) THEN
    RAISE EXCEPTION 'backup restore mesocycle schedule IDs must be unique';
  END IF;

  INSERT INTO pg_temp.br_meso_states (
    id,user_id,schedule_id,weeks,start_date,start_cycle_index,started_at,deltas,
    weight_boosts,weight_boost_declines,joint_flags,pump_low_counts,growth_counts,
    rep_miss_counts,affinity,autoreg_state,completions,pending_meso2
  )
  SELECT v_uid::text || '_' || (r.row_value).schedule_id,
    v_uid,(r.row_value).schedule_id,(r.row_value).weeks,
    (r.row_value).start_date,(r.row_value).start_cycle_index,(r.row_value).started_at,
    (r.row_value).deltas,(r.row_value).weight_boosts,(r.row_value).weight_boost_declines,
    (r.row_value).joint_flags,(r.row_value).pump_low_counts,(r.row_value).growth_counts,
    (r.row_value).rep_miss_counts,(r.row_value).affinity,(r.row_value).autoreg_state,
    (r.row_value).completions,(r.row_value).pending_meso2
  FROM (
    SELECT pg_catalog.jsonb_populate_record(NULL::public.zane_meso_states, staged.row_data) AS row_value
    FROM app_private.backup_restore_rows(v_uid, p_operation_id, 'meso_states') AS staged
  ) AS r;

  -- Shared food cache rows can legitimately disappear between export and a
  -- later restore. Personal logs, favorites, slots and shopping preferences
  -- already carry denormalized names/macros, so preserve those snapshots and
  -- clear only the stale optional reference. The same applies to a legacy
  -- recipe reference whose personal recipe is absent from the backup.
  UPDATE pg_temp.br_food_logs AS item
  SET food_id = NULL
  WHERE item.food_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.zane_foods AS shared WHERE shared.id = item.food_id
    );
  UPDATE pg_temp.br_food_logs AS item
  SET recipe_id = NULL
  WHERE item.recipe_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_temp.br_food_recipes AS recipe WHERE recipe.id = item.recipe_id
    );
  UPDATE pg_temp.br_food_favorites AS item
  SET food_id = NULL
  WHERE item.food_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.zane_foods AS shared WHERE shared.id = item.food_id
    );
  UPDATE pg_temp.br_food_template_slots AS item
  SET food_id = NULL
  WHERE item.food_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.zane_foods AS shared WHERE shared.id = item.food_id
    );
  UPDATE pg_temp.br_food_template_slots AS item
  SET recipe_id = NULL
  WHERE item.recipe_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_temp.br_food_recipes AS recipe WHERE recipe.id = item.recipe_id
    );
  UPDATE pg_temp.br_food_shopping_prefs AS item
  SET food_id = NULL
  WHERE item.food_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.zane_foods AS shared WHERE shared.id = item.food_id
    );

  v_table_counts := pg_catalog.jsonb_build_object(
    'profile', (SELECT count(*) FROM pg_temp.br_profile),
    'exercises', (SELECT count(*) FROM pg_temp.br_exercises),
    'schedules', (SELECT count(*) FROM pg_temp.br_schedules),
    'sessions', (SELECT count(*) FROM pg_temp.br_sessions),
    'session_entries', (SELECT count(*) FROM pg_temp.br_session_entries),
    'sets', (SELECT count(*) FROM pg_temp.br_sets),
    'settings', (SELECT count(*) FROM pg_temp.br_settings),
    'skips', (SELECT count(*) FROM pg_temp.br_skips),
    'cardio_logs', (SELECT count(*) FROM pg_temp.br_cardio_logs),
    'daily_logs', (SELECT count(*) FROM pg_temp.br_daily_logs),
    'water_logs', (SELECT count(*) FROM pg_temp.br_water_logs),
    'adaptive_tdee_history', (SELECT count(*) FROM pg_temp.br_adaptive_tdee_history),
    'food_recipes', (SELECT count(*) FROM pg_temp.br_food_recipes),
    'food_meal_plans', (SELECT count(*) FROM pg_temp.br_food_meal_plans),
    'food_template_slots', (SELECT count(*) FROM pg_temp.br_food_template_slots),
    'food_logs', (SELECT count(*) FROM pg_temp.br_food_logs),
    'food_favorites', (SELECT count(*) FROM pg_temp.br_food_favorites),
    'food_barcode_overrides', (SELECT count(*) FROM pg_temp.br_food_barcode_overrides),
    'food_shopping_prefs', (SELECT count(*) FROM pg_temp.br_food_shopping_prefs),
    'food_template_days', (SELECT count(*) FROM pg_temp.br_food_template_days),
    'medication_plans', (SELECT count(*) FROM pg_temp.br_medication_plans),
    'medications', (SELECT count(*) FROM pg_temp.br_medications),
    'medication_plan_items', (SELECT count(*) FROM pg_temp.br_medication_plan_items),
    'medication_schedule_slots', (SELECT count(*) FROM pg_temp.br_medication_schedule_slots),
    'medication_logs', (SELECT count(*) FROM pg_temp.br_medication_logs),
    'workout_templates', (SELECT count(*) FROM pg_temp.br_workout_templates),
    'checkin_schema_templates', (SELECT count(*) FROM pg_temp.br_checkin_schema_templates),
    'glucose_logs', (SELECT count(*) FROM pg_temp.br_glucose_logs),
    'blood_pressure_logs', (SELECT count(*) FROM pg_temp.br_blood_pressure_logs),
    'body_temp_logs', (SELECT count(*) FROM pg_temp.br_body_temp_logs),
    'cardio_plans', (SELECT count(*) FROM pg_temp.br_cardio_plans),
    'status_periods', (SELECT count(*) FROM pg_temp.br_status_periods),
    'meso_states', (SELECT count(*) FROM pg_temp.br_meso_states)
  );
  IF (SELECT pg_catalog.sum(value::text::bigint)
      FROM pg_catalog.jsonb_each(v_table_counts)) <> v_expected_rows
  THEN
    RAISE EXCEPTION 'normalized backup restore row_count mismatch';
  END IF;

  -- A SECURITY DEFINER function bypasses RLS, so every caller-supplied global
  -- primary key must be proven unused or already owned by this same account.
  SELECT collision.section INTO v_bad_section
  FROM (
    SELECT 'exercises'::text AS section FROM pg_temp.br_exercises t JOIN public.zane_exercises l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'schedules' FROM pg_temp.br_schedules t JOIN public.zane_schedules l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'sessions' FROM pg_temp.br_sessions t JOIN public.zane_sessions l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'session_entries' FROM pg_temp.br_session_entries t JOIN public.zane_session_entries l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'sets' FROM pg_temp.br_sets t JOIN public.zane_sets l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'skips' FROM pg_temp.br_skips t JOIN public.zane_skips l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'cardio_logs' FROM pg_temp.br_cardio_logs t JOIN public.zane_cardio_logs l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'daily_logs' FROM pg_temp.br_daily_logs t JOIN public.zane_daily_logs l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'water_logs' FROM pg_temp.br_water_logs t JOIN public.zane_water_logs l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'adaptive_tdee_history' FROM pg_temp.br_adaptive_tdee_history t JOIN public.zane_adaptive_tdee_history l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'food_recipes' FROM pg_temp.br_food_recipes t JOIN public.zane_food_recipes l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'food_meal_plans' FROM pg_temp.br_food_meal_plans t JOIN public.zane_food_meal_plans l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'food_template_slots' FROM pg_temp.br_food_template_slots t JOIN public.zane_food_template_slots l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'food_logs' FROM pg_temp.br_food_logs t JOIN public.zane_food_logs l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'food_favorites' FROM pg_temp.br_food_favorites t JOIN public.zane_food_favorites l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'food_shopping_prefs' FROM pg_temp.br_food_shopping_prefs t JOIN public.zane_food_shopping_prefs l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'food_template_days' FROM pg_temp.br_food_template_days t JOIN public.zane_food_template_days l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'medication_plans' FROM pg_temp.br_medication_plans t JOIN public.zane_medication_plans l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'medications' FROM pg_temp.br_medications t JOIN public.zane_medications l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'medication_plan_items' FROM pg_temp.br_medication_plan_items t JOIN public.zane_medication_plan_items l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'medication_schedule_slots' FROM pg_temp.br_medication_schedule_slots t JOIN public.zane_medication_schedule_slots l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'medication_logs' FROM pg_temp.br_medication_logs t JOIN public.zane_medication_logs l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'workout_templates' FROM pg_temp.br_workout_templates t JOIN public.zane_workout_templates l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'checkin_schema_templates' FROM pg_temp.br_checkin_schema_templates t JOIN public.zane_checkin_schema_templates l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'glucose_logs' FROM pg_temp.br_glucose_logs t JOIN public.zane_glucose_logs l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'blood_pressure_logs' FROM pg_temp.br_blood_pressure_logs t JOIN public.zane_blood_pressure_logs l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'body_temp_logs' FROM pg_temp.br_body_temp_logs t JOIN public.zane_body_temp_logs l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'cardio_plans' FROM pg_temp.br_cardio_plans t JOIN public.zane_cardio_plans l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'status_periods' FROM pg_temp.br_status_periods t JOIN public.zane_status_periods l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
    UNION ALL SELECT 'meso_states' FROM pg_temp.br_meso_states t JOIN public.zane_meso_states l USING (id) WHERE l.user_id IS DISTINCT FROM v_uid
  ) AS collision
  LIMIT 1;
  IF v_bad_section IS NOT NULL THEN
    RAISE EXCEPTION 'backup restore id collides with another account in section %', v_bad_section;
  END IF;

  -- Relational references must resolve inside the complete replacement payload;
  -- shared food-cache references are the only permitted external data targets.
  IF EXISTS (
    SELECT 1 FROM pg_temp.br_session_entries e
    WHERE NOT EXISTS (SELECT 1 FROM pg_temp.br_sessions s WHERE s.id = e.session_id)
  ) OR EXISTS (
    SELECT 1 FROM pg_temp.br_sets st
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_temp.br_session_entries e
      WHERE e.id = st.entry_id AND e.session_id = st.session_id
    )
  ) THEN
    RAISE EXCEPTION 'backup restore session entry/set reference is invalid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_temp.br_food_logs l
    WHERE l.recipe_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pg_temp.br_food_recipes r WHERE r.id = l.recipe_id)
  ) OR EXISTS (
    SELECT 1 FROM pg_temp.br_food_logs l
    WHERE l.food_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.zane_foods f WHERE f.id = l.food_id)
  ) OR EXISTS (
    SELECT 1 FROM pg_temp.br_food_favorites f
    WHERE f.food_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.zane_foods shared WHERE shared.id = f.food_id)
  ) OR EXISTS (
    SELECT 1 FROM pg_temp.br_food_shopping_prefs p
    WHERE p.food_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.zane_foods shared WHERE shared.id = p.food_id)
  ) THEN
    RAISE EXCEPTION 'backup restore food reference is invalid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_temp.br_medication_plan_items i
    WHERE NOT EXISTS (SELECT 1 FROM pg_temp.br_medications m WHERE m.id = i.medication_id)
       OR NOT EXISTS (SELECT 1 FROM pg_temp.br_medication_plans p WHERE p.id = i.medication_plan_id)
  ) OR EXISTS (
    SELECT 1 FROM pg_temp.br_medication_schedule_slots s
    WHERE NOT EXISTS (SELECT 1 FROM pg_temp.br_medications m WHERE m.id = s.medication_id)
       OR (s.medication_plan_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM pg_temp.br_medication_plans p WHERE p.id = s.medication_plan_id
       ))
  ) OR EXISTS (
    SELECT 1 FROM pg_temp.br_medication_logs l
    WHERE (l.medication_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_temp.br_medications m WHERE m.id = l.medication_id
    )) OR (l.schedule_slot_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_temp.br_medication_schedule_slots s WHERE s.id = l.schedule_slot_id
    ))
  ) THEN
    RAISE EXCEPTION 'backup restore medication reference is invalid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_temp.br_settings s
    WHERE (s.active_schedule_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_temp.br_schedules p WHERE p.id = s.active_schedule_id
    )) OR (s.in_progress_session_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_temp.br_sessions session WHERE session.id = s.in_progress_session_id
    )) OR (s.active_meal_template_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_temp.br_food_meal_plans p WHERE p.id = s.active_meal_template_id
    )) OR (s.active_cardio_plan_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_temp.br_cardio_plans p WHERE p.id = s.active_cardio_plan_id
    ))
  ) OR EXISTS (
    SELECT 1 FROM pg_temp.br_meso_states m
    WHERE NOT EXISTS (SELECT 1 FROM pg_temp.br_schedules s WHERE s.id = m.schedule_id)
  ) THEN
    RAISE EXCEPTION 'backup restore active plan/session reference is invalid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_temp.br_sessions staged
    JOIN public.zane_schedules live ON live.id = staged.schedule_id
    WHERE staged.schedule_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pg_temp.br_schedules own WHERE own.id = staged.schedule_id)
      AND live.user_id IS DISTINCT FROM v_uid
  ) OR EXISTS (
    SELECT 1 FROM pg_temp.br_session_entries staged
    JOIN public.zane_exercises live ON live.id = staged.ex_id
    WHERE staged.ex_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pg_temp.br_exercises own WHERE own.id = staged.ex_id)
      AND live.user_id IS DISTINCT FROM v_uid
  ) OR EXISTS (
    SELECT 1 FROM pg_temp.br_cardio_logs staged
    JOIN public.zane_sessions live ON live.id = staged.session_id
    WHERE staged.session_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pg_temp.br_sessions own WHERE own.id = staged.session_id)
      AND live.user_id IS DISTINCT FROM v_uid
  ) OR EXISTS (
    SELECT 1 FROM pg_temp.br_food_template_slots staged
    JOIN public.zane_food_recipes live ON live.id = staged.recipe_id
    WHERE staged.recipe_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pg_temp.br_food_recipes own WHERE own.id = staged.recipe_id)
      AND live.user_id IS DISTINCT FROM v_uid
  ) OR EXISTS (
    SELECT 1 FROM pg_temp.br_food_template_slots staged
    JOIN public.zane_food_meal_plans live ON live.id = staged.meal_plan_id
    WHERE staged.meal_plan_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pg_temp.br_food_meal_plans own WHERE own.id = staged.meal_plan_id)
      AND live.user_id IS DISTINCT FROM v_uid
  ) OR EXISTS (
    SELECT 1 FROM pg_temp.br_food_logs staged
    JOIN public.zane_food_template_slots live ON live.id = staged.template_slot_id
    WHERE staged.template_slot_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pg_temp.br_food_template_slots own WHERE own.id = staged.template_slot_id)
      AND live.user_id IS DISTINCT FROM v_uid
  ) THEN
    RAISE EXCEPTION 'backup restore soft reference targets another account';
  END IF;

  -- Friends comments are outside the portable personal backup. Deleting an
  -- omitted session would cascade-delete those comments, including comments
  -- written by other users, so reject before the first live mutation instead.
  IF EXISTS (
    SELECT 1
    FROM public.zane_sessions AS live_session
    JOIN public.zane_social_workout_comments AS social_comment
      ON social_comment.session_id = live_session.id
    WHERE live_session.user_id = v_uid
      AND NOT EXISTS (
        SELECT 1 FROM pg_temp.br_sessions AS staged_session
        WHERE staged_session.id = live_session.id
      )
  ) THEN
    RAISE EXCEPTION 'backup restore cannot remove a session that has Friends comments';
  END IF;

  -- Only this transaction can now write the caller's restorable rows. The marker
  -- suppresses session completion/tier side effects while preserving staged
  -- imported flags and existing server stamps on matching session IDs.
  PERFORM pg_catalog.set_config('zane.backup_restore', 'on', true);

  DELETE FROM public.zane_sets WHERE user_id = v_uid;
  DELETE FROM public.zane_session_entries WHERE user_id = v_uid;
  DELETE FROM public.zane_food_logs WHERE user_id = v_uid;
  DELETE FROM public.zane_medication_logs WHERE user_id = v_uid;
  DELETE FROM public.zane_medication_plan_items WHERE user_id = v_uid;
  DELETE FROM public.zane_medication_schedule_slots WHERE user_id = v_uid;
  DELETE FROM public.zane_medications WHERE user_id = v_uid;
  DELETE FROM public.zane_medication_plans WHERE user_id = v_uid;
  DELETE FROM public.zane_food_recipes WHERE user_id = v_uid;
  DELETE FROM public.zane_food_template_slots WHERE user_id = v_uid;
  DELETE FROM public.zane_food_meal_plans WHERE user_id = v_uid;
  DELETE FROM public.zane_food_favorites WHERE user_id = v_uid;
  DELETE FROM public.zane_food_barcode_overrides WHERE user_id = v_uid;
  DELETE FROM public.zane_food_shopping_prefs WHERE user_id = v_uid;
  DELETE FROM public.zane_food_template_days WHERE user_id = v_uid;
  DELETE FROM public.zane_exercises WHERE user_id = v_uid;
  DELETE FROM public.zane_schedules WHERE user_id = v_uid;
  DELETE FROM public.zane_skips WHERE user_id = v_uid;
  DELETE FROM public.zane_cardio_logs WHERE user_id = v_uid;
  DELETE FROM public.zane_daily_logs WHERE user_id = v_uid;
  DELETE FROM public.zane_water_logs WHERE user_id = v_uid;
  DELETE FROM public.zane_adaptive_tdee_history WHERE user_id = v_uid;
  DELETE FROM public.zane_workout_templates WHERE user_id = v_uid;
  DELETE FROM public.zane_checkin_schema_templates WHERE user_id = v_uid;
  DELETE FROM public.zane_glucose_logs WHERE user_id = v_uid;
  DELETE FROM public.zane_blood_pressure_logs WHERE user_id = v_uid;
  DELETE FROM public.zane_body_temp_logs WHERE user_id = v_uid;
  DELETE FROM public.zane_cardio_plans WHERE user_id = v_uid;
  DELETE FROM public.zane_status_periods WHERE user_id = v_uid;
  DELETE FROM public.zane_meso_states WHERE user_id = v_uid;
  -- Transient editor/autosnapshot state was cleared by the legacy restore and is
  -- deliberately not part of the personal archive.
  DELETE FROM public.zane_schedule_backups WHERE user_id = v_uid;
  DELETE FROM public.zane_plan_drafts WHERE user_id = v_uid;

  INSERT INTO public.zane_profiles (id,name,x_handle,x_handle_public,x_handle_prompt_opted_out)
  SELECT id,name,x_handle,x_handle_public,x_handle_prompt_opted_out FROM pg_temp.br_profile
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    x_handle = EXCLUDED.x_handle,
    x_handle_public = EXCLUDED.x_handle_public,
    x_handle_prompt_opted_out = EXCLUDED.x_handle_prompt_opted_out;

  INSERT INTO public.zane_exercises (
    id,user_id,name,tags,note,category,unilateral,equipment,progression_reps,
    movement_type,no_weight_reps,log_mode,pull_bodyweight,bodyweight_mode,
    youtube_url,note_pinned,progression_increment,horn_labels
  ) SELECT id,user_id,name,tags,note,category,unilateral,equipment,progression_reps,
    movement_type,no_weight_reps,log_mode,pull_bodyweight,bodyweight_mode,
    youtube_url,note_pinned,progression_increment,horn_labels
  FROM pg_temp.br_exercises;

  INSERT INTO public.zane_schedules (
    id,user_id,name,days,archived,versions,is_flex,sessions_per_week,mesocycle_weeks,
    mesocycle_start_rir,mesocycle_end_rir,mesocycle_rir_enabled,mesocycle_autoregulate,
    mesocycle_autoregulate_mode,program_type,program_data,is_template
  ) SELECT id,user_id,name,days,archived,versions,is_flex,sessions_per_week,mesocycle_weeks,
    mesocycle_start_rir,mesocycle_end_rir,mesocycle_rir_enabled,mesocycle_autoregulate,
    mesocycle_autoregulate_mode,program_type,program_data,is_template
  FROM pg_temp.br_schedules;

  -- Matching session rows are updated, never deleted, so existing Friends
  -- comments retain their ON DELETE CASCADE parent.
  INSERT INTO public.zane_sessions (
    id,user_id,schedule_id,day_id,day_name,date,ended,started_at,duration_minutes,feel,
    is_bonus,is_freestyle,is_deload,is_cleanup,meso_recap,readiness,signal_weight,cycle_pos,imported
  ) SELECT id,user_id,schedule_id,day_id,day_name,date,ended,started_at,duration_minutes,feel,
    is_bonus,is_freestyle,is_deload,is_cleanup,meso_recap,readiness,signal_weight,cycle_pos,imported
  FROM pg_temp.br_sessions
  ON CONFLICT (id) DO UPDATE SET
    schedule_id=EXCLUDED.schedule_id,day_id=EXCLUDED.day_id,day_name=EXCLUDED.day_name,
    date=EXCLUDED.date,ended=EXCLUDED.ended,started_at=EXCLUDED.started_at,
    duration_minutes=EXCLUDED.duration_minutes,feel=EXCLUDED.feel,
    is_bonus=EXCLUDED.is_bonus,is_freestyle=EXCLUDED.is_freestyle,
    is_deload=EXCLUDED.is_deload,is_cleanup=EXCLUDED.is_cleanup,
    meso_recap=EXCLUDED.meso_recap,readiness=EXCLUDED.readiness,
    signal_weight=EXCLUDED.signal_weight,cycle_pos=EXCLUDED.cycle_pos,
    imported=EXCLUDED.imported
  WHERE public.zane_sessions.user_id = v_uid;

  -- The preflight ownership check and this INSERT are separated by substantial
  -- validation work. If another account wins a same-ID insert in that window,
  -- the conditional ON CONFLICT above intentionally skips it. Detect that
  -- skipped row before inserting any child entries and roll back the restore.
  IF EXISTS (
    SELECT 1
    FROM pg_temp.br_sessions AS staged_session
    LEFT JOIN public.zane_sessions AS live_session
      ON live_session.id = staged_session.id
    WHERE live_session.id IS NULL
       OR live_session.user_id IS DISTINCT FROM v_uid
  ) THEN
    RAISE EXCEPTION 'backup restore session identity collided with another account';
  END IF;

  DELETE FROM public.zane_sessions AS live
  WHERE live.user_id = v_uid
    AND NOT EXISTS (SELECT 1 FROM pg_temp.br_sessions staged WHERE staged.id = live.id);

  INSERT INTO public.zane_session_entries (
    id,session_id,user_id,entry_idx,ex_id,name,planned_sets,planned_reps,
    planned_reps_per_set,planned_reps_max,planned_progression_offset,
    planned_techniques,note,superset_group
  ) SELECT id,session_id,user_id,entry_idx,ex_id,name,planned_sets,planned_reps,
    planned_reps_per_set,planned_reps_max,planned_progression_offset,
    planned_techniques,note,superset_group
  FROM pg_temp.br_session_entries;

  INSERT INTO public.zane_sets (
    id,session_id,entry_id,user_id,set_idx,kg,reps,reps_l,reps_r,time_sec,added_kg,
    done,skipped,warmup,technique,drops,horn_loads,updated_at
  ) SELECT id,session_id,entry_id,user_id,set_idx,kg,reps,reps_l,reps_r,time_sec,
    added_kg,done,skipped,warmup,technique,drops,horn_loads,updated_at
  FROM pg_temp.br_sets;

  INSERT INTO public.zane_skips (id,user_id,date,day_id,day_name,skip_reason,skipped_at)
  SELECT id,user_id,date,day_id,day_name,skip_reason,skipped_at FROM pg_temp.br_skips;

  INSERT INTO public.zane_cardio_logs (
    id,user_id,date,type,duration_minutes,distance_m,pace_feeling,effort,note,session_id
  ) SELECT id,user_id,date,type,duration_minutes,distance_m,pace_feeling,effort,note,session_id
  FROM pg_temp.br_cardio_logs;

  INSERT INTO public.zane_daily_logs (
    id,user_id,date,weight,steps,waist_cm,hips_cm,chest_cm,arm_cm,thigh_cm,calf_cm,
    body_fat_pct,calories,protein,carbs,fat,fiber,water_ml,note,off_plan_note,
    meal_of_choice,meal_of_choice_hour,food_day_closed,adherence,targets_snap,
    daily_coach_fields,ai_summary,ai_summary_generated_at
  ) SELECT id,user_id,date,weight,steps,waist_cm,hips_cm,chest_cm,arm_cm,thigh_cm,calf_cm,
    body_fat_pct,calories,protein,carbs,fat,fiber,water_ml,note,off_plan_note,
    meal_of_choice,meal_of_choice_hour,food_day_closed,adherence,targets_snap,
    daily_coach_fields,ai_summary,ai_summary_generated_at
  FROM pg_temp.br_daily_logs;

  INSERT INTO public.zane_water_logs (id,user_id,date,time,amount_ml,name,category,breakdown)
  SELECT id,user_id,date,time,amount_ml,name,category,breakdown FROM pg_temp.br_water_logs;

  INSERT INTO public.zane_adaptive_tdee_history (
    id,user_id,as_of_date,window_start,window_end,tdee_kcal,avg_calories_kcal,
    weight_start_kg,weight_end_kg,weight_change_kg,weight_rate_kg_week,day_span,
    calorie_days,weigh_ins,decision,source,targets_snapshot,calculated_at,decided_at,
    created_at,updated_at
  ) SELECT id,user_id,as_of_date,window_start,window_end,tdee_kcal,avg_calories_kcal,
    weight_start_kg,weight_end_kg,weight_change_kg,weight_rate_kg_week,day_span,
    calorie_days,weigh_ins,decision,source,targets_snapshot,calculated_at,decided_at,
    created_at,updated_at
  FROM pg_temp.br_adaptive_tdee_history;

  INSERT INTO public.zane_food_recipes (id,user_id,name,items,portions,cooked_weight_g,updated_at)
  SELECT id,user_id,name,items,portions,cooked_weight_g,updated_at FROM pg_temp.br_food_recipes;

  INSERT INTO public.zane_food_meal_plans (id,user_id,name,archived,is_template,coach_id,updated_at)
  SELECT id,user_id,name,archived,is_template,NULL::uuid,updated_at FROM pg_temp.br_food_meal_plans;

  INSERT INTO public.zane_food_template_slots (
    id,user_id,food_id,food_name,brand,source,quantity_g,calories,protein,carbs,fat,
    fiber,sugar,sat_fat,sodium_mg,recipe_items,recipe_id,logged_total_portions,
    logged_cooked_grams,logged_cooked_weight_g,hour,day_type,sort_idx,meal_plan_id
  ) SELECT id,user_id,food_id,food_name,brand,source,quantity_g,calories,protein,carbs,fat,
    fiber,sugar,sat_fat,sodium_mg,recipe_items,recipe_id,logged_total_portions,
    logged_cooked_grams,logged_cooked_weight_g,hour,day_type,sort_idx,meal_plan_id
  FROM pg_temp.br_food_template_slots;

  INSERT INTO public.zane_food_logs (
    id,user_id,date,time,food_id,food_name,brand,source,quantity_g,calories,protein,
    carbs,fat,fiber,sugar,sat_fat,sodium_mg,recipe_items,recipe_id,
    logged_total_portions,logged_cooked_grams,logged_cooked_weight_g,logged_unit,
    split_batch,planned,template_slot_id
  ) SELECT id,user_id,date,time,food_id,food_name,brand,source,quantity_g,calories,protein,
    carbs,fat,fiber,sugar,sat_fat,sodium_mg,recipe_items,recipe_id,
    logged_total_portions,logged_cooked_grams,logged_cooked_weight_g,logged_unit,
    split_batch,planned,template_slot_id
  FROM pg_temp.br_food_logs;

  INSERT INTO public.zane_food_favorites (
    id,user_id,food_id,food_name,brand,source,quantity_g,calories,protein,carbs,fat,
    fiber,sugar,sat_fat,sodium_mg,units
  ) SELECT id,user_id,food_id,food_name,brand,source,quantity_g,calories,protein,carbs,fat,
    fiber,sugar,sat_fat,sodium_mg,units
  FROM pg_temp.br_food_favorites;

  INSERT INTO public.zane_food_barcode_overrides (
    user_id,source,source_id,food_name,brand,kcal_per_100g,protein_per_100g,
    carbs_per_100g,fat_per_100g,created_at,updated_at
  ) SELECT user_id,source,source_id,food_name,brand,kcal_per_100g,protein_per_100g,
    carbs_per_100g,fat_per_100g,created_at,updated_at
  FROM pg_temp.br_food_barcode_overrides;

  INSERT INTO public.zane_food_shopping_prefs (
    id,user_id,food_id,shopping_key,name_override,excluded,excluded_until,package_size_g,
    low_stock_threshold_g,stock_baseline_g,stock_set_at,food_name,brand,updated_at
  ) SELECT id,user_id,food_id,shopping_key,name_override,excluded,excluded_until,package_size_g,
    low_stock_threshold_g,stock_baseline_g,stock_set_at,food_name,brand,updated_at
  FROM pg_temp.br_food_shopping_prefs;

  INSERT INTO public.zane_food_template_days (id,user_id,date)
  SELECT id,user_id,date FROM pg_temp.br_food_template_days;

  INSERT INTO public.zane_medication_plans (
    id,user_id,name,archived,is_template,coach_id,active,updated_at
  ) SELECT id,user_id,name,archived,is_template,NULL::uuid,active,updated_at
  FROM pg_temp.br_medication_plans;

  INSERT INTO public.zane_medications (
    id,user_id,name,brand,category,unit_label,package_size,low_stock_threshold,
    stock_baseline,stock_set_at,archived,exclude_from_pillbox,exclude_from_low_stock,
    track_stock,updated_at
  ) SELECT id,user_id,name,brand,category,unit_label,package_size,low_stock_threshold,
    stock_baseline,stock_set_at,archived,exclude_from_pillbox,exclude_from_low_stock,
    track_stock,updated_at
  FROM pg_temp.br_medications;

  INSERT INTO public.zane_medication_plan_items (id,user_id,medication_plan_id,medication_id)
  SELECT id,user_id,medication_plan_id,medication_id FROM pg_temp.br_medication_plan_items;

  INSERT INTO public.zane_medication_schedule_slots (
    id,user_id,medication_id,medication_plan_id,weekdays,hour,dose_qty,
    interval_days,start_date,end_date,updated_at
  ) SELECT id,user_id,medication_id,medication_plan_id,weekdays,hour,dose_qty,
    interval_days,start_date,end_date,updated_at
  FROM pg_temp.br_medication_schedule_slots;

  INSERT INTO public.zane_medication_logs (
    id,user_id,medication_id,medication_name,date,time,dose_qty,planned,skipped,
    schedule_slot_id,reminder_sent_at,reminder_count,snoozed_until
  ) SELECT id,user_id,medication_id,medication_name,date,time,dose_qty,planned,skipped,
    schedule_slot_id,reminder_sent_at,reminder_count,snoozed_until
  FROM pg_temp.br_medication_logs;

  INSERT INTO public.zane_workout_templates (id,user_id,name,exercises)
  SELECT id,user_id,name,exercises FROM pg_temp.br_workout_templates;

  INSERT INTO public.zane_checkin_schema_templates (id,user_id,name,schema)
  SELECT id,user_id,name,schema FROM pg_temp.br_checkin_schema_templates;

  INSERT INTO public.zane_glucose_logs (id,user_id,date,time,value_mmol,context,note)
  SELECT id,user_id,date,time,value_mmol,context,note FROM pg_temp.br_glucose_logs;

  INSERT INTO public.zane_blood_pressure_logs (id,user_id,date,time,systolic,diastolic,note)
  SELECT id,user_id,date,time,systolic,diastolic,note FROM pg_temp.br_blood_pressure_logs;

  INSERT INTO public.zane_body_temp_logs (id,user_id,date,time,value_c,note)
  SELECT id,user_id,date,time,value_c,note FROM pg_temp.br_body_temp_logs;

  INSERT INTO public.zane_cardio_plans (
    id,user_id,name,activity_type,archived,mode,days,manual_targets,goal,
    goal_due_date,start_fitness,generated_weeks,plan_start_date
  ) SELECT id,user_id,name,activity_type,archived,mode,days,manual_targets,goal,
    goal_due_date,start_fitness,generated_weeks,plan_start_date
  FROM pg_temp.br_cardio_plans;

  INSERT INTO public.zane_status_periods (id,user_id,mode,started_at,ended_at)
  SELECT id,user_id,mode,started_at,ended_at FROM pg_temp.br_status_periods;

  INSERT INTO public.zane_meso_states (
    id,user_id,schedule_id,weeks,start_date,start_cycle_index,started_at,deltas,
    weight_boosts,weight_boost_declines,joint_flags,pump_low_counts,growth_counts,
    rep_miss_counts,affinity,autoreg_state,completions,pending_meso2
  ) SELECT id,user_id,schedule_id,weeks,start_date,start_cycle_index,started_at,deltas,
    weight_boosts,weight_boost_declines,joint_flags,pump_low_counts,growth_counts,
    rep_miss_counts,affinity,autoreg_state,completions,pending_meso2
  FROM pg_temp.br_meso_states;

  -- Settings are restored after every referenced row exists.
  INSERT INTO public.zane_user_settings (
    user_id,active_schedule_id,active_meal_template_id,cycle_index,cycle_start_date,
    week_plan_start_date,last_advanced_date,in_progress_session_id,unit,rest_default,
    rest_big,rest_medium,rest_small,auto_open_rest_timer,cycle_week_view,week_start_day,
    accent_color,dark_mode,custom_day_types,
    reminder_enabled,reminder_time,tempo_enabled,tempo_eccentric,tempo_concentric,
    smart_progression,progression_range_top,equipment_config,weight_fill_down,net_carbs,
    food_force_grams,plan_mode,hide_food_categories,show_warmup_in_summary,
    session_timeout_minutes,macro_targets,macro_calc,meal_windows,meal_categories,
    fasting_protocol,show_health_tab,show_water_tab,show_food_tab,onboarding_completed,
    show_regression,pin_all_notes,glucose_unit,temp_unit,hidden_health_cards,
    fever_threshold_c,cleanup_percent,watermark_opacity,default_checkin_schema,
    vip_background,active_cardio_plan_id,status_mode,status_mode_since,
    deload_prompt_dismissed_at,water_goal_ml,water_start_time,water_end_time,
    water_bottles_today,water_bottles_date,water_drinks,water_coffee_sizes,
    water_bottle_enabled,water_bottle_ml,water_reminder_enabled,meal_reminder_enabled,
    meds_enabled,medication_reminder_enabled,daily_log_reminder_enabled,
    daily_log_reminder_time,pillbox_slots
  ) SELECT user_id,active_schedule_id,active_meal_template_id,cycle_index,cycle_start_date,
    week_plan_start_date,last_advanced_date,in_progress_session_id,unit,rest_default,
    rest_big,rest_medium,rest_small,auto_open_rest_timer,cycle_week_view,week_start_day,
    accent_color,dark_mode,custom_day_types,
    reminder_enabled,reminder_time,tempo_enabled,tempo_eccentric,tempo_concentric,
    smart_progression,progression_range_top,equipment_config,weight_fill_down,net_carbs,
    food_force_grams,plan_mode,hide_food_categories,show_warmup_in_summary,
    session_timeout_minutes,macro_targets,macro_calc,meal_windows,meal_categories,
    fasting_protocol,show_health_tab,show_water_tab,show_food_tab,onboarding_completed,
    show_regression,pin_all_notes,glucose_unit,temp_unit,hidden_health_cards,
    fever_threshold_c,cleanup_percent,watermark_opacity,default_checkin_schema,
    vip_background,active_cardio_plan_id,status_mode,status_mode_since,
    deload_prompt_dismissed_at,water_goal_ml,water_start_time,water_end_time,
    water_bottles_today,water_bottles_date,water_drinks,water_coffee_sizes,
    water_bottle_enabled,water_bottle_ml,water_reminder_enabled,meal_reminder_enabled,
    meds_enabled,medication_reminder_enabled,daily_log_reminder_enabled,
    daily_log_reminder_time,pillbox_slots
  FROM pg_temp.br_settings
  ON CONFLICT (user_id) DO UPDATE SET (
    active_schedule_id,active_meal_template_id,cycle_index,cycle_start_date,
    week_plan_start_date,last_advanced_date,in_progress_session_id,unit,rest_default,
    rest_big,rest_medium,rest_small,auto_open_rest_timer,cycle_week_view,week_start_day,
    accent_color,dark_mode,custom_day_types,reminder_enabled,reminder_time,tempo_enabled,
    tempo_eccentric,tempo_concentric,smart_progression,progression_range_top,
    equipment_config,weight_fill_down,net_carbs,food_force_grams,plan_mode,
    hide_food_categories,show_warmup_in_summary,session_timeout_minutes,macro_targets,
    macro_calc,meal_windows,meal_categories,fasting_protocol,show_health_tab,
    show_water_tab,show_food_tab,onboarding_completed,show_regression,pin_all_notes,
    glucose_unit,temp_unit,hidden_health_cards,fever_threshold_c,cleanup_percent,
    watermark_opacity,default_checkin_schema,vip_background,active_cardio_plan_id,
    status_mode,status_mode_since,deload_prompt_dismissed_at,water_goal_ml,
    water_start_time,water_end_time,water_bottles_today,water_bottles_date,
    water_drinks,water_coffee_sizes,water_bottle_enabled,water_bottle_ml,
    water_reminder_enabled,meal_reminder_enabled,meds_enabled,
    medication_reminder_enabled,daily_log_reminder_enabled,daily_log_reminder_time,
    pillbox_slots
  ) = (
    EXCLUDED.active_schedule_id,EXCLUDED.active_meal_template_id,EXCLUDED.cycle_index,
    EXCLUDED.cycle_start_date,EXCLUDED.week_plan_start_date,EXCLUDED.last_advanced_date,
    EXCLUDED.in_progress_session_id,EXCLUDED.unit,EXCLUDED.rest_default,
    EXCLUDED.rest_big,EXCLUDED.rest_medium,EXCLUDED.rest_small,
    EXCLUDED.auto_open_rest_timer,EXCLUDED.cycle_week_view,EXCLUDED.week_start_day,
    EXCLUDED.accent_color,EXCLUDED.dark_mode,EXCLUDED.custom_day_types,
    EXCLUDED.reminder_enabled,EXCLUDED.reminder_time,EXCLUDED.tempo_enabled,
    EXCLUDED.tempo_eccentric,EXCLUDED.tempo_concentric,EXCLUDED.smart_progression,
    EXCLUDED.progression_range_top,EXCLUDED.equipment_config,EXCLUDED.weight_fill_down,
    EXCLUDED.net_carbs,EXCLUDED.food_force_grams,EXCLUDED.plan_mode,
    EXCLUDED.hide_food_categories,EXCLUDED.show_warmup_in_summary,
    EXCLUDED.session_timeout_minutes,EXCLUDED.macro_targets,EXCLUDED.macro_calc,
    EXCLUDED.meal_windows,EXCLUDED.meal_categories,EXCLUDED.fasting_protocol,
    EXCLUDED.show_health_tab,EXCLUDED.show_water_tab,EXCLUDED.show_food_tab,
    EXCLUDED.onboarding_completed,EXCLUDED.show_regression,EXCLUDED.pin_all_notes,
    EXCLUDED.glucose_unit,EXCLUDED.temp_unit,EXCLUDED.hidden_health_cards,
    EXCLUDED.fever_threshold_c,EXCLUDED.cleanup_percent,EXCLUDED.watermark_opacity,
    EXCLUDED.default_checkin_schema,EXCLUDED.vip_background,EXCLUDED.active_cardio_plan_id,
    EXCLUDED.status_mode,EXCLUDED.status_mode_since,EXCLUDED.deload_prompt_dismissed_at,
    EXCLUDED.water_goal_ml,EXCLUDED.water_start_time,EXCLUDED.water_end_time,
    EXCLUDED.water_bottles_today,EXCLUDED.water_bottles_date,EXCLUDED.water_drinks,
    EXCLUDED.water_coffee_sizes,EXCLUDED.water_bottle_enabled,EXCLUDED.water_bottle_ml,
    EXCLUDED.water_reminder_enabled,EXCLUDED.meal_reminder_enabled,EXCLUDED.meds_enabled,
    EXCLUDED.medication_reminder_enabled,EXCLUDED.daily_log_reminder_enabled,
    EXCLUDED.daily_log_reminder_time,EXCLUDED.pillbox_slots
  );

  v_receipt := pg_catalog.jsonb_build_object(
    'operation_id', p_operation_id,
    'status', 'committed',
    'restore_digest', v_staged_digest,
    'row_count', v_expected_rows,
    'table_counts', v_table_counts
  );

  UPDATE app_private.zane_backup_restore_jobs
  SET status = 'committed',
      receipt = v_receipt,
      committed_at = now(),
      updated_at = now(),
      expires_at = now()
  WHERE owner_id = v_uid
    AND operation_id = p_operation_id;

  DELETE FROM app_private.zane_backup_restore_chunks
  WHERE owner_id = v_uid
    AND operation_id = p_operation_id;

  RETURN v_receipt;
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_backup_restore(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_backup_restore(text) FROM anon;
REVOKE ALL ON FUNCTION public.commit_backup_restore(text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.commit_backup_restore(text) TO authenticated;
