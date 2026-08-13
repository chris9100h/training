// Meal reminder cron function (Plan Mode). Mirrors the water reminder: for each
import { sendNotification } from '../_shared/notifications.ts';
import { localClock } from '../_shared/time.ts';

// opted-in user it finds today's PLANNED (not-yet-checked-off) food entries and
// nudges when one is still unchecked an hour past its planned time. The 8:00
// meal fires at 9:00 if you haven't logged it by then.
//
// A server-side delivery ledger makes the event retryable: provider failures
// leave the meal undelivered and later hourly ticks retry it, while a successful
// handoff is never sent again. The retry horizon is one local day, so a stale
// planned entry cannot nag forever.
//
// Scheduled via pg_cron (migration 0201_meal_reminder.sql), POST with an empty
// body, same pattern as the training/water reminders (migrations 0028/0182).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const GRACE_MS = 60 * 60 * 1000;      // fire once a planned meal is this far past its time
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RETRY_COOLDOWN_MS = 50 * 60 * 1000;
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

interface Row {
  user_id: string;
  pushover_user_key: string | null;
  use_pushover: boolean | null;
  time_zone: string | null;
  tz_offset_minutes: number | null;
}

async function sendReminders() {
  // Only Plan Mode users who opted into meal reminders and have push on. Gating
  // on plan_mode here means turning Plan Mode off silently stops the nudges
  // without having to also flip the reminder toggle.
  const r = await dbFetch(
    'zane_user_settings?meal_reminder_enabled=eq.true&plan_mode=eq.true&push_enabled=eq.true&select=user_id,pushover_user_key,use_pushover,time_zone,tz_offset_minutes'
  );
  // A non-2xx PostgREST response is still valid JSON (an error object, not an
  // array), so `.json().catch(...)` alone never catches it: `rows` would be
  // that object and the for-of below would throw "not iterable". Bail out
  // loudly instead of taking down the whole cron invocation silently.
  if (!r.ok) { console.error(`[meal-reminder] settings query failed: ${r.status} ${await r.text().catch(() => '')}`); return; }
  const rows: Row[] = await r.json().catch(() => []);
  const now = Date.now();

  for (const row of rows) {
    const local = localClock(now, row.time_zone, row.tz_offset_minutes);
    const localDate = local.date;
    // Yesterday's local date too: a meal at/after 23:00 has its (time + 1h grace)
    // land AFTER local midnight, i.e. on the next local day, where the row is no
    // longer "today". Querying yesterday as well lets those late meals fire in
    // the first tick(s) after midnight instead of never (an earlier bug).
    const yesterday = local.yesterday;
    const localMsSinceMidnight = local.msSinceMidnight;

    // A user who explicitly finished the day may still keep planned meals in
    // the timeline for reference. They must not receive reminders after that
    // explicit decision, so read the synced day-close flag before selecting
    // the still-planned entries.
    const closedRes = await dbFetch(
      `zane_daily_logs?user_id=eq.${row.user_id}&date=in.(${yesterday},${localDate})&select=date,food_day_closed`
    );
    if (!closedRes.ok) { console.error(`[meal-reminder] daily log query failed for ${row.user_id}: ${closedRes.status}`); continue; }
    const closedPayload = await closedRes.json().catch(() => []);
    const closedRows: { date: string; food_day_closed: boolean | null }[] = Array.isArray(closedPayload) ? closedPayload : [];
    const closedDates = new Set(closedRows.filter(log => log.food_day_closed).map(log => log.date));

    // Still-planned (unchecked) entries for today and yesterday. A failed fetch
    // must not be read as "nothing planned", so skip this user rather than guess.
    const eRes = await dbFetch(
      `zane_food_logs?user_id=eq.${row.user_id}&date=in.(${yesterday},${localDate})&planned=eq.true&select=id,date,time,food_name`
    );
    if (!eRes.ok) { console.error(`[meal-reminder] food log query failed for ${row.user_id}: ${eRes.status}`); continue; }
    const entryPayload = await eRes.json().catch(() => []);
    const entries: { id: string; date: string | null; time: string | null; food_name: string | null }[] = (Array.isArray(entryPayload) ? entryPayload : [])
      .filter(entry => !entry.date || !closedDates.has(entry.date));
    const ids = entries.map(entry => entry.id);
    if (!ids.length) continue;
    const deliveryRes = await dbFetch(`zane_meal_reminder_deliveries?user_id=eq.${row.user_id}&food_log_id=in.(${ids.join(',')})&select=food_log_id,last_attempt_at,delivered_at`);
    if (!deliveryRes.ok) {
      console.error(`[meal-reminder] delivery ledger query failed for ${row.user_id}: ${deliveryRes.status}`);
      continue;
    }
    const deliveries: { food_log_id: string; last_attempt_at: string | null; delivered_at: string | null }[] = await deliveryRes.json().catch(() => []);
    const deliveryById = new Map(deliveries.map(delivery => [delivery.food_log_id, delivery]));

    // A meal is due once its planned time plus grace has passed. The ledger
    // below handles retries and suppresses already delivered reminders.
    const due = entries.filter(e => {
      const [h, m] = (e.time ?? '0:0').split(':').map(Number);
      const mealMs = ((h || 0) * 3600 + (m || 0) * 60) * 1000;
      const dayOffset = e.date === localDate ? 0 : DAY_MS;
      const past = localMsSinceMidnight + dayOffset - mealMs - GRACE_MS;
      const delivery = deliveryById.get(e.id);
      if (delivery?.delivered_at) return false;
      if (delivery?.last_attempt_at && now - new Date(delivery.last_attempt_at).getTime() < RETRY_COOLDOWN_MS) return false;
      return past >= 0 && past < RETRY_WINDOW_MS;
    });
    if (!due.length) continue;

    const dueIds = due.map(entry => entry.id);
    const attemptRes = await dbFetch('zane_meal_reminder_deliveries', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(dueIds.map(food_log_id => ({ user_id: row.user_id, food_log_id }))),
    });
    if (!attemptRes.ok) {
      console.error(`[meal-reminder] delivery ledger seed failed for ${row.user_id}: ${attemptRes.status}`);
      continue;
    }
    // Claim only rows whose previous attempt is old enough. PostgREST applies
    // this PATCH atomically, so a concurrent cron invocation receives an empty
    // representation instead of sending a duplicate notification.
    const cutoff = new Date(now - RETRY_COOLDOWN_MS).toISOString();
    const claimRes = await dbFetch(`zane_meal_reminder_deliveries?user_id=eq.${row.user_id}&food_log_id=in.(${dueIds.join(',')})&delivered_at=is.null&or=(last_attempt_at.is.null,last_attempt_at.lt.${cutoff})`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ last_attempt_at: new Date(now).toISOString() }),
    });
    if (!claimRes.ok) {
      console.error(`[meal-reminder] delivery claim failed for ${row.user_id}: ${claimRes.status}`);
      continue;
    }
    const claimed: { food_log_id: string }[] = await claimRes.json().catch(() => []);
    const claimedIds = new Set(claimed.map(entry => entry.food_log_id));
    if (!claimedIds.size) continue;

    // Build the notification text from what THIS tick actually claimed, not
    // the full pre-claim `due` list above: a concurrent invocation (e.g. a
    // manual POST test racing the hourly cron, both explicitly supported by
    // this handler) can claim only a subset of dueIds, and the sent text
    // must describe exactly that subset, not a stale full count/name.
    const toNotify = due.filter(entry => claimedIds.has(entry.id));
    const title = 'Zane · Meal Reminder';
    const message = toNotify.length === 1
      ? `Still on the plan? Time to log your ${toNotify[0].food_name || 'planned meal'}. 🍽️`
      : `You have ${toNotify.length} planned meals still to log. 🍽️`;

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
      logPrefix: 'meal-reminder',
      ttl: 10800,
    });
    if (!delivered) continue;

    const deliveredRes = await dbFetch(`zane_meal_reminder_deliveries?user_id=eq.${row.user_id}&food_log_id=in.(${[...claimedIds].join(',')})`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ delivered_at: new Date(now).toISOString() }),
    });
    if (!deliveredRes.ok) {
      console.error(`[meal-reminder] delivery success ledger write failed for ${row.user_id}: ${deliveredRes.status} (the next tick may retry)`);
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
