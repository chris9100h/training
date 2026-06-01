ALTER TABLE public.zane_schedules ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
