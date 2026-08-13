/* Logbook store, Supabase backend */

const SUPABASE_URL = 'https://ebbuvdzgstrhrcsbrlez.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';

const PUSHOVER_URL          = `${SUPABASE_URL}/functions/v1/pushover`;
const WEB_PUSH_URL          = `${SUPABASE_URL}/functions/v1/web-push`;
const COACHING_NOTIFY_URL   = `${SUPABASE_URL}/functions/v1/zane_coaching-notify`;
const ADMIN_SEND_EMAIL_URL  = `${SUPABASE_URL}/functions/v1/admin-send-email`;
const FOOD_SEARCH_URL       = `${SUPABASE_URL}/functions/v1/search-foods`;
// One endpoint each, whichever AI backend the device is set to. Both used to
// be three endpoints (scan-label-claude/-qwen, parse-meal-grok/-qwen) that the
// client picked between by URL; the provider now travels in the request body
// and the edge function holds all three. Anything the function does not
// recognise falls back to that feature's default on its side too.
const SCAN_LABEL_URL        = `${SUPABASE_URL}/functions/v1/scan-label`;
const AI_DAILY_SUMMARY_URL  = `${SUPABASE_URL}/functions/v1/ai-daily-summary`;
const AI_CHECKIN_OPINION_URL = `${SUPABASE_URL}/functions/v1/ai-checkin-opinion`;
const PARSE_MEAL_URL        = `${SUPABASE_URL}/functions/v1/parse-meal`;

const VAPID_PUBLIC_KEY = 'BD14GEr1JXGYdRwx6kiqpZMTvbialpruEJnHUmcbxjOshGZvULZ10xqayRTt3iVCyTBWRIR5nsXNVSsP0YdKQDI';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function getWebPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function subscribeWebPush(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifications not supported in this browser');
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const json = sub.toJSON();
  await unwrap(_supabase.from('zane_push_subscriptions').upsert({
    id: json.endpoint,
    user_id: userId,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  }, { onConflict: 'id' }));
  return sub;
}

async function unsubscribeWebPush(userId) {
  const sub = await getWebPushSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await _supabase.from('zane_push_subscriptions').delete().eq('id', endpoint);
  }
}

const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { experimental: { passkey: true } },
});

// Await a PostgREST builder and throw if it resolved with an { error }. The
// supabase-js client does NOT throw on failed writes (network errors, RLS
// denials, constraint violations all come back as a resolved { error }), so
// without this a failed write looks identical to success. Wrapping every
// write that feeds the sync diff is what makes flushSync's retry path real.
// zane_food_logs carries two real FKs: food_id into the shared zane_foods
// cache (written fire-and-forget by an edge function) and recipe_id into
// zane_food_recipes. A single row whose parent never landed fails the whole
// upsert with 23503, and since the flush is one Promise.all over every table,
// that one row takes sessions, sets and health down with it on every retry,
// forever, with no repair path. Both ids are advisory: every macro is
// denormalized onto the row itself. So on 23503 retry without them rather
// than letting one dangling reference wedge the entire sync loop.
// Returns the same { data, error } shape the builder does, so unwrap() still
// decides success or failure.
async function foodLogUpsertWithFkFallback(rows) {
  const res = await _supabase.from('zane_food_logs').upsert(rows);
  if (!res?.error || res.error.code !== '23503') return res;
  const noFood = rows.map(r => ({ ...r, food_id: null }));
  const retry = await _supabase.from('zane_food_logs').upsert(noFood);
  if (!retry?.error || retry.error.code !== '23503') return retry;
  return await _supabase.from('zane_food_logs').upsert(noFood.map(r => ({ ...r, recipe_id: null })));
}

// Same self-heal as foodLogUpsertWithFkFallback above, but for
// zane_food_favorites: a favorite whose food_id points at a zane_foods row
// that was never actually cached server-side hits 23503 on every sync retry
// forever, with nothing to ever null it out. Only one fallback tier is needed
// here since favorites have no recipe_id column, only food_id.
async function foodFavoriteUpsertWithFkFallback(rows) {
  const res = await _supabase.from('zane_food_favorites').upsert(rows);
  if (!res?.error || res.error.code !== '23503') return res;
  const noFood = rows.map(r => ({ ...r, food_id: null }));
  return await _supabase.from('zane_food_favorites').upsert(noFood);
}

async function unwrap(builder) {
  const res = await builder;
  if (res && res.error) {
    throw Object.assign(new Error(res.error.message || 'Supabase request failed'), { cause: res.error });
  }
  return res;
}

// POST to an edge function authenticated as the signed-in user. The functions
// reject the bare anon key (security hardening), identity and push target are
// derived server-side from the caller's JWT. Never rejects; resolves with the
// Response, or null when there is no session / the request failed.
async function fnFetch(url, body) {
  try {
    const { data } = await _supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return null;
    return await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (_) { return null; }
}

function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }

// Canonical X handle input for the profile field. The UI accepts the common
// forms users paste (`name`, `@name`, and x.com/name), while the store keeps one
// stable value so every device and future social surface can use the same
// representation without re-parsing it.
function normalizeXHandle(value) {
  if (value == null) return null;
  let raw = String(value).trim();
  if (!raw) return null;
  const url = raw.match(/^(?:https?:\/\/)?(?:www\.)?x\.com\/([^/?#]+)\/?$/i);
  if (url) raw = url[1];
  raw = raw.replace(/^@/, '');
  return /^[A-Za-z0-9_]{1,15}$/.test(raw) ? `@${raw}` : null;
}

function xHandleUrl(value) {
  const handle = normalizeXHandle(value);
  return handle ? `https://x.com/${handle.slice(1)}` : null;
}

// Local calendar date as YYYY-MM-DD. Never use toISOString() here, that
// returns the UTC date, which is yesterday between midnight and UTC-offset
// o'clock (and tomorrow in negative-offset timezones from the evening on).
function todayISO() {
  return fmtISO(new Date());
}
// Local calendar date (YYYY-MM-DD) of an arbitrary Date. Shared helper so
// screens stop reaching for `new Date(x).toISOString().slice(0,10)`, which
// returns the UTC date and is off by one day for any non-UTC timezone.
function fmtISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Local wall-clock time as HH:MM. Shared helper (was duplicated identically
// in screens-water.jsx and screens-food.jsx as wtNowHHMM/fdNowHHMM) so a
// future change to how a logged time is captured doesn't need to be applied
// to more than one copy.
function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
// Short display date (e.g. "Wed, Jul 23"), en-US per the app-wide locale
// standard. Shared helper (was duplicated as healthFmtDate/fdFmtDate in
// screens-health.jsx/screens-food.jsx with a locale mismatch until both
// were standardized) so a future format tweak only needs to happen once.
function fmtDayLabel(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', opts);
}
// Noon-anchored YYYY-MM-DD shift (DST-safe: noon never crosses a date
// boundary). Shared helper, was duplicated byte-identically as
// fdShiftDate/wtShiftDate/mdShiftDate/healthShiftISO across four screens.
function shiftDate(dateStr, deltaDays) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + deltaDays);
  return fmtISO(d);
}
// Local wall-clock HH:MM from a Date or epoch-ms instant. Shared helper, was
// duplicated as fdHHMM (fasting card) and mdSnoozeHHMM (meds snooze hint).
function fmtHHMM(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
// Countdown clock H:MM:SS from a millisecond span. Shared helper, was
// duplicated as fdFmtClock (fasting card); distinct from fmtDuration below
// (m:ss), which is the session/rest idiom.
function fmtClock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
// Returns the coming Monday as YYYY-MM-DD (returns today if today is Monday).
function nextMondayISO() {
  const today = new Date();
  const daysUntil = (1 - today.getDay() + 7) % 7;
  const d = new Date(today);
  d.setDate(d.getDate() + daysUntil);
  return fmtISO(d);
}
// Returns the next D1 of a date-based cycle plan as YYYY-MM-DD.
// Returns today if today is already D1; otherwise the start of the next full rotation.
function nextCycleD1ISO(cycleStartDate, daysLen) {
  const today = new Date(); today.setHours(12, 0, 0, 0);
  if (!cycleStartDate || daysLen <= 0) return todayISO();
  const start = parseDate(cycleStartDate);
  const n = Math.max(0, Math.round((today - start) / 86400000));
  const pos = n % daysLen;
  const daysUntilD1 = pos === 0 ? 0 : daysLen - pos;
  const d = new Date(today);
  d.setDate(d.getDate() + daysUntilD1);
  return fmtISO(d);
}
// Version-aware wrapper: uses getCyclePosForDate when the plan has versions so
// cycleOffset and version boundaries are respected (same logic as the date strip).
// Falls back to cycleStartDate-based math for unversioned plans.
function nextCycleD1ISOFromSchedule(schedule, cycleStartDate) {
  const todayStr = todayISO();
  if (schedule?.versions?.length) {
    const pos = getCyclePosForDate(schedule, todayStr);
    if (pos !== null) {
      const vi = getActiveVersionIdx(schedule, todayStr);
      const activeV = vi >= 0 ? schedule.versions[vi] : null;
      const vDaysLen = (activeV?.days || schedule.days || []).length;
      if (vDaysLen > 0) {
        const today = new Date(); today.setHours(12, 0, 0, 0);
        const daysUntilD1 = pos === 0 ? 0 : vDaysLen - pos;
        const d = new Date(today);
        d.setDate(d.getDate() + daysUntilD1);
        return fmtISO(d);
      }
    }
  }
  return nextCycleD1ISO(cycleStartDate, (schedule?.days || []).length);
}

// ─── AUTH ────────────────────────────────────────────────────────────────

async function signIn(email, password) {
  const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signUp(email, password, name, unit = null) {
  const { data, error } = await _supabase.auth.signUp({
    email, password,
    options: { data: { name, unit } },   // store in user_metadata for email-confirm flow
  });
  if (error) throw error;
  if (data.session) {
    // Email confirmation disabled: the auth user exists and is signed in now.
    // Creating the profile/settings rows is best-effort here. If it fails (e.g. a
    // flaky in-app-browser network drop after the signup POST already succeeded),
    // loadFromSupabase recreates them from user_metadata on first load, so a
    // failure here must NOT surface as a registration error and strand a user
    // whose account was in fact created.
    try {
      await setupNewUser(data.user.id, name, unit);
    } catch (_) { /* self-heals in loadFromSupabase */ }
  }
  // if no session: email confirmation required, setupNewUser runs on first loadFromSupabase
  return data;
}

// Returns the client's { error } rather than swallowing it. Sign-out is not
// purely local: on a network failure the client returns before it removes the
// session, so nothing is signed out and no SIGNED_OUT fires. Callers that do
// anything after it (navigate, reload, wipe) have to be able to tell.
// Writes ONLY the derived adherence pair for a day, leaving updated_at alone so
// a recompute cannot win last-write-wins for the whole row (migration 0256).
// Resolves to false on failure rather than throwing: the values are derived and
// recomputed on the next boot, so a failed write must not take down the caller.
async function updateDailyLogDerived(date, adherence, targetsSnap) {
  const { error } = await _supabase.rpc('update_daily_log_derived', {
    p_date: date, p_adherence: adherence ?? null, p_targets_snap: targetsSnap ?? null,
  });
  if (error) { console.error('update_daily_log_derived failed', error); return false; }
  return true;
}

async function signOut() {
  return await _supabase.auth.signOut();
}

async function signInWithPasskey() {
  const { error } = await _supabase.auth.signInWithPasskey();
  if (error) throw error;
}

async function registerPasskey() {
  const { data, error } = await _supabase.auth.registerPasskey();
  if (error) throw error;
  return data;
}

async function listPasskeys() {
  const { data, error } = await _supabase.auth.passkey.list();
  if (error) throw error;
  return data || [];
}

async function deletePasskey(passkeyId) {
  const { error } = await _supabase.auth.passkey.delete({ passkeyId });
  if (error) throw error;
}

async function updatePasskey(passkeyId, friendlyName) {
  const { error } = await _supabase.auth.passkey.update({ passkeyId, friendlyName });
  if (error) throw error;
}

async function resetPassword(email, redirectTo) {
  const { error } = await _supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

async function deleteAllData(userId, { keepPush = false } = {}) {
  const ops = [
    unwrap(_supabase.from('zane_sessions').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_exercises').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_schedules').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_user_settings').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_skips').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_cardio_logs').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_daily_logs').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_adaptive_tdee_history').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_water_logs').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_food_logs').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_food_favorites').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_food_recipes').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_food_template_slots').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_food_meal_plans').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_food_shopping_prefs').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_workout_templates').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_glucose_logs').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_blood_pressure_logs').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_body_temp_logs').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_meso_states').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_status_periods').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_cardio_plans').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_schedule_backups').delete().eq('user_id', userId)),
    // Medications (migration 0218/0221): were missing here entirely before,
    // so neither "delete all my data" nor a backup restore's wipe-first step
    // actually cleared them. medication_plan_items/schedule_slots/logs all
    // cascade off zane_medications being gone, but each is still listed
    // explicitly, same as every other table above (this function has no
    // cascade-only shortcuts elsewhere either).
    unwrap(_supabase.from('zane_medication_plans').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_medications').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_medication_plan_items').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_medication_schedule_slots').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_medication_logs').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_medication_pillbox_checks').delete().eq('user_id', userId)),
    // These three don't cascade off any table already in this list (only off
    // auth.users, which this function never deletes), so without them "delete
    // all my data" and a backup restore's wipe-first step both left plan
    // drafts, auto-fill markers and saved check-in schemas behind.
    unwrap(_supabase.from('zane_plan_drafts').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_food_template_days').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_checkin_schema_templates').delete().eq('user_id', userId)),
  ];
  // zane_recipe_shares has RLS with no policies, so it is only reachable
  // through an RPC. Without this, every old ?share=<token> link kept serving
  // the recipe snapshot (and the sharer's display name) after a full account
  // wipe. Same carve-out as push subscriptions: a RESTORE reuses this function
  // and must not kill links the user already handed out.
  if (!keepPush) ops.push(unwrap(_supabase.rpc('delete_my_recipe_shares')));
  // Push subscriptions are device-scoped and are never re-uploaded by
  // importFromBackup, so a restore (which reuses this fn) must NOT drop them,
  // that would silently unsubscribe the device from Web Push. Only the
  // explicit "delete all data" flow wipes them.
  if (!keepPush) {
    ops.push(unwrap(_supabase.from('zane_push_subscriptions').delete().eq('user_id', userId)));
  }
  await Promise.all(ops);
}

// Validate a parsed backup object BEFORE importFromBackup deletes anything.
// Returns an error string, or null when the structure looks safe to import.
// The import is destructive (delete-then-write) and not transactional, so a
// malformed file must be rejected up front rather than half-applied.
function validateBackup(b) {
  if (!b || typeof b !== 'object') return 'File is not a Zane backup.';
  for (const key of ['sessions', 'exercises', 'schedules']) {
    if (!Array.isArray(b[key])) return `Backup is missing or has an invalid "${key}" list.`;
  }
  if (b.settings != null && typeof b.settings !== 'object') return 'Backup "settings" is malformed.';
  if (b.user != null && typeof b.user !== 'object') return '…149533 tokens truncated…e principle in both directions: a period the server has not
  // caught up on cannot outrank an edit this device made since the last
  // confirmed sync, which is exactly what the group rule above is for.
  const statusIsLocalEdit = !!groupLocalWins.statusMode;
  const open = statusPeriods ? statusPeriods.find(p => p.endedAt == null) : null;
  if (open && !statusIsLocalEdit) {
    if (out.statusMode !== open.mode) {
      out.statusMode = open.mode;
      out.statusModeSince = open.startedAt ?? out.statusModeSince ?? null;
    }
  } else if (!open && statusPeriods && out.statusMode && !statusIsLocalEdit) {
    out.statusMode = null;
    out.statusModeSince = null;
  }
  return out;
}

function mergeCollectionById(freshRows, curRows, baseRows, delIds) {
  const curMap = new Map((curRows || []).map(r => [r.id, r]));
  const baseMap = baseRows ? new Map(baseRows.map(r => [r.id, r])) : null;
  return (freshRows || []).filter(r => !delIds?.has(r.id)).map(r => {
    const c = curMap.get(r.id);
    const b = baseMap?.get(r.id);
    // syncValuesEqual, not JSON.stringify: several of the collections routed
    // through here carry jsonb columns (zane_schedules.days/.versions above
    // all), and jsonb normalizes key order while the in-memory copy keeps
    // insertion order. A raw stringify therefore reports an edit that never
    // happened, keeps the stale local row and pushes it back over whatever
    // another device changed. Same failure the session merge above documents.
    if (c && b && !syncValuesEqual(c, b)) return c;
    return r;
  });
}

// Boot-merge for the plan-editor draft map (scheduleId -> { draft, updatedAt }),
// kept separate from the schedule merge so a draft can never touch a committed
// plan:
//   • both sides  → newer updatedAt wins (last-write-wins);
//   • server-only → keep it (another device's draft), UNLESS this device deleted
//     it (in base, gone from cur): then it was Saved/Discarded here, don't resurrect;
//   • local-only  → keep it (an unsynced draft), UNLESS it was synced before and
//     is now gone from the server (in base, gone from fresh), Saved/Discarded on
//     another device, drop it.
// baseDrafts = the last-synced map (null on a legacy cache → keep both sides).
function mergePlanDrafts(freshDrafts, curDrafts, baseDrafts) {
  const f = freshDrafts || {}, c = curDrafts || {}, b = baseDrafts || null;
  const out = {};
  for (const sid of new Set([...Object.keys(f), ...Object.keys(c)])) {
    const fd = f[sid], cd = c[sid];
    if (fd && cd) {
      const fT = fd.updatedAt ? new Date(fd.updatedAt).getTime() : 0;
      const cT = cd.updatedAt ? new Date(cd.updatedAt).getTime() : 0;
      out[sid] = cT >= fT ? cd : fd;
    } else if (!fd) {
      if (!(b && sid in b)) out[sid] = cd; // gone from server: keep only a never-synced local draft
    } else {
      if (!(b && sid in b)) out[sid] = fd; // server-only: keep unless deleted here
    }
  }
  return out;
}

// Calories from macros: P×4 + C×4 + F×9. With fiber given (net-carb mode),
// carbs contribute max(0, C − fiber)×4, clamped so it matches the displayed
// net-carb value when fiber exceeds carbs. Returns null when no macro is set.
function caloriesFromMacros(p, c, f, fiber) {
  if (p == null && c == null && f == null) return null;
  return (p || 0) * 4 + Math.max(0, (c || 0) - (fiber || 0)) * 4 + (f || 0) * 9;
}

// Bundles consecutive same-supersetGroup entries into { type: 'superset',
// members: [{entry, idx}] } groups, everything else into { type:
// 'standalone', entry, idx }. Used to be copy-pasted into 3 screens with a
// comment admitting they were "kept in lockstep" by hand.
function groupBySuperset(entries) {
  const groups = [];
  let idx = 0;
  while (idx < entries.length) {
    const e = entries[idx];
    if (e.supersetGroup) {
      const members = [{ entry: e, idx }];
      let j = idx + 1;
      while (j < entries.length && entries[j].supersetGroup === e.supersetGroup) {
        members.push({ entry: entries[j], idx: j });
        j++;
      }
      groups.push({ type: 'superset', members });
      idx = j;
    } else {
      groups.push({ type: 'standalone', entry: e, idx });
      idx++;
    }
  }
  return groups;
}

function supersetLabel(memberCount) {
  return memberCount >= 3 ? 'GIANT SET' : 'SUPERSET';
}

// Normalizes a set's intensity-technique data into one shape every renderer
// (chip JSX, plain-text summaries) can consume. Used to be reimplemented ad
// hoc in 7+ places, each new technique or field (e.g. the recent "partials
// finisher") needed hand-editing every one of them, and two of them
// (screens-coaching-client.jsx's two fmtSetChip copies) already carried a
// comment admitting they were kept in sync by hand ("same gap, same fix").
//   kind: 'drop'|'myorep'|'myorep_match'|'amrap_variations'|'lengthened_partial'|null
//   badge: display label for the technique, null for a plain set
//   connector: '→' (drop/AMRAP) | '↺' (myo) | null
//   rounds: [{kg, reps, label?}], populated for chain techniques (falls back
//     to a single round built from st.kg/st.reps when drops is empty,
//     matching every prior caller's own fallback); empty for
//     lengthened_partial/plain sets, which use kg/reps directly
//   totalReps: sum of round reps, only meaningful for myo variants, else null
//   partials: the finisher count on the last round (chain techniques) or
//     lengthened_partial's own count; 0 when none
//   anyVaried: true if any AMRAP Variations round's label diverges from
//     exName, callers use this to decide whether to show round labels at all
function techniqueRounds(st, { exName } = {}) {
  const empty = { kind: null, badge: null, connector: null, rounds: [], totalReps: null, partials: 0, stretch: null, anyVaried: false };
  if (!st || !st.technique) return empty;
  // A weighted stretch (DC-style timed hold at a set weight) rides along as a
  // finisher on the LAST round of any technique, just like partials, or a plain
  // set carrying only a stretch uses technique 'weighted_stretch'. It lives in
  // drops: the last array round for chain techniques, or the drops OBJECT for the
  // standalone / lengthened_partial forms. Shape: { kg, timeSec } (kg may be null).
  const objStretch = (st.drops && !Array.isArray(st.drops)) ? (st.drops.stretch || null) : null;
  if (st.technique === 'weighted_stretch') {
    return { ...empty, kind: 'weighted_stretch', badge: 'STRETCH', stretch: objStretch };
  }
  if (st.technique === 'lengthened_partial') {
    return { ...empty, kind: 'lengthened_partial', badge: 'PARTIALS', partials: st.drops?.partials || 0, stretch: objStretch };
  }
  const BADGES = { drop: 'DROP SET', myorep: 'MYO-REPS', myorep_match: 'MYO MATCH', amrap_variations: 'AMRAP' };
  if (!BADGES[st.technique]) return empty;
  const drops = (st.drops && st.drops.length > 0) ? st.drops : (st.kg != null ? [{ kg: st.kg, reps: st.reps }] : []);
  const isMyo = st.technique === 'myorep' || st.technique === 'myorep_match';
  const last = drops[drops.length - 1] || {};
  return {
    kind: st.technique,
    badge: BADGES[st.technique],
    connector: isMyo ? '↺' : '→',
    // Finishers (partials count, weighted stretch) ride PER ROUND now, any
    // drop/mini/round can carry its own, not just the last. Top-level
    // partials/stretch stay as the LAST round's, for older single-finisher callers.
    rounds: drops.map(d => ({ kg: d.kg, reps: d.reps, label: d.label, partials: d.partials || 0, stretch: d.stretch || null })),
    totalReps: isMyo ? drops.reduce((a, d) => a + (d.reps || 0), 0) : null,
    partials: last.partials || 0,
    stretch: last.stretch || null,
    anyVaried: st.technique === 'amrap_variations' && drops.some(d => d.label && d.label !== exName),
  };
}

// Reads the active Service Worker cache version ("zane-vX.XXX" → "vX.XXX"),
// or null if unavailable. Used both to report a device's version to the
// admin (app.jsx) and to display it locally (screens-home.jsx's login screen).
// Matches 'zane-v' specifically (not just 'zane-') so the unversioned
// 'zane-photos-v1' cache (sw.js, decorative background photos, bumped
// independently of the app shell) can never be mistaken for the app-shell
// cache: caches.keys() order isn't guaranteed, and 'zane-photos-v1' doesn't
// start with 'zane-v' ('zane-p...'), so it's excluded by construction.
async function detectCacheVersion() {
  if (!('caches' in window)) return null;
  try {
    const keys = await caches.keys();
    const name = keys.find(k => k.startsWith('zane-v'));
    return name ? name.replace('zane-', '') : null;
  } catch (_) { return null; }
}

// Wipes both cache layers a stale deploy can hide behind: the SW's
// CacheStorage entries AND the IndexedDB precompile cache (zane-precompile,
// see index.html's loader), a stale record in the latter alone keeps
// serving old transpiled JS even after CacheStorage is cleared, since it's
// keyed by content hash and never touched by a plain cache wipe. Mirrors
// index.html's own makeClearCacheButton, which can't call into LB (runs
// before store.js loads) and so stays a separate vanilla-JS copy.
async function clearPrecompileCaches() {
  if ('caches' in window) {
    try { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } catch {}
  }
  if ('indexedDB' in window) {
    await new Promise(resolve => {
      try {
        const req = indexedDB.deleteDatabase('zane-precompile');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      } catch { resolve(); }
    });
  }
}

// Clears both cache layers above, then reloads via a cache-busted URL.
// window.location.reload(true)'s "force" argument is a removed, no-op
// legacy API in modern browsers, a plain reload after clearing caches is
// still served by whichever service worker is CURRENTLY active (an update
// may be waiting but not yet activated), and that worker's own network
// fallback fetch can still be answered by the browser's HTTP cache, a
// layer entirely below CacheStorage that clearing it never touches. A
// unique ?_v= query string guarantees no HTTP cache entry exists for this
// exact URL, and sw.js's fetch handler already treats any ?_v= request as
// always-network (see the version-check probe in checkSwUpdate), so this
// reliably gets the same fresh result an actual SW update does.
// Deliberately does NOT unregister the service worker, even though leaving the
// old one registered means the reload is still controlled by it and it will
// re-install the pending update. Unregistering looks like the tidier fix and is
// a trap: registration.unregister() also destroys the device's PushSubscription,
// and nothing in this app ever re-subscribes on its own (subscribeWebPush is
// reached only from the Settings toggle), so every push would silently stop
// while the UI kept showing push as enabled. It is also deferred for as long as
// any other client of the scope is open, so it would not even reliably do its
// job. The re-install is handled where it actually surfaces instead: app.jsx's
// boot effect takes a waiting worker SILENTLY when sessionStorage's
// zane-cold-boot flag (set just below) says this boot follows a deliberate
// wipe, so no update banner is raised for the update the user just asked for.
async function clearCachesAndReload() {
  await clearPrecompileCaches();
  // Flags this as a deliberate cache wipe so index.html's "React did not
  // mount" watchdog gives the next boot more time before giving up, see
  // that setTimeout for why a wiped cache legitimately boots slower.
  try { sessionStorage.setItem('zane-cold-boot', '1'); } catch {}
  window.location.href = window.location.pathname + '?_v=' + Date.now() + window.location.hash;
}

// Intensity techniques a coach/user can attach to a planned exercise (array
// order = display order in the plan editor). Values match zane_sets.technique
// so the live training screen can arm them directly. Myo-Rep Match falls back
// to plain Myo-Reps live when no preceding myo set exists to anchor to.
const PLANNABLE_TECHNIQUES = [
  { id: 'drop', label: 'Drop Set', short: 'DROP' },
  { id: 'myorep', label: 'Myo-Reps', short: 'MYO' },
  { id: 'myorep_match', label: 'Myo-Rep Match', short: 'MATCH' },
  { id: 'amrap_variations', label: 'AMRAP Variations', short: 'AMRAP' },
  { id: 'lengthened_partial', label: 'Lengthened Partials', short: 'LP' },
  { id: 'weighted_stretch', label: 'Weighted Stretch', short: 'STRETCH' },
];
function plannedTechniqueLabel(t) {
  const found = PLANNABLE_TECHNIQUES.find(x => x.id === t);
  return found ? found.label : null;
}
function plannedTechniqueShort(t) {
  const found = PLANNABLE_TECHNIQUES.find(x => x.id === t);
  return found ? found.short : null;
}

window.LB = {
  supabase: _supabase,
  PLANNABLE_TECHNIQUES, plannedTechniqueLabel, plannedTechniqueShort,
  clearPrecompileCaches, clearCachesAndReload,
  SUPABASE_URL, SUPABASE_ANON_KEY, PUSHOVER_URL, WEB_PUSH_URL, fnFetch,
  subscribeWebPush, unsubscribeWebPush, getWebPushSubscription,
  signIn, signUp, signOut, signInWithPasskey, registerPasskey, listPasskeys, deletePasskey, updatePasskey, resetPassword, deleteAllData, exportBackup, backupToBlob, readBackupText, importFromBackup, validateBackup, weightAxisUnit,
  loadFromSupabase, syncStore, mergeSessions, resolveInProgressId, withCarriedWindowEntries, historyWindowCutoffISO, normalizeHiddenHealthCards, FOOD_HISTORY_WINDOW_DAYS,
  saveToLocal, loadFromLocal, saveBase, loadBase, loadLocalState, saveLocalState, saveSyncedState, clearLocal,
  uid, normalizeXHandle, xHandleUrl, todayISO, fmtISO, nowHHMM, fmtDayLabel, shiftDate, fmtHHMM, fmtClock, nextMondayISO, nextCycleD1ISO, nextCycleD1ISOFromSchedule, parseDate, isoWd, weekEnd, findExercise, lastSessionForExercise, recentSessionsForExercise, bestRecentEntry, bestEntryFromSetLists, progressionSuggestion, progressionEnabled, progressionCeilingFor, incrementForExercise, equipmentCfgFor, is531MainLift, todaysDay, nextDay, isWeekdayPlan, isFlexPlan, healScheduleWeekdays, buildPlanSkeleton, instantiateProgram, is531Plan, round531, tmFrom531, tmBump531, weeks531, week531, fiveThreeOneSets, build531Plan, add531MainLift, current531Week, current531Cycle, compute531CycleBumps, prev531MainLiftSession, prev531MainLiftSessionLive, resolve531CycleEnd, suggest531Tm, splitDayCount, frequencyHint, mesoTaperPreview, mesoRirEnabled, mesoActive, autoregLoadOnly, getPlanDaysForDate, getCyclePosForDate, getCycleNumForDate, getCycleStartForNum, getActiveVersionIdx, dedupeVersionsByDate, withVersionedDays, realignCycleForToday, todayCycleStripIndex,
  effReps, fmtDuration, e1rm, isImprovement, isDecline, bestE1rmForExercise, bestAssistLoad, bestTimeForExercise, totalVolume, entryVolume, doneSetCount, buildSeedSets, buildTimeSeedSets, latestBodyweight, bodyweightForDate, exerciseLogMode, isAssisted, shouldPullBodyweight, bodyweightMode, isBodyweightPlusLoad, splitBodyweightLoad, setLoadLabel, chainRoundKg, exerciseHornLabels, isMultiHorn, hornLoadTotal, hornLoadLabel, sameHornLoad, systemExerciseToRow, inferCurrentExIdx, calcBlended,
  refreshExerciseBests, fetchTopExercises, fetchSeedEntries, fetchExerciseHistory, fetchSessionEntries, fetchFullTrainingHistory, fetchFoodLogsForDates, fetchFoodLogsSince, fetchMedicationLogsSince,
  computeNextReminderAt,
  cancelPushover, adminSendEmail, searchFoods, cacheFood, scanLabel, parseMealText, createRecipeShare, fetchRecipeShare,
  subscribeToChanges, socialWeekStartISO, socialMetricCatalog: SOCIAL_METRIC_CATALOG, socialDefaultMetricSlots: SOCIAL_DEFAULT_METRIC_SLOTS, loadFriendsState, loadSocialWorkoutFeed, loadSocialFriendMetrics, loadSocialWorkoutDetail, sendSocialWorkoutComment, updateSocialProfile, lookupSocialProfile,
  sendSocialFriendRequest, respondToSocialFriendRequest, removeSocialFriend, blockSocialUser,
  createSocialGroup, joinSocialGroup, leaveSocialGroup, deleteSocialGroup, sendSocialMessage, updateSocialMessage, deleteSocialMessage, markSocialMessagesRead,
  uploadSocialAttachment, createSocialPlanShare, createSocialGroupPlanShare, markSocialPlanImported, deleteSocialPlanShare, reportSocial, subscribeToFriends,
  openStatusPeriod, closeStatusPeriod, updateStatusPeriodStart, clearStatusMode,
  closeStatusPeriodById, deleteStatusPeriodById, updateStatusPeriodStartById, updateStatusPeriodMode,
  startDeload, endDeload, deloadElapsed, deloadDaysRemaining, deloadPlanDays,
  startCleanup, endCleanup, cleanupElapsed, cleanupDaysRemaining, nextCleanupStartISO, cleanupStarted, repinCleanupStart,
  updateDailyLogDerived, loadClientStore, pushMealPlanToClient, pushMedicationPlanToClient, loadCoachClientsStatus, reloadCoachingState, enableSelfCoaching, inviteClient, respondToCoachingInvite, endCoaching,
  addCoachingNote, updateCoachingNote, deleteCoachingNote, markCoachingNotesRead, loadCoachingNotes, loadCoachingThreads, createCoachingThread, deleteCoachingThread, getOrCreateCoachingThread, uploadChatImage,
  unreadCoachingNotes, isNoteFromClient, techniqueRounds, groupBySuperset, supersetLabel, timeAgo, dayLabel, cyclePosFromStartDate, mergeCollectionById, mergeBootScalars, mergePlanDrafts, caloriesFromMacros, detectCacheVersion,
  normSet, stableJson, syncValuesEqual, // exported for tools/test/store.test.cjs
  OZ_G, LB_G, gToOz, ozToG, formatMassG, roundShoppingQty, cleanupAppliesToExercise,
  loadCoachingMacros, addCoachingMacros,
  diffSchedule,
  checkinWeekStart, submitCheckin, loadCheckins, deleteCheckin, loadCoachCheckinStatus, requestCheckin, setCheckinEnabled, loadCheckinSchema, saveCheckinSchema, saveDefaultCheckinSchema,
  cardioWeekPrefill, detectCardioPRs,
  cardioDistUnit, setCardioDistUnit, distToM, mToDisplay, fmtDistance, fmtPace, fmtSpeed, MI_TO_M, recentCardioTypes,
  defaultTempUnit,
  isLoggedTrainingDay, plannedTrainingDay, isTrainingDayForDate, dayTargetFromMacros, macroAdherence, hasMacroTargets, effectiveMacroTargets, dailyLogAdherence, statusModeForDate, isNutritionUnscoredMode, isRoutineDisruptedMode, mealOfChoiceRemainder, mealOfChoiceWeekCount,
  withMealOfChoiceNote, mealOfChoiceNoteName, dailyLogsWeekPrefill, weekPerformanceSignal,
  ACTIVITY_FACTORS, FAT_FLOOR_PER_KG, estimateTdee, minRestRatio, macroTargetsFromGoal, rebalanceMacros, weeklyAverageCalories, weeklyAverageMacros, MEAL_CATEGORY_DEFS, mealCategories, foodDayIsClosed, FD_FASTING_PRESETS, fastingCustomHours,
  estimateAdaptiveTdee, adaptiveTdeeHistoryRow, enrichAdaptiveTdeeHistoryTarget, refreshAdaptiveTdeeHistoryEstimate, reconstructAdaptiveTdeeHistory, mergeAdaptiveTdeeHistory,
  loadAdaptiveTdeeHistory, saveAdaptiveTdeeHistory,
  refreshHealthLogs,
  dailySummaryDayIsEmpty, buildDailySummaryPayload, generateDailySummary, splitHeadlineBody, generateCheckinOpinion, dsMedsDueTaken, dsSlotAppliesOn, foodTemplateDayMarkerId, foodTemplateDayLegacyMarkerId, upsertMedicationLog,
  pickGrowthRecipient, retractGrowthGrant, pickDeclineRecipient, reearnMesoWeightBoosts, clearMesoWeightBoostDeclines, revertMesoSessionBoosts, resolveMesoSeedSuggestion, mesoPausedDays, mesoRirForWeek, mesoMuscleTrainedBeforeStart, volumeAnswerAllowsBump,
  MESO_KEY, MESO_MUSCLE_PRIORITY, primaryMuscleForExercise, getMesoState, saveMesoStateToStorage, mesoCurrentWeek, applyMesoSetDeltaFromState, applyMesoSetDelta,
  microcycleSetsByMuscle, detectOverreach,
  blockStartTs, blockSessions, buildBlockRecap, deloadNudgeDecision, recordDeloadDecline, clearDeloadNudge,
  updateLandmarkMrv, snapshotBlockStart, backoffDeltas, muscleRosterKeys, updateMevFloors, redistributeMevFloors,
  detectStall, suggestSwap, reentryRamp, STALL_SESSIONS,
  mesoGateSetsFromAnswers, isMesoSessionEditable, applyMesoFeedbackEdit, reearnMesoBoostsFromAnswers, mesoRecapGainsFromEdit, recomputeMesoRepMissCut, remapMesoAnswersExId, deriveSignalWeight, remapMesoRecapRawForSwap, remapMesoStateExId, mesoRowHasExId, laterSessionTrainsExId,
  mesoSetTarget, mesoEarnTarget, mesoRepOutcome, reshapeSetsUnilateral,
};
