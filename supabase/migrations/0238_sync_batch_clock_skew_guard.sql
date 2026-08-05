-- Fixes a clock-skew hole in the three sync_*_batch RPCs' last-write-wins
-- guard (sync_sets_batch, sync_daily_logs_batch, sync_meso_states_batch,
-- unchanged since their original migrations, 0044/0096/0160ish): each one
-- compares `existing.updated_at < EXCLUDED.updated_at`, where
-- EXCLUDED.updated_at is the CLIENT's own wall-clock timestamp (store.js's
-- `new Date().toISOString()`), never validated against the server. A device
-- with a fast/skewed-forward system clock therefore has every one of its
-- writes permanently "win" any future conflict against a device with a
-- correct clock, silently dropping the correct device's genuinely newer
-- edits, with no error anywhere.
--
-- Fix: clamp the incoming timestamp to LEAST(client_value, now()) before it
-- is either stored or used as the WHERE comparison basis. A client_value at
-- or before the real time passes through completely unchanged, this is what
-- keeps an offline-queued write (synced later, possibly hours after it was
-- actually made) stamped with its ORIGINAL edit time, so it still correctly
-- loses to a genuinely newer edit made on another device in the meantime.
-- That is intentional, load-bearing behavior for this app's offline-first
-- design, not something this migration should break. Only a client_value
-- AFTER the real time gets capped down to the server's own now(), which is
-- exactly the future-dated-clock case this migration closes.
--
-- CREATE OR REPLACE preserves the existing REVOKE/GRANT on all three
-- functions (identical signatures), no grants need to be reapplied.

CREATE OR REPLACE FUNCTION public.sync_sets_batch(p_sets jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  INSERT INTO zane_sets (
    id, session_id, entry_id, user_id,
    set_idx, kg, reps, reps_l, reps_r, time_sec,
    done, skipped, warmup, technique, drops, updated_at
  )
  SELECT
    s->>'id',
    s->>'session_id',
    s->>'entry_id',
    auth.uid(),
    (s->>'set_idx')::int,
    (s->>'kg')::numeric,
    (s->>'reps')::int,
    (s->>'reps_l')::int,
    (s->>'reps_r')::int,
    (s->>'time_sec')::int,
    COALESCE((s->>'done')::boolean,    false),
    COALESCE((s->>'skipped')::boolean, false),
    COALESCE((s->>'warmup')::boolean,  false),
    NULLIF(s->>'technique', ''),
    CASE WHEN s->'drops' IS NOT NULL AND s->'drops' != 'null'::jsonb THEN s->'drops' ELSE NULL END,
    LEAST(COALESCE((s->>'updated_at')::timestamptz, now()), now())
  FROM jsonb_array_elements(p_sets) AS s
  ON CONFLICT (id) DO UPDATE SET
    kg         = EXCLUDED.kg,
    reps       = EXCLUDED.reps,
    reps_l     = EXCLUDED.reps_l,
    reps_r     = EXCLUDED.reps_r,
    time_sec   = EXCLUDED.time_sec,
    done       = EXCLUDED.done,
    skipped    = EXCLUDED.skipped,
    warmup     = EXCLUDED.warmup,
    technique  = EXCLUDED.technique,
    drops      = EXCLUDED.drops,
    updated_at = EXCLUDED.updated_at
  WHERE zane_sets.updated_at < EXCLUDED.updated_at;
$function$;

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
    LEAST(COALESCE((l->>'updated_at')::timestamptz, now()), now())
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
    meal_of_choice_hour = EXCLUDED.meal_of_choice_hour,
    adherence          = EXCLUDED.adherence,
    targets_snap       = EXCLUDED.targets_snap,
    daily_coach_fields = EXCLUDED.daily_coach_fields,
    updated_at         = EXCLUDED.updated_at
  WHERE zane_daily_logs.updated_at < EXCLUDED.updated_at;
$function$;

CREATE OR REPLACE FUNCTION public.sync_meso_states_batch(p_states jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  INSERT INTO zane_meso_states (
    id, user_id, schedule_id, weeks, start_date, start_cycle_index, started_at,
    deltas, joint_flags, pump_low_counts, weight_boosts, weight_boost_declines,
    growth_counts, rep_miss_counts, affinity, autoreg_state, completions,
    pending_meso2, updated_at
  )
  SELECT
    m->>'id',
    auth.uid(),
    m->>'schedule_id',
    (m->>'weeks')::int,
    m->>'start_date',
    COALESCE((m->>'start_cycle_index')::int, 0),
    (m->>'started_at')::timestamptz,
    COALESCE(m->'deltas', '{}'::jsonb),
    COALESCE(m->'joint_flags', '{}'::jsonb),
    COALESCE(m->'pump_low_counts', '{}'::jsonb),
    COALESCE(m->'weight_boosts', '{}'::jsonb),
    COALESCE(m->'weight_boost_declines', '{}'::jsonb),
    COALESCE(m->'growth_counts', '{}'::jsonb),
    COALESCE(m->'rep_miss_counts', '{}'::jsonb),
    COALESCE(m->'affinity', '{}'::jsonb),
    NULLIF(m->'autoreg_state', 'null'::jsonb),
    COALESCE((m->>'completions')::int, 0),
    COALESCE((m->>'pending_meso2')::boolean, false),
    LEAST(COALESCE((m->>'updated_at')::timestamptz, now()), now())
  FROM jsonb_array_elements(p_states) AS m
  ON CONFLICT (id) DO UPDATE SET
    weeks                 = EXCLUDED.weeks,
    start_date            = EXCLUDED.start_date,
    start_cycle_index     = EXCLUDED.start_cycle_index,
    started_at            = COALESCE(EXCLUDED.started_at, zane_meso_states.started_at),
    deltas                = EXCLUDED.deltas,
    joint_flags           = EXCLUDED.joint_flags,
    pump_low_counts       = EXCLUDED.pump_low_counts,
    weight_boosts         = EXCLUDED.weight_boosts,
    weight_boost_declines = EXCLUDED.weight_boost_declines,
    growth_counts         = EXCLUDED.growth_counts,
    rep_miss_counts       = EXCLUDED.rep_miss_counts,
    affinity              = EXCLUDED.affinity,
    autoreg_state         = COALESCE(NULLIF(EXCLUDED.autoreg_state, 'null'::jsonb), zane_meso_states.autoreg_state),
    completions           = EXCLUDED.completions,
    pending_meso2         = EXCLUDED.pending_meso2,
    updated_at            = EXCLUDED.updated_at
  WHERE zane_meso_states.updated_at < EXCLUDED.updated_at;
$function$;

-- One-time defensive cleanup: clamp any row already sitting with an
-- updated_at more than a day in the future (from a skewed clock before this
-- fix landed) back to now(), so it can accept a genuine update again instead
-- of being permanently stuck until real time catches up to the bad
-- timestamp. A no-op if no such rows exist.
UPDATE zane_sets SET updated_at = now() WHERE updated_at > now() + interval '1 day';
UPDATE zane_daily_logs SET updated_at = now() WHERE updated_at > now() + interval '1 day';
UPDATE zane_meso_states SET updated_at = now() WHERE updated_at > now() + interval '1 day';
