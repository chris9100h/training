// Sends a 6-digit verification code to a Pushover user key.
// Used to confirm a Pushover account is reachable before saving it.
// The code is returned to the client for comparison — verification is a
// UX confirmation of delivery, not a security gate.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PUSHOVER_TOKEN = 'a2vfbj4vu92hwzp5t9b6cbzkc18vw9';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';

async function resolveUser(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ANON_KEY;
  const r = await fetch(`${base}/auth/v1/user`, {
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

  const { userKey } = await req.json().catch(() => ({}));
  if (!userKey) {
    return new Response(JSON.stringify({ error: 'missing userKey' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const token = Deno.env.get('PUSHOVER_TOKEN') ?? PUSHOVER_TOKEN;

  const r = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, user: userKey, title: 'Zane', message: `Verification code: ${code}` }),
  }).catch(() => null);

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
