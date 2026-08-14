const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(405, { ok: false, error: 'method_not_allowed' });
  }

  const expectedToken = Deno.env.get('DB_HEALTH_TOKEN') ?? '';
  const suppliedToken = req.headers.get('x-health-token') ?? '';
  if (!expectedToken || suppliedToken !== expectedToken) {
    return json(401, { ok: false, error: 'unauthorized' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return json(503, { ok: false, error: 'health_check_not_configured' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/db_health`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(`[db-health] rpc failed: ${response.status} ${await response.text().catch(() => '')}`);
      return json(503, { ok: false, error: 'database_unavailable' });
    }

    const health = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!health || health.ok !== true) {
      return json(503, health ?? { ok: false, error: 'invalid_health_response' });
    }
    if (req.method === 'HEAD') return new Response(null, { status: 200, headers: jsonHeaders });
    return json(200, health);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    console.error(`[db-health] ${timedOut ? 'timeout' : 'request failed'}`);
    return json(503, { ok: false, error: timedOut ? 'timeout' : 'database_unavailable' });
  } finally {
    clearTimeout(timeout);
  }
});
