-- 0149_coaching_audit_hardening.sql
-- Fixes from the Coaching-tab audit sweep:
--   #12 get_coach_checkin_status computed the check-in week with EXTRACT(DOW),
--       where Sunday=0, so on Sundays it advanced to the current (unfinished)
--       week and disagreed with the client's checkinWeekStart (which counts
--       Sunday as day 7). A client who had already checked in flipped back to
--       "CHECK-IN DUE" for the coach every Sunday, offering a spurious Remind.
--       Use ISODOW (Mon=1 .. Sun=7) so both sides advance the due week only on
--       Monday. Only Sunday's result changes; Mon-Sat are identical.
--   #25 checkins_coach_read lacked the support_% exclusion and self-guard that
--       migration 0148 applied to the other coach-read policies. Align it: a
--       support thread (id LIKE 'support_%') and a self-coaching row
--       (coach_id = client_id) are not a real coach->client read relationship.
--       Self users still read their own check-ins via checkins_client.
--   #26 The macros policies had no status='active' gate, so a coach could write
--       macro targets on a still-pending (non-consented) invite and the client
--       could read them. Gate both sides on an active, non-support relation.
--       Self-coaching keeps working (self rows are active, coach_id = client_id),
--       so the macros policies keep coach_id = auth.uid() / client_id = auth.uid()
--       without a coach<>client guard.

-- ── #12: align the coach check-in week with the client (ISODOW, Sunday = 7) ───
CREATE OR REPLACE FUNCTION public.get_coach_checkin_status()
 RETURNS TABLE(coaching_id text, checked_in_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_week_start date;
begin
  -- ISODOW: Mon=1 .. Sun=7. Subtracting it plus 6 days lands on the Monday of
  -- the last completed week for every day, and (unlike DOW where Sunday=0) keeps
  -- Sunday on the previous week, matching store.js checkinWeekStart().
  v_week_start := current_date
    - (extract(isodow from current_date)::int) * interval '1 day'
    - interval '6 days';

  return query
  select
    c.id as coaching_id,
    (
      select ci.checked_in_at from zane_checkins ci
      where ci.coaching_id = c.id
        and ci.week_start = v_week_start
      limit 1
    ) as checked_in_at
  from zane_coaching c
  where c.coach_id = auth.uid()
    and c.coach_id <> c.client_id
    and c.status = 'active'
    and c.id not like 'support_%';
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_coach_checkin_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coach_checkin_status() TO authenticated;

-- ── #25: scope the coach check-in read to a real coaching relation ────────────
DROP POLICY IF EXISTS "checkins_coach_read" ON public.zane_checkins;
CREATE POLICY "checkins_coach_read" ON public.zane_checkins FOR SELECT TO authenticated
  USING (EXISTS ( SELECT 1 FROM zane_coaching
    WHERE zane_coaching.id = zane_checkins.coaching_id
      AND zane_coaching.coach_id = (select auth.uid())
      AND zane_coaching.coach_id <> zane_coaching.client_id
      AND zane_coaching.status = 'active'
      AND zane_coaching.id NOT LIKE 'support_%'));

-- ── #26: macros only within an active, non-support coaching relation ──────────
DROP POLICY IF EXISTS "Coach can manage macros" ON public.zane_coaching_macros;
CREATE POLICY "Coach can manage macros" ON public.zane_coaching_macros FOR ALL TO public
  USING (EXISTS ( SELECT 1 FROM zane_coaching
    WHERE zane_coaching.id = zane_coaching_macros.coaching_id
      AND zane_coaching.coach_id = (select auth.uid())
      AND zane_coaching.status = 'active'
      AND zane_coaching.id NOT LIKE 'support_%'));

DROP POLICY IF EXISTS "Client can read macros" ON public.zane_coaching_macros;
CREATE POLICY "Client can read macros" ON public.zane_coaching_macros FOR SELECT TO public
  USING (EXISTS ( SELECT 1 FROM zane_coaching
    WHERE zane_coaching.id = zane_coaching_macros.coaching_id
      AND zane_coaching.client_id = (select auth.uid())
      AND zane_coaching.status = 'active'
      AND zane_coaching.id NOT LIKE 'support_%'));
