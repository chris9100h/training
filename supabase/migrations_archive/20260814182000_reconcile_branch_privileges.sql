-- The manual-history baseline also skipped the 0141 grant lockdown for this
-- batch writer. It must be authenticated-only like the other sync RPCs.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.sync_daily_logs_batch(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_daily_logs_batch(jsonb) TO authenticated;

COMMIT;
