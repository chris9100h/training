const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const PUSHOVER_TOKEN = 'a2vfbj4vu92hwzp5t9b6cbzkc18vw9';

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
  const r = await dbFetch(
    'zane_user_settings?reminder_enabled=eq.true&next_reminder_at=not.is.null&push_enabled=eq.true&pushover_user_key=not.is.null&select=user_id,pushover_user_key,next_reminder_at'
  );
  const rows: { user_id: string; pushover_user_key: string; next_reminder_at: string }[] = await r.json().catch(() => []);

  const now = Date.now();
  const oneHourAgo = now - 3600_000;

  for (const row of rows) {
    const scheduledAt = new Date(row.next_reminder_at).getTime();
    // Only fire if the reminder is due and not stale (older than 1 hour)
    if (scheduledAt > now || scheduledAt < oneHourAgo) continue;

    try {
      const res = await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: PUSHOVER_TOKEN,
          user: row.pushover_user_key,
          title: 'Zane · Training Reminder',
          message: "Training day ahead — time to get after it! 💪",
          priority: 0,
          ttl: 14400, // expire after 4 hours
        }),
      });
      console.log(`[reminder] sent to ${row.user_id}: ${res.status}`);
    } catch (e) {
      console.error(`[reminder] pushover error for ${row.user_id}:`, e);
    }

    // Clear next_reminder_at regardless of push success so we don't retry endlessly
    await dbFetch(`zane_user_settings?user_id=eq.${row.user_id}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ next_reminder_at: null }),
    }).catch(e => console.error(`[reminder] clear error for ${row.user_id}:`, e));
  }
}

// Scheduled via pg_cron in the database (see migration 0028_reminder_cron.sql).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
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
