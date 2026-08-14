const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

function json(req: Request, status: number, body: Record<string, unknown>) {
  // Better Stack uses HEAD checks. A HEAD response must never carry a JSON
  // payload, including error responses; some proxies otherwise buffer and
  // retry the body as if the endpoint were unhealthy twice.
  return new Response(req.method === 'HEAD' ? null : JSON.stringify(body), { status, headers: jsonHeaders });
}

function constantTimeEqual(a: string, b: string) {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return difference === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(req, 405, { ok: false, error: 'method_not_allowed' });
  }

  const expectedToken = Deno.env.get('DB_HEALTH_TOKEN') ?? '';
  const suppliedToken = req.headers.get('x-health-token') ?? '';
  if (!expectedToken || !constantTimeEqual(suppliedToken, expectedToken)) {
    return json(req, 401, { ok: false, error: 'unauthorized' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return json(req, 503, { ok: false, error: 'health_check_not_configured' });
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
      return json(req, 503, { ok: false, error: 'database_unavailable' });
    }

    const health = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!health || health.ok !== true) {
      return json(req, 503, health ?? { ok: false, error: 'invalid_health_response' });
    }
    return json(req, 200, health);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    console.error(`[db-health] ${timedOut ? 'timeout' : 'request failed'}`);
    return json(req, 503, { ok: false, error: timedOut ? 'timeout' : 'database_unavailable' });
  } finally {
    clearTimeout(timeout);
  }
});
