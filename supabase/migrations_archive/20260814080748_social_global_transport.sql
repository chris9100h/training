-- Replace the per-email Broadcast canary with one reversible global transport.
-- The current production rollout is already fully on Broadcast, so existing
-- config rows and future singleton rows default to Broadcast.

ALTER TABLE public.zane_app_config
  ADD COLUMN IF NOT EXISTS social_transport text NOT NULL DEFAULT 'broadcast';

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.zane_app_config'::regclass
      AND conname = 'zane_app_config_social_transport_check'
  ) THEN
    ALTER TABLE public.zane_app_config
      ADD CONSTRAINT zane_app_config_social_transport_check
      CHECK (social_transport IN ('legacy', 'broadcast'));
  END IF;
END;
$constraint$;

INSERT INTO public.zane_app_config (id, social_transport)
VALUES (1, 'broadcast')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_runtime_config()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_config public.zane_app_config%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_config
  FROM public.zane_app_config
  WHERE id = 1;

  RETURN jsonb_build_object(
    'forceUpdateNonce', v_config.force_update_nonce,
    'socialMode', COALESCE(v_config.social_mode, 'normal'),
    'socialTransport', COALESCE(v_config.social_transport, 'broadcast')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_social_transport(p_transport text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_transport text := lower(trim(COALESCE(p_transport, '')));
BEGIN
  IF lower(COALESCE((SELECT auth.email()), '')) <> 'office@btc-prime.biz' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF v_transport NOT IN ('legacy', 'broadcast') THEN
    RAISE EXCEPTION 'Invalid social transport';
  END IF;

  INSERT INTO public.zane_app_config (id, social_transport)
  VALUES (1, v_transport)
  ON CONFLICT (id) DO UPDATE
  SET social_transport = EXCLUDED.social_transport;

  RETURN v_transport;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_runtime_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_runtime_config() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_social_transport(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_social_transport(text) TO authenticated;
