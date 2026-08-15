-- The singleton config row was created in the SQL editor before the recorded
-- force-update migration.  Later migrations add its runtime columns in order.
CREATE TABLE IF NOT EXISTS public.zane_app_config (
  id integer PRIMARY KEY DEFAULT 1,
  CONSTRAINT zane_app_config_singleton CHECK (id = 1)
);

INSERT INTO public.zane_app_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.zane_app_config ENABLE ROW LEVEL SECURITY;
