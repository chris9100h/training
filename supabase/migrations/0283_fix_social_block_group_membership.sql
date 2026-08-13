-- Keep the blocker in control of groups they own. If the blocker is the
-- owner, remove the blocked user; otherwise remove the blocker from the
-- shared group. This prevents an owner from being stranded in a group whose
-- owner_id still points at them.
CREATE OR REPLACE FUNCTION public.social_block_user(p_target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_target_id IS NULL OR auth.uid() = p_target_id THEN
    RAISE EXCEPTION 'Invalid block target';
  END IF;

  INSERT INTO zane_social_blocks (blocker_id, blocked_id)
  VALUES (auth.uid(), p_target_id)
  ON CONFLICT DO NOTHING;

  DELETE FROM zane_social_friendships
  WHERE (requester_id = auth.uid() AND addressee_id = p_target_id)
     OR (requester_id = p_target_id AND addressee_id = auth.uid());

  DELETE FROM zane_social_group_members victim
  USING zane_social_groups shared_group
  WHERE victim.group_id = shared_group.id
    AND EXISTS (
      SELECT 1
      FROM zane_social_group_members actor_members
      WHERE actor_members.group_id = shared_group.id
        AND actor_members.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM zane_social_group_members target_members
      WHERE target_members.group_id = shared_group.id
        AND target_members.user_id = p_target_id
    )
    AND (
      (shared_group.owner_id = auth.uid() AND victim.user_id = p_target_id)
      OR (shared_group.owner_id <> auth.uid() AND victim.user_id = auth.uid())
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.social_block_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_block_user(uuid) TO authenticated;
