-- Security hardening (audit round 2)

-- 1) zane_pushover_active: enable RLS with no policies — the table is a
--    service-role-only nonce store for the pushover edge function. Without
--    RLS, PostgREST exposed it to anyone holding the public anon key
--    (read AND write), allowing cross-user push-cancellation tampering.
ALTER TABLE public.zane_pushover_active ENABLE ROW LEVEL SECURITY;

-- 2) Pin search_path on all functions flagged by the Supabase linter
--    ("Function Search Path Mutable"). Functions without a pinned
--    search_path can be redirected to attacker-created shadow objects;
--    for SECURITY DEFINER functions those run with elevated rights.
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.invite_client(p_email text) SET search_path = public;
ALTER FUNCTION public.get_coaching_clients() SET search_path = public;
ALTER FUNCTION public.sync_sets_batch(p_sets jsonb) SET search_path = public;
ALTER FUNCTION public.enable_self_coaching() SET search_path = public;
ALTER FUNCTION public.get_coach_info() SET search_path = public;
ALTER FUNCTION public.zane_is_coach_of(p_client_id uuid) SET search_path = public;
ALTER FUNCTION public.find_user_by_email(p_email text) SET search_path = public;
ALTER FUNCTION public.respond_to_coaching_invite(p_coaching_id text, p_accept boolean) SET search_path = public;

-- 3) zane_checkins: the client write policy only verified row ownership
--    (client_id = auth.uid()) but not membership in the referenced coaching
--    relationship — a user knowing a foreign coaching_id could inject
--    check-ins into someone else's coaching thread. Require membership.
DROP POLICY IF EXISTS "checkins_client" ON public.zane_checkins;
CREATE POLICY "checkins_client" ON public.zane_checkins
  FOR ALL TO authenticated
  USING (client_id = auth.uid())
  WITH CHECK (
    client_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM zane_coaching c
      WHERE c.id = coaching_id AND c.client_id = auth.uid()
    )
  );
