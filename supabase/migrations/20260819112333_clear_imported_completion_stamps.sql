-- The first import-hardening migration added the marker before replacing the
-- old completion trigger. Clear any old server stamps after that trigger is
-- now import-aware; imported history is never a live completion.
UPDATE public.zane_sessions
   SET completed_server_at = NULL
 WHERE imported IS TRUE
   AND completed_server_at IS NOT NULL;
