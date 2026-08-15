-- Collapse each user's past-day water_logs entries into a single per-day
-- summary row once their local midnight has passed. Per-entry granularity
-- (exact time of each drink) is only ever surfaced for "today" in the UI
-- (WaterScreen's entries list, the Health tab's hourly chart); a past day can
-- never be revisited at that granularity anywhere, so keeping N raw rows per
-- user per day forever just wastes storage. The day's total is already
-- separately mirrored into zane_daily_logs.water_ml regardless, this just
-- keeps zane_water_logs itself from growing unbounded.
--
-- The Stats screen's "Other drinks this period" breakdown (WaterStatsBody)
-- still needs which-drink-and-how-often for past periods though, so a
-- collapsed row keeps that in a new `breakdown` jsonb column instead of
-- deleting it outright: { "drinks": { "<name>": <count>, ... }, "milk": <ml> }.
-- Per-entry `name`/`category`/`time` on the summary row itself become
-- meaningless (many original entries folded into one), so those go generic:
-- category = 'summary', name = null, time = '00:00'.
ALTER TABLE zane_water_logs
  ADD COLUMN IF NOT EXISTS breakdown jsonb;

CREATE OR REPLACE FUNCTION collapse_water_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_total integer;
  v_milk integer;
  v_drinks jsonb;
  v_id text;
BEGIN
  -- One group per (user, past local date) that still has more than one row;
  -- a day already down to a single row (whether already collapsed, or the
  -- user only ever logged once that day) needs nothing further. tz_offset_minutes
  -- is the same per-user UTC offset the water-reminder cron already relies on
  -- (client-written, migration 0182); a user with no settings row yet falls
  -- back to UTC rather than being skipped entirely.
  FOR r IN
    SELECT wl.user_id, wl.date
    FROM zane_water_logs wl
    LEFT JOIN zane_user_settings us ON us.user_id = wl.user_id
    WHERE wl.date < to_char(
      (now() AT TIME ZONE 'UTC') + make_interval(mins => COALESCE(us.tz_offset_minutes, 0)),
      'YYYY-MM-DD'
    )
    GROUP BY wl.user_id, wl.date
    HAVING count(*) > 1
  LOOP
    SELECT
      sum(amount_ml)::int,
      sum(CASE WHEN category = 'other' THEN
        COALESCE((regexp_match(name, '\+\s*(\d+)ml Milk', 'i'))[1]::int, 0)
      ELSE 0 END)::int
    INTO v_total, v_milk
    FROM zane_water_logs
    WHERE user_id = r.user_id AND date = r.date;

    -- Same base-name derivation as the client's wtGroupOtherDrinks (strip the
    -- "+ Nml Milk" suffix, keep each coffee size / custom drink under its own
    -- name), just counted here instead of grouped client-side from raw rows.
    SELECT COALESCE(jsonb_object_agg(base_name, cnt), '{}'::jsonb) INTO v_drinks
    FROM (
      SELECT
        COALESCE(NULLIF(trim(regexp_replace(name, '\s*\+\s*\d+ml Milk', '', 'i')), ''), 'Other') AS base_name,
        count(*)::int AS cnt
      FROM zane_water_logs
      WHERE user_id = r.user_id AND date = r.date AND category = 'other'
      GROUP BY base_name
    ) t;

    v_id := gen_random_uuid()::text;

    DELETE FROM zane_water_logs WHERE user_id = r.user_id AND date = r.date;

    INSERT INTO zane_water_logs (id, user_id, date, "time", amount_ml, name, category, breakdown)
    VALUES (v_id, r.user_id, r.date, '00:00', v_total, NULL, 'summary',
      jsonb_build_object('drinks', v_drinks, 'milk', v_milk));
  END LOOP;
END;
$$;

-- Internal maintenance job only, called by pg_cron below and nothing else:
-- no client ever needs to call this, so no grant to authenticated either.
REVOKE EXECUTE ON FUNCTION public.collapse_water_logs() FROM PUBLIC;

-- pg_cron must be enabled (Dashboard, Database, Extensions). Hourly is plenty,
-- there is no user-facing urgency like the water-reminder cron has, a raw
-- entry just sits around a little longer if a tick is missed.
SELECT cron.schedule(
  'water-log-collapse',
  '0 * * * *',
  $$ SELECT collapse_water_logs(); $$
);
