const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const { coachingId, authorId, threadId, preview } = await req.json().catch(() => ({}));

  if (!coachingId || !authorId) {
    return new Response(JSON.stringify({ error: 'missing params' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Determine recipient (the other party in the coaching relationship)
  const coachingRes = await dbFetch(`zane_coaching?id=eq.${encodeURIComponent(coachingId)}&select=coach_id,client_id`);
  const coaching: { coach_id: string; client_id: string }[] = await coachingRes.json().catch(() => []);
  if (!coaching[0]) {
    return new Response(JSON.stringify({ error: 'coaching not found' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { coach_id, client_id } = coaching[0];
  const recipientId = authorId === coach_id ? client_id : coach_id;

  // Check recipient push settings
  const settingsRes = await dbFetch(`zane_user_settings?user_id=eq.${encodeURIComponent(recipientId)}&select=push_enabled,pushover_user_key`);
  const settings: { push_enabled: boolean; pushover_user_key: string | null }[] = await settingsRes.json().catch(() => []);

  if (!settings[0]?.push_enabled || !settings[0]?.pushover_user_key) {
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

  const token    = Deno.env.get('PUSHOVER_TOKEN') ?? 'a2vfbj4vu92hwzp5t9b6cbzkc18vw9';
  const userKey  = settings[0].pushover_user_key;
  const title    = threadName ? `Zane · ${threadName}` : 'Zane · New message';
  const message  = (preview ?? 'New message from your coach').split('\n')[0].slice(0, 100);

  const r = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, user: userKey, title, message }),
  });
  console.log(`[coaching-notify] ${r.status}: ${await r.text()}`);

  return new Response(JSON.stringify({ sent: true }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
