// Native Web Push via VAPID. Called internally (service-role key) by other
// edge functions, or directly by the signed-in user for test pushes.
// VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set as Supabase secrets.

import webpush from 'npm:web-push@3.6.7';

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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const caller = await resolveCaller(req);
  if (!caller.internal && !caller.userId) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { userId: bodyUserId, title = 'Zane', body: bodyText, message, url } = await req.json().catch(() => ({}));
  const text = message || bodyText || '';

  const targetUserId = caller.internal ? bodyUserId : caller.userId!;
  if (!targetUserId) {
    return new Response(JSON.stringify({ error: 'missing userId' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // For user-initiated calls, verify push_enabled
  if (!caller.internal) {
    const settRes = await dbFetch(`zane_user_settings?user_id=eq.${encodeURIComponent(targetUserId)}&select=push_enabled`);
    const [sett] = await settRes.json().catch(() => [null]);
    if (!sett?.push_enabled) {
      return new Response(JSON.stringify({ skipped: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  const subRes = await dbFetch(`zane_push_subscriptions?user_id=eq.${encodeURIComponent(targetUserId)}&select=id,endpoint,p256dh,auth`);
  const subs: { id: string; endpoint: string; p256dh: string; auth: string }[] = await subRes.json().catch(() => []);

  if (subs.length === 0) {
    return new Response(JSON.stringify({ skipped: true, reason: 'no_subscriptions' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

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
        console.error(`[web-push] send error for ${sub.id.slice(-12)}: ${err.statusCode} ${err.body}`);
      }
      failed++;
    }
  }));

  console.log(`[web-push] sent=${sent} failed=${failed} user=${targetUserId}`);
  return new Response(JSON.stringify({ sent, failed }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
