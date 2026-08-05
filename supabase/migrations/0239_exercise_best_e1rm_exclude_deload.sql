-- get_exercise_best_e1rm (migration 0059, assisted-exclusion 0148) aggregates
-- MAX(e1rm) across every ended session's non-warmup, non-skipped, kg-bearing
-- sets, with no deload exclusion at all. Every CLIENT-side "is this a PR"
-- computation (screens-lib.jsx's isPR, both SessionDetailScreen's and
-- ExerciseDetail's own copy) deliberately excludes deload sessions from
-- counting as a PR baseline: a deload is intentionally light, so a set
-- during one is not a real record to beat (see the isPR comment: "Deload
-- sessions are deliberately light, comparing against one as 'last time'
-- would show every set as a fabricated 'improvement'"). This RPC is the one
-- server-side exception to that rule, and it feeds store.exerciseBests,
-- which SessionDetailScreen's isPR (as of migration/branch work fixing the
-- windowed-history PR-badge false-positive) now uses as a hard floor: any
-- exercise with an inflated deload-session e1RM in its history can
-- permanently block a genuine new all-time best from ever badging as a PR
-- again, confirmed live (a Leg Curl PR failed to badge in SessionDetail
-- while ExerciseDetail's own independent check correctly showed it as one).
--
-- Fix: exclude deload sessions from this aggregate too, matching every
-- client-side definition of "PR baseline" exactly.

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
  LEFT JOIN zane_exercises ex ON ex.id = e.ex_id AND ex.user_id = e.user_id
  WHERE e.user_id = (SELECT id FROM uid)
    AND e.ex_id IS NOT NULL
    AND s.ended IS NOT NULL
    AND NOT s.is_deload
    AND ex.movement_type IS DISTINCT FROM 'assisted'
    AND NOT st.warmup AND NOT st.skipped AND st.kg IS NOT NULL
    AND COALESCE(
      CASE WHEN st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL
           THEN LEAST(COALESCE(st.reps_l, st.reps_r), COALESCE(st.reps_r, st.reps_l))
           ELSE st.reps END, 0) > 0
  GROUP BY e.ex_id;
$function$;
