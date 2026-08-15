-- Deep-audit hardening (docs/new_audit.md: M30, M31, M32, plus the
-- recipe-share leftover from deleteAllData and the unilateral chain-set
-- repair). Five independent fixes, all small, grouped into one migration
-- because they are one review pass.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) M30: collapse_water_logs is callable by every logged-in user.
--
-- Migration 0183 only REVOKEd from PUBLIC. A separate ALTER DEFAULT
-- PRIVILEGES rule (owner postgres) grants EXECUTE on every new function
-- directly to `authenticated`, so the REVOKE from PUBLIC never took it away
-- (the same trap migration 0208 hit with bump_api_usage). The function is
-- SECURITY DEFINER and folds raw water rows across ALL tenants, so any
-- authenticated user could run the maintenance job for everybody.
-- It is a cron-only job: no client ever calls it.
REVOKE EXECUTE ON FUNCTION public.collapse_water_logs() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.collapse_water_logs() FROM anon;

-- Verify (both must be false):
--   SELECT has_function_privilege('authenticated', 'public.collapse_water_logs()', 'execute');
--   SELECT has_function_privilege('anon',          'public.collapse_water_logs()', 'execute');

-- ─────────────────────────────────────────────────────────────────────────
-- 2) M32: zane_coaching_guard_update only protects coach_id/client_id/status.
--
-- The "client can respond to invite" UPDATE policy allows any column, and RLS
-- cannot restrict columns. So a client could also rewrite checkin_enabled,
-- checkin_schema and the support_* fields, i.e. switch off the check-ins their
-- coach turned on, or edit the coach's check-in form.
CREATE OR REPLACE FUNCTION public.zane_coaching_guard_update()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
begin
  if new.coach_id <> old.coach_id or new.client_id <> old.client_id then
    raise exception 'coach_id/client_id are immutable';
  end if;
  if new.status is distinct from old.status and (select auth.uid()) <> old.client_id then
    raise exception 'only the client may change coaching status';
  end if;
  -- Coach-owned configuration: the client may read it, never write it.
  if (select auth.uid()) <> old.coach_id then
    if new.checkin_enabled  is distinct from old.checkin_enabled
       or new.checkin_schema   is distinct from old.checkin_schema
       or new.support_status   is distinct from old.support_status
       or new.support_category is distinct from old.support_category
       or new.created_at       is distinct from old.created_at then
      raise exception 'only the coach may change the coaching configuration';
    end if;
  end if;
  return new;
end;
$function$;

-- The guard functions are trigger-only: nothing should be able to call them
-- directly. Its two siblings (zane_guard_user_id_immutable,
-- zane_coaching_notes_guard_update) already REVOKE, this one never did.
REVOKE EXECUTE ON FUNCTION public.zane_coaching_guard_update() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) M31: coach-writable food tables have no user_id immutability trigger.
--
-- Migration 0148 introduced zane_guard_user_id_immutable for exactly this
-- shape: a coach UPDATE policy whose WITH CHECK cannot see OLD, so a coach can
-- UPDATE a client row and set user_id to someone else, re-parenting it to
-- themselves or to another client. The meal-plan tables added in 0197/0199/
-- 0200 repeat the pattern without the trigger.
DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_food_meal_plans;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_food_meal_plans
  FOR EACH ROW EXECUTE FUNCTION zane_guard_user_id_immutable();

DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_food_template_slots;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_food_template_slots
  FOR EACH ROW EXECUTE FUNCTION zane_guard_user_id_immutable();

DROP TRIGGER IF EXISTS zane_guard_user_id ON public.zane_food_recipes;
CREATE TRIGGER zane_guard_user_id BEFORE UPDATE ON public.zane_food_recipes
  FOR EACH ROW EXECUTE FUNCTION zane_guard_user_id_immutable();

-- ─────────────────────────────────────────────────────────────────────────
-- 4) deleteAllData leaves zane_recipe_shares behind.
--
-- The table has RLS with no policies (all access goes through the two RPCs
-- from migration 0193), so the client cannot delete its own rows and a full
-- account wipe left every old ?share=<token> link serving the recipe snapshot,
-- including the sharer's display name. Same access model as the siblings: one
-- SECURITY DEFINER RPC, authenticated only, scoped to the caller.
CREATE OR REPLACE FUNCTION public.delete_my_recipe_shares()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  DELETE FROM zane_recipe_shares WHERE user_id = v_uid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_my_recipe_shares() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_my_recipe_shares() TO authenticated;

-- Verify: SELECT has_function_privilege('anon', 'public.delete_my_recipe_shares()', 'execute'); -- false

-- ─────────────────────────────────────────────────────────────────────────
-- 5) H5 backfill: chain sets on unilateral exercises kept a stale per-side seed.
--
-- finishDropSet / finishMyoSet / finishAv wrote the chain result to kg/reps but
-- left the seeded reps_l/reps_r in place, and LB.effReps prefers the per-side
-- values. Volume, e1RM and PR detection therefore scored those sets with the
-- SEED reps. The writers are fixed; existing rows need the same clearing.
UPDATE public.zane_sets
   SET reps_l = NULL, reps_r = NULL
 WHERE technique IN ('drop', 'myorep', 'myorep_match', 'amrap_variations')
   AND drops IS NOT NULL
   AND jsonb_typeof(drops) = 'array'
   AND (reps_l IS NOT NULL OR reps_r IS NOT NULL);
