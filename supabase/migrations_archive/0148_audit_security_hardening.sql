-- 0148_audit_security_hardening.sql
-- Fixes surfaced by the codebase audit sweep:
--   #15 get_exercise_best_e1rm aggregated assisted (negative-load) exercises,
--       caching a negative "best e1RM". Exclude assisted movements.
--   #7  Support tickets and broadcasts reuse status='active' zane_coaching rows
--       (id LIKE 'support_%'). zane_is_coach_of and the inline coach-read
--       policies therefore granted the admin full coach-level access to a user's
--       whole dataset just from a support chat. Scope them to real coaching
--       links (cch_/self_), excluding support_% rows.
--   #8  The "recipient can mark read" UPDATE on zane_coaching_notes is not
--       column-restricted; a non-author could rewrite the message. Guard it so a
--       non-author may only change read_at.
--   #19 Coach UPDATE policies carry no WITH CHECK, so a coach could re-parent a
--       row between their own clients. Make user_id immutable on those tables.

-- ── #15: exclude assisted exercises from the server best-e1RM aggregate ───────
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
    AND ex.movement_type IS DISTINCT FROM 'assisted'
    AND NOT st.warmup AND NOT st.skipped AND st.kg IS NOT NULL
    AND COALESCE(
      CASE WHEN st.reps_l IS NOT NULL OR st.reps_r IS NOT NULL
           THEN LEAST(COALESCE(st.reps_l, st.reps_r), COALESCE(st.reps_r, st.reps_l))
           ELSE st.reps END, 0) > 0
  GROUP BY e.ex_id;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_exercise_best_e1rm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exercise_best_e1rm(uuid) TO authenticated;

-- ── #7: real coaching links only (support_% rows are not a coaching relation) ─
CREATE OR REPLACE FUNCTION public.zane_is_coach_of(p_client_id uuid)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from zane_coaching
    where coach_id = auth.uid()
      and client_id = p_client_id
      and status = 'active'
      and id not like 'support_%'
  )
$function$;
REVOKE EXECUTE ON FUNCTION public.zane_is_coach_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.zane_is_coach_of(uuid) TO authenticated;

-- The cardio/status/glucose coach-read policies check zane_coaching inline
-- (not through zane_is_coach_of), so they need the same support_% exclusion.
DROP POLICY IF EXISTS "coaches read client cardio logs" ON public.zane_cardio_logs;
CREATE POLICY "coaches read client cardio logs" ON public.zane_cardio_logs FOR SELECT TO authenticated
  USING (EXISTS ( SELECT 1 FROM zane_coaching zc
    WHERE zc.client_id = zane_cardio_logs.user_id AND zc.coach_id = (select auth.uid())
      AND zc.coach_id <> zc.client_id AND zc.status = 'active' AND zc.id NOT LIKE 'support_%'));

DROP POLICY IF EXISTS "coaches read client status periods" ON public.zane_status_periods;
CREATE POLICY "coaches read client status periods" ON public.zane_status_periods FOR SELECT TO public
  USING (EXISTS ( SELECT 1 FROM zane_coaching zc
    WHERE zc.client_id = zane_status_periods.user_id AND zc.coach_id = (select auth.uid())
      AND zc.coach_id <> zc.client_id AND zc.status = 'active' AND zc.id NOT LIKE 'support_%'));

DROP POLICY IF EXISTS "coaches read client glucose logs" ON public.zane_glucose_logs;
CREATE POLICY "coaches read client glucose logs" ON public.zane_glucose_logs FOR SELECT TO public
  USING (EXISTS ( SELECT 1 FROM zane_coaching zc
    WHERE zc.client_id = zane_glucose_logs.user_id AND zc.coach_id = (select auth.uid())
      AND zc.coach_id <> zc.client_id AND zc.status = 'active' AND zc.id NOT LIKE 'support_%'));

-- ── #8: a non-author may only mark a coaching note read, never edit its body ──
CREATE OR REPLACE FUNCTION public.zane_coaching_notes_guard_update()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
begin
  -- RLS can't restrict an UPDATE to specific columns, so the "recipient can
  -- mark read" policy would otherwise let the non-author overwrite the note.
  -- When the actor is not the author, only read_at may change.
  if (select auth.uid()) <> old.author_id then
    if new.id           is distinct from old.id
       or new.coaching_id  is distinct from old.coaching_id
       or new.author_id    is distinct from old.author_id
       or new.type         is distinct from old.type
       or new.entity_id    is distinct from old.entity_id
       or new.entity_name  is distinct from old.entity_name
       or new.body         is distinct from old.body
       or new.created_at   is distinct from old.created_at
       or new.thread_id    is distinct from old.thread_id
       or new.attachments  is distinct from old.attachments
    then
      raise exception 'recipient may only update read_at';
    end if;
  end if;
  return new;
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.zane_coaching_notes_guard_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zane_coaching_notes_guard_update ON public.zane_coaching_notes;
CREATE TRIGGER zane_coaching_notes_guard_update
  BEFORE UPDATE ON public.zane_coaching_notes
  FOR EACH ROW EXECUTE FUNCTION zane_coaching_notes_guard_update();

-- ── #19: user_id is immutable on coach-writable tables (no re-parenting) ──────
CREATE OR REPLACE FUNCTION public.zane_guard_user_id_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id is immutable';
  end if;
  return new;
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.zane_guard_user_id_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_exercises;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_exercises
  FOR EACH ROW EXECUTE FUNCTION zane_guard_user_id_immutable();
DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_schedules;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_schedules
  FOR EACH ROW EXECUTE FUNCTION zane_guard_user_id_immutable();
DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_sessions;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_sessions
  FOR EACH ROW EXECUTE FUNCTION zane_guard_user_id_immutable();
DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_session_entries;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_session_entries
  FOR EACH ROW EXECUTE FUNCTION zane_guard_user_id_immutable();
DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_sets;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_sets
  FOR EACH ROW EXECUTE FUNCTION zane_guard_user_id_immutable();
DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_user_settings;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_user_settings
  FOR EACH ROW EXECUTE FUNCTION zane_guard_user_id_immutable();
