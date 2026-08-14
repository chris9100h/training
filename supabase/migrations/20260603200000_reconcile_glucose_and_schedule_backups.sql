-- Migrations 0101/0102 and 0114 were applied manually.
CREATE TABLE IF NOT EXISTS public.zane_glucose_logs (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  date text NOT NULL,
  time text NOT NULL,
  value_mmol numeric NOT NULL,
  context text NOT NULL DEFAULT 'other',
  note text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zane_glucose_logs_user_date
  ON public.zane_glucose_logs (user_id, date DESC, time DESC);
ALTER TABLE public.zane_glucose_logs ENABLE ROW LEVEL SECURITY;
DO $policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'zane_glucose_logs' AND policyname = 'Users manage own glucose logs') THEN
    CREATE POLICY "Users manage own glucose logs" ON public.zane_glucose_logs FOR ALL
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'zane_glucose_logs' AND policyname = 'coaches read client glucose logs') THEN
    CREATE POLICY "coaches read client glucose logs" ON public.zane_glucose_logs FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.zane_coaching zc WHERE zc.client_id = user_id
        AND zc.coach_id = auth.uid() AND zc.coach_id <> zc.client_id AND zc.status = 'active'));
  END IF;
END
$policy$;

ALTER TABLE public.zane_user_settings ADD COLUMN IF NOT EXISTS glucose_unit text DEFAULT 'mmol';

CREATE TABLE IF NOT EXISTS public.zane_schedule_backups (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  schedule_id text NOT NULL,
  schedule_name text NOT NULL,
  days jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.zane_schedule_backups ENABLE ROW LEVEL SECURITY;
DO $policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'zane_schedule_backups' AND policyname = 'own backups') THEN
    CREATE POLICY "own backups" ON public.zane_schedule_backups FOR ALL
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END
$policy$;
