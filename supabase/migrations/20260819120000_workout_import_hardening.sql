-- Historical workout imports must not look like newly completed workouts.
ALTER TABLE public.zane_sessions
  ADD COLUMN IF NOT EXISTS imported boolean NOT NULL DEFAULT false;

UPDATE public.zane_sessions
   SET imported = true,
       completed_server_at = NULL
 WHERE id LIKE 'import\_%' ESCAPE '\'
   AND imported IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.zane_sessions_stamp_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.imported THEN
    NEW.imported := true;
  ELSIF NEW.id LIKE 'import\_%' ESCAPE '\' THEN
    NEW.imported := true;
  ELSE
    NEW.imported := false;
  END IF;
  IF NEW.imported THEN
    NEW.completed_server_at := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.completed_server_at := CASE WHEN NEW.ended IS NOT NULL THEN now() ELSE NULL END;
    RETURN NEW;
  END IF;
  IF OLD.completed_server_at IS NOT NULL THEN
    NEW.completed_server_at := OLD.completed_server_at;
  ELSIF NEW.ended IS NOT NULL THEN
    NEW.completed_server_at := now();
  ELSE
    NEW.completed_server_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.zane_sessions_stamp_completion() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.grant_lifetime_if_qualified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tier      text;
  v_workouts  int;
  v_minutes   int;
  v_days      int;
  v_taken     int;
  v_total     int;
BEGIN
  IF NEW.ended IS NULL OR NEW.imported THEN
    RETURN NEW;
  END IF;
  SELECT tier INTO v_tier FROM zane_profiles WHERE id = NEW.user_id;
  IF v_tier IS NULL OR v_tier <> 'free' THEN
    RETURN NEW;
  END IF;
  SELECT COUNT(*) FILTER (WHERE ended IS NOT NULL AND NOT imported),
         COALESCE(SUM(LEAST(COALESCE(duration_minutes, 0), 120))
                  FILTER (WHERE ended IS NOT NULL AND NOT imported), 0),
         COUNT(DISTINCT date(completed_server_at)) FILTER (WHERE completed_server_at IS NOT NULL AND NOT imported)
    INTO v_workouts, v_minutes, v_days
    FROM zane_sessions
   WHERE user_id = NEW.user_id;
  IF v_workouts < 5 OR v_minutes < 150 OR v_days < 3 THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('zane_lifetime_seats'));
  SELECT COUNT(*) INTO v_taken FROM zane_profiles WHERE tier = 'lifetime';
  SELECT lifetime_seats_total INTO v_total FROM zane_app_config WHERE id = 1;
  IF v_taken >= COALESCE(v_total, 75) THEN
    RETURN NEW;
  END IF;
  UPDATE zane_profiles
     SET tier = 'lifetime', tier_granted_at = now()
   WHERE id = NEW.user_id AND tier = 'free';
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.grant_lifetime_if_qualified() FROM PUBLIC, anon, authenticated;
