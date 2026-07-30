-- Migration 0226: guard triggers so ai_summary/ai_opinion can only ever be
-- set server-side (the ai-daily-summary / ai-checkin-opinion Edge Functions,
-- via the service role key), never by the row owner's own authenticated
-- session.
--
-- Both columns are already excluded from the client sync path on purpose
-- (sync_daily_logs_batch's column list and submitCheckin's upsert object
-- never mention them, see docs/database.md), so the app itself never
-- overwrites them. But "Users manage own daily logs" / "checkins_client"
-- are broad FOR ALL policies with no column-level restriction (RLS alone
-- can't express "own this row but not these two columns"), so nothing
-- actually stopped a user from issuing a direct PostgREST PATCH on their own
-- row and setting these fields to arbitrary text. Since ai_opinion is
-- coach-visible and rendered identically for client and coach, a client
-- could otherwise fabricate a fake AI verdict indistinguishable from a real
-- one.
--
-- Same pattern as the existing zane_coaching_guard_update /
-- zane_coaching_notes_guard_update triggers: RLS stays exactly as
-- permissive as it already is for every other column, a BEFORE UPDATE
-- trigger blocks changes to just the protected columns when the caller has
-- an actual end-user session. auth.uid() reliably returns NULL for the Edge
-- Functions' service-role writes (the same check the admin_* RPCs already
-- rely on elsewhere in this schema), so this only ever blocks a real user's
-- own JWT, never the service role, and never a plain INSERT of a brand new
-- row either (BEFORE UPDATE only fires on UPDATE, including the UPDATE half
-- of an INSERT ... ON CONFLICT DO UPDATE).

CREATE OR REPLACE FUNCTION public.zane_daily_logs_guard_ai_summary()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
begin
  if (select auth.uid()) is not null then
    if new.ai_summary is distinct from old.ai_summary
       or new.ai_summary_generated_at is distinct from old.ai_summary_generated_at then
      raise exception 'ai_summary is server-generated only';
    end if;
  end if;
  return new;
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.zane_daily_logs_guard_ai_summary() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zane_daily_logs_guard_ai_summary ON public.zane_daily_logs;
CREATE TRIGGER zane_daily_logs_guard_ai_summary
  BEFORE UPDATE ON public.zane_daily_logs
  FOR EACH ROW EXECUTE FUNCTION zane_daily_logs_guard_ai_summary();

CREATE OR REPLACE FUNCTION public.zane_checkins_guard_ai_opinion()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
begin
  if (select auth.uid()) is not null then
    if new.ai_opinion is distinct from old.ai_opinion
       or new.ai_opinion_generated_at is distinct from old.ai_opinion_generated_at then
      raise exception 'ai_opinion is server-generated only';
    end if;
  end if;
  return new;
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.zane_checkins_guard_ai_opinion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zane_checkins_guard_ai_opinion ON public.zane_checkins;
CREATE TRIGGER zane_checkins_guard_ai_opinion
  BEFORE UPDATE ON public.zane_checkins
  FOR EACH ROW EXECUTE FUNCTION zane_checkins_guard_ai_opinion();
