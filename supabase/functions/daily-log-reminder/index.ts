// Daily log reminder cron function. Nudges once per local day when the user
// has NOT logged a weight for that day yet: after the user's chosen time
// (daily_log_reminder_time, HH:MM in their local wall clock via
// tz_offset_minutes) the function checks zane_daily_logs.weight for today and
// fires a push through the existing web-push + Pushover channels. At most one
// nudge per local day per user, enforced by the server-written
// daily_log_reminder_last_date throttle column (the client never maps or
// writes it, it is allowlisted in tools/check-backup-coverage.cjs).
//
// Scheduled via pg_cron (migration 0247_daily_log_reminder.sql), POST with an
// empty body, same pattern as the training reminder (migration 0028) and the
// water reminder (migration 0182).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Secret, never a literal: set it with `supabase secrets set PUSHOVER_TOKEN=...`.
const PUSHOVER_TOKEN = Deno.env.get('PUSHOVER_TOKEN') ?? '';
const DEFAULT_REMINDER_TIME = '19:00';

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

async function sendWebPush(userId: string, title: string, message: string) {
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  return fetch(`${base}/functions/v1/web-push`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, title, message }),
  }).catch(e => console.error(`[daily-log-reminder] web-push error for ${userId}:`, e));
}

// '19:00' -> milliseconds since local midnight. Malformed/empty falls back to
// DEFAULT_REMINDER_TIME, mirroring water-reminder's hhmmToDecimal leniency.
function hhmmToMs(t: string): number {
  const [h, m] = (t || DEFAULT_REMINDER_TIME).split(':').map(Number);
  return ((h || 0) * 3600 + (m || 0) * 60) * 1000;
}

interface Row {
  user_id: string;
  pushover_user_key: string | null;
  use_pushover: boolean | null;
  tz_offset_minutes: number | null;
  daily_log_reminder_time: string | null;
  daily_log_reminder_last_date: string | null;
}

async function sendReminders() {
  const r = await dbFetch(
    'zane_user_settings?daily_log_reminder_enabled=eq.true&push_enabled=eq.true&select=user_id,pushover_user_key,use_pushover,tz_offset_minutes,daily_log_reminder_time,daily_log_reminder_last_date'
  );
  // A non-2xx PostgREST response is still valid JSON (an error object, not an
  // array), so `.json().catch(...)` alone never catches it: `rows` would be
  // that object and the for-of below would throw "not iterable". Bail out
  // loudly instead of taking down the whole cron invocation silently.
  if (!r.ok) { console.error(`[daily-log-reminder] settings query failed: ${r.status} ${await r.text().catch(() => '')}`); return; }
  const rows: Row[] = await r.json().catch(() => []);
  const now = Date.now();

  for (const row of rows) {
    // Shift "now" into the user's local wall clock via their UTC offset. The
    // shifted Date's UTC fields then read as local time / local date.
    const tz = row.tz_offset_minutes ?? 0;
    const shifted = new Date(now + tz * 60000);
    const localDate = shifted.toISOString().slice(0, 10);
    const localMsSinceMidnight =
      (shifted.getUTCHours() * 3600 + shifted.getUTCMinutes() * 60 + shifted.getUTCSeconds()) * 1000;

    // Already nudged on this local date: the daily throttle. null means never
    // fired, which must NOT skip the user.
    if (row.daily_log_reminder_last_date === localDate) continue;
    // Not time yet in the user's local clock (fires on the first */15 tick at
    // or after the set time).
    if (localMsSinceMidnight < hhmmToMs(row.daily_log_reminder_time ?? DEFAULT_REMINDER_TIME)) continue;

    // Today's weight. A failed fetch must NOT read as "no weight logged":
    // that would fire a false nudge at a user who already logged it, so skip
    // this user's check entirely rather than guessing on bad data.
    const dRes = await dbFetch(`zane_daily_logs?user_id=eq.${row.user_id}&date=eq.${localDate}&select=weight`);
    if (!dRes.ok) { console.error(`[daily-log-reminder] daily log query failed for ${row.user_id}: ${dRes.status}`); continue; }
    const dRows: { weight: number | null }[] = await dRes.json().catch(() => []);
    // A row for today with a non-null weight counts as logged (a logged 0 is
    // a weight too). Missing row or null weight = still unlogged, nudge.
    const logged = dRows.length > 0 && dRows[0].weight !== null;
    if (logged) continue;

    const title = 'Zane · Daily Log Reminder';
    const message = "Don't forget to log your weight today. ⚖️";

    // Respect the user's channel choice: when Pushover is enabled (use_pushover
    // and a key set) send only Pushover, otherwise send native Web Push. This
    // matches the use_pushover "instead of Web Push" semantics used elsewhere,
    // so the user never gets the same nudge on both channels.
    const viaPushover = !!row.use_pushover && !!row.pushover_user_key;
    if (viaPushover) {
      try {
        const res = await fetch('https://api.pushover.net/1/messages.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: PUSHOVER_TOKEN, user: row.pushover_user_key, title, message, priority: 0, ttl: 43200 }),
        });
        console.log(`[daily-log-reminder] pushover sent to ${row.user_id}: ${res.status}`);
      } catch (e) {
        console.error(`[daily-log-reminder] pushover error for ${row.user_id}:`, e);
      }
    } else {
      await sendWebPush(row.user_id, title, message);
    }

    // Stamp the daily throttle regardless of push success so the same nudge
    // does not re-fire on the next tick (a duplicate is worse than a miss:
    // the intent was sent at least once). A failed write is logged loudly;
    // the refire risk it leaves is bounded to the next tick, same posture as
    // the water reminder's throttle write. "Logged loudly" has to include a
    // 4xx/5xx response: fetch resolves on those, so without the status check
    // a rejected write reads as a successful one and the nudge repeats every
    // tick for the rest of the day with nothing in the logs to show for it.
    try {
      const res = await dbFetch(`zane_user_settings?user_id=eq.${row.user_id}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({ daily_log_reminder_last_date: localDate }),
      });
      if (!res.ok) {
        console.error(`[daily-log-reminder] throttle write failed for ${row.user_id}: ${res.status} ${await res.text().catch(() => '')}`);
      }
    } catch (e) {
      console.error(`[daily-log-reminder] throttle write error for ${row.user_id}:`, e);
    }
  }
}

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

  if (req.method === 'POST') {
    await sendReminders();
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
