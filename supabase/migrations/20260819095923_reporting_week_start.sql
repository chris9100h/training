-- Reporting week boundaries are user preferences.  They affect weekly
-- summaries, Friends metrics and coach check-ins only; plan/cycle weekdays
-- remain unchanged.

ALTER TABLE public.zane_user_settings
  ADD COLUMN IF NOT EXISTS week_start_day smallint NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.zane_user_settings'::regclass
       AND conname = 'zane_user_settings_week_start_day_check'
  ) THEN
    ALTER TABLE public.zane_user_settings
      ADD CONSTRAINT zane_user_settings_week_start_day_check
      CHECK (week_start_day BETWEEN 0 AND 6);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.get_coach_checkin_status()
RETURNS TABLE(coaching_id text, checked_in_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS coaching_id,
    (
      SELECT ci.checked_in_at
        FROM public.zane_checkins ci
       WHERE ci.coaching_id = c.id
         AND ci.week_start = current_date
           - ((extract(isodow FROM current_date)::int - 1
               - greatest(0, least(6, coalesce(us.week_start_day, 0))) + 7) % 7)
       LIMIT 1
    ) AS checked_in_at
    FROM public.zane_coaching c
    LEFT JOIN public.zane_user_settings us ON us.user_id = c.client_id
   WHERE c.coach_id = auth.uid()
     AND c.coach_id <> c.client_id
     AND c.status = 'active'
     AND c.id NOT LIKE 'support_%';
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_health_metric_value(
  p_user_id uuid,
  p_metric text,
  p_week_start date,
  p_today date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_value jsonb;
  v_zone text;
  v_offset integer;
  v_week_start_day integer;
  v_owner_today date;
  v_week_start date;
  v_week_end date;
  v_adherence_end date;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  v_week_start_day := 0;
  SELECT nullif(trim(us.time_zone), ''), us.tz_offset_minutes,
         greatest(0, least(6, coalesce(us.week_start_day, 0)))
    INTO v_zone, v_offset, v_week_start_day
    FROM public.zane_user_settings us
   WHERE us.user_id = p_user_id;

  IF v_zone IS NOT NULL AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_zone) THEN
    v_owner_today := (now() AT TIME ZONE v_zone)::date;
  ELSE
    v_owner_today := ((now() AT TIME ZONE 'UTC') + make_interval(mins => coalesce(v_offset, 0)))::date;
  END IF;
  v_week_start := v_owner_today
    - ((extract(isodow FROM v_owner_today)::int - 1 - v_week_start_day + 7) % 7);
  v_week_end := v_week_start + 7;
  v_adherence_end := least(v_week_end, v_owner_today);

  CASE p_metric
    WHEN 'steps' THEN
      SELECT to_jsonb(CASE WHEN count(*) FILTER (WHERE dl.steps IS NOT NULL) = 0 THEN NULL::numeric ELSE coalesce(sum(dl.steps), 0)::numeric END)
        INTO v_value FROM public.zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_week_end;
    WHEN 'workouts' THEN
      SELECT to_jsonb(CASE WHEN count(*) = 0 THEN NULL::numeric ELSE count(*)::numeric END)
        INTO v_value FROM public.zane_sessions s
       WHERE s.user_id = p_user_id AND s.ended IS NOT NULL AND s.date::date >= v_week_start AND s.date::date < v_week_end;
    WHEN 'adherence' THEN
      SELECT to_jsonb(round(avg(dl.adherence)::numeric, 1)) INTO v_value FROM public.zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_adherence_end AND dl.adherence IS NOT NULL;
    WHEN 'calories' THEN
      SELECT to_jsonb(round(avg(dl.calories)::numeric, 0)) INTO v_value FROM public.zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_adherence_end AND dl.calories IS NOT NULL;
    WHEN 'protein' THEN
      SELECT to_jsonb(round(avg(dl.protein)::numeric, 0)) INTO v_value FROM public.zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_adherence_end AND dl.protein IS NOT NULL;
    WHEN 'carbs' THEN
      SELECT to_jsonb(round(avg(dl.carbs)::numeric, 0)) INTO v_value FROM public.zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_adherence_end AND dl.carbs IS NOT NULL;
    WHEN 'fat' THEN
      SELECT to_jsonb(round(avg(dl.fat)::numeric, 0)) INTO v_value FROM public.zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_adherence_end AND dl.fat IS NOT NULL;
    WHEN 'fiber' THEN
      SELECT to_jsonb(round(avg(dl.fiber)::numeric, 0)) INTO v_value FROM public.zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_adherence_end AND dl.fiber IS NOT NULL;
    WHEN 'water' THEN
      SELECT to_jsonb(round(avg(dl.water_ml)::numeric, 0)) INTO v_value FROM public.zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_adherence_end AND dl.water_ml IS NOT NULL;
    WHEN 'cardioMinutes' THEN
      SELECT to_jsonb(CASE WHEN count(*) = 0 THEN NULL::numeric ELSE coalesce(sum(cl.duration_minutes), 0)::numeric END)
        INTO v_value FROM public.zane_cardio_logs cl
       WHERE cl.user_id = p_user_id AND cl.date::date >= v_week_start AND cl.date::date < v_week_end;
    WHEN 'cardioDistance' THEN
      SELECT to_jsonb(round(sum(cl.distance_m)::numeric, 0)) INTO v_value FROM public.zane_cardio_logs cl
       WHERE cl.user_id = p_user_id AND cl.date::date >= v_week_start AND cl.date::date < v_week_end AND cl.distance_m IS NOT NULL;
    WHEN 'weight' THEN
      SELECT to_jsonb(dl.weight) INTO v_value FROM public.zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_week_end AND dl.weight IS NOT NULL
       ORDER BY dl.date DESC LIMIT 1;
    WHEN 'bodyFatPct' THEN
      SELECT to_jsonb(dl.body_fat_pct) INTO v_value FROM public.zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_week_end AND dl.body_fat_pct IS NOT NULL
       ORDER BY dl.date DESC LIMIT 1;
    WHEN 'waistCm' THEN
      SELECT to_jsonb(dl.waist_cm) INTO v_value FROM public.zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_week_end AND dl.waist_cm IS NOT NULL
       ORDER BY dl.date DESC LIMIT 1;
    WHEN 'hipsCm' THEN
      SELECT to_jsonb(dl.hips_cm) INTO v_value FROM public.zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_week_end AND dl.hips_cm IS NOT NULL
       ORDER BY dl.date DESC LIMIT 1;
    WHEN 'chestCm' THEN
      SELECT to_jsonb(dl.chest_cm) INTO v_value FROM public.zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_week_end AND dl.chest_cm IS NOT NULL
       ORDER BY dl.date DESC LIMIT 1;
    WHEN 'armCm' THEN
      SELECT to_jsonb(dl.arm_cm) INTO v_value FROM public.zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_week_end AND dl.arm_cm IS NOT NULL
       ORDER BY dl.date DESC LIMIT 1;
    WHEN 'thighCm' THEN
      SELECT to_jsonb(dl.thigh_cm) INTO v_value FROM public.zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_week_end AND dl.thigh_cm IS NOT NULL
       ORDER BY dl.date DESC LIMIT 1;
    WHEN 'calfCm' THEN
      SELECT to_jsonb(dl.calf_cm) INTO v_value FROM public.zane_daily_logs dl
       WHERE dl.user_id = p_user_id AND dl.date::date >= v_week_start AND dl.date::date < v_week_end AND dl.calf_cm IS NOT NULL
       ORDER BY dl.date DESC LIMIT 1;
    WHEN 'glucose' THEN
      SELECT to_jsonb(gl.value_mmol) INTO v_value FROM public.zane_glucose_logs gl
       WHERE gl.user_id = p_user_id AND gl.date::date >= v_week_start AND gl.date::date < v_week_end
       ORDER BY gl.date DESC, gl.time DESC LIMIT 1;
    WHEN 'bloodPressure' THEN
      SELECT jsonb_build_object('systolic', bp.systolic, 'diastolic', bp.diastolic) INTO v_value FROM public.zane_blood_pressure_logs bp
       WHERE bp.user_id = p_user_id AND bp.date::date >= v_week_start AND bp.date::date < v_week_end
       ORDER BY bp.date DESC, bp.time DESC LIMIT 1;
    WHEN 'bodyTemp' THEN
      SELECT to_jsonb(bt.value_c) INTO v_value FROM public.zane_body_temp_logs bt
       WHERE bt.user_id = p_user_id AND bt.date::date >= v_week_start AND bt.date::date < v_week_end
       ORDER BY bt.date DESC, bt.time DESC LIMIT 1;
    ELSE
      RETURN NULL;
  END CASE;
  RETURN v_value;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_health_metric_value(uuid, text, date, date) FROM PUBLIC, anon, authenticated;
