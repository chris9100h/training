-- Migrations 0215-0217: the pre-shopping-key shape.  Production migration
-- 0227 intentionally transforms this exact unique constraint into shopping_key.
CREATE TABLE IF NOT EXISTS public.zane_food_shopping_prefs (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_id text NOT NULL REFERENCES public.zane_foods(id) ON DELETE CASCADE,
  name_override text,
  excluded boolean NOT NULL DEFAULT false,
  package_size_g numeric,
  stock_baseline_g numeric,
  stock_set_at timestamptz,
  food_name text,
  brand text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, food_id)
);
CREATE INDEX IF NOT EXISTS zane_food_shopping_prefs_user_idx ON public.zane_food_shopping_prefs (user_id);
ALTER TABLE public.zane_food_shopping_prefs ENABLE ROW LEVEL SECURITY;
DO $policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='zane_food_shopping_prefs' AND policyname='zane_food_shopping_prefs_own') THEN
    CREATE POLICY "zane_food_shopping_prefs_own" ON public.zane_food_shopping_prefs FOR ALL
      USING ((select auth.uid())=user_id) WITH CHECK ((select auth.uid())=user_id);
  END IF;
END
$policy$;
