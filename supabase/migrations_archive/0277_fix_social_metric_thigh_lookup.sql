-- Correct the body measurement lookup while retaining the completed-day
-- boundary for shared nutrition metrics from 0276.

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
  v_week_end date := p_week_start + 7;
  v_adherence_end date := LEAST(p_week_start + 7, p_today);
BEGIN
  IF p_user_id IS NULL OR p_week_start IS NULL OR p_today IS NULL THEN RETURN NULL; END IF;

  CASE p_metric
    WHEN 'steps' THEN
      SELECT to_jsonb(CASE WHEN count(*) FILTER (WHERE dl.steps IS NOT NULL) = 0 THEN NULL::numeric ELSE coalesce(sum(dl.steps), 0)::numeric END)
      INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end;
    WHEN 'workouts' THEN
      SELECT to_jsonb(CASE WHEN count(*) = 0 THEN NULL::numeric ELSE count(*)::numeric END)
      INTO v_value FROM zane_sessions s
      WHERE s.user_id = p_user_id AND s.ended IS NOT NULL AND s.date::date >= p_week_start AND s.date::date < v_week_end;
    WHEN 'adherence' THEN
      SELECT to_jsonb(round(avg(dl.adherence)::numeric, 1)) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_adherence_end AND dl.adherence IS NOT NULL;
    WHEN 'calories' THEN
      SELECT to_jsonb(round(avg(dl.calories)::numeric, 0)) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_adherence_end AND dl.calories IS NOT NULL;
    WHEN 'protein' THEN
      SELECT to_jsonb(round(avg(dl.protein)::numeric, 0)) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_adherence_end AND dl.protein IS NOT NULL;
    WHEN 'carbs' THEN
      SELECT to_jsonb(round(avg(dl.carbs)::numeric, 0)) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_adherence_end AND dl.carbs IS NOT NULL;
    WHEN 'fat' THEN
      SELECT to_jsonb(round(avg(dl.fat)::numeric, 0)) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_adherence_end AND dl.fat IS NOT NULL;
    WHEN 'fiber' THEN
      SELECT to_jsonb(round(avg(dl.fiber)::numeric, 0)) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_adherence_end AND dl.fiber IS NOT NULL;
    WHEN 'water' THEN
      SELECT to_jsonb(round(avg(dl.water_ml)::numeric, 0)) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_adherence_end AND dl.water_ml IS NOT NULL;
    WHEN 'cardioMinutes' THEN
      SELECT to_jsonb(CASE WHEN count(*) = 0 THEN NULL::numeric ELSE coalesce(sum(cl.duration_minutes), 0)::numeric END)
      INTO v_value FROM zane_cardio_logs cl
      WHERE cl.user_id = p_user_id AND cl.date::date >= p_week_start AND cl.date::date < v_week_end;
    WHEN 'cardioDistance' THEN
      SELECT to_jsonb(round(sum(cl.distance_m)::numeric, 0)) INTO v_value FROM zane_cardio_logs cl
      WHERE cl.user_id = p_user_id AND cl.date::date >= p_week_start AND cl.date::date < v_week_end AND cl.distance_m IS NOT NULL;
    WHEN 'weight' THEN
      SELECT to_jsonb(dl.weight) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.weight IS NOT NULL
      ORDER BY dl.date DESC LIMIT 1;
    WHEN 'bodyFatPct' THEN
      SELECT to_jsonb(dl.body_fat_pct) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.body_fat_pct IS NOT NULL
      ORDER BY dl.date DESC LIMIT 1;
    WHEN 'waistCm' THEN
      SELECT to_jsonb(dl.waist_cm) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.waist_cm IS NOT NULL
      ORDER BY dl.date DESC LIMIT 1;
    WHEN 'hipsCm' THEN
      SELECT to_jsonb(dl.hips_cm) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.hips_cm IS NOT NULL
      ORDER BY dl.date DESC LIMIT 1;
    WHEN 'chestCm' THEN
      SELECT to_jsonb(dl.chest_cm) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.chest_cm IS NOT NULL
      ORDER BY dl.date DESC LIMIT 1;
    WHEN 'armCm' THEN
      SELECT to_jsonb(dl.arm_cm) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.arm_cm IS NOT NULL
      ORDER BY dl.date DESC LIMIT 1;
    WHEN 'thighCm' THEN
      SELECT to_jsonb(dl.thigh_cm) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.thigh_cm IS NOT NULL
      ORDER BY dl.date DESC LIMIT 1;
    WHEN 'calfCm' THEN
      SELECT to_jsonb(dl.calf_cm) INTO v_value FROM zane_daily_logs dl
      WHERE dl.user_id = p_user_id AND dl.date::date >= p_week_start AND dl.date::date < v_week_end AND dl.calf_cm IS NOT NULL
      ORDER BY dl.date DESC LIMIT 1;
    WHEN 'glucose' THEN
      SELECT to_jsonb(gl.value_mmol) INTO v_value FROM zane_glucose_logs gl
      WHERE gl.user_id = p_user_id AND gl.date::date >= p_week_start AND gl.date::date < v_week_end
      ORDER BY gl.date DESC, gl.time DESC LIMIT 1;
    WHEN 'bloodPressure' THEN
      SELECT jsonb_build_object('systolic', bp.systolic, 'diastolic', bp.diastolic) INTO v_value FROM zane_blood_pressure_logs bp
      WHERE bp.user_id = p_user_id AND bp.date::date >= p_week_start AND bp.date::date < v_week_end
      ORDER BY bp.date DESC, bp.time DESC LIMIT 1;
    WHEN 'bodyTemp' THEN
      SELECT to_jsonb(bt.value_c) INTO v_value FROM zane_body_temp_logs bt
      WHERE bt.user_id = p_user_id AND bt.date::date >= p_week_start AND bt.date::date < v_week_end
      ORDER BY bt.date DESC, bt.time DESC LIMIT 1;
    ELSE
      RETURN NULL;
  END CASE;
  RETURN v_value;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_health_metric_value(uuid, text, date, date) FROM PUBLIC, anon, authenticated;
