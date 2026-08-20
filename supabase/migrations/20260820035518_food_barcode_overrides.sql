-- Personal barcode corrections. The shared zane_foods cache remains the
-- provider snapshot; these rows let one user correct a product without
-- changing what every other user sees.
CREATE TABLE public.zane_food_barcode_overrides (
  user_id          uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source           text    NOT NULL CHECK (source IN ('off')),
  source_id        text    NOT NULL CHECK (source_id ~ '^[0-9]{8,14}$'),
  food_name        text    NOT NULL,
  brand            text,
  kcal_per_100g    numeric NOT NULL CHECK (kcal_per_100g >= 0),
  protein_per_100g numeric NOT NULL CHECK (protein_per_100g >= 0),
  carbs_per_100g   numeric NOT NULL CHECK (carbs_per_100g >= 0),
  fat_per_100g     numeric NOT NULL CHECK (fat_per_100g >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source, source_id)
);

CREATE INDEX zane_food_barcode_overrides_user_idx
  ON public.zane_food_barcode_overrides (user_id, updated_at DESC);

ALTER TABLE public.zane_food_barcode_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zane_food_barcode_overrides_own"
  ON public.zane_food_barcode_overrides FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
