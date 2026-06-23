/* Logbook store — Supabase backend */

const SUPABASE_URL = 'https://ebbuvdzgstrhrcsbrlez.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';

const PUSHOVER_URL          = `${SUPABASE_URL}/functions/v1/pushover`;
const WEB_PUSH_URL          = `${SUPABASE_URL}/functions/v1/web-push`;
const COACHING_NOTIFY_URL   = `${SUPABASE_URL}/functions/v1/zane_coaching-notify`;

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
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    // email confirmation disabled — user is immediately logged in
    await setupNewUser(data.user.id, name, unit);
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

async function deleteAllData(userId) {
  await Promise.all([
    unwrap(_supabase.from('zane_sessions').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_exercises').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_schedules').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_user_settings').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_profiles').delete().eq('id', userId)),
    unwrap(_supabase.from('zane_skips').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_cardio_logs').delete().eq('user_id', userId)),
    unwrap(_supabase.from('zane_daily_logs').delete().eq('user_id', userId)),
  ]);
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

async function importFromBackup(backup, userId) {
  // Validate before the destructive delete — never half-apply a bad file.
  const invalid = validateBackup(backup);
  if (invalid) throw new Error(invalid);
  await deleteAllData(userId);
  const sett = backup.settings ?? {};
  const importSessions = backup.sessions?.filter(s => s.id) ?? [];
  await Promise.all([
    backup.user?.name && unwrap(_supabase.from('zane_profiles').upsert({ id: userId, name: backup.user.name })),
    backup.exercises?.length && unwrap(_supabase.from('zane_exercises').upsert(
      backup.exercises.map(e => ({ id: e.id, name: e.name, tags: e.tags ?? [], note: e.note ?? '', category: e.category ?? null, unilateral: e.unilateral ?? false, equipment: e.equipment ?? null, progression_reps: e.progression_reps ?? null, movement_type: e.movement_type ?? null, no_weight_reps: !!e.no_weight_reps, user_id: userId }))
    )),
    backup.schedules?.length && unwrap(_supabase.from('zane_schedules').upsert(
      backup.schedules.map(({ mode, ...s }) => ({ ...s, user_id: userId }))
    )),
    importSessions.length && unwrap(_supabase.from('zane_sessions').upsert(
      importSessions.map(s => sessionToRow(s, userId))
    )),
    unwrap(_supabase.from('zane_user_settings').upsert({
      user_id: userId,
      active_schedule_id: backup.activeScheduleId ?? null,
      cycle_index: backup.cycleIndex ?? 0,
      cycle_start_date: backup.cycleStartDate ?? null,
      week_plan_start_date: backup.weekPlanStartDate ?? null,
      last_advanced_date: backup.lastAdvancedDate ?? null,
      in_progress_session_id: backup.inProgress ?? null,
      unit: sett.unit ?? null,
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
      manual_calories: sett.manualCalories ?? false,
      net_carbs: sett.netCarbs ?? false,
      show_warmup_in_summary: sett.showWarmupInSummary ?? false,
      show_coaching_tab: sett.showCoachingTab ?? false,
      be_your_own_coach: sett.beYourOwnCoach ?? false,
      session_timeout_minutes: sett.sessionTimeoutMinutes ?? 90,
      macro_targets: sett.macroTargets ?? null,
      show_health_tab: sett.showHealthTab ?? false,
      onboarding_completed: sett.onboardingCompleted ?? false,
    })),
  ].filter(Boolean));
  // Entries then sets after sessions are committed (FK order: sessions → entries → sets)
  if (importSessions.length) await _syncEntryRelational(importSessions, userId, null);
  if (backup.skips?.length) {
    await unwrap(_supabase.from('zane_skips').upsert(
      backup.skips.map(s => ({
        id: s.id, user_id: userId, date: s.date, day_id: s.dayId,
        day_name: s.dayName, skip_reason: s.skipReason, skipped_at: s.skippedAt ?? null,
      }))
    ));
  }
  if (backup.cardioLogs?.length) {
    await unwrap(_supabase.from('zane_cardio_logs').upsert(
      backup.cardioLogs.map(l => ({
        id: l.id, user_id: userId, date: l.date, type: l.type ?? null,
        duration_minutes: l.durationMinutes, distance_m: l.distanceM ?? null,
        pace_feeling: l.paceFeeling ?? null, effort: l.effort ?? null,
        note: l.note ?? null, session_id: l.sessionId ?? null,
      }))
    ));
  }
  if (backup.dailyLogs?.length) {
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
  }
}

// Builds a complete export object for backup. Unlike JSON.stringify(store), this
// fetches ALL session entries from the DB (no boot-window restriction) so older
// sessions are fully preserved. Strips server-derived and relational fields that
// have no meaning in a backup (exerciseBests, coaching, nextReminderAt).
async function exportBackup(store, userId) {
  const { data: allEntryRows } = await _supabase
    .from('zane_session_entries')
    .select('*, sets:zane_sets(*)')
    .eq('user_id', userId)
    .order('entry_idx');
  const bySession = {};
  for (const e of (allEntryRows || [])) {
    if (!bySession[e.session_id]) bySession[e.session_id] = [];
    bySession[e.session_id].push(e);
  }
  const { exerciseBests, coaching, nextReminderAt, ...rest } = store;
  return {
    ...rest,
    sessions: store.sessions.map(s => ({
      ...s,
      entries: bySession[s.id] ? mapEntryRows(bySession[s.id]) : s.entries,
    })),
  };
}

// ─── SETUP NEW USER ──────────────────────────────────────────────────────

async function setupNewUser(userId, name, unit) {
  await Promise.all([
    _supabase.from('zane_profiles').upsert({ id: userId, name }),
    _supabase.from('zane_user_settings').upsert({ user_id: userId, ...(unit != null ? { unit } : {}), rest_default: 120 }),
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
    note: e.note || '',
    supersetGroup: e.superset_group || null,
    sets: (e.sets || [])
      .sort((a, b) => a.set_idx - b.set_idx)
      .map(st => ({
        kg: st.kg,
        reps: st.reps,
        repsL: st.reps_l,
        repsR: st.reps_r,
        done: st.done,
        skipped: st.skipped,
        warmup: st.warmup,
      })),
  }));
}

async function loadFromSupabase(userId, _depth = 0, _opts = {}) {
  const isCoachLoad = !!_opts.coachLoad;
  const histCutoff = historyWindowCutoffISO();
  const queries = [
    _supabase.from('zane_profiles').select('id, name, approved').eq('id', userId).maybeSingle(),
    _supabase.from('zane_exercises').select('id, name, tags, note, category, unilateral, equipment, progression_reps, movement_type, no_weight_reps').eq('user_id', userId),
    _supabase.from('zane_schedules').select('id, name, days, archived, versions, is_flex, sessions_per_week').eq('user_id', userId),
    // Session METADATA stays complete (cheap; streaks/calendar need the full
    // date list) — the legacy entries JSONB is no longer selected.
    _supabase.from('zane_sessions').select('id, schedule_id, day_id, day_name, date, started_at, ended, duration_minutes, feel, is_bonus, is_freestyle')
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
    _supabase.from('zane_daily_logs').select('id, date, weight, steps, calories, protein, carbs, fat, fiber, water_ml, note, off_plan_note, adherence, targets_snap, daily_coach_fields, created_at').eq('user_id', userId).order('date', { ascending: false }),
    // Sick/vacation history periods — used for missed-workout stats and training adherence.
    // Coach reads client's periods via coach-of-client RLS policy (migration 0084).
    _supabase.from('zane_status_periods').select('id, mode, started_at, ended_at').eq('user_id', userId).order('started_at', { ascending: false }),
    // Support tickets — user's own ticket list, newest activity first
    isCoachLoad ? null : _supabase.rpc('get_user_support_chats'),
  ];
  const [profileRes, exRes, schRes, sessRes, settRes, skipsRes, entriesRes,
         bestsRes, sessionStatsRes,
         coachInfoRes, coachClientsRes, unreadNotesRes, coachingRowRes, selfRowRes,
         cardioLogsRes, cardioPlansRes, dailyLogsRes, statusPeriodsRes,
         supportTicketsRes] = await Promise.all(queries);

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

  const { data: { user: authUser } } = await _supabase.auth.getUser();

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
    schedules: schRes.data || [],
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
      createdAt: l.created_at,
    })),
    statusPeriods: (statusPeriodsRes?.data || []).map(p => ({
      id: p.id, mode: p.mode, startedAt: p.started_at, endedAt: p.ended_at ?? null,
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
        manualCalories: sett.manual_calories ?? false,
        netCarbs: sett.net_carbs ?? false,
        progressionRangeTop: sett.progression_range_top ?? 4,
        equipmentConfig: sett.equipment_config ?? {},
        reminderEnabled: sett.reminder_enabled ?? false,
        reminderTime: sett.reminder_time ?? '07:00',
        showWarmupInSummary: sett.show_warmup_in_summary ?? true,
        showCoachingTab: sett.show_coaching_tab ?? false,
        beYourOwnCoach: sett.be_your_own_coach ?? false,
        sessionTimeoutMinutes: sett.session_timeout_minutes ?? 90,
        defaultCheckinSchema: sett.default_checkin_schema ?? null,
        macroTargets: sett.macro_targets ?? null,
        showHealthTab: sett.show_health_tab ?? false,
        onboardingCompleted: sett.onboarding_completed ?? false,
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
    let trainingDay = null;
    if (isWd) {
      if (state.weekPlanStartDate && dateKey < state.weekPlanStartDate) continue;
      const wd = isoWd(d);
      trainingDay = activeSch.days.find(day => day.weekday === wd && (day.items || []).length > 0) || null;
    } else {
      const days = getPlanDaysForDate(activeSch, dateKey);
      const pos = getCyclePosForDate(activeSch, dateKey);
      let dayData;
      if (pos !== null) {
        dayData = days[pos];
      } else {
        if (!state.cycleStartDate) continue;
        const start = parseDate(state.cycleStartDate);
        const n = Math.round((d.getTime() - start.getTime()) / 86400000);
        if (n < 0) continue;
        dayData = activeSch.days[((n % activeSch.days.length) + activeSch.days.length) % activeSch.days.length];
      }
      if ((dayData?.items || []).length > 0) trainingDay = dayData;
    }
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
  const { error } = await _supabase.from('zane_skips').insert(rows);
  if (error) { console.error('auto-archive missed days:', error); return; }
  state.skips.push(...rows.map(r => ({
    id: r.id, date: r.date, dayId: r.day_id, dayName: r.day_name,
    skipReason: r.skip_reason, skippedAt: r.skipped_at,
  })));
}

// ─── SYNC ────────────────────────────────────────────────────────────────

// Dual-write entries then sets sequentially (sets FK-depend on entries existing first).
// prevSessions: pass prev store sessions to skip unchanged sets; pass null to write all.
async function _syncEntryRelational(sessions, userId, prevSessions) {
  const now = new Date().toISOString();
  const allEntries = [];
  const allSets = [];

  // Normalize set fields for comparison — guards against null vs undefined and missing
  // keys when comparing sets from an old (pre-migration) store format with new format.
  const normSet = s => [s.kg ?? null, s.reps ?? null, s.repsL ?? null, s.repsR ?? null,
                        s.done ? 1 : 0, s.skipped ? 1 : 0, s.warmup ? 1 : 0].join('|');

  for (const s of sessions) {
    const entries = s.entries || [];
    if (!entries.length) continue;

    const prevSession = prevSessions ? prevSessions.find(x => x.id === s.id) : null;

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
        note: e.note || '',
        superset_group: e.supersetGroup || null,
      });

      const prevEntry = prevSession ? (prevSession.entries || [])[ei] : null;
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
            done: set.done ?? false,
            skipped: set.skipped ?? false,
            warmup: set.warmup ?? false,
            updated_at: now,
          });
        }
      });
    }
  }

  if (allEntries.length) {
    await unwrap(_supabase.from('zane_session_entries').upsert(allEntries, { onConflict: 'id' }));
  }
  if (allSets.length) {
    await unwrap(_supabase.rpc('sync_sets_batch', { p_sets: allSets }));
  }
}

function sessionToRow(s, userId) {
  // `entries` is intentionally pulled out and NOT written: the relational
  // zane_session_entries / zane_sets tables are the single source of truth, and
  // the reporting RPCs read from them (migration 0058). The legacy JSONB column
  // keeps its default '[]' on insert and is left untouched on update.
  // agg* are read-only server aggregates attached at load time — never synced.
  // eslint-disable-next-line no-unused-vars
  const { currentExIdx, cyclePos, restStart, restDuration, scheduleId, dayId, dayName, startedAt, durationMinutes, feel, entries, aggVolume, aggDoneSets, aggExercises, isBonus, isFreestyle, ...rest } = s;
  const row = { ...rest, schedule_id: scheduleId, day_id: dayId, day_name: dayName, user_id: userId };
  if (startedAt != null) row.started_at = startedAt;
  if (durationMinutes != null) row.duration_minutes = durationMinutes;
  row.feel = feel ?? null;
  row.is_bonus = !!isBonus;
  row.is_freestyle = !!isFreestyle;
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
    if (upsert.length)  ops.push(_supabase.from('zane_exercises').upsert(upsert.map(e => ({ id: e.id, name: e.name, tags: e.tags ?? [], note: e.note ?? '', category: e.category ?? null, unilateral: e.unilateral ?? false, equipment: e.equipment ?? null, progression_reps: e.progression_reps ?? null, movement_type: e.movement_type ?? null, no_weight_reps: !!e.no_weight_reps, user_id: userId }))));
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

  if (prev.dailyLogs !== next.dailyLogs) {
    const upsert = (next.dailyLogs || []).filter(l => {
      const p = (prev.dailyLogs || []).find(x => x.id === l.id);
      return !p || JSON.stringify(p) !== JSON.stringify(l);
    });
    const removed = (prev.dailyLogs || []).filter(l => !(next.dailyLogs || []).find(x => x.id === l.id));
    if (upsert.length) ops.push(_supabase.from('zane_daily_logs').upsert(upsert.map(l => ({
      id: l.id, user_id: userId, date: l.date,
      weight: l.weight ?? null, steps: l.steps ?? null,
      calories: l.calories ?? null, protein: l.protein ?? null,
      carbs: l.carbs ?? null, fat: l.fat ?? null, fiber: l.fiber ?? null,
      water_ml: l.waterMl ?? null, note: l.note ?? null,
      off_plan_note: l.offPlanNote ?? null,
      adherence: l.adherence ?? null, targets_snap: l.targetsSnap ?? null,
      daily_coach_fields: l.coachFields ?? null,
    }))));
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
    prev.settings?.manualCalories     !== next.settings?.manualCalories     ||
    prev.settings?.netCarbs           !== next.settings?.netCarbs           ||
    prev.settings?.progressionRangeTop !== next.settings?.progressionRangeTop ||
    JSON.stringify(prev.settings?.equipmentConfig) !== JSON.stringify(next.settings?.equipmentConfig) ||
    JSON.stringify(prev.customDayTypes) !== JSON.stringify(next.customDayTypes) ||
    prev.settings?.reminderEnabled      !== next.settings?.reminderEnabled      ||
    prev.settings?.reminderTime         !== next.settings?.reminderTime         ||
    prev.settings?.showWarmupInSummary  !== next.settings?.showWarmupInSummary  ||
    prev.settings?.showCoachingTab      !== next.settings?.showCoachingTab      ||
    prev.settings?.beYourOwnCoach         !== next.settings?.beYourOwnCoach         ||
    prev.settings?.sessionTimeoutMinutes  !== next.settings?.sessionTimeoutMinutes  ||
    prev.settings?.showHealthTab          !== next.settings?.showHealthTab          ||
    JSON.stringify(prev.settings?.macroTargets) !== JSON.stringify(next.settings?.macroTargets) ||
    prev.settings?.onboardingCompleted    !== next.settings?.onboardingCompleted    ||
    prev.nextReminderAt                   !== next.nextReminderAt   ||
    prev.statusMode                       !== next.statusMode       ||
    prev.statusModeSince                  !== next.statusModeSince  ||
    prev.activeCardioPlanId               !== next.activeCardioPlanId;

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
      manual_calories: next.settings?.manualCalories ?? false,
      net_carbs: next.settings?.netCarbs ?? false,
      progression_range_top: next.settings?.progressionRangeTop ?? 4,
      equipment_config: next.settings?.equipmentConfig ?? {},
      custom_day_types: next.customDayTypes ?? [],
      reminder_enabled: next.settings?.reminderEnabled ?? false,
      reminder_time: next.settings?.reminderTime ?? '07:00',
      show_warmup_in_summary: next.settings?.showWarmupInSummary ?? true,
      show_coaching_tab: next.settings?.showCoachingTab ?? false,
      be_your_own_coach: next.settings?.beYourOwnCoach ?? false,
      session_timeout_minutes: next.settings?.sessionTimeoutMinutes ?? 90,
      macro_targets: next.settings?.macroTargets ?? null,
      show_health_tab: next.settings?.showHealthTab ?? false,
      onboarding_completed: next.settings?.onboardingCompleted ?? false,
      next_reminder_at: computeNextReminderAt(next),
      in_progress_session_id: next.inProgress ?? null,
      status_mode: next.statusMode ?? null,
      status_mode_since: next.statusModeSince ?? null,
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

// Date of the next upcoming training day (today if not yet trained, otherwise tomorrow+).
// Returns an ISO date string or null.
function computeNextTrainingDate(state) {
  const sch = state.schedules.find(s => s.id === state.activeScheduleId);
  if (!sch || !sch.days.length) return null;

  const today = new Date(); today.setHours(12, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const trainedToday = state.sessions.some(s => s.date?.slice(0, 10) === todayStr && s.ended);
  const wdPlan = isWeekdayPlan(sch);

  for (let ahead = trainedToday ? 1 : 0; ahead <= 14; ahead++) {
    const d = new Date(today); d.setDate(today.getDate() + ahead);
    const dateStr = d.toISOString().slice(0, 10);
    let training = false;
    if (wdPlan) {
      const wd = isoWd(d);
      const day = sch.days.find(x => x.weekday === wd);
      training = !!(day && (day.items || []).length > 0);
    } else {
      const days = getPlanDaysForDate(sch, dateStr);
      const idx = getCyclePosForDate(sch, dateStr);
      if (idx !== null) {
        training = (days[idx]?.items || []).length > 0;
      } else {
        if (!state.cycleStartDate) return null;
        const start = parseDate(state.cycleStartDate);
        const n = Math.round((d.getTime() - start.getTime()) / 86400000);
        if (n < 0) continue;
        training = (sch.days[((n % sch.days.length) + sch.days.length) % sch.days.length]?.items || []).length > 0;
      }
    }
    if (training) return dateStr;
  }
  return null;
}

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
  const wdPlan = isWeekdayPlan(sch);

  for (let ahead = (trainedToday || todayTimePassed) ? 1 : 0; ahead <= 14; ahead++) {
    const d = new Date(today); d.setDate(today.getDate() + ahead);
    const dateStr = d.toISOString().slice(0, 10);
    let training = false;
    if (wdPlan) {
      const wd = isoWd(d);
      const day = sch.days.find(x => x.weekday === wd);
      training = !!(day && (day.items || []).length > 0);
    } else {
      const days = getPlanDaysForDate(sch, dateStr);
      const idx = getCyclePosForDate(sch, dateStr);
      if (idx !== null) {
        training = (days[idx]?.items || []).length > 0;
      } else {
        if (!state.cycleStartDate) return null;
        const start = parseDate(state.cycleStartDate);
        const n = Math.round((d.getTime() - start.getTime()) / 86400000);
        if (n < 0) continue;
        training = (sch.days[((n % sch.days.length) + sch.days.length) % sch.days.length]?.items || []).length > 0;
      }
    }
    if (training) return new Date(dateStr + 'T' + time + ':00').toISOString();
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
  if (!prev || !curr || !curr.done || curr.skipped || curr.kg == null || prev.kg == null) return false;
  const rA = effReps(curr); const rB = effReps(prev);
  if (rA == null || rB == null) return false;
  return (curr.kg > prev.kg && rA >= rB - 2) || (curr.kg >= prev.kg && rA > rB);
}
function isDecline(curr, prev) {
  if (!prev || !curr || curr.skipped) return false;
  if (prev.skipped) return false; // prev was already skipped, no baseline to decline from
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
    if (!s.ended || (excludeSessionId && s.id === excludeSessionId)) continue;
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
function totalVolume(session, exercises) {
  const ended = !!session.ended;
  if (ended && !(session.entries || []).length && session.aggVolume != null) return session.aggVolume;
  const excludedIds = exercises
    ? new Set(exercises.filter(e => e.movement_type === 'mobility' || e.movement_type === 'cardio').map(e => e.id))
    : null;
  return (session.entries || []).reduce((sum, entry) => {
    if (entry.isCardio) return sum;
    if (excludedIds && excludedIds.has(entry.exId)) return sum;
    return sum + (entry.sets || []).filter(st => {
      if (st.warmup || st.skipped) return false;
      if (ended) return st.kg != null && (st.reps != null || st.repsL != null || st.repsR != null);
      return st.done;
    }).reduce((s, st) => {
      const reps = effReps(st) ?? 0;
      return s + (+st.kg || 0) * reps;
    }, 0);
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
      if (ended) return st.kg != null && (st.reps != null || st.repsL != null || st.repsR != null);
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

// Compute the seed-sets array when starting/logging a session for a planned item.
// Honors smart-progression suggestions and falls back to last-session values.
// bodyweightKg: prefill kg with this value when kg would otherwise be null (for bodyweight exercises).
function buildSeedSets(it, last, suggestion, isUni, smartProgression, bodyweightKg = null) {
  const workingSets = (last?.entry?.sets || []).filter(s => !s.warmup);
  const repsPerSet = it.repsPerSet;
  return Array.from({ length: it.sets }).map((_, i) => {
    const prev = workingSets[i];
    const targetReps = repsPerSet ? (repsPerSet[i] ?? repsPerSet[repsPerSet.length - 1]) : null;
    if (suggestion) {
      return isUni
        ? { kg: suggestion.kg, repsL: suggestion.reps, repsR: suggestion.reps, done: false }
        : { kg: suggestion.kg, reps: suggestion.reps, done: false };
    }
    if (smartProgression && prev) {
      return isUni
        ? { kg: prev.kg ?? bodyweightKg ?? null, repsL: prev.repsL != null ? prev.repsL + 1 : null, repsR: prev.repsR != null ? prev.repsR + 1 : null, done: false }
        : { kg: prev.kg ?? bodyweightKg ?? null, reps: prev.reps != null ? prev.reps + 1 : null, done: false };
    }
    if (!prev && targetReps != null) {
      return isUni
        ? { kg: bodyweightKg ?? null, repsL: targetReps, repsR: targetReps, done: false }
        : { kg: bodyweightKg ?? null, reps: targetReps, done: false };
    }
    return isUni
      ? { kg: prev?.kg ?? bodyweightKg ?? null, repsL: prev?.repsL ?? null, repsR: prev?.repsR ?? null, done: false }
      : { kg: prev?.kg ?? bodyweightKg ?? null, reps: prev?.reps ?? null, done: false };
  });
}

function lastSessionForExercise(state, exId, dayId = null) {
  const sessions = state.sessions
    .filter(s => s.ended && (dayId == null || s.dayId === dayId))
    .slice()
    .sort((a, b) => (b.ended || '').localeCompare(a.ended || ''));
  for (const s of sessions) {
    const entry = s.entries.find(e => e.exId === exId && (e.sets || []).some(x => x.kg != null || x.reps != null));
    if (entry) return { session: s, entry };
  }
  return null;
}

// Up to `limit` most-recent ended sessions that logged this exercise, newest first.
function recentSessionsForExercise(state, exId, dayId = null, limit = 3) {
  const sessions = state.sessions
    .filter(s => s.ended && (dayId == null || s.dayId === dayId))
    .slice()
    .sort((a, b) => (b.ended || '').localeCompare(a.ended || ''));
  const out = [];
  for (const s of sessions) {
    const entry = (s.entries || []).find(e => e.exId === exId &&
      (e.sets || []).some(x => x.kg != null || x.reps != null || x.repsL != null || x.repsR != null));
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
  return bestEntryFromSetLists(recent.map(r => (r.entry.sets || []).filter(s => !s.warmup && !s.skipped)));
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
      const merged = [...local];
      for (const row of rows) {
        if (!merged.some(m => m.sessionId === row.sessionId)) merged.push(row);
      }
      merged.sort((a, b) => (Date.parse(b.ended) || 0) - (Date.parse(a.ended) || 0));
      const ref = bestEntryFromSetLists(
        merged.slice(0, window).map(r => (r.sets || []).filter(s => !s.warmup && !s.skipped))
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

    if (!nextV || dateStr < nextV.validFrom) {
      // dateStr is within this version's period
      const daysDiff = Math.round((new Date(dateStr + 'T12:00:00') - new Date(v.validFrom + 'T12:00:00')) / 86400000);
      return totalPriorCycles + Math.floor(Math.max(0, daysDiff) / daysLen) + 1;
    }
    // Add the cycle number of this version's last day (= the highest cycle it reached)
    const vStart = new Date(v.validFrom + 'T12:00:00');
    const vEnd = new Date(nextV.validFrom + 'T12:00:00');
    const daysInVersion = Math.round((vEnd - vStart) / 86400000);
    totalPriorCycles += Math.floor((daysInVersion - 1) / daysLen) + 1;
  }
  return totalPriorCycles + 1;
}

function getCyclePosForDate(schedule, dateStr) {
  const versions = schedule.versions;
  if (!versions?.length) return null;
  for (const v of versions) {
    if (v.validFrom <= dateStr) {
      const daysLen = (v.days || []).length;
      if (!daysLen) return 0;
      const daysDiff = Math.round((new Date(dateStr + 'T12:00:00') - new Date(v.validFrom + 'T12:00:00')) / 86400000);
      return ((daysDiff % daysLen) + daysLen) % daysLen;
    }
  }
  // Before plan started: extend oldest version backwards (negative daysDiff wraps correctly)
  const oldest = versions[versions.length - 1];
  const daysLen = (oldest.days || []).length;
  if (!daysLen) return 0;
  const daysDiff = Math.round((new Date(dateStr + 'T12:00:00') - new Date(oldest.validFrom + 'T12:00:00')) / 86400000);
  return ((daysDiff % daysLen) + daysLen) % daysLen;
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
// previous version for that date instead of stacking a duplicate.
function dedupeVersionsByDate(versions) {
  const seen = new Set();
  return (versions || []).filter(v => {
    if (seen.has(v.validFrom)) return false;
    seen.add(v.validFrom);
    return true;
  });
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
  let idx;
  if (state.cycleStartDate) {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const start = parseDate(state.cycleStartDate);
    const n = Math.round((today.getTime() - start.getTime()) / 86400000);
    idx = ((n % sch.days.length) + sch.days.length) % sch.days.length;
  } else {
    idx = (state.cycleIndex || 0) % sch.days.length;
  }
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
  let curIdx;
  if (state.cycleStartDate) {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const start = parseDate(state.cycleStartDate);
    const n = Math.round((today.getTime() - start.getTime()) / 86400000);
    curIdx = ((n % sch.days.length) + sch.days.length) % sch.days.length;
  } else {
    curIdx = (state.cycleIndex || 0) % sch.days.length;
  }
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
  const sessions = freshSessions.filter(s => !locallyDeletedIds?.has(s.id)).map(s => {
    const mem = (curSessions || []).find(x => x.id === s.id);
    if (!mem) return s;
    const isActive = s.id === inProgressId;
    const keepCachedEntries = !isActive && !(s.entries || []).length && (mem.entries || []).length > 0;
    return {
      ...s,
      currentExIdx: mem.currentExIdx ?? 0,
      cyclePos: mem.cyclePos ?? null,
      // for the active session, local entries/restStart are authoritative
      ...(isActive ? { entries: mem.entries, restStart: mem.restStart ?? null } : {}),
      ...(keepCachedEntries ? { entries: mem.entries } : {}),
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
  const activeExists = !!(inProgressId && (
    serverIds.has(inProgressId) ||
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

// Returns { kg, reps } suggestion when all last sets hit top of rep range, null otherwise.
// refOverride: a pre-fetched { entry: { sets } } reference (fetchSeedEntries) —
// used when the exercise's recent history lives outside the boot window.
function progressionSuggestion(store, exId, dayId, plannedReps, plannedRepsPerSet, refOverride) {
  if (!store.settings?.smartProgression) return null;
  const ex = findExercise(store, exId);
  const catCfg = ex?.equipment ? (store.settings?.equipmentConfig?.[ex.equipment] ?? {}) : {};
  const increment = catCfg.increment ?? 2.5;
  const maxKg = catCfg.maxKg ?? null;

  // Anchor on the best recent performance at the current weight, not just the
  // last session — so a weak week doesn't block an earned weight jump.
  const ref = refOverride ?? bestRecentEntry(store, exId, dayId);
  if (!ref) return null;

  const range = store.settings?.progressionRangeTop ?? 4;
  const doneSets = (ref.entry.sets || []).filter(s => !s.skipped && !s.warmup && s.kg != null);
  if (!doneSets.length) return null;

  const allHitTop = doneSets.every((s, i) => {
    const perSet = plannedRepsPerSet && plannedRepsPerSet.length > 1
      ? (plannedRepsPerSet[i] ?? plannedRepsPerSet[plannedRepsPerSet.length - 1])
      : null;
    const baseReps = ex?.progression_reps ?? perSet ?? plannedReps;
    return (effReps(s) ?? 0) >= (baseReps ?? 0) + range;
  });
  if (!allHitTop) return null;

  const refKg = doneSets[0].kg;
  const newKg = Math.round((refKg + increment) * 100) / 100;
  const cappedKg = maxKg ? Math.min(newKg, maxKg) : newKg;
  if (cappedKg <= refKg) return null;

  const baseRepsFirst = ex?.progression_reps ?? (plannedRepsPerSet?.[0] ?? plannedReps);
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

async function addCoachingNote(coachingId, type, entityId, entityName, body, authorId, threadId = null) {
  const id = 'cnote_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const { error } = await _supabase.from('zane_coaching_notes').insert({
    id, coaching_id: coachingId, author_id: authorId,
    type, entity_id: entityId || null, entity_name: entityName || null, body,
    thread_id: threadId || null,
  });
  if (error) throw error;
  // Fire-and-forget push to the other party (fails silently if push not enabled).
  // Skip for self-coaching — there's no "other party" to notify. The author is
  // derived server-side from the JWT, so it can't be spoofed.
  if (!coachingId.startsWith('self_')) {
    fnFetch(COACHING_NOTIFY_URL, { coachingId, threadId, preview: body });
  }
  return id;
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
  const daysSinceSunday = today.getDay(); // 0=Sun, 1=Mon, …, 6=Sat
  const lastSunday = new Date(today);
  lastSunday.setDate(today.getDate() - daysSinceSunday);
  const monday = new Date(lastSunday);
  monday.setDate(lastSunday.getDate() - 6);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
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
  // Clear all per-client overrides so every client falls back to the new default
  const { error: e2 } = await _supabase.from('zane_coaching')
    .update({ checkin_schema: null })
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

// Aggregate cardio logs for a given week (weekStart = 'YYYY-MM-DD' Monday).
// Returns { cardioMinutes, cardioDistanceM, paceFeeling, effort, count } or null.
function cardioWeekPrefill(cardioLogs, weekStart, unit) {
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
    const distUnit = unit === 'lbs' ? 1609.344 : 1000;
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

// Whether a date counts as a training day for health indicators. A day with a
// logged (performed) session always counts. Otherwise a PLANNED training day
// counts only while it's still today or in the future — a past planned day that
// wasn't performed is downgraded to a rest day ("you have to earn it").
function isTrainingDayForDate(state, dateStr) {
  const ds = (dateStr || '').slice(0, 10);
  if (isLoggedTrainingDay(state?.sessions, ds)) return true;
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
  await _supabase.from('zane_status_periods').update({ ended_at: new Date().toISOString() }).eq('user_id', userId).is('ended_at', null);
  await _supabase.from('zane_status_periods').insert({ id: uid(), user_id: userId, mode, started_at: startedAt });
}

async function closeStatusPeriod(userId, endedAt = null) {
  await _supabase.from('zane_status_periods').update({ ended_at: endedAt || new Date().toISOString() }).eq('user_id', userId).is('ended_at', null);
}

async function updateStatusPeriodStart(userId, startedAt) {
  await _supabase.from('zane_status_periods').update({ started_at: startedAt }).eq('user_id', userId).is('ended_at', null);
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
    if (shouldDelete) await _supabase.from('zane_status_periods').delete().eq('user_id', userId).is('ended_at', null);
    else await closeStatusPeriod(userId, closedAt);
  } catch (_) {}
}

async function refreshHealthLogs(userId) {
  const [dailyRes, cardioRes] = await Promise.all([
    _supabase.from('zane_daily_logs').select('id, date, weight, steps, calories, protein, carbs, fat, fiber, water_ml, note, off_plan_note, adherence, targets_snap, daily_coach_fields, created_at').eq('user_id', userId).order('date', { ascending: false }),
    _supabase.from('zane_cardio_logs').select('id, date, type, duration_minutes, distance_m, pace_feeling, effort, note, session_id, created_at').eq('user_id', userId).order('date', { ascending: false }),
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
      createdAt: l.created_at,
    })),
    cardioLogs: (cardioRes.data || []).map(l => ({
      id: l.id, date: l.date, type: l.type ?? null,
      durationMinutes: l.duration_minutes, distanceM: l.distance_m ?? null,
      paceFeeling: l.pace_feeling ?? null, effort: l.effort ?? null,
      note: l.note ?? null, sessionId: l.session_id ?? null, createdAt: l.created_at,
    })),
  };
}

window.LB = {
  supabase: _supabase,
  SUPABASE_URL, SUPABASE_ANON_KEY, PUSHOVER_URL, WEB_PUSH_URL, fnFetch,
  subscribeWebPush, unsubscribeWebPush, getWebPushSubscription,
  QS_EMAILS, hasQuickSwitchSession, quickSwitch, saveQsName, getQsName,
  signIn, signUp, signOut, signInWithPasskey, registerPasskey, listPasskeys, deletePasskey, resetPassword, deleteAllData, exportBackup, importFromBackup, validateBackup,
  loadFromSupabase, syncStore, mergeSessions, historyWindowCutoffISO,
  saveToLocal, loadFromLocal, saveBase, loadBase, clearLocal,
  uid, todayISO, parseDate, isoWd, weekEnd, findExercise, lastSessionForExercise, recentSessionsForExercise, bestRecentEntry, progressionSuggestion, todaysDay, nextDay, isWeekdayPlan, isFlexPlan, getPlanDaysForDate, getCyclePosForDate, getCycleNumForDate, getActiveVersionIdx, dedupeVersionsByDate,
  effReps, e1rm, isImprovement, isDecline, bestE1rmForExercise, totalVolume, doneSetCount, buildSeedSets, latestBodyweight, inferCurrentExIdx, calcBlended,
  refreshExerciseBests, fetchSeedEntries, fetchExerciseHistory, fetchSessionEntries,
  computeNextTrainingDate, computeNextReminderAt,
  cancelPushover,
  subscribeToChanges,
  openStatusPeriod, closeStatusPeriod, updateStatusPeriodStart, clearStatusMode,
  loadClientStore, loadCoachClientsStatus, reloadCoachingState, enableSelfCoaching, inviteClient, respondToCoachingInvite, endCoaching,
  addCoachingNote, markCoachingNotesRead, loadCoachingNotes, loadCoachingThreads, createCoachingThread, deleteCoachingThread, getOrCreateCoachingThread,
  loadCoachingMacros, addCoachingMacros,
  diffSchedule,
  checkinWeekStart, submitCheckin, loadCheckins, deleteCheckin, loadCoachCheckinStatus, requestCheckin, setCheckinEnabled, loadCheckinSchema, saveCheckinSchema, saveDefaultCheckinSchema,
  cardioWeekPrefill, detectCardioPRs,
  isLoggedTrainingDay, plannedTrainingDay, isTrainingDayForDate, dayTargetFromMacros, macroAdherence, effectiveMacroTargets, dailyLogAdherence, dailyLogsWeekPrefill, weekPerformanceSignal,
  refreshHealthLogs,
};
