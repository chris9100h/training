-- Logbook – Supabase Schema (current as of 2026-05-27)
-- Full snapshot including all migrations. Use this to set up a fresh project.

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.zane_profiles (
  id   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.zane_exercises (
  id         text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL DEFAULT '',
  tags       text[] NOT NULL DEFAULT '{}',
  note       text NOT NULL DEFAULT '',
  category   text,
  unilateral boolean NOT NULL DEFAULT false,
  equipment  text
);

CREATE TABLE IF NOT EXISTS public.zane_schedules (
  id      text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name    text NOT NULL DEFAULT '',
  days    jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS public.zane_sessions (
  id               text PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  schedule_id      text,
  day_id           text,
  day_name         text,
  date             timestamptz,
  started_at       timestamptz,
  ended            timestamptz,
  entries          jsonb NOT NULL DEFAULT '[]',
  duration_minutes integer
);

CREATE TABLE IF NOT EXISTS public.zane_user_settings (
  user_id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active_schedule_id     text,
  cycle_index            integer NOT NULL DEFAULT 0,
  cycle_start_date       text,
  last_advanced_date     date,
  week_plan_start_date   date,
  in_progress_session_id text,
  unit                   text NOT NULL DEFAULT 'kg',
  rest_default           integer NOT NULL DEFAULT 120,
  rest_big               integer DEFAULT 180,
  rest_medium            integer DEFAULT 120,
  rest_small             integer DEFAULT 90,
  push_enabled           boolean DEFAULT false,
  pushover_user_key      text,
  cycle_week_view        boolean DEFAULT false,
  accent_color           text DEFAULT 'gold',
  dark_mode              text DEFAULT 'dark',
  tempo_enabled          boolean DEFAULT false,
  tempo_eccentric        numeric DEFAULT 4,
  tempo_concentric       numeric DEFAULT 1,
  smart_progression      boolean DEFAULT false,
  progression_range_top  integer DEFAULT 4,
  equipment_config       jsonb
);

-- Pushover cancellation token — no RLS, never exposed to clients directly.
CREATE TABLE IF NOT EXISTS public.zane_pushover_active (
  id    text PRIMARY KEY DEFAULT 'singleton',
  nonce text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.zane_feature_grants (
  feature text NOT NULL,
  email   text NOT NULL,
  PRIMARY KEY (feature, email)
);

CREATE TABLE IF NOT EXISTS public.zane_skips (
  id         text PRIMARY KEY,
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  date       text NOT NULL,
  day_id     text,
  day_name   text,
  skip_reason text,
  skipped_at  timestamptz DEFAULT now()
);

-- ── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE public.zane_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_exercises     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_schedules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_feature_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_skips         ENABLE ROW LEVEL SECURITY;
-- zane_pushover_active: no RLS by design (service role only)

CREATE POLICY "own profile"        ON public.zane_profiles      FOR ALL USING (auth.uid() = id);
CREATE POLICY "own exercises"      ON public.zane_exercises     FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own schedules"      ON public.zane_schedules     FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own sessions"       ON public.zane_sessions      FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own settings"       ON public.zane_user_settings FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "read feature grants" ON public.zane_feature_grants FOR SELECT USING (true);
CREATE POLICY "own skips"          ON public.zane_skips         FOR ALL USING (auth.uid() = user_id);

-- ── Trigger: create user_settings row on signup ──────────────────────────────

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.zane_user_settings (user_id) VALUES (new.id)
  ON CONFLICT DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_new_user();
