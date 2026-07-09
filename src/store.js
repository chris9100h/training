/* Logbook store — Supabase backend */

const SUPABASE_URL = 'https://ebbuvdzgstrhrcsbrlez.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';

const PUSHOVER_URL          = `${SUPABASE_URL}/functions/v1/pushover`;
const WEB_PUSH_URL          = `${SUPABASE_URL}/functions/v1/web-push`;
const COACHING_NOTIFY_URL   = `${SUPABASE_URL}/functions/v1/zane_coaching-notify`;
const ADMIN_SEND_EMAIL_URL  = `${SUPABASE_URL}/functions/v1/admin-send-email`;

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
async function unwrap(builder) {
  const res = await builder;
  if (res && res.error) {
    throw Object.assign(new Error(res.error.message || 'Supabase request failed'), { cause: res.error });
  }
  return res;
}

// POST to an edge function authenticated as the signed-in user. The functions
// reject the bare anon key (security hardening) — identity and push target are
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
// Local calendar date as YYYY-MM-DD. Never use toISOString() here — that
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

// ─── QUICK SWITCH ────────────────────────────────────────────────────────

const QS_EMAILS = ['office@btc-prime.biz', 'anja.knamm@gmail.com'];

function _qsKey(email) { return `zane-qs-${email}`; }

function _persistQsSession(session, email) {
  if (!email || !session?.access_token || !session?.refresh_token) return;
  if (!QS_EMAILS.includes(email)) return;
  try {
    const existing = localStorage.getItem(_qsKey(email));
    const name = existing ? (JSON.parse(existing).name || null) : null;
    localStorage.setItem(_qsKey(email), JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      ...(name ? { name } : {}),
    }));
  } catch (_) {}
}

// Auto-save session on every sign-in and token refresh so quick switch stays current
_supabase.auth.onAuthStateChange((event, session) => {
  if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user?.email) {
    _persistQsSession(session, session.user.email);
  }
});

function saveQsName(email, name) {
  if (!email || !name || !QS_EMAILS.includes(email)) return;
  try {
    const raw = localStorage.getItem(_qsKey(email));
    if (!raw) return;
    const data = JSON.parse(raw);
    data.name = name;
    localStorage.setItem(_qsKey(email), JSON.stringify(data));
  } catch (_) {}
}

function getQsName(email) {
  try {
    const raw = localStorage.getItem(_qsKey(email));
    return raw ? (JSON.parse(raw).name || null) : null;
  } catch (_) { return null; }
}

function hasQuickSwitchSession(email) {
  try { return !!localStorage.getItem(_qsKey(email)); } catch (_) { return false; }
}

async function quickSwitch(targetEmail) {
  const raw = localStorage.getItem(_qsKey(targetEmail));
  if (!raw) throw new Error('No saved session for ' + targetEmail);
  const { access_token, refresh_token } = JSON.parse(raw);
  const { error } = await _supabase.auth.setSession({ access_token, refresh_token });
  if (error) {
    localStorage.removeItem(_qsKey(targetEmail)); // remove stale tokens
    throw error;
  }
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

async function signOut() {
  await _supabase.auth.signOut();
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
    unwrap(_supabase.from('zane_workout_templates').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_glucose_logs').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_meso_states').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_status_periods').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_cardio_plans').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_schedule_backups').delete().eq('user_id', userId)),
  ];
  // Push subscriptions are device-scoped and are never re-uploaded by
  // importFromBackup, so a restore (which reuses this fn) must NOT drop them —
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
  for (const e of b.exercises) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id) return 'Backup contains an invalid exercise entry.';
    if (e.tags != null && !Array.isArray(e.tags)) return 'Backup contains an exercise with invalid tags.';
  }
  for (const s of b.schedules) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !s.id) return 'Backup contains an invalid schedule entry.';
    if (s.days != null && !Array.isArray(s.days)) return 'Backup contains a schedule with invalid days.';
  }
  for (const s of b.sessions) {
    if (!s || typeof s !== 'object') return 'Backup contains an invalid session entry.';
    if (s.id != null && typeof s.id !== 'string') return 'Backup contains a session with an invalid id.';
    if (s.entries != null && !Array.isArray(s.entries)) return 'Backup contains a session with invalid entries.';
  }
  return null;
}

// Skips are persisted through syncStore's diff model (see the skips block there),
// so they inherit the same offline-resilient retry/cache path as sessions. UI
// mutates store.skips via setStore; no imperative per-skip writes.

async function importFromBackup(backup, userId, onProgress, unitConvert = null) {
  // unitConvert: { multiplier: number, targetUnit: 'kg'|'lbs' } | null
  // Validate before the destructive delete — never half-apply a bad file.
  const invalid = validateBackup(backup);
  if (invalid) throw new Error(invalid);

  const sett = backup.settings ?? {};
  const importSessions = backup.sessions?.filter(s => s.id) ?? [];

  const idRemap = {};
  const exerciseRows = (backup.exercises || []).map(e => {
    const newId = uid();
    idRemap[e.id] = newId;
    return { id: newId, name: e.name, tags: e.tags ?? [], note: e.note ?? '', category: e.category ?? null, unilateral: e.unilateral ?? false, equipment: e.equipment ?? null, progression_reps: e.progression_reps ?? null, movement_type: e.movement_type ?? null, no_weight_reps: !!e.no_weight_reps, log_mode: e.log_mode ?? null, pull_bodyweight: !!e.pull_bodyweight, youtube_url: e.youtube_url ?? null, user_id: userId };
  });
  // Exercises got fresh ids above — everything that references an exId must be
  // remapped or it dangles after restore. remapEx: single id; remapExKeyed:
  // { exId: v } maps; remapExDayKeyed: { exId_dayId: v } maps (uid() has no '_',
  // so the first underscore splits exId from the dayId suffix, kept verbatim).
  const remapEx = id => idRemap[id] ?? id;
  const remapExKeyed = obj => {
    const out = {};
    for (const k in (obj || {})) out[remapEx(k)] = obj[k];
    return out;
  };
  const remapExDayKeyed = obj => {
    const out = {};
    for (const k in (obj || {})) {
      const us = k.indexOf('_');
      out[us < 0 ? remapEx(k) : remapEx(k.slice(0, us)) + k.slice(us)] = obj[k];
    }
    return out;
  };
  const remapDays = days => (Array.isArray(days) ? days : []).map(d => ({
    ...d,
    items: Array.isArray(d.items)
      ? d.items.map(it => (it.exId != null ? { ...it, exId: remapEx(it.exId) } : it))
      : d.items,
  }));
  const sessionRows = importSessions.map(s => sessionToRow(s, userId));
  const settingsRow = {
    user_id: userId,
    active_schedule_id: backup.activeScheduleId ?? null,
    cycle_index: backup.cycleIndex ?? 0,
    cycle_start_date: backup.cycleStartDate ?? null,
    week_plan_start_date: backup.weekPlanStartDate ?? null,
    last_advanced_date: backup.lastAdvancedDate ?? null,
    in_progress_session_id: backup.inProgress ?? null,
    unit: unitConvert?.targetUnit ?? sett.unit ?? null,
    rest_default: sett.restDefault || 120,
    rest_big: sett.restBig || 180,
    rest_medium: sett.restMedium || 120,
    rest_small: sett.restSmall || 90,
    push_enabled: sett.pushEnabled ?? false,
    pushover_user_key: sett.pushoverUserKey ?? null,
    use_pushover: sett.usePushover ?? false,
    cycle_week_view: sett.cycleWeekView ?? false,
    accent_color: sett.accentColor ?? 'copper',
    dark_mode: sett.darkMode ?? 'dark',
    custom_day_types: backup.customDayTypes ?? [],
    reminder_enabled: sett.reminderEnabled ?? false,
    reminder_time: sett.reminderTime ?? '07:00',
    tempo_enabled: sett.tempoEnabled ?? false,
    tempo_eccentric: sett.tempoEccentric ?? null,
    tempo_concentric: sett.tempoConcentric ?? null,
    smart_progression: sett.smartProgression ?? false,
    progression_range_top: sett.progressionRangeTop ?? null,
    equipment_config: sett.equipmentConfig ?? null,
    weight_fill_down: sett.weightFillDown ?? true,
    net_carbs: sett.netCarbs ?? false,
    show_warmup_in_summary: sett.showWarmupInSummary ?? false,
    show_coaching_tab: sett.showCoachingTab ?? false,
    be_your_own_coach: sett.beYourOwnCoach ?? false,
    session_timeout_minutes: sett.sessionTimeoutMinutes ?? 90,
    macro_targets: sett.macroTargets ?? null,
    show_health_tab: sett.showHealthTab ?? false,
    onboarding_completed: sett.onboardingCompleted ?? false,
    show_regression: sett.showRegression ?? true,
    glucose_unit: sett.glucoseUnit ?? 'mmol',
    default_checkin_schema: sett.defaultCheckinSchema ?? null,
    vip_background: sett.vipBackground ?? null,
    active_cardio_plan_id: backup.activeCardioPlanId ?? null,
    status_mode: backup.statusMode ?? null,
    status_mode_since: backup.statusModeSince ?? null,
    deload_prompt_dismissed_at: backup.deloadPromptDismissedAt ?? null,
  };

  // Pre-count chunks upfront so the UI can show accurate progress.
  const CHUNK = 50;
  const exChunks = exerciseRows.length ? Math.ceil(exerciseRows.length / CHUNK) : 0;
  const sessChunks = sessionRows.length ? Math.ceil(sessionRows.length / CHUNK) : 0;
  const totalEntries = importSessions.reduce((n, s) => n + (s.entries?.length || 0), 0);
  const totalSets = importSessions.reduce((n, s) => n + (s.entries || []).reduce((m, e) => m + (e.sets?.length || 0), 0), 0);
  const entryChunks = totalEntries ? Math.ceil(totalEntries / CHUNK) : 0;
  const setChunks = totalSets ? Math.ceil(totalSets / CHUNK) : 0;
  const totalSteps = 1 // delete
    + (backup.user?.name ? 1 : 0)
    + exChunks
    + (backup.schedules?.length ? 1 : 0)
    + sessChunks
    + 1 // settings
    + entryChunks + setChunks
    + (backup.skips?.length ? 1 : 0)
    + (backup.cardioLogs?.length ? 1 : 0)
    + (backup.dailyLogs?.length ? 1 : 0)
    + (backup.workoutTemplates?.length ? 1 : 0)
    + (backup.glucoseLogs?.length ? 1 : 0)
    + (backup.cardioPlans?.length ? 1 : 0)
    + (backup.statusPeriods?.length ? 1 : 0)
    + (backup.mesoStates?.length ? 1 : 0);
  let stepsDone = 0;
  const prog = (phase) => onProgress?.(Math.min(99, Math.round(stepsDone / Math.max(1, totalSteps) * 100)), phase);
  const tag = (label, fn) => fn().catch(e => { throw new Error(`[${label}] ${e?.message || e}`); });

  prog('Clearing old data…');
  try { await deleteAllData(userId, { keepPush: true }); } catch(e) { throw new Error(`[delete] ${e?.message || e}`); }
  stepsDone++;

  if (backup.user?.name) {
    prog('Restoring profile…');
    await tag('profile', () => unwrap(_supabase.from('zane_profiles').upsert({ id: userId, name: backup.user.name })));
    stepsDone++;
  }

  for (let i = 0; i < exerciseRows.length; i += CHUNK) {
    prog(`Uploading exercises (${i/CHUNK+1}/${exChunks})…`);
    await tag(`exercises ${i/CHUNK+1}`, () => unwrap(_supabase.from('zane_exercises').upsert(exerciseRows.slice(i, i + CHUNK))));
    stepsDone++;
  }

  if (backup.schedules?.length) {
    prog('Uploading plans…');
    await tag('schedules', () => unwrap(_supabase.from('zane_schedules').upsert(backup.schedules.map(({ mode, ...s }) => ({
      ...s,
      days: remapDays(s.days),
      versions: Array.isArray(s.versions) ? s.versions.map(v => ({ ...v, days: remapDays(v.days) })) : s.versions,
      user_id: userId,
    })))));
    stepsDone++;
  }

  for (let i = 0; i < sessionRows.length; i += CHUNK) {
    prog(`Uploading sessions (${i/CHUNK+1}/${sessChunks})…`);
    await tag(`sessions ${i/CHUNK+1}`, () => unwrap(_supabase.from('zane_sessions').upsert(sessionRows.slice(i, i + CHUNK))));
    stepsDone++;
  }

  prog('Uploading settings…');
  await tag('settings', () => unwrap(_supabase.from('zane_user_settings').upsert(settingsRow)));
  stepsDone++;

  // Entries then sets after sessions are committed (FK order: sessions → entries → sets)
  if (importSessions.length) {
    try {
      const convertKg = unitConvert
        ? kg => kg != null ? Math.round(kg * unitConvert.multiplier * 100) / 100 : null
        : kg => kg;
      const sessionsForEntries = importSessions.map(s => ({
        ...s,
        entries: (s.entries || []).map(e => ({
          ...e,
          exId: idRemap[e.exId] ?? e.exId,
          sets: unitConvert ? (e.sets || []).map(st => ({ ...st, kg: convertKg(st.kg) })) : e.sets,
        })),
      }));
      await _syncEntryRelational(sessionsForEntries, userId, null, (phase) => {
        stepsDone++;
        prog(phase);
      });
    }
    catch(e) { throw new Error(`[entries/sets] ${e?.message || e}`); }
  }
  if (backup.skips?.length) {
    prog('Uploading skips…');
    await unwrap(_supabase.from('zane_skips').upsert(
      backup.skips.map(s => ({
        id: s.id, user_id: userId, date: s.date, day_id: s.dayId,
        day_name: s.dayName, skip_reason: s.skipReason, skipped_at: s.skippedAt ?? null,
      }))
    ));
    stepsDone++;
  }
  if (backup.cardioLogs?.length) {
    prog('Uploading cardio logs…');
    await unwrap(_supabase.from('zane_cardio_logs').upsert(
      backup.cardioLogs.map(l => ({
        id: l.id, user_id: userId, date: l.date, type: l.type ?? null,
        duration_minutes: l.durationMinutes, distance_m: l.distanceM ?? null,
        pace_feeling: l.paceFeeling ?? null, effort: l.effort ?? null,
        note: l.note ?? null, session_id: l.sessionId ?? null,
      }))
    ));
    stepsDone++;
  }
  if (backup.dailyLogs?.length) {
    prog('Uploading daily logs…');
    await unwrap(_supabase.from('zane_daily_logs').upsert(
      backup.dailyLogs.map(l => ({
        id: l.id, user_id: userId, date: l.date,
        weight: l.weight ?? null, steps: l.steps ?? null,
        calories: l.calories ?? null, protein: l.protein ?? null,
        carbs: l.carbs ?? null, fat: l.fat ?? null, fiber: l.fiber ?? null,
        water_ml: l.waterMl ?? null, note: l.note ?? null,
        off_plan_note: l.offPlanNote ?? null,
        adherence: l.adherence ?? null, targets_snap: l.targetsSnap ?? null,
        daily_coach_fields: l.coachFields ?? null,
      }))
    ));
    stepsDone++;
  }
  if (backup.workoutTemplates?.length) {
    prog('Uploading workout templates…');
    await unwrap(_supabase.from('zane_workout_templates').upsert(
      backup.workoutTemplates.map(t => ({
        id: t.id, user_id: userId, name: t.name,
        exercises: (t.exercises || []).map(e => (e.exId != null ? { ...e, exId: remapEx(e.exId) } : e)),
      }))
    ));
    stepsDone++;
  }
  if (backup.glucoseLogs?.length) {
    prog('Uploading glucose logs…');
    await unwrap(_supabase.from('zane_glucose_logs').upsert(
      backup.glucoseLogs.map(l => ({
        id: l.id, user_id: userId, date: l.date, time: l.time,
        value_mmol: l.valueMmol ?? null, context: l.context ?? 'other',
        note: l.note ?? null,
      }))
    ));
    stepsDone++;
  }
  if (backup.cardioPlans?.length) {
    prog('Uploading cardio plans…');
    await unwrap(_supabase.from('zane_cardio_plans').upsert(
      backup.cardioPlans.map(p => ({
        id: p.id, user_id: userId, name: p.name, activity_type: p.activityType,
        archived: p.archived ?? false, mode: p.mode ?? null,
        days: p.days ?? {}, manual_targets: p.manualTargets ?? null,
        goal: p.goal ?? null, goal_due_date: p.goalDueDate ?? null,
        start_fitness: p.startFitness ?? null, generated_weeks: p.generatedWeeks ?? null,
        plan_start_date: p.planStartDate ?? null,
      }))
    ));
    stepsDone++;
  }
  if (backup.statusPeriods?.length) {
    prog('Uploading status periods…');
    await unwrap(_supabase.from('zane_status_periods').upsert(
      backup.statusPeriods.map(p => ({
        id: p.id, user_id: userId, mode: p.mode,
        started_at: p.startedAt ?? null, ended_at: p.endedAt ?? null,
      }))
    ));
    stepsDone++;
  }
  if (backup.mesoStates?.length) {
    prog('Uploading mesocycle states…');
    // id is deterministic (userId + '_' + scheduleId) — regenerate for this user.
    // schedule_id is preserved (schedules keep their ids), but the exId-keyed maps
    // (deltas/weightBoosts: exId_dayId; jointFlags/pumpLowCounts: exId) must be
    // remapped onto the fresh exercise ids or they dangle.
    await unwrap(_supabase.from('zane_meso_states').upsert(
      backup.mesoStates.map(m => ({
        id: userId + '_' + m.scheduleId, user_id: userId, schedule_id: m.scheduleId,
        weeks: m.weeks, start_date: m.startDate ?? null,
        start_cycle_index: m.startCycleIndex ?? 0, started_at: m.startedAt ?? null,
        deltas: remapExDayKeyed(m.deltas), weight_boosts: remapExDayKeyed(m.weightBoosts),
        joint_flags: remapExKeyed(m.jointFlags), pump_low_counts: remapExKeyed(m.pumpLowCounts),
        growth_counts: remapExDayKeyed(m.growthCounts),
        completions: m.completions ?? 0, pending_meso2: m.pendingMeso2 ?? false,
      }))
    ));
    stepsDone++;
  }
  onProgress?.(100, 'Done!');
}

// Builds a complete export object for backup. Fetches ALL session entries and
// all coaching data fresh from DB (no boot-window restriction). Strips only
// ephemeral/server-derived fields that have no meaning outside the live session.
async function exportBackup(store, userId) {
  // Collect all coaching relationship IDs (regular + self + support tickets)
  const regularCoachingIds = [
    ...(store.coaching?.asCoach || []).map(r => r.id),
    ...(store.coaching?.asClient ? [store.coaching.asClient.id] : []),
    ...(store.coaching?.asSelf ? [store.coaching.asSelf.id] : []),
  ];
  const supportCoachingIds = (store.supportTickets || []).map(t => t.coachingId).filter(Boolean);
  const allCoachingIds = [...new Set([...regularCoachingIds, ...supportCoachingIds])];

  const fetches = [
    _supabase.from('zane_session_entries').select('*, sets:zane_sets(*)').eq('user_id', userId).order('entry_idx'),
  ];
  if (allCoachingIds.length) {
    fetches.push(
      _supabase.from('zane_coaching_notes').select('*').in('coaching_id', allCoachingIds).order('created_at'),
      _supabase.from('zane_coaching_threads').select('*').in('coaching_id', allCoachingIds).order('created_at'),
      _supabase.from('zane_coaching_macros').select('*').in('coaching_id', allCoachingIds).order('set_at'),
      _supabase.from('zane_checkins').select('*').in('coaching_id', allCoachingIds).order('week_start'),
    );
  }

  const [entriesRes, notesRes, threadsRes, macrosRes, checkinsRes] = await Promise.all(fetches);

  // Import is delete-then-restore — a silent partial fetch would produce an
  // incomplete backup that later wipes the missing data. Fail loudly instead.
  if (entriesRes.error) throw entriesRes.error;
  if (notesRes?.error) throw notesRes.error;
  if (threadsRes?.error) throw threadsRes.error;
  if (macrosRes?.error) throw macrosRes.error;
  if (checkinsRes?.error) throw checkinsRes.error;

  const bySession = {};
  for (const e of (entriesRes.data || [])) {
    if (!bySession[e.session_id]) bySession[e.session_id] = [];
    bySession[e.session_id].push(e);
  }

  const { exerciseBests, nextReminderAt, supportUnread, adminSupportUnread, ...rest } = store;
  return {
    _version: 2,
    _exportedAt: new Date().toISOString(),
    ...rest,
    sessions: store.sessions.map(s => ({
      ...s,
      entries: bySession[s.id] ? mapEntryRows(bySession[s.id]) : s.entries,
    })),
    coaching: allCoachingIds.length ? {
      relationships: store.coaching,
      notes: notesRes?.data || [],
      threads: threadsRes?.data || [],
      macros: macrosRes?.data || [],
      checkins: checkinsRes?.data || [],
    } : store.coaching,
  };
}

// Serialize a backup object for download. Minified JSON (no pretty-print, so the
// file is not tens of thousands of lines) and gzip-compressed when the browser
// supports CompressionStream (a JSON backup shrinks roughly 10x). Returns
// { blob, gz }; gz=false is the plain-JSON fallback on older browsers.
// readBackupText reverses it.
async function backupToBlob(backup) {
  const json = JSON.stringify(backup);
  if (typeof CompressionStream !== 'undefined') {
    try {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
      const blob = await new Response(stream).blob();
      return { blob, gz: true };
    } catch (_) { /* fall through to uncompressed */ }
  }
  return { blob: new Blob([json], { type: 'application/json' }), gz: false };
}

// Read a backup file back to its JSON text, transparently gunzipping a gzipped
// export (detected by the 1f 8b magic bytes). Plain-JSON exports (older backups)
// pass through unchanged, so both formats still import.
async function readBackupText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This backup is compressed and this browser cannot open it. Try a newer browser or device.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  return new TextDecoder().decode(bytes);
}

// ─── SETUP NEW USER ──────────────────────────────────────────────────────

async function setupNewUser(userId, name, unit) {
  await Promise.all([
    unwrap(_supabase.from('zane_profiles').upsert({ id: userId, name })),
    unwrap(_supabase.from('zane_user_settings').upsert({ user_id: userId, ...(unit != null ? { unit } : {}), rest_default: 120 })),
  ]);
}

// ─── LOAD ────────────────────────────────────────────────────────────────

// How far back boot loads the relational set data. Sessions newer than this
// (plus the in-progress session) get full entries; older sessions carry only
// the server aggregates (aggVolume/aggDoneSets/aggExercises from
// get_session_stats) and lazy-load their sets on demand. 70 days covers the
// 8-week volume chart with margin, so boot stays O(sessions), never O(sets).
const HISTORY_WINDOW_DAYS = 70;

function historyWindowCutoffISO(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - HISTORY_WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}

// snake_case zane_session_entries rows (with nested zane_sets) → store-shaped
// entries array. Shared by boot and the lazy per-session loader.
function mapEntryRows(entryRows) {
  return (entryRows || []).map(e => ({
    exId: e.ex_id,
    name: e.name,
    plannedSets: e.planned_sets,
    plannedReps: e.planned_reps,
    plannedRepsPerSet: e.planned_reps_per_set || null,
    plannedRepsMax: e.planned_reps_max ?? null,
    plannedProgressionOffset: e.planned_progression_offset ?? null,
    note: e.note || '',
    supersetGroup: e.superset_group || null,
    sets: (e.sets || [])
      .sort((a, b) => a.set_idx - b.set_idx)
      .map(st => ({
        kg: st.kg,
        reps: st.reps,
        repsL: st.reps_l,
        repsR: st.reps_r,
        timeSec: st.time_sec ?? null,
        done: st.done,
        skipped: st.skipped,
        warmup: st.warmup,
        technique: st.technique ?? null,
        drops: st.drops ?? null,
      })),
  }));
}

async function loadFromSupabase(userId, _depth = 0, _opts = {}) {
  const isCoachLoad = !!_opts.coachLoad;
  const histCutoff = historyWindowCutoffISO();
  const queries = [
    _supabase.from('zane_profiles').select('id, name, approved').eq('id', userId).maybeSingle(),
    _supabase.from('zane_exercises').select('id, name, tags, note, category, unilateral, equipment, progression_reps, movement_type, no_weight_reps, log_mode, pull_bodyweight, youtube_url').eq('user_id', userId),
    _supabase.from('zane_schedules').select('id, name, days, archived, versions, is_flex, sessions_per_week, mesocycle_weeks, mesocycle_start_rir, mesocycle_end_rir, mesocycle_rir_enabled, program_type, program_data').eq('user_id', userId),
    // Session METADATA stays complete (cheap; streaks/calendar need the full
    // date list) — the legacy entries JSONB is no longer selected.
    _supabase.from('zane_sessions').select('id, schedule_id, day_id, day_name, date, started_at, ended, duration_minutes, feel, is_bonus, is_freestyle, is_deload')
      .eq('user_id', userId).order('date', { ascending: false }),
    _supabase.from('zane_user_settings').select('*').eq('user_id', userId).maybeSingle(),
    _supabase.from('zane_skips').select('id, date, day_id, day_name, skip_reason, skipped_at').eq('user_id', userId),
    // Boot window: relational set data only for recent sessions (the inner
    // join filters on the parent session's date). An in-progress session
    // older than the window is fetched separately below.
    _supabase.from('zane_session_entries')
      .select('*, sets:zane_sets(*), session:zane_sessions!inner(date)')
      .eq('user_id', userId)
      .gte('session.date', histCutoff)
      .order('entry_idx'),
    // Server-side history aggregates (migrations 0059/0060): all-time PR
    // baselines per exercise + per-session volume/set counts for everything
    // outside the boot window. Passing p_user_id covers coach loads too.
    _supabase.rpc('get_exercise_best_e1rm', { p_user_id: userId }),
    _supabase.rpc('get_session_stats', { p_user_id: userId }),
    // Coaching data — only for own store load, not when a coach loads a client
    isCoachLoad ? null : _supabase.rpc('get_coach_info'),
    isCoachLoad ? null : _supabase.rpc('get_coaching_clients'),
    isCoachLoad ? null : _supabase.from('zane_coaching_notes')
      .select('id, coaching_id, author_id, type, entity_id, entity_name, body, created_at, thread_id')
      .is('read_at', null)
      .neq('author_id', userId)
      .not('coaching_id', 'like', 'support_%'),
    // Real coaching row (for check-in requests) — exclude self-coaching and support rows.
    isCoachLoad ? null : _supabase.from('zane_coaching').select('id, checkin_requested_at, checkin_enabled').eq('client_id', userId).eq('status', 'active').neq('coach_id', userId).not('id', 'like', 'support_%').maybeSingle(),
    // Self-coaching row (coach_id = client_id), if the user is their own coach
    isCoachLoad ? null : _supabase.from('zane_coaching').select('id').eq('coach_id', userId).eq('client_id', userId).eq('status', 'active').maybeSingle(),
    // Cardio quick-logs — all records for the user (typically < a few hundred rows)
    _supabase.from('zane_cardio_logs').select('id, date, type, duration_minutes, distance_m, pace_feeling, effort, note, session_id, created_at').eq('user_id', userId).order('date', { ascending: false }),
    // Cardio training plans — manual weekly targets or progressive goal plans
    _supabase.from('zane_cardio_plans').select('id, name, activity_type, archived, mode, days, manual_targets, goal, goal_due_date, start_fitness, generated_weeks, plan_start_date, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
    // Daily health logs (weight / steps / macros / water) — one row per day,
    // all records for the user. Coach reads a client's via the same RLS path.
    _supabase.from('zane_daily_logs').select('id, date, weight, steps, calories, protein, carbs, fat, fiber, water_ml, note, off_plan_note, adherence, targets_snap, daily_coach_fields, updated_at, created_at').eq('user_id', userId).order('date', { ascending: false }),
    // Sick/vacation history periods — used for missed-workout stats and training adherence.
    // Coach reads client's periods via coach-of-client RLS policy (migration 0084).
    _supabase.from('zane_status_periods').select('id, mode, started_at, ended_at').eq('user_id', userId).order('started_at', { ascending: false }),
    // Support tickets — user's own ticket list, newest activity first
    isCoachLoad ? null : _supabase.rpc('get_user_support_chats'),
    // Blood glucose readings — multiple per day, value always in mmol/L (migration 0101)
    _supabase.from('zane_glucose_logs').select('id, date, time, value_mmol, context, note, created_at').eq('user_id', userId).order('date', { ascending: false }).order('time', { ascending: false }),
    // Reusable workout templates (migration 0107)
    _supabase.from('zane_workout_templates').select('id, name, exercises, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
    // Mesocycle state per plan — replaces localStorage logbook-meso-state (migration 0120)
    _supabase.from('zane_meso_states').select('id, schedule_id, weeks, start_date, start_cycle_index, started_at, deltas, joint_flags, pump_low_counts, weight_boosts, growth_counts, completions, pending_meso2, updated_at').eq('user_id', userId),
  ];
  const [profileRes, exRes, schRes, sessRes, settRes, skipsRes, entriesRes,
         bestsRes, sessionStatsRes,
         coachInfoRes, coachClientsRes, unreadNotesRes, coachingRowRes, selfRowRes,
         cardioLogsRes, cardioPlansRes, dailyLogsRes, statusPeriodsRes,
         supportTicketsRes, glucoseLogsRes, templatesRes, mesoStatesRes] = await Promise.all(queries);

  // A failed request (offline, RLS, server error) also yields no data — bail
  // out so the caller can surface an error instead of mistaking this for a
  // new user and re-seeding starter data over an existing account.
  if (profileRes.error) throw profileRes.error;
  // Same for sessions/entries: a silent partial failure would look like an
  // empty history and make the reload merge delete cached sessions (or boot a
  // windowed session list without its sets). Fail loudly instead — the
  // background refresh keeps the cache, the first load shows the retry screen.
  if (sessRes.error) throw sessRes.error;
  if (entriesRes.error) throw entriesRes.error;
  // Settings feed the orphan-cleanup (in_progress_session_id) — a silent failure
  // leaves sett={} and would delete the active in-progress session. Fail loudly.
  if (settRes.error) throw settRes.error;
  // Collection queries feed the store and the cache-first boot merge / sync diff.
  // A failed request yields [] which would look like "user deleted everything"
  // and drop cached data (or delete server rows on the next sync). Fail loudly so
  // the caller keeps the cache and shows the retry screen instead.
  if (exRes.error) throw exRes.error;
  if (schRes.error) throw schRes.error;
  if (skipsRes.error) throw skipsRes.error;
  if (cardioLogsRes.error) throw cardioLogsRes.error;
  if (cardioPlansRes.error) throw cardioPlansRes.error;
  if (dailyLogsRes.error) throw dailyLogsRes.error;
  if (statusPeriodsRes.error) throw statusPeriodsRes.error;
  if (glucoseLogsRes.error) throw glucoseLogsRes.error;
  if (templatesRes.error) throw templatesRes.error;
  if (mesoStatesRes.error) throw mesoStatesRes.error;
  // Coaching queries are null on coach loads (skipped) — guard with optional chaining.
  if (coachInfoRes?.error) throw coachInfoRes.error;
  if (coachClientsRes?.error) throw coachClientsRes.error;
  if (unreadNotesRes?.error) throw unreadNotesRes.error;
  // coachingRowRes/selfRowRes use maybeSingle() and only drive optional banner
  // UI. There is no DB uniqueness constraint on (client_id, active), so a client
  // with >1 active coach yields a PGRST116 "multiple rows" error — do NOT throw
  // on these or such a user can't boot; degrade the banner instead.

  // First login after email confirmation — profile not yet created (skip for coach loads)
  if (!profileRes.data && !isCoachLoad) {
    // guard against infinite recursion if setupNewUser silently fails (e.g. RLS)
    if (_depth > 0) throw new Error('User profile setup failed');
    const { data: { user } } = await _supabase.auth.getUser();
    const name = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Athlete';
    const unit = user?.user_metadata?.unit ?? null;
    try {
      await setupNewUser(userId, name, unit);
    } catch (setupErr) {
      // Profile creation failed (e.g. auth user was deleted externally) — sign out cleanly
      await _supabase.auth.signOut();
      throw new Error('Account not found. Please register again.');
    }
    return loadFromSupabase(userId, _depth + 1);
  }

  const sett = settRes.data || {};

  // Sessions with no ended timestamp that aren't the current in-progress
  // session are orphans (app crashed / closed mid-session). Delete them now.
  // Skip for coach loads — we must not clean up a client's in-progress session.
  const orphanIds = isCoachLoad ? [] : (sessRes.data || [])
    .filter(s => s.ended === null && s.id !== sett.in_progress_session_id)
    .map(s => s.id);
  if (orphanIds.length) {
    _supabase.from('zane_sessions').delete().in('id', orphanIds).then(() => {}, () => {});
  }

  // getSession() reads the session straight from local storage (no network);
  // getUser() revalidates the token against the Auth server — a full round-trip
  // serialized AFTER the whole query batch, just to read the email (which the
  // cached session already carries). On the no-cache boot path this sat directly
  // on the critical path to `ready`.
  const { data: { session: authSession } } = await _supabase.auth.getSession();
  const authUser = authSession?.user;

  // Build a lookup map: session_id → entry rows (sorted by entry_idx, already ordered)
  const entriesBySession = {};
  for (const e of (entriesRes.data || [])) {
    if (!entriesBySession[e.session_id]) entriesBySession[e.session_id] = [];
    entriesBySession[e.session_id].push(e);
  }

  // An in-progress session that predates the boot window (rare — auto-close
  // ends stale sessions) still needs its sets so training can resume.
  const inProgId = sett.in_progress_session_id;
  const inProgRow = inProgId ? (sessRes.data || []).find(s => s.id === inProgId) : null;
  if (inProgRow && !entriesBySession[inProgId] && (inProgRow.date || '').slice(0, 10) < histCutoff) {
    const { data } = await _supabase.from('zane_session_entries')
      .select('*, sets:zane_sets(*)').eq('session_id', inProgId).order('entry_idx');
    if (data?.length) entriesBySession[inProgId] = data;
  }

  // Server aggregates. Tolerate RPC errors (e.g. migration not applied yet) —
  // the maps just stay empty and the client falls back to windowed data.
  const statsBySession = {};
  for (const r of (sessionStatsRes?.data || [])) statsBySession[r.session_id] = r;
  const exerciseBests = {};
  for (const r of (bestsRes?.data || [])) {
    if (r.ex_id != null && r.best_e1rm != null) exerciseBests[r.ex_id] = r.best_e1rm;
  }

  const result = {
    user: { name: profileRes.data?.name || '', email: isCoachLoad ? '' : (authUser?.email || ''), approved: profileRes.data?.approved ?? false },
    exercises: exRes.data || [],
    schedules: (schRes.data || []).map(s => healScheduleWeekdays({
      ...s,
      days: Array.isArray(s.days) ? s.days : [],
      versions: Array.isArray(s.versions) ? s.versions : [],
    })),
    // map snake_case DB columns → camelCase store fields
    sessions: (sessRes.data || []).map(s => {
      const entryRows = entriesBySession[s.id];
      const stats = statsBySession[s.id];
      return {
        id: s.id,
        scheduleId: s.schedule_id,
        dayId: s.day_id,
        dayName: s.day_name,
        date: s.date,
        startedAt: s.started_at ?? null,
        ended: s.ended,
        // Sessions outside the boot window keep entries empty;
        // totalVolume/doneSetCount fall back to the agg* fields below and the
        // session-detail screens lazy-load the sets when opened.
        entries: entryRows && entryRows.length > 0 ? mapEntryRows(entryRows) : [],
        ...(stats ? {
          aggVolume: stats.volume,
          aggDoneSets: stats.done_sets,
          aggExercises: stats.exercise_count,
        } : {}),
        durationMinutes: s.duration_minutes ?? null,
        feel: s.feel ?? null,
        ...(s.is_bonus     ? { isBonus:     true } : {}),
        ...(s.is_freestyle ? { isFreestyle: true } : {}),
        ...(s.is_deload    ? { isDeload:    true } : {}),
      };
    }),
    skips: (skipsRes.data || []).map(s => ({
      id: s.id, date: s.date, dayId: s.day_id, dayName: s.day_name,
      skipReason: s.skip_reason, skippedAt: s.skipped_at,
    })),
    cardioLogs: (cardioLogsRes?.data || []).map(l => ({
      id: l.id, date: l.date, type: l.type ?? null,
      durationMinutes: l.duration_minutes, distanceM: l.distance_m ?? null,
      paceFeeling: l.pace_feeling ?? null, effort: l.effort ?? null,
      note: l.note ?? null, sessionId: l.session_id ?? null, createdAt: l.created_at,
    })),
    cardioPlans: (cardioPlansRes?.data || []).map(p => ({
      id: p.id, name: p.name, activityType: p.activity_type,
      archived: p.archived, mode: p.mode,
      days: p.days ?? {}, manualTargets: p.manual_targets ?? {},
      goal: p.goal ?? null, goalDueDate: p.goal_due_date ?? null,
      startFitness: p.start_fitness ?? null,
      generatedWeeks: p.generated_weeks ?? [],
      planStartDate: p.plan_start_date ?? null,
      createdAt: p.created_at,
    })),
    // Daily health logs (tolerate RPC/table errors before the migration runs —
    // an empty list just means the Health tab shows no history yet).
    dailyLogs: (dailyLogsRes?.data || []).map(l => ({
      id: l.id, date: l.date,
      weight: l.weight ?? null, steps: l.steps ?? null,
      calories: l.calories ?? null, protein: l.protein ?? null,
      carbs: l.carbs ?? null, fat: l.fat ?? null, fiber: l.fiber ?? null,
      waterMl: l.water_ml ?? null, note: l.note ?? null,
      offPlanNote: l.off_plan_note ?? null,
      adherence: l.adherence ?? null, targetsSnap: l.targets_snap ?? null,
      coachFields: l.daily_coach_fields ?? null,
      updatedAt: l.updated_at ?? null,
      createdAt: l.created_at,
    })),
    statusPeriods: (statusPeriodsRes?.data || []).map(p => ({
      id: p.id, mode: p.mode, startedAt: p.started_at, endedAt: p.ended_at ?? null,
    })),
    glucoseLogs: (glucoseLogsRes?.data || []).map(l => ({
      id: l.id, date: l.date, time: l.time,
      valueMmol: l.value_mmol != null ? parseFloat(l.value_mmol) : null,
      context: l.context ?? 'other', note: l.note ?? null, createdAt: l.created_at,
    })),
    workoutTemplates: (templatesRes?.data || []).map(t => ({
      id: t.id, name: t.name,
      exercises: Array.isArray(t.exercises) ? t.exercises : [],
      createdAt: t.created_at,
    })),
    mesoStates: (mesoStatesRes?.data || []).map(m => ({
      id: m.id, scheduleId: m.schedule_id, weeks: m.weeks,
      startDate: m.start_date, startCycleIndex: m.start_cycle_index ?? 0,
      startedAt: m.started_at ?? null,
      deltas: m.deltas ?? {}, jointFlags: m.joint_flags ?? {},
      pumpLowCounts: m.pump_low_counts ?? {}, weightBoosts: m.weight_boosts ?? {},
      growthCounts: m.growth_counts ?? {},
      completions: m.completions ?? 0, pendingMeso2: m.pending_meso2 ?? false,
      updatedAt: m.updated_at ?? null,
    })),
    // All-time best e1RM per exercise (server aggregate, cached in the store —
    // and via the local cache also offline). bestE1rmForExercise combines this
    // with the windowed sessions, so PR detection stays exact mid-session.
    exerciseBests,
    activeScheduleId: sett.active_schedule_id ?? null,
    activeCardioPlanId: sett.active_cardio_plan_id ?? null,
    cycleIndex: sett.cycle_index ?? 0,
    cycleStartDate: sett.cycle_start_date ?? null,
    weekPlanStartDate: sett.week_plan_start_date ?? null,
    lastAdvancedDate: sett.last_advanced_date ?? null,
    inProgress: sett.in_progress_session_id ?? null,
    statusMode: sett.status_mode ?? null,
    statusModeSince: sett.status_mode_since ?? null,
    deloadPromptDismissedAt: sett.deload_prompt_dismissed_at ?? null,
    customDayTypes: sett.custom_day_types ?? [],
    settings: {
        unit: sett.unit ?? null,
        restDefault: sett.rest_default || 120,
        restBig:     sett.rest_big     || 180,
        restMedium:  sett.rest_medium  || 120,
        restSmall:   sett.rest_small   || 90,
        pushEnabled: sett.push_enabled ?? false,
        pushoverUserKey: sett.pushover_user_key ?? null,
        usePushover: sett.use_pushover ?? false,
        cycleWeekView: sett.cycle_week_view ?? false,
        accentColor: sett.accent_color ?? 'copper',
        darkMode: sett.dark_mode ?? 'dark',
        tempoEnabled: sett.tempo_enabled ?? false,
        tempoEccentric: sett.tempo_eccentric ?? 4,
        tempoConcentric: sett.tempo_concentric ?? 1,
        smartProgression: sett.smart_progression ?? false,
        weightFillDown: sett.weight_fill_down ?? true,
        netCarbs: sett.net_carbs ?? false,
        progressionRangeTop: sett.progression_range_top ?? 4,
        equipmentConfig: sett.equipment_config ?? {},
        reminderEnabled: sett.reminder_enabled ?? false,
        reminderTime: sett.reminder_time ?? '07:00',
        showWarmupInSummary: sett.show_warmup_in_summary ?? true,
        showRegression: sett.show_regression ?? true,
        showCoachingTab: sett.show_coaching_tab ?? false,
        beYourOwnCoach: sett.be_your_own_coach ?? false,
        sessionTimeoutMinutes: sett.session_timeout_minutes ?? 90,
        defaultCheckinSchema: sett.default_checkin_schema ?? null,
        macroTargets: sett.macro_targets ?? null,
        showHealthTab: sett.show_health_tab ?? false,
        onboardingCompleted: sett.onboarding_completed ?? false,
        glucoseUnit: sett.glucose_unit ?? 'mmol',
        vipBackground: sett.vip_background ?? null,
        swVersion: sett.sw_version ?? null,
      },
    nextReminderAt: sett.next_reminder_at ?? null,
    coaching: isCoachLoad ? undefined : {
      asClient: (coachInfoRes?.data?.[0]) ? {
        id: coachInfoRes.data[0].coaching_id,
        coachId: coachInfoRes.data[0].coach_id,
        coachEmail: coachInfoRes.data[0].coach_email,
        coachName: coachInfoRes.data[0].coach_name,
        status: coachInfoRes.data[0].status,
        checkinRequestedAt: coachingRowRes?.data?.checkin_requested_at ?? null,
        checkinEnabled: coachingRowRes?.data?.checkin_enabled ?? true,
      } : null,
      asCoach: (coachClientsRes?.data || []).map(r => ({
        id: r.coaching_id,
        clientId: r.client_id,
        clientEmail: r.client_email,
        clientName: r.client_name,
        status: r.status,
        checkinEnabled: r.checkin_enabled ?? true,
      })),
      asSelf: selfRowRes?.data ? { id: selfRowRes.data.id } : null,
      unreadNotes: (unreadNotesRes?.data || []).map(n => ({
        id: n.id,
        coachingId: n.coaching_id,
        authorId: n.author_id,
        type: n.type,
        entityId: n.entity_id,
        entityName: n.entity_name,
        threadId: n.thread_id,
        body: n.body,
        createdAt: n.created_at,
      })),
    },
    supportTickets: (supportTicketsRes?.data || []).map(t => ({
      coachingId: t.coaching_id,
      status: t.support_status,
      category: t.support_category,
      createdAt: t.created_at,
      lastMessageAt: t.last_message_at,
      lastMessageBody: t.last_message_body,
      unreadCount: Number(t.unread_count || 0),
      archived: t.archived || false,
      archivedAt: t.archived_at || null,
    })),
    supportUnread: (supportTicketsRes?.data || []).reduce((s, t) => s + Number(t.unread_count || 0), 0),
  };
  if (!isCoachLoad) await autoArchiveMissedDays(userId, result);
  return result;
}

async function autoArchiveMissedDays(userId, state) {
  const activeSch = state.schedules.find(s => s.id === state.activeScheduleId);
  if (!activeSch) return;
  const isWd = isWeekdayPlan(activeSch);
  if (!isWd && !state.cycleStartDate) return;

  const todayD = new Date(); todayD.setHours(12, 0, 0, 0);
  const sessionDates = new Set(state.sessions.filter(s => s.ended).map(s => s.date.slice(0, 10)));
  const skipDates = new Set(state.skips.map(s => s.date));

  // Collect all missed training days from most recent to oldest
  const missed = [];
  for (let daysAgo = 1; daysAgo <= 365; daysAgo++) {
    const d = new Date(todayD); d.setDate(todayD.getDate() - daysAgo);
    const dateKey = d.toISOString().slice(0, 10);
    if (sessionDates.has(dateKey) || skipDates.has(dateKey)) continue;
    // Version-aware — a hand-rolled copy of this used to ignore a schedule's
    // versioned days (validFrom), so a future plan change threw off which
    // day layout auto-archiving compared against.
    const trainingDay = plannedTrainingDay(state, dateKey);
    if (!trainingDay) continue;
    missed.push({ date: dateKey, dayId: trainingDay.id, dayName: trainingDay.name });
  }

  // Keep the most recent missed day in the banner — archive everything else
  if (missed.length <= 1) return;
  const toCreate = missed.slice(1);

  const nowISO = new Date().toISOString();
  const rows = toCreate.map(({ date, dayId, dayName }) => ({
    id: uid(), user_id: userId, date, day_id: dayId, day_name: dayName,
    skip_reason: '—', skipped_at: nowISO,
  }));
  // Add the archived skips to the returned state and fire the INSERT WITHOUT
  // awaiting it. This pass used to block loadFromSupabase's resolution — the
  // no-cache path to `ready` — on a network write. The rows are deterministic
  // by (date, day) and this pass reruns on every boot, so a failed write is
  // simply recreated next launch; nothing is lost by not awaiting. Matches the
  // pre-existing best-effort semantics (the old code only console.error'd on
  // failure, it never propagated the error).
  state.skips.push(...rows.map(r => ({
    id: r.id, date: r.date, dayId: r.day_id, dayName: r.day_name,
    skipReason: r.skip_reason, skippedAt: r.skipped_at,
  })));
  _supabase.from('zane_skips').insert(rows).then(({ error }) => {
    if (error) console.error('auto-archive missed days:', error);
  });
}

// ─── SYNC ────────────────────────────────────────────────────────────────

// Dual-write entries then sets sequentially (sets FK-depend on entries existing first).
// prevSessions: pass prev store sessions to skip unchanged sets; pass null to write all.
async function _syncEntryRelational(sessions, userId, prevSessions, onStep) {
  const now = new Date().toISOString();
  const allEntries = [];
  const allSets = [];
  // Rows for entries/sets removed since the previous sync (removeExercise,
  // "− REMOVE SET") — never upserted again, so without an explicit delete
  // they'd stay orphaned server-side and resurface on the next re-fetch
  // (boot merge, fetchSessionEntries, the coach spectator view).
  const entryIdsToDelete = [];
  const setIdsToDelete = [];

  // Normalize set fields for comparison — guards against null vs undefined and missing
  // keys when comparing sets from an old (pre-migration) store format with new format.
  const normSet = s => [s.kg ?? null, s.reps ?? null, s.repsL ?? null, s.repsR ?? null,
                        s.timeSec ?? null,
                        s.done ? 1 : 0, s.skipped ? 1 : 0, s.warmup ? 1 : 0,
                        s.technique ?? '', JSON.stringify(s.drops ?? null)].join('|');

  for (const s of sessions) {
    const entries = s.entries || [];
    if (!entries.length) continue;

    const prevSession = prevSessions ? prevSessions.find(x => x.id === s.id) : null;
    const prevEntries = prevSession ? (prevSession.entries || []) : [];

    for (let ei = entries.length; ei < prevEntries.length; ei++) {
      entryIdsToDelete.push(`${s.id}_e${ei}`);
    }

    for (let ei = 0; ei < entries.length; ei++) {
      const e = entries[ei];
      allEntries.push({
        id: `${s.id}_e${ei}`,
        session_id: s.id,
        user_id: userId,
        entry_idx: ei,
        ex_id: e.exId || null,
        name: e.name || '',
        planned_sets: e.plannedSets || null,
        planned_reps: e.plannedReps || null,
        planned_reps_per_set: e.plannedRepsPerSet || null,
        planned_reps_max: e.plannedRepsMax || null,
        planned_progression_offset: e.plannedProgressionOffset ?? null,
        note: e.note || '',
        superset_group: e.supersetGroup || null,
      });

      const prevEntry = prevEntries[ei];
      for (let si = (e.sets || []).length; si < (prevEntry?.sets || []).length; si++) {
        setIdsToDelete.push(`${s.id}_e${ei}_s${si}`);
      }

      (e.sets || []).forEach((set, si) => {
        const prevSet = prevEntry ? (prevEntry.sets || [])[si] : null;
        if (!prevSessions || !prevSet || normSet(prevSet) !== normSet(set)) {
          allSets.push({
            id: `${s.id}_e${ei}_s${si}`,
            session_id: s.id,
            entry_id: `${s.id}_e${ei}`,
            user_id: userId,
            set_idx: si,
            kg: set.kg ?? null,
            reps: set.reps ?? null,
            reps_l: set.repsL ?? null,
            reps_r: set.repsR ?? null,
            time_sec: set.timeSec ?? null,
            done: set.done ?? false,
            skipped: set.skipped ?? false,
            warmup: set.warmup ?? false,
            technique: set.technique ?? null,
            drops: set.drops ?? null,
            updated_at: now,
          });
        }
      });
    }
  }

  if (entryIdsToDelete.length) await unwrap(_supabase.from('zane_session_entries').delete().in('id', entryIdsToDelete));
  if (setIdsToDelete.length) await unwrap(_supabase.from('zane_sets').delete().in('id', setIdsToDelete));

  // Import path uses small chunks (50 rows) to stay well under iOS Safari's
  // per-request payload limits; sync path keeps 500 rows for throughput.
  const CHUNK = prevSessions === null ? 50 : 500;
  const entryTotal = allEntries.length ? Math.ceil(allEntries.length / CHUNK) : 0;
  const setTotal = allSets.length ? Math.ceil(allSets.length / CHUNK) : 0;
  for (let i = 0; i < allEntries.length; i += CHUNK) {
    await unwrap(_supabase.from('zane_session_entries').upsert(allEntries.slice(i, i + CHUNK), { onConflict: 'id' }));
    onStep?.(`Uploading entries (${i/CHUNK+1}/${entryTotal})…`);
  }
  if (prevSessions === null) {
    for (let i = 0; i < allSets.length; i += CHUNK) {
      await unwrap(_supabase.from('zane_sets').upsert(allSets.slice(i, i + CHUNK)));
      onStep?.(`Uploading sets (${i/CHUNK+1}/${setTotal})…`);
    }
  } else {
    for (let i = 0; i < allSets.length; i += CHUNK) {
      await unwrap(_supabase.rpc('sync_sets_batch', { p_sets: allSets.slice(i, i + CHUNK) }));
      onStep?.(`Syncing sets (${i/CHUNK+1}/${setTotal})…`);
    }
  }
}

function sessionToRow(s, userId) {
  // `entries` is intentionally pulled out and NOT written: the relational
  // zane_session_entries / zane_sets tables are the single source of truth, and
  // the reporting RPCs read from them (migration 0058). The legacy JSONB column
  // keeps its default '[]' on insert and is left untouched on update.
  // agg* are read-only server aggregates attached at load time — never synced.
  // eslint-disable-next-line no-unused-vars
  const { currentExIdx, cyclePos, restStart, restDuration, scheduleId, dayId, dayName, startedAt, durationMinutes, feel, entries, aggVolume, aggDoneSets, aggExercises, isBonus, isFreestyle, isDeload, ...rest } = s;
  const row = { ...rest, schedule_id: scheduleId, day_id: dayId, day_name: dayName, user_id: userId };
  if (startedAt != null) row.started_at = startedAt;
  if (durationMinutes != null) row.duration_minutes = durationMinutes;
  row.feel = feel ?? null;
  row.is_bonus = !!isBonus;
  row.is_freestyle = !!isFreestyle;
  row.is_deload = !!isDeload;
  return row;
}

async function syncStore(prev, next, userId) {
  if (!prev || !next || !userId) return;
  const ops = [];

  if (prev.exercises !== next.exercises) {
    const upsert = next.exercises.filter(e => {
      const p = prev.exercises.find(x => x.id === e.id);
      return !p || JSON.stringify(p) !== JSON.stringify(e);
    });
    const removed = prev.exercises.filter(e => !next.exercises.find(x => x.id === e.id));
    if (upsert.length)  ops.push(_supabase.from('zane_exercises').upsert(upsert.map(e => ({ id: e.id, name: e.name, tags: e.tags ?? [], note: e.note ?? '', category: e.category ?? null, unilateral: e.unilateral ?? false, equipment: e.equipment ?? null, progression_reps: e.progression_reps ?? null, movement_type: e.movement_type ?? null, no_weight_reps: !!e.no_weight_reps, log_mode: e.log_mode ?? null, pull_bodyweight: !!e.pull_bodyweight, youtube_url: e.youtube_url ?? null, user_id: userId }))));
    if (removed.length) ops.push(_supabase.from('zane_exercises').delete().in('id', removed.map(e => e.id)));
  }

  if (prev.schedules !== next.schedules) {
    const upsert = next.schedules.filter(s => {
      const p = prev.schedules.find(x => x.id === s.id);
      return !p || JSON.stringify(p) !== JSON.stringify(s);
    });
    const removed = prev.schedules.filter(s => !next.schedules.find(x => x.id === s.id));
    if (upsert.length)  ops.push(_supabase.from('zane_schedules').upsert(upsert.map(({ mode, ...s }) => ({ ...s, user_id: userId }))));
    if (removed.length) ops.push(_supabase.from('zane_schedules').delete().in('id', removed.map(s => s.id)));
    // Fire-and-forget backup whenever days changes to a valid non-empty array.
    // Never blocks the main sync; failures are silently ignored.
    const toBackup = upsert.filter(s => {
      const p = prev.schedules.find(x => x.id === s.id);
      const daysChanged = !p || JSON.stringify(p.days) !== JSON.stringify(s.days);
      return daysChanged && Array.isArray(s.days) && s.days.length > 0;
    });
    if (toBackup.length) {
      _supabase.from('zane_schedule_backups').insert(
        toBackup.map(s => ({ id: uid(), user_id: userId, schedule_id: s.id, schedule_name: s.name, days: s.days }))
      ).then(() => {
        toBackup.forEach(s => {
          _supabase.from('zane_schedule_backups')
            .select('id').eq('schedule_id', s.id).order('created_at', { ascending: false })
            .then(({ data }) => {
              if (data && data.length > 10) {
                _supabase.from('zane_schedule_backups').delete()
                  .in('id', data.slice(10).map(r => r.id)).then(() => {}).catch(() => {});
              }
            }).catch(() => {});
        });
      }).catch(() => {});
    }
  }

  let sessionUpserts = [];
  if (prev.sessions !== next.sessions) {
    const upsert = next.sessions.filter(s => {
      const p = prev.sessions.find(x => x.id === s.id);
      return !p || JSON.stringify(p) !== JSON.stringify(s);
    });
    const removed = prev.sessions.filter(s => !next.sessions.find(x => x.id === s.id));
    if (upsert.length) {
      ops.push(_supabase.from('zane_sessions').upsert(upsert.map(s => sessionToRow(s, userId))));
      // Sync the relational tables for EVERY changed session — including brand-new
      // ones. Since the JSONB dual-write was dropped (migration 0058), the
      // relational rows are the only copy the spectator/overview RPCs can read;
      // skipping creation here left a live session with only its completed sets
      // (planned-but-untouched seeds missing → wrong set totals, "finishing soon").
      // _syncEntryRelational still diffs per set: sessions already in prev write
      // only changed sets; sessions NOT in prev (just created, or offline-created
      // and re-synced after a reload merge) write all their seeded sets once.
      sessionUpserts = upsert;
    }
    if (removed.length) ops.push(_supabase.from('zane_sessions').delete().in('id', removed.map(s => s.id)));
  }

  if (prev.skips !== next.skips) {
    const upsert = (next.skips || []).filter(s => {
      const p = (prev.skips || []).find(x => x.id === s.id);
      return !p || JSON.stringify(p) !== JSON.stringify(s);
    });
    const removed = (prev.skips || []).filter(s => !(next.skips || []).find(x => x.id === s.id));
    if (upsert.length)  ops.push(_supabase.from('zane_skips').upsert(upsert.map(s => ({
      id: s.id, user_id: userId, date: s.date, day_id: s.dayId, day_name: s.dayName,
      skip_reason: s.skipReason, skipped_at: s.skippedAt ?? null,
    }))));
    if (removed.length) ops.push(_supabase.from('zane_skips').delete().in('id', removed.map(s => s.id)));
  }

  if (prev.cardioLogs !== next.cardioLogs) {
    const upsert = (next.cardioLogs || []).filter(l => {
      const p = (prev.cardioLogs || []).find(x => x.id === l.id);
      return !p || JSON.stringify(p) !== JSON.stringify(l);
    });
    const removed = (prev.cardioLogs || []).filter(l => !(next.cardioLogs || []).find(x => x.id === l.id));
    if (upsert.length) ops.push(_supabase.from('zane_cardio_logs').upsert(upsert.map(l => ({
      id: l.id, user_id: userId, date: l.date, type: l.type ?? null,
      duration_minutes: l.durationMinutes, distance_m: l.distanceM ?? null,
      pace_feeling: l.paceFeeling ?? null, effort: l.effort ?? null, note: l.note ?? null,
      session_id: l.sessionId ?? null,
    }))));
    if (removed.length) ops.push(_supabase.from('zane_cardio_logs').delete().in('id', removed.map(l => l.id)));
  }

  if (prev.cardioPlans !== next.cardioPlans) {
    const upsert = (next.cardioPlans || []).filter(p => {
      const old = (prev.cardioPlans || []).find(x => x.id === p.id);
      return !old || JSON.stringify(old) !== JSON.stringify(p);
    });
    const removed = (prev.cardioPlans || []).filter(p => !(next.cardioPlans || []).find(x => x.id === p.id));
    if (upsert.length) ops.push(_supabase.from('zane_cardio_plans').upsert(upsert.map(p => ({
      id: p.id, user_id: userId, name: p.name, activity_type: p.activityType,
      archived: p.archived, mode: p.mode,
      days: p.days, manual_targets: p.manualTargets,
      goal: p.goal, goal_due_date: p.goalDueDate,
      start_fitness: p.startFitness, generated_weeks: p.generatedWeeks,
      plan_start_date: p.planStartDate,
    }))));
    if (removed.length) ops.push(_supabase.from('zane_cardio_plans').delete().in('id', removed.map(p => p.id)));
  }

  if (prev.workoutTemplates !== next.workoutTemplates) {
    const upsert = (next.workoutTemplates || []).filter(t => {
      const p = (prev.workoutTemplates || []).find(x => x.id === t.id);
      return !p || JSON.stringify(p) !== JSON.stringify(t);
    });
    const removed = (prev.workoutTemplates || []).filter(t => !(next.workoutTemplates || []).find(x => x.id === t.id));
    if (upsert.length) ops.push(_supabase.from('zane_workout_templates').upsert(upsert.map(t => ({
      id: t.id, user_id: userId, name: t.name, exercises: t.exercises || [],
    }))));
    if (removed.length) ops.push(_supabase.from('zane_workout_templates').delete().in('id', removed.map(t => t.id)));
  }

  if (prev.mesoStates !== next.mesoStates) {
    const upsert = (next.mesoStates || []).filter(m => {
      const p = (prev.mesoStates || []).find(x => x.id === m.id);
      return !p || JSON.stringify(p) !== JSON.stringify(m);
    });
    const removed = (prev.mesoStates || []).filter(m => !(next.mesoStates || []).find(x => x.id === m.id));
    // Batch RPC only overwrites when the incoming updated_at is newer than
    // what's stored — two devices training the same mesocycle plan don't
    // silently clobber each other's deltas/jointFlags/weightBoosts on a plain
    // last-write-wins upsert. See migration 0122.
    if (upsert.length) ops.push(_supabase.rpc('sync_meso_states_batch', { p_states: upsert.map(m => ({
      id: m.id, schedule_id: m.scheduleId, weeks: m.weeks,
      start_date: m.startDate, start_cycle_index: m.startCycleIndex ?? 0,
      started_at: m.startedAt ?? null,
      deltas: m.deltas ?? {}, joint_flags: m.jointFlags ?? {},
      pump_low_counts: m.pumpLowCounts ?? {}, weight_boosts: m.weightBoosts ?? {},
      growth_counts: m.growthCounts ?? {},
      completions: m.completions ?? 0, pending_meso2: m.pendingMeso2 ?? false,
      updated_at: m.updatedAt ?? new Date().toISOString(),
    })) }));
    if (removed.length) ops.push(_supabase.from('zane_meso_states').delete().in('id', removed.map(m => m.id)));
  }

  if (prev.dailyLogs !== next.dailyLogs) {
    const upsert = (next.dailyLogs || []).filter(l => {
      const p = (prev.dailyLogs || []).find(x => x.id === l.id);
      return !p || JSON.stringify(p) !== JSON.stringify(l);
    });
    const removed = (prev.dailyLogs || []).filter(l => !(next.dailyLogs || []).find(x => x.id === l.id));
    // Batch RPC resolves conflicts on (user_id, date) keeping the existing id,
    // and guards against stale (older updated_at) writes — so two devices
    // editing the same day no longer collide on UNIQUE(user_id, date) and a
    // stale offline edit can't clobber a newer one. See migration 0096.
    if (upsert.length) ops.push(_supabase.rpc('sync_daily_logs_batch', { p_logs: upsert.map(l => ({
      id: l.id, date: l.date,
      weight: l.weight ?? null, steps: l.steps ?? null,
      calories: l.calories ?? null, protein: l.protein ?? null,
      carbs: l.carbs ?? null, fat: l.fat ?? null, fiber: l.fiber ?? null,
      water_ml: l.waterMl ?? null, note: l.note ?? null,
      off_plan_note: l.offPlanNote ?? null,
      adherence: l.adherence ?? null, targets_snap: l.targetsSnap ?? null,
      daily_coach_fields: l.coachFields ?? null,
      updated_at: l.updatedAt ?? new Date().toISOString(),
    })) }));
    if (removed.length) ops.push(_supabase.from('zane_daily_logs').delete().in('id', removed.map(l => l.id)));
  }

  if (prev.user?.name !== next.user?.name && next.user?.name) {
    ops.push(_supabase.from('zane_profiles').upsert({ id: userId, name: next.user.name }));
  }

  const settingsChanged =
    prev.activeScheduleId          !== next.activeScheduleId          ||
    prev.cycleIndex                !== next.cycleIndex                ||
    prev.cycleStartDate            !== next.cycleStartDate            ||
    prev.weekPlanStartDate         !== next.weekPlanStartDate         ||
    prev.lastAdvancedDate          !== next.lastAdvancedDate          ||
    prev.inProgress                !== next.inProgress                ||
    prev.settings?.unit            !== next.settings?.unit            ||
    prev.settings?.restDefault     !== next.settings?.restDefault     ||
    prev.settings?.restBig         !== next.settings?.restBig         ||
    prev.settings?.restMedium      !== next.settings?.restMedium      ||
    prev.settings?.restSmall       !== next.settings?.restSmall       ||
    prev.settings?.pushEnabled     !== next.settings?.pushEnabled     ||
    prev.settings?.pushoverUserKey  !== next.settings?.pushoverUserKey  ||
    prev.settings?.usePushover      !== next.settings?.usePushover      ||
    prev.settings?.cycleWeekView   !== next.settings?.cycleWeekView   ||
    prev.settings?.accentColor      !== next.settings?.accentColor      ||
    prev.settings?.darkMode         !== next.settings?.darkMode          ||
    prev.settings?.tempoEnabled       !== next.settings?.tempoEnabled       ||
    prev.settings?.tempoEccentric     !== next.settings?.tempoEccentric     ||
    prev.settings?.tempoConcentric    !== next.settings?.tempoConcentric    ||
    prev.settings?.smartProgression   !== next.settings?.smartProgression   ||
    prev.settings?.weightFillDown     !== next.settings?.weightFillDown     ||
    prev.settings?.netCarbs           !== next.settings?.netCarbs           ||
    prev.settings?.progressionRangeTop !== next.settings?.progressionRangeTop ||
    JSON.stringify(prev.settings?.equipmentConfig) !== JSON.stringify(next.settings?.equipmentConfig) ||
    JSON.stringify(prev.customDayTypes) !== JSON.stringify(next.customDayTypes) ||
    prev.settings?.reminderEnabled      !== next.settings?.reminderEnabled      ||
    prev.settings?.reminderTime         !== next.settings?.reminderTime         ||
    prev.settings?.showWarmupInSummary  !== next.settings?.showWarmupInSummary  ||
    prev.settings?.showRegression       !== next.settings?.showRegression       ||
    prev.settings?.showCoachingTab      !== next.settings?.showCoachingTab      ||
    prev.settings?.beYourOwnCoach         !== next.settings?.beYourOwnCoach         ||
    prev.settings?.sessionTimeoutMinutes  !== next.settings?.sessionTimeoutMinutes  ||
    prev.settings?.showHealthTab          !== next.settings?.showHealthTab          ||
    JSON.stringify(prev.settings?.macroTargets) !== JSON.stringify(next.settings?.macroTargets) ||
    prev.settings?.onboardingCompleted    !== next.settings?.onboardingCompleted    ||
    prev.settings?.glucoseUnit            !== next.settings?.glucoseUnit            ||
    JSON.stringify(prev.settings?.defaultCheckinSchema) !== JSON.stringify(next.settings?.defaultCheckinSchema) ||
    prev.nextReminderAt                   !== next.nextReminderAt   ||
    prev.statusMode                       !== next.statusMode       ||
    prev.statusModeSince                  !== next.statusModeSince  ||
    prev.deloadPromptDismissedAt          !== next.deloadPromptDismissedAt ||
    prev.activeCardioPlanId               !== next.activeCardioPlanId     ||
    prev.settings?.swVersion              !== next.settings?.swVersion;

  if (settingsChanged) {
    ops.push(_supabase.from('zane_user_settings').upsert({
      user_id: userId,
      active_schedule_id: next.activeScheduleId ?? null,
      active_cardio_plan_id: next.activeCardioPlanId ?? null,
      cycle_index: next.cycleIndex ?? 0,
      cycle_start_date: next.cycleStartDate ?? null,
      week_plan_start_date: next.weekPlanStartDate ?? null,
      last_advanced_date: next.lastAdvancedDate ?? null,
      unit: next.settings?.unit ?? null,
      rest_default: next.settings?.restDefault || 120,
      rest_big:     next.settings?.restBig     || 180,
      rest_medium:  next.settings?.restMedium  || 120,
      rest_small:   next.settings?.restSmall   || 90,
      push_enabled: next.settings?.pushEnabled ?? false,
      pushover_user_key: next.settings?.pushoverUserKey ?? null,
      use_pushover: next.settings?.usePushover ?? false,
      cycle_week_view: next.settings?.cycleWeekView ?? false,
      accent_color: next.settings?.accentColor ?? 'copper',
      dark_mode: next.settings?.darkMode ?? 'dark',
      tempo_enabled: next.settings?.tempoEnabled ?? false,
      tempo_eccentric: next.settings?.tempoEccentric ?? 4,
      tempo_concentric: next.settings?.tempoConcentric ?? 1,
      smart_progression: next.settings?.smartProgression ?? false,
      weight_fill_down: next.settings?.weightFillDown ?? true,
      net_carbs: next.settings?.netCarbs ?? false,
      progression_range_top: next.settings?.progressionRangeTop ?? 4,
      equipment_config: next.settings?.equipmentConfig ?? {},
      custom_day_types: next.customDayTypes ?? [],
      reminder_enabled: next.settings?.reminderEnabled ?? false,
      reminder_time: next.settings?.reminderTime ?? '07:00',
      show_warmup_in_summary: next.settings?.showWarmupInSummary ?? true,
      show_regression: next.settings?.showRegression ?? true,
      show_coaching_tab: next.settings?.showCoachingTab ?? false,
      be_your_own_coach: next.settings?.beYourOwnCoach ?? false,
      session_timeout_minutes: next.settings?.sessionTimeoutMinutes ?? 90,
      macro_targets: next.settings?.macroTargets ?? null,
      show_health_tab: next.settings?.showHealthTab ?? false,
      onboarding_completed: next.settings?.onboardingCompleted ?? false,
      glucose_unit: next.settings?.glucoseUnit ?? 'mmol',
      default_checkin_schema: next.settings?.defaultCheckinSchema ?? null,
      next_reminder_at: next.nextReminderAt ?? null,
      in_progress_session_id: next.inProgress ?? null,
      status_mode: next.statusMode ?? null,
      status_mode_since: next.statusModeSince ?? null,
      deload_prompt_dismissed_at: next.deloadPromptDismissedAt ?? null,
      sw_version: next.settings?.swVersion ?? null,
    }));
  }

  // unwrap() turns a failed write (network/RLS/constraint) into a thrown
  // error so the caller (flushSync) keeps syncBase unchanged and retries,
  // instead of silently advancing past data that never reached the server.
  await Promise.all(ops.map(unwrap));
  // Dual-write entries then sets after sessions are committed (FK order: sessions → entries → sets)
  if (sessionUpserts.length) await _syncEntryRelational(sessionUpserts, userId, prev.sessions);
}

// ─── HELPERS ─────────────────────────────────────────────────────────────

// UTC ISO timestamp for the next training-day reminder, or null if reminder is disabled.
// Skips today if today's reminder time has already passed (prevents re-firing after the
// edge function clears next_reminder_at and the app writes the old value back via syncStore).
function computeNextReminderAt(state) {
  if (!state.settings?.reminderEnabled) return null;
  const sch = state.schedules.find(s => s.id === state.activeScheduleId);
  if (!sch || !sch.days.length) return null;

  const time = state.settings?.reminderTime ?? '07:00';
  const now = new Date();
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const trainedToday = state.sessions.some(s => s.date?.slice(0, 10) === todayStr && s.ended);
  const todayTimePassed = new Date(todayStr + 'T' + time + ':00') <= now;

  for (let ahead = (trainedToday || todayTimePassed) ? 1 : 0; ahead <= 14; ahead++) {
    const d = new Date(today); d.setDate(today.getDate() + ahead);
    const dateStr = d.toISOString().slice(0, 10);
    // Version-aware — see plannedTrainingDay; a hand-rolled copy of this used
    // to resolve weekday plans against sch.days directly, ignoring a plan
    // change scheduled with a future validFrom date. Returns null for every
    // date on a cycle plan with no cycleStartDate / a flex plan on a date
    // other than today, so the loop just runs its course and falls through.
    if (plannedTrainingDay(state, dateStr)) return new Date(dateStr + 'T' + time + ':00').toISOString();
  }
  return null;
}

function cancelPushover(settings, userId) {
  if (!settings?.pushEnabled) return;
  const cancelNonce = `cancel-${Date.now()}`;
  if (settings.pushoverUserKey && settings.usePushover) {
    fnFetch(PUSHOVER_URL, { nonce: cancelNonce, cancel: true });
  } else {
    fnFetch(WEB_PUSH_URL, { nonce: cancelNonce, cancel: true });
  }
  navigator.serviceWorker?.controller?.postMessage({ type: 'CANCEL_REST_TIMER' });
}

// Admin-only: send a one-off email to a user via the admin-send-email edge
// function (Resend). Resolves { ok: true } or { ok: false, error }; never throws.
async function adminSendEmail(to, subject, message) {
  const res = await fnFetch(ADMIN_SEND_EMAIL_URL, { to, subject, message });
  if (!res) return { ok: false, error: 'Network error' };
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error || `Request failed (${res.status})` };
  return { ok: true };
}

function findExercise(state, exId) {
  return state.exercises.find(e => e.id === exId);
}

// Parse a stored ISO date string ('YYYY-MM-DD' or full ISO) as noon local time —
// avoids the DST/midnight TZ shifts that break "same calendar day" lookups.
function parseDate(s) {
  if (!s) return null;
  return new Date(s.slice(0, 10) + 'T12:00:00');
}

// ISO weekday from a Date: 0=Mon … 6=Sun
function isoWd(d) { return (d.getDay() + 6) % 7; }

// Sunday of the week that starts on weekStart (YYYY-MM-DD) → YYYY-MM-DD
function weekEnd(weekStart) {
  return new Date(new Date(weekStart + 'T12:00:00').getTime() + 6 * 86400000).toISOString().slice(0, 10);
}

// Format a duration in seconds for display: "45s" under a minute, "1:15" at or
// above (mm:ss). Used by time-based (log_mode 'time') exercises.
function fmtDuration(sec) {
  if (sec == null || !isFinite(sec)) return '';
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Effective reps for a set — for unilateral sets, the weaker side is the bottleneck.
function effReps(st) {
  if (st.repsL != null || st.repsR != null) {
    return Math.min(st.repsL ?? st.repsR, st.repsR ?? st.repsL);
  }
  return st.reps;
}

// Epley-style estimated 1RM.
function e1rm(kg, reps) {
  return kg * (1 + reps / 30);
}

// Did `curr` beat `prev` (set-vs-same-position-last-time)? Used by the library,
// session detail and coaching views. The live training screen keeps its own
// variant because it evaluates a set mid-completion, before `done` is set.
// More weight at no worse than -2 reps, or same/more weight at more reps.
function isImprovement(curr, prev) {
  // done=true wins: if both done+skipped are set, treat as done
  if (!prev || !curr || !curr.done || curr.kg == null || prev.kg == null) return false;
  const rA = effReps(curr); const rB = effReps(prev);
  if (rA == null || rB == null) return false;
  return (curr.kg > prev.kg && rA >= rB - 2) || (curr.kg >= prev.kg && rA > rB);
}
function isDecline(curr, prev) {
  // done=true wins: only treat as skipped when truly skipped (not also done)
  if (!prev || !curr || (curr.skipped && !curr.done)) return false;
  if (prev.skipped && !prev.done) return false; // prev was already skipped, no baseline to decline from
  if (!curr.done || curr.kg == null || prev.kg == null) return false;
  const rA = effReps(curr); const rB = effReps(prev);
  if (rA == null || rB == null) return false;
  return (curr.kg < prev.kg && rA <= rB) || (curr.kg === prev.kg && rA < rB);
}

// Best estimated 1RM ever recorded for an exercise across all ended sessions,
// optionally excluding a session (e.g. the live one) and optionally restricted
// to sessions with a matching dayId. Returns 0 when there's no history.
// Since boot only loads a recent window of sets, the local scan is combined
// with the cached get_exercise_best_e1rm aggregate (state.exerciseBests) —
// but only when dayId is null, because the aggregate is day-agnostic.
function bestE1rmForExercise(state, exId, excludeSessionId = null, dayId = null) {
  let best = dayId ? 0 : ((state.exerciseBests || {})[exId] || 0);
  for (const s of state.sessions || []) {
    if (!s.ended || s.isDeload || (excludeSessionId && s.id === excludeSessionId)) continue;
    if (dayId && s.dayId !== dayId) continue;
    for (const e of (s.entries || [])) {
      if (e.exId !== exId) continue;
      for (const st of (e.sets || [])) {
        if (st.warmup || st.skipped || st.kg == null) continue;
        const reps = effReps(st);
        if (reps == null || reps <= 0) continue;
        const v = e1rm(st.kg, reps);
        if (v > best) best = v;
      }
    }
  }
  return best;
}

// The "PR" of an assisted exercise: the highest (least-negative, i.e. least
// assistance) load logged across ended sessions. Local window only, no Epley,
// no server aggregate, no 0 seed (loads are negative). Returns null when there
// is no history. Mirrors bestE1rmForExercise's session/set filtering.
function bestAssistLoad(state, exId, excludeSessionId = null, dayId = null) {
  let best = null;
  for (const s of state.sessions || []) {
    if (!s.ended || s.isDeload || (excludeSessionId && s.id === excludeSessionId)) continue;
    if (dayId && s.dayId !== dayId) continue;
    for (const e of (s.entries || [])) {
      if (e.exId !== exId) continue;
      for (const st of (e.sets || [])) {
        if (st.warmup || st.skipped || st.kg == null) continue;
        if (best == null || st.kg > best) best = st.kg;
      }
    }
  }
  return best;
}

// Re-fetch the all-time best-e1RM aggregate (once per session start / training
// mount). Resolves with the fresh map, or null when offline / on error — the
// caller keeps the cached map in that case.
async function refreshExerciseBests(userId) {
  try {
    const { data, error } = await _supabase.rpc('get_exercise_best_e1rm', { p_user_id: userId });
    if (error || !data) return null;
    const bests = {};
    for (const r of data) {
      if (r.ex_id != null && r.best_e1rm != null) bests[r.ex_id] = r.best_e1rm;
    }
    return bests;
  } catch (_) { return null; }
}

// Total volume (kg) of all completed working sets in a session (warm-ups excluded).
// For ended sessions we don't require done:true — a kbApply race can leave sets as
// done:false in Supabase even though the user actually performed them.
// Ended sessions outside the boot window carry no entries — fall back to the
// server aggregate (get_session_stats) attached at load time.
// Volume for a single session entry (one exercise) — same working-set filter
// totalVolume uses, factored out so per-exercise volume (e.g. a session
// compare view) doesn't duplicate the filter logic.
// exercise + bodyweightKg let assisted exercises count real volume: their load
// is stored as NEGATIVE assistance, so the weight actually moved is the user's
// bodyweight minus that assistance (= bodyweightKg + kg). Pass them through from
// totalVolume; callers without exercise/bodyweight context fall back to the old
// clamp-to-0 behavior.
function entryVolume(entry, ended, exercise, bodyweightKg) {
  if (!entry || entry.isCardio) return 0;
  const assisted = isAssisted(exercise);
  return (entry.sets || []).filter(st => {
    if (st.warmup || st.skipped) return false;
    if (ended) return st.kg != null && (st.reps != null || st.repsL != null || st.repsR != null);
    return st.done;
  }).reduce((s, st) => {
    const reps = effReps(st) ?? 0;
    const kg = +st.kg;
    if (assisted) {
      // Assisted: bodyweight minus assistance (kg is negative during assistance,
      // positive once graduated into added weight). Clamp to 0 if assistance
      // exceeds bodyweight. Without a logged bodyweight, fall back to the old
      // behavior (assistance adds 0, a graduated positive load counts on its own).
      const load = bodyweightKg != null ? bodyweightKg + kg : kg;
      return s + Math.max(0, load) * reps;
    }
    // Non-assisted loads are never negative; the clamp is a no-op safety net.
    return s + (kg > 0 ? kg : 0) * reps;
  }, 0);
}
function totalVolume(session, exercises, dailyLogs) {
  const ended = !!session.ended;
  if (ended && !(session.entries || []).length && session.aggVolume != null) return session.aggVolume;
  const exMap = exercises ? new Map(exercises.map(e => [e.id, e])) : null;
  const bw = bodyweightForDate(dailyLogs, session.date);
  return (session.entries || []).reduce((sum, entry) => {
    const ex = exMap ? exMap.get(entry.exId) : null;
    if (ex && (ex.movement_type === 'mobility' || ex.movement_type === 'cardio')) return sum;
    return sum + entryVolume(entry, ended, ex, bw);
  }, 0);
}

// Count of completed working sets in a session (warm-ups excluded).
// Same aggregate fallback as totalVolume for windowed-out sessions.
function doneSetCount(session) {
  const ended = !!session.ended;
  if (ended && !(session.entries || []).length && session.aggDoneSets != null) return session.aggDoneSets;
  return (session.entries || []).reduce((c, e) =>
    c + (e.sets || []).filter(st => {
      if (st.warmup || st.skipped) return false;
      if (ended) return st.timeSec != null || (st.kg != null && (st.reps != null || st.repsL != null || st.repsR != null));
      return st.done;
    }).length, 0);
}

// Index of the latest exercise whose entry has at least one completed set —
// used by the Spectator screen to highlight the active row from polled session data.
function inferCurrentExIdx(entries) {
  if (!entries?.length) return 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].sets?.some(s => s.done)) return i;
  }
  return 0;
}

// Blended remaining-time estimate for a live session — used by Spectator
// and the Active Users overview in Settings.
// Early in the session, historical pace dominates; as more sets land,
// the current-session pace gradually takes over.
function calcBlended(startedAt, avgDurSec, avgSetsTotal, setsDone, setsTotal, nowMs) {
  if (!avgDurSec || !startedAt) return null;
  const elapsed = (nowMs - new Date(startedAt).getTime()) / 1000;
  const remainingSets = Math.max(0, setsTotal - setsDone);
  const histPace = avgSetsTotal > 0 ? avgDurSec / avgSetsTotal : null;
  const currPace = setsDone >= 2 ? elapsed / setsDone : null;

  let remainingSec;
  if (!histPace || setsTotal === 0) {
    remainingSec = Math.max(0, avgDurSec - elapsed);
  } else if (!currPace) {
    remainingSec = Math.max(0, avgDurSec - elapsed);
  } else {
    const w = Math.min(setsDone / 8, 0.7);
    remainingSec = Math.max(0, (w * currPace + (1 - w) * histPace) * remainingSets);
  }

  const progress = setsTotal > 0
    ? setsDone / setsTotal
    : Math.min(1, Math.max(0, elapsed / (elapsed + remainingSec || 1)));

  return { remainingMin: Math.round(remainingSec / 60), progress };
}

// Returns the most recent logged bodyweight from daily logs, or null.
function latestBodyweight(store) {
  const logs = (store.dailyLogs || []).filter(l => l.weight != null);
  if (!logs.length) return null;
  return logs.slice().sort((a, b) => b.date.localeCompare(a.date))[0].weight;
}

// The logged bodyweight closest (in calendar days) to a given date, or null when
// nothing is logged. Assisted-exercise volume uses the bodyweight around the
// session, not just the newest one, so old sessions stay historically accurate.
// dailyLogs is the array (store.dailyLogs / clientStore.dailyLogs); dates are
// 'YYYY-MM-DD' strings, the session date an ISO timestamp.
function bodyweightForDate(dailyLogs, dateISO) {
  const logs = (dailyLogs || []).filter(l => l.weight != null && l.date);
  if (!logs.length) return null;
  if (!dateISO) return logs.slice().sort((a, b) => b.date.localeCompare(a.date))[0].weight;
  const target = new Date(String(dateISO).slice(0, 10)).getTime();
  let best = null, bestDiff = Infinity;
  for (const l of logs) {
    const diff = Math.abs(new Date(String(l.date).slice(0, 10)).getTime() - target);
    if (diff < bestDiff) { bestDiff = diff; best = l.weight; }
  }
  return best;
}

// How an exercise is logged: 'checkbox' (tick only), 'reps' (reps, no weight)
// or 'weight' (weight + reps). Resolves the new log_mode column, falling back to
// the legacy no_weight_reps boolean (true → 'reps') for rows written before
// Migration 0139 / by older clients.
function exerciseLogMode(ex) {
  if (ex?.log_mode) return ex.log_mode;
  return ex?.no_weight_reps ? 'reps' : 'weight';
}

// An "assisted" exercise (assisted dip / pull-up / chin-up) stores the machine
// or band assistance as a NEGATIVE load: less assistance is a higher (less
// negative) kg, so the sign-agnostic isImprovement/isDecline read progress
// correctly with no inversion. The load can graduate past zero into real added
// weight. "Best" for assisted is the highest kg (least assistance), not an
// Epley e1RM. Volume counts the real load moved (bodyweight minus assistance)
// when a bodyweight is logged, else assistance adds no volume (see entryVolume).
function isAssisted(ex) {
  return ex?.movement_type === 'assisted';
}

// Should a set's weight be pre-filled from the user's logged bodyweight? Only for
// bodyweight-equipment exercises that explicitly opted in (pull_bodyweight). The
// caller still has to have a logged weight (latestBodyweight != null) for it to
// actually fill anything.
function shouldPullBodyweight(ex) {
  return ex?.equipment === 'bodyweight' && ex?.pull_bodyweight === true;
}

// Normalize a read-only system-catalog entry (window.SYSTEM_EXERCISES: compact
// shape { movement, logMode }) into an editable store-shape user exercise with a
// fresh id. The interactive "Check & Add" flow instead seeds ExerciseCreator's
// review sheet (so the user can tweak before committing, and the form's save()
// builds the row); this is the programmatic normalizer for any direct-duplication
// path (e.g. the planned plan-editor picker). The result matches syncStore's
// exercises upsert (Migration 0139 columns included).
function systemExerciseToRow(sysEx) {
  const mv = sysEx.movement || 'bilateral';
  const lm = sysEx.logMode || 'weight';
  return {
    id: uid(), name: sysEx.name, tags: sysEx.tags ? [...sysEx.tags] : [], note: '',
    category: sysEx.category ?? null, unilateral: mv === 'unilateral', movement_type: mv,
    log_mode: lm, no_weight_reps: lm !== 'weight', pull_bodyweight: false,
    equipment: sysEx.equipment ?? null, progression_reps: null, youtube_url: null,
  };
}

// Seed sets for a time-based item (log_mode 'time'): per-set target duration
// from the item's authored targets, else the last logged duration at that set
// position, else the last authored target, else a 30s default. `last` is the
// usual { entry: { sets } } reference (bestRecentEntry or a fetchSeedEntries
// row, both carry timeSec). Shared by the session-start builders and
// buildSeedSets (in-session swap) so the ladders can't drift apart.
function buildTimeSeedSets(it, last) {
  const nSets = Math.max(1, it.sets || 1);
  const perSet = Array.isArray(it.timeSecPerSet) ? it.timeSecPerSet : null;
  const lastSets = (last?.entry?.sets || []).filter(s => !s.warmup);
  const seedTime = (i) => (perSet && perSet[i] != null) ? perSet[i]
    : (lastSets[i]?.timeSec != null) ? lastSets[i].timeSec
    : (perSet && perSet.length && perSet[perSet.length - 1] != null) ? perSet[perSet.length - 1]
    : 30;
  return Array.from({ length: nSets }, (_, i) => ({ timeSec: seedTime(i), done: false }));
}

// Compute the seed-sets array when starting/logging a session for a planned item.
// Honors smart-progression suggestions and falls back to last-session values.
// bodyweightKg: prefill kg with this value when kg would otherwise be null (for bodyweight exercises).
function buildSeedSets(it, last, suggestion, isUni, store, bodyweightKg = null, deloadOverride = null) {
  // Time-based exercises have no weight/rep progression: seed target durations
  // instead. This is the path the in-session exercise swap takes; the normal
  // session-start builders branch to buildTimeSeedSets themselves.
  if (exerciseLogMode((store?.exercises || []).find(e => e.id === it.exId)) === 'time') return buildTimeSeedSets(it, last);
  const workingSets = (last?.entry?.sets || []).filter(s => !s.warmup);
  const repsPerSet = it.repsPerSet;
  // Deload overlay: halve the seeded LOAD (not bodyweight, not reps) so a
  // deload week pre-fills at ~50%. Reads the global mirrored from
  // store.statusMode in app.jsx (same pattern as window.__UNIT). Rounded to a
  // 2.5 increment; the user can still adjust per set.
  // deloadOverride lets a caller (e.g. a coach previewing a client's seeds)
  // supply the *subject's* deload state instead of the viewer's global flag.
  const deloadActive = deloadOverride != null
    ? deloadOverride === true
    : (typeof window !== 'undefined' && window.__DELOAD === true);
  // Assisted exercises store a negative load, so halving it would REDUCE the
  // assistance (harder), the opposite of a deload. Leave assisted loads as-is.
  const isAssistedEx = isAssisted((store?.exercises || []).find(e => e.id === it.exId));
  const deload = deloadActive && bodyweightKg == null && !isAssistedEx;
  const dl = (kg) => (deload && kg != null) ? Math.round((kg * 0.5) / 2.5) * 2.5 : kg;
  return Array.from({ length: it.sets }).map((_, i) => {
    const prev = workingSets[i];
    const targetReps = repsPerSet ? (repsPerSet[i] ?? repsPerSet[repsPerSet.length - 1]) : null;
    // For bodyweight exercises bodyweightKg is today's logged weight and always wins over
    // the stale prev.kg (which reflects a different day's bodyweight). For non-bodyweight
    // exercises bodyweightKg is null and prev.kg is used as before.
    const seedKg = bodyweightKg ?? prev?.kg ?? null;
    if (suggestion) {
      // During a deload, halve the ACTUAL last-session weight (prev.kg), not the
      // progression-suggested next weight. Without this, a 100 kg lift with a
      // +5 kg suggestion would seed 52.5 kg instead of the correct 50 kg.
      const baseKg = deload && prev?.kg != null ? prev.kg : suggestion.kg;
      const seedReps = targetReps ?? suggestion.reps;
      return isUni
        ? { kg: dl(baseKg), repsL: seedReps, repsR: seedReps, done: false }
        : { kg: dl(baseKg), reps: seedReps, done: false };
    }
    if (progressionEnabled(store, it.repsMax, it.progressionOffset) && prev) {
      // Only a Range item's own repsMax caps the +1 nudge — the user
      // explicitly drew that boundary, so the seeded value should respect
      // it (one lagging set otherwise keeps the suggestion from firing
      // while a synced set climbs past the range forever). The global
      // default / a custom progressionOffset ceiling is just an internal
      // trigger threshold, not a user-drawn boundary, so it stays
      // uncapped — matches classic Smart Progression's long-standing
      // behavior of nudging reps up every session regardless.
      // The cap only limits the +1 nudge, never the floor: if last session
      // already went past repsMax (e.g. 13 reps on an 8-12 range, taken to
      // failure), seed that actual count, not repsMax. Dropping back to 12 would
      // prescribe LESS than the user just proved they can do at that same weight.
      const cap = it.repsMax;
      const bump = (v) => v == null ? null : (cap != null ? Math.max(v, Math.min(v + 1, cap)) : v + 1);
      return isUni
        ? { kg: dl(seedKg), repsL: bump(prev.repsL), repsR: bump(prev.repsR), done: false }
        : { kg: dl(seedKg), reps: bump(prev.reps), done: false };
    }
    if (!prev && targetReps != null) {
      return isUni
        ? { kg: dl(bodyweightKg ?? null), repsL: targetReps, repsR: targetReps, done: false }
        : { kg: dl(bodyweightKg ?? null), reps: targetReps, done: false };
    }
    return isUni
      ? { kg: dl(seedKg), repsL: prev?.repsL ?? null, repsR: prev?.repsR ?? null, done: false }
      : { kg: dl(seedKg), reps: prev?.reps ?? null, done: false };
  });
}

function lastSessionForExercise(state, exId, dayId = null) {
  return recentSessionsForExercise(state, exId, dayId, 1)[0] ?? null;
}

// Up to `limit` most-recent ended sessions that logged this exercise, newest first.
// Deload sessions are excluded so a deliberately light week never seeds the next
// session's weights or skews progression/regression.
function recentSessionsForExercise(state, exId, dayId = null, limit = 3) {
  const sessions = state.sessions
    .filter(s => s.ended && !s.isDeload && (dayId == null || s.dayId === dayId))
    .slice()
    .sort((a, b) => (b.ended || '').localeCompare(a.ended || ''));
  const out = [];
  for (const s of sessions) {
    const entry = (s.entries || []).find(e => e.exId === exId &&
      (e.sets || []).some(x => x.kg != null || x.reps != null || x.repsL != null || x.repsR != null || x.timeSec != null));
    if (entry) out.push({ session: s, entry });
    if (out.length >= limit) break;
  }
  return out;
}

// Core of bestRecentEntry, factored out so the same logic can run on server
// rows from get_exercise_history (fetchSeedEntries). perSession: newest-first
// list of working-set arrays (warm-ups/skipped already filtered out).
function bestEntryFromSetLists(perSession) {
  if (!perSession.length) return null;
  const mostRecent = perSession[0];
  if (!mostRecent.length) return null;
  const sets = mostRecent.map((curSet, i) => {
    const curKg = curSet.kg ?? null;          // current working weight at this position
    let best = curSet;
    let bestReps = effReps(curSet);
    for (const ws of perSession) {
      const cand = ws[i];
      if (!cand || (cand.kg ?? null) !== curKg) continue; // same weight only
      const r = effReps(cand);
      if (r == null) continue;
      if (bestReps == null || r > bestReps) { bestReps = r; best = cand; }
    }
    // Time-based sets carry no kg/reps to compare, so `best` stays the most
    // recent set — pass its duration through as the reference / seed.
    if (best.timeSec != null) return { kg: curKg, timeSec: best.timeSec, done: false, skipped: false, warmup: false };
    return (best.repsL != null || best.repsR != null)
      ? { kg: curKg, repsL: best.repsL ?? null, repsR: best.repsR ?? null, done: false, skipped: false, warmup: false }
      : { kg: curKg, reps: best.reps ?? null, done: false, skipped: false, warmup: false };
  });
  return { entry: { sets } };
}

// Seed/progression reference: per working-set position, the BEST set performed at
// the CURRENT working weight within the recent window. A single weak session can
// no longer drag a suggestion below proven capability — the reference is the best
// recent performance, not merely the last one. Returns the same { entry: { sets } }
// shape as lastSessionForExercise so buildSeedSets and progressionSuggestion
// consume it unchanged. Compares reps only at the same weight (a heavier session
// with fewer reps is real progression, not weakness).
function bestRecentEntry(state, exId, dayId = null, window = 3) {
  const recent = recentSessionsForExercise(state, exId, dayId, window);
  if (!recent.length) return null;
  // Only warm-ups are stripped — warm-ups are always a contiguous prefix, so
  // dropping them still leaves working-set position i aligned across
  // sessions. A skipped set must stay in place instead: dropping it too would
  // shift every later set one slot to the left, misaligning bestEntryFromSetLists'
  // same-position comparison against sessions where that set wasn't skipped.
  return bestEntryFromSetLists(recent.map(r => (r.entry.sets || []).filter(s => !s.warmup)));
}

// Recent ended sessions for an exercise from the server (get_exercise_history),
// mapped to camelCase rows: [{ sessionId, dayId, date, ended, sets }].
async function fetchExerciseHistory(exId, dayId, limit, userId) {
  const { data, error } = await _supabase.rpc('get_exercise_history', {
    p_ex_id: exId, p_day_id: dayId ?? null, p_limit: limit, p_user_id: userId ?? null,
  });
  if (error) throw error;
  return (data || []).map(r => ({
    sessionId: r.session_id, dayId: r.day_id, date: r.date, ended: r.ended,
    sets: r.sets || [],
  }));
}

// Seed references for starting/logging a session. The local window already
// covers exercises trained recently — only exercises with fewer than `window`
// local sessions ask the server (get_exercise_history), so the common case
// stays synchronous-fast and fully offline-capable. Server rows are merged
// with local ones (a just-ended session may not be synced yet) and reduced via
// bestEntryFromSetLists. Returns { exId: { entry: { sets } } } — only for
// exercises where the server added anything; callers fall back to
// bestRecentEntry for the rest. Never rejects.
async function fetchSeedEntries(state, items, dayId, userId, window = 3) {
  const out = {};
  const exIds = [...new Set((items || []).map(it => it.exId).filter(Boolean))]
    .filter(exId => recentSessionsForExercise(state, exId, dayId, window).length < window);
  if (!exIds.length) return out;
  await Promise.all(exIds.map(async exId => {
    try {
      const rows = await fetchExerciseHistory(exId, dayId, window, userId);
      if (!rows.length) return;
      const local = recentSessionsForExercise(state, exId, dayId, window)
        .map(r => ({ sessionId: r.session.id, ended: r.session.ended, sets: r.entry.sets || [] }));
      // Deload sessions are excluded from local via recentSessionsForExercise, but
      // the server RPC doesn't know about is_deload and may return them. Guard by
      // checking server rows against locally-known deload session ids.
      const deloadIds = new Set((state.sessions || []).filter(s => s.isDeload).map(s => s.id));
      const merged = [...local];
      for (const row of rows) {
        if (!merged.some(m => m.sessionId === row.sessionId) && !deloadIds.has(row.sessionId)) merged.push(row);
      }
      merged.sort((a, b) => (Date.parse(b.ended) || 0) - (Date.parse(a.ended) || 0));
      // Keep skipped sets in place (only warm-ups are stripped) so working-set
      // position stays aligned across sessions — see bestRecentEntry above.
      const ref = bestEntryFromSetLists(
        merged.slice(0, window).map(r => (r.sets || []).filter(s => !s.warmup))
      );
      if (ref) out[exId] = ref;
    } catch (_) { /* offline / RPC failure → caller uses the local window */ }
  }));
  return out;
}

// Lazy-load the full entries of specific sessions (session-detail views for
// sessions outside the boot window). RLS covers own rows and coach-of reads.
// Returns { sessionId: entries[] } in store shape.
async function fetchSessionEntries(sessionIds) {
  const ids = (sessionIds || []).filter(Boolean);
  if (!ids.length) return {};
  const { data, error } = await _supabase.from('zane_session_entries')
    .select('*, sets:zane_sets(*)')
    .in('session_id', ids)
    .order('entry_idx');
  if (error) throw error;
  const bySession = {};
  for (const e of (data || [])) {
    if (!bySession[e.session_id]) bySession[e.session_id] = [];
    bySession[e.session_id].push(e);
  }
  const out = {};
  for (const id of Object.keys(bySession)) out[id] = mapEntryRows(bySession[id]);
  return out;
}

function isWeekdayPlan(sch) {
  return sch.mode === 'weekday' || (sch.days.length > 0 && sch.days.some(d => d.weekday != null));
}

// Flexible plan: an ordered-day cycle whose position advances only on a logged
// session or skip (never by calendar date). is_flex is a passthrough DB column
// on the schedule object (like days/versions/archived). A flex plan is never a
// weekday plan.
function isFlexPlan(sch) {
  return !!sch && sch.is_flex === true;
}

// Self-heal a plan whose weekday data is inconsistent, so it stays schedulable
// and never trips the viewer. Repairs legacy shapes that predate the 2.464
// mode-switch fix (Cycle -> Weekday now clears the days; older builds kept
// them, leaving a weekday plan with weekday-less days):
//   - mode 'weekday' with days missing a valid weekday index: give each such
//     day the next free Mon..Sun slot, preserving day order. If they can't fit
//     the 7-day week (more than 7 days), demote the plan to a plain cycle.
//   - a stray weekday clinging to only some days of a non-weekday plan (which
//     makes isWeekdayPlan misfire): strip it back to a clean cycle.
// Only sch.days (the live structure) is touched; versions[] snapshots stay as
// is, since an old cycle-era version legitimately has no weekdays and the
// viewer's weekday-label guard renders those as "Day N". Pure: returns the same
// object when nothing needs healing.
function healScheduleWeekdays(sch) {
  if (!sch || !Array.isArray(sch.days) || sch.days.length === 0) return sch;
  const validWd = wd => Number.isInteger(wd) && wd >= 0 && wd <= 6;
  const days = sch.days;
  const allValid = days.every(d => validWd(d.weekday));
  if (sch.mode === 'weekday') {
    if (allValid) return sch;
    const taken = new Set(days.filter(d => validWd(d.weekday)).map(d => d.weekday));
    const need = days.filter(d => !validWd(d.weekday)).length;
    const free = [];
    for (let i = 0; i <= 6 && free.length < need; i++) if (!taken.has(i)) free.push(i);
    if (free.length < need) {
      // More days than a week holds: this was never a real weekday plan, so keep
      // the days and their order as a cycle.
      return { ...sch, mode: undefined, days: days.map(d => { const nd = { ...d }; delete nd.weekday; return nd; }) };
    }
    let fi = 0;
    return { ...sch, days: days.map(d => validWd(d.weekday) ? d : { ...d, weekday: free[fi++] }) };
  }
  // Not weekday mode: a stray weekday on some (not all) days makes isWeekdayPlan
  // true and can crash the viewer. Clean it back to a pure cycle. An all-weekday
  // cycle plan is effectively a weekday plan already and renders fine, so leave
  // that alone.
  if (!allValid && days.some(d => d.weekday != null)) {
    return { ...sch, days: days.map(d => { const nd = { ...d }; delete nd.weekday; return nd; }) };
  }
  return sch;
}

// Training-split presets for the plan setup wizard (screens-schedule.jsx):
// each is a base `block` of day-types repeated `repeats` times. How that turns
// into days depends on the plan type (see buildPlanSkeleton): cycle closes each
// block with a REST day, flex repeats the block flat (flex has no rest days),
// weekday maps the block round-robin onto the chosen weekdays. Types come from
// STANDARD_DAY_TYPES. 'custom' has no preset (the wizard asks for a day count).
const SPLIT_PRESETS = {
  full3: { block: ['FULL'], repeats: 3 },
  ul4:   { block: ['UPPER', 'LOWER'], repeats: 2 },
  ppl3:  { block: ['PUSH', 'PULL', 'LEGS'], repeats: 1 },
  ppl6:  { block: ['PUSH', 'PULL', 'LEGS'], repeats: 2 },
};

// Natural training-day count of a split preset (block length x repeats); 0 for
// custom / unknown. The wizard uses it to guard weekday plans (you can't map a
// 6-day split onto only 5 weekdays).
function splitDayCount(presetKey) {
  const p = SPLIT_PRESETS[presetKey];
  return p ? p.block.length * p.repeats : 0;
}

// Build a ready-to-register schedule object from the plan setup wizard's picks.
// Single source of truth for the new-plan shape (snake_case passthrough columns;
// only the local-only `mode` is stripped before upsert). The wizard appends the
// result to store.schedules and navigates to the editor. The zane_meso_states
// row is NOT created here — the home/train effects auto-start it once the plan
// is activated.
//   type        : 'cycle' | 'weekday' | 'flex'
//   presetKey   : a SPLIT_PRESETS key or 'custom'
//   customCount : day count when presetKey === 'custom' (cycle/flex only)
//   customDays  : explicit per-day type list for a custom split (wins over count)
//   weekdays    : array of weekday indices 0..6 (weekday plans only)
//   mesoWeeks   : truthy → run as a mesocycle of that many weeks
//   mesoStartRir/mesoEndRir : optional RIR taper endpoints (else app fallbacks 3/0)
//   mesoRirEnabled : false → RIR taper off (volume + load progression + deload only)
function buildPlanSkeleton({ name, type, presetKey, customCount, customDays, weekdays, mesoWeeks, mesoStartRir, mesoEndRir, mesoRirEnabled } = {}) {
  const preset = SPLIT_PRESETS[presetKey];
  // A customDays entry is a type string, or { name, items } (a day imported with
  // its exercises), or null (unpicked → FULL).
  const cdName = (cd) => (typeof cd === 'string' ? cd : cd && cd.name) || 'FULL';
  const cdItems = (cd) => (cd && typeof cd === 'object' && Array.isArray(cd.items)) ? cd.items.map(x => ({ ...x })) : [];
  let days;
  if (type === 'weekday') {
    // A fixed preset's rotation maps onto the sorted weekdays (round-robin; the
    // wizard requires exactly splitDayCount days so it divides evenly). Custom
    // uses the per-day picks (customDays, one per sorted weekday), incl. any
    // imported exercises, else FULL. No explicit REST days: a weekday plan rests
    // on the calendar days you skip.
    const block = preset ? preset.block : null;
    days = (weekdays || []).slice().sort((a, b) => a - b)
      .map((i, n) => {
        const cd = customDays && customDays[n];
        const name = presetKey === 'custom' ? cdName(cd) : (block ? block[n % block.length] : 'FULL');
        const items = presetKey === 'custom' ? cdItems(cd) : [];
        return { id: uid(), name, weekday: i, items };
      });
  } else if (presetKey === 'custom' || !preset) {
    // Custom: the per-day picks the wizard collected (unpicked → FULL, imported
    // days carry their exercises); fall back to a plain count of FULL days.
    const cds = (customDays && customDays.length)
      ? customDays
      : Array.from({ length: Math.max(1, Math.round(customCount || 1)) }, () => null);
    days = cds.map(cd => ({ id: uid(), name: cdName(cd), items: cdItems(cd) }));
  } else {
    const types = [];
    // Flex has no rest days (advances only on a logged session/skip); cycle
    // closes each block with a REST day ("rest days included").
    if (type === 'flex') { for (let r = 0; r < preset.repeats; r++) types.push(...preset.block); }
    else { for (let r = 0; r < preset.repeats; r++) types.push(...preset.block, 'REST'); }
    days = types.map(t => ({ id: uid(), name: t, items: [] }));
  }
  const sch = { id: uid(), name: (name || '').trim() || 'My Plan', days, archived: false };
  if (type === 'weekday') sch.mode = 'weekday';
  if (type === 'flex') {
    sch.is_flex = true;
    // Weekly goal = number of TRAINING days (flex has no rest days anyway).
    sch.sessions_per_week = days.length || null;
  }
  if (mesoWeeks) {
    sch.mesocycle_weeks = mesoWeeks;
    if (mesoStartRir != null) sch.mesocycle_start_rir = mesoStartRir;
    if (mesoEndRir != null) sch.mesocycle_end_rir = mesoEndRir;
    // Only persist the explicit "off" — default (undefined/true) leaves the DB
    // default and reads as enabled everywhere.
    if (mesoRirEnabled === false) sch.mesocycle_rir_enabled = false;
  }
  return sch;
}

// Instantiate a pre-built program (a window.SYSTEM_PROGRAMS entry) into an
// editable flex-mesocycle plan. Pure: returns { schedule, newExercises } and
// mutates nothing — the caller appends both in one setStore and navigates to the
// editor, exactly like PlanWizard.create().
// Each program item references a system-catalog exercise BY NAME. We resolve each
// to one of the USER's own exercises: reuse a same-named one if it exists, else
// materialize an editable copy via systemExerciseToRow — the same name-dedup
// ExercisePicker.finalizePick uses, so plans never hold sys_ ids and history for
// an exercise the user already owns never splits. A name repeated across days
// resolves to a single materialized row. Days are fed to buildPlanSkeleton as
// customDays with type 'flex' (advance on a logged session, sessions_per_week =
// day count, no fixed weekdays — the beginner-friendly "how many days can you"
// model).
function instantiateProgram(state, program) {
  const catalog = (typeof window !== 'undefined' && window.SYSTEM_EXERCISES) || [];
  const sysByName = new Map(catalog.map(s => [(s.name || '').toUpperCase(), s]));
  const userByName = new Map((state.exercises || []).map(e => [(e.name || '').toUpperCase(), e.id]));
  const newExercises = [];
  const resolve = (exName) => {
    const key = (exName || '').toUpperCase();
    const existing = userByName.get(key);
    if (existing) return existing;
    const sys = sysByName.get(key);
    if (!sys) return null; // unknown name — guarded (a store.test.cjs check keeps the catalog honest)
    const row = systemExerciseToRow(sys);
    newExercises.push(row);
    userByName.set(key, row.id);
    return row.id;
  };
  const customDays = (program.days || []).map(d => ({
    name: d.name,
    items: (d.items || []).map(it => {
      const exId = resolve(it.ex);
      if (!exId) return null;
      return { exId, sets: it.sets || 2, reps: it.reps ?? 8, ...(it.repsMax != null ? { repsMax: it.repsMax } : {}) };
    }).filter(Boolean),
  }));
  const meso = program.meso || {};
  const schedule = buildPlanSkeleton({
    name: program.name,
    type: 'flex',
    customDays,
    mesoWeeks: meso.weeks || null,
    mesoStartRir: meso.startRir != null ? meso.startRir : null,
    mesoEndRir: meso.endRir != null ? meso.endRir : null,
  });
  return { schedule, newExercises };
}

// ── 5/3/1 (Wendler) program math ────────────────────────────────────────────
// A schedule with program_type '531' runs Wendler 5/3/1: every working weight
// is a percentage of a stored per-lift Training Max (program_data.mainLifts),
// not derived from logged history. These helpers are pure and unit-tested; the
// seeding/runtime wiring lives in screens-home.jsx / screens-train.jsx.
// Unit note: like the rest of the app, loads live in the .kg field, but a lbs
// user's numbers ARE lbs (no conversion). Rounding and TM bumps key off the
// program's stored unit, never a hardcoded kg step.
const FTO_WAVES = {
  1: [{ pct: 65, reps: 5 }, { pct: 75, reps: 5 }, { pct: 85, reps: 5, amrap: true }],
  2: [{ pct: 70, reps: 3 }, { pct: 80, reps: 3 }, { pct: 90, reps: 3, amrap: true }],
  3: [{ pct: 75, reps: 5 }, { pct: 85, reps: 3 }, { pct: 95, reps: 1, amrap: true }],
  4: [{ pct: 40, reps: 5 }, { pct: 50, reps: 5 }, { pct: 60, reps: 5 }], // optional deload
};

function is531Plan(sch) {
  return !!sch && sch.program_type === '531';
}

// Smallest loadable step for the plan's unit: 2.5 kg or 5 lb. Every 5/3/1
// weight is rounded to this so the bar can actually be loaded.
function round531(val, unit) {
  if (val == null || !isFinite(val)) return null;
  const inc = unit === 'lbs' ? 5 : 2.5;
  return Math.round(val / inc) * inc;
}

// Training Max = 90% of a (true or estimated) 1RM, rounded to the load step.
function tmFrom531(oneRm, unit) {
  if (!oneRm || oneRm <= 0) return null;
  return round531(oneRm * 0.9, unit);
}

// Per-cycle TM increase: lower body (squat/deadlift) climbs twice as fast as
// upper (bench/ohp): +5/+2.5 kg, or +10/+5 lb. Extra main lifts added beyond the
// canonical four carry kind 'lower' or 'upper' to pick the same two rates.
function tmBump531(kind, unit) {
  const lower = kind === 'squat' || kind === 'deadlift' || kind === 'lower';
  if (unit === 'lbs') return lower ? 10 : 5;
  return lower ? 5 : 2.5;
}

// Number of weeks in one block: 4 with the optional deload, else 3.
function weeks531(includeDeload) {
  return includeDeload ? 4 : 3;
}

// The clamped week index (1..maxWeek) inside the current block, from a running
// count of completed weeks. Week 4 (deload) only exists when opted in.
function week531(completedWeeks, includeDeload) {
  const maxWeek = weeks531(includeDeload);
  const w = (Math.max(0, completedWeeks) % maxWeek) + 1;
  return Math.min(maxWeek, Math.max(1, w));
}

// The three prescribed working sets for one lift in a given week. Each set's
// load is round(pct * tm); a null tm yields null loads (preview before setup).
// The top set of weeks 1-3 is an AMRAP ("+"), its reps being the required
// minimum. pct is returned for display ("85% x 5+").
function fiveThreeOneSets(tm, week, unit) {
  const wave = FTO_WAVES[week] || FTO_WAVES[1];
  return wave.map(s => ({
    kg: (tm != null) ? round531(tm * s.pct / 100, unit) : null,
    reps: s.reps,
    pct: s.pct,
    ...(s.amrap ? { amrap: true } : {}),
  }));
}

const FTO_DAY_NAME = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift', ohp: 'Press' };

// Instantiate a 5/3/1 program into an editable flex plan. config (collected by
// the setup wizard):
//   { name?, unit, includeDeload, lifts: [{ kind, ex, tm }],
//     assistance: { <kind>: [exName, ...] } }
// Resolves every exercise name to one of the user's own (reuse-or-materialize,
// exactly like instantiateProgram, so plans never hold sys_ ids), builds one
// flex day per main lift (3 working sets + any picked assistance items),
// and stamps program_type '531' + program_data with per-lift Training Maxes
// keyed by the RESOLVED exId. Assistance stays an ordinary Range item on normal
// Smart Progression. Returns { schedule, newExercises }; mutates nothing.
function build531Plan(state, config) {
  const catalog = (typeof window !== 'undefined' && window.SYSTEM_EXERCISES) || [];
  const sysByName = new Map(catalog.map(s => [(s.name || '').toUpperCase(), s]));
  const userByName = new Map((state.exercises || []).map(e => [(e.name || '').toUpperCase(), e.id]));
  const byId = new Set((state.exercises || []).map(e => e.id));
  const newExercises = [];
  // exRef is a catalog name OR an already-owned user exercise id (assistance
  // picked in the wizard arrives as an id); owned ids pass straight through.
  const resolve = (exRef) => {
    if (exRef && byId.has(exRef)) return exRef;
    const key = (exRef || '').toUpperCase();
    const existing = userByName.get(key);
    if (existing) return existing;
    const sys = sysByName.get(key);
    if (!sys) return null;
    const row = systemExerciseToRow(sys);
    newExercises.push(row);
    userByName.set(key, row.id);
    return row.id;
  };
  const unit = config.unit === 'lbs' ? 'lbs' : 'kg';
  const includeDeload = config.includeDeload !== false;
  const mainLifts = {};
  const customDays = [];
  for (const lift of (config.lifts || [])) {
    const mainId = resolve(lift.ex);
    if (!mainId) continue;
    mainLifts[mainId] = { tm: (lift.tm != null ? lift.tm : null), kind: lift.kind, stall: 0 };
    const items = [{ exId: mainId, sets: 3, reps: 5 }];
    // Assistance can ride on the lift itself (extra lifts, keyed by exId) or on
    // the shared config.assistance map (the canonical four, keyed by kind).
    const picks = (lift.assistance && lift.assistance.length) ? lift.assistance : ((config.assistance && config.assistance[lift.kind]) || []);
    for (const aName of picks) {
      const aId = resolve(aName);
      if (aId) items.push({ exId: aId, sets: 3, reps: 8, repsMax: 12 });
    }
    // Canonical lifts get their short day name; an extra lift names its day after
    // the exercise (lift.name), never the bare 'upper'/'lower' classification.
    customDays.push({ name: FTO_DAY_NAME[lift.kind] || lift.name || lift.kind, items });
  }
  // Seed the TM history with each lift's starting Training Max (cycle 0), so the
  // progress chart has a first point and every later bump/reset appends to it.
  const tmHistory = {};
  for (const exId of Object.keys(mainLifts)) {
    const t = mainLifts[exId].tm;
    tmHistory[exId] = (t != null) ? [{ cycle: 0, tm: t, reason: 'start' }] : [];
  }
  const schedule = buildPlanSkeleton({ name: config.name || '5/3/1', type: 'flex', customDays });
  schedule.program_type = '531';
  schedule.program_data = { unit, includeDeload, mainLifts, tmHistory };
  return { schedule, newExercises };
}

// Register one more main lift on an existing 5/3/1 plan's program_data (the
// editor's "add main lift" flow; build531Plan handles the from-scratch setup).
// A 5/3/1 plan is a flex plan, so it can carry any number of lifts/days. Pure:
// returns { programData, items } and the caller assembles the day
// ({ id, name, items }) and appends it to sch.days. `exId` is an already-resolved
// user exercise id; `kind` is a canonical lift or 'upper'/'lower' (drives the
// per-cycle bump); `cycle` stamps the tmHistory start point (the plan's current
// cycle, so the chart starts where the lift was added). `assistanceIds` become
// ordinary Range items (Smart Progression, never tracked in mainLifts).
function add531MainLift(pd, config = {}) {
  const exId = config.exId;
  const kind = config.kind || 'upper';
  const tm = config.tm != null ? config.tm : null;
  const nextMain = { ...((pd && pd.mainLifts) || {}), [exId]: { tm, kind, stall: 0 } };
  const nextHist = { ...((pd && pd.tmHistory) || {}) };
  nextHist[exId] = tm != null ? [{ cycle: config.cycle || 0, tm, reason: 'start' }] : [];
  const items = [{ exId, sets: 3, reps: 5 }];
  for (const aId of (config.assistanceIds || [])) if (aId) items.push({ exId: aId, sets: 3, reps: 8, repsMax: 12 });
  return { programData: { ...(pd || {}), mainLifts: nextMain, tmHistory: nextHist }, items };
}

// The current 5/3/1 week (1..maxWeek) for a plan, from how many sessions are
// logged on it: every full pass through the plan's days is one week, wrapping
// into the next cycle at maxWeek. Mirrors mesoCurrentWeek's flex counting.
// Only ended, non-app-deload sessions on this plan count; 5/3/1's own week-4
// deload is a normal logged session, so it still advances the count. Bonus
// sessions are excluded: they carry the plan's scheduleId but explicitly do
// not advance the plan position (a bonus finished with "advance cycle" loses
// its isBonus flag and then counts, matching the flex-position semantics).
function count531Sessions(sch, sessions) {
  return (sessions || []).filter(s => s.ended && !s.isDeload && !s.isBonus && s.scheduleId === sch.id);
}

function current531Week(sch, sessions) {
  if (!is531Plan(sch)) return null;
  const dayCount = (sch.days || []).length || 1;
  const includeDeload = sch.program_data?.includeDeload !== false;
  const trained = count531Sessions(sch, sessions).length;
  return week531(Math.floor(trained / dayCount), includeDeload);
}

// 0-based cycle index (how many full 3- or 4-week blocks are complete) for a
// 5/3/1 plan. Drives the per-cycle TM bump.
function current531Cycle(sch, sessions) {
  if (!is531Plan(sch)) return 0;
  const dayCount = (sch.days || []).length || 1;
  const includeDeload = sch.program_data?.includeDeload !== false;
  const trained = count531Sessions(sch, sessions).length;
  return Math.floor(Math.floor(trained / dayCount) / weeks531(includeDeload));
}

// Decide each main lift's next Training Max after a completed 5/3/1 cycle.
// Wendler's rule: the TM only goes up if the AMRAP top set hit its required
// minimum reps across weeks 1-3 (week1 >= 5, week2 >= 3, week3 >= 1, read from
// the wave table); any miss holds it. Weeks are derived from logged-session
// order, the same counting as current531Week, and the AMRAP set is the last
// working (non-warmup, non-skipped) set of the main lift's entry. Returns
// { exId: { kind, oldTm, newTm, bumped } } (empty if not a 531 plan).
function compute531CycleBumps(sch, sessions, cycleIdx) {
  if (!is531Plan(sch)) return {};
  const pd = sch.program_data || {};
  const mainLifts = pd.mainLifts || {};
  const unit = pd.unit || 'kg';
  const dayCount = (sch.days || []).length || 1;
  const maxWeek = weeks531(pd.includeDeload !== false);
  const amrapMin = (wk) => { const w = FTO_WAVES[wk]; const top = w && w[w.length - 1]; return (top && top.amrap) ? top.reps : null; };
  const planSessions = count531Sessions(sch, sessions)
    .slice()
    .sort((a, b) => ((a.ended || '') < (b.ended || '') ? -1 : (a.ended || '') > (b.ended || '') ? 1 : 0));
  const perLift = {}; // exId -> [hitBool, ...] across weeks 1-3
  planSessions.forEach((s, idx) => {
    const completedWeeks = Math.floor(idx / dayCount);
    if (Math.floor(completedWeeks / maxWeek) !== cycleIdx) return;
    const min = amrapMin((completedWeeks % maxWeek) + 1);
    if (min == null) return; // deload week: no AMRAP, no signal
    const mainEntry = (s.entries || []).find(e => mainLifts[e.exId]);
    if (!mainEntry) return;
    const working = (mainEntry.sets || []).filter(st => !st.warmup && !st.skipped);
    const amrap = working[working.length - 1];
    const reps = amrap ? effReps(amrap) : null;
    if (reps == null) return;
    (perLift[mainEntry.exId] = perLift[mainEntry.exId] || []).push(reps >= min);
  });
  const result = {};
  for (const exId of Object.keys(mainLifts)) {
    const ml = mainLifts[exId];
    const hits = perLift[exId] || [];
    const allHit = hits.length > 0 && hits.every(Boolean);
    const oldTm = ml.tm;
    const newTm = (allHit && oldTm != null) ? round531(oldTm + tmBump531(ml.kind, unit), unit) : oldTm;
    result[exId] = { exId, kind: ml.kind, oldTm, newTm, bumped: !!(allHit && oldTm != null && newTm > oldTm), missed: hits.length > 0 && !allHit };
  }
  return result;
}

// Reset a lift after this many missed cycles in a row (Wendler's stall rule).
const RESET_531_STALL = 2;

// Fold a completed 5/3/1 cycle into program_data. Per lift (from compute531-
// CycleBumps): a hit bumps the TM and clears its stall; a miss increments the
// stall and, once it reaches RESET_531_STALL in a row, resets the TM to 90% of
// the current one (Wendler's reset) and clears the stall; a lift not trained
// this cycle is left untouched. Every automatic change appends a tmHistory
// point (stamped with the just-started cycle), and bumpedCycle is set so the
// prompt fires once. Pure. Returns { programData, bumped, held, reset }, each
// list [{ exId, kind, oldTm, newTm }] for the summary (exId lets the prompt name
// an extra lift after its exercise instead of its 'upper'/'lower' class).
function resolve531CycleEnd(pd, bumps, cycleIdx) {
  const unit = (pd && pd.unit) || 'kg';
  const nextMain = { ...((pd && pd.mainLifts) || {}) };
  const nextHist = { ...((pd && pd.tmHistory) || {}) };
  const bumped = [], held = [], reset = [];
  const cycleNo = cycleIdx + 1; // the cycle the new TM will be used in
  const append = (exId, tm, reason) => { nextHist[exId] = [...(nextHist[exId] || []), { cycle: cycleNo, tm, reason }]; };
  for (const exId of Object.keys(bumps || {})) {
    const b = bumps[exId];
    const ml = nextMain[exId] || {};
    if (b.bumped) {
      nextMain[exId] = { ...ml, tm: b.newTm, stall: 0 };
      append(exId, b.newTm, 'bump');
      bumped.push({ exId, kind: b.kind, oldTm: b.oldTm, newTm: b.newTm });
    } else if (b.missed) {
      const stall = (ml.stall || 0) + 1;
      if (stall >= RESET_531_STALL && b.oldTm != null) {
        const rtm = round531(b.oldTm * 0.9, unit);
        nextMain[exId] = { ...ml, tm: rtm, stall: 0 };
        append(exId, rtm, 'reset');
        reset.push({ exId, kind: b.kind, oldTm: b.oldTm, newTm: rtm });
      } else {
        nextMain[exId] = { ...ml, stall };
        held.push({ exId, kind: b.kind, oldTm: b.oldTm, newTm: b.oldTm });
      }
    }
  }
  return { programData: { ...(pd || {}), mainLifts: nextMain, tmHistory: nextHist, bumpedCycle: cycleIdx }, bumped, held, reset };
}

// From an AMRAP-implied 1RM: the "fair" Training Max (90% of it) and whether
// that sits at least one normal bump above the current TM — i.e. the top set
// says you could carry more than the plan is handing you. { tm, higher }.
function suggest531Tm(est1rm, currentTm, kind, unit) {
  if (!est1rm || est1rm <= 0) return { tm: null, higher: false };
  const fair = tmFrom531(est1rm, unit);
  const higher = fair != null && currentTm != null && fair >= currentTm + tmBump531(kind, unit);
  return { tm: fair, higher };
}

// Whether a mesocycle's RIR taper is active. Default true: only an explicit
// false disables the weekly RIR target watermark and the negative-RIR
// lengthened-partials prescription (the meso then runs on volume + load
// progression + deload alone).
function mesoRirEnabled(sch) {
  return sch?.mesocycle_rir_enabled !== false;
}

// Tongue-in-cheek note for a training-frequency / cycle-length number. Shared by
// the flex "weekly goal" stepper and the wizard's custom cycle-length stepper so
// both ladders stay identical.
function frequencyHint(n) {
  return n >= 50 ? '50 sessions. You win.' :
         n > 30  ? 'At this point the gym should pay you.' :
         n > 20  ? 'Dude. Really?' :
         n > 14  ? '…okay, you\'re serious about this.' :
         n > 10  ? 'Calm down, dude.' :
         n > 7   ? 'Oh, an overachiever. We see you.' :
         n >= 4  ? 'Solid.' :
         n >= 2  ? 'That\'s a start.' :
                   'Better than nothing.';
}

// One-line RIR-taper preview ("Week 1 = 3 RIR · Week N = 0 · then deload"),
// shared by the plan editor's mesocycle section and the wizard's meso step.
function mesoTaperPreview(weeks, startRir = 3, endRir = 0) {
  const peak = endRir < 0 ? `${endRir} RIR (0 RIR + ${-endRir} partial${endRir === -1 ? '' : 's'}/set) 🔥` : `${endRir} RIR`;
  return `Week 1 = ${startRir} RIR · Week ${weeks} = ${peak} · then deload`;
}

function getPlanDaysForDate(schedule, dateStr) {
  const versions = schedule.versions;
  if (!versions?.length) return schedule.days || [];
  for (const v of versions) {
    if (v.validFrom <= dateStr) return v.days || [];
  }
  // Before plan started: extend oldest version backwards so Cycle 0 can be used for migration
  return versions[versions.length - 1]?.days || [];
}

// Returns cumulative 1-indexed cycle number for dateStr across all plan versions.
// When a new version starts it continues the count from where the previous left off
// (cycle number on the last day of the previous version + 1), so cycle numbering
// never resets. Returns 0 for dates before the plan started (pre-plan scroll buffer).
function getCycleNumForDate(schedule, dateStr) {
  const versions = schedule.versions;
  if (!versions?.length) return null;

  const sorted = [...versions].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  if (dateStr < sorted[0].validFrom) return 0;

  let totalPriorCycles = 0;
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i];
    const nextV = sorted[i + 1];
    const daysLen = (v.days || []).length;
    if (!daysLen) continue;
    // A version can start mid-cycle (the "start with day K" version-change
    // option) — cycleOffset shifts the whole days-since-validFrom axis the
    // same way getCyclePosForDate already does, so the cycle count lines up
    // with the actual rotation position instead of always assuming the
    // version began at day 0 of a fresh cycle.
    const offset = v.cycleOffset || 0;

    if (!nextV || dateStr < nextV.validFrom) {
      // dateStr is within this version's period
      const daysDiff = Math.round((new Date(dateStr + 'T12:00:00') - new Date(v.validFrom + 'T12:00:00')) / 86400000);
      return totalPriorCycles + Math.floor(Math.max(0, daysDiff + offset) / daysLen) + 1;
    }
    // Add the cycle number of this version's last day (= the highest cycle it reached)
    const vStart = new Date(v.validFrom + 'T12:00:00');
    const vEnd = new Date(nextV.validFrom + 'T12:00:00');
    const daysInVersion = Math.round((vEnd - vStart) / 86400000);
    totalPriorCycles += Math.floor((daysInVersion - 1 + offset) / daysLen) + 1;
  }
  return totalPriorCycles + 1;
}

// Inverse of getCycleNumForDate: returns the start Date of the 1-indexed cycleNum
// across all plan versions. Returns null for unversioned plans or cycleNum < 1.
function getCycleStartForNum(schedule, cycleNum) {
  if (!schedule?.versions?.length || cycleNum < 1) return null;
  const sorted = [...schedule.versions].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  let totalPriorCycles = 0;
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i];
    const nextV = sorted[i + 1];
    const daysLen = (v.days || []).length;
    if (!daysLen) continue;
    // Mirrors the same cycleOffset shift getCycleNumForDate applies, so the
    // two stay inverses of each other across a version boundary.
    const offset = v.cycleOffset || 0;
    if (nextV) {
      const vStart = new Date(v.validFrom + 'T12:00:00');
      const vEnd = new Date(nextV.validFrom + 'T12:00:00');
      const daysInVersion = Math.round((vEnd - vStart) / 86400000);
      const cyclesInVersion = Math.floor((daysInVersion - 1 + offset) / daysLen) + 1;
      if (totalPriorCycles + cyclesInVersion >= cycleNum) {
        // For a version's first cycle, `offset` can push the computed start
        // before validFrom — but no real date before validFrom is actually
        // governed by this version's cycle numbering (those dates belong to
        // the previous version), so getCycleNumForDate would misattribute
        // that date back to the wrong version and break the inverse
        // relationship. Clamp to validFrom: the earliest real date this
        // cycle can be associated with under this schedule.
        const computed = vStart.getTime() + ((cycleNum - totalPriorCycles - 1) * daysLen - offset) * 86400000;
        return new Date(Math.max(vStart.getTime(), computed));
      }
      totalPriorCycles += cyclesInVersion;
    } else {
      const vStartDate = new Date(v.validFrom + 'T12:00:00');
      const computed = vStartDate.getTime() + ((cycleNum - totalPriorCycles - 1) * daysLen - offset) * 86400000;
      return new Date(Math.max(vStartDate.getTime(), computed));
    }
  }
  return null;
}

function getCyclePosForDate(schedule, dateStr) {
  const versions = schedule.versions;
  if (!versions?.length) return null;
  for (const v of versions) {
    if (v.validFrom <= dateStr) {
      const daysLen = (v.days || []).length;
      if (!daysLen) return 0;
      const daysDiff = Math.round((new Date(dateStr + 'T12:00:00') - new Date(v.validFrom + 'T12:00:00')) / 86400000);
      return (((daysDiff + (v.cycleOffset || 0)) % daysLen) + daysLen) % daysLen;
    }
  }
  // Before plan started: extend oldest version backwards (negative daysDiff wraps correctly)
  const oldest = versions[versions.length - 1];
  const daysLen = (oldest.days || []).length;
  if (!daysLen) return 0;
  const daysDiff = Math.round((new Date(dateStr + 'T12:00:00') - new Date(oldest.validFrom + 'T12:00:00')) / 86400000);
  return (((daysDiff + (oldest.cycleOffset || 0)) % daysLen) + daysLen) % daysLen;
}

// Index in schedule.versions (newest-first) of the version active on dateStr —
// the newest version whose validFrom is on or before dateStr. Returns the oldest
// version's index for dates before the plan started, or -1 if unversioned.
function getActiveVersionIdx(schedule, dateStr) {
  const versions = schedule.versions;
  if (!versions?.length) return -1;
  for (let i = 0; i < versions.length; i++) {
    if (versions[i].validFrom <= dateStr) return i;
  }
  return versions.length - 1;
}

// One version per date: keep only the first entry for each validFrom. Callers
// put the authoritative/newest entry first, so a same-date save replaces the
// previous version for that date instead of stacking a duplicate. Always
// returns newest-first — getActiveVersionIdx's first-match-wins loop assumes
// that order, and not every caller remembered to re-sort after deduping.
function dedupeVersionsByDate(versions) {
  const seen = new Set();
  return (versions || [])
    .filter(v => {
      if (seen.has(v.validFrom)) return false;
      seen.add(v.validFrom);
      return true;
    })
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom));
}

// Cycle position for a date-based (non-versioned, non-flex) plan, derived
// from cycleStartDate — calendar days since start, wrapped to the plan's
// length. Used to be duplicated within this same file (todaysDay/nextDay)
// and reimplemented again in PlanViewerScreen.
function cyclePosFromStartDate(startISO, daysLen, dateISO) {
  const d = new Date((dateISO || todayISO()) + 'T12:00:00');
  const start = parseDate(startISO);
  const n = Math.round((d.getTime() - start.getTime()) / 86400000);
  return ((n % daysLen) + daysLen) % daysLen;
}

// Re-anchor a date-based cycle plan so `todayStr` lands on rotation position
// `targetPos` — built on the SAME calculation as versioning a plan with a
// "start at day K from this date" choice (doSave / doRestoreBackup in
// screens-schedule.jsx): it adds a new plan version effective today whose
// cycleOffset puts today on day `targetPos`. An unversioned plan is converted
// to versioned (its current layout anchored from cycleStartDate) exactly like
// the first versioned edit does.
//
// Why a version boundary instead of just moving cycleStartDate / the active
// version's cycleOffset:
//   • The cycle NUMBER is preserved — it does NOT reset to 1. getCycleNumForDate
//     sums completed cycles across versions, so today continues the count (a
//     fresh cycle at day K), never collapses to Cycle 1. A naive
//     `cycleStartDate = today − targetPos` would drop floor(daysSince/len)+1 to
//     1, which is demotivating.
//   • History stays intact — past dates are still governed by the OLD version,
//     so their day-of-cycle (home strip when scrolling back, per-cycle
//     setsPerMuscle, session labels) doesn't retroactively shift the way
//     rewriting the single anchor would.
//
// Returns a store patch to spread into setStore, or null if the plan isn't a
// date-based cycle plan. Powers the return-from-break realign.
function realignCycleForToday(state, sch, todayStr, targetPos) {
  if (!sch || isFlexPlan(sch) || isWeekdayPlan(sch)) return null;
  const activeDays = getPlanDaysForDate(sch, todayStr);
  const len = (activeDays || []).length;
  if (!len) return null;
  const t = ((targetPos % len) + len) % len;
  const newVer = { validFrom: todayStr, days: activeDays };
  if (t > 0) newVer.cycleOffset = t;
  let versions;
  const existing = sch.versions || [];
  if (existing.length === 0) {
    // First versioned change — anchor the current (unversioned) layout at its
    // start date so cycles before today keep their numbering/positions.
    const anchorDate = state.cycleStartDate || todayStr;
    versions = [newVer, { validFrom: anchorDate, days: sch.days }];
  } else {
    versions = [newVer, ...existing];
  }
  // One version per date (a same-day re-realign replaces, never stacks).
  versions = dedupeVersionsByDate(versions);
  return {
    schedules: (state.schedules || []).map(s =>
      s.id === sch.id ? { ...s, days: versions[0].days, versions } : s),
  };
}

// "Today's array index" in the home cycle strip for a versioned cycle plan.
// With a cycleOffset this differs from the plain plan position (dayIdx), so the
// strip renders the version active on the shown cycle and marks the cell whose
// date == today. The clamp MUST use the day count of the version active on that
// cycle (what the strip renders), NOT sch.days — sch.days holds the NEWEST
// version, which can be a future-scheduled version with a different day count.
// Using sch.days there clipped today's index by the day-count delta and put the
// "today" marker on the wrong (previous) cell after scheduling a shorter future
// version. dateStr is passed in (normally todayISO()) so it stays testable.
function todayCycleStripIndex(sch, dateStr, fallbackIdx) {
  if (!sch?.versions?.length || isWeekdayPlan(sch) || isFlexPlan(sch)) return fallbackIdx;
  const cn = getCycleNumForDate(sch, dateStr);
  if (!cn || cn <= 0) return fallbackIdx;
  const cs = getCycleStartForNum(sch, cn);
  if (!cs) return fallbackIdx;
  cs.setHours(12, 0, 0, 0);
  const csStr = fmtISO(cs);
  const activeV = sch.versions.find(v => v.validFrom <= csStr) || sch.versions[sch.versions.length - 1];
  const vOffset = activeV?.cycleOffset || 0;
  const daysFromCycleStart = Math.round((new Date(dateStr + 'T12:00:00') - cs) / 86400000);
  const cycleLen = activeV?.days?.length || sch.days?.length || 1;
  return Math.max(0, Math.min(daysFromCycleStart + vOffset, cycleLen - 1));
}

function todaysDay(state) {
  const sch = state.schedules.find(s => s.id === state.activeScheduleId);
  if (!sch || !sch.days.length) return null;
  const todayStr = todayISO();
  if (isWeekdayPlan(sch)) {
    const js = new Date().getDay();
    const todayWd = js === 0 ? 6 : js - 1; // 0=Mo … 6=So
    const vDays = getPlanDaysForDate(sch, todayStr);
    const day = vDays.find(d => d.weekday === todayWd);
    if (day) return { schedule: sch, day, idx: todayWd };
    return { schedule: sch, day: { id: 'rest-virtual', name: 'REST', items: [], weekday: todayWd }, idx: todayWd };
  }
  // Flexible plan: position is the action-advanced cycleIndex, not date-derived.
  if (isFlexPlan(sch)) {
    const len = sch.days.length;
    const idx = (((state.cycleIndex || 0) % len) + len) % len;
    return { schedule: sch, day: sch.days[idx], idx };
  }
  // When versions exist, derive today's position from the version active today
  const cyclePosToday = getCyclePosForDate(sch, todayStr);
  if (cyclePosToday !== null) {
    const vDays = getPlanDaysForDate(sch, todayStr);
    return { schedule: sch, day: vDays[cyclePosToday] || sch.days[0], idx: cyclePosToday };
  }
  // Fall back: no versions → use cycleStartDate or cycleIndex
  const idx = state.cycleStartDate
    ? cyclePosFromStartDate(state.cycleStartDate, sch.days.length, todayStr)
    : (state.cycleIndex || 0) % sch.days.length;
  return { schedule: sch, day: sch.days[idx], idx };
}

function nextDay(state) {
  const sch = state.schedules.find(s => s.id === state.activeScheduleId);
  if (!sch || !sch.days.length) return null;
  // Flexible plan: the next day in sequence (cycleIndex + 1), no date math.
  if (isFlexPlan(sch)) {
    const len = sch.days.length;
    const idx = ((((state.cycleIndex || 0) + 1) % len) + len) % len;
    return { schedule: sch, day: sch.days[idx], idx };
  }
  if (sch.versions?.length) {
    const tomorrow = new Date(); tomorrow.setHours(12, 0, 0, 0); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    const pos = getCyclePosForDate(sch, tomorrowStr);
    if (pos !== null) {
      const vDays = getPlanDaysForDate(sch, tomorrowStr);
      return { schedule: sch, day: vDays[pos] || sch.days[0], idx: pos };
    }
  }
  const curIdx = state.cycleStartDate
    ? cyclePosFromStartDate(state.cycleStartDate, sch.days.length, todayISO())
    : (state.cycleIndex || 0) % sch.days.length;
  const idx = (curIdx + 1) % sch.days.length;
  return { schedule: sch, day: sch.days[idx], idx };
}

// Cache-first reload merge for sessions (extracted from app.jsx's loadData so
// the windowing rules stay testable). fresh = server sessions (FULL metadata
// list, but entries only inside the boot window); cur = cached/local sessions;
// baseSessions = sessions of the last state confirmed written to Supabase.
// - Sessions the server no longer has are dropped (deleted on another device),
//   except local-only ones that never reached the server (recent + not in the
//   synced base) and the in-progress session. This works on the session level
//   only — the metadata list is still complete, so "missing on the server" is
//   meaningful.
// - The in-progress session keeps its LOCAL entries/restStart (authoritative).
// - A fresh session without entries (outside the boot window) keeps the cached
//   entries — windowing must never wipe history already on the device.
// When the server returns entries without technique/drops (race: flushSync hasn't
// finished writing sets yet when a background loadFromSupabase runs), preserve the
// richer local values. Matches by position (entry index, set index) — sets have no
// id in the store model. Also preserves in-memory-only cardio fields (isCardio,
// cardioDone, cardioData) that are never stored in the DB.
function mergeEntrySets(serverEntries, cachedEntries) {
  if (!(serverEntries || []).length || !(cachedEntries || []).length) return serverEntries;
  return serverEntries.map((e, ei) => {
    const cachedEntry = cachedEntries[ei];
    if (!cachedEntry) return e;
    return {
      ...e,
      ...(cachedEntry.isCardio != null ? { isCardio: cachedEntry.isCardio } : {}),
      ...(cachedEntry.cardioDone != null ? { cardioDone: cachedEntry.cardioDone } : {}),
      ...(cachedEntry.cardioData !== undefined ? { cardioData: cachedEntry.cardioData } : {}),
      sets: (e.sets || []).map((st, si) => {
        const cached = (cachedEntry.sets || [])[si];
        if (!cached) return st;
        return {
          ...st,
          technique: st.technique ?? cached.technique ?? null,
          drops: st.drops ?? cached.drops ?? null,
        };
      }),
    };
  });
}

// Boot sync diff base: sessions outside the history window come back from the
// server with entries:[] (their sets aren't loaded), while the cache-first merge
// restores their cached entries into the store. Carry the last-synced entries
// (from the persisted base) into the diff base for those windowed sessions so
// the per-set diff sees them unchanged and doesn't re-upload every set with a
// fresh updated_at each boot — which clobbers newer cross-device edits and grows
// write load with account age (audit B1). A genuine offline edit still differs
// from the carried base entries and is pushed as normal. Sessions the base
// doesn't know (first boot / new) keep entries:[] and re-sync once, then heal.
function withCarriedWindowEntries(freshSessions, baseSessions) {
  const baseEntries = new Map((baseSessions || []).filter(s => (s.entries || []).length).map(s => [s.id, s.entries]));
  return (freshSessions || []).map(s =>
    (s.entries || []).length === 0 && baseEntries.has(s.id)
      ? { ...s, entries: baseEntries.get(s.id) }
      : s
  );
}

function mergeSessions(freshSessions, curSessions, inProgressId, baseSessions = null, now = new Date()) {
  const baseIds = baseSessions ? new Set(baseSessions.map(s => s.id)) : null;
  // Sessions deleted locally: once confirmed synced (in base) but no longer in
  // cur. Exclude them from fresh so the merge doesn't resurrect them while the
  // syncStore deletion is still propagating to the server.
  const curIdSet = new Set((curSessions || []).map(s => s.id));
  const locallyDeletedIds = baseIds
    ? new Set([...baseIds].filter(id => !curIdSet.has(id)))
    : null;
  const serverIds = new Set(freshSessions.map(s => s.id));
  // Index cur sessions by id once (O(n)) instead of a linear .find per fresh
  // session below, which made the merge O(fresh x cur) — quadratic in account
  // age (hundreds of thousands of iterations for a multi-year daily user, run
  // synchronously right after `ready` where it janks the first interaction).
  const curById = new Map((curSessions || []).map(s => [s.id, s]));
  const sessions = freshSessions.filter(s => !locallyDeletedIds?.has(s.id)).map(s => {
    const mem = curById.get(s.id);
    if (!mem) return s;
    // The server's `ended` is authoritative: if another device (or the
    // auto-close cron) already finished this session while this device was
    // offline, a stale local inProgressId must never resurrect it as still
    // active — that would overwrite the server's finished entries with the
    // stale local (incomplete) cache and push them right back on next sync.
    const isActive = s.id === inProgressId && s.ended == null;
    const hasServerEntries = (s.entries || []).length > 0;
    const hasCachedEntries = (mem.entries || []).length > 0;
    const keepCachedEntries = !isActive && !hasServerEntries && hasCachedEntries;
    // If both sides have entries, merge at the set level so technique/drops from
    // local (not yet flushed to the server) aren't silently wiped.
    const mergedEntries = !isActive && hasServerEntries && hasCachedEntries
      ? mergeEntrySets(s.entries, mem.entries) : null;
    return {
      ...s,
      currentExIdx: mem.currentExIdx ?? 0,
      cyclePos: mem.cyclePos ?? null,
      // for the active session, local entries/restStart/restDuration are authoritative
      ...(isActive ? { entries: mem.entries, restStart: mem.restStart ?? null, restDuration: mem.restDuration ?? null } : {}),
      ...(keepCachedEntries ? { entries: mem.entries } : {}),
      ...(mergedEntries ? { entries: mergedEntries } : {}),
    };
  });
  // Keep sessions the server hasn't stored yet — i.e. created on this device
  // and never confirmed synced. A session that IS in the synced base but gone
  // from fresh was deleted on another device: keeping it would make this
  // device push it right back (resurrection). Without a base (legacy cache)
  // fall back to the recency rule alone — the safe direction, since dropping
  // a never-synced session would lose data. Only recent ended sessions
  // qualify; the in-progress session is always kept regardless of its date
  // (other ended=null sessions are orphans).
  const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 2);
  const cutoffISO = cutoff.toISOString().slice(0, 10);
  const localOnly = (curSessions || []).filter(x =>
    !serverIds.has(x.id) &&
    (x.id === inProgressId ||
      ((x.date || '') >= cutoffISO && x.ended != null && !baseIds?.has(x.id)))
  );
  const inProgressServerSession = freshSessions.find(s => s.id === inProgressId);
  const activeExists = !!(inProgressId && (
    (serverIds.has(inProgressId) && inProgressServerSession?.ended == null) ||
    localOnly.some(s => s.id === inProgressId)
  ));
  return { sessions: [...localOnly, ...sessions], activeExists };
}

// ─── LOCAL CACHE ─────────────────────────────────────────────────────

// Returns true on success, false if the write failed (most importantly a
// QuotaExceededError once the ~5 MB localStorage budget fills up). Callers
// surface a warning instead of letting the local cache silently stop updating.
function saveToLocal(store, userId) {
  try {
    localStorage.setItem(`logbook-${userId}`, JSON.stringify(store));
    return true;
  } catch (_) { return false; }
}

function loadFromLocal(userId) {
  try {
    const raw = localStorage.getItem(`logbook-${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

// Snapshot of the last state confirmed written to Supabase. Persisted so a
// restart can still tell apart local unsynced edits from pristine server state.
function saveBase(store, userId) {
  try {
    localStorage.setItem(`logbook-base-${userId}`, JSON.stringify(store));
    return true;
  } catch (_) { return false; }
}

function loadBase(userId) {
  try {
    const raw = localStorage.getItem(`logbook-base-${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function clearLocal(userId) {
  try {
    if (userId) {
      localStorage.removeItem(`logbook-${userId}`);
      localStorage.removeItem(`logbook-base-${userId}`);
      return;
    }
    Object.keys(localStorage).filter(k => k.startsWith('logbook-')).forEach(k => localStorage.removeItem(k));
  } catch (_) {}
}

let _realtimeChannel = null;

// Realtime: coaching invites (zane_coaching) and coaching messages
// (zane_coaching_notes). Live workout sync across a user's own devices was
// removed — the local store is the single source of truth for a session, and
// coaches watch a client's live session via polling (get_active_session_detail),
// not this channel.
function subscribeToChanges(userId, onCoachingNote, onCoachingInvite) {
  const mapNote = n => ({
    id: n.id, coachingId: n.coaching_id, authorId: n.author_id,
    type: n.type, entityId: n.entity_id, entityName: n.entity_name,
    threadId: n.thread_id, body: n.body, createdAt: n.created_at,
    attachments: n.attachments || null,
  });
  _realtimeChannel = _supabase
    .channel(`rt-${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'zane_coaching_notes' }, p => {
      if (p.new.author_id !== userId) onCoachingNote?.(mapNote(p.new));
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'zane_coaching', filter: `client_id=eq.${userId}` }, p => {
      onCoachingInvite?.(p.eventType, p.old?.id ?? p.new?.id ?? null, p.new ?? null);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'zane_coaching', filter: `coach_id=eq.${userId}` }, p => {
      onCoachingInvite?.(p.eventType, p.old?.id ?? p.new?.id ?? null, p.new ?? null);
    })
    .subscribe();
  return () => { _supabase.removeChannel(_realtimeChannel); _realtimeChannel = null; };
}

// Whether Smart Progression is active for a given exercise entry/item.
// Precedence: an explicit per-exercise progressionOffset of 0 always wins
// (even for a Range item — you can still turn progression off for e.g.
// lateral raises while keeping the range as a plain display target) >
// a Range ceiling (plannedRepsMax) is on by default > a positive
// progressionOffset override is on > the global smartProgression setting.
// progressionOffset === 0 is a meaningful, distinct value from
// null/undefined — never coerce it away with `||`, only `!= null`/`===` checks.
function progressionEnabled(store, plannedRepsMax, progressionOffset) {
  if (progressionOffset === 0) return false;
  if (plannedRepsMax != null) return true;
  if (progressionOffset != null) return true;
  return !!store.settings?.smartProgression;
}
// True when exId is a registered 5/3/1 main lift on the plan that owns dayId.
// Main lifts progress only through the Wendler Training-Max bump at cycle end,
// so Smart Progression (the "hit +N reps, add weight" flow and its unlocked
// toast) must never fire for them, even when the global setting is on.
// Assistance work on a 5/3/1 day is an ordinary item and still progresses.
function is531MainLift(store, exId, dayId) {
  if (!store || !exId || !dayId) return false;
  const plan = (store.schedules || []).find(s => (s.days || []).some(d => d.id === dayId));
  return !!(plan && is531Plan(plan) && (plan.program_data?.mainLifts || {})[exId]);
}
// The reps ceiling to hit for a given base rep count. Only meaningful when
// progressionEnabled(...) is true for the same inputs.
function progressionCeilingFor(store, base, plannedRepsMax, progressionOffset) {
  if (plannedRepsMax != null) return plannedRepsMax;
  if (progressionOffset != null) return (base ?? 0) + progressionOffset;
  return (base ?? 0) + (store.settings?.progressionRangeTop ?? 4);
}

// Returns { kg, reps } suggestion when all last sets hit top of rep range, null otherwise.
// refOverride: a pre-fetched { entry: { sets } } reference (fetchSeedEntries) —
// used when the exercise's recent history lives outside the boot window.
function progressionSuggestion(store, exId, dayId, plannedReps, plannedRepsPerSet, refOverride, plannedRepsMax, progressionOffset) {
  if (!progressionEnabled(store, plannedRepsMax, progressionOffset)) return null;
  if (is531MainLift(store, exId, dayId)) return null; // 5/3/1 main lifts climb via the Training Max, not Smart Progression
  const ex = findExercise(store, exId);
  const catCfg = ex?.equipment ? (store.settings?.equipmentConfig?.[ex.equipment] ?? {}) : {};
  const increment = catCfg.increment ?? 2.5;
  const maxKg = catCfg.maxKg ?? null;

  // Anchor on the best recent performance at the current weight, not just the
  // last session — so a weak week doesn't block an earned weight jump.
  const ref = refOverride ?? bestRecentEntry(store, exId, dayId);
  if (!ref) return null;

  // Index by true working-set position (warm-ups stripped, nothing else) so
  // plannedRepsPerSet[i] lines up correctly — filtering skipped sets out
  // before indexing (as this used to) shifts every later set's target one
  // slot left/right whenever an earlier set in the reference was skipped.
  const workingSets = (ref.entry.sets || []).filter(s => !s.warmup);
  if (!workingSets.some(s => !s.skipped && s.kg != null)) return null;

  const allHitTop = workingSets.every((s, i) => {
    if (s.skipped || s.kg == null) return true; // no data at this position — neither confirms nor blocks progression
    const perSet = plannedRepsPerSet && plannedRepsPerSet.length > 1
      ? (plannedRepsPerSet[i] ?? plannedRepsPerSet[plannedRepsPerSet.length - 1])
      : null;
    const baseReps = perSet ?? plannedReps;
    // A Range-mode exercise's own repsMax is the ceiling to hit, replacing
    // the global range add-on for that exercise (but only when repsPerSet
    // isn't itself in play — Range and Per Set are mutually exclusive).
    const ceiling = progressionCeilingFor(store, baseReps, perSet ? null : plannedRepsMax, progressionOffset);
    return (effReps(s) ?? 0) >= ceiling;
  });
  if (!allHitTop) return null;

  const refKg = workingSets.find(s => !s.skipped && s.kg != null)?.kg;
  if (refKg == null) return null;
  const newKg = Math.round((refKg + increment) * 100) / 100;
  const cappedKg = maxKg ? Math.min(newKg, maxKg) : newKg;
  if (cappedKg <= refKg) return null;

  const baseRepsFirst = plannedRepsPerSet?.[0] ?? plannedReps;
  return { kg: cappedKg, reps: baseRepsFirst ?? null };
}

// ─── COACHING ────────────────────────────────────────────────────────────────

async function loadClientStore(clientId) {
  return loadFromSupabase(clientId, 0, { coachLoad: true });
}

async function loadCoachClientsStatus() {
  const { data, error } = await _supabase.rpc('get_coach_clients_status');
  if (error) throw error;
  return (data || []).map(r => ({ clientId: r.client_id, inProgressSessionId: r.in_progress_session_id, statusMode: r.status_mode ?? null, statusModeSince: r.status_mode_since ?? null }));
}

async function reloadCoachingState(userId) {
  const [coachInfoRes, coachClientsRes, unreadRes, coachingRowRes, selfRowRes] = await Promise.all([
    _supabase.rpc('get_coach_info'),
    _supabase.rpc('get_coaching_clients'),
    _supabase.from('zane_coaching_notes')
      .select('id, coaching_id, author_id, type, entity_id, entity_name, body, created_at, thread_id')
      .is('read_at', null)
      .neq('author_id', userId),
    _supabase.from('zane_coaching').select('id, checkin_requested_at, checkin_enabled').eq('client_id', userId).eq('status', 'active').neq('coach_id', userId).maybeSingle(),
    _supabase.from('zane_coaching').select('id').eq('coach_id', userId).eq('client_id', userId).eq('status', 'active').maybeSingle(),
  ]);
  return {
    asClient: (coachInfoRes?.data?.[0]) ? {
      id: coachInfoRes.data[0].coaching_id,
      coachId: coachInfoRes.data[0].coach_id,
      coachEmail: coachInfoRes.data[0].coach_email,
      coachName: coachInfoRes.data[0].coach_name,
      status: coachInfoRes.data[0].status,
      checkinRequestedAt: coachingRowRes?.data?.checkin_requested_at ?? null,
      checkinEnabled: coachingRowRes?.data?.checkin_enabled ?? true,
    } : null,
    asCoach: (coachClientsRes?.data || []).map(r => ({
      id: r.coaching_id, clientId: r.client_id, clientEmail: r.client_email,
      clientName: r.client_name, status: r.status, checkinEnabled: r.checkin_enabled ?? true,
    })),
    asSelf: selfRowRes?.data ? { id: selfRowRes.data.id } : null,
    unreadNotes: (unreadRes?.data || []).map(n => ({
      id: n.id, coachingId: n.coaching_id, authorId: n.author_id,
      type: n.type, entityId: n.entity_id, entityName: n.entity_name,
      threadId: n.thread_id, body: n.body, createdAt: n.created_at,
    })),
  };
}

// Be your own coach: create (or re-activate) a self-coaching row. Idempotent.
async function enableSelfCoaching() {
  const { data, error } = await _supabase.rpc('enable_self_coaching');
  if (error) throw error;
  return data; // self-coaching id
}

async function inviteClient(email) {
  const { data, error } = await _supabase.rpc('invite_client', { p_email: email });
  if (error) throw error;
  return data; // coaching id or 'ERROR:...'
}

async function respondToCoachingInvite(coachingId, accept) {
  const { error } = await _supabase.rpc('respond_to_coaching_invite', {
    p_coaching_id: coachingId,
    p_accept: accept,
  });
  if (error) throw error;
}

async function endCoaching(coachingId) {
  const { error } = await _supabase.from('zane_coaching').delete().eq('id', coachingId);
  if (error) throw error;
}

function diffSchedule(before, after, exercises) {
  if (!before || !after) return null;
  const lines = [];
  const exName = (exId) => (exercises || []).find(e => e.id === exId)?.name || exId;
  if (before.name !== after.name) lines.push(`Renamed: ${before.name} → ${after.name}`);
  const beforeDays = before.days || [];
  const afterDays  = after.days  || [];
  const beforeById = Object.fromEntries(beforeDays.map(d => [d.id, d]));
  const afterById  = Object.fromEntries(afterDays.map(d  => [d.id, d]));
  const added   = afterDays.filter(d => !beforeById[d.id]);
  const removed = beforeDays.filter(d => !afterById[d.id]);
  const shared  = afterDays.filter(d =>  beforeById[d.id]);
  if (added.length)   lines.push(`Days added: ${added.map(d => d.name).join(', ')}`);
  if (removed.length) lines.push(`Days removed: ${removed.map(d => d.name).join(', ')}`);
  const renamed = shared.filter(d => beforeById[d.id].name !== d.name).map(d => `${beforeById[d.id].name} → ${d.name}`);
  if (renamed.length) lines.push(`Days renamed: ${renamed.join(', ')}`);
  const fmtSetsReps = (item) => {
    const s = item.plannedSets ?? '?';
    const rps = item.plannedRepsPerSet;
    const r = rps && rps.length > 1 ? `[${rps.join(',')}]` : (item.plannedReps ?? null);
    return r != null ? `${s}×${r}` : `${s} sets`;
  };
  const exAdded = [], exRemoved = [], exChanged = [];
  for (const afterDay of shared) {
    const beforeDay = beforeById[afterDay.id];
    const bItems = beforeDay.items || [];
    const aItems = afterDay.items  || [];
    const bByExId = Object.fromEntries(bItems.filter(i => i.exId).map(i => [i.exId, i]));
    const aByExId = Object.fromEntries(aItems.filter(i => i.exId).map(i => [i.exId, i]));
    aItems.filter(i => i.exId && !bByExId[i.exId]).forEach(i => exAdded.push(`${exName(i.exId)} (${afterDay.name})`));
    bItems.filter(i => i.exId && !aByExId[i.exId]).forEach(i => exRemoved.push(`${exName(i.exId)} (${beforeDay.name})`));
    aItems.filter(i => i.exId && bByExId[i.exId]).forEach(ai => {
      const bi = bByExId[ai.exId];
      const setsChanged = (bi.plannedSets ?? null) !== (ai.plannedSets ?? null);
      const repsChanged = JSON.stringify(bi.plannedRepsPerSet ?? null) !== JSON.stringify(ai.plannedRepsPerSet ?? null)
        || (bi.plannedReps ?? null) !== (ai.plannedReps ?? null);
      if (setsChanged || repsChanged) {
        exChanged.push(`${exName(ai.exId)} (${afterDay.name}): ${fmtSetsReps(bi)} → ${fmtSetsReps(ai)}`);
      }
    });
  }
  if (exAdded.length)   lines.push(`Exercises added: ${exAdded.join(', ')}`);
  if (exRemoved.length) lines.push(`Exercises removed: ${exRemoved.join(', ')}`);
  exChanged.forEach(c => lines.push(c));
  return lines.length > 0 ? lines.join('\n') : null;
}

async function addCoachingNote(coachingId, type, entityId, entityName, body, authorId, threadId = null, attachments = null) {
  const id = 'cnote_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const { error } = await _supabase.from('zane_coaching_notes').insert({
    id, coaching_id: coachingId, author_id: authorId,
    type, entity_id: entityId || null, entity_name: entityName || null, body,
    thread_id: threadId || null,
    ...(attachments && attachments.length ? { attachments } : {}),
  });
  if (error) throw error;
  // Fire-and-forget push to the other party (fails silently if push not enabled).
  // Skip for self-coaching — there's no "other party" to notify. The author is
  // derived server-side from the JWT, so it can't be spoofed.
  if (!coachingId.startsWith('self_')) {
    const preview = body || (attachments && attachments.length ? '📷 Image' : '');
    fnFetch(COACHING_NOTIFY_URL, { coachingId, threadId, preview });
  }
  return id;
}

// Support-ticket notes must never surface in the coaching unread banner —
// they have their own badge/inbox in Settings. Single source of truth so the
// banner's count/preview and the group deciding whether to render it can
// never disagree on which notes count (they did — see git history).
function unreadCoachingNotes(store) {
  return (store.coaching?.unreadNotes || []).filter(n => !n.coachingId?.startsWith('support_'));
}

// Direction: are these unread notes from a client (viewer is the coach) or
// from a coach (viewer is the client)? asCoach's own support_ rows are
// excluded the same way unreadCoachingNotes excludes support notes.
function isNoteFromClient(store, notes) {
  const clientIds = new Set((store.coaching?.asCoach || []).filter(c => !c.id?.startsWith('support_')).map(c => c.clientId));
  return notes.some(n => clientIds.has(n.authorId));
}

// Upload an image to the chat-attachments bucket (own folder per RLS) and return
// its public URL. Shared by support tickets and coaching notes.
async function uploadChatImage(file, userId) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await _supabase.storage.from('chat-attachments').upload(path, file, { contentType: file.type });
  if (error) throw error;
  return _supabase.storage.from('chat-attachments').getPublicUrl(path).data.publicUrl;
}

async function markCoachingNotesRead(noteIds) {
  if (!noteIds.length) return;
  const { error } = await _supabase.from('zane_coaching_notes')
    .update({ read_at: new Date().toISOString() })
    .in('id', noteIds);
  if (error) throw error;
}

async function loadCoachingNotes(coachingId, threadId = null) {
  let q = _supabase.from('zane_coaching_notes')
    .select('*')
    .eq('coaching_id', coachingId);
  if (threadId !== null) q = q.eq('thread_id', threadId);
  else q = q.is('thread_id', null);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(n => ({
    id: n.id, coachingId: n.coaching_id, authorId: n.author_id,
    threadId: n.thread_id,
    type: n.type, entityId: n.entity_id, entityName: n.entity_name,
    body: n.body, createdAt: n.created_at, readAt: n.read_at,
    attachments: n.attachments || null,
  }));
}

async function loadCoachingThreads(coachingId) {
  const { data, error } = await _supabase.from('zane_coaching_threads')
    .select('*')
    .eq('coaching_id', coachingId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(t => ({
    id: t.id, coachingId: t.coaching_id, name: t.name,
    createdBy: t.created_by, createdAt: t.created_at,
  }));
}

async function createCoachingThread(coachingId, name, userId) {
  const id = 'cthr_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const { error } = await _supabase.from('zane_coaching_threads')
    .insert({ id, coaching_id: coachingId, name: name.trim(), created_by: userId });
  if (error) throw error;
  return id;
}

async function getOrCreateCoachingThread(coachingId, name, userId) {
  const { data } = await _supabase.from('zane_coaching_threads')
    .select('id')
    .eq('coaching_id', coachingId)
    .eq('name', name)
    .maybeSingle();
  if (data) return data.id;
  return createCoachingThread(coachingId, name, userId);
}

async function deleteCoachingThread(threadId) {
  await _supabase.from('zane_coaching_notes').delete().eq('thread_id', threadId);
  const { error } = await _supabase.from('zane_coaching_threads').delete().eq('id', threadId);
  if (error) throw error;
}

async function loadCoachingMacros(coachingId) {
  const { data, error } = await _supabase
    .from('zane_coaching_macros')
    .select('*')
    .eq('coaching_id', coachingId)
    .order('set_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(r => ({
    id: r.id, coachingId: r.coaching_id, setBy: r.set_by, setAt: r.set_at,
    caloriesTraining: r.calories_training, proteinTraining: r.protein_training,
    carbsTraining: r.carbs_training, fatTraining: r.fat_training,
    caloriesRest: r.calories_rest, proteinRest: r.protein_rest,
    carbsRest: r.carbs_rest, fatRest: r.fat_rest,
  }));
}

async function addCoachingMacros(coachingId, macros, userId) {
  const { error } = await _supabase.from('zane_coaching_macros').insert({
    id: uid(), coaching_id: coachingId, set_by: userId,
    calories_training: macros.caloriesTraining ?? null,
    protein_training: macros.proteinTraining ?? null,
    carbs_training: macros.carbsTraining ?? null,
    fat_training: macros.fatTraining ?? null,
    calories_rest: macros.caloriesRest ?? null,
    protein_rest: macros.proteinRest ?? null,
    carbs_rest: macros.carbsRest ?? null,
    fat_rest: macros.fatRest ?? null,
  });
  if (error) throw error;
}

async function loadCoachCheckinStatus() {
  const { data, error } = await _supabase.rpc('get_coach_checkin_status');
  if (error) throw error;
  return (data || []).map(r => ({ coachingId: r.coaching_id, checkedInAt: r.checked_in_at ?? null }));
}

async function setCheckinEnabled(coachingId, enabled) {
  const { error } = await _supabase.from('zane_coaching').update({ checkin_enabled: enabled }).eq('id', coachingId);
  if (error) throw new Error(error.message);
}

async function requestCheckin(coachingId, userId) {
  const threadId = await getOrCreateCoachingThread(coachingId, 'Weekly Check-in', userId);
  await addCoachingNote(coachingId, 'general', null, null,
    'Your coach is requesting your weekly check-in. Please fill it in when you get a chance.',
    userId, threadId);
  await _supabase.from('zane_coaching').update({ checkin_requested_at: new Date().toISOString() }).eq('id', coachingId);
}

function checkinWeekStart() {
  const today = new Date();
  // Check-ins cover Mon–Sun. Sunday is the LAST day of its week, not a fresh
  // start — treating it as day 0 (like plain getDay() does) flipped this to
  // the not-yet-finished current week a full day early, before that Sunday's
  // own daily log (macros/steps) even exists. isoWd(today)+1 keeps Sunday
  // counted as day 7 of its own week, so the "due" week only advances once
  // Monday actually arrives.
  const daysSinceSunday = isoWd(today) + 1;
  const lastSunday = new Date(today);
  lastSunday.setDate(today.getDate() - daysSinceSunday);
  const monday = new Date(lastSunday);
  monday.setDate(lastSunday.getDate() - 6);
  return fmtISO(monday);
}

// responses = plain object with snake_case keys matching the form schema fields.
// Writes both the responses jsonb column and backward-compat fixed columns.
async function submitCheckin(coachingId, clientId, responses, userId, weekStartArg = null, isEdit = false, schema = null) {
  const weekStart = weekStartArg || checkinWeekStart();
  const id = 'ci_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const row = {
    id,
    coaching_id: coachingId,
    client_id: clientId,
    week_start: weekStart,
    checked_in_at: new Date().toISOString(),
    responses,
    // Fixed-column backward compat: old SW caches read these columns directly.
    weight_today: responses.weight_today ?? null,
    weight_avg_last_week: responses.weight_avg_last_week ?? null,
    off_plan_notes: responses.off_plan_notes || null,
    hydration_ml: responses.hydration_ml ?? null,
    days_trained: responses.days_trained ?? null,
    steps: responses.steps ?? null,
    cardio_minutes: responses.cardio_minutes ?? null,
    cardio_distance_m: responses.cardio_distance_m ?? null,
    cardio_pace_feeling: responses.cardio_pace_feeling ?? null,
    cardio_effort: responses.cardio_effort ?? null,
    performance_vs_last_week: responses.performance_vs_last_week || null,
    goal_note: responses.goal_note || null,
    hunger: responses.hunger ?? null,
    sleep_quality: responses.sleep_quality ?? null,
    life_stress: responses.life_stress ?? null,
    work_stress: responses.work_stress ?? null,
    tiredness: responses.tiredness ?? null,
    issues_notes: responses.issues_notes || null,
    general_note: responses.general_note || null,
  };
  const { error } = await _supabase.from('zane_checkins').upsert(row, { onConflict: 'coaching_id,week_start' });
  if (error) throw error;
  // Clear check-in request flag so the modal disappears
  _supabase.from('zane_coaching').update({ checkin_requested_at: null }).eq('id', coachingId).eq('client_id', clientId).then(() => {}, () => {});

  // Send note to "Weekly Check-in" thread
  try {
    const d = new Date(weekStart + 'T12:00:00');
    const endDate = new Date(d); endDate.setDate(d.getDate() + 6);
    const fmt = (dt) => dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    const weekLabel = `${isEdit ? '✏️ EDITED · ' : ''}Week of ${fmt(d)} – ${fmt(endDate)}`;
    const lines = [weekLabel, '------------'];
    const wUnit = (typeof window !== 'undefined' && window.__UNIT) || 'kg';
    // Format a stored value for the text note (mirrors the card's display).
    const fmtVal = (f, v) => {
      if (f.unit === 'weight') return `${v} ${wUnit}`;
      if (f._distanceField) return `${(v / 1000).toFixed(1)} km`;
      if (f.key === 'hydration_ml') return `${(v / 1000).toFixed(1)} L/day`;
      if (f.key === 'steps') return Number(v).toLocaleString();
      if (f.type === 'percent') return `${v}%`;
      if (f.type === 'choice') { const o = (f.options || []).find(o => String(o.value) === String(v)); return o ? o.label : String(v); }
      if (f.type === 'stepper') return `${v}/${f.max || 10}`;
      if (f.unit) return `${v} ${f.unit}`;
      return String(v);
    };
    // Build the note from the schema: section headings, real labels, in order —
    // renamed/custom fields read exactly as the coach defined them.
    const seen = new Set();
    (schema || []).forEach(section => {
      const secLines = [];
      (section.fields || []).forEach(f => {
        const v = responses[f.key];
        if (v == null || v === '') return;
        seen.add(f.key);
        secLines.push(`  ${f.label}: ${fmtVal(f, v)}`);
      });
      if (secLines.length) lines.push('', section.label.toUpperCase(), ...secLines);
    });
    // Any submitted keys not covered by the schema (e.g. a removed field) —
    // kept so nothing the client entered is ever silently dropped.
    const leftover = Object.entries(responses).filter(([k, v]) => !seen.has(k) && v != null && v !== '');
    if (leftover.length) lines.push('', 'OTHER', ...leftover.map(([k, v]) => `  ${k.replace(/_/g, ' ')}: ${v}`));
    const threadId = await getOrCreateCoachingThread(coachingId, 'Weekly Check-in', userId);
    await addCoachingNote(coachingId, 'general', null, null, lines.filter((_, i) => !(i === 1 && lines[2] === undefined)).join('\n'), userId, threadId);
  } catch (e) { console.error('Failed to send check-in note', e); }
}

async function loadCheckins(coachingId) {
  const { data, error } = await _supabase
    .from('zane_checkins')
    .select('*')
    .eq('coaching_id', coachingId)
    .order('week_start', { ascending: false });
  if (error) throw error;
  return (data || []).map(r => {
    // Prefer the responses jsonb (written by new code); fall back to fixed columns
    // for rows that predate the migration and weren't backfilled.
    const resp = r.responses || {
      weight_today: r.weight_today, weight_avg_last_week: r.weight_avg_last_week,
      off_plan_notes: r.off_plan_notes, hydration_ml: r.hydration_ml,
      days_trained: r.days_trained, performance_vs_last_week: r.performance_vs_last_week,
      steps: r.steps, cardio_minutes: r.cardio_minutes, cardio_distance_m: r.cardio_distance_m,
      cardio_pace_feeling: r.cardio_pace_feeling, cardio_effort: r.cardio_effort,
      goal_note: r.goal_note, hunger: r.hunger, sleep_quality: r.sleep_quality,
      life_stress: r.life_stress, work_stress: r.work_stress, tiredness: r.tiredness,
      issues_notes: r.issues_notes, general_note: r.general_note,
    };
    return {
      id: r.id, coachingId: r.coaching_id, clientId: r.client_id,
      weekStart: r.week_start, checkedInAt: r.checked_in_at,
      responses: resp,
      // camelCase aliases kept for CheckInCard and exportCheckinCharts
      weightToday: resp.weight_today, weightAvgLastWeek: resp.weight_avg_last_week,
      offPlanDays: resp.off_plan_days, offPlanNotes: resp.off_plan_notes, hydrationMl: resp.hydration_ml,
      daysTrained: resp.days_trained, steps: resp.steps,
      cardioMinutes: resp.cardio_minutes, cardioDistanceM: resp.cardio_distance_m,
      cardioPaceFeeling: resp.cardio_pace_feeling, cardioEffort: resp.cardio_effort,
      performanceVsLastWeek: resp.performance_vs_last_week,
      goalNote: resp.goal_note,
      hunger: resp.hunger, sleepQuality: resp.sleep_quality,
      lifeStress: resp.life_stress, workStress: resp.work_stress, tiredness: resp.tiredness,
      issuesNotes: resp.issues_notes, generalNote: resp.general_note,
    };
  });
}

async function loadCheckinSchema(coachingId) {
  const { data } = await _supabase.from('zane_coaching')
    .select('checkin_schema').eq('id', coachingId).maybeSingle();
  return data?.checkin_schema || null; // null → caller uses CHECKIN_DEFAULT_SCHEMA
}

async function saveCheckinSchema(coachingId, schema) {
  const { error } = await _supabase.from('zane_coaching')
    .update({ checkin_schema: schema }).eq('id', coachingId);
  if (error) throw error;
}

async function saveDefaultCheckinSchema(schema, coachId) {
  const { error: e1 } = await _supabase.from('zane_user_settings')
    .upsert({ user_id: coachId, default_checkin_schema: schema }, { onConflict: 'user_id' });
  if (e1) throw e1;
  // Write the new default onto every coaching row too. Clients can't read the
  // coach's zane_user_settings (RLS), so if we nulled the override here they'd
  // fall back to CHECKIN_DEFAULT_SCHEMA and fill a different form than the coach
  // reviews. Storing the schema on the coaching row (which the client can read)
  // keeps both sides on the same form.
  const { error: e2 } = await _supabase.from('zane_coaching')
    .update({ checkin_schema: schema })
    .eq('coach_id', coachId)
    .neq('client_id', coachId);
  if (e2) throw e2;
}

async function deleteCheckin(checkinId, userId) {
  const { error } = await _supabase
    .from('zane_checkins')
    .delete()
    .eq('id', checkinId)
    .eq('client_id', userId);
  if (error) throw error;
}

// ─── Cardio distance/pace — single source for the whole app ─────────────────
// Every screen that touches cardio distance used to reimplement this from
// scratch (comma-decimal parsing, the km/mi factor, display precision), and
// they'd already drifted: some skipped the comma-normalization (silently
// truncating "5,5" km input to 5 km) and one rounded to a different decimal
// count than the rest. One source of truth for all of it.
const CARDIO_DIST_UNIT_KEY = 'logbook-cardio-dist-unit'; // 'km' | 'mi'
const MI_TO_M = 1609.344;

function cardioDistUnit() {
  try { return localStorage.getItem(CARDIO_DIST_UNIT_KEY) || 'km'; } catch (_) { return 'km'; }
}
function setCardioDistUnit(u) {
  try { localStorage.setItem(CARDIO_DIST_UNIT_KEY, u); } catch (_) {}
}
// Parses a user-typed distance (comma or dot decimal) in the given display
// unit into meters.
function distToM(val, unit) {
  const n = parseFloat(String(val).replace(',', '.'));
  if (isNaN(n)) return null;
  return unit === 'mi' ? Math.round(n * MI_TO_M) : Math.round(n * 1000);
}
// Bare number string (no unit suffix) — for UIs that show the unit separately.
function mToDisplay(meters, unit, decimals = 2) {
  if (meters == null) return '';
  return unit === 'mi' ? (meters / MI_TO_M).toFixed(decimals) : (meters / 1000).toFixed(decimals);
}
// Full "5.50 km" / "3.42 mi" string, unit suffix included.
function fmtDistance(meters, unit, decimals = 2) {
  if (meters == null) return '';
  return `${mToDisplay(meters, unit, decimals)} ${unit === 'mi' ? 'mi' : 'km'}`;
}
function fmtPace(secPerKm, unit) {
  if (secPerKm == null) return '';
  const perUnit = unit === 'mi' ? secPerKm * MI_TO_M / 1000 : secPerKm;
  const mins = Math.floor(perUnit / 60);
  const secs = Math.round(perUnit % 60);
  return `${mins}:${String(secs).padStart(2, '0')}/${unit}`;
}
function fmtSpeed(secPerKm, unit) {
  if (secPerKm == null || secPerKm <= 0) return '';
  const kmh = 3600 / secPerKm;
  if (unit === 'mi') return `${(kmh / (MI_TO_M / 1000)).toFixed(1)} mph`;
  return `${kmh.toFixed(1)} km/h`;
}

// Recently-used cardio activity type strings (for the "e.g. Running,
// Cycling…" suggestion chips), most-recently-used first, deduped, capped.
function recentCardioTypes(cardioLogs, limit = 6) {
  const seen = new Set();
  const result = [];
  for (const l of (cardioLogs || [])) {
    if (l.type && !seen.has(l.type)) { seen.add(l.type); result.push(l.type); }
    if (result.length >= limit) break;
  }
  return result;
}

// Aggregate cardio logs for a given week (weekStart = 'YYYY-MM-DD' Monday).
// Returns { cardioMinutes, cardioDistanceM, paceFeeling, effort, count } or null.
function cardioWeekPrefill(cardioLogs, weekStart) {
  if (!cardioLogs?.length || !weekStart) return null;
  const ws = weekStart.slice(0, 10);
  const we = (() => { const d = new Date(ws + 'T12:00:00'); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();
  const logs = cardioLogs.filter(l => l.date >= ws && l.date < we);
  if (!logs.length) return null;
  const totalMin = logs.reduce((s, l) => s + (l.durationMinutes || 0), 0);
  const hasDistArr = logs.filter(l => l.distanceM != null);
  const totalDistM = hasDistArr.length ? Math.round(hasDistArr.reduce((s, l) => s + l.distanceM, 0)) : null;
  const pfVals = logs.filter(l => l.paceFeeling != null).map(l => l.paceFeeling);
  const efVals = logs.filter(l => l.effort != null).map(l => l.effort);
  const withDist = logs.filter(l => l.distanceM > 0 && l.durationMinutes > 0);
  let pace = null;
  if (withDist.length) {
    const pMin = withDist.reduce((s, l) => s + l.durationMinutes, 0);
    // The actual cardio distance-unit setting — NOT settings.unit (weight),
    // which this used to be keyed off, silently treating "mixed"-unit users
    // (kg weights + mi distances) as km and skewing their pace by ~1.6x.
    const distUnit = cardioDistUnit() === 'mi' ? MI_TO_M : 1000;
    const dist = withDist.reduce((s, l) => s + l.distanceM, 0) / distUnit;
    const paceMinPer = pMin / dist;
    const m = Math.floor(paceMinPer);
    const sec = Math.round((paceMinPer - m) * 60);
    pace = `${m}:${String(sec).padStart(2, '0')}`;
  }
  return {
    cardioMinutes: totalMin || null,
    cardioDistanceM: totalDistM,
    paceFeeling: pfVals.length ? Math.round(pfVals.reduce((s, v) => s + v, 0) / pfVals.length) : null,
    effort: efVals.length ? Math.round(efVals.reduce((s, v) => s + v, 0) / efVals.length) : null,
    pace,
    count: logs.length,
  };
}

// Cardio PR detection. Compares a freshly saved log against the user's prior
// logs OF THE SAME ACTIVITY TYPE and reports, per metric, whether it's an
// all-time best or an improvement over the most recent prior log. Mirrors the
// strength NEW BEST / IMPROVEMENT tiers. Returns null when nothing was beaten
// (incl. the first-ever log of a type — no baseline to beat).
//   metrics: pace (min/km, lower better; needs distance+duration),
//            distance (higher better; needs distance), duration (higher better)
function detectCardioPRs(log, allLogs) {
  if (!log) return null;
  const norm = t => (t || '').trim().toLowerCase();
  const ty = norm(log.type);
  const prior = (allLogs || []).filter(l => l.id !== log.id && norm(l.type) === ty);
  if (!prior.length) return null;

  // Most-recent prior log (by date, then createdAt) — the "last time" baseline.
  const last = [...prior].sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')) ||
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];

  const paceOf = l => (l.distanceM > 0 && l.durationMinutes > 0) ? l.durationMinutes / (l.distanceM / 1000) : null;
  const round = (key, v) => v == null ? null : (key === 'pace' ? Math.round(v * 100) / 100 : v);
  const defs = [
    { key: 'pace',     dir: -1, val: paceOf },
    { key: 'distance', dir: +1, val: l => (l.distanceM > 0 ? l.distanceM : null) },
    { key: 'duration', dir: +1, val: l => (l.durationMinutes > 0 ? l.durationMinutes : null) },
  ];

  const items = [];
  for (const m of defs) {
    const cur = round(m.key, m.val(log));
    if (cur == null) continue;
    const priorVals = prior.map(l => round(m.key, m.val(l))).filter(v => v != null);
    if (!priorVals.length) continue; // nothing of this metric to beat yet
    const beats = (a, b) => m.dir > 0 ? a > b : a < b;
    const best = m.dir > 0 ? Math.max(...priorVals) : Math.min(...priorVals);
    const lastVal = round(m.key, m.val(last));
    if (beats(cur, best)) items.push({ metric: m.key, tier: 'best', value: cur, prev: best });
    else if (lastVal != null && beats(cur, lastVal)) items.push({ metric: m.key, tier: 'improvement', value: cur, prev: lastVal });
  }
  if (!items.length) return null;
  return { tier: items.some(i => i.tier === 'best') ? 'best' : 'improvement', type: log.type || null, items };
}

// ─── DAILY HEALTH LOGS ─────────────────────────────────────────────────────

// A day counts as a TRAINING day for macro purposes only if a session was
// actually logged (ended) on that date — a planned-but-skipped day is a rest
// day ("you have to earn your macros"). Pass store.sessions.
function isLoggedTrainingDay(sessions, dateISO) {
  const d = (dateISO || '').slice(0, 10);
  return (sessions || []).some(s => s.ended && (s.date || '').slice(0, 10) === d);
}

// Returns the PLANNED training day object for a date (or null for a planned rest
// day / no plan), mirroring the home-screen retroactive-logging logic for both
// weekday plans and cycle plans (with versioning). A "training day" here means
// the plan slot for that date has at least one exercise.
function plannedTrainingDay(state, dateStr) {
  const ds = (dateStr || '').slice(0, 10);
  const sch = state?.schedules?.find(s => s.id === state.activeScheduleId);
  if (!sch || !sch.days?.length) return null;
  if (isWeekdayPlan(sch)) {
    if (state.weekPlanStartDate && ds < state.weekPlanStartDate) return null;
    const dd = new Date(ds + 'T12:00:00');
    const wd = isoWd(dd);
    const vDays = getPlanDaysForDate(sch, ds);
    return vDays.find(d => d.weekday === wd && d.items?.length > 0) || null;
  }
  if (isFlexPlan(sch)) {
    // Flex plans have no calendar mapping — position only advances by action
    // (cycleIndex, mirroring todaysDay), so there's no planned day for any
    // date other than today.
    if (ds !== todayISO()) return null;
    const len = sch.days.length;
    const idx = ((state.cycleIndex || 0) % len + len) % len;
    const dayData = sch.days[idx];
    return (dayData?.items?.length > 0) ? dayData : null;
  }
  if (state.cycleStartDate) {
    const vDays = getPlanDaysForDate(sch, ds);
    if (!vDays.length) return null;
    const cyclePos = getCyclePosForDate(sch, ds);
    let idx;
    if (cyclePos !== null) idx = cyclePos;
    else {
      const start = parseDate(state.cycleStartDate);
      const n = Math.round((new Date(ds + 'T12:00:00').getTime() - start.getTime()) / 86400000);
      if (n < 0) return null;
      idx = ((n % vDays.length) + vDays.length) % vDays.length;
    }
    const dayData = vDays[idx];
    return (dayData?.items?.length > 0) ? dayData : null;
  }
  return null;
}

// A flexible plan has no programmed rest days, so it defaults to REST ("earn
// it") and only counts as training when the user proactively set it. That choice
// is persisted on the day's daily-log targetsSnap.dayType and read back here.
// Returns 'training' | 'rest' | null (not a flex plan / no explicit override).
function flexDayTypeOverride(state, dateStr) {
  const sch = state?.schedules?.find(s => s.id === state.activeScheduleId);
  if (!isFlexPlan(sch)) return null;
  const ds = (dateStr || '').slice(0, 10);
  const dt = (state.dailyLogs || []).find(l => l.date === ds)?.targetsSnap?.dayType;
  return dt === 'training' || dt === 'rest' ? dt : null;
}

// Whether a date counts as a training day for health indicators. A logged
// (performed) session always counts. FLEX plans have no programmed rest days, so
// they default to REST and only count as training when a session is logged or
// the user proactively set training (persisted override). CYCLE/WEEKDAY plans
// keep assuming the plan is followed: a planned training day counts while it's
// still today or in the future (a past planned day skipped without a session is
// reconciled to rest by the daily-log heal, "you have to earn it").
function isTrainingDayForDate(state, dateStr) {
  const ds = (dateStr || '').slice(0, 10);
  if (isLoggedTrainingDay(state?.sessions, ds)) return true;
  const sch = state?.schedules?.find(s => s.id === state.activeScheduleId);
  if (isFlexPlan(sch)) return flexDayTypeOverride(state, ds) === 'training';
  if (ds >= todayISO() && plannedTrainingDay(state, ds)) return true;
  return false;
}

// Pick the {protein, carbs, fat, calories} target for a given day type out of a
// macro-target object (works for both coaching macros and the user's personal
// macroTargets — same field names). Returns null when no macro is set for that
// day type.
function dayTargetFromMacros(m, isTraining) {
  if (!m) return null;
  const protein  = isTraining ? m.proteinTraining  : m.proteinRest;
  const carbs    = isTraining ? m.carbsTraining    : m.carbsRest;
  const fat      = isTraining ? m.fatTraining      : m.fatRest;
  const calories = isTraining ? m.caloriesTraining : m.caloriesRest;
  if (protein == null && carbs == null && fat == null) return null;
  return { protein: protein ?? null, carbs: carbs ?? null, fat: fat ?? null, calories: calories ?? null };
}

// Macro adherence as a 0–100 %, defined as the calorie-weighted average of
// per-macro closeness scores. Per macro: clamp(1 − |actual − target| / target,
// 0, 1). Each macro's weight = its caloric share of the target day (protein/
// carbs × 4 kcal/g, fat × 9 kcal/g) — so a small fat target counts less than
// a large carb target, proportionally to its caloric significance.
// Returns null unless all three macros AND their targets are present.
function macroAdherence(actual, target) {
  if (!actual || !target) return null;
  const kcalPer = { protein: 4, carbs: 4, fat: 9 };
  const entries = [];
  for (const k of ['protein', 'carbs', 'fat']) {
    const t = target[k]; const a = actual[k];
    if (t == null || t <= 0 || a == null) return null;
    entries.push({ score: Math.max(0, 1 - Math.abs(a - t) / t), kcal: t * kcalPer[k] });
  }
  const totalKcal = entries.reduce((s, e) => s + e.kcal, 0);
  if (totalKcal <= 0) return null;
  const weighted = entries.reduce((s, e) => s + e.score * (e.kcal / totalKcal), 0);
  return Math.round(weighted * 100);
}

// Effective macro targets for the user's OWN health screen: their personal
// targets if set, otherwise the coach-assigned macros (so a coached user gets
// adherence out of the box; a standalone user sets their own). Both share the
// {proteinTraining, carbsTraining, …} shape.
function effectiveMacroTargets(personal, coachingMacros) {
  const has = m => m && (m.proteinTraining != null || m.carbsTraining != null || m.fatTraining != null ||
    m.proteinRest != null || m.carbsRest != null || m.fatRest != null);
  if (has(personal)) return personal;
  if (has(coachingMacros)) return coachingMacros;
  return null;
}

// Compute the persisted adherence + target snapshot for a daily log at save
// time, so a later target change never rewrites history. Returns
// { adherence, targetsSnap } — both null when targets/macros are incomplete.
function dailyLogAdherence(log, targets, isTraining) {
  const dayTarget = dayTargetFromMacros(targets, isTraining);
  if (!dayTarget) return { adherence: null, targetsSnap: null };
  const adherence = macroAdherence(
    { protein: log.protein, carbs: log.carbs, fat: log.fat }, dayTarget);
  if (adherence == null) return { adherence: null, targetsSnap: null };
  return { adherence, targetsSnap: { ...dayTarget, dayType: isTraining ? 'training' : 'rest' } };
}

// Aggregate a week of daily logs into check-in prefill values, keyed by the
// check-in form field keys. weekStart = Monday ('YYYY-MM-DD'); the window is
// [weekStart, weekStart+7). weight_avg_last_week comes from the prior week.
// Returns null when there is nothing to prefill.
function dailyLogsWeekPrefill(dailyLogs, weekStart, sessions, schema) {
  if (!dailyLogs?.length || !weekStart) return null;
  const ws = weekStart.slice(0, 10);
  const shift = (base, days) => { const d = new Date(base + 'T12:00:00'); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
  const we = shift(ws, 7);
  const prevWs = shift(ws, -7);
  const inRange = (lo, hi) => dailyLogs.filter(l => l.date >= lo && l.date < hi);
  const week = inRange(ws, we);
  const prevWeek = inRange(prevWs, ws);
  if (!week.length && !prevWeek.length) return null;
  const avg = (arr, key) => { const vs = arr.map(l => l[key]).filter(v => v != null); return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null; };
  const r1 = v => Math.round(v * 10) / 10;
  const out = {};
  const todayStr = todayISO();
  const todayLogEntry = dailyLogs.find(l => l.date === todayStr);
  if (todayLogEntry?.weight != null) out.weight_today = r1(todayLogEntry.weight);
  const weekW = avg(week, 'weight'); if (weekW != null) out.weight_avg_last_week = r1(weekW);
  const stepsLogs = week.filter(l => l.steps != null);
  if (stepsLogs.length) out.steps = stepsLogs.reduce((s, l) => s + l.steps, 0);
  const cal = avg(week, 'calories'); if (cal != null) out.calories_avg = Math.round(cal);
  const p = avg(week, 'protein'); if (p != null) out.protein_avg = Math.round(p);
  const c = avg(week, 'carbs'); if (c != null) out.carbs_avg = Math.round(c);
  const f = avg(week, 'fat'); if (f != null) out.fat_avg = Math.round(f);
  const hyd = avg(week, 'waterMl'); if (hyd != null) out.hydration_ml = Math.round(hyd);
  const adh = avg(week, 'adherence'); if (adh != null) out.macro_adherence = Math.round(adh);
  if (sessions != null) {
    const dayOf = s => s.date ? (typeof s.date === 'string' ? s.date.slice(0, 10) : new Date(s.date).toISOString().slice(0, 10)) : null;
    const thisEnded = sessions.filter(s => s.ended).filter(s => { const d = dayOf(s); return d && d >= ws && d < we; });
    if (thisEnded.length) out.days_trained = thisEnded.length;
  }
  const offPlanLines = week
    .filter(l => l.offPlanNote && l.offPlanNote.trim())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(l => {
      const [y, m, d] = l.date.split('-');
      return `${d}.${m}.${y} - ${l.offPlanNote.trim()}`;
    });
  if (offPlanLines.length) out.off_plan_notes = offPlanLines.join('\n');
  if (schema) {
    const numericTypes = new Set(['integer', 'decimal', 'stepper']);
    schema.flatMap(s => s.fields || [])
      .filter(f => f.show_in_health_log && numericTypes.has(f.type))
      .forEach(f => {
        const vals = week.map(l => l.coachFields?.[f.key]).filter(v => v != null && !isNaN(Number(v))).map(Number);
        if (!vals.length) return;
        const total = vals.reduce((s, v) => s + v, 0);
        const agg = f.health_log_agg === 'sum' ? total : total / vals.length;
        out[f.key] = f.type === 'decimal' ? r1(agg) : Math.round(agg);
      });
  }
  return Object.keys(out).length ? { ...out, count: week.length } : null;
}

// Aggregate improvement vs decline chips across all sessions in `weekStart` week.
// For each working set, compares against the most recent pre-week session for
// the same exercise (same dayId preferred, any dayId as fallback). Returns
// 'improved' | 'worse' | 'same' | null (null when no comparable sets found).
function weekPerformanceSignal(state, weekStart) {
  if (!weekStart || !state?.sessions?.length) return null;
  const ws = weekStart.slice(0, 10);
  const we = (() => { const d = new Date(ws + 'T12:00:00'); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();
  const dayOf = s => s.date ? (typeof s.date === 'string' ? s.date.slice(0, 10) : new Date(s.date).toISOString().slice(0, 10)) : null;

  const weekSessions = state.sessions.filter(s => s.ended).filter(s => { const d = dayOf(s); return d && d >= ws && d < we; });
  if (!weekSessions.length) return null;

  const preSessions = state.sessions
    .filter(s => s.ended)
    .filter(s => { const d = dayOf(s); return d && d < ws; })
    .slice()
    .sort((a, b) => (b.ended || '').localeCompare(a.ended || ''));

  let improvements = 0, declines = 0;

  for (const session of weekSessions) {
    for (const entry of (session.entries || [])) {
      const exId = entry.exId; if (!exId) continue;
      // Prefer same dayId, fall back to any day
      let prevEntry = null;
      for (const pass of [true, false]) {
        for (const ps of preSessions) {
          if (pass && session.dayId && ps.dayId !== session.dayId) continue;
          const pe = (ps.entries || []).find(e => e.exId === exId && (e.sets || []).some(x => x.kg != null || x.reps != null));
          if (pe) { prevEntry = pe; break; }
        }
        if (prevEntry) break;
      }
      if (!prevEntry) continue;
      const working = (entry.sets || []).filter(s => !s.warmup && !s.skipped && s.done);
      const prevWorking = (prevEntry.sets || []).filter(s => !s.warmup && !s.skipped);
      working.forEach((set, i) => {
        const prev = prevWorking[i]; if (!prev) return;
        if (isImprovement(set, prev)) improvements++;
        else if (isDecline(set, prev)) declines++;
      });
    }
  }

  if (improvements === 0 && declines === 0) return null;
  if (improvements > declines) return 'improved';
  if (declines > improvements) return 'worse';
  return 'same';
}

async function openStatusPeriod(userId, mode, startedAt) {
  await unwrap(_supabase.from('zane_status_periods').update({ ended_at: new Date().toISOString() }).eq('user_id', userId).is('ended_at', null));
  await unwrap(_supabase.from('zane_status_periods').insert({ id: uid(), user_id: userId, mode, started_at: startedAt }));
}

async function closeStatusPeriod(userId, endedAt = null) {
  await unwrap(_supabase.from('zane_status_periods').update({ ended_at: endedAt || new Date().toISOString() }).eq('user_id', userId).is('ended_at', null));
}

async function updateStatusPeriodStart(userId, startedAt) {
  await unwrap(_supabase.from('zane_status_periods').update({ started_at: startedAt }).eq('user_id', userId).is('ended_at', null));
}

// End the active sick/vacation status. Last status day = yesterday, so a session
// logged today already counts as a normal training day. Mutates via setStore and
// writes through to zane_status_periods. Shared by the home toggle and the
// post-session "feeling better?" prompt.
async function clearStatusMode(userId, store, setStore) {
  if (!(store?.statusMode ?? null)) return;
  const d = new Date(todayISO() + 'T12:00:00'); d.setDate(d.getDate() - 1);
  const closedAt = d.toISOString();
  const openPeriod = (store.statusPeriods || []).find(p => !p.endedAt);
  // If the period started today, closedAt (yesterday) < startedAt → delete it
  // instead of writing an invalid record.
  const shouldDelete = !!openPeriod && closedAt < openPeriod.startedAt;
  setStore(s => ({
    ...s, statusMode: null, statusModeSince: null,
    statusPeriods: shouldDelete
      ? (s.statusPeriods || []).filter(p => !!p.endedAt)
      : (s.statusPeriods || []).map(p => !p.endedAt ? { ...p, endedAt: closedAt } : p),
  }));
  try {
    if (shouldDelete) await unwrap(_supabase.from('zane_status_periods').delete().eq('user_id', userId).is('ended_at', null));
    else await closeStatusPeriod(userId, closedAt);
  } catch (e) { console.error('clearStatusMode: status period write failed', e); }
}

// ─── DELOAD ─────────────────────────────────────────────────────────────────

// Planned deload length for the active plan: one cycle (date-based), one week
// (weekday), or — for flex — null (the deload ends by session count, not days).
function deloadPlanDays(store) {
  const sch = (store.schedules || []).find(s => s.id === store.activeScheduleId);
  if (!sch) return 7;
  if (isFlexPlan(sch)) return null;
  if (isWeekdayPlan(sch)) return 7;
  return (sch.days || []).length || 7;
}

// Flex deload target: the weekly session goal, or the count of training days.
function deloadFlexGoal(sch) {
  return sch?.sessions_per_week || (sch?.days || []).filter(d => (d.items || []).length).length || 3;
}

// True once the active deload has run its course (one cycle / week elapsed, or —
// for flex — the weekly session goal of deload sessions has been logged). Shared
// by the Plan-tab button (remaining display) and the app.jsx auto-end check.
function deloadElapsed(store, now = new Date()) {
  if (store.statusMode !== 'deload' || !store.statusModeSince) return false;
  const sch = (store.schedules || []).find(s => s.id === store.activeScheduleId);
  const since = new Date(store.statusModeSince);
  if (sch && isFlexPlan(sch)) {
    const done = (store.sessions || []).filter(s => s.ended && s.isDeload && new Date(s.ended) >= since).length;
    return done >= deloadFlexGoal(sch);
  }
  const days = deloadPlanDays(store) || 7;
  const elapsed = Math.floor((now - since) / 86400000);
  return elapsed >= days;
}

// Days remaining in the current deload (null for flex — counts sessions, not days).
function deloadDaysRemaining(store, now = new Date()) {
  if (store.statusMode !== 'deload' || !store.statusModeSince) return null;
  const sch = (store.schedules || []).find(s => s.id === store.activeScheduleId);
  if (sch && isFlexPlan(sch)) return null;
  const days = deloadPlanDays(store) || 7;
  // Clamp to 0 so a future statusModeSince (nudge-aligned to next cycle start)
  // shows the full duration rather than a negative elapsed.
  const elapsed = Math.max(0, Math.floor((now - new Date(store.statusModeSince)) / 86400000));
  return Math.max(0, days - elapsed);
}

// Start a deload: switch status mode to 'deload' and open a status period.
// Mirrors the optimistic setStore + write pattern of the home status toggle.
// sinceISO: optional ISO string to use as statusModeSince instead of now — used
// by the nudge to align the deload window to the start of the next cycle so it
// covers exactly one full cycle of training (not a partial one starting mid-cycle).
async function startDeload(userId, store, setStore, sinceISO = null) {
  const startedAt = sinceISO || new Date().toISOString();
  const coachingId = store.coaching?.asClient?.id || store.coaching?.asSelf?.id || null;
  setStore(s => ({
    ...s, statusMode: 'deload', statusModeSince: startedAt,
    statusPeriods: [{ id: '_pending', mode: 'deload', startedAt, endedAt: null },
      ...(s.statusPeriods || []).map(p => p.endedAt ? p : { ...p, endedAt: startedAt })],
  }));
  try { await openStatusPeriod(userId, 'deload', startedAt); }
  catch (e) { console.error('startDeload: status period write failed', e); }
  if (coachingId) {
    try {
      const threadId = await getOrCreateCoachingThread(coachingId, 'Status Updates', userId);
      await addCoachingNote(coachingId, 'general', null, null, 'Status: Deload week — training light to recover.', userId, threadId);
    } catch (_) {}
  }
}

// End a deload: close the status period at `now` so today onward is normal again.
async function endDeload(userId, store, setStore) {
  if (store.statusMode !== 'deload') return;
  const endedAt = new Date().toISOString();
  const coachingId = store.coaching?.asClient?.id || store.coaching?.asSelf?.id || null;
  setStore(s => ({
    ...s, statusMode: null, statusModeSince: null,
    statusPeriods: (s.statusPeriods || []).map(p => !p.endedAt ? { ...p, endedAt: endedAt } : p),
  }));
  try { await closeStatusPeriod(userId, endedAt); }
  catch (e) { console.error('endDeload: status period write failed', e); }
  if (coachingId) {
    try {
      const threadId = await getOrCreateCoachingThread(coachingId, 'Status Updates', userId);
      await addCoachingNote(coachingId, 'general', null, null, 'Status: Deload finished — back to normal training.', userId, threadId);
    } catch (_) {}
  }
}

async function refreshHealthLogs(userId) {
  const [dailyRes, cardioRes, glucoseRes] = await Promise.all([
    _supabase.from('zane_daily_logs').select('id, date, weight, steps, calories, protein, carbs, fat, fiber, water_ml, note, off_plan_note, adherence, targets_snap, daily_coach_fields, updated_at, created_at').eq('user_id', userId).order('date', { ascending: false }),
    _supabase.from('zane_cardio_logs').select('id, date, type, duration_minutes, distance_m, pace_feeling, effort, note, session_id, created_at').eq('user_id', userId).order('date', { ascending: false }),
    _supabase.from('zane_glucose_logs').select('id, date, time, value_mmol, context, note, created_at').eq('user_id', userId).order('date', { ascending: false }).order('time', { ascending: false }),
  ]);
  if (dailyRes.error || cardioRes.error) return null;
  return {
    dailyLogs: (dailyRes.data || []).map(l => ({
      id: l.id, date: l.date,
      weight: l.weight ?? null, steps: l.steps ?? null,
      calories: l.calories ?? null, protein: l.protein ?? null,
      carbs: l.carbs ?? null, fat: l.fat ?? null, fiber: l.fiber ?? null,
      waterMl: l.water_ml ?? null, note: l.note ?? null,
      offPlanNote: l.off_plan_note ?? null,
      adherence: l.adherence ?? null, targetsSnap: l.targets_snap ?? null,
      coachFields: l.daily_coach_fields ?? null,
      updatedAt: l.updated_at ?? null,
      createdAt: l.created_at,
    })),
    cardioLogs: (cardioRes.data || []).map(l => ({
      id: l.id, date: l.date, type: l.type ?? null,
      durationMinutes: l.duration_minutes, distanceM: l.distance_m ?? null,
      paceFeeling: l.pace_feeling ?? null, effort: l.effort ?? null,
      note: l.note ?? null, sessionId: l.session_id ?? null, createdAt: l.created_at,
    })),
    glucoseLogs: (glucoseRes?.data || []).map(l => ({
      id: l.id, date: l.date, time: l.time,
      valueMmol: l.value_mmol != null ? parseFloat(l.value_mmol) : null,
      context: l.context ?? 'other', note: l.note ?? null, createdAt: l.created_at,
    })),
  };
}

// Must match applyMesoSetDeltaFromState's base+4 clamp (screens-train.jsx) —
// an exercise at or past this many accumulated "not enough" sets can't
// usefully receive another growth grant, since applying it would be entirely
// swallowed by that clamp.
const MESO_GROWTH_CEILING_DELTA = 4;

// Picks which exId_dayId key (if any) wins a "not_enough" volume-feedback
// growth turn for a muscle group's exercises this session, and returns the
// growthCounts map updated to reflect that decision. Pure and side-effect
// free — call it fresh (with the latest deltas/growthCounts) both to decide
// the recipient and, separately, inside the actual saveMesoState write, so a
// rare double-invocation of the caller can never silently lose a grant by
// writing a value computed from stale state.
//
// - keys: exId_dayId keys of the muscle group's exercises this session, in
//   day order (keys[0] = the muscle group's main/first lift).
// - deltas / growthCounts: the meso state's full current maps (not just this
//   group) — read-only, never mutated.
// - prevGrantedTo: the key this same answer-record previously granted this
//   session (or null for a fresh answer). Its earlier +1 is arithmetically
//   un-done first (on both deltas, for eligibility, and growthCounts) so
//   editing an already-answered question within the same session never
//   double-counts — see commitContrib's identical idempotent-diff intent for
//   `deltas` itself.
// - Whichever exercise still below `ceiling` has the fewest growth grants so
//   far wins (ties toward keys[0], i.e. the main lift); a key never seen in
//   growthCounts before (a mid-meso exercise swap-in) is seeded at the
//   group's current running max — computed BEFORE undoing prevGrantedTo, so
//   undoing our own prior grant can't transiently understate the group's
//   true established max — so it can't cut ahead of an established lift.
// - Returns { recipientKey, growthCounts } — recipientKey is null if every
//   exercise in the group is already at its own ceiling.
function pickGrowthRecipient(keys, deltas, growthCounts, prevGrantedTo, ceiling = MESO_GROWTH_CEILING_DELTA) {
  const deltaFor = (k) => {
    const raw = (deltas || {})[k] || 0;
    return k === prevGrantedTo ? raw - 1 : raw;
  };
  const gc = { ...(growthCounts || {}) };
  const knownVals = keys.map(k => gc[k]).filter(v => v != null);
  const groupMax = knownVals.length ? Math.max(...knownVals) : 0;
  if (prevGrantedTo != null && gc[prevGrantedTo] != null) {
    gc[prevGrantedTo] = Math.max(0, gc[prevGrantedTo] - 1);
  }
  keys.forEach(k => { if (gc[k] == null) gc[k] = groupMax; });
  const eligible = keys.filter(k => deltaFor(k) < ceiling);
  let recipientKey = null;
  if (eligible.length) {
    recipientKey = eligible.reduce((best, k) => (gc[k] < gc[best] ? k : best), eligible[0]);
    gc[recipientKey] += 1;
  }
  return { recipientKey, growthCounts: gc };
}

// Un-does a single previously-granted growthCounts key by 1 (floor 0) — used
// when an edited volume answer no longer grants anyone (e.g. changed away
// from "not_enough" this session).
function retractGrowthGrant(growthCounts, grantedKey) {
  if (grantedKey == null) return growthCounts || {};
  const gc = { ...(growthCounts || {}) };
  if (gc[grantedKey] != null) gc[grantedKey] = Math.max(0, gc[grantedKey] - 1);
  return gc;
}

// The mirror image of pickGrowthRecipient for the single-exercise DECLINE
// signals ("pushed my limits" / "still sore"). Growth rotates fairly, so
// decline must move too — hard-wiring −1 onto the main lift (keys[0]) alone
// let the group diverge: the main lift sank to its 1-set floor while grown
// secondaries sat at the +4 ceiling, and once floored the signal did nothing.
// Instead the −1 goes to whichever exercise of the group is currently the
// MOST grown, so the group self-balances and can never dead-lock as long as
// anything is above the floor.
// - keys: exId_dayId keys of the muscle group's exercises this session, in
//   day order (keys[0] = the main/first lift).
// - deltas: the meso state's full current set-adjustment map (read-only).
// - prevContrib: this answer-record's ENTIRE previous contribution (record.
//   contrib) — undone first so an edit re-decides from the true pre-answer
//   deltas (handles a "too much" → "pushed" edit that had set several −1s,
//   not just one), keeping repeated confirmations of the same answer stable.
// - Highest effective delta wins; ties resolve toward keys[0] (main lift), so
//   an all-even group early in the meso still trims the main lift exactly like
//   before, and only once a secondary out-grows it does the −1 follow. No
//   floor check needed: the most-grown exercise is by definition furthest from
//   the floor, and an all-at-floor group correctly has its −1 swallowed by
//   applyMesoSetDeltaFromState's clamp (you genuinely can't cut below 1 set).
// - Returns the chosen key, or null if keys is empty.
function pickDeclineRecipient(keys, deltas, prevContrib) {
  if (!keys || !keys.length) return null;
  const eff = (k) => ((deltas || {})[k] || 0) - ((prevContrib || {})[k] || 0);
  return keys.reduce((best, k) => (eff(k) > eff(best) ? k : best), keys[0]);
}

// A mesocycle weight boost (exId_dayId → kg increment applied to the next
// session's seed) must be RE-EARNED every session — min reps hit + joint fine
// + pump ok + volume ok, all re-confirmed. Given the exId_dayId keys of the
// exercises trained THIS session and the boosts actually earned this session,
// return the new full boosts map: every key belonging to this session is
// replaced wholesale (earned → set, un-earned → dropped), while keys for
// OTHER training days are left untouched (they carry their own last-earned
// boost until their own next session). Previously computeMesoGains merged the
// earned map over the old one without ever clearing, so a boost earned once
// kept getting re-applied every session regardless of feedback — the whole
// per-session joint/pump/volume gating was effectively decorative for weight.
// Pure and side-effect free so it can be unit-tested and called safely.
function reearnMesoWeightBoosts(prevBoosts, sessionKeys, earnedBoosts) {
  const next = { ...(prevBoosts || {}) };
  for (const k of (sessionKeys || [])) delete next[k];
  return { ...next, ...(earnedBoosts || {}) };
}

// Counts calendar days within [mesoStartISO, todayISO] that must NOT advance a
// date-based/weekday mesocycle's week counter (see mesoCurrentWeek). The meso
// week represents accumulated training fatigue, so pure recovery time can't
// fast-forward it:
//   • deload + sick days are always excluded (no meso training happens);
//   • vacation allows training, so a vacation day is excluded ONLY if nothing
//     was trained that day — trained vacation days count normally.
// trainedDates is a Set of 'YYYY-MM-DD' on which an ended, non-deload session
// for this plan was logged. Pure/testable. The flex path handles this natively
// (it counts trained non-deload sessions), so this only feeds the date/weekday
// paths, which are otherwise raw calendar arithmetic.
function mesoPausedDays(statusPeriods, trainedDates, mesoStartISO, todayISO) {
  if (!statusPeriods?.length || !mesoStartISO || !todayISO) return 0;
  const start = new Date(mesoStartISO.slice(0, 10) + 'T12:00:00');
  const end = new Date(todayISO.slice(0, 10) + 'T12:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 0;
  const trained = trainedDates || new Set();
  const periods = statusPeriods
    .filter(p => p && p.startedAt)
    .map(p => ({ mode: p.mode, from: p.startedAt.slice(0, 10), to: p.endedAt ? p.endedAt.slice(0, 10) : todayISO.slice(0, 10) }));
  let paused = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = fmtISO(d);
    const frozen = periods.some(p =>
      iso >= p.from && iso <= p.to &&
      (p.mode === 'deload' || p.mode === 'sick' || (p.mode === 'vacation' && !trained.has(iso)))
    );
    if (frozen) paused++;
  }
  return paused;
}

// RIR target for a given meso week: linear taper from startRir (week 1) down to
// endRir (final week). endRir may be NEGATIVE (beyond failure → auto lengthened
// partials) — no floor at 0, so the negative tail survives. Defaults 3 → 0
// reproduce the original fixed taper exactly. Pure/testable.
function mesoRirForWeek(week, weeks, startRir = 3, endRir = 0) {
  if (!weeks || weeks <= 1) return endRir;
  return Math.round(startRir - (week - 1) * (startRir - endRir) / (weeks - 1));
}

// "5m ago"/"3h ago"/"2d ago" from an ISO timestamp. capDays, if given, rolls
// over to a short locale date past that many days instead of counting
// indefinitely (screens-settings.jsx's sign-up feed wants that; the
// coaching thread previews don't).
function timeAgo(iso, { capDays } = {}) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (capDays == null || days < capDays) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// "today"/"yesterday"/"Nd ago" from a pre-computed day difference (today=0).
// rollup additionally steps up to "Nw ago" past a week and a short
// month/year past a month — the schedule backup picker wants that, the
// Home/Library "last trained" labels just want the day count.
function dayLabel(diffDays, { rollup = false, referenceDate } = {}) {
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (!rollup || diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.round(diffDays / 7)}w ago`;
  return referenceDate ? referenceDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : `${diffDays}d ago`;
}

// Cache-first reload merge for an ID-keyed collection: for ids on both
// sides, keep the local row only if it carries an unsynced offline edit
// (present in the persisted sync base AND different from it there) —
// otherwise the server row wins. delIds, if given, drops rows the caller
// already knows were deleted. app.jsx used to hand-roll this identically in
// two places (softRefresh and loadData's reconciliation), the second with
// the delIds filter the first didn't need. Local-only/server-only handling
// (never-synced rows, resurrection guards) stays with each caller since it
// varies per collection — this covers just the shared id-matched half.
function mergeCollectionById(freshRows, curRows, baseRows, delIds) {
  const curMap = new Map((curRows || []).map(r => [r.id, r]));
  const baseMap = baseRows ? new Map(baseRows.map(r => [r.id, r])) : null;
  return (freshRows || []).filter(r => !delIds?.has(r.id)).map(r => {
    const c = curMap.get(r.id);
    const b = baseMap?.get(r.id);
    if (c && b && JSON.stringify(c) !== JSON.stringify(b)) return c;
    return r;
  });
}

// Calories from macros: P×4 + C×4 + F×9. With fiber given (net-carb mode),
// carbs contribute max(0, C − fiber)×4 — clamped so it matches the displayed
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
// hoc in 7+ places — each new technique or field (e.g. the recent "partials
// finisher") needed hand-editing every one of them, and two of them
// (screens-coaching-client.jsx's two fmtSetChip copies) already carried a
// comment admitting they were kept in sync by hand ("same gap, same fix").
//   kind: 'drop'|'myorep'|'myorep_match'|'amrap_variations'|'lengthened_partial'|null
//   badge: display label for the technique, null for a plain set
//   connector: '→' (drop/AMRAP) | '↺' (myo) | null
//   rounds: [{kg, reps, label?}] — populated for chain techniques (falls back
//     to a single round built from st.kg/st.reps when drops is empty,
//     matching every prior caller's own fallback); empty for
//     lengthened_partial/plain sets, which use kg/reps directly
//   totalReps: sum of round reps — only meaningful for myo variants, else null
//   partials: the finisher count on the last round (chain techniques) or
//     lengthened_partial's own count; 0 when none
//   anyVaried: true if any AMRAP Variations round's label diverges from
//     exName — callers use this to decide whether to show round labels at all
function techniqueRounds(st, { exName } = {}) {
  const empty = { kind: null, badge: null, connector: null, rounds: [], totalReps: null, partials: 0, anyVaried: false };
  if (!st || !st.technique) return empty;
  if (st.technique === 'lengthened_partial') {
    return { ...empty, kind: 'lengthened_partial', badge: 'PARTIALS', partials: st.drops?.partials || 0 };
  }
  const BADGES = { drop: 'DROP SET', myorep: 'MYO-REPS', myorep_match: 'MYO MATCH', amrap_variations: 'AMRAP' };
  if (!BADGES[st.technique]) return empty;
  const drops = (st.drops && st.drops.length > 0) ? st.drops : (st.kg != null ? [{ kg: st.kg, reps: st.reps }] : []);
  const isMyo = st.technique === 'myorep' || st.technique === 'myorep_match';
  return {
    kind: st.technique,
    badge: BADGES[st.technique],
    connector: isMyo ? '↺' : '→',
    rounds: drops.map(d => ({ kg: d.kg, reps: d.reps, label: d.label })),
    totalReps: isMyo ? drops.reduce((a, d) => a + (d.reps || 0), 0) : null,
    partials: drops[drops.length - 1]?.partials || 0,
    anyVaried: st.technique === 'amrap_variations' && drops.some(d => d.label && d.label !== exName),
  };
}

// Reads the active Service Worker cache version ("zane-vX.XXX" → "vX.XXX"),
// or null if unavailable. Used both to report a device's version to the
// admin (app.jsx) and to display it locally (screens-home.jsx's login screen).
async function detectCacheVersion() {
  if (!('caches' in window)) return null;
  try {
    const keys = await caches.keys();
    const name = keys.find(k => k.startsWith('zane-'));
    return name ? name.replace('zane-', '') : null;
  } catch (_) { return null; }
}

// Wipes both cache layers a stale deploy can hide behind: the SW's
// CacheStorage entries AND the IndexedDB precompile cache (zane-precompile,
// see index.html's loader) — a stale record in the latter alone keeps
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
// legacy API in modern browsers — a plain reload after clearing caches is
// still served by whichever service worker is CURRENTLY active (an update
// may be waiting but not yet activated), and that worker's own network
// fallback fetch can still be answered by the browser's HTTP cache, a
// layer entirely below CacheStorage that clearing it never touches. A
// unique ?_v= query string guarantees no HTTP cache entry exists for this
// exact URL, and sw.js's fetch handler already treats any ?_v= request as
// always-network (see the version-check probe in checkSwUpdate) — so this
// reliably gets the same fresh result an actual SW update does.
async function clearCachesAndReload() {
  await clearPrecompileCaches();
  window.location.href = window.location.pathname + '?_v=' + Date.now() + window.location.hash;
}

window.LB = {
  supabase: _supabase,
  clearPrecompileCaches, clearCachesAndReload,
  SUPABASE_URL, SUPABASE_ANON_KEY, PUSHOVER_URL, WEB_PUSH_URL, fnFetch,
  subscribeWebPush, unsubscribeWebPush, getWebPushSubscription,
  QS_EMAILS, hasQuickSwitchSession, quickSwitch, saveQsName, getQsName,
  signIn, signUp, signOut, signInWithPasskey, registerPasskey, listPasskeys, deletePasskey, resetPassword, deleteAllData, exportBackup, backupToBlob, readBackupText, importFromBackup, validateBackup,
  loadFromSupabase, syncStore, mergeSessions, withCarriedWindowEntries, historyWindowCutoffISO,
  saveToLocal, loadFromLocal, saveBase, loadBase, clearLocal,
  uid, todayISO, fmtISO, nextMondayISO, nextCycleD1ISO, nextCycleD1ISOFromSchedule, parseDate, isoWd, weekEnd, findExercise, lastSessionForExercise, recentSessionsForExercise, bestRecentEntry, bestEntryFromSetLists, progressionSuggestion, progressionEnabled, progressionCeilingFor, is531MainLift, todaysDay, nextDay, isWeekdayPlan, isFlexPlan, healScheduleWeekdays, buildPlanSkeleton, instantiateProgram, is531Plan, round531, tmFrom531, tmBump531, weeks531, week531, fiveThreeOneSets, build531Plan, add531MainLift, current531Week, current531Cycle, compute531CycleBumps, resolve531CycleEnd, suggest531Tm, splitDayCount, frequencyHint, mesoTaperPreview, mesoRirEnabled, getPlanDaysForDate, getCyclePosForDate, getCycleNumForDate, getCycleStartForNum, getActiveVersionIdx, dedupeVersionsByDate, realignCycleForToday, todayCycleStripIndex,
  effReps, fmtDuration, e1rm, isImprovement, isDecline, bestE1rmForExercise, bestAssistLoad, totalVolume, entryVolume, doneSetCount, buildSeedSets, buildTimeSeedSets, latestBodyweight, bodyweightForDate, exerciseLogMode, isAssisted, shouldPullBodyweight, systemExerciseToRow, inferCurrentExIdx, calcBlended,
  refreshExerciseBests, fetchSeedEntries, fetchExerciseHistory, fetchSessionEntries,
  computeNextReminderAt,
  cancelPushover, adminSendEmail,
  subscribeToChanges,
  openStatusPeriod, closeStatusPeriod, updateStatusPeriodStart, clearStatusMode,
  startDeload, endDeload, deloadElapsed, deloadDaysRemaining, deloadPlanDays,
  loadClientStore, loadCoachClientsStatus, reloadCoachingState, enableSelfCoaching, inviteClient, respondToCoachingInvite, endCoaching,
  addCoachingNote, markCoachingNotesRead, loadCoachingNotes, loadCoachingThreads, createCoachingThread, deleteCoachingThread, getOrCreateCoachingThread, uploadChatImage,
  unreadCoachingNotes, isNoteFromClient, techniqueRounds, groupBySuperset, supersetLabel, timeAgo, dayLabel, cyclePosFromStartDate, mergeCollectionById, caloriesFromMacros, detectCacheVersion,
  loadCoachingMacros, addCoachingMacros,
  diffSchedule,
  checkinWeekStart, submitCheckin, loadCheckins, deleteCheckin, loadCoachCheckinStatus, requestCheckin, setCheckinEnabled, loadCheckinSchema, saveCheckinSchema, saveDefaultCheckinSchema,
  cardioWeekPrefill, detectCardioPRs,
  cardioDistUnit, setCardioDistUnit, distToM, mToDisplay, fmtDistance, fmtPace, fmtSpeed, MI_TO_M, recentCardioTypes,
  isLoggedTrainingDay, plannedTrainingDay, isTrainingDayForDate, dayTargetFromMacros, macroAdherence, effectiveMacroTargets, dailyLogAdherence, dailyLogsWeekPrefill, weekPerformanceSignal,
  refreshHealthLogs,
  pickGrowthRecipient, retractGrowthGrant, pickDeclineRecipient, reearnMesoWeightBoosts, mesoPausedDays, mesoRirForWeek, MESO_GROWTH_CEILING_DELTA,
};
