// Meal reminder cron function (Plan Mode). Mirrors the water reminder: for each
// opted-in user it finds today's PLANNED (not-yet-checked-off) food entries and
// nudges when one is still unchecked an hour past its planned time. The 8:00
// meal fires at 9:00 if you haven't logged it by then.
//
// Fire-once is achieved by a window equal to the cron cadence instead of a
// throttle column: a meal only fires on the single cron tick where "now" first
// crosses (planned time + grace), i.e. the overdue moment landed within the last
// interval. The cron runs hourly and the window is 1h, so a meal's threshold
// falls inside exactly one tick's window and there is no re-nag and no per-entry
// bookkeeping. Planned meals sit on the hour (a template slot's time is HH:00),
// so an on-the-hour meal fires precisely at its +1h point; a manually-planned
// off-the-hour meal fires at the following hourly tick, which is fine for a
// "you forgot to log this" nudge. Both today and yesterday are queried: a meal
// at/after 23:00 has its +1h threshold land after local midnight, so it is
// measured against "now + a full day" and fires in the first tick(s) of the
// next local day rather than never.
//
// Scheduled via pg_cron (migration 0201_meal_reminder.sql), POST with an empty
// body, same pattern as the training/water reminders (migrations 0028/0182).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const PUSHOVER_TOKEN = 'a2vfbj4vu92hwzp5t9b6cbzkc18vw9';
const GRACE_MS = 60 * 60 * 1000;      // fire once a planned meal is this far past its time
const WINDOW_MS = 60 * 60 * 1000;     // = cron cadence (hourly): the meal fires on the tick that crosses the grace threshold
const DAY_MS = 24 * 60 * 60 * 1000;   // one local day, for the late-meal (>=23:00) day-boundary look-back

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
  }).catch(e => console.error(`[meal-reminder] web-push error for ${userId}:`, e));
}

interface Row {
  user_id: string;
  pushover_user_key: string | null;
  use_pushover: boolean | null;
  tz_offset_minutes: number | null;
}

async function sendReminders() {
  // Only Plan Mode users who opted into meal reminders and have push on. Gating
  // on plan_mode here means turning Plan Mode off silently stops the nudges
  // without having to also flip the reminder toggle.
  const r = await dbFetch(
    'zane_user_settings?meal_reminder_enabled=eq.true&plan_mode=eq.true&push_enabled=eq.true&select=user_id,pushover_user_key,use_pushover,tz_offset_minutes'
  );
  // A non-2xx PostgREST response is still valid JSON (an error object, not an
  // array), so `.json().catch(...)` alone never catches it: `rows` would be
  // that object and the for-of below would throw "not iterable". Bail out
  // loudly instead of taking down the whole cron invocation silently.
  if (!r.ok) { console.error(`[meal-reminder] settings query failed: ${r.status} ${await r.text().catch(() => '')}`); return; }
  const rows: Row[] = await r.json().catch(() => []);
  const now = Date.now();

  for (const row of rows) {
    // Shift "now" into the user's local wall clock via their UTC offset. The
    // shifted Date's UTC fields then read as local time / local date.
    const tz = row.tz_offset_minutes ?? 0;
    const shifted = new Date(now + tz * 60000);
    const localDate = shifted.toISOString().slice(0, 10);
    // Yesterday's local date too: a meal at/after 23:00 has its (time + 1h grace)
    // land AFTER local midnight, i.e. on the next local day, where the row is no
    // longer "today". Querying yesterday as well lets those late meals fire in
    // the first tick(s) after midnight instead of never (an earlier bug).
    const yesterday = new Date(shifted.getTime() - DAY_MS).toISOString().slice(0, 10);
    const localMsSinceMidnight =
      (shifted.getUTCHours() * 3600 + shifted.getUTCMinutes() * 60 + shifted.getUTCSeconds()) * 1000;

    // Still-planned (unchecked) entries for today and yesterday. A failed fetch
    // must not be read as "nothing planned", so skip this user rather than guess.
    const eRes = await dbFetch(
      `zane_food_logs?user_id=eq.${row.user_id}&date=in.(${yesterday},${localDate})&planned=eq.true&select=date,time,food_name`
    );
    if (!eRes.ok) { console.error(`[meal-reminder] food log query failed for ${row.user_id}: ${eRes.status}`); continue; }
    const entries: { date: string | null; time: string | null; food_name: string | null }[] = await eRes.json().catch(() => []);

    // A meal is due for a nudge if its (planned time + grace) crossed the current
    // clock within the last cron interval: 0 <= now - (mealTime + grace) < WINDOW.
    // A yesterday row is measured against "now + a full day" so a 23:00 meal's
    // threshold (24:00 = today 00:00) is reached exactly at the first tick today;
    // an ordinary yesterday meal is then far past the window and never re-fires.
    const due = entries.filter(e => {
      const [h, m] = (e.time ?? '0:0').split(':').map(Number);
      const mealMs = ((h || 0) * 3600 + (m || 0) * 60) * 1000;
      const dayOffset = e.date === localDate ? 0 : DAY_MS;
      const past = localMsSinceMidnight + dayOffset - mealMs - GRACE_MS;
      return past >= 0 && past < WINDOW_MS;
    });
    if (!due.length) continue;

    const title = 'Zane · Meal Reminder';
    const message = due.length === 1
      ? `Still on the plan? Time to log your ${due[0].food_name || 'planned meal'}. 🍽️`
      : `You have ${due.length} planned meals still to log. 🍽️`;

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
        console.log(`[meal-reminder] pushover sent to ${row.user_id}: ${res.status}`);
      } catch (e) {
        console.error(`[meal-reminder] pushover error for ${row.user_id}:`, e);
      }
    } else {
      await sendWebPush(row.user_id, title, message);
    }
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
