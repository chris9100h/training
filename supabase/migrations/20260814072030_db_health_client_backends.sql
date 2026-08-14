-- Realtime's logical-replication WAL sender is intentionally active for the
-- lifetime of the service and waits on WalSenderWaitForWal while idle. It is
-- infrastructure, not a blocked application query, so only client backends
-- belong in the waiting/long-running query alarms.

CREATE OR REPLACE FUNCTION public.db_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_connections integer;
  v_max_connections integer := current_setting('max_connections')::integer;
  v_waiting integer;
  v_long_running integer;
  v_net_response_bytes bigint := 0;
  v_critical boolean;
BEGIN
  SELECT count(*)::integer
    INTO v_connections
  FROM pg_catalog.pg_stat_activity
  WHERE datname = current_database();

  SELECT count(*)::integer
    INTO v_waiting
  FROM pg_catalog.pg_stat_activity
  WHERE datname = current_database()
    AND pid <> pg_backend_pid()
    AND backend_type = 'client backend'
    AND state = 'active'
    AND wait_event_type IS NOT NULL;

  SELECT count(*)::integer
    INTO v_long_running
  FROM pg_catalog.pg_stat_activity
  WHERE datname = current_database()
    AND pid <> pg_backend_pid()
    AND backend_type = 'client backend'
    AND state = 'active'
    AND query_start < clock_timestamp() - interval '5 seconds';

  IF to_regclass('net._http_response') IS NOT NULL THEN
    v_net_response_bytes := pg_catalog.pg_total_relation_size('net._http_response'::regclass);
  END IF;

  v_critical := v_connections >= 45 OR v_waiting > 0 OR v_long_running > 0;

  RETURN jsonb_build_object(
    'ok', NOT v_critical,
    'checkedAt', clock_timestamp(),
    'connections', v_connections,
    'maxConnections', v_max_connections,
    'connectionRatio', round(v_connections::numeric / GREATEST(v_max_connections, 1), 4),
    'waitingQueries', v_waiting,
    'longRunningQueries', v_long_running,
    'pgNetResponseBytes', v_net_response_bytes
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.db_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.db_health() TO service_role;
