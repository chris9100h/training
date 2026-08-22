-- Run only against a synthetic Preview database after the atomic backup-restore
-- migration. The complete contract is transactional and leaves no test users or
-- application rows behind.

BEGIN;

DO $privileges$
DECLARE
  v_signature text;
  v_restore_defs text;
  v_preserved_table text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.begin_backup_restore(text,jsonb)',
    'public.stage_backup_restore_chunk(text,integer,jsonb,text)',
    'public.commit_backup_restore(text)'
  ]::text[] LOOP
    IF pg_catalog.to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'atomic backup restore RPC is missing: %', v_signature;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_signature, 'execute') THEN
      RAISE EXCEPTION 'anon can execute %', v_signature;
    END IF;
    IF pg_catalog.has_function_privilege('service_role', v_signature, 'execute') THEN
      RAISE EXCEPTION 'service_role can execute user-scoped restore RPC %', v_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'execute') THEN
      RAISE EXCEPTION 'authenticated cannot execute %', v_signature;
    END IF;
  END LOOP;

  IF pg_catalog.has_schema_privilege('authenticated', 'app_private', 'usage')
     OR pg_catalog.has_schema_privilege('anon', 'app_private', 'usage')
     OR pg_catalog.has_table_privilege('authenticated', 'app_private.zane_backup_restore_jobs', 'select')
     OR pg_catalog.has_table_privilege('authenticated', 'app_private.zane_backup_restore_jobs', 'insert')
     OR pg_catalog.has_table_privilege('authenticated', 'app_private.zane_backup_restore_chunks', 'select')
     OR pg_catalog.has_table_privilege('authenticated', 'app_private.zane_backup_restore_chunks', 'insert')
  THEN
    RAISE EXCEPTION 'restore staging is directly reachable outside the authenticated RPCs';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'public'
      AND proc.proname = 'begin_backup_restore'
      AND proc.prosecdef
      AND EXISTS (
        SELECT 1 FROM pg_catalog.unnest(COALESCE(proc.proconfig, '{}'::text[])) AS setting
        WHERE setting IN ('search_path=', 'search_path=""')
      )
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'public'
      AND proc.proname = 'stage_backup_restore_chunk'
      AND proc.prosecdef
      AND EXISTS (
        SELECT 1 FROM pg_catalog.unnest(COALESCE(proc.proconfig, '{}'::text[])) AS setting
        WHERE setting IN ('search_path=', 'search_path=""')
      )
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'public'
      AND proc.proname = 'commit_backup_restore'
      AND proc.prosecdef
      AND EXISTS (
        SELECT 1 FROM pg_catalog.unnest(COALESCE(proc.proconfig, '{}'::text[])) AS setting
        WHERE setting IN ('search_path=', 'search_path=""')
      )
  ) THEN
    RAISE EXCEPTION 'restore RPCs must be SECURITY DEFINER with an empty search_path';
  END IF;

  IF app_private.backup_restore_hash(
       '{"offset":0,"rows":[{"unit":"kg"}],"section":"settings"}'::jsonb
     ) IS DISTINCT FROM '0f2c2a990854810f025b287c509ea31bc65ff369ddf6ef56bbee6eb1815130f8'
  THEN
    RAISE EXCEPTION 'database canonical chunk hashing differs from the client protocol';
  END IF;

  SELECT pg_catalog.string_agg(pg_catalog.pg_get_functiondef(proc.oid), E'\n')
  INTO v_restore_defs
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
  WHERE (namespace.nspname = 'public' AND proc.proname = ANY(ARRAY[
           'begin_backup_restore','stage_backup_restore_chunk','commit_backup_restore'
         ]::text[]))
     OR (namespace.nspname = 'app_private' AND proc.proname LIKE 'backup_restore%');

  FOREACH v_preserved_table IN ARRAY ARRAY[
    'zane_social_profiles',
    'zane_coaching',
    'zane_coaching_drive_connections',
    'zane_push_subscriptions',
    'zane_pushover_active',
    'zane_recipe_shares',
    'zane_medication_pillbox_checks',
    'zane_reminder_delivery_claims'
  ]::text[] LOOP
    IF pg_catalog.strpos(v_restore_defs, v_preserved_table) > 0 THEN
      RAISE EXCEPTION 'restore implementation references preserved domain table %', v_preserved_table;
    END IF;
  END LOOP;
END;
$privileges$;

-- Fixed synthetic identities. The outer ROLLBACK makes the contract repeatable.
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'ba000000-0000-4000-8000-000000000001'::uuid,
    'authenticated', 'authenticated', 'atomic-restore-owner@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"Atomic restore owner"}'::jsonb, now(), now()
  ),
  (
    'ba000000-0000-4000-8000-000000000002'::uuid,
    'authenticated', 'authenticated', 'atomic-restore-other@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"Atomic restore other"}'::jsonb, now(), now()
  );

INSERT INTO public.zane_profiles (id, name, tier)
VALUES
  ('ba000000-0000-4000-8000-000000000001'::uuid, 'Owner before restore', 'lifetime'),
  ('ba000000-0000-4000-8000-000000000002'::uuid, 'Other before restore', 'free')
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name, tier = EXCLUDED.tier;

INSERT INTO public.zane_user_settings (
  user_id, unit, push_enabled, pushover_user_key, use_pushover,
  show_coaching_tab, show_friends_tab, social_push_messages,
  social_push_friend_requests, social_push_finished_comments,
  social_push_friend_started
) VALUES
  (
    'ba000000-0000-4000-8000-000000000001'::uuid, 'lbs', true,
    'preserve-pushover-key', true, true, true, true, true, true, true
  ),
  ('ba000000-0000-4000-8000-000000000002'::uuid, 'lbs', false, NULL, false, false, false, false, false, false, false)
ON CONFLICT (user_id) DO UPDATE
SET unit = EXCLUDED.unit,
    push_enabled = EXCLUDED.push_enabled,
    pushover_user_key = EXCLUDED.pushover_user_key,
    use_pushover = EXCLUDED.use_pushover,
    show_coaching_tab = EXCLUDED.show_coaching_tab,
    show_friends_tab = EXCLUDED.show_friends_tab,
    social_push_messages = EXCLUDED.social_push_messages,
    social_push_friend_requests = EXCLUDED.social_push_friend_requests,
    social_push_finished_comments = EXCLUDED.social_push_finished_comments,
    social_push_friend_started = EXCLUDED.social_push_friend_started;

INSERT INTO public.zane_exercises (id, user_id, name, tags)
VALUES
  ('atomic-owner-live', 'ba000000-0000-4000-8000-000000000001'::uuid, 'Owner live sentinel', '{}'::text[]),
  ('atomic-other-live', 'ba000000-0000-4000-8000-000000000002'::uuid, 'Other live sentinel', '{}'::text[]);

INSERT INTO public.zane_sessions (
  id, user_id, day_name, date, ended, imported
) VALUES (
  'atomic-owner-session',
  'ba000000-0000-4000-8000-000000000001'::uuid,
  'Atomic day',
  '2026-08-22T10:00:00Z'::timestamptz,
  '2026-08-22T11:00:00Z'::timestamptz,
  true
);

-- Deliberately create history that is legal at the table-constraint level but
-- internally inconsistent: zane_sets.session_id has no foreign key, so an old
-- buggy client could leave it pointing at a different session than its entry.
-- A successful restore must clean this up, while a rejected restore must leave
-- the account byte-for-byte untouched.
INSERT INTO public.zane_session_entries (
  id, session_id, user_id, entry_idx, name
) VALUES (
  'atomic-owner-corrupt-entry',
  'atomic-owner-session',
  'ba000000-0000-4000-8000-000000000001'::uuid,
  0,
  'Synthetic damaged entry'
);

INSERT INTO public.zane_sets (
  id, session_id, entry_id, user_id, set_idx, kg, reps, done
) VALUES (
  'atomic-owner-corrupt-set',
  'atomic-wrong-session-id',
  'atomic-owner-corrupt-entry',
  'ba000000-0000-4000-8000-000000000001'::uuid,
  0,
  100,
  5,
  true
);

INSERT INTO public.zane_social_workout_comments (
  id, session_id, author_id, kind, body
) VALUES (
  'ba000000-0000-4000-8000-000000000010'::uuid,
  'atomic-owner-session',
  'ba000000-0000-4000-8000-000000000002'::uuid,
  'comment',
  'Preserve this social comment through restore'
);

CREATE TEMP TABLE atomic_backup_restore_fixture_chunks (
  chunk_index integer PRIMARY KEY,
  section text NOT NULL,
  chunk jsonb NOT NULL,
  chunk_hash text NOT NULL,
  byte_count integer NOT NULL
) ON COMMIT DROP;

DO $fixture$
DECLARE
  v_owner constant uuid := 'ba000000-0000-4000-8000-000000000001'::uuid;
  v_section text;
  v_index integer;
  v_rows jsonb;
  v_row jsonb;
  v_chunk jsonb;
BEGIN
  FOR v_section, v_index IN
    SELECT section, ordinality::integer - 1
    FROM pg_catalog.unnest(app_private.backup_restore_sections())
      WITH ORDINALITY AS listed(section, ordinality)
    ORDER BY ordinality
  LOOP
    v_rows := '[]'::jsonb;
    IF v_section = 'profile' THEN
      SELECT pg_catalog.jsonb_object_agg(field.key, field.value)
      INTO v_row
      FROM public.zane_profiles AS profile
      CROSS JOIN LATERAL pg_catalog.jsonb_each(pg_catalog.to_jsonb(profile)) AS field
      WHERE profile.id = v_owner
        AND field.key = ANY(app_private.backup_restore_allowed_columns('profile'));
      v_row := v_row || pg_catalog.jsonb_build_object('name', 'Owner restored atomically');
      v_rows := pg_catalog.jsonb_build_array(v_row);
    ELSIF v_section = 'settings' THEN
      SELECT pg_catalog.jsonb_object_agg(field.key, field.value)
      INTO v_row
      FROM public.zane_user_settings AS settings
      CROSS JOIN LATERAL pg_catalog.jsonb_each(pg_catalog.to_jsonb(settings)) AS field
      WHERE settings.user_id = v_owner
        AND field.key = ANY(app_private.backup_restore_allowed_columns('settings'));
      -- Match the official client: external provider and Social/Coaching
      -- preferences are omitted from the portable settings row and must be
      -- merged from live server state by commit.
      v_row := v_row
        - 'push_enabled'
        - 'pushover_user_key'
        - 'use_pushover'
        - 'show_coaching_tab'
        - 'show_friends_tab'
        - 'social_push_messages'
        - 'social_push_friend_requests'
        - 'social_push_finished_comments'
        - 'social_push_friend_started'
        - 'be_your_own_coach';
      v_row := v_row || pg_catalog.jsonb_build_object('unit', 'kg');
      v_rows := pg_catalog.jsonb_build_array(v_row);
    ELSIF v_section = 'schedules' THEN
      v_rows := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', 'atomic-plan',
        'name', 'Atomic restored plan',
        'days', '[]'::jsonb,
        'archived', false,
        'versions', '[]'::jsonb,
        'is_flex', false,
        'mesocycle_rir_enabled', true,
        'mesocycle_autoregulate', false,
        'is_template', false
      ));
    ELSIF v_section = 'sessions' THEN
      SELECT pg_catalog.jsonb_object_agg(field.key, field.value)
      INTO v_row
      FROM public.zane_sessions AS session
      CROSS JOIN LATERAL pg_catalog.jsonb_each(pg_catalog.to_jsonb(session)) AS field
      WHERE session.id = 'atomic-owner-session'
        AND field.key = ANY(app_private.backup_restore_allowed_columns('sessions'));
      v_rows := pg_catalog.jsonb_build_array(v_row);
    ELSIF v_section = 'adaptive_tdee_history' THEN
      v_rows := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'as_of_date', '2026-08-22',
        'window_start', '2026-08-08',
        'window_end', '2026-08-21',
        'tdee_kcal', 2500,
        'avg_calories_kcal', 2450,
        'weight_start_kg', 90.0,
        'weight_end_kg', 89.8,
        'weight_change_kg', -0.2,
        'weight_rate_kg_week', -0.1,
        'day_span', 14,
        'calorie_days', 14,
        'weigh_ins', 3,
        'decision', 'kept',
        'source', 'live',
        'calculated_at', '2026-08-22T08:00:00Z',
        'created_at', '2026-08-22T08:00:00Z',
        'updated_at', '2026-08-22T08:00:00Z'
      ));
    ELSIF v_section = 'food_logs' THEN
      v_rows := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', 'atomic-legacy-food-log',
        'date', '2026-08-22',
        'time', '12:00',
        'food_id', 'shared-food-removed-after-export',
        'food_name', 'Legacy food snapshot',
        'quantity_g', 100,
        'calories', 100,
        'protein', 10,
        'carbs', 10,
        'fat', 2,
        'recipe_id', 'personal-recipe-missing-from-old-backup',
        'planned', false
      ));
    ELSIF v_section = 'food_favorites' THEN
      v_rows := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', 'atomic-legacy-favorite',
        'food_id', 'shared-favorite-removed-after-export',
        'food_name', 'Legacy favorite snapshot',
        'quantity_g', 100,
        'calories', 100,
        'protein', 10,
        'carbs', 10,
        'fat', 2,
        'units', '[]'::jsonb
      ));
    ELSIF v_section = 'food_template_slots' THEN
      v_rows := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', 'atomic-legacy-food-slot',
        'food_id', 'shared-slot-food-removed-after-export',
        'food_name', 'Legacy slot snapshot',
        'quantity_g', 100,
        'calories', 100,
        'protein', 10,
        'carbs', 10,
        'fat', 2,
        'recipe_id', 'personal-slot-recipe-missing-from-old-backup',
        'hour', 12,
        'day_type', 'any',
        'sort_idx', 0
      ));
    ELSIF v_section = 'food_shopping_prefs' THEN
      v_rows := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', 'atomic-legacy-shopping-pref',
        'food_id', 'shared-shopping-food-removed-after-export',
        'shopping_key', 'legacy-shopping-key',
        'food_name', 'Legacy shopping snapshot',
        'excluded', false,
        'updated_at', '2026-08-22T08:00:00Z'
      ));
    ELSIF v_section = 'meso_states' THEN
      v_rows := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'schedule_id', 'atomic-plan',
        'weeks', 6,
        'start_date', '2026-08-01',
        'start_cycle_index', 0,
        'deltas', '{}'::jsonb,
        'weight_boosts', '{}'::jsonb,
        'weight_boost_declines', '{}'::jsonb,
        'joint_flags', '{}'::jsonb,
        'pump_low_counts', '{}'::jsonb,
        'growth_counts', '{}'::jsonb,
        'rep_miss_counts', '{}'::jsonb,
        'affinity', '{}'::jsonb,
        'completions', 0,
        'pending_meso2', false
      ));
    END IF;

    v_chunk := pg_catalog.jsonb_build_object(
      'section', v_section,
      'offset', 0,
      'rows', v_rows
    );
    INSERT INTO pg_temp.atomic_backup_restore_fixture_chunks (
      chunk_index, section, chunk, chunk_hash, byte_count
    ) VALUES (
      v_index,
      v_section,
      v_chunk,
      app_private.backup_restore_hash(v_chunk),
      pg_catalog.octet_length(pg_catalog.convert_to(
        app_private.backup_restore_canonical_json(v_chunk), 'UTF8'
      ))
    );
  END LOOP;
END;
$fixture$;

CREATE FUNCTION pg_temp.atomic_backup_restore_manifest(p_operation_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'operation_id', p_operation_id,
    'version', 1,
    'normalizer_version', 1,
    'chunks', pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'index', fixture.chunk_index,
        'section', fixture.section,
        'offset', fixture.chunk->'offset',
        'row_count', pg_catalog.jsonb_array_length(fixture.chunk->'rows'),
        'hash', fixture.chunk_hash
      ) ORDER BY fixture.chunk_index
    ),
    'totals', pg_catalog.jsonb_build_object(
      'chunk_count', pg_catalog.count(*),
      'row_count', pg_catalog.sum(pg_catalog.jsonb_array_length(fixture.chunk->'rows')),
      'byte_count', pg_catalog.sum(fixture.byte_count)
    )
  )
  FROM pg_temp.atomic_backup_restore_fixture_chunks AS fixture;
$function$;

CREATE FUNCTION pg_temp.atomic_backup_restore_expected_digest()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.string_agg(fixture.chunk_hash, '' ORDER BY fixture.chunk_index),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  FROM pg_temp.atomic_backup_restore_fixture_chunks AS fixture;
$function$;

CREATE FUNCTION pg_temp.atomic_backup_restore_fail_late()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'synthetic late restore failure';
END;
$function$;

CREATE FUNCTION pg_temp.atomic_backup_restore_reject_preserved_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'restore touched preserved table %', TG_TABLE_NAME;
END;
$function$;

CREATE FUNCTION pg_temp.atomic_backup_restore_inject_session_collision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.zane_sessions (
    id, user_id, day_name, date, ended, imported
  ) VALUES (
    'atomic-race-session',
    'ba000000-0000-4000-8000-000000000002'::uuid,
    'Synthetic competing session',
    '2026-08-22T12:00:00Z'::timestamptz,
    '2026-08-22T12:30:00Z'::timestamptz,
    true
  );
  RETURN NULL;
END;
$function$;

DO $behavior$
DECLARE
  v_owner constant uuid := 'ba000000-0000-4000-8000-000000000001'::uuid;
  v_other constant uuid := 'ba000000-0000-4000-8000-000000000002'::uuid;
  v_incomplete constant text := 'restore_contract_incomplete';
  v_broken constant text := 'restore_contract_broken_history';
  v_race constant text := 'restore_contract_session_race';
  v_social_omit constant text := 'restore_contract_social_omit';
  v_late_fail constant text := 'restore_contract_late_failure';
  v_success constant text := 'restore_contract_success';
  v_manifest jsonb;
  v_receipt jsonb;
  v_replayed jsonb;
  v_failed boolean;
  v_chunk record;
  v_preserved_table text;
  v_original_chunk jsonb;
  v_original_session_chunk jsonb;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );

  -- An incomplete or interrupted upload never reaches live tables.
  v_manifest := pg_temp.atomic_backup_restore_manifest(v_incomplete);
  PERFORM public.begin_backup_restore(v_incomplete, v_manifest);

  -- Another authenticated identity cannot see or stage against the owner's job.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_other, 'role', 'authenticated')::text,
    true
  );
  SELECT * INTO v_chunk
  FROM pg_temp.atomic_backup_restore_fixture_chunks
  WHERE chunk_index = 0;
  v_failed := false;
  BEGIN
    PERFORM public.stage_backup_restore_chunk(
      v_incomplete, v_chunk.chunk_index, v_chunk.chunk, v_chunk.chunk_hash
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'another owner staged a foreign restore operation';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );
  FOR v_chunk IN
    SELECT *
    FROM pg_temp.atomic_backup_restore_fixture_chunks
    WHERE chunk_index < 32
    ORDER BY chunk_index
  LOOP
    PERFORM public.stage_backup_restore_chunk(
      v_incomplete, v_chunk.chunk_index, v_chunk.chunk, v_chunk.chunk_hash
    );
  END LOOP;
  v_failed := false;
  BEGIN
    PERFORM public.commit_backup_restore(v_incomplete);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'incomplete backup restore unexpectedly committed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.zane_exercises
    WHERE user_id = v_owner AND id = 'atomic-owner-live'
  ) THEN
    RAISE EXCEPTION 'incomplete staging mutated live personal data';
  END IF;
  DELETE FROM app_private.zane_backup_restore_jobs
  WHERE owner_id = v_owner AND operation_id = v_incomplete;

  -- A structurally broken archive is fully staged but points an entry at a
  -- session absent from the replacement payload. Commit must reject it before
  -- the first live DELETE, leaving even the pre-existing damaged history intact.
  SELECT chunk INTO v_original_chunk
  FROM pg_temp.atomic_backup_restore_fixture_chunks
  WHERE section = 'session_entries';
  UPDATE pg_temp.atomic_backup_restore_fixture_chunks
  SET chunk = pg_catalog.jsonb_build_object(
        'section', 'session_entries',
        'offset', 0,
        'rows', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'id', 'atomic-broken-entry',
          'session_id', 'atomic-missing-session',
          'entry_idx', 0,
          'name', 'Broken archive entry'
        ))
      )
  WHERE section = 'session_entries';
  UPDATE pg_temp.atomic_backup_restore_fixture_chunks
  SET chunk_hash = app_private.backup_restore_hash(chunk),
      byte_count = pg_catalog.octet_length(pg_catalog.convert_to(
        app_private.backup_restore_canonical_json(chunk), 'UTF8'
      ))
  WHERE section = 'session_entries';

  v_manifest := pg_temp.atomic_backup_restore_manifest(v_broken);
  PERFORM public.begin_backup_restore(v_broken, v_manifest);
  FOR v_chunk IN
    SELECT * FROM pg_temp.atomic_backup_restore_fixture_chunks ORDER BY chunk_index
  LOOP
    PERFORM public.stage_backup_restore_chunk(
      v_broken, v_chunk.chunk_index, v_chunk.chunk, v_chunk.chunk_hash
    );
  END LOOP;
  v_failed := false;
  BEGIN
    PERFORM public.commit_backup_restore(v_broken);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'broken backup history unexpectedly committed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.zane_sets
    WHERE user_id = v_owner
      AND id = 'atomic-owner-corrupt-set'
      AND session_id = 'atomic-wrong-session-id'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.zane_exercises
    WHERE user_id = v_owner AND id = 'atomic-owner-live'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.zane_user_settings
    WHERE user_id = v_owner AND unit = 'lbs' AND push_enabled
  ) THEN
    RAISE EXCEPTION 'broken archive changed the existing account before rejection';
  END IF;
  DELETE FROM app_private.zane_backup_restore_jobs
  WHERE owner_id = v_owner AND operation_id = v_broken;

  UPDATE pg_temp.atomic_backup_restore_fixture_chunks
  SET chunk = v_original_chunk,
      chunk_hash = app_private.backup_restore_hash(v_original_chunk),
      byte_count = pg_catalog.octet_length(pg_catalog.convert_to(
        app_private.backup_restore_canonical_json(v_original_chunk), 'UTF8'
      ))
  WHERE section = 'session_entries';

  -- Simulate the narrow race between the preflight ownership check and the
  -- session upsert. A second account wins a previously unused session ID after
  -- preflight; the post-upsert ownership assertion must reject and roll back
  -- every mutation, including the competing trigger insert.
  SELECT chunk INTO v_original_session_chunk
  FROM pg_temp.atomic_backup_restore_fixture_chunks
  WHERE section = 'sessions';
  UPDATE pg_temp.atomic_backup_restore_fixture_chunks
  SET chunk = pg_catalog.jsonb_set(
        chunk,
        '{rows}',
        (chunk->'rows') || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'id', 'atomic-race-session',
          'day_name', 'Restored race day',
          'date', '2026-08-22T12:00:00Z',
          'ended', '2026-08-22T12:30:00Z',
          'imported', true
        ))
      )
  WHERE section = 'sessions';
  UPDATE pg_temp.atomic_backup_restore_fixture_chunks
  SET chunk_hash = app_private.backup_restore_hash(chunk),
      byte_count = pg_catalog.octet_length(pg_catalog.convert_to(
        app_private.backup_restore_canonical_json(chunk), 'UTF8'
      ))
  WHERE section = 'sessions';

  v_manifest := pg_temp.atomic_backup_restore_manifest(v_race);
  PERFORM public.begin_backup_restore(v_race, v_manifest);
  FOR v_chunk IN
    SELECT * FROM pg_temp.atomic_backup_restore_fixture_chunks ORDER BY chunk_index
  LOOP
    PERFORM public.stage_backup_restore_chunk(
      v_race, v_chunk.chunk_index, v_chunk.chunk, v_chunk.chunk_hash
    );
  END LOOP;
  CREATE TRIGGER atomic_backup_restore_session_collision
    AFTER INSERT ON public.zane_schedules
    FOR EACH STATEMENT EXECUTE FUNCTION pg_temp.atomic_backup_restore_inject_session_collision();
  v_failed := false;
  BEGIN
    PERFORM public.commit_backup_restore(v_race);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  DROP TRIGGER atomic_backup_restore_session_collision ON public.zane_schedules;
  IF NOT v_failed
     OR EXISTS (
       SELECT 1 FROM public.zane_sessions
       WHERE id = 'atomic-race-session'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.zane_exercises
       WHERE user_id = v_owner AND id = 'atomic-owner-live'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.zane_sets
       WHERE user_id = v_owner
         AND id = 'atomic-owner-corrupt-set'
         AND session_id = 'atomic-wrong-session-id'
     )
  THEN
    RAISE EXCEPTION 'cross-account session race did not roll back safely';
  END IF;
  DELETE FROM app_private.zane_backup_restore_jobs
  WHERE owner_id = v_owner AND operation_id = v_race;

  UPDATE pg_temp.atomic_backup_restore_fixture_chunks
  SET chunk = v_original_session_chunk,
      chunk_hash = app_private.backup_restore_hash(v_original_session_chunk),
      byte_count = pg_catalog.octet_length(pg_catalog.convert_to(
        app_private.backup_restore_canonical_json(v_original_session_chunk), 'UTF8'
      ))
  WHERE section = 'sessions';

  -- Social comments are intentionally outside the portable backup. Omitting a
  -- commented workout must reject instead of cascade-deleting another user's
  -- comment as collateral damage.
  SELECT chunk INTO v_original_session_chunk
  FROM pg_temp.atomic_backup_restore_fixture_chunks
  WHERE section = 'sessions';
  UPDATE pg_temp.atomic_backup_restore_fixture_chunks
  SET chunk = pg_catalog.jsonb_build_object(
        'section', 'sessions',
        'offset', 0,
        'rows', '[]'::jsonb
      )
  WHERE section = 'sessions';
  UPDATE pg_temp.atomic_backup_restore_fixture_chunks
  SET chunk_hash = app_private.backup_restore_hash(chunk),
      byte_count = pg_catalog.octet_length(pg_catalog.convert_to(
        app_private.backup_restore_canonical_json(chunk), 'UTF8'
      ))
  WHERE section = 'sessions';

  v_manifest := pg_temp.atomic_backup_restore_manifest(v_social_omit);
  PERFORM public.begin_backup_restore(v_social_omit, v_manifest);
  FOR v_chunk IN
    SELECT * FROM pg_temp.atomic_backup_restore_fixture_chunks ORDER BY chunk_index
  LOOP
    PERFORM public.stage_backup_restore_chunk(
      v_social_omit, v_chunk.chunk_index, v_chunk.chunk, v_chunk.chunk_hash
    );
  END LOOP;
  v_failed := false;
  BEGIN
    PERFORM public.commit_backup_restore(v_social_omit);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed OR NOT EXISTS (
    SELECT 1 FROM public.zane_social_workout_comments
    WHERE id = 'ba000000-0000-4000-8000-000000000010'::uuid
  ) THEN
    RAISE EXCEPTION 'restore omission did not protect attached Friends comments';
  END IF;
  DELETE FROM app_private.zane_backup_restore_jobs
  WHERE owner_id = v_owner AND operation_id = v_social_omit;

  UPDATE pg_temp.atomic_backup_restore_fixture_chunks
  SET chunk = v_original_session_chunk,
      chunk_hash = app_private.backup_restore_hash(v_original_session_chunk),
      byte_count = pg_catalog.octet_length(pg_catalog.convert_to(
        app_private.backup_restore_canonical_json(v_original_session_chunk), 'UTF8'
      ))
  WHERE section = 'sessions';

  -- A Preview-owned statement trigger gives a deterministic failure after the
  -- payload has been fully materialized and the live replacement reaches the
  -- required settings row. The caught RPC error must roll back earlier DML.
  v_manifest := pg_temp.atomic_backup_restore_manifest(v_late_fail);
  PERFORM public.begin_backup_restore(v_late_fail, v_manifest);
  FOR v_chunk IN
    SELECT * FROM pg_temp.atomic_backup_restore_fixture_chunks ORDER BY chunk_index
  LOOP
    PERFORM public.stage_backup_restore_chunk(
      v_late_fail, v_chunk.chunk_index, v_chunk.chunk, v_chunk.chunk_hash
    );
  END LOOP;
  CREATE TRIGGER atomic_backup_restore_late_failure
    BEFORE INSERT OR UPDATE OR DELETE ON public.zane_user_settings
    FOR EACH STATEMENT EXECUTE FUNCTION pg_temp.atomic_backup_restore_fail_late();
  v_failed := false;
  BEGIN
    PERFORM public.commit_backup_restore(v_late_fail);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  DROP TRIGGER atomic_backup_restore_late_failure ON public.zane_user_settings;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'synthetic late restore failure did not abort commit';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.zane_exercises
    WHERE user_id = v_owner AND id = 'atomic-owner-live'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.zane_user_settings
    WHERE user_id = v_owner AND unit = 'lbs' AND push_enabled
  ) THEN
    RAISE EXCEPTION 'failed commit did not roll back the live account exactly';
  END IF;
  DELETE FROM app_private.zane_backup_restore_jobs
  WHERE owner_id = v_owner AND operation_id = v_late_fail;

  -- Statement-level tripwires prove the successful commit issues no DML at all
  -- against social, coaching, Drive, push, shared-link, pillbox or ledger state.
  FOREACH v_preserved_table IN ARRAY ARRAY[
    'zane_social_profiles',
    'zane_social_workout_comments',
    'zane_coaching',
    'zane_coaching_drive_connections',
    'zane_push_subscriptions',
    'zane_pushover_active',
    'zane_recipe_shares',
    'zane_medication_pillbox_checks',
    'zane_reminder_delivery_claims'
  ]::text[] LOOP
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER atomic_backup_restore_preserve_guard '
      'BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION pg_temp.atomic_backup_restore_reject_preserved_mutation()',
      v_preserved_table
    );
  END LOOP;

  v_manifest := pg_temp.atomic_backup_restore_manifest(v_success);
  -- Browser JSON and Postgres jsonb can encode the same numeric value with a
  -- different byte length. Declared bytes are advisory; server-measured bytes
  -- enforce the actual operation and owner quotas.
  v_manifest := pg_catalog.jsonb_set(
    v_manifest,
    '{totals,byte_count}',
    pg_catalog.to_jsonb((v_manifest->'totals'->>'byte_count')::bigint + 1)
  );
  PERFORM public.begin_backup_restore(v_success, v_manifest);
  FOR v_chunk IN
    SELECT * FROM pg_temp.atomic_backup_restore_fixture_chunks ORDER BY chunk_index
  LOOP
    PERFORM public.stage_backup_restore_chunk(
      v_success, v_chunk.chunk_index, v_chunk.chunk, v_chunk.chunk_hash
    );
  END LOOP;
  v_receipt := public.commit_backup_restore(v_success);
  v_replayed := public.commit_backup_restore(v_success);

  FOREACH v_preserved_table IN ARRAY ARRAY[
    'zane_social_profiles',
    'zane_social_workout_comments',
    'zane_coaching',
    'zane_coaching_drive_connections',
    'zane_push_subscriptions',
    'zane_pushover_active',
    'zane_recipe_shares',
    'zane_medication_pillbox_checks',
    'zane_reminder_delivery_claims'
  ]::text[] LOOP
    EXECUTE pg_catalog.format(
      'DROP TRIGGER atomic_backup_restore_preserve_guard ON public.%I',
      v_preserved_table
    );
  END LOOP;

  IF v_replayed IS DISTINCT FROM v_receipt
     OR v_receipt->>'operation_id' IS DISTINCT FROM v_success
     OR v_receipt->>'status' IS DISTINCT FROM 'committed'
     OR v_receipt->>'restore_digest' IS DISTINCT FROM pg_temp.atomic_backup_restore_expected_digest()
     OR (v_receipt->>'row_count')::integer <> 10
     OR pg_catalog.jsonb_typeof(v_receipt->'table_counts') <> 'object'
  THEN
    RAISE EXCEPTION 'commit receipt is invalid or not idempotently stable: % / %', v_receipt, v_replayed;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.zane_exercises
    WHERE user_id = v_owner AND id = 'atomic-owner-live'
  ) THEN
    RAISE EXCEPTION 'successful restore retained stale personal rows';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.zane_sets
    WHERE user_id = v_owner AND id = 'atomic-owner-corrupt-set'
  ) OR EXISTS (
    SELECT 1 FROM public.zane_session_entries
    WHERE user_id = v_owner AND id = 'atomic-owner-corrupt-entry'
  ) THEN
    RAISE EXCEPTION 'successful restore did not clean damaged live history';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.zane_adaptive_tdee_history
    WHERE user_id = v_owner
      AND id = 'tdee_' || v_owner::text || '_2026-08-22'
      AND as_of_date = '2026-08-22'::date
  ) OR NOT EXISTS (
    SELECT 1 FROM public.zane_meso_states
    WHERE user_id = v_owner
      AND id = v_owner::text || '_atomic-plan'
      AND schedule_id = 'atomic-plan'
  ) THEN
    RAISE EXCEPTION 'server-derived adaptive TDEE or mesocycle ID is wrong';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.zane_food_logs
    WHERE user_id = v_owner
      AND id = 'atomic-legacy-food-log'
      AND food_id IS NULL
      AND recipe_id IS NULL
      AND food_name = 'Legacy food snapshot'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.zane_food_favorites
    WHERE user_id = v_owner
      AND id = 'atomic-legacy-favorite'
      AND food_id IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.zane_food_template_slots
    WHERE user_id = v_owner
      AND id = 'atomic-legacy-food-slot'
      AND food_id IS NULL
      AND recipe_id IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.zane_food_shopping_prefs
    WHERE user_id = v_owner
      AND id = 'atomic-legacy-shopping-pref'
      AND food_id IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy food snapshots did not survive stale reference normalization';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.zane_exercises
    WHERE user_id = v_other AND id = 'atomic-other-live'
  ) THEN
    RAISE EXCEPTION 'owner restore changed another user';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.zane_profiles
    WHERE id = v_owner
      AND name = 'Owner restored atomically'
      AND tier = 'lifetime'
  ) THEN
    RAISE EXCEPTION 'profile restore did not preserve the server-authored tier';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.zane_social_workout_comments
    WHERE id = 'ba000000-0000-4000-8000-000000000010'::uuid
      AND session_id = 'atomic-owner-session'
  ) THEN
    RAISE EXCEPTION 'restore removed social state attached to retained training history';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.zane_user_settings
    WHERE user_id = v_owner
      AND unit = 'kg'
      AND push_enabled
      AND pushover_user_key = 'preserve-pushover-key'
      AND use_pushover
      AND show_coaching_tab
      AND show_friends_tab
      AND social_push_messages
      AND social_push_friend_requests
      AND social_push_finished_comments
      AND social_push_friend_started
  ) THEN
    RAISE EXCEPTION 'restore overwrote preserved push/social/coaching preferences';
  END IF;
END;
$behavior$;

ROLLBACK;
