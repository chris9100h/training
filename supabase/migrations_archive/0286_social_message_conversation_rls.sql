-- Migration 0286: keep message edits and deletes inside the live
-- conversation boundary, including after unfriend, leave, kick, or block.

DROP POLICY IF EXISTS "social messages edit own" ON public.zane_social_messages;
CREATE POLICY "social messages edit own" ON public.zane_social_messages
FOR UPDATE TO authenticated
USING (
  sender_id = (select auth.uid())
  AND created_at >= now() - interval '60 minutes'
  AND (
    (
      recipient_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.zane_social_friendships f
        WHERE f.status = 'accepted'
          AND ((f.requester_id = (select auth.uid()) AND f.addressee_id = recipient_id)
            OR (f.requester_id = recipient_id AND f.addressee_id = (select auth.uid())))
          AND NOT EXISTS (
            SELECT 1
            FROM public.zane_social_blocks b
            WHERE (b.blocker_id = (select auth.uid()) AND b.blocked_id = recipient_id)
               OR (b.blocker_id = recipient_id AND b.blocked_id = (select auth.uid()))
          )
      )
    )
    OR (group_id IS NOT NULL AND public.social_group_visible(group_id, (select auth.uid())))
  )
)
WITH CHECK (
  sender_id = (select auth.uid())
  AND created_at >= now() - interval '60 minutes'
  AND (
    (
      recipient_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.zane_social_friendships f
        WHERE f.status = 'accepted'
          AND ((f.requester_id = (select auth.uid()) AND f.addressee_id = recipient_id)
            OR (f.requester_id = recipient_id AND f.addressee_id = (select auth.uid())))
          AND NOT EXISTS (
            SELECT 1
            FROM public.zane_social_blocks b
            WHERE (b.blocker_id = (select auth.uid()) AND b.blocked_id = recipient_id)
               OR (b.blocker_id = recipient_id AND b.blocked_id = (select auth.uid()))
          )
      )
    )
    OR (group_id IS NOT NULL AND public.social_group_visible(group_id, (select auth.uid())))
  )
);

DROP POLICY IF EXISTS "social messages delete own" ON public.zane_social_messages;
CREATE POLICY "social messages delete own" ON public.zane_social_messages
FOR DELETE TO authenticated
USING (
  sender_id = (select auth.uid())
  AND created_at >= now() - interval '60 minutes'
  AND (
    (
      recipient_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.zane_social_friendships f
        WHERE f.status = 'accepted'
          AND ((f.requester_id = (select auth.uid()) AND f.addressee_id = recipient_id)
            OR (f.requester_id = recipient_id AND f.addressee_id = (select auth.uid())))
          AND NOT EXISTS (
            SELECT 1
            FROM public.zane_social_blocks b
            WHERE (b.blocker_id = (select auth.uid()) AND b.blocked_id = recipient_id)
               OR (b.blocker_id = recipient_id AND b.blocked_id = (select auth.uid()))
          )
      )
    )
    OR (group_id IS NOT NULL AND public.social_group_visible(group_id, (select auth.uid())))
  )
);
