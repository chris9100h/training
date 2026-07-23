-- Recipe sharing via link (share button in the Food Tracker's Recipes tab).
--
-- zane_recipe_shares: one row per shared recipe, keyed by an unguessable
-- token that doubles as the deep link (.../?share=<token>). The recipe
-- content is a jsonb SNAPSHOT taken when the share is (re)created: the link
-- keeps working even if the sharer later edits or deletes the source recipe,
-- and never leaks later edits. Re-sharing the same recipe refreshes the
-- snapshot and returns the SAME token (upsert on user_id+recipe_id), so
-- repeated shares of one recipe never pile up rows.
--
-- Access model: RLS is enabled with NO policies, so clients can never reach
-- the table directly. The only doors are the two SECURITY DEFINER RPCs below:
--   create_recipe_share(recipe_id, recipe) -> token     (sharer)
--   get_recipe_share(token)                -> snapshot  (recipient)
-- Both are granted to authenticated only, NOT anon: recipients need an
-- account to adopt a recipe anyway, and this keeps the anon-callable surface
-- at zero (see docs/database.md "Grant-Fallen"). The token itself is the
-- authorization to read that one snapshot; get_recipe_share deliberately has
-- no owner check.

CREATE TABLE public.zane_recipe_shares (
  token       text PRIMARY KEY,          -- 32 hex chars from gen_random_uuid()
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipe_id   text NOT NULL,             -- sharer's zane_food_recipes.id; no FK on purpose, the share outlives the recipe
  recipe      jsonb NOT NULL,            -- { name, portions, items: [...] } snapshot
  created_at  timestamptz NOT NULL DEFAULT now()  -- bumped on re-share
);

CREATE UNIQUE INDEX zane_recipe_shares_user_recipe ON public.zane_recipe_shares (user_id, recipe_id);

ALTER TABLE zane_recipe_shares ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: all access goes through the RPCs below.

CREATE OR REPLACE FUNCTION public.create_recipe_share(p_recipe_id text, p_recipe jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_token text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_recipe_id IS NULL OR btrim(p_recipe_id) = '' THEN RAISE EXCEPTION 'Missing recipe id'; END IF;
  IF p_recipe IS NULL OR jsonb_typeof(p_recipe) <> 'object'
     OR jsonb_typeof(p_recipe->'items') <> 'array'
     OR COALESCE(btrim(p_recipe->>'name'), '') = '' THEN
    RAISE EXCEPTION 'Invalid recipe';
  END IF;
  IF length(p_recipe::text) > 20000 THEN RAISE EXCEPTION 'Recipe too large'; END IF;

  INSERT INTO zane_recipe_shares (token, user_id, recipe_id, recipe)
  VALUES (replace(gen_random_uuid()::text, '-', ''), v_uid, p_recipe_id, p_recipe)
  ON CONFLICT (user_id, recipe_id)
  DO UPDATE SET recipe = EXCLUDED.recipe, created_at = now()
  RETURNING token INTO v_token;

  RETURN v_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_recipe_share(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_recipe_share(text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_recipe_share(p_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'recipe',    s.recipe,
    'sharedBy',  COALESCE(p.name, 'A Zane user'),
    'createdAt', s.created_at
  )
  FROM zane_recipe_shares s
  LEFT JOIN zane_profiles p ON p.id = s.user_id
  WHERE s.token = p_token;
$$;

REVOKE EXECUTE ON FUNCTION public.get_recipe_share(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recipe_share(text) TO authenticated;
