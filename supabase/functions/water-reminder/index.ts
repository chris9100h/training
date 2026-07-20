// Water reminder cron function. Mirrors the training `reminder` function but
// computes a hydration ramp: for each opted-in user it places "now" on the
// linear expected curve between their daily start and end time (using the
// client-written tz_offset_minutes so no timezone guessing), compares against
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

const PUSHOVER_TOKEN = 'a2vfbj4vu92hwzp5t9b6cbzkc18vw9';
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

async function sendWebPush(userId: string, title: string, message: string) {
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  return fetch(`${base}/functions/v1/web-push`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, title, message }),
  }).catch(e => console.error(`[water-reminder] web-push error for ${userId}:`, e));
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
  tz_offset_minutes: number | null;
}

async function sendReminders() {
  const r = await dbFetch(
    'zane_user_settings?water_reminder_enabled=eq.true&push_enabled=eq.true&select=user_id,pushover_user_key,use_pushover,water_goal_ml,water_start_time,water_end_time,water_last_push_at,tz_offset_minutes'
  );
  const rows: Row[] = await r.json().catch(() => []);
  const now = Date.now();

  for (const row of rows) {
    // Throttle: at most one nudge per cooldown window.
    if (row.water_last_push_at && now - new Date(row.water_last_push_at).getTime() < COOLDOWN_MS) continue;

    const goal = row.water_goal_ml ?? 2000;
    const start = hhmmToDecimal(row.water_start_time ?? '08:00');
    const end = hhmmToDecimal(row.water_end_time ?? '22:00');
    if (end <= start) continue;

    // Shift "now" into the user's local wall clock via their UTC offset. The
    // shifted Date's UTC fields then read as local time / local date.
    const tz = row.tz_offset_minutes ?? 0;
    const shifted = new Date(now + tz * 60000);
    const localH = shifted.getUTCHours() + shifted.getUTCMinutes() / 60;
    if (localH < start || localH > end) continue; // outside the daily window
    const localDate = shifted.toISOString().slice(0, 10);

    const expected = Math.round(goal * (localH - start) / (end - start));

    // Today's logged water (the client mirrors the day's sum into water_ml).
    const dRes = await dbFetch(`zane_daily_logs?user_id=eq.${row.user_id}&date=eq.${localDate}&select=water_ml`);
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
    const viaPushover = !!row.use_pushover && !!row.pushover_user_key;
    if (viaPushover) {
      try {
        const res = await fetch('https://api.pushover.net/1/messages.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: PUSHOVER_TOKEN, user: row.pushover_user_key, title, message, priority: 0, ttl: 10800 }),
        });
        console.log(`[water-reminder] pushover sent to ${row.user_id}: ${res.status}`);
      } catch (e) {
        console.error(`[water-reminder] pushover error for ${row.user_id}:`, e);
      }
    } else {
      await sendWebPush(row.user_id, title, message);
    }

    await dbFetch(`zane_user_settings?user_id=eq.${row.user_id}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ water_last_push_at: new Date(now).toISOString() }),
    }).catch(e => console.error(`[water-reminder] throttle write error for ${row.user_id}:`, e));
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method === 'POST') {
    await sendReminders();
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
