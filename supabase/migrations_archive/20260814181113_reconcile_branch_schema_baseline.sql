-- Reconcile objects that were applied manually in production while their
-- migration versions were already marked as applied. A Supabase branch starts
-- from the recorded migration state, so those manual side effects otherwise
-- disappear from a fresh branch. Every statement below is safe to re-run.

BEGIN;

-- ---------------------------------------------------------------------------
-- Columns and constraints which were missing from the branch baseline.
-- ---------------------------------------------------------------------------

ALTER TABLE public.zane_coaching
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.zane_exercises
  ADD COLUMN IF NOT EXISTS horn_labels jsonb;

ALTER TABLE public.zane_schedules
  ADD COLUMN IF NOT EXISTS program_type text,
  ADD COLUMN IF NOT EXISTS program_data jsonb;

ALTER TABLE public.zane_session_entries
  ADD COLUMN IF NOT EXISTS planned_techniques text[];

ALTER TABLE public.zane_user_settings
  ADD COLUMN IF NOT EXISTS cleanup_percent integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS daily_log_reminder_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_log_reminder_last_date text,
  ADD COLUMN IF NOT EXISTS daily_log_reminder_time text NOT NULL DEFAULT '19:00',
  ADD COLUMN IF NOT EXISTS fasting_protocol text,
  ADD COLUMN IF NOT EXISTS hide_food_categories boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_calories boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS net_carbs boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS pin_all_notes boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_food_tab boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_regression boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_water_tab boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS weight_fill_down boolean NOT NULL DEFAULT true;

ALTER TABLE public.zane_user_settings
  DROP CONSTRAINT IF EXISTS zane_user_settings_status_mode_check;
ALTER TABLE public.zane_user_settings
  ADD CONSTRAINT zane_user_settings_status_mode_check
  CHECK (status_mode IN ('sick', 'vacation', 'deload', 'cleanup'));

ALTER TABLE public.zane_status_periods
  DROP CONSTRAINT IF EXISTS zane_status_periods_mode_check;
ALTER TABLE public.zane_status_periods
  ADD CONSTRAINT zane_status_periods_mode_check
  CHECK (mode IN ('sick', 'vacation', 'deload', 'cleanup'));

CREATE INDEX IF NOT EXISTS zane_sets_user_entry_idx
  ON public.zane_sets(user_id, entry_id);

-- These obsolete approval RPCs were removed from the canonical schema.
DROP FUNCTION IF EXISTS public.approve_user(uuid);
DROP FUNCTION IF EXISTS public.decline_user(uuid);
DROP FUNCTION IF EXISTS public.get_pending_users();

-- ---------------------------------------------------------------------------
-- RPCs whose bodies/return shapes were lost with the manual migration apply.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.zane_entries_json(p_session_id text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'exId', e.ex_id,
      'name', e.name,
      'plannedSets', e.planned_sets,
      'plannedReps', e.planned_reps,
      'plannedRepsPerSet', e.planned_reps_per_set,
      'plannedRepsMax', e.planned_reps_max,
      'plannedProgressionOffset', e.planned_progression_offset,
      'plannedTechniques', e.planned_techniques,
      'note', e.note,
      'supersetGroup', e.superset_group,
      'category', ex.category,
      'equipment', ex.equipment,
      'movementType', ex.movement_type,
      'sets', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'kg', st.kg, 'reps', st.reps, 'repsL', st.reps_l, 'repsR', st.reps_r,
            'timeSec', st.time_sec,
            'done', st.done, 'skipped', st.skipped, 'warmup', st.warmup,
            'technique', st.technique, 'drops', st.drops
          ) ORDER BY st.set_idx)
        FROM zane_sets st WHERE st.entry_id = e.id
      ), '[]'::jsonb)
    ) ORDER BY e.entry_idx
  ), '[]'::jsonb)
  FROM zane_session_entries e
  LEFT JOIN zane_exercises ex ON ex.id = e.ex_id
  WHERE e.session_id = p_session_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.zane_entries_json(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_sets_batch(p_sets jsonb)
RETURNS void
LANGUAGE sql
SET search_path TO 'public'
AS $function$
  INSERT INTO zane_sets (
    id, session_id, entry_id, user_id,
    set_idx, kg, reps, reps_l, reps_r, time_sec, added_kg,
    done, skipped, warmup, technique, drops, horn_loads, updated_at
  )
  SELECT
    s->>'id', s->>'session_id', s->>'entry_id', auth.uid(),
    (s->>'set_idx')::int, (s->>'kg')::numeric, (s->>'reps')::int,
    (s->>'reps_l')::int, (s->>'reps_r')::int, (s->>'time_sec')::int,
    (s->>'added_kg')::numeric,
    COALESCE((s->>'done')::boolean, false),
    COALESCE((s->>'skipped')::boolean, false),
    COALESCE((s->>'warmup')::boolean, false),
    NULLIF(s->>'technique', ''),
    CASE WHEN s->'drops' IS NOT NULL AND s->'drops' != 'null'::jsonb THEN s->'drops' ELSE NULL END,
    CASE WHEN s->'horn_loads' IS NOT NULL AND s->'horn_loads' != 'null'::jsonb THEN s->'horn_loads' ELSE NULL END,
    LEAST(COALESCE((s->>'updated_at')::timestamptz, now()), now())
  FROM jsonb_array_elements(p_sets) AS s
  ON CONFLICT (id) DO UPDATE SET
    kg = EXCLUDED.kg,
    reps = EXCLUDED.reps,
    reps_l = EXCLUDED.reps_l,
    reps_r = EXCLUDED.reps_r,
    time_sec = EXCLUDED.time_sec,
    added_kg = EXCLUDED.added_kg,
    done = EXCLUDED.done,
    skipped = EXCLUDED.skipped,
    warmup = EXCLUDED.warmup,
    technique = EXCLUDED.technique,
    drops = EXCLUDED.drops,
    horn_loads = EXCLUDED.horn_loads,
    updated_at = EXCLUDED.updated_at
  WHERE zane_sets.updated_at < EXCLUDED.updated_at;
$function$;

REVOKE EXECUTE ON FUNCTION public.sync_sets_batch(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_sets_batch(jsonb) TO authenticated;

DROP FUNCTION IF EXISTS public.get_active_session_detail(uuid, text);
CREATE FUNCTION public.get_active_session_detail(p_user_id uuid, p_session_id text DEFAULT NULL::text)
RETURNS TABLE(
  user_name text, day_name text, started_at timestamptz, ended timestamptz,
  entries jsonb, avg_duration_seconds double precision,
  avg_sets_total double precision, last_session_entries jsonb,
  last_session_duration_seconds double precision, unit text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz'
     AND NOT EXISTS (
       SELECT 1 FROM zane_feature_grants
       WHERE feature = 'active_users' AND email = auth.email()
     )
     AND NOT zane_is_coach_of(p_user_id)
  THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.name::text,
    s.day_name::text,
    s.started_at,
    s.ended,
    zane_entries_json(s.id),
    (SELECT AVG(CASE WHEN s2.duration_minutes IS NOT NULL
                     THEN s2.duration_minutes * 60.0
                     ELSE EXTRACT(EPOCH FROM (s2.ended - s2.started_at)) END)
       FROM zane_sessions s2
      WHERE s2.user_id = p_user_id AND s2.day_id = s.day_id
        AND s2.ended IS NOT NULL AND s2.id != s.id
        AND (s2.duration_minutes IS NOT NULL
             OR (s2.started_at IS NOT NULL AND s2.ended > s2.started_at)))::float,
    (SELECT AVG(sub.cnt)::float FROM (
       SELECT (SELECT COUNT(*) FROM zane_sets st
                WHERE st.session_id = s2.id AND st.done) AS cnt
         FROM zane_sessions s2
        WHERE s2.user_id = p_user_id AND s2.day_id = s.day_id
          AND s2.ended IS NOT NULL AND s2.id != s.id
          AND (s2.duration_minutes IS NOT NULL
               OR (s2.started_at IS NOT NULL AND s2.ended > s2.started_at))
    ) sub),
    zane_entries_json((SELECT s2.id FROM zane_sessions s2
        WHERE s2.user_id = p_user_id AND s2.day_id = s.day_id
          AND s2.ended IS NOT NULL AND s2.id != s.id
          AND (s2.duration_minutes IS NOT NULL
               OR (s2.started_at IS NOT NULL AND s2.ended > s2.started_at))
        ORDER BY s2.ended DESC LIMIT 1)),
    (SELECT COALESCE(s2.duration_minutes * 60.0,
                     EXTRACT(EPOCH FROM (s2.ended - s2.started_at)))
       FROM zane_sessions s2
      WHERE s2.user_id = p_user_id AND s2.day_id = s.day_id
        AND s2.ended IS NOT NULL AND s2.id != s.id
        AND (s2.duration_minutes IS NOT NULL
             OR (s2.started_at IS NOT NULL AND s2.ended > s2.started_at))
      ORDER BY s2.ended DESC LIMIT 1)::float,
    COALESCE((SELECT us.unit FROM zane_user_settings us WHERE us.user_id = p_user_id), 'kg')::text
  FROM zane_sessions s
  LEFT JOIN zane_profiles p ON p.id = s.user_id
  WHERE s.user_id = p_user_id
    AND ((p_session_id IS NOT NULL AND s.id = p_session_id)
      OR (p_session_id IS NULL AND s.ended IS NULL AND s.id = (
        SELECT us.in_progress_session_id FROM zane_user_settings us WHERE us.user_id = p_user_id
      )));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_active_session_detail(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_session_detail(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_exercise_history(
  p_ex_id text, p_day_id text DEFAULT NULL, p_limit int DEFAULT 12, p_user_id uuid DEFAULT NULL
)
RETURNS TABLE(session_id text, day_id text, date timestamptz, ended timestamptz, sets jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
  WITH uid AS (SELECT COALESCE(p_user_id, auth.uid()) AS id)
  SELECT s.id, s.day_id, s.date, s.ended,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'kg', st.kg, 'reps', st.reps, 'repsL', st.reps_l, 'repsR', st.reps_r,
      'timeSec', st.time_sec, 'addedKg', st.added_kg, 'hornLoads', st.horn_loads,
      'done', st.done, 'skipped', st.skipped, 'warmup', st.warmup,
      'technique', st.technique, 'drops', st.drops
    ) ORDER BY st.set_idx) FROM zane_sets st WHERE st.entry_id = e.id), '[]'::jsonb)
  FROM zane_sessions s
  JOIN zane_session_entries e ON e.session_id = s.id
  WHERE e.user_id = (SELECT id FROM uid)
    AND e.ex_id = p_ex_id
    AND s.ended IS NOT NULL
    AND (p_day_id IS NULL OR s.day_id = p_day_id)
  ORDER BY s.ended DESC
  LIMIT GREATEST(p_limit, 1);
$function$;

REVOKE EXECUTE ON FUNCTION public.get_exercise_history(text, text, int, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exercise_history(text, text, int, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_user_volume_stats(p_user_id uuid DEFAULT NULL)
RETURNS TABLE(session_count bigint, total_volume double precision, total_minutes bigint, total_done_sets bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
  WITH uid AS (SELECT COALESCE(p_user_id, auth.uid()) AS id),
  ended AS (
    SELECT s.id, s.user_id, s.date, s.duration_minutes, s.started_at, s.ended
      FROM zane_sessions s
     WHERE s.user_id = (SELECT id FROM uid) AND s.ended IS NOT NULL
  )
  SELECT
    (SELECT COUNT(*) FROM ended)::bigint,
    COALESCE((SELECT SUM(
      CASE WHEN ex.movement_type = 'assisted'
           THEN GREATEST(0, COALESCE((SELECT dl.weight FROM zane_daily_logs dl
                  WHERE dl.user_id = en.user_id AND dl.weight IS NOT NULL
                  ORDER BY abs(dl.date::date - en.date::date) LIMIT 1), 0) + st.kg)
           ELSE st.kg END
      * (CASE WHEN st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL
              THEN LEAST(COALESCE(st.reps_l, st.reps_r), COALESCE(st.reps_r, st.reps_l))
              ELSE st.reps END))
      FROM zane_sets st
      JOIN ended en ON en.id = st.session_id
      LEFT JOIN zane_session_entries e ON e.id = st.entry_id
      LEFT JOIN zane_exercises ex ON ex.id = e.ex_id
     WHERE NOT st.warmup AND NOT st.skipped AND st.kg IS NOT NULL
       AND COALESCE(CASE WHEN st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL
                         THEN LEAST(COALESCE(st.reps_l, st.reps_r), COALESCE(st.reps_r, st.reps_l))
                         ELSE st.reps END, 0) > 0), 0)::float,
    COALESCE((SELECT SUM(COALESCE(en.duration_minutes,
      CASE WHEN en.started_at IS NOT NULL AND en.ended > en.started_at
           THEN EXTRACT(EPOCH FROM (en.ended - en.started_at))/60 ELSE 0 END))::bigint FROM ended en), 0)::bigint,
    COALESCE((SELECT COUNT(*) FROM zane_sets st JOIN ended en ON en.id = st.session_id
               WHERE st.done AND NOT st.warmup AND NOT st.skipped), 0)::bigint;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_user_volume_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_volume_stats(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_meso_states_batch(p_states jsonb)
RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path TO 'public'
AS $function$
  INSERT INTO zane_meso_states (
    id, user_id, schedule_id, weeks, start_date, start_cycle_index, started_at,
    deltas, joint_flags, pump_low_counts, weight_boosts, weight_boost_declines,
    growth_counts, rep_miss_counts, affinity, autoreg_state, completions,
    pending_meso2, updated_at
  )
  SELECT m->>'id', auth.uid(), m->>'schedule_id', (m->>'weeks')::int,
    m->>'start_date', COALESCE((m->>'start_cycle_index')::int, 0),
    (m->>'started_at')::timestamptz,
    COALESCE(m->'deltas', '{}'::jsonb), COALESCE(m->'joint_flags', '{}'::jsonb),
    COALESCE(m->'pump_low_counts', '{}'::jsonb), COALESCE(m->'weight_boosts', '{}'::jsonb),
    COALESCE(m->'weight_boost_declines', '{}'::jsonb), COALESCE(m->'growth_counts', '{}'::jsonb),
    COALESCE(m->'rep_miss_counts', '{}'::jsonb), COALESCE(m->'affinity', '{}'::jsonb),
    NULLIF(m->'autoreg_state', 'null'::jsonb), COALESCE((m->>'completions')::int, 0),
    COALESCE((m->>'pending_meso2')::boolean, false),
    LEAST(COALESCE((m->>'updated_at')::timestamptz, now()), now())
  FROM jsonb_array_elements(p_states) AS m
  ON CONFLICT (id) DO UPDATE SET
    weeks = EXCLUDED.weeks, start_date = EXCLUDED.start_date,
    start_cycle_index = EXCLUDED.start_cycle_index,
    started_at = COALESCE(EXCLUDED.started_at, zane_meso_states.started_at),
    deltas = EXCLUDED.deltas, joint_flags = EXCLUDED.joint_flags,
    pump_low_counts = EXCLUDED.pump_low_counts, weight_boosts = EXCLUDED.weight_boosts,
    weight_boost_declines = EXCLUDED.weight_boost_declines, growth_counts = EXCLUDED.growth_counts,
    rep_miss_counts = EXCLUDED.rep_miss_counts, affinity = EXCLUDED.affinity,
    autoreg_state = COALESCE(NULLIF(EXCLUDED.autoreg_state, 'null'::jsonb), zane_meso_states.autoreg_state),
    completions = EXCLUDED.completions, pending_meso2 = EXCLUDED.pending_meso2,
    updated_at = EXCLUDED.updated_at
  WHERE zane_meso_states.updated_at < EXCLUDED.updated_at;
$function$;

REVOKE EXECUTE ON FUNCTION public.sync_meso_states_batch(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_meso_states_batch(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_recipe_share(p_recipe_id text, p_recipe jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_token text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_recipe_id IS NULL OR btrim(p_recipe_id) = '' THEN RAISE EXCEPTION 'Missing recipe id'; END IF;
  IF p_recipe IS NULL OR jsonb_typeof(p_recipe) <> 'object'
     OR jsonb_typeof(p_recipe->'items') <> 'array'
     OR COALESCE(btrim(p_recipe->>'name'), '') = '' THEN RAISE EXCEPTION 'Invalid recipe'; END IF;
  IF length(p_recipe::text) > 20000 THEN RAISE EXCEPTION 'Recipe too large'; END IF;
  INSERT INTO public.zane_recipe_shares(token, user_id, recipe_id, recipe)
  VALUES (replace(gen_random_uuid()::text, '-', ''), v_uid, p_recipe_id, p_recipe)
  ON CONFLICT (user_id, recipe_id)
  DO UPDATE SET recipe = EXCLUDED.recipe, created_at = now()
  RETURNING token INTO v_token;
  RETURN v_token;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.create_recipe_share(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_recipe_share(text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_recipe_share(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'recipe', s.recipe,
    'sharedBy', COALESCE(p.name, 'A Zane user'),
    'createdAt', s.created_at
  )
  FROM public.zane_recipe_shares s
  LEFT JOIN public.zane_profiles p ON p.id = s.user_id
  WHERE s.token = p_token;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_recipe_share(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recipe_share(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_support_ticket(p_coaching_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'office@btc-prime.biz' LIMIT 1;
  IF auth.uid() <> v_admin_id THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  UPDATE zane_coaching SET archived = true, archived_at = now()
   WHERE id = p_coaching_id AND id LIKE 'support_%';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.archive_support_ticket(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_support_ticket(text) TO authenticated;

DROP FUNCTION IF EXISTS public.get_user_support_chats();
CREATE FUNCTION public.get_user_support_chats()
RETURNS TABLE(
  coaching_id text, support_status text, support_category text, created_at timestamptz,
  last_message_at timestamptz, last_message_body text, unread_count bigint,
  archived boolean, archived_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT c.id, c.support_status, c.support_category, c.created_at,
    (SELECT MAX(n.created_at) FROM zane_coaching_notes n WHERE n.coaching_id = c.id),
    (SELECT n.body FROM zane_coaching_notes n WHERE n.coaching_id = c.id ORDER BY n.created_at DESC LIMIT 1),
    (SELECT COUNT(*) FROM zane_coaching_notes n
      WHERE n.coaching_id = c.id AND n.author_id <> auth.uid() AND n.read_at IS NULL),
    COALESCE(c.archived, false), c.archived_at
  FROM zane_coaching c
  WHERE c.client_id = auth.uid() AND c.id LIKE 'support_%'
  ORDER BY COALESCE(
    (SELECT MAX(n.created_at) FROM zane_coaching_notes n WHERE n.coaching_id = c.id),
    c.created_at
  ) DESC;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_user_support_chats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_support_chats() TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_support_ticket(p_coaching_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'office@btc-prime.biz' LIMIT 1;
  IF auth.uid() <> v_admin_id THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_coaching_id NOT LIKE 'support_%' THEN RAISE EXCEPTION 'Not a support ticket'; END IF;
  DELETE FROM zane_coaching_notes WHERE coaching_id = p_coaching_id;
  DELETE FROM zane_coaching_threads WHERE coaching_id = p_coaching_id;
  DELETE FROM zane_coaching WHERE id = p_coaching_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.delete_support_ticket(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_support_ticket(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Admin/ops RPCs that were present in production but absent from the branch.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_active_users_access()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.email() = 'office@btc-prime.biz' THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM zane_feature_grants
                 WHERE feature = 'active_users' AND email = auth.email());
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.check_active_users_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_active_users_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_active_users_grants()
RETURNS TABLE(email text) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN RETURN; END IF;
  RETURN QUERY SELECT fg.email FROM zane_feature_grants fg
   WHERE fg.feature = 'active_users' ORDER BY fg.email;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_active_users_grants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_users_grants() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_active_users_grant(p_email text, p_granted boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_granted THEN
    INSERT INTO zane_feature_grants (feature, email)
    VALUES ('active_users', lower(trim(p_email))) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM zane_feature_grants
     WHERE feature = 'active_users' AND email = lower(trim(p_email));
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.set_active_users_grant(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_active_users_grant(text, boolean) TO authenticated;

DROP FUNCTION IF EXISTS public.get_recent_signups(integer);
CREATE FUNCTION public.get_recent_signups(p_limit int DEFAULT 50)
RETURNS TABLE(user_id uuid, name text, email text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN RETURN; END IF;
  RETURN QUERY
    SELECT p.id, p.name, u.email::text, u.created_at
      FROM zane_profiles p JOIN auth.users u ON u.id = p.id
     ORDER BY u.created_at DESC LIMIT GREATEST(p_limit, 1);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_recent_signups(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recent_signups(integer) TO authenticated;

DROP FUNCTION IF EXISTS public.get_users_with_plans();
CREATE FUNCTION public.get_users_with_plans()
RETURNS TABLE(user_id uuid, name text, email text, joined_at timestamptz, plan_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN RETURN; END IF;
  RETURN QUERY
    SELECT p.id, p.name, u.email::text, u.created_at, COUNT(s.id)::int
      FROM zane_profiles p JOIN auth.users u ON u.id = p.id
      JOIN zane_schedules s ON s.user_id = p.id
     GROUP BY p.id, p.name, u.email, u.created_at
     ORDER BY u.created_at DESC;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_users_with_plans() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_users_with_plans() TO authenticated;

CREATE OR REPLACE FUNCTION public.update_daily_log_derived(
  p_date text, p_adherence numeric DEFAULT NULL, p_targets_snap jsonb DEFAULT NULL
)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path TO 'public'
AS $function$
  UPDATE zane_daily_logs
     SET adherence = p_adherence, targets_snap = p_targets_snap
   WHERE user_id = auth.uid() AND date = p_date;
$function$;
REVOKE EXECUTE ON FUNCTION public.update_daily_log_derived(text, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_daily_log_derived(text, numeric, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_schema_inventory()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'columns', (
      SELECT jsonb_agg(jsonb_build_object('t', table_name, 'c', column_name)
                       ORDER BY table_name, ordinal_position)
        FROM information_schema.columns WHERE table_schema = 'public'
    ),
    'functions', (
      SELECT jsonb_agg(jsonb_build_object(
               'f', p.proname,
               'sig', p.oid::regprocedure::text,
               'anon_exec', has_function_privilege('anon', p.oid, 'execute'),
               'authenticated_exec', has_function_privilege('authenticated', p.oid, 'execute'),
               'definer', p.prosecdef)
               ORDER BY p.proname)
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
    ),
    'realtime', (
      SELECT COALESCE(jsonb_agg(tablename ORDER BY tablename), '[]'::jsonb)
        FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
    )
  );
$function$;
REVOKE EXECUTE ON FUNCTION public.admin_schema_inventory() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_schema_inventory() TO service_role;

-- ---------------------------------------------------------------------------
-- Server-side completion/tier protections and medication ownership guards.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.zane_sessions_stamp_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
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
REVOKE EXECUTE ON FUNCTION public.zane_sessions_stamp_completion() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zane_sessions_stamp_completion ON public.zane_sessions;
CREATE TRIGGER zane_sessions_stamp_completion
  BEFORE INSERT OR UPDATE ON public.zane_sessions
  FOR EACH ROW EXECUTE FUNCTION public.zane_sessions_stamp_completion();

CREATE OR REPLACE FUNCTION public.grant_lifetime_if_qualified()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tier text; v_workouts int; v_minutes int; v_days int; v_taken int; v_total int;
BEGIN
  IF NEW.ended IS NULL THEN RETURN NEW; END IF;
  SELECT tier INTO v_tier FROM zane_profiles WHERE id = NEW.user_id;
  IF v_tier IS NULL OR v_tier <> 'free' THEN RETURN NEW; END IF;
  SELECT COUNT(*) FILTER (WHERE ended IS NOT NULL),
         COALESCE(SUM(LEAST(COALESCE(duration_minutes, 0), 120)) FILTER (WHERE ended IS NOT NULL), 0),
         COUNT(DISTINCT date(completed_server_at)) FILTER (WHERE completed_server_at IS NOT NULL)
    INTO v_workouts, v_minutes, v_days
    FROM zane_sessions WHERE user_id = NEW.user_id;
  IF v_workouts < 5 OR v_minutes < 150 OR v_days < 3 THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('zane_lifetime_seats'));
  SELECT COUNT(*) INTO v_taken FROM zane_profiles WHERE tier = 'lifetime';
  SELECT lifetime_seats_total INTO v_total FROM zane_app_config WHERE id = 1;
  IF v_taken >= COALESCE(v_total, 75) THEN RETURN NEW; END IF;
  UPDATE zane_profiles SET tier = 'lifetime', tier_granted_at = now()
   WHERE id = NEW.user_id AND tier = 'free';
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.grant_lifetime_if_qualified() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zane_sessions_grant_lifetime ON public.zane_sessions;
CREATE TRIGGER zane_sessions_grant_lifetime
  AFTER INSERT OR UPDATE OF ended ON public.zane_sessions
  FOR EACH ROW EXECUTE FUNCTION public.grant_lifetime_if_qualified();

CREATE OR REPLACE FUNCTION public.zane_profiles_protect_tier()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN RETURN NEW; END IF;
  IF NEW.tier IS DISTINCT FROM OLD.tier
     OR NEW.tier_granted_at IS DISTINCT FROM OLD.tier_granted_at THEN
    NEW.tier := OLD.tier;
    NEW.tier_granted_at := OLD.tier_granted_at;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.zane_profiles_protect_tier() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zane_profiles_protect_tier ON public.zane_profiles;
CREATE TRIGGER zane_profiles_protect_tier
  BEFORE UPDATE ON public.zane_profiles
  FOR EACH ROW EXECUTE FUNCTION public.zane_profiles_protect_tier();

DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_medication_plans;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_medication_plans
  FOR EACH ROW EXECUTE FUNCTION public.zane_guard_user_id_immutable();
DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_medications;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_medications
  FOR EACH ROW EXECUTE FUNCTION public.zane_guard_user_id_immutable();
DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_medication_schedule_slots;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_medication_schedule_slots
  FOR EACH ROW EXECUTE FUNCTION public.zane_guard_user_id_immutable();
DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_medication_logs;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_medication_logs
  FOR EACH ROW EXECUTE FUNCTION public.zane_guard_user_id_immutable();
DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_medication_plan_items;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_medication_plan_items
  FOR EACH ROW EXECUTE FUNCTION public.zane_guard_user_id_immutable();

-- Coach write access was missing for these five medication tables on the
-- branch, although the read policies were present and the client UI relies on
-- the complete coach-managed CRUD contract.
DROP POLICY IF EXISTS "coach can write client medication plans" ON public.zane_medication_plans;
CREATE POLICY "coach can write client medication plans" ON public.zane_medication_plans
  FOR INSERT TO public WITH CHECK (zane_is_coach_of(user_id));
DROP POLICY IF EXISTS "coach can update client medication plans" ON public.zane_medication_plans;
CREATE POLICY "coach can update client medication plans" ON public.zane_medication_plans
  FOR UPDATE TO public USING (zane_is_coach_of(user_id));
DROP POLICY IF EXISTS "coach can delete client medication plans" ON public.zane_medication_plans;
CREATE POLICY "coach can delete client medication plans" ON public.zane_medication_plans
  FOR DELETE TO public USING (zane_is_coach_of(user_id));

DROP POLICY IF EXISTS "coach can write client medications" ON public.zane_medications;
CREATE POLICY "coach can write client medications" ON public.zane_medications
  FOR INSERT TO public WITH CHECK (zane_is_coach_of(user_id));
DROP POLICY IF EXISTS "coach can update client medications" ON public.zane_medications;
CREATE POLICY "coach can update client medications" ON public.zane_medications
  FOR UPDATE TO public USING (zane_is_coach_of(user_id));
DROP POLICY IF EXISTS "coach can delete client medications" ON public.zane_medications;
CREATE POLICY "coach can delete client medications" ON public.zane_medications
  FOR DELETE TO public USING (zane_is_coach_of(user_id));

DROP POLICY IF EXISTS "coach can write client medication plan items" ON public.zane_medication_plan_items;
CREATE POLICY "coach can write client medication plan items" ON public.zane_medication_plan_items
  FOR INSERT TO public WITH CHECK (zane_is_coach_of(user_id));
DROP POLICY IF EXISTS "coach can update client medication plan items" ON public.zane_medication_plan_items;
CREATE POLICY "coach can update client medication plan items" ON public.zane_medication_plan_items
  FOR UPDATE TO public USING (zane_is_coach_of(user_id));
DROP POLICY IF EXISTS "coach can delete client medication plan items" ON public.zane_medication_plan_items;
CREATE POLICY "coach can delete client medication plan items" ON public.zane_medication_plan_items
  FOR DELETE TO public USING (zane_is_coach_of(user_id));

DROP POLICY IF EXISTS "coach can write client medication schedule slots" ON public.zane_medication_schedule_slots;
CREATE POLICY "coach can write client medication schedule slots" ON public.zane_medication_schedule_slots
  FOR INSERT TO public WITH CHECK (zane_is_coach_of(user_id));
DROP POLICY IF EXISTS "coach can update client medication schedule slots" ON public.zane_medication_schedule_slots;
CREATE POLICY "coach can update client medication schedule slots" ON public.zane_medication_schedule_slots
  FOR UPDATE TO public USING (zane_is_coach_of(user_id));
DROP POLICY IF EXISTS "coach can delete client medication schedule slots" ON public.zane_medication_schedule_slots;
CREATE POLICY "coach can delete client medication schedule slots" ON public.zane_medication_schedule_slots
  FOR DELETE TO public USING (zane_is_coach_of(user_id));

DROP POLICY IF EXISTS "coach can write client medication logs" ON public.zane_medication_logs;
CREATE POLICY "coach can write client medication logs" ON public.zane_medication_logs
  FOR INSERT TO public WITH CHECK (zane_is_coach_of(user_id));
DROP POLICY IF EXISTS "coach can update client medication logs" ON public.zane_medication_logs;
CREATE POLICY "coach can update client medication logs" ON public.zane_medication_logs
  FOR UPDATE TO public USING (zane_is_coach_of(user_id));
DROP POLICY IF EXISTS "coach can delete client medication logs" ON public.zane_medication_logs;
CREATE POLICY "coach can delete client medication logs" ON public.zane_medication_logs
  FOR DELETE TO public USING (zane_is_coach_of(user_id));

COMMIT;
