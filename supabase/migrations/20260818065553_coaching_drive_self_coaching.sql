-- Give self-coaching the same Google Drive/Sheets archive as external
-- coaching. The relationship is deliberately allowed when coach_id = client_id;
-- support rows remain excluded by their id prefix.

CREATE OR REPLACE FUNCTION public.enqueue_coaching_drive_export()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_coach uuid; v_enabled boolean;
BEGIN
  SELECT c.coach_id, dc.archive_enabled INTO v_coach, v_enabled
  FROM public.zane_coaching c
  LEFT JOIN public.zane_coaching_drive_connections dc ON dc.coach_id = c.coach_id
  WHERE c.id = NEW.coaching_id AND c.client_id = NEW.client_id
    AND c.status = 'active' AND c.id NOT LIKE 'support_%';
  IF v_coach IS NULL OR coalesce(v_enabled, false) = false THEN
    UPDATE public.zane_coaching_drive_exports
    SET status = 'failed', next_attempt_at = '9999-12-31T00:00:00Z',
        last_error = 'Coaching relationship or Drive archive is no longer active',
        locked_at = NULL, locked_by = NULL, updated_at = now()
    WHERE checkin_id = NEW.id AND status IN ('pending','processing','failed','needs_reauth');
    RETURN NEW;
  END IF;
  INSERT INTO public.zane_coaching_drive_exports AS existing(coach_id, client_id, coaching_id, checkin_id, week_start)
  VALUES (v_coach, NEW.client_id, NEW.coaching_id, NEW.id, NEW.week_start)
  ON CONFLICT (coach_id, checkin_id) DO UPDATE SET
    client_id = excluded.client_id, coaching_id = excluded.coaching_id,
    week_start = excluded.week_start,
    status = CASE WHEN existing.status = 'processing' THEN existing.status ELSE 'pending' END,
    next_attempt_at = CASE WHEN existing.status = 'processing' THEN existing.next_attempt_at ELSE now() END,
    last_error = NULL,
    locked_at = CASE WHEN existing.status = 'processing' THEN existing.locked_at ELSE NULL END,
    locked_by = CASE WHEN existing.status = 'processing' THEN existing.locked_by ELSE NULL END,
    updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_coaching_drive_photo_export()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_coach uuid; v_week date; v_enabled boolean;
BEGIN
  SELECT c.coach_id, ci.week_start, dc.archive_enabled
    INTO v_coach, v_week, v_enabled
  FROM public.zane_checkins ci
  JOIN public.zane_coaching c ON c.id = ci.coaching_id AND c.client_id = ci.client_id
  LEFT JOIN public.zane_coaching_drive_connections dc ON dc.coach_id = c.coach_id
  WHERE ci.id = NEW.checkin_id AND ci.coaching_id = NEW.coaching_id
    AND ci.client_id = NEW.client_id
    AND c.status = 'active' AND c.id NOT LIKE 'support_%';
  IF v_coach IS NULL OR coalesce(v_enabled, false) = false THEN RETURN NEW; END IF;
  INSERT INTO public.zane_coaching_drive_exports AS existing(coach_id, client_id, coaching_id, checkin_id, week_start)
  VALUES (v_coach, NEW.client_id, NEW.coaching_id, NEW.checkin_id, v_week)
  ON CONFLICT (coach_id, checkin_id) DO UPDATE SET
    client_id = excluded.client_id, coaching_id = excluded.coaching_id,
    week_start = excluded.week_start,
    status = CASE WHEN existing.status = 'processing' THEN existing.status ELSE 'pending' END,
    next_attempt_at = CASE WHEN existing.status = 'processing' THEN existing.next_attempt_at ELSE now() END,
    last_error = NULL,
    locked_at = CASE WHEN existing.status = 'processing' THEN existing.locked_at ELSE NULL END,
    locked_by = CASE WHEN existing.status = 'processing' THEN existing.locked_by ELSE NULL END,
    updated_at = now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_coaching_drive_export() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_coaching_drive_photo_export() FROM PUBLIC, anon, authenticated;
