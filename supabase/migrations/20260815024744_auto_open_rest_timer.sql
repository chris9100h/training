-- Per-user opt-in: show the rest timer sheet immediately when a rest starts.
-- Existing users keep the current, non-intrusive header-only behaviour.
ALTER TABLE public.zane_user_settings
  ADD COLUMN IF NOT EXISTS auto_open_rest_timer boolean NOT NULL DEFAULT false;
