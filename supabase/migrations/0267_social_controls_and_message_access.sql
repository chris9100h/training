-- Social follow-up fixes: allow the message RLS policy to inspect blocks and
-- expose owner/participant lifecycle actions through guarded RPCs.

-- zane_social_blocks is intentionally not generally readable. The message
-- INSERT policy needs to see both directions of a block relationship, though,
-- so grant only SELECT and scope it to rows involving the current user.
GRANT SELECT ON public.zane_social_blocks TO authenticated;
CREATE POLICY "social block relationship read" ON public.zane_social_blocks
  FOR SELECT TO authenticated
  USING (blocker_id = (select auth.uid()) OR blocked_id = (select auth.uid()));

CREATE OR REPLACE FUNCTION public.social_delete_group(p_group_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  DELETE FROM zane_social_groups
  WHERE id = p_group_id AND owner_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the group owner can delete this group'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_delete_plan_share(p_share_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  DELETE FROM zane_social_plan_shares
  WHERE id = p_share_id AND (sender_id = v_uid OR recipient_id = v_uid);
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan share not found'; END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_delete_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_delete_group(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.social_delete_plan_share(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_delete_plan_share(uuid) TO authenticated;
