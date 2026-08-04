// Shared request plumbing for the Zane edge functions: CORS, the JSON
// response helper, who is calling, and whether they are within quota. Every
// function that answers a browser request needs all four, and until this file
// existed each one carried its own byte-identical copy (resolveUser was pasted
// into twelve of them, withinQuota into nine).
//
// A folder prefixed with _ is not deployed as a function of its own; the
// Supabase CLI bundles it into whichever function imports it. Changing
// anything here therefore only reaches a deployed function when THAT function
// is redeployed, so a change to this file means redeploying every importer.
// Today that is parse-meal and scan-label. The remaining functions still carry
// their own copies on purpose: migrating one means redeploying it for no
// behavioural gain, which is pure risk, so they move over one at a time
// whenever they are next touched for another reason.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Handed to the client as a fallback when SUPABASE_ANON_KEY is not in the
// environment. Publishable by design, this is the same key the browser ships.
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';

// Same admin identity as admin-send-email/screens-settings.jsx/screens-featuremap.jsx
// (isAdmin = store.user?.email === this): unlimited quota for testing.
export const ADMIN_EMAIL = 'office@btc-prime.biz';

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Returns the preflight response for an OPTIONS request, or null to carry on.
export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders }) : null;
}

export interface Caller {
  id: string;
  email: string | null;
}

export async function resolveUser(req: Request): Promise<Caller | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ANON_KEY;
  const r = await fetch(`${base}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': anon },
  }).catch(() => null);
  if (!r?.ok) return null;
  const user = await r.json().catch(() => null);
  return user?.id ? { id: user.id, email: user.email ?? null } : null;
}

// Advisory per-user daily quota (zane_api_usage/bump_api_usage, migration
// 0207). Fails OPEN on purpose: if the RPC errors, times out or the migration
// has not run yet, the call goes through. A problem with the quota mechanism
// must never be the reason someone cannot log their food, and the point of it
// is catching a runaway account, not enforcing a contract.
//
// `kind` is per FEATURE, not per provider: switching the model a feature runs
// on must not multiply the effective quota, so all three meal parsers share
// 'meal_parse' and all three label scanners share 'scan'.
export async function withinQuota(userId: string, kind: string, limit: number): Promise<boolean> {
  try {
    const base = Deno.env.get('SUPABASE_URL') ?? '';
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!base || !key) return true;
    const r = await fetch(`${base}/rest/v1/rpc/bump_api_usage`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'apikey': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user_id: userId, p_kind: kind, p_limit: limit }),
    });
    if (!r.ok) return true;
    return (await r.json()) !== false;
  } catch (_) {
    return true;
  }
}
