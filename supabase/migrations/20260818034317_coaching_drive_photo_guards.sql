-- Bind staged images to the exact client/check-in relationship and enforce
-- the eight-photo cap under a per-check-in advisory lock. RLS alone cannot
-- compare a caller-supplied checkin_id to the coaching_id/client_id pair.

CREATE OR REPLACE FUNCTION public.coaching_drive_photo_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_client uuid; v_coaching text; v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.checkin_id, 732491));
  SELECT client_id, coaching_id INTO v_client, v_coaching
  FROM public.zane_checkins WHERE id = NEW.checkin_id;
  IF v_client IS NULL OR v_coaching IS DISTINCT FROM NEW.coaching_id OR v_client IS DISTINCT FROM NEW.client_id THEN
    RAISE EXCEPTION 'photo is not attached to this check-in';
  END IF;
  SELECT count(*) INTO v_count FROM public.zane_coaching_drive_photos
  WHERE checkin_id = NEW.checkin_id AND status <> 'failed';
  IF v_count >= 8 THEN RAISE EXCEPTION 'a check-in can contain at most eight photos'; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.coaching_drive_photo_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS coaching_drive_photo_guard ON public.zane_coaching_drive_photos;
CREATE TRIGGER coaching_drive_photo_guard
  BEFORE INSERT ON public.zane_coaching_drive_photos
  FOR EACH ROW EXECUTE FUNCTION public.coaching_drive_photo_guard();

DROP POLICY IF EXISTS coaching_drive_photo_insert ON public.zane_coaching_drive_photos;
CREATE POLICY coaching_drive_photo_insert ON public.zane_coaching_drive_photos
  FOR INSERT TO authenticated WITH CHECK (
    client_id = (select auth.uid()) AND EXISTS (
      SELECT 1 FROM public.zane_coaching c
      JOIN public.zane_checkins ci ON ci.coaching_id = c.id
      WHERE c.id = coaching_id AND ci.id = checkin_id AND ci.client_id = (select auth.uid())
        AND c.client_id = (select auth.uid()) AND c.status = 'active' AND c.id NOT LIKE 'support_%'
    )
  );
