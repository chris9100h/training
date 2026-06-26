// Native Web Push via VAPID — supports immediate sends and relay-chain delayed
// sends (same architecture as the pushover function). Both chains share the
// same zane_pushover_active nonce table so cancelPushover() in the app
// invalidates both at once.
//
// Called by:
//   • the signed-in user (app) — immediate or delayed, acting on themselves
//   • other edge functions (service-role) — immediate only (coaching, reminder…)
//   • itself as relay hops — delayed delivery via recursive self-calls
//
// VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set as Supabase secrets.

import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SELF_URL  = 'https://ebbuvdzgstrhrcsbrlez.supabase.co/functions/v1/web-push';
const ANON_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';
const MAX_CHUNK = 10;
const MAX_DELAY = 3600;

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

async function deliverPush(userId: string, title: string, text: string, url: string) {
  const subRes = await dbFetch(`zane_push_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=id,endpoint,p256dh,auth`);
  const subs: { id: string; endpoint: string; p256dh: string; auth: string }[] = await subRes.json().catch(() => []);
  if (subs.length === 0) { console.log(`[web-push] no subscriptions for ${userId}`); return; }

  const vapidPublic  = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
  webpush.setVapidDetails('mailto:office@btc-prime.biz', vapidPublic, vapidPrivate);

  const payload = JSON.stringify({ title, body: text, url: url || '/' });
  let sent = 0, failed = 0;

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 300 },
      );
      sent++;
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await dbFetch(`zane_push_subscriptions?id=eq.${encodeURIComponent(sub.id)}`, { method: 'DELETE' }).catch(() => {});
        console.log(`[web-push] removed stale subscription ${sub.id.slice(-12)}`);
      } else {
        console.error(`[web-push] send error ${sub.id.slice(-12)}: ${err.statusCode} ${err.body}`);
      }
      failed++;
    }
  }));
  console.log(`[web-push] sent=${sent} failed=${failed} user=${userId}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const caller = await resolveCaller(req);
  if (!caller.internal && !caller.userId) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let {
    userId: bodyUserId,
    title        = 'Zane',
    body: bodyText,
    message,
    url          = '/',
    delaySeconds = 0,
    nonce        = '',
    _relay       = false,
    cancel       = false,
    verify       = false,
  } = await req.json().catch(() => ({}));
  const text = message || bodyText || '';

  let targetUserId: string = caller.internal ? bodyUserId : caller.userId!;
  if (!targetUserId) {
    return new Response(JSON.stringify({ error: 'missing userId' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!caller.internal) {
    // App callers act only on themselves; clamp delay; verify push is enabled.
    targetUserId = caller.userId!;
    _relay = false;
    delaySeconds = Math.min(Math.max(0, Number(delaySeconds) || 0), MAX_DELAY);
    const settRes = await dbFetch(`zane_user_settings?user_id=eq.${encodeURIComponent(targetUserId)}&select=push_enabled`);
    const [sett] = await settRes.json().catch(() => [null]);
    if (!cancel && !verify && !sett?.push_enabled) {
      return new Response(JSON.stringify({ skipped: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // Register nonce on first call. Shares zane_pushover_active with the pushover
  // function so a single cancelPushover() call from the app invalidates both chains.
  if (nonce && !_relay) {
    await dbFetch('zane_pushover_active', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ id: targetUserId, nonce }),
    }).catch(e => console.error('[web-push] nonce upsert error:', e));
  }

  if (cancel) {
    console.log('[web-push] cancelled by client');
    return new Response(JSON.stringify({ cancelled: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const run = async () => {
    console.log(`[web-push] delay=${delaySeconds} nonce=${nonce || '(none)'} relay=${_relay}`);

    if (delaySeconds > MAX_CHUNK) {
      await new Promise(r => setTimeout(r, MAX_CHUNK * 1000));
      if (nonce && !await isNonceCurrent(nonce, targetUserId)) {
        console.log('[web-push] cancelled — newer rest timer active');
        return;
      }
      EdgeRuntime.waitUntil(
        fetch(SELF_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ userId: targetUserId, title, message: text, url, delaySeconds: delaySeconds - MAX_CHUNK, nonce, _relay: true }),
        }).catch(e => console.error('[web-push] relay error:', e))
      );
    } else {
      if (delaySeconds > 0) await new Promise(r => setTimeout(r, delaySeconds * 1000));
      if (nonce && !await isNonceCurrent(nonce, targetUserId)) {
        console.log('[web-push] cancelled — newer rest timer active');
        return;
      }
      await deliverPush(targetUserId, title, text, url);
    }
  };

  EdgeRuntime.waitUntil(run());

  return new Response(JSON.stringify({ scheduled: true, delaySeconds }), {
    status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
