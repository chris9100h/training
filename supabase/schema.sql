-- Logbook – Supabase Schema
-- Run this in the Supabase SQL editor to set up a fresh project.

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.zane_profiles (
  id   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.zane_exercises (
  id      text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name    text NOT NULL DEFAULT '',
  tags    jsonb NOT NULL DEFAULT '[]',
  note    text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.zane_schedules (
  id      text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name    text NOT NULL DEFAULT '',
  days    jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS public.zane_sessions (
  id          text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  schedule_id text,
  day_id      text,
  day_name    text,
  date        timestamptz,
  started_at  timestamptz,
  ended       timestamptz,
  entries     jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS public.zane_user_settings (
  user_id                 uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active_schedule_id      text,
  cycle_index             integer NOT NULL DEFAULT 0,
  cycle_start_date        text,
  last_advanced_date      text,
  unit                    text NOT NULL DEFAULT 'kg',
  rest_default            integer NOT NULL DEFAULT 120,
  in_progress_session_id  text
);

-- ── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE public.zane_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_exercises     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_schedules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zane_user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own profile"   ON public.zane_profiles      FOR ALL USING (auth.uid() = id);
CREATE POLICY "own exercises" ON public.zane_exercises     FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own schedules" ON public.zane_schedules     FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own sessions"  ON public.zane_sessions      FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own settings"  ON public.zane_user_settings FOR ALL USING (auth.uid() = user_id);

-- ── Pushover cancellation token ─────────────────────────────────────────────
-- Single-row table; the edge function uses the service role key to read/write it.
-- No RLS needed — never exposed to clients.

CREATE TABLE IF NOT EXISTS public.zane_pushover_active (
  id    text PRIMARY KEY DEFAULT 'singleton',
  nonce text NOT NULL DEFAULT ''
);

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
