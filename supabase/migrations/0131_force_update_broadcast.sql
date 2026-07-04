-- Lets the admin push the "New version available" banner to every
-- connected client without needing an actual sw.js cache-version bump (per
-- CLAUDE.md, bumping the SW cache is a deliberate, infrequent action, so
-- most day-to-day deploys ship with no bump and no banner). Client-side,
-- app.jsx's checkSwUpdate polls get_force_update_nonce() alongside its
-- existing sw.js text-version check, comparing against a separate
-- localStorage baseline the same way the sw-version check does (first
-- sighting = baseline, no banner) so a brand-new device never sees a false
-- "update available" the moment it installs the freshest possible code.
-- Clicking Update always still results in a genuinely fresh reload via
-- LB.clearCachesAndReload regardless of whether a real new SW exists.

ALTER TABLE public.zane_app_config ADD COLUMN force_update_nonce text;

CREATE OR REPLACE FUNCTION public.get_force_update_nonce()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT force_update_nonce FROM zane_app_config WHERE id = 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_force_update_nonce() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_force_update_nonce() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_force_update()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'office@btc-prime.biz' LIMIT 1;
  IF auth.uid() IS NULL OR auth.uid() <> v_admin_id THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  INSERT INTO zane_app_config (id, force_update_nonce)
  VALUES (1, gen_random_uuid()::text)
  ON CONFLICT (id) DO UPDATE SET force_update_nonce = EXCLUDED.force_update_nonce;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_force_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_force_update() TO authenticated;
