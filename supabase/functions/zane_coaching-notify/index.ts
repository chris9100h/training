const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';

function dbFetch(path: string, options: RequestInit = {}) {
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const key  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${key}`,
      'apikey': key,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
}

// The caller must be a real signed-in user — the bare anon key is not
// enough. Without this, anyone could trigger spoofed "message from your
// coach" pushes for arbitrary coaching relationships.
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authedUserId = await resolveUser(req);
  if (!authedUserId) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { coachingId, threadId, preview } = await req.json().catch(() => ({}));

  if (!coachingId) {
    return new Response(JSON.stringify({ error: 'missing params' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Determine recipient (the other party in the coaching relationship).
  // The author is always the authenticated caller — never taken from the body.
  const coachingRes = await dbFetch(`zane_coaching?id=eq.${encodeURIComponent(coachingId)}&select=coach_id,client_id`);
  const coaching: { coach_id: string; client_id: string }[] = await coachingRes.json().catch(() => []);
  if (!coaching[0]) {
    return new Response(JSON.stringify({ error: 'coaching not found' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { coach_id, client_id } = coaching[0];
  if (authedUserId !== coach_id && authedUserId !== client_id) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const recipientId = authedUserId === coach_id ? client_id : coach_id;

  // Check recipient push settings
  const settingsRes = await dbFetch(`zane_user_settings?user_id=eq.${encodeURIComponent(recipientId)}&select=push_enabled,pushover_user_key`);
  const settings: { push_enabled: boolean; pushover_user_key: string | null }[] = await settingsRes.json().catch(() => []);

  if (!settings[0]?.push_enabled) {
    return new Response(JSON.stringify({ skipped: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Resolve thread name for notification title
  let threadName = '';
  if (threadId) {
    const threadRes = await dbFetch(`zane_coaching_threads?id=eq.${encodeURIComponent(threadId)}&select=name`);
    const thread: { name: string }[] = await threadRes.json().catch(() => []);
    threadName = thread[0]?.name ?? '';
  }

  const isSupport = coachingId.startsWith('support_');
  const title   = isSupport ? 'Zane · Support' : (threadName ? `Zane · ${threadName}` : 'Zane · New message');
  const message = (preview ?? (isSupport ? 'New support ticket message' : 'New message from your coach')).split('\n')[0].slice(0, 100);

  // Pushover (if configured)
  if (settings[0].pushover_user_key) {
    const token = Deno.env.get('PUSHOVER_TOKEN') ?? 'a2vfbj4vu92hwzp5t9b6cbzkc18vw9';
    const r = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, user: settings[0].pushover_user_key, title, message }),
    });
    console.log(`[coaching-notify] pushover ${r.status}: ${await r.text()}`);
  }

  // Web Push
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  await fetch(`${base}/functions/v1/web-push`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: recipientId, title, message }),
  }).catch(e => console.error('[coaching-notify] web-push error:', e));

  return new Response(JSON.stringify({ sent: true }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
