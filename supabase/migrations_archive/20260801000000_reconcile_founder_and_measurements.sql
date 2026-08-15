-- The late July/August SQL-editor changes that are prerequisites for the
-- recorded founding-seat, bodyweight and measurement RPC migrations.
ALTER TABLE public.zane_profiles
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS tier_granted_at timestamptz,
  ADD COLUMN IF NOT EXISTS x_handle text,
  ADD COLUMN IF NOT EXISTS x_handle_public boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS x_handle_prompt_opted_out boolean NOT NULL DEFAULT false;

ALTER TABLE public.zane_app_config
  ADD COLUMN IF NOT EXISTS lifetime_seats_total integer NOT NULL DEFAULT 75;

ALTER TABLE public.zane_exercises
  ADD COLUMN IF NOT EXISTS pull_bodyweight boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS log_mode text;

ALTER TABLE public.zane_sessions
  ADD COLUMN IF NOT EXISTS completed_server_at timestamptz;

ALTER TABLE public.zane_daily_logs
  ADD COLUMN IF NOT EXISTS waist_cm numeric,
  ADD COLUMN IF NOT EXISTS hips_cm numeric,
  ADD COLUMN IF NOT EXISTS chest_cm numeric,
  ADD COLUMN IF NOT EXISTS arm_cm numeric,
  ADD COLUMN IF NOT EXISTS thigh_cm numeric,
  ADD COLUMN IF NOT EXISTS calf_cm numeric,
  ADD COLUMN IF NOT EXISTS body_fat_pct numeric,
  ADD COLUMN IF NOT EXISTS fiber integer,
  ADD COLUMN IF NOT EXISTS off_plan_note text,
  ADD COLUMN IF NOT EXISTS meal_of_choice boolean,
  ADD COLUMN IF NOT EXISTS meal_of_choice_hour smallint,
  ADD COLUMN IF NOT EXISTS daily_coach_fields jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
