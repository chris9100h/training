// Medication reminder cron function (Medications feature). Mirrors the meal
import { localClock } from '../_shared/time.ts';
import { sendNotification } from '../_shared/notifications.ts';

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
//   - nudged once (reminder_count = 1) and >= 2h (minus NUDGE_SLACK_MS, see
//     below) since that nudge: second nudge.
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

const GRACE_MS = 60 * 60 * 1000;      // fire once a scheduled dose is this far past its time
const NUDGE_MS = 2 * 60 * 60 * 1000;  // second nudge no sooner than this long after the first
const WINDOW_MS = 60 * 60 * 1000;     // yesterday-row bound: only the tick that crosses a late dose's threshold
const DAY_MS = 24 * 60 * 60 * 1000;   // one local day, for the late-dose (>=23:00) day-boundary look-back
// Tolerance on the NUDGE_MS check only (see `due` below): unlike GRACE_MS,
// which compares THIS tick's own `now` against a fixed schedule time and so
// can only ever run late relative to the hour it fires in, NUDGE_MS compares
// this tick's `now` against `sentAt`, a timestamp stamped by a DIFFERENT,
// earlier tick's own `Date.now()`. Both invocations carry independent
// cron-dispatch/cold-start latency (observed a few seconds), so whenever the
// later tick happens to start faster than the earlier one did, a strict
// `now >= sentAt + NUDGE_MS` can miss by a couple seconds, deferring the
// nudge a full hour, and if the dose gets logged before that next tick, the
// second nudge silently never fires at all (confirmed happening 2026-08-11).
// 5 minutes comfortably covers that jitter without blurring which hourly
// tick is "meant" to catch a given row.
const NUDGE_SLACK_MS = 5 * 60 * 1000;

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
    // is_template excluded: a plan a coach builds FOR a client sits in the
    // coach's own account until it is pushed. Without this filter the coach
    // got real reminders to take their client's medication. Defence in depth,
    // the client now also refuses to leave a template active.
    dbFetch(`zane_medication_plans?user_id=eq.${userId}&active=eq.true&is_template=eq.false&select=id`),
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
    // ignore-duplicates, NOT merge-duplicates. The id is deterministic
    // (md_<date>_<slot>), so an upsert here overwrites a row that already
    // exists for that slot and day, and the only reason one exists is that the
    // user already acted on it: taking a dose sets planned false, and
    // merge-duplicates flipped it straight back to true, reopening a dose the
    // user had ticked off. Materialisation only ever needs to CREATE the
    // missing rows; it has no business updating one.
    headers: { 'Prefer': 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(toInsert),
  });
  if (!insRes.ok) console.error(`[medication-reminder] materialize insert failed for ${userId}: ${insRes.status} ${await insRes.text().catch(() => '')}`);
}

async function sendReminders() {
  // Only Medications users who opted into dose reminders and have push on.
  // Gating on meds_enabled here means turning the whole feature off silently
  // stops the nudges too, without also having to flip the reminder toggle.
  const r = await dbFetch(
    'zane_user_settings?medication_reminder_enabled=eq.true&meds_enabled=eq.true&push_enabled=eq.true&select=user_id,pushover_user_key,use_pushover,time_zone,tz_offset_minutes'
  );
  // A non-2xx PostgREST response is still valid JSON (an error object, not an
  // array), so `.json().catch(...)` alone never catches it: `rows` would be
  // that object and the for-of below would throw "not iterable". Bail out
  // loudly instead of taking down the whole cron invocation silently.
  if (!r.ok) { console.error(`[medication-reminder] settings query failed: ${r.status} ${await r.text().catch(() => '')}`); return; }
  const rows: Row[] = await r.json().catch(() => []);
  const now = Date.now();

  for (const row of rows) {
    const local = localClock(now, row.time_zone, row.tz_offset_minutes);
    const localDate = local.date;
    // Yesterday's local date too: a dose at/after 23:00 has its (time + 1h
    // grace) land AFTER local midnight, i.e. on the next local day, where the
    // row is no longer "today". Querying yesterday as well lets those late
    // doses fire in the first tick(s) after midnight instead of never.
    const yesterday = local.yesterday;
    const localMsSinceMidnight = local.msSinceMidnight;

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
      return now >= sentAt + NUDGE_MS - NUDGE_SLACK_MS;
    });
    if (!due.length) continue;

    // Persist the fired state FIRST, then push: reminder_sent_at stamps now
    // and reminder_count advances, so a failed STATE PATCH cannot leave the
    // count where it was and re-fire the same nudge on every hourly tick
    // forever, unbounded, for as long as the underlying PATCH failure
    // persists (a push-first order only ever protects the ONE failure mode
    // it defers past, whichever operation still runs second inherits this
    // exact risk if it fails; state patches are the one it's actually
    // possible to protect on both sides of, via the rollback below). Rows in
    // one tick can sit at different counts (a first nudge for one dose, a
    // second for another), so group by the target count and PATCH each
    // group once. Only touches the reminder columns, never planned/date/etc,
    // so logging the dose later works unchanged. Rows whose state failed to
    // persist are NOT pushed this tick: they retry next tick with the count
    // unchanged, one attempt per tick instead of unbounded duplicates.
    const byCount = new Map<number, string[]>();
    for (const e of due) {
      const target = (e.reminder_count ?? 0) + 1;
      const ids = byCount.get(target) ?? [];
      ids.push(e.id);
      byCount.set(target, ids);
    }
    // Compare-and-swap, not a blind write, exactly like meal-reminder's own
    // claim: the filter pins reminder_count to the value this tick READ, so
    // PostgREST applies it atomically and a concurrent invocation (a manual
    // POST racing the hourly cron, both explicitly supported by this handler)
    // matches zero rows instead of claiming the same dose a second time. With
    // a bare id filter both invocations got a 2xx, both pushed the identical
    // nudge, and the row was left one short of its target, so the 2h follow-up
    // branch fired a THIRD nudge past the 2-per-day cap documented above.
    // return=representation rather than minimal so `claimed` is what this tick
    // actually won, which is also what the message below must describe.
    const claimedIds = new Set<string>();
    for (const [target, ids] of byCount) {
      // reminder_count is NOT NULL DEFAULT 0 (migration 0246), so eq.<target-1>
      // covers the first nudge (eq.0) as well, no null branch needed.
      const patchRes = await dbFetch(`zane_medication_logs?id=in.(${ids.join(',')})&reminder_count=eq.${target - 1}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({ reminder_sent_at: new Date(now).toISOString(), reminder_count: target }),
      });
      if (!patchRes.ok) {
        console.error(`[medication-reminder] state patch failed for ${row.user_id}: ${patchRes.status} ${await patchRes.text().catch(() => '')}`);
        continue;
      }
      // The PATCH is COMMITTED at this point, so an unreadable body must not be
      // treated as "claimed nothing": that would skip the push AND skip the
      // compensating rollback below, leaving every row in this group marked as
      // nudged with nothing sent and no trace. Fall back to the ids this group
      // asked for, which is what the pre-CAS code effectively did on a 2xx. The
      // Array.isArray guard matters too: a 2xx body that parses to a non-array
      // would make .forEach throw, and sendReminders has no try/catch above it,
      // so one odd response would abort the whole tick and skip every user
      // after this one.
      const parsed = await patchRes.json().catch(() => null);
      if (Array.isArray(parsed)) {
        parsed.forEach((r: { id?: string }) => { if (r?.id) claimedIds.add(r.id); });
      } else {
        console.error(`[medication-reminder] unreadable claim response for ${row.user_id}, assuming the committed PATCH claimed all ${ids.length} rows`);
        ids.forEach(id => claimedIds.add(id));
      }
    }
    // Only what this tick actually claimed, so the count/name in the message
    // can never describe a dose another invocation is nudging about.
    const toPush = due.filter(e => claimedIds.has(e.id));
    if (!toPush.length) continue;

    const title = 'Zane · Medication Reminder';
    const message = toPush.length === 1
      ? `Still due: ${toPush[0].medication_name || 'a scheduled dose'}. 💊`
      : `You have ${toPush.length} scheduled doses still to log. 💊`;

    // Shared with the other reminder crons: picks Pushover INSTEAD of Web
    // Push when the user chose that channel (so the user never gets the same
    // nudge on both), calls the Pushover API directly for a real synchronous
    // status, and pre-checks zane_push_subscriptions before calling web-push
    // so a dead/missing subscription is detected instead of counted as sent.
    const delivered = await sendNotification({
      userId: row.user_id,
      title,
      message,
      usePushover: row.use_pushover,
      pushoverUserKey: row.pushover_user_key,
      logPrefix: 'medication-reminder',
    });

    // Compensating rollback: the state PATCH above already advanced every
    // row in toPush, but delivery just failed (including the "no
    // subscription to deliver to" case sendWebPush itself now detects), so
    // nothing actually reached the user despite the persisted state now
    // claiming otherwise. Restore each row's own PRE-tick reminder_count/
    // reminder_sent_at (captured from `due`, before this tick touched them)
    // so the next tick's due-filter sees these doses as still owed a nudge
    // and retries them, instead of silently under-notifying with no path
    // back. One PATCH per row since rows can have had different prior
    // counts/timestamps; only reached on an actual detected delivery
    // failure, not the common path. Checks res.ok same as the state PATCH
    // above, not just a rejected promise: an HTTP-level failure here (RLS,
    // a transient 5xx, ...) resolves normally rather than throwing, and
    // silently trusting that as "rolled back" would leave the row
    // permanently marked nudged with nothing having gone out, exactly the
    // failure this rollback exists to prevent, just one layer deeper and
    // with no log trail. Nothing left to retry the rollback itself with
    // this tick, so a failure here is logged, not silently accepted.
    if (!delivered) {
      await Promise.all(toPush.map(async e => {
        try {
          const rollbackRes = await dbFetch(`zane_medication_logs?id=eq.${e.id}`, {
            method: 'PATCH',
            headers: { 'Prefer': 'return=minimal' },
            body: JSON.stringify({ reminder_sent_at: e.reminder_sent_at, reminder_count: e.reminder_count ?? 0 }),
          });
          if (!rollbackRes.ok) console.error(`[medication-reminder] rollback patch failed for ${e.id}: ${rollbackRes.status} ${await rollbackRes.text().catch(() => '')}`);
        } catch (err) {
          console.error(`[medication-reminder] rollback patch error for ${e.id}:`, err);
        }
      }));
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
