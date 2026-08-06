// Medication reminder cron function (Medications feature). Mirrors the meal
// reminder's channel mechanics (opted-in users, push via Pushover or Web
// Push) but firing is STATE-BASED rather than window-based since the
// follow-up feature (2026-08, migration 0246): each still-planned dose row
// carries reminder_sent_at / reminder_count / snoozed_until, and the rules
// per row are:
//   - snoozed_until > now: skipped. The client's "Snooze 1h" button on a
//     still-due row (screens-medications.jsx) writes this through the
//     normal log sync; nudging resumes once it expires.
//   - never nudged yet (reminder_count = 0) and past the +1h grace: first
//     nudge. State-based, not window-based, so a tick skipped by cron
//     downtime still nudges on the next tick instead of silently dropping
//     the only chance (the old 1h-window predicate had that failure mode).
//   - nudged once (reminder_count = 1) and >= 2h since that nudge: second
//     nudge.
//   - reminder_count >= 2: never again (cap: 2 nudges per day per dose).
// The per-row count is naturally per-day: each local date materializes its
// own planned row, so "per day" needs no separate reset.
//
// The one window bound that survives is for YESTERDAY rows: a dose at/after
// 23:00 has its +1h threshold land after local midnight, so it is measured
// against "now + a full day" and fires in the first tick(s) of the next
// local day. Ordinary yesterday rows must never re-nag (a dose missed
// yesterday morning is stale history, not a live problem), so a yesterday
// row only fires on the tick that actually crosses its threshold
// (past < WINDOW_MS), which also means late doses get no second nudge.
//
// Before checking what's due, materializeDueDoses fills in any due schedule
// slot that has no zane_medication_logs row yet for today/yesterday. The
// client only ever materializes today's doses itself when the Meds tab is
// mounted (mdAutoFillToday, screens-medications.jsx): a user who never opens
// the app that day would otherwise have no PLANNED row for this function to
// find "due" in the first place, so the reminder they turned on would
// silently never fire (audit-2026-08 M8). Uses the same deterministic id
// (`md_<date>_<slotId>`) and upsert-by-id semantics as the client's own
// sync, so whichever side materializes a given dose first, the other's later
// write just merges into that same row instead of duplicating it.
//
// Scheduled via pg_cron (migration 0219_medication_reminder_cron.sql, auth
// re-keyed to the Vault-backed CRON_SECRET in migration 0230), POST with an
// empty body, same pattern as the meal/training/water reminders.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Secret, never a literal: set it with `supabase secrets set PUSHOVER_TOKEN=...`.
const PUSHOVER_TOKEN = Deno.env.get('PUSHOVER_TOKEN') ?? '';
const GRACE_MS = 60 * 60 * 1000;      // fire once a scheduled dose is this far past its time
const NUDGE_MS = 2 * 60 * 60 * 1000;  // second nudge no sooner than this long after the first
const WINDOW_MS = 60 * 60 * 1000;     // yesterday-row bound: only the tick that crosses a late dose's threshold
const DAY_MS = 24 * 60 * 60 * 1000;   // one local day, for the late-dose (>=23:00) day-boundary look-back

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

async function sendWebPush(userId: string, title: string, message: string): Promise<boolean> {
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  // Everything is inside one try/catch: a fetch-level rejection here (DNS,
  // connection reset, timeout) must degrade to "failed, retry next tick"
  // like any other push failure, never abort the whole cron loop mid-tick
  // and rob every later user of their nudge.
  try {
    // Pre-check the subscription: web-push itself answers 202 before async
    // delivery and returns 202 even with no subscription rows, so a dead
    // subscription would otherwise count as "pushed" and silently consume
    // the nudge budget (count advances, the user never receives it, no
    // retry). Without any subscription there is nothing to deliver to, so
    // report failure and let the next tick retry (one cheap query per tick;
    // a later re-subscription then delivers).
    const subRes = await dbFetch(`zane_push_subscriptions?user_id=eq.${userId}&select=id`);
    if (!subRes.ok) return false;
    const subs: { id: string }[] = await subRes.json().catch(() => []);
    if (!subs.length) {
      console.error(`[medication-reminder] no web-push subscription for ${userId}, skipping nudge`);
      return false;
    }
    const res = await fetch(`${base}/functions/v1/web-push`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, title, message }),
    });
    return res.ok;
  } catch (e) {
    console.error(`[medication-reminder] web-push error for ${userId}:`, e);
    return false;
  }
}

interface Row {
  user_id: string;
  pushover_user_key: string | null;
  use_pushover: boolean | null;
  tz_offset_minutes: number | null;
}

interface Slot {
  id: string;
  medication_id: string;
  medication_plan_id: string | null;
  weekdays: number[] | null;
  hour: number;
  dose_qty: number | null;
  interval_days: number | null;
  start_date: string | null;
  end_date: string | null;
}

// ISO weekday (0 = Monday) for a YYYY-MM-DD date, noon-anchored to stay clear
// of any DST/rollover edge, same idiom as store.js's dsShiftDate.
function isoWd(dateISO: string): number {
  return (new Date(dateISO + 'T12:00:00').getDay() + 6) % 7;
}

// Hand-synced copy of store.js's dsSlotAppliesOn (that file isn't loadable
// here, it's a browser global-namespace script, not an importable module).
// Keep the two in lockstep on any schedule-matching change.
function slotAppliesOn(slot: Slot, dateISO: string, wd: number, activePlanIds: Set<string>): boolean {
  if (!slot.medication_plan_id || !activePlanIds.has(slot.medication_plan_id)) return false;
  if (slot.start_date && dateISO < slot.start_date) return false;
  if (slot.end_date && dateISO > slot.end_date) return false;
  if (slot.interval_days && slot.interval_days > 0) {
    if (!slot.start_date) return false;
    const daysSince = Math.round((new Date(dateISO + 'T12:00:00').getTime() - new Date(slot.start_date + 'T12:00:00').getTime()) / 86400000);
    return daysSince % slot.interval_days === 0;
  }
  return (slot.weekdays || []).includes(wd);
}

// Materializes any due-but-missing PLANNED dose for the given user across
// dateISOs (today + yesterday, mirroring sendReminders' own lookback), the
// server-side equivalent of the client's mdAutoFillToday. Without this, a
// user who doesn't open the Meds tab that day has no row here for
// sendReminders to ever find "due" below. A failed lookup query bails
// silently (same fail-closed-on-read posture as the rest of this file): a
// stray missing reminder for one tick is a much smaller failure than
// materializing off a partial/wrong picture of what's active.
async function materializeDueDoses(userId: string, dateISOs: string[]) {
  const [plansRes, slotsRes, medsRes, logsRes] = await Promise.all([
    dbFetch(`zane_medication_plans?user_id=eq.${userId}&active=eq.true&select=id`),
    dbFetch(`zane_medication_schedule_slots?user_id=eq.${userId}&select=id,medication_id,medication_plan_id,weekdays,hour,dose_qty,interval_days,start_date,end_date`),
    dbFetch(`zane_medications?user_id=eq.${userId}&archived=eq.false&select=id,name`),
    dbFetch(`zane_medication_logs?user_id=eq.${userId}&date=in.(${dateISOs.join(',')})&schedule_slot_id=not.is.null&select=date,schedule_slot_id`),
  ]);
  if (!plansRes.ok || !slotsRes.ok || !medsRes.ok || !logsRes.ok) {
    console.error(`[medication-reminder] materialize lookup failed for ${userId}`);
    return;
  }
  const activePlanIds = new Set<string>((await plansRes.json().catch(() => [])).map((p: { id: string }) => p.id));
  const slots: Slot[] = await slotsRes.json().catch(() => []);
  const meds = new Map<string, { id: string; name: string }>(
    (await medsRes.json().catch(() => [])).map((m: { id: string; name: string }) => [m.id, m])
  );
  const existing = new Set<string>(
    (await logsRes.json().catch(() => [])).map((l: { date: string; schedule_slot_id: string }) => `${l.date}_${l.schedule_slot_id}`)
  );

  // deno-lint-ignore no-explicit-any
  const toInsert: any[] = [];
  for (const dateISO of dateISOs) {
    const wd = isoWd(dateISO);
    for (const slot of slots) {
      const med = meds.get(slot.medication_id);
      if (!med || existing.has(`${dateISO}_${slot.id}`)) continue;
      if (!slotAppliesOn(slot, dateISO, wd, activePlanIds)) continue;
      toInsert.push({
        id: `md_${dateISO}_${slot.id}`, user_id: userId, medication_id: med.id, medication_name: med.name,
        date: dateISO, time: `${String(slot.hour).padStart(2, '0')}:00`, dose_qty: slot.dose_qty,
        planned: true, schedule_slot_id: slot.id,
      });
    }
  }
  if (!toInsert.length) return;
  const insRes = await dbFetch('zane_medication_logs', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(toInsert),
  });
  if (!insRes.ok) console.error(`[medication-reminder] materialize insert failed for ${userId}: ${insRes.status} ${await insRes.text().catch(() => '')}`);
}

async function sendReminders() {
  // Only Medications users who opted into dose reminders and have push on.
  // Gating on meds_enabled here means turning the whole feature off silently
  // stops the nudges too, without also having to flip the reminder toggle.
  const r = await dbFetch(
    'zane_user_settings?medication_reminder_enabled=eq.true&meds_enabled=eq.true&push_enabled=eq.true&select=user_id,pushover_user_key,use_pushover,tz_offset_minutes'
  );
  // A non-2xx PostgREST response is still valid JSON (an error object, not an
  // array), so `.json().catch(...)` alone never catches it: `rows` would be
  // that object and the for-of below would throw "not iterable". Bail out
  // loudly instead of taking down the whole cron invocation silently.
  if (!r.ok) { console.error(`[medication-reminder] settings query failed: ${r.status} ${await r.text().catch(() => '')}`); return; }
  const rows: Row[] = await r.json().catch(() => []);
  const now = Date.now();

  for (const row of rows) {
    // Shift "now" into the user's local wall clock via their UTC offset. The
    // shifted Date's UTC fields then read as local time / local date.
    const tz = row.tz_offset_minutes ?? 0;
    const shifted = new Date(now + tz * 60000);
    const localDate = shifted.toISOString().slice(0, 10);
    // Yesterday's local date too: a dose at/after 23:00 has its (time + 1h
    // grace) land AFTER local midnight, i.e. on the next local day, where the
    // row is no longer "today". Querying yesterday as well lets those late
    // doses fire in the first tick(s) after midnight instead of never.
    const yesterday = new Date(shifted.getTime() - DAY_MS).toISOString().slice(0, 10);
    const localMsSinceMidnight =
      (shifted.getUTCHours() * 3600 + shifted.getUTCMinutes() * 60 + shifted.getUTCSeconds()) * 1000;

    // Fill in whatever the client hasn't materialized itself yet (see
    // materializeDueDoses above) before asking what's still due below.
    await materializeDueDoses(row.user_id, [yesterday, localDate]);

    // Still-planned (unlogged) entries for today and yesterday. A failed
    // fetch must not be read as "nothing planned", so skip this user rather
    // than guess.
    const eRes = await dbFetch(
      `zane_medication_logs?user_id=eq.${row.user_id}&date=in.(${yesterday},${localDate})&planned=eq.true&select=id,date,time,medication_name,reminder_sent_at,reminder_count,snoozed_until`
    );
    if (!eRes.ok) { console.error(`[medication-reminder] medication log query failed for ${row.user_id}: ${eRes.status}`); continue; }
    const entries: { id: string; date: string | null; time: string | null; medication_name: string | null; reminder_sent_at: string | null; reminder_count: number | null; snoozed_until: string | null }[] = await eRes.json().catch(() => []);

    // A row is due for a nudge by its STATE, not by a time window:
    // snoozed_until > now suppresses everything until it expires; otherwise
    // a never-nudged row fires once its (time + grace) is in the past (any
    // tick, so a skipped cron tick cannot drop the nudge), a once-nudged row
    // fires a second time 2h (NUDGE_MS) after the first, and a twice-nudged
    // row is done for the day. A snoozed row fires on the first tick at/after
    // its snooze expiry (the user chose that moment: the expiry is a real
    // nudge time), regardless of the 2h gap AND regardless of the yesterday
    // bound, since the expiry can land after local midnight where that rule
    // would otherwise swallow the promised nudge. The yesterday bound only
    // applies to never-snoozed rows: a late (>=23:00) dose's threshold lands
    // after midnight, ordinary missed doses from yesterday must never re-nag.
    const due = entries.filter(e => {
      if (e.snoozed_until && new Date(e.snoozed_until).getTime() > now) return false;
      const [h, m] = (e.time ?? '0:0').split(':').map(Number);
      const doseMs = ((h || 0) * 3600 + (m || 0) * 60) * 1000;
      const dayOffset = e.date === localDate ? 0 : DAY_MS;
      const past = localMsSinceMidnight + dayOffset - doseMs - GRACE_MS;
      if (past < 0) return false;
      const count = e.reminder_count ?? 0;
      if (count >= 2) return false;
      const sentAt = e.reminder_sent_at ? new Date(e.reminder_sent_at).getTime() : 0;
      const snoozeUntil = e.snoozed_until ? new Date(e.snoozed_until).getTime() : 0;
      if (snoozeUntil > sentAt) return now >= snoozeUntil;
      if (e.date !== localDate && past >= WINDOW_MS) return false;
      if (count === 0) return true;
      return now >= sentAt + NUDGE_MS;
    });
    if (!due.length) continue;

    const title = 'Zane · Medication Reminder';
    const message = due.length === 1
      ? `Still due: ${due[0].medication_name || 'a scheduled dose'}. 💊`
      : `You have ${due.length} scheduled doses still to log. 💊`;

    // Send FIRST, then persist state only when the push actually landed: a
    // failed push must not advance reminder_count, or the nudge would be
    // silently lost forever with no retry (the earlier patch-first order had
    // the inverse failure mode, an endless re-fire loop when the state PATCH
    // failed; the older push-then-patch order swallowed push failures the
    // same way). At-least-once semantics: a push that landed but whose
    // response was lost retries next tick, a rare duplicate over a permanent
    // miss.
    const viaPushover = !!row.use_pushover && !!row.pushover_user_key;
    let pushed = false;
    if (viaPushover) {
      try {
        const res = await fetch('https://api.pushover.net/1/messages.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: PUSHOVER_TOKEN, user: row.pushover_user_key, title, message, priority: 0, ttl: 10800 }),
        });
        pushed = res.ok;
        console.log(`[medication-reminder] pushover sent to ${row.user_id}: ${res.status}`);
      } catch (e) {
        console.error(`[medication-reminder] pushover error for ${row.user_id}:`, e);
      }
    } else {
      pushed = await sendWebPush(row.user_id, title, message);
    }
    if (!pushed) continue;

    // Persist the fired state so the rules above stay true on later ticks:
    // reminder_sent_at stamps now and reminder_count advances. Rows in one
    // tick can sit at different counts (a first nudge for one dose, a
    // second for another), so group by the target count and PATCH each
    // group once. return=minimal: nothing to read back. Only touches the
    // reminder columns, never planned/date/etc, so logging the dose later
    // works unchanged. A failed PATCH here re-fires next tick (count
    // unchanged), one duplicate at most, the at-least-once tradeoff above.
    const byCount = new Map<number, string[]>();
    for (const e of due) {
      const target = (e.reminder_count ?? 0) + 1;
      const ids = byCount.get(target) ?? [];
      ids.push(e.id);
      byCount.set(target, ids);
    }
    for (const [target, ids] of byCount) {
      const patchRes = await dbFetch(`zane_medication_logs?id=in.(${ids.join(',')})`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({ reminder_sent_at: new Date(now).toISOString(), reminder_count: target }),
      });
      if (!patchRes.ok) console.error(`[medication-reminder] state patch failed for ${row.user_id}: ${patchRes.status} ${await patchRes.text().catch(() => '')}`);
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
