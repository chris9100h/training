-- Migration 0193: RPC-only recipe share snapshots.
CREATE TABLE IF NOT EXISTS public.zane_recipe_shares (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipe_id text NOT NULL,
  recipe jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS zane_recipe_shares_user_recipe ON public.zane_recipe_shares (user_id, recipe_id);
ALTER TABLE public.zane_recipe_shares ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.create_recipe_share(p_recipe_id text, p_recipe jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_token text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_recipe_id IS NULL OR btrim(p_recipe_id) = '' THEN RAISE EXCEPTION 'Missing recipe id'; END IF;
  IF p_recipe IS NULL OR jsonb_typeof(p_recipe) <> 'object' OR jsonb_typeof(p_recipe->'items') <> 'array' OR COALESCE(btrim(p_recipe->>'name'),'') = '' THEN RAISE EXCEPTION 'Invalid recipe'; END IF;
  IF length(p_recipe::text) > 20000 THEN RAISE EXCEPTION 'Recipe too large'; END IF;
  INSERT INTO public.zane_recipe_shares(token,user_id,recipe_id,recipe)
    VALUES (replace(gen_random_uuid()::text,'-',''),v_uid,p_recipe_id,p_recipe)
    ON CONFLICT (user_id,recipe_id) DO UPDATE SET recipe=EXCLUDED.recipe,created_at=now()
    RETURNING token INTO v_token;
  RETURN v_token;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.create_recipe_share(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_recipe_share(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_recipe_share(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
  SELECT jsonb_build_object('recipe',s.recipe,'sharedBy',COALESCE(p.name,'A Zane user'),'createdAt',s.created_at)
  FROM public.zane_recipe_shares s LEFT JOIN public.zane_profiles p ON p.id=s.user_id WHERE s.token=p_token;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_recipe_share(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recipe_share(text) TO authenticated;
