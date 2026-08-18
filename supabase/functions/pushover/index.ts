// DEPLOY WITH verify_jwt = false. This function does its OWN auth in
// resolveCaller() below (signed-in user OR the service-role key), which is the
// real security boundary. It MUST stay false because the long-rest relay chain
// calls this function back with the service-role key and no apikey header, the
// gateway's verify_jwt=true rejects that self-call (HTTP 401, ~40 ms) and the
// chain dies, so rest-timer pushes silently never fire for delays > 10 s.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANON_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';
const MAX_CHUNK = 10;   // seconds per relay hop
const MAX_DELAY = 3600; // cap user-supplied delays at 1 h, rest timers are minutes

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
  const key  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
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

async function isNonceCurrent(nonce: string, userId: string): Promise<boolean> {
  const r = await dbFetch(`zane_push_schedule_claims?user_id=eq.${encodeURIComponent(userId)}&channel=eq.pushover&select=nonce`);
  // Same trap as web-push/index.ts's own isNonceCurrent (M10, audit-2026-08):
  // a non-2xx PostgREST reply still parses as JSON (an error object, not an
  // array), so the .catch fallback below never fires and rows[0] would read
  // undefined off that object, making this return false. Both call sites
  // below read false as "the user aborted" and silently drop a legitimate
  // delayed Pushover send that never asked to be cancelled. Fail OPEN (still
  // current) instead, this copy was missed when web-push's was fixed.
  if (!r.ok) { console.error(`[pushover] nonce check failed: ${r.status} ${await r.text().catch(() => '')}`); return true; }
  const rows: { nonce: string }[] = await r.json().catch(() => []);
  return rows[0]?.nonce === nonce;
}

async function takeDirectPushRateLimit(userId: string, cost: number): Promise<'allowed' | 'limited' | 'unavailable'> {
  const result = await dbFetch('rpc/social_take_notification_rate_limit', {
    method: 'POST',
    body: JSON.stringify({ p_caller_id: userId, p_cost: cost }),
  }).catch(() => null);
  if (!result?.ok) return 'unavailable';
  return await result.json().catch(() => false) === true ? 'allowed' : 'limited';
}

async function claimSchedule(userId: string, nonce: string): Promise<'claimed' | 'duplicate' | 'unavailable'> {
  const result = await dbFetch('rpc/claim_push_schedule', {
    method: 'POST',
    body: JSON.stringify({ p_user_id: userId, p_channel: 'pushover', p_nonce: nonce }),
  }).catch(() => null);
  if (!result?.ok) return 'unavailable';
  return await result.json().catch(() => false) === true ? 'claimed' : 'duplicate';
}

// Resolve the caller: a real signed-in user (normal app calls) or the
// service-role key (internal relay hops + other edge functions). The bare
// anon key is NOT enough, without this check the function was an open
// relay anyone could use to push arbitrary messages via our Pushover token,
// cancel other users' notification chains, or start unbounded relay chains.
async function resolveCaller(req: Request): Promise<{ internal: boolean; userId: string | null }> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return { internal: false, userId: null };
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (serviceKey && token === serviceKey) return { internal: true, userId: null };
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ANON_KEY;
  const r = await fetchWithTimeout(`${base}/auth/v1/user`, {
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

  const token = Deno.env.get('PUSHOVER_TOKEN') ?? '';

  let {
    message = 'Rest over, keep going! 💪',
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
  nonce = typeof nonce === 'string' ? nonce.trim() : '';

  if (!caller.internal) {
    // App callers may only act on themselves: identity and target key come
    // from the database, never from the request body.
    userId = caller.userId!;
    _relay = false;
    delaySeconds = Math.min(Math.max(0, Number(delaySeconds) || 0), MAX_DELAY);
    ttl = Math.min(Math.max(0, Number(ttl) || 180), 86_400);
    if (nonce.length > 200 || ((delaySeconds > 0 || cancel) && !nonce)) {
      return new Response(JSON.stringify({ error: 'a valid nonce is required for delayed or cancel requests' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const rate = await takeDirectPushRateLimit(userId, cancel ? 1 : 3);
    if (rate === 'limited') {
      return new Response(JSON.stringify({ error: 'rate limited' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (rate === 'unavailable') {
      return new Response(JSON.stringify({ error: 'rate limiter unavailable' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!cancel) {
      const r = await dbFetch(
        `zane_user_settings?user_id=eq.${encodeURIComponent(userId)}&select=push_enabled,pushover_user_key`
      );
      if (!r.ok) {
        return new Response(JSON.stringify({ error: 'settings unavailable' }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const [sett] = await r.json().catch(() => [null]);
      userKey = sett?.push_enabled ? (sett?.pushover_user_key ?? '') : '';
      if (!userKey) {
        // Nothing to deliver to, e.g. the key was just typed and hasn't synced yet
        return new Response(JSON.stringify({ skipped: true, reason: 'no_user_key' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
  }

  if (nonce.length > 200 || ((delaySeconds > 0 || cancel || _relay) && !nonce)) {
    return new Response(JSON.stringify({ error: 'a valid nonce is required for delayed, relay or cancel requests' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // No hardcoded fallback: a live Pushover user key committed to a public
  // repo is a real credential leak (fixed after an audit flagged it, see
  // docs/audit.md H15 / docs/audit-2026-08.md M15; the exposed key itself
  // still needs rotating on the Pushover dashboard, this only stops the
  // committed literal from being used going forward). An internal
  // (service-role) caller with no userKey and no PUSHOVER_USER env set has
  // nowhere to actually deliver to, same "nothing to send to" outcome the
  // app-caller branch above already returns for a missing key.
  const user = userKey || Deno.env.get('PUSHOVER_USER') || '';
  if (!cancel && !user) {
    console.error('[pushover] no target user key available (missing userKey and PUSHOVER_USER env)');
    return new Response(JSON.stringify({ skipped: true, reason: 'no_user_key' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (nonce && !_relay) {
    const scheduleClaim = await claimSchedule(userId, nonce);
    if (scheduleClaim === 'unavailable') {
      return new Response(JSON.stringify({ error: 'schedule claim unavailable' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (scheduleClaim === 'duplicate') {
      return new Response(JSON.stringify({ deduplicated: true, scheduled: delaySeconds > 0 }), {
        status: delaySeconds > 0 ? 202 : 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
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
        console.log('[pushover] cancelled, newer rest timer active');
        return;
      }
      // Relay hops authenticate with the service-role key (caller JWTs could
      // expire mid-chain and must never be forwarded anywhere).
      EdgeRuntime.waitUntil(
        fetch(`${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/pushover`, {
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
        console.log('[pushover] cancelled, newer rest timer active');
        return;
      }
      console.log('[pushover] sending');
      try {
        const r = await fetchWithTimeout('https://api.pushover.net/1/messages.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, user, message, title, priority, ...(ttl > 0 ? { ttl } : {}) }),
        }, 12_000);
        console.log(`[pushover] ${r.status}: ${await r.text()}`);
      } catch (error) {
        console.error('[pushover] provider request failed:', error);
      }
    }
  };

  EdgeRuntime.waitUntil(run());

  return new Response(JSON.stringify({ scheduled: true, delaySeconds }), {
    status: 202,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
