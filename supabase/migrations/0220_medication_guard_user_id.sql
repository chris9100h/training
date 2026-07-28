-- Migration 0148 introduced zane_guard_user_id_immutable for exactly this
-- shape: a coach UPDATE policy whose WITH CHECK cannot see OLD, so a coach can
-- UPDATE a client row and set user_id to someone else, re-parenting it to
-- themselves or to another client. Migration 0213 (M31) retrofitted this onto
-- the food meal-plan tables after the same gap was found there; migration
-- 0218 repeated the pattern for the four medication tables without the
-- trigger. No new function needed, zane_guard_user_id_immutable already
-- exists.
DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_medication_plans;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_medication_plans
  FOR EACH ROW EXECUTE FUNCTION zane_guard_user_id_immutable();

DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_medications;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_medications
  FOR EACH ROW EXECUTE FUNCTION zane_guard_user_id_immutable();

DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_medication_schedule_slots;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_medication_schedule_slots
  FOR EACH ROW EXECUTE FUNCTION zane_guard_user_id_immutable();

DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_medication_logs;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_medication_logs
  FOR EACH ROW EXECUTE FUNCTION zane_guard_user_id_immutable();
