-- Allow immutable training-plan snapshots to target a whole group.
-- Group membership controls visibility; each member gets an independent
-- import marker so one person's import never hides the share for everyone.

ALTER TABLE public.zane_social_plan_shares
  ALTER COLUMN recipient_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.zane_social_groups(id) ON DELETE CASCADE;

ALTER TABLE public.zane_social_plan_shares
  DROP CONSTRAINT IF EXISTS zane_social_plan_shares_not_self,
  ADD CONSTRAINT zane_social_plan_shares_target_check CHECK (
    (recipient_id IS NOT NULL AND group_id IS NULL)
    OR (recipient_id IS NULL AND group_id IS NOT NULL)
  );

CREATE TABLE public.zane_social_plan_share_imports (
  share_id uuid NOT NULL REFERENCES public.zane_social_plan_shares(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (share_id, user_id)
);

CREATE OR REPLACE FUNCTION public.social_create_group_plan_share(p_group_id uuid, p_plan_name text, p_snapshot jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_group_id IS NULL THEN RAISE EXCEPTION 'Invalid group'; END IF;
  IF char_length(trim(coalesce(p_plan_name, ''))) = 0 THEN RAISE EXCEPTION 'Plan name required'; END IF;
  IF NOT public.social_is_group_member(p_group_id, auth.uid()) THEN RAISE EXCEPTION 'Group members only'; END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' OR octet_length(p_snapshot::text) > 100000 THEN RAISE EXCEPTION 'Invalid plan snapshot'; END IF;
  INSERT INTO zane_social_plan_shares (sender_id, group_id, plan_name, snapshot)
  VALUES (auth.uid(), p_group_id, trim(p_plan_name), p_snapshot)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_mark_plan_imported(p_share_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM zane_social_plan_shares s
    WHERE s.id = p_share_id
      AND (s.recipient_id = v_uid OR (s.group_id IS NOT NULL AND public.social_is_group_member(s.group_id, v_uid)))
  ) THEN RAISE EXCEPTION 'Plan share not found'; END IF;
  INSERT INTO zane_social_plan_share_imports (share_id, user_id)
  SELECT s.id, v_uid
  FROM zane_social_plan_shares s
  WHERE s.id = p_share_id
    AND (s.recipient_id = v_uid OR (s.group_id IS NOT NULL AND public.social_is_group_member(s.group_id, v_uid)))
  ON CONFLICT (share_id, user_id) DO NOTHING;
  UPDATE zane_social_plan_shares
  SET imported_at = coalesce(imported_at, now())
  WHERE id = p_share_id AND recipient_id = v_uid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.social_delete_plan_share(p_share_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  DELETE FROM zane_social_plan_shares
  WHERE id = p_share_id
    AND (sender_id = v_uid OR (group_id IS NULL AND recipient_id = v_uid));
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan share not found'; END IF;
END;
$function$;

ALTER TABLE public.zane_social_plan_share_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "social plan share read" ON public.zane_social_plan_shares;
CREATE POLICY "social plan share read" ON public.zane_social_plan_shares FOR SELECT TO authenticated USING (
  sender_id = (select auth.uid())
  OR recipient_id = (select auth.uid())
  OR (group_id IS NOT NULL AND public.social_is_group_member(group_id, (select auth.uid())))
);

CREATE POLICY "social plan share imports read" ON public.zane_social_plan_share_imports FOR SELECT TO authenticated
USING (user_id = (select auth.uid()));

GRANT SELECT ON public.zane_social_plan_share_imports TO authenticated;
REVOKE ALL ON public.zane_social_plan_share_imports FROM anon;

REVOKE EXECUTE ON FUNCTION public.social_create_group_plan_share(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_create_group_plan_share(uuid, text, jsonb) TO authenticated;
