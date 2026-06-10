-- Per-session aggregates (stage 2 of the server-side history work). The boot
-- query now loads zane_session_entries/zane_sets only for a recent window, so
-- the history list, the "best session" card and the coach session lists need
-- volume / set / exercise counts for older sessions from the server. One tiny
-- row per ended session — boot payload stays O(sessions), never O(sets).
--
-- Semantics match the client's totalVolume()/doneSetCount() for ENDED sessions:
-- working sets (not warmup, not skipped) with a weight and any reps value
-- count, done flag NOT required (kbApply races can leave performed sets with
-- done=false). effReps = min(L,R) for unilateral sets, else reps.
CREATE OR REPLACE FUNCTION public.get_session_stats(p_user_id uuid DEFAULT NULL)
 RETURNS TABLE(session_id text, exercise_count integer, done_sets integer, volume double precision)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
  WITH uid AS (SELECT COALESCE(p_user_id, auth.uid()) AS id)
  SELECT s.id AS session_id,
    (SELECT COUNT(*) FROM zane_session_entries e WHERE e.session_id = s.id)::int AS exercise_count,
    (SELECT COUNT(*) FROM zane_sets st WHERE st.session_id = s.id
       AND NOT st.warmup AND NOT st.skipped
       AND st.kg IS NOT NULL
       AND (st.reps IS NOT NULL OR st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL))::int AS done_sets,
    COALESCE((SELECT SUM(st.kg * COALESCE(
        CASE WHEN st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL
             THEN LEAST(COALESCE(st.reps_l, st.reps_r), COALESCE(st.reps_r, st.reps_l))
             ELSE st.reps END, 0))
      FROM zane_sets st WHERE st.session_id = s.id
        AND NOT st.warmup AND NOT st.skipped
        AND st.kg IS NOT NULL
        AND (st.reps IS NOT NULL OR st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL)
    ), 0)::float AS volume
  FROM zane_sessions s
  WHERE s.user_id = (SELECT id FROM uid)
    AND s.ended IS NOT NULL;
$function$;

-- zane_sets so far only had an index on entry_id; the per-session subqueries
-- here (and the session_id joins in get_user_volume_stats / the overview RPCs)
-- want a direct session_id index.
CREATE INDEX IF NOT EXISTS zane_sets_session_id_idx ON public.zane_sets USING btree (session_id);
