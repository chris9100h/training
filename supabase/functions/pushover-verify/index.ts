// Sends a 6-digit verification code to a Pushover user key.
// Used to confirm a Pushover account is reachable before saving it.
// The code is returned to the client for comparison, verification is a
// UX confirmation of delivery, not a security gate.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Secret, never a literal: set it with `supabase secrets set PUSHOVER_TOKEN=...`.
const PUSHOVER_TOKEN = Deno.env.get('PUSHOVER_TOKEN') ?? '';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';

async function fetchWithTimeout(input: string, options: RequestInit = {}, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function dbFetch(path: string, options: RequestInit = {}) {
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return fetchWithTimeout(`${base}/rest/v1/${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${key}`,
      'apikey': key,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
}

async function takeVerificationRateLimit(userId: string): Promise<'allowed' | 'limited' | 'unavailable'> {
  const result = await dbFetch('rpc/social_take_notification_rate_limit', {
    method: 'POST',
    // At most three verification pushes per rolling minute. Verification is
    // an exceptional settings action, not a normal notification channel.
    body: JSON.stringify({ p_caller_id: userId, p_cost: 20 }),
  }).catch(() => null);
  if (!result?.ok) return 'unavailable';
  return await result.json().catch(() => false) === true ? 'allowed' : 'limited';
}

async function resolveUser(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ANON_KEY;
  const r = await fetchWithTimeout(`${base}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': anon },
  }).catch(() => null);
  if (!r?.ok) return null;
  const user = await r.json().catch(() => null);
  return user?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const userId = await resolveUser(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { userKey: rawUserKey } = await req.json().catch(() => ({}));
  const userKey = typeof rawUserKey === 'string' ? rawUserKey.trim() : '';
  if (!/^[A-Za-z0-9]{30}$/.test(userKey)) {
    return new Response(JSON.stringify({ error: 'invalid userKey' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const rateLimit = await takeVerificationRateLimit(userId);
  if (rateLimit !== 'allowed') {
    return new Response(JSON.stringify({ error: rateLimit === 'limited' ? 'too many verification attempts' : 'verification temporarily unavailable' }), {
      status: rateLimit === 'limited' ? 429 : 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const token = Deno.env.get('PUSHOVER_TOKEN') ?? PUSHOVER_TOKEN;

  if (!token) {
    return new Response(JSON.stringify({ error: 'Pushover is not configured' }), {
      status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const r = await fetchWithTimeout('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, user: userKey, title: 'Zane', message: `Verification code: ${code}` }),
  }, 12_000).catch(() => null);

  if (!r?.ok) {
    const body = await r?.text().catch(() => '');
    return new Response(JSON.stringify({ error: `Pushover error: ${body}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ code }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
