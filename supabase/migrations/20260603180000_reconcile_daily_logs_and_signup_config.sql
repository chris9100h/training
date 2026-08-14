-- Migration 0069 was installed manually.  The daily-log table is pre-social
-- core schema and is needed by later recorded migrations.
CREATE TABLE IF NOT EXISTS public.zane_daily_logs (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date text NOT NULL,
  weight numeric,
  steps integer,
  calories integer,
  protein integer,
  carbs integer,
  fat integer,
  water_ml integer,
  note text,
  adherence numeric,
  targets_snap jsonb,
  fiber integer,
  off_plan_note text,
  daily_coach_fields jsonb,
  ai_summary text,
  ai_summary_generated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

ALTER TABLE public.zane_daily_logs ENABLE ROW LEVEL SECURITY;
DO $policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'zane_daily_logs' AND policyname = 'Users manage own daily logs') THEN
    CREATE POLICY "Users manage own daily logs" ON public.zane_daily_logs FOR ALL TO authenticated
      USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'zane_daily_logs' AND policyname = 'coach can read client daily logs') THEN
    CREATE POLICY "coach can read client daily logs" ON public.zane_daily_logs FOR SELECT TO authenticated
      USING (zane_is_coach_of(user_id));
  END IF;
END
$policy$;

ALTER TABLE public.zane_user_settings
  ADD COLUMN IF NOT EXISTS macro_targets jsonb,
  ADD COLUMN IF NOT EXISTS show_health_tab boolean NOT NULL DEFAULT false;
