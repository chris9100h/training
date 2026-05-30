ALTER TABLE public.zane_user_settings
  ADD COLUMN IF NOT EXISTS show_warmup_in_summary boolean NOT NULL DEFAULT true;
