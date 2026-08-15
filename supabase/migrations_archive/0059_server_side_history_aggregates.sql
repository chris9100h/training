-- Server-side history aggregation (audit Fix 17, stage 1). Additive RPCs that
-- let the client stop scanning the full in-memory session history for PRs,
-- per-exercise seeds/progression and all-time stats. SECURITY INVOKER + the
-- existing RLS (own rows + coach-of) keep access correct; pass p_user_id to read
-- a client's data as their coach.
--
-- Stage 2 (client windowing — boot loads only a recent set window and calls
-- these RPCs for the rest) is wired on top of these; see the audit notes.

-- Best all-time estimated 1RM (Epley) per exercise. Powers PR detection without
-- loading every set into the client. effReps = min(L,R) for unilateral, else reps.
CREATE OR REPLACE FUNCTION public.get_exercise_best_e1rm(p_user_id uuid DEFAULT NULL)
 RETURNS TABLE(ex_id text, best_e1rm double precision)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
  WITH uid AS (SELECT COALESCE(p_user_id, auth.uid()) AS id)
  SELECT e.ex_id,
    MAX(st.kg * (1 + (
      CASE WHEN st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL
           THEN LEAST(COALESCE(st.reps_l, st.reps_r), COALESCE(st.reps_r, st.reps_l))
           ELSE st.reps END
    )::numeric / 30.0))::float AS best_e1rm
  FROM zane_session_entries e
  JOIN zane_sets st ON st.entry_id = e.id
  JOIN zane_sessions s ON s.id = e.session_id
  WHERE e.user_id = (SELECT id FROM uid)
    AND e.ex_id IS NOT NULL
    AND s.ended IS NOT NULL
    AND NOT st.warmup AND NOT st.skipped AND st.kg IS NOT NULL
    AND COALESCE(
      CASE WHEN st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL
           THEN LEAST(COALESCE(st.reps_l, st.reps_r), COALESCE(st.reps_r, st.reps_l))
           ELSE st.reps END, 0) > 0
  GROUP BY e.ex_id;
$function$;

-- Recent ended sessions that logged a given exercise, newest first, each with
-- that exercise's sets. Powers seed/progression at session start, the "last
-- time" card and the exercise-history screen without the full history client-side.
CREATE OR REPLACE FUNCTION public.get_exercise_history(p_ex_id text, p_day_id text DEFAULT NULL, p_limit int DEFAULT 12, p_user_id uuid DEFAULT NULL)
 RETURNS TABLE(session_id text, day_id text, date timestamptz, ended timestamptz, sets jsonb)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
  WITH uid AS (SELECT COALESCE(p_user_id, auth.uid()) AS id)
  SELECT s.id AS session_id, s.day_id, s.date, s.ended,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kg', st.kg, 'reps', st.reps, 'repsL', st.reps_l, 'repsR', st.reps_r,
        'done', st.done, 'skipped', st.skipped, 'warmup', st.warmup
      ) ORDER BY st.set_idx)
      FROM zane_sets st WHERE st.entry_id = e.id
    ), '[]'::jsonb) AS sets
  FROM zane_sessions s
  JOIN zane_session_entries e ON e.session_id = s.id
  WHERE e.user_id = (SELECT id FROM uid)
    AND e.ex_id = p_ex_id
    AND s.ended IS NOT NULL
    AND (p_day_id IS NULL OR s.day_id = p_day_id)
    AND EXISTS (SELECT 1 FROM zane_sets st2 WHERE st2.entry_id = e.id
                AND (st2.kg IS NOT NULL OR st2.reps IS NOT NULL OR st2.reps_l IS NOT NULL OR st2.reps_r IS NOT NULL))
  ORDER BY s.ended DESC
  LIMIT GREATEST(p_limit, 1);
$function$;

-- All-time totals for the stats screen (volume = sum kg*effReps over completed
-- working sets; minutes; session + done-set counts). Streaks stay client-side
-- (plan-aware, need only session dates which boot still loads as metadata).
CREATE OR REPLACE FUNCTION public.get_user_volume_stats(p_user_id uuid DEFAULT NULL)
 RETURNS TABLE(session_count bigint, total_volume double precision, total_minutes bigint, total_done_sets bigint)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
  WITH uid AS (SELECT COALESCE(p_user_id, auth.uid()) AS id),
  ended AS (
    SELECT s.id, s.duration_minutes, s.started_at, s.ended
    FROM zane_sessions s WHERE s.user_id = (SELECT id FROM uid) AND s.ended IS NOT NULL
  )
  SELECT
    (SELECT COUNT(*) FROM ended)::bigint AS session_count,
    COALESCE((
      SELECT SUM(st.kg * (
        CASE WHEN st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL
             THEN LEAST(COALESCE(st.reps_l, st.reps_r), COALESCE(st.reps_r, st.reps_l))
             ELSE st.reps END))
      FROM zane_sets st JOIN ended en ON en.id = st.session_id
      WHERE NOT st.warmup AND NOT st.skipped AND st.kg IS NOT NULL
        AND COALESCE(CASE WHEN st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL
             THEN LEAST(COALESCE(st.reps_l, st.reps_r), COALESCE(st.reps_r, st.reps_l))
             ELSE st.reps END, 0) > 0
    ), 0)::float AS total_volume,
    COALESCE((SELECT SUM(COALESCE(en.duration_minutes,
        CASE WHEN en.started_at IS NOT NULL AND en.ended > en.started_at
             THEN EXTRACT(EPOCH FROM (en.ended - en.started_at))/60 ELSE 0 END))::bigint FROM ended en), 0)::bigint AS total_minutes,
    COALESCE((SELECT COUNT(*) FROM zane_sets st JOIN ended en ON en.id = st.session_id
              WHERE st.done AND NOT st.warmup AND NOT st.skipped), 0)::bigint AS total_done_sets;
$function$;
