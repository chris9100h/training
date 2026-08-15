-- 0153_checkin_schema_templates_rls_perf.sql
-- Found by post-ship review: zane_checkin_schema_templates_own (migration 0152)
-- used bare auth.uid() instead of the (select auth.uid()) form migration 0126
-- established project-wide to avoid per-row re-evaluation of the initplan.
-- 0126 predates 0152, so it never touched this table. Not a security issue
-- (auth.uid() is NULL for anon, which can never match a NOT NULL user_id), only
-- a performance/convention fix; confirmed live via get_advisors(type=performance)
-- reporting exactly one auth_rls_initplan finding for this table before the fix.

DROP POLICY IF EXISTS "zane_checkin_schema_templates_own" ON public.zane_checkin_schema_templates;
CREATE POLICY "zane_checkin_schema_templates_own"
  ON zane_checkin_schema_templates FOR ALL
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
