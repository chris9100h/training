-- Multi-device safety for daily logs.
--
-- Two devices logging the same day each generate a fresh random id, which
-- collided on the UNIQUE(user_id, date) constraint (the plain upsert resolves
-- conflicts on the PK `id`, not on the date), breaking the second device's
-- sync. This adds an `updated_at` column and a batch upsert RPC that resolves
-- conflicts on (user_id, date) — keeping the existing row's id — and only
-- overwrites when the incoming edit is newer, so a stale offline edit can't
-- clobber a newer one. Mirrors sync_sets_batch (migration 0031).
--
-- Additive & backward-compatible: older clients keep using the plain upsert
-- (which still works for the single-device case) until they update.

ALTER TABLE zane_daily_logs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION sync_daily_logs_batch(p_logs jsonb)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  INSERT INTO zane_daily_logs (
    id, user_id, date, weight, steps, calories, protein, carbs, fat, fiber,
    water_ml, note, off_plan_note, adherence, targets_snap, daily_coach_fields, updated_at
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
    adherence          = EXCLUDED.adherence,
    targets_snap       = EXCLUDED.targets_snap,
    daily_coach_fields = EXCLUDED.daily_coach_fields,
    updated_at         = EXCLUDED.updated_at
  WHERE zane_daily_logs.updated_at < EXCLUDED.updated_at;
$$;
