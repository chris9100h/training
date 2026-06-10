const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SELF_URL  = 'https://ebbuvdzgstrhrcsbrlez.supabase.co/functions/v1/pushover';
const ANON_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';
const MAX_CHUNK = 10;   // seconds per relay hop
const MAX_DELAY = 3600; // cap user-supplied delays at 1 h — rest timers are minutes

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

async function isNonceCurrent(nonce: string, userId: string): Promise<boolean> {
  const r = await dbFetch(`zane_pushover_active?id=eq.${encodeURIComponent(userId)}&select=nonce`);
  const rows: { nonce: string }[] = await r.json().catch(() => []);
  return rows[0]?.nonce === nonce;
}

// Resolve the caller: a real signed-in user (normal app calls) or the
// service-role key (internal relay hops + other edge functions). The bare
// anon key is NOT enough — without this check the function was an open
// relay anyone could use to push arbitrary messages via our Pushover token,
// cancel other users' notification chains, or start unbounded relay chains.
async function resolveCaller(req: Request): Promise<{ internal: boolean; userId: string | null }> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return { internal: false, userId: null };
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (serviceKey && token === serviceKey) return { internal: true, userId: null };
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ANON_KEY;
  const r = await fetch(`${base}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': anon },
  }).catch(() => null);
  if (!r?.ok) return { internal: false, userId: null };
  const user = await r.json().catch(() => null);
  return { internal: false, userId: user?.id ?? null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const caller = await resolveCaller(req);
  if (!caller.internal && !caller.userId) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const token = Deno.env.get('PUSHOVER_TOKEN') ?? 'a2vfbj4vu92hwzp5t9b6cbzkc18vw9';

  let {
    message = 'Rest over — keep going! 💪',
    title = 'Zane',
    delaySeconds = 0,
    nonce = '',   // unique token per rest period; empty = no cancellation check
    _relay = false,
    cancel = false, // just invalidate the nonce, don't schedule delivery
    userKey = '',
    userId = 'singleton',
    priority = 0,
    ttl = 180,    // expire after 3 minutes by default; pass 0 to disable
  } = await req.json().catch(() => ({}));

  if (!caller.internal) {
    // App callers may only act on themselves: identity and target key come
    // from the database, never from the request body.
    userId = caller.userId!;
    _relay = false;
    delaySeconds = Math.min(Math.max(0, Number(delaySeconds) || 0), MAX_DELAY);
    const r = await dbFetch(
      `zane_user_settings?user_id=eq.${encodeURIComponent(userId)}&select=push_enabled,pushover_user_key`
    );
    const [sett] = await r.json().catch(() => [null]);
    userKey = sett?.push_enabled ? (sett?.pushover_user_key ?? '') : '';
    if (!cancel && !userKey) {
      // Nothing to deliver to — e.g. the key was just typed and hasn't synced yet
      return new Response(JSON.stringify({ skipped: true, reason: 'no_user_key' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  const user = userKey || (Deno.env.get('PUSHOVER_USER') ?? 'uxrg8gh43b1tpw31pq4r4i4ebqrhjt');

  // First call only: register this nonce as the currently active one.
  // Relay hops skip this — the nonce is already stored from the initial call.
  if (nonce && !_relay) {
    await dbFetch('zane_pushover_active', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ id: userId, nonce }),
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
      if (nonce && !await isNonceCurrent(nonce, userId)) {
        console.log('[pushover] cancelled — newer rest timer active');
        return;
      }
      // Relay hops authenticate with the service-role key (caller JWTs could
      // expire mid-chain and must never be forwarded anywhere).
      EdgeRuntime.waitUntil(
        fetch(SELF_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message, title, delaySeconds: delaySeconds - MAX_CHUNK, nonce, _relay: true, userKey: user, userId, priority, ttl }),
        }).catch(e => console.error('[pushover] relay error:', e))
      );
    } else {
      if (delaySeconds > 0) await new Promise(r => setTimeout(r, delaySeconds * 1000));
      // Cancel send if a newer set started
      if (nonce && !await isNonceCurrent(nonce, userId)) {
        console.log('[pushover] cancelled — newer rest timer active');
        return;
      }
      console.log('[pushover] sending');
      const r = await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, user, message, title, priority, ...(ttl > 0 ? { ttl } : {}) }),
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
