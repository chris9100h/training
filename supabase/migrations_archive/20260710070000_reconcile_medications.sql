-- Migrations 0218/0220/0221/0223/0233-0237 were installed manually.  This
-- creates their final additive shape directly; there is no medication
-- migration in the production history that should run a second transformation.
CREATE TABLE IF NOT EXISTS public.zane_medication_plans (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  is_template boolean NOT NULL DEFAULT false,
  coach_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zane_medication_plans_user_idx ON public.zane_medication_plans (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.zane_medications (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  brand text,
  category text,
  unit_label text NOT NULL DEFAULT 'pills',
  package_size numeric,
  stock_baseline numeric,
  stock_set_at timestamptz,
  archived boolean NOT NULL DEFAULT false,
  exclude_from_pillbox boolean NOT NULL DEFAULT false,
  low_stock_threshold numeric,
  exclude_from_low_stock boolean NOT NULL DEFAULT false,
  track_stock boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zane_medications_user_idx ON public.zane_medications (user_id);

CREATE TABLE IF NOT EXISTS public.zane_medication_plan_items (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  medication_plan_id text NOT NULL,
  medication_id text NOT NULL REFERENCES public.zane_medications(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (medication_id, medication_plan_id)
);
CREATE INDEX IF NOT EXISTS zane_medication_plan_items_user_idx ON public.zane_medication_plan_items (user_id);
CREATE INDEX IF NOT EXISTS zane_medication_plan_items_plan_idx ON public.zane_medication_plan_items (medication_plan_id);
CREATE INDEX IF NOT EXISTS zane_medication_plan_items_med_idx ON public.zane_medication_plan_items (medication_id);

CREATE TABLE IF NOT EXISTS public.zane_medication_schedule_slots (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  medication_id text NOT NULL REFERENCES public.zane_medications(id) ON DELETE CASCADE,
  medication_plan_id text,
  weekdays integer[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  hour integer NOT NULL DEFAULT 8,
  dose_qty numeric NOT NULL,
  interval_days integer,
  start_date date,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zane_medication_schedule_slots_user_idx ON public.zane_medication_schedule_slots (user_id);
CREATE INDEX IF NOT EXISTS zane_medication_schedule_slots_med_idx ON public.zane_medication_schedule_slots (medication_id);

CREATE TABLE IF NOT EXISTS public.zane_medication_logs (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  medication_id text REFERENCES public.zane_medications(id) ON DELETE SET NULL,
  medication_name text NOT NULL,
  date text NOT NULL,
  time text NOT NULL,
  dose_qty numeric NOT NULL,
  planned boolean NOT NULL DEFAULT false,
  skipped boolean NOT NULL DEFAULT false,
  schedule_slot_id text REFERENCES public.zane_medication_schedule_slots(id) ON DELETE SET NULL,
  reminder_sent_at timestamptz,
  reminder_count integer NOT NULL DEFAULT 0,
  snoozed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zane_medication_logs_user_date ON public.zane_medication_logs (user_id, date DESC, time DESC);

CREATE TABLE IF NOT EXISTS public.zane_medication_pillbox_checks (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date text NOT NULL,
  schedule_slot_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zane_medication_pillbox_checks_user_idx ON public.zane_medication_pillbox_checks (user_id, date);

ALTER TABLE public.zane_user_settings
  ADD COLUMN IF NOT EXISTS meds_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS medication_reminder_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pillbox_slots jsonb;

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['zane_medication_plans','zane_medications','zane_medication_plan_items','zane_medication_schedule_slots','zane_medication_logs','zane_medication_pillbox_checks'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='zane_medication_plans' AND policyname='own medication plans') THEN
    CREATE POLICY "own medication plans" ON public.zane_medication_plans FOR ALL TO public USING ((select auth.uid())=user_id) WITH CHECK ((select auth.uid())=user_id);
    CREATE POLICY "coach can read client medication plans" ON public.zane_medication_plans FOR SELECT TO public USING (zane_is_coach_of(user_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='zane_medications' AND policyname='own medications') THEN
    CREATE POLICY "own medications" ON public.zane_medications FOR ALL TO public USING ((select auth.uid())=user_id) WITH CHECK ((select auth.uid())=user_id);
    CREATE POLICY "coach can read client medications" ON public.zane_medications FOR SELECT TO public USING (zane_is_coach_of(user_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='zane_medication_plan_items' AND policyname='own medication plan items') THEN
    CREATE POLICY "own medication plan items" ON public.zane_medication_plan_items FOR ALL TO public USING ((select auth.uid())=user_id) WITH CHECK ((select auth.uid())=user_id);
    CREATE POLICY "coach can read client medication plan items" ON public.zane_medication_plan_items FOR SELECT TO public USING (zane_is_coach_of(user_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='zane_medication_schedule_slots' AND policyname='own medication schedule slots') THEN
    CREATE POLICY "own medication schedule slots" ON public.zane_medication_schedule_slots FOR ALL TO public USING ((select auth.uid())=user_id) WITH CHECK ((select auth.uid())=user_id);
    CREATE POLICY "coach can read client medication schedule slots" ON public.zane_medication_schedule_slots FOR SELECT TO public USING (zane_is_coach_of(user_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='zane_medication_logs' AND policyname='own medication logs') THEN
    CREATE POLICY "own medication logs" ON public.zane_medication_logs FOR ALL TO public USING ((select auth.uid())=user_id) WITH CHECK ((select auth.uid())=user_id);
    CREATE POLICY "coach can read client medication logs" ON public.zane_medication_logs FOR SELECT TO public USING (zane_is_coach_of(user_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='zane_medication_pillbox_checks' AND policyname='zane_medication_pillbox_checks_own') THEN
    CREATE POLICY "zane_medication_pillbox_checks_own" ON public.zane_medication_pillbox_checks FOR ALL USING ((select auth.uid())=user_id) WITH CHECK ((select auth.uid())=user_id);
  END IF;
END
$rls$;
