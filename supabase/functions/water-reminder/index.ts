import { sendNotification } from '../_shared/notifications.ts';
import { localClock } from '../_shared/time.ts';

// Water reminder cron function. Mirrors the training `reminder` function but
// computes a hydration ramp: for each opted-in user it places "now" on the
// linear expected curve between their daily start and end time (using the
// client-written time_zone, tz_offset_minutes only as a fallback for rows
// without a saved zone), compares against
// today's logged water, and if they are behind by more than THRESHOLD_ML sends
// a nudge through the existing web-push + Pushover channels. Throttled per user
// via water_last_push_at so a frequent cron tick never spams.
//
// Scheduled via pg_cron (migration 0182_water_reminder.sql), POST with an empty
// body, same pattern as the training reminder (migration 0028).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const THRESHOLD_ML = 250;              // only nudge when this far behind the ramp
const COOLDOWN_MS = 60 * 60 * 1000;    // at most one nudge per hour per user

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

function hhmmToDecimal(t: string): number {
  const [h, m] = (t || '0:0').split(':').map(Number);
  return (h || 0) + (m || 0) / 60;
}

interface Row {
  user_id: string;
  pushover_user_key: string | null;
  use_pushover: boolean | null;
  water_goal_ml: number | null;
  water_start_time: string | null;
  water_end_time: string | null;
  water_last_push_at: string | null;
  time_zone: string | null;
  tz_offset_minutes: number | null;
}

async function sendReminders() {
  const r = await dbFetch(
    'zane_user_settings?water_reminder_enabled=eq.true&push_enabled=eq.true&select=user_id,pushover_user_key,use_pushover,water_goal_ml,water_start_time,water_end_time,water_last_push_at,time_zone,tz_offset_minutes'
  );
  // A non-2xx PostgREST response is still valid JSON (an error object, not an
  // array), so `.json().catch(...)` alone never catches it: `rows` would be
  // that object and the for-of below would throw "not iterable". Bail out
  // loudly instead of taking down the whole cron invocation silently.
  if (!r.ok) { console.error(`[water-reminder] settings query failed: ${r.status} ${await r.text().catch(() => '')}`); return; }
  const rows: Row[] = await r.json().catch(() => []);
  const now = Date.now();

  for (const row of rows) {
    // Throttle: at most one nudge per cooldown window.
    if (row.water_last_push_at && now - new Date(row.water_last_push_at).getTime() < COOLDOWN_MS) continue;

    const goal = row.water_goal_ml ?? 2000;
    const start = hhmmToDecimal(row.water_start_time ?? '08:00');
    const end = hhmmToDecimal(row.water_end_time ?? '22:00');
    if (end <= start) continue;

    const local = localClock(now, row.time_zone, row.tz_offset_minutes);
    const localH = local.msSinceMidnight / 3600000;
    if (localH < start || localH > end) continue; // outside the daily window
    const localDate = local.date;

    const expected = Math.round(goal * (localH - start) / (end - start));

    // Today's logged water (the client mirrors the day's sum into water_ml).
    // A failed fetch must NOT read as "0 ml logged", that would fire a false
    // "you're behind" push at a user who already hit their goal, so skip this
    // user's check entirely rather than guessing on bad data.
    const dRes = await dbFetch(`zane_daily_logs?user_id=eq.${row.user_id}&date=eq.${localDate}&select=water_ml`);
    if (!dRes.ok) { console.error(`[water-reminder] daily log query failed for ${row.user_id}: ${dRes.status}`); continue; }
    const dRows: { water_ml: number | null }[] = await dRes.json().catch(() => []);
    const actual = dRows[0]?.water_ml ?? 0;

    if (expected - actual <= THRESHOLD_ML) continue; // on track

    const missing = Math.max(200, expected - actual);
    const title = 'Zane · Hydration';
    const message = `You're behind on water. Time for about ${missing} ml. 💧`;

    // Respect the user's channel choice: when Pushover is enabled (use_pushover
    // and a key set) send only Pushover, otherwise send native Web Push. This
    // matches the use_pushover "instead of Web Push" semantics used elsewhere,
    // so the user never gets the same nudge on both channels.
    const delivered = await sendNotification({
      userId: row.user_id,
      title,
      message,
      usePushover: row.use_pushover,
      pushoverUserKey: row.pushover_user_key,
      logPrefix: 'water-reminder',
      ttl: 10800,
    });
    if (!delivered) continue;

    // Stamp the throttle only after a successful handoff. fetch only rejects on transport failure, so a
    // PATCH that comes back 4xx/5xx resolves like a success and the write
    // silently never happened. Check the status explicitly, the same way
    // medication-reminder checks its state patch, otherwise a broken throttle
    // looks exactly like a working one in the logs.
    try {
      const res = await dbFetch(`zane_user_settings?user_id=eq.${row.user_id}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({ water_last_push_at: new Date(now).toISOString() }),
      });
      if (!res.ok) {
        console.error(`[water-reminder] throttle write failed for ${row.user_id}: ${res.status} ${await res.text().catch(() => '')}`);
      }
    } catch (e) {
      console.error(`[water-reminder] throttle write error for ${row.user_id}:`, e);
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
