const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SELF_URL  = 'https://ebbuvdzgstrhrcsbrlez.supabase.co/functions/v1/pushover';
const ANON_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';
const MAX_CHUNK = 10; // seconds per hop

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

async function isNonceCurrent(nonce: string): Promise<boolean> {
  const r = await dbFetch('pushover_active?id=eq.singleton&select=nonce');
  const rows: { nonce: string }[] = await r.json().catch(() => []);
  return rows[0]?.nonce === nonce;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const token = Deno.env.get('PUSHOVER_TOKEN') ?? 'a2vfbj4vu92hwzp5t9b6cbzkc18vw9';

  const {
    message = 'Pause vorbei — weiter gehts! 💪',
    title = 'Logbook',
    delaySeconds = 0,
    nonce = '',   // unique token per rest period; empty = no cancellation check
    _relay = false,
    cancel = false, // just invalidate the nonce, don't schedule delivery
    userKey = '',
  } = await req.json().catch(() => ({}));

  const user = userKey || Deno.env.get('PUSHOVER_USER') ?? 'uxrg8gh43b1tpw31pq4r4i4ebqrhjt';

  // First call only: register this nonce as the currently active one.
  // Relay hops skip this — the nonce is already stored from the initial call.
  if (nonce && !_relay) {
    await dbFetch('pushover_active', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ id: 'singleton', nonce }),
    }).catch(e => console.error('[pushover] nonce upsert error:', e));
  }

  // Cancel mode: nonce updated (old chain invalidated), nothing to schedule.
  if (cancel) {
    console.log('[pushover] cancelled by client');
    return new Response(JSON.stringify({ cancelled: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const run = async () => {
    console.log(`[pushover] delaySeconds=${delaySeconds} nonce=${nonce || '(none)'} relay=${_relay}`);

    if (delaySeconds > MAX_CHUNK) {
      await new Promise(r => setTimeout(r, MAX_CHUNK * 1000));
      // Cancel chain if a newer set started
      if (nonce && !await isNonceCurrent(nonce)) {
        console.log('[pushover] cancelled — newer rest timer active');
        return;
      }
      EdgeRuntime.waitUntil(
        fetch(SELF_URL, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, title, delaySeconds: delaySeconds - MAX_CHUNK, nonce, _relay: true, userKey }),
        }).catch(e => console.error('[pushover] relay error:', e))
      );
    } else {
      if (delaySeconds > 0) await new Promise(r => setTimeout(r, delaySeconds * 1000));
      // Cancel send if a newer set started
      if (nonce && !await isNonceCurrent(nonce)) {
        console.log('[pushover] cancelled — newer rest timer active');
        return;
      }
      console.log('[pushover] sending');
      const r = await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, user, message, title }),
      });
      console.log(`[pushover] ${r.status}: ${await r.text()}`);
    }
  };

  EdgeRuntime.waitUntil(run());

  return new Response(JSON.stringify({ scheduled: true, delaySeconds }), {
    status: 202,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
