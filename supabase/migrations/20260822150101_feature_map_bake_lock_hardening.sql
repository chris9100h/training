-- Replace the first version's table lock with a transaction-scoped advisory
-- lock. Supabase's branch migration validator runs function definitions in an
-- autocommit context where LOCK TABLE is rejected before a fresh branch can
-- finish replaying the migration chain.

CREATE OR REPLACE FUNCTION public.clear_feature_map_layers_if_unchanged(
  p_expected_draft jsonb,
  p_expected_published jsonb
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_expected_draft jsonb;
  v_expected_published jsonb;
  v_actual_draft jsonb;
  v_actual_published jsonb;
BEGIN
  IF jsonb_typeof(p_expected_draft) <> 'array'
     OR jsonb_typeof(p_expected_published) <> 'array'
  THEN
    RAISE EXCEPTION 'feature map snapshots must be JSON arrays';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('zane_feature_map_bake', 732493)
  );

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'card_id', expected.card_id,
        'hidden', expected.hidden,
        'is_custom', expected.is_custom,
        'cat', expected.cat,
        'name', expected.name,
        'role', expected.role,
        'summary', expected.summary,
        'actions', expected.actions,
        'sort', expected.sort
      )
      ORDER BY expected.card_id
    ),
    '[]'::jsonb
  )
  INTO v_expected_draft
  FROM jsonb_to_recordset(p_expected_draft) AS expected(
    card_id text,
    hidden boolean,
    is_custom boolean,
    cat text,
    name text,
    role text,
    summary text,
    actions jsonb,
    sort integer
  );

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'card_id', expected.card_id,
        'hidden', expected.hidden,
        'is_custom', expected.is_custom,
        'cat', expected.cat,
        'name', expected.name,
        'role', expected.role,
        'summary', expected.summary,
        'actions', expected.actions,
        'sort', expected.sort
      )
      ORDER BY expected.card_id
    ),
    '[]'::jsonb
  )
  INTO v_expected_published
  FROM jsonb_to_recordset(p_expected_published) AS expected(
    card_id text,
    hidden boolean,
    is_custom boolean,
    cat text,
    name text,
    role text,
    summary text,
    actions jsonb,
    sort integer
  );

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'card_id', current.card_id,
        'hidden', current.hidden,
        'is_custom', current.is_custom,
        'cat', current.cat,
        'name', current.name,
        'role', current.role,
        'summary', current.summary,
        'actions', current.actions,
        'sort', current.sort
      )
      ORDER BY current.card_id
    ),
    '[]'::jsonb
  )
  INTO v_actual_draft
  FROM public.zane_feature_map AS current;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'card_id', current.card_id,
        'hidden', current.hidden,
        'is_custom', current.is_custom,
        'cat', current.cat,
        'name', current.name,
        'role', current.role,
        'summary', current.summary,
        'actions', current.actions,
        'sort', current.sort
      )
      ORDER BY current.card_id
    ),
    '[]'::jsonb
  )
  INTO v_actual_published
  FROM public.zane_feature_map_published AS current;

  IF v_actual_draft IS DISTINCT FROM v_expected_draft
     OR v_actual_published IS DISTINCT FROM v_expected_published
  THEN
    RETURN false;
  END IF;

  DELETE FROM public.zane_feature_map;
  DELETE FROM public.zane_feature_map_published;
  RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.clear_feature_map_layers_if_unchanged(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_feature_map_layers_if_unchanged(jsonb, jsonb)
  TO service_role;
