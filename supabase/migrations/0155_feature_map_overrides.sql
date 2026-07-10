-- 0155_feature_map_overrides.sql
-- Feature map moves to the "versioned catalog" model. The master content now
-- lives in the versioned file src/feature-map-db.js (window.FEATURE_MAP) and is
-- what everyone, and the future public no-login page, renders. This table is
-- downgraded from "content" to the ADMIN's private curation layer: hide / edit /
-- add / reorder, saved as overrides keyed by the catalog card id, previewed in
-- the admin screen and baked back into the catalog at publish time.
--
-- Admin-only (read and write). The 156 seed rows from 0154 are dropped: that
-- content is now the catalog file, so overrides start empty.

DROP TABLE IF EXISTS public.zane_feature_map CASCADE;  -- content relocated to the code catalog

CREATE TABLE public.zane_feature_map (
  card_id    text        PRIMARY KEY,   -- catalog card id, or a custom slug for an admin-added card
  hidden     boolean     NOT NULL DEFAULT false,
  is_custom  boolean     NOT NULL DEFAULT false,
  cat        text,        -- override values; null = inherit the catalog card. Full content for custom cards.
  name       text,
  role       text        CHECK (role IS NULL OR role IN ('user','coach','both')),
  summary    text,
  actions    jsonb,
  sort       int,         -- override order within category; null = catalog order
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.zane_feature_map ENABLE ROW LEVEL SECURITY;

-- Admin-only curation layer: nobody else reads or writes it. Regular users and
-- the public page never touch this table, they render the catalog file.
CREATE POLICY "feature_map_admin_all" ON public.zane_feature_map
  FOR ALL TO authenticated
  USING ((select auth.email()) = 'office@btc-prime.biz')
  WITH CHECK ((select auth.email()) = 'office@btc-prime.biz');
