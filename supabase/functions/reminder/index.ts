import { sendNotification } from '../_shared/notifications.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

async function sendReminders() {
  // Query all push-enabled users with a due reminder, not just Pushover users.
  const r = await dbFetch(
    'zane_user_settings?reminder_enabled=eq.true&next_reminder_at=not.is.null&push_enabled=eq.true&select=user_id,pushover_user_key,use_pushover,next_reminder_at'
  );
  // A non-2xx PostgREST reply still parses as JSON (an error object), so the
  // .catch fallback never fires and the loop below would iterate an object.
  // Same guard water-reminder already has.
  if (!r.ok) { console.error(`[reminder] settings query failed: ${r.status} ${await r.text().catch(() => '')}`); return; }
  const rows: { user_id: string; pushover_user_key: string | null; use_pushover: boolean | null; next_reminder_at: string }[] = await r.json().catch(() => []);

  const now = Date.now();
  const oneHourAgo = now - 3600_000;

  for (const row of rows) {
    const scheduledAt = new Date(row.next_reminder_at).getTime();
    // Only fire if the reminder is due and not stale (older than 1 hour)
    if (scheduledAt > now || scheduledAt < oneHourAgo) continue;

    const title = 'Zane · Training Reminder';
    const message = "Training day ahead. Time to get after it! 💪";

    // Respect the user's channel choice: Pushover only when they turned it on
    // (use_pushover) and set a key, otherwise native Web Push. This used to send
    // BOTH whenever a key existed, so a Pushover user got the same reminder
    // twice. Matches the water/meal reminder "Pushover instead of Web Push"
    // semantics.
    const delivered = await sendNotification({
      userId: row.user_id,
      title,
      message,
      usePushover: row.use_pushover,
      pushoverUserKey: row.pushover_user_key,
      logPrefix: 'reminder',
      ttl: 43200,
    });
    if (!delivered) continue;

    // Only clear after the provider accepted the handoff. A failed delivery
    // remains due and can retry on the next cron tick until the one-hour
    // staleness backstop expires.
    const clearResp = await dbFetch(`zane_user_settings?user_id=eq.${row.user_id}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ next_reminder_at: null }),
    }).catch(e => { console.error(`[reminder] clear error for ${row.user_id}:`, e); return null; });
    if (clearResp && !clearResp.ok) {
      console.error(`[reminder] clear failed for ${row.user_id}: ${clearResp.status} ${await clearResp.text().catch(() => '')}`);
    }
  }
}

// Scheduled via pg_cron in the database (see migration 0028_reminder_cron.sql).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Cron-only shared secret. This function is a cron trigger target with no
  // caller identity to resolve (unlike pushover/index.ts), so it just checks
  // the bearer token against CRON_SECRET. Fails CLOSED: an unset/empty
  // CRON_SECRET rejects every request rather than accidentally allowing it
  // through. See migration 0230_cron_shared_secret_auth.sql for the
  // Vault-backed secret this compares against.
  const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Allow manual trigger via POST for testing
  if (req.method === 'POST') {
    await sendReminders();
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
