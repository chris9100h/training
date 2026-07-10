-- 0156_feature_map_publish.sql
-- Feature map goes live: in-app publish flow + login-free public read.
--
-- Until now the admin's curation in zane_feature_map was a private preview and
-- reached users only by baking it into the code catalog and shipping. This adds
-- a PUBLISHED layer so the admin can push curation live without a deploy:
--   - zane_feature_map            = DRAFT  (admin working copy, admin-only, unchanged)
--   - zane_feature_map_published  = PUBLISHED mirror, the layer everyone renders
--   - publish_feature_map()       = promote draft  -> published (admin, "Publish")
--   - discard_feature_map()       = reset   draft  -> published (admin, "Discard all")
--   - get_public_feature_map()    = login-free / all-user read of the published layer
--
-- Readers merge the code catalog (src/feature-map-db.js) with the published
-- overrides. The bake workflow (tools/bake-feature-map.cjs) later folds the
-- published layer back into the code catalog and clears both tables.

CREATE TABLE public.zane_feature_map_published (
  card_id    text        PRIMARY KEY,   -- catalog card id, or a custom slug for an admin-added card
  hidden     boolean     NOT NULL DEFAULT false,
  is_custom  boolean     NOT NULL DEFAULT false,
  cat        text,
  name       text,
  role       text        CHECK (role IS NULL OR role IN ('user','coach','both')),
  summary    text,
  actions    jsonb,
  sort       int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.zane_feature_map_published ENABLE ROW LEVEL SECURITY;

-- Only the admin reads the published mirror directly (to diff draft vs published
-- in the admin UI). Everyone else reads it through get_public_feature_map().
CREATE POLICY "feature_map_published_admin_all" ON public.zane_feature_map_published
  FOR ALL TO authenticated
  USING ((select auth.email()) = 'office@btc-prime.biz')
  WITH CHECK ((select auth.email()) = 'office@btc-prime.biz');

-- Promote the admin draft to the published mirror in one atomic step. Guarded to
-- the admin; SECURITY DEFINER so the swap is independent of row-level policies.
CREATE OR REPLACE FUNCTION public.publish_feature_map()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  DELETE FROM zane_feature_map_published;
  INSERT INTO zane_feature_map_published
    (card_id, hidden, is_custom, cat, name, role, summary, actions, sort, created_at, updated_at)
  SELECT card_id, hidden, is_custom, cat, name, role, summary, actions, sort, created_at, now()
  FROM zane_feature_map;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.publish_feature_map() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_feature_map() TO authenticated;

-- Reset the admin draft back to the published state ("Discard all unpublished
-- changes"). Mirror image of publish_feature_map.
CREATE OR REPLACE FUNCTION public.discard_feature_map()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.email() IS DISTINCT FROM 'office@btc-prime.biz' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  DELETE FROM zane_feature_map;
  INSERT INTO zane_feature_map
    (card_id, hidden, is_custom, cat, name, role, summary, actions, sort, created_at, updated_at)
  SELECT card_id, hidden, is_custom, cat, name, role, summary, actions, sort, created_at, now()
  FROM zane_feature_map_published;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.discard_feature_map() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discard_feature_map() TO authenticated;

-- Login-free read of the published feature map, for the public page AND regular
-- logged-in users. SECURITY DEFINER to read past the admin-only RLS. Hidden
-- CUSTOM cards are withheld (their content is not in the public code catalog, so
-- returning them would leak unreleased features); hidden flags on catalog cards
-- ARE returned so the client hides those catalog cards. This is the one feature
-- map function anon is meant to call.
CREATE OR REPLACE FUNCTION public.get_public_feature_map()
 RETURNS TABLE (card_id text, hidden boolean, is_custom boolean, cat text, name text, role text, summary text, actions jsonb, sort int)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT card_id, hidden, is_custom, cat, name, role, summary, actions, sort
  FROM zane_feature_map_published
  WHERE NOT (is_custom AND hidden);
$function$;

REVOKE EXECUTE ON FUNCTION public.get_public_feature_map() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_feature_map() TO anon, authenticated;

-- Grant verification (run after applying; see CLAUDE.md "Grant-Fallen"):
--   has_function_privilege('anon', 'public.publish_feature_map()', 'execute')    => false
--   has_function_privilege('anon', 'public.discard_feature_map()', 'execute')    => false
--   has_function_privilege('anon', 'public.get_public_feature_map()', 'execute') => true  (intended: public page)
