import { sendNotification } from '../_shared/notifications.ts';

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

// The caller must be a real signed-in user, the bare anon key is not
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
  // The author is always the authenticated caller, never taken from the body.
  const coachingRes = await dbFetch(`zane_coaching?id=eq.${encodeURIComponent(coachingId)}&select=coach_id,client_id`);
  // A non-2xx PostgREST reply still parses as JSON (an error object, not an
  // array), so the .catch fallback never fires; without this guard that
  // object's undefined [0] read the same as a genuine "not found" below,
  // masking a real query failure as a 404.
  if (!coachingRes.ok) {
    console.error(`[coaching-notify] coaching query failed: ${coachingRes.status} ${await coachingRes.text().catch(() => '')}`);
    return new Response(JSON.stringify({ error: 'could not resolve coaching relationship' }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
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
  const settingsRes = await dbFetch(`zane_user_settings?user_id=eq.${encodeURIComponent(recipientId)}&select=push_enabled,pushover_user_key,use_pushover`);
  // Same trap as the coaching query above: an error object's settings[0]
  // reads undefined, which would otherwise fall through to the same
  // {skipped:true} 200 as "recipient has push disabled", silently losing a
  // real notification instead of surfacing the failure.
  if (!settingsRes.ok) {
    console.error(`[coaching-notify] settings query failed: ${settingsRes.status} ${await settingsRes.text().catch(() => '')}`);
    return new Response(JSON.stringify({ error: 'could not resolve recipient settings' }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const settings: { push_enabled: boolean; pushover_user_key: string | null; use_pushover: boolean | null }[] = await settingsRes.json().catch(() => []);

  if (!settings[0]?.push_enabled) {
    return new Response(JSON.stringify({ skipped: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Resolve thread name for notification title
  let threadName = '';
  if (threadId) {
    const threadRes = await dbFetch(`zane_coaching_threads?id=eq.${encodeURIComponent(threadId)}&select=name`);
    // Lower stakes than the two guards above (worst case on failure: the
    // generic "New message" title instead of the thread's name), but same
    // error-object trap, so guarded the same way rather than sending anyway.
    if (threadRes.ok) {
      const thread: { name: string }[] = await threadRes.json().catch(() => []);
      threadName = thread[0]?.name ?? '';
    } else {
      console.error(`[coaching-notify] thread query failed: ${threadRes.status} ${await threadRes.text().catch(() => '')}`);
    }
  }

  const isSupport = coachingId.startsWith('support_');
  const title   = isSupport ? 'Zane · Support' : (threadName ? `Zane · ${threadName}` : 'Zane · New message');
  const message = (preview ?? (isSupport ? 'New support ticket message' : 'New message from your coach')).split('\n')[0].slice(0, 100);

  // Pushover INSTEAD of Web Push when the recipient chose that channel, the
  // same rule the reminder functions follow. This used to send both whenever a
  // key existed, so a Pushover user got every coaching message twice.
  const delivered = await sendNotification({
    userId: recipientId,
    title,
    message,
    usePushover: settings[0].use_pushover,
    pushoverUserKey: settings[0].pushover_user_key,
    logPrefix: 'coaching-notify',
  });

  return new Response(JSON.stringify({ sent: delivered }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
