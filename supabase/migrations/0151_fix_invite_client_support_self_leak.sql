-- 0151_fix_invite_client_support_self_leak.sql
-- Live bug report: a coach could not invite a user who had previously opened a
-- support chat with them. Root cause: invite_client's two duplicate-relationship
-- checks never excluded support_% (support ticket) or self_ (coach_id=client_id,
-- self-coaching) rows, even though every other coach/client-relationship RPC in
-- this codebase does (get_coach_info, get_coaching_clients, get_coach_checkin_status,
-- and the coach-read RLS policies hardened in migration 0148). Both checks reuse
-- zane_coaching for support tickets and self-coaching, which are not genuine
-- two-party coaching relationships and must not block a new invite:
--
--   1) "already has a relationship with THIS coach" check: matched a support_%
--      row whenever the inviting coach had ever handled a support chat with that
--      user, since a support row's (coach_id, client_id) has the same shape as a
--      real invite. Add the same `id NOT LIKE 'support_%'` exclusion used
--      elsewhere. (Cannot match a self_ row here: coach_id=auth.uid() and
--      client_id=v_client_id are already guaranteed distinct by the earlier
--      self-invite guard, and a self_ row requires coach_id=client_id.)
--
--   2) "this person already has an active coach" check: matched ANY active
--      self_ or support_ row for the invitee, regardless of which coach is
--      inviting. This made 55 distinct users (8 with self-coaching, 60 with an
--      open/active support ticket) un-invitable by ANY coach at all. Add
--      `coach_id <> client_id` (excludes self-coaching) and
--      `id NOT LIKE 'support_%'` (excludes support tickets).
--
-- A real, active coaching row (cch_ prefix, distinct coach/client, not support)
-- still correctly blocks a second simultaneous coach, unchanged.

CREATE OR REPLACE FUNCTION public.invite_client(p_email text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client_id uuid;
  v_id        text;
  v_existing  text;
  v_schema    jsonb;
BEGIN
  v_client_id := find_user_by_email(p_email);
  IF v_client_id IS NULL THEN
    RETURN 'ERROR:not_found';
  END IF;
  IF v_client_id = auth.uid() THEN
    RETURN 'ERROR:self';
  END IF;
  SELECT id INTO v_existing FROM zane_coaching
    WHERE coach_id = auth.uid() AND client_id = v_client_id
      AND id NOT LIKE 'support_%';
  IF FOUND THEN
    RETURN 'ERROR:exists:' || v_existing;
  END IF;
  PERFORM 1 FROM zane_coaching
    WHERE client_id = v_client_id AND status = 'active'
      AND coach_id <> client_id AND id NOT LIKE 'support_%';
  IF FOUND THEN
    RETURN 'ERROR:already_coached';
  END IF;
  SELECT default_checkin_schema INTO v_schema
    FROM zane_user_settings WHERE user_id = auth.uid();
  v_id := 'cch_' || gen_random_uuid()::text;
  INSERT INTO zane_coaching (id, coach_id, client_id, status, checkin_schema)
    VALUES (v_id, auth.uid(), v_client_id, 'pending', v_schema);
  RETURN v_id;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.invite_client(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_client(text) TO authenticated;
