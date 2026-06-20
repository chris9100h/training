ALTER TABLE public.zane_sessions
  ADD COLUMN IF NOT EXISTS is_bonus    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_freestyle boolean NOT NULL DEFAULT false;
