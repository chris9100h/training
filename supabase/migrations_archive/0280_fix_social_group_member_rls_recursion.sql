-- Migration 0280: avoid self-referential RLS evaluation for social groups.
-- The group and membership policies must not query their own table directly.

CREATE OR REPLACE FUNCTION public.social_group_visible(p_group_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_group_id IS NOT NULL
    AND p_user_id IS NOT NULL
    AND p_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM zane_social_group_members own_member
      WHERE own_member.group_id = p_group_id
        AND own_member.user_id = p_user_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM zane_social_group_members other_member
      JOIN zane_social_blocks b
        ON (b.blocker_id = p_user_id AND b.blocked_id = other_member.user_id)
        OR (b.blocker_id = other_member.user_id AND b.blocked_id = p_user_id)
      WHERE other_member.group_id = p_group_id
        AND other_member.user_id <> p_user_id
    );
$function$;

REVOKE EXECUTE ON FUNCTION public.social_group_visible(uuid, uuid) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "social group members read" ON public.zane_social_groups;
CREATE POLICY "social group members read" ON public.zane_social_groups FOR SELECT TO authenticated USING (
  public.social_group_visible(id, (select auth.uid()))
);

DROP POLICY IF EXISTS "social membership read" ON public.zane_social_group_members;
CREATE POLICY "social membership read" ON public.zane_social_group_members FOR SELECT TO authenticated USING (
  public.social_group_visible(group_id, (select auth.uid()))
);
