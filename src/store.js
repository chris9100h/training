/* Logbook store — Supabase backend */

const SUPABASE_URL = 'https://ebbuvdzgstrhrcsbrlez.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';

const PUSHOVER_URL          = `${SUPABASE_URL}/functions/v1/pushover`;
const COACHING_NOTIFY_URL   = `${SUPABASE_URL}/functions/v1/zane_coaching-notify`;

const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
function todayISO() { return new Date().toISOString().slice(0, 10); }

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

async function signUp(email, password, name) {
  const { data, error } = await _supabase.auth.signUp({
    email, password,
    options: { data: { name } },   // store name in user_metadata for email-confirm flow
  });
  if (error) throw error;
  if (data.session) {
    // email confirmation disabled — user is immediately logged in
    await setupNewUser(data.user.id, name);
  }
  // if no session: email confirmation required, setupNewUser runs on first loadFromSupabase
  return data;
}

async function signOut() {
  await _supabase.auth.signOut();
}

async function deleteAllData(userId) {
  await Promise.all([
    _supabase.from('zane_sessions').delete().eq('user_id', userId),
    _supabase.from('zane_exercises').delete().eq('user_id', userId),
    _supabase.from('zane_schedules').delete().eq('user_id', userId),
    _supabase.from('zane_user_settings').delete().eq('user_id', userId),
    _supabase.from('zane_profiles').delete().eq('id', userId),
    _supabase.from('zane_skips').delete().eq('user_id', userId),
  ]);
}

async function createSkip(userId, { id, date, dayId, dayName, skipReason }) {
  const { error } = await _supabase.from('zane_skips').insert({
    id, user_id: userId, date, day_id: dayId, day_name: dayName, skip_reason: skipReason,
  });
  if (error) throw error;
}

async function updateSkipReason(id, skipReason) {
  const { error } = await _supabase.from('zane_skips').update({ skip_reason: skipReason }).eq('id', id);
  if (error) throw error;
}

async function deleteSkip(id) {
  const { error } = await _supabase.from('zane_skips').delete().eq('id', id);
  if (error) throw error;
}

async function importFromBackup(backup, userId) {
  await deleteAllData(userId);
  const sett = backup.settings ?? {};
  const importSessions = backup.sessions?.filter(s => s.id) ?? [];
  await Promise.all([
    backup.user?.name && _supabase.from('zane_profiles').upsert({ id: userId, name: backup.user.name }),
    backup.exercises?.length && _supabase.from('zane_exercises').upsert(
      backup.exercises.map(e => ({ id: e.id, name: e.name, tags: e.tags ?? [], note: e.note ?? '', category: e.category ?? null, unilateral: e.unilateral ?? false, equipment: e.equipment ?? null, progression_reps: e.progression_reps ?? null, user_id: userId }))
    ),
    backup.schedules?.length && _supabase.from('zane_schedules').upsert(
      backup.schedules.map(({ mode, ...s }) => ({ ...s, user_id: userId }))
    ),
    importSessions.length && _supabase.from('zane_sessions').upsert(
      importSessions.map(s => sessionToRow(s, userId))
    ),
    _supabase.from('zane_user_settings').upsert({
      user_id: userId,
      active_schedule_id: backup.activeScheduleId ?? null,
      cycle_index: backup.cycleIndex ?? 0,
      cycle_start_date: backup.cycleStartDate ?? null,
      last_advanced_date: backup.lastAdvancedDate ?? null,
      in_progress_session_id: backup.inProgress ?? null,
      unit: sett.unit || 'kg',
      rest_default: sett.restDefault || 120,
      rest_big: sett.restBig || 180,
      rest_medium: sett.restMedium || 120,
      rest_small: sett.restSmall || 90,
      push_enabled: sett.pushEnabled ?? false,
      pushover_user_key: sett.pushoverUserKey ?? null,
      cycle_week_view: sett.cycleWeekView ?? false,
      accent_color: sett.accentColor ?? 'copper',
      dark_mode: sett.darkMode ?? 'dark',
      custom_day_types: backup.customDayTypes ?? [],
      reminder_enabled: sett.reminderEnabled ?? false,
      reminder_time: sett.reminderTime ?? '07:00',
    }),
  ].filter(Boolean));
  // Entries then sets after sessions are committed (FK order: sessions → entries → sets)
  if (importSessions.length) await _syncEntryRelational(importSessions, userId, null);
}

// ─── SETUP NEW USER ──────────────────────────────────────────────────────

async function setupNewUser(userId, name) {
  await Promise.all([
    _supabase.from('zane_profiles').upsert({ id: userId, name }),
    _supabase.from('zane_user_settings').upsert({ user_id: userId, unit: 'kg', rest_default: 120 }),
  ]);
}

// ─── LOAD ────────────────────────────────────────────────────────────────

async function loadFromSupabase(userId, _depth = 0, _opts = {}) {
  const isCoachLoad = !!_opts.coachLoad;
  const queries = [
    _supabase.from('zane_profiles').select('id, name, approved').eq('id', userId).maybeSingle(),
    _supabase.from('zane_exercises').select('id, name, tags, note, category, unilateral, equipment, progression_reps').eq('user_id', userId),
    _supabase.from('zane_schedules').select('id, name, days, archived, versions').eq('user_id', userId),
    _supabase.from('zane_sessions').select('id, schedule_id, day_id, day_name, date, started_at, ended, entries, duration_minutes, feel')
      .eq('user_id', userId).order('date', { ascending: false }),
    _supabase.from('zane_user_settings').select('*').eq('user_id', userId).maybeSingle(),
    _supabase.from('zane_skips').select('id, date, day_id, day_name, skip_reason, skipped_at').eq('user_id', userId),
    _supabase.from('zane_session_entries')
      .select('*, sets:zane_sets(*)')
      .eq('user_id', userId)
      .order('entry_idx'),
    // Coaching data — only for own store load, not when a coach loads a client
    isCoachLoad ? null : _supabase.rpc('get_coach_info'),
    isCoachLoad ? null : _supabase.rpc('get_coaching_clients'),
    isCoachLoad ? null : _supabase.from('zane_coaching_notes')
      .select('id, coaching_id, author_id, type, entity_id, entity_name, body, created_at, thread_id')
      .is('read_at', null)
      .neq('author_id', userId),
    // Real coaching row (for check-in requests) — exclude the self-coaching row
    // so maybeSingle() never trips when both a real coach and self-coaching exist.
    isCoachLoad ? null : _supabase.from('zane_coaching').select('id, checkin_requested_at, checkin_enabled').eq('client_id', userId).eq('status', 'active').neq('coach_id', userId).maybeSingle(),
    // Self-coaching row (coach_id = client_id), if the user is their own coach
    isCoachLoad ? null : _supabase.from('zane_coaching').select('id').eq('coach_id', userId).eq('client_id', userId).eq('status', 'active').maybeSingle(),
  ];
  const [profileRes, exRes, schRes, sessRes, settRes, skipsRes, entriesRes,
         coachInfoRes, coachClientsRes, unreadNotesRes, coachingRowRes, selfRowRes] = await Promise.all(queries);

  // A failed request (offline, RLS, server error) also yields no data — bail
  // out so the caller can surface an error instead of mistaking this for a
  // new user and re-seeding starter data over an existing account.
  if (profileRes.error) throw profileRes.error;

  // First login after email confirmation — profile not yet created (skip for coach loads)
  if (!profileRes.data && !isCoachLoad) {
    // guard against infinite recursion if setupNewUser silently fails (e.g. RLS)
    if (_depth > 0) throw new Error('User profile setup failed');
    const { data: { user } } = await _supabase.auth.getUser();
    const name = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Athlete';
    try {
      await setupNewUser(userId, name);
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

  const result = {
    user: { name: profileRes.data?.name || '', email: isCoachLoad ? '' : (authUser?.email || ''), approved: profileRes.data?.approved ?? false },
    exercises: exRes.data || [],
    schedules: schRes.data || [],
    // map snake_case DB columns → camelCase store fields
    sessions: (sessRes.data || []).map(s => {
      const entryRows = entriesBySession[s.id];
      const entries = entryRows && entryRows.length > 0
        ? entryRows.map(e => ({
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
          }))
        : s.entries; // JSONB fallback for sessions that predate the migration
      return {
        id: s.id,
        scheduleId: s.schedule_id,
        dayId: s.day_id,
        dayName: s.day_name,
        date: s.date,
        startedAt: s.started_at ?? null,
        ended: s.ended,
        entries,
        durationMinutes: s.duration_minutes ?? null,
        feel: s.feel ?? null,
      };
    }),
    skips: (skipsRes.data || []).map(s => ({
      id: s.id, date: s.date, dayId: s.day_id, dayName: s.day_name,
      skipReason: s.skip_reason, skippedAt: s.skipped_at,
    })),
    activeScheduleId: sett.active_schedule_id ?? null,
    cycleIndex: sett.cycle_index ?? 0,
    cycleStartDate: sett.cycle_start_date ?? null,
    weekPlanStartDate: sett.week_plan_start_date ?? null,
    lastAdvancedDate: sett.last_advanced_date ?? null,
    inProgress: sett.in_progress_session_id ?? null,
    customDayTypes: sett.custom_day_types ?? [],
    settings: {
        unit: sett.unit || 'kg',
        restDefault: sett.rest_default || 120,
        restBig:     sett.rest_big     || 180,
        restMedium:  sett.rest_medium  || 120,
        restSmall:   sett.rest_small   || 90,
        pushEnabled: sett.push_enabled ?? false,
        pushoverUserKey: sett.pushover_user_key ?? null,
        cycleWeekView: sett.cycle_week_view ?? false,
        accentColor: sett.accent_color ?? 'copper',
        darkMode: sett.dark_mode ?? 'dark',
        tempoEnabled: sett.tempo_enabled ?? false,
        tempoEccentric: sett.tempo_eccentric ?? 4,
        tempoConcentric: sett.tempo_concentric ?? 1,
        smartProgression: sett.smart_progression ?? false,
        progressionRangeTop: sett.progression_range_top ?? 4,
        equipmentConfig: sett.equipment_config ?? {},
        reminderEnabled: sett.reminder_enabled ?? false,
        reminderTime: sett.reminder_time ?? '07:00',
        showWarmupInSummary: sett.show_warmup_in_summary ?? true,
        showCoachingTab: sett.show_coaching_tab ?? false,
        beYourOwnCoach: sett.be_your_own_coach ?? false,
        sessionTimeoutMinutes: sett.session_timeout_minutes ?? 90,
      },
    nextReminderAt: sett.next_reminder_at ?? null,
    autoCloseNotify: sett.auto_close_notify ?? null,
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
      const wd = d.getDay() === 0 ? 6 : d.getDay() - 1;
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
    await _supabase.from('zane_session_entries').upsert(allEntries, { onConflict: 'id' });
  }
  if (allSets.length) {
    await _supabase.rpc('sync_sets_batch', { p_sets: allSets });
  }
}

function sessionToRow(s, userId) {
  // eslint-disable-next-line no-unused-vars
  const { currentExIdx, cyclePos, restStart, restDuration, scheduleId, dayId, dayName, startedAt, durationMinutes, feel, ...rest } = s;
  const row = { ...rest, schedule_id: scheduleId, day_id: dayId, day_name: dayName, user_id: userId };
  if (startedAt != null) row.started_at = startedAt;
  if (durationMinutes != null) row.duration_minutes = durationMinutes;
  row.feel = feel ?? null;
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
    if (upsert.length)  ops.push(_supabase.from('zane_exercises').upsert(upsert.map(e => ({ id: e.id, name: e.name, tags: e.tags ?? [], note: e.note ?? '', category: e.category ?? null, unilateral: e.unilateral ?? false, equipment: e.equipment ?? null, progression_reps: e.progression_reps ?? null, user_id: userId }))));
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
      // Only sync relational tables for sessions that already existed in prev —
      // filters out initial load (prev.sessions empty) and session creation events.
      // On the first real set change, the session will be in prev and gets written.
      sessionUpserts = upsert.filter(s => prev.sessions?.find(x => x.id === s.id));
    }
    if (removed.length) ops.push(_supabase.from('zane_sessions').delete().in('id', removed.map(s => s.id)));
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
    prev.settings?.cycleWeekView   !== next.settings?.cycleWeekView   ||
    prev.settings?.accentColor      !== next.settings?.accentColor      ||
    prev.settings?.darkMode         !== next.settings?.darkMode          ||
    prev.settings?.tempoEnabled       !== next.settings?.tempoEnabled       ||
    prev.settings?.tempoEccentric     !== next.settings?.tempoEccentric     ||
    prev.settings?.tempoConcentric    !== next.settings?.tempoConcentric    ||
    prev.settings?.smartProgression   !== next.settings?.smartProgression   ||
    prev.settings?.progressionRangeTop !== next.settings?.progressionRangeTop ||
    JSON.stringify(prev.settings?.equipmentConfig) !== JSON.stringify(next.settings?.equipmentConfig) ||
    JSON.stringify(prev.customDayTypes) !== JSON.stringify(next.customDayTypes) ||
    prev.settings?.reminderEnabled      !== next.settings?.reminderEnabled      ||
    prev.settings?.reminderTime         !== next.settings?.reminderTime         ||
    prev.settings?.showWarmupInSummary  !== next.settings?.showWarmupInSummary  ||
    prev.settings?.showCoachingTab      !== next.settings?.showCoachingTab      ||
    prev.settings?.beYourOwnCoach         !== next.settings?.beYourOwnCoach         ||
    prev.settings?.sessionTimeoutMinutes  !== next.settings?.sessionTimeoutMinutes  ||
    prev.nextReminderAt                   !== next.nextReminderAt;

  if (settingsChanged) {
    ops.push(_supabase.from('zane_user_settings').upsert({
      user_id: userId,
      active_schedule_id: next.activeScheduleId ?? null,
      cycle_index: next.cycleIndex ?? 0,
      cycle_start_date: next.cycleStartDate ?? null,
      week_plan_start_date: next.weekPlanStartDate ?? null,
      last_advanced_date: next.lastAdvancedDate ?? null,
      unit: next.settings?.unit || 'kg',
      rest_default: next.settings?.restDefault || 120,
      rest_big:     next.settings?.restBig     || 180,
      rest_medium:  next.settings?.restMedium  || 120,
      rest_small:   next.settings?.restSmall   || 90,
      push_enabled: next.settings?.pushEnabled ?? false,
      pushover_user_key: next.settings?.pushoverUserKey ?? null,
      cycle_week_view: next.settings?.cycleWeekView ?? false,
      accent_color: next.settings?.accentColor ?? 'copper',
      dark_mode: next.settings?.darkMode ?? 'dark',
      tempo_enabled: next.settings?.tempoEnabled ?? false,
      tempo_eccentric: next.settings?.tempoEccentric ?? 4,
      tempo_concentric: next.settings?.tempoConcentric ?? 1,
      smart_progression: next.settings?.smartProgression ?? false,
      progression_range_top: next.settings?.progressionRangeTop ?? 4,
      equipment_config: next.settings?.equipmentConfig ?? {},
      custom_day_types: next.customDayTypes ?? [],
      reminder_enabled: next.settings?.reminderEnabled ?? false,
      reminder_time: next.settings?.reminderTime ?? '07:00',
      show_warmup_in_summary: next.settings?.showWarmupInSummary ?? true,
      show_coaching_tab: next.settings?.showCoachingTab ?? false,
      be_your_own_coach: next.settings?.beYourOwnCoach ?? false,
      session_timeout_minutes: next.settings?.sessionTimeoutMinutes ?? 90,
      next_reminder_at: computeNextReminderAt(next),
      in_progress_session_id: next.inProgress ?? null,
    }));
  }

  await Promise.all(ops);
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
      const wd = d.getDay() === 0 ? 6 : d.getDay() - 1;
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
      const wd = d.getDay() === 0 ? 6 : d.getDay() - 1;
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
  fetch(PUSHOVER_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce: `cancel-${Date.now()}`, cancel: true, userKey: settings?.pushoverUserKey ?? '', userId }),
  }).catch(() => {});
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

// Total volume (kg) of all completed working sets in a session (warm-ups excluded).
// For ended sessions we don't require done:true — a kbApply race can leave sets as
// done:false in Supabase even though the user actually performed them.
function totalVolume(session) {
  const ended = !!session.ended;
  return (session.entries || []).reduce((sum, ex) =>
    sum + (ex.sets || []).filter(st => {
      if (st.warmup || st.skipped) return false;
      if (ended) return st.kg != null && (st.reps != null || st.repsL != null || st.repsR != null);
      return st.done;
    }).reduce((s, st) => {
      const reps = effReps(st) ?? 0;
      return s + (+st.kg || 0) * reps;
    }, 0), 0
  );
}

// Count of completed working sets in a session (warm-ups excluded).
function doneSetCount(session) {
  const ended = !!session.ended;
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

// Compute the seed-sets array when starting/logging a session for a planned item.
// Honors smart-progression suggestions and falls back to last-session values.
function buildSeedSets(it, last, suggestion, isUni, smartProgression) {
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
        ? { kg: prev.kg ?? null, repsL: prev.repsL != null ? prev.repsL + 1 : null, repsR: prev.repsR != null ? prev.repsR + 1 : null, done: false }
        : { kg: prev.kg ?? null, reps: prev.reps != null ? prev.reps + 1 : null, done: false };
    }
    if (!prev && targetReps != null) {
      return isUni
        ? { kg: null, repsL: targetReps, repsR: targetReps, done: false }
        : { kg: null, reps: targetReps, done: false };
    }
    return isUni
      ? { kg: prev?.kg ?? null, repsL: prev?.repsL ?? null, repsR: prev?.repsR ?? null, done: false }
      : { kg: prev?.kg ?? null, reps: prev?.reps ?? null, done: false };
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

function isWeekdayPlan(sch) {
  return sch.mode === 'weekday' || (sch.days.length > 0 && sch.days.some(d => d.weekday != null));
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

// ─── LOCAL CACHE ─────────────────────────────────────────────────────

function saveToLocal(store, userId) {
  try {
    localStorage.setItem(`logbook-${userId}`, JSON.stringify(store));
  } catch (_) {}
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
  } catch (_) {}
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'zane_coaching', filter: `client_id=eq.${userId}` }, () => {
      onCoachingInvite?.();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'zane_coaching', filter: `coach_id=eq.${userId}` }, () => {
      onCoachingInvite?.();
    })
    .subscribe();
  return () => { _supabase.removeChannel(_realtimeChannel); _realtimeChannel = null; };
}

// Returns { kg, reps } suggestion when all last sets hit top of rep range, null otherwise.
function progressionSuggestion(store, exId, dayId, plannedReps, plannedRepsPerSet) {
  if (!store.settings?.smartProgression) return null;
  const ex = findExercise(store, exId);
  const catCfg = ex?.equipment ? (store.settings?.equipmentConfig?.[ex.equipment] ?? {}) : {};
  const increment = catCfg.increment ?? 2.5;
  const maxKg = catCfg.maxKg ?? null;

  const last = lastSessionForExercise(store, exId, dayId);
  if (!last) return null;

  const range = store.settings?.progressionRangeTop ?? 4;
  const doneSets = (last.entry.sets || []).filter(s => !s.skipped && !s.warmup && s.kg != null);
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
  return (data || []).map(r => ({ clientId: r.client_id, inProgressSessionId: r.in_progress_session_id }));
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
  const exAdded = [], exRemoved = [];
  for (const afterDay of shared) {
    const beforeDay = beforeById[afterDay.id];
    const bKeys = new Set((beforeDay.items || []).map(i => i.exId).filter(Boolean));
    const aKeys = new Set((afterDay.items  || []).map(i => i.exId).filter(Boolean));
    (afterDay.items  || []).filter(i => i.exId && !bKeys.has(i.exId)).forEach(i => exAdded.push(`${exName(i.exId)} (${afterDay.name})`));
    (beforeDay.items || []).filter(i => i.exId && !aKeys.has(i.exId)).forEach(i => exRemoved.push(`${exName(i.exId)} (${beforeDay.name})`));
  }
  if (exAdded.length)   lines.push(`Exercises added: ${exAdded.join(', ')}`);
  if (exRemoved.length) lines.push(`Exercises removed: ${exRemoved.join(', ')}`);
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
  // Skip for self-coaching — there's no "other party" to notify.
  if (!coachingId.startsWith('self_')) {
    fetch(COACHING_NOTIFY_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coachingId, authorId, threadId, preview: body }),
    }).catch(() => {});
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
  return (data || []).map(r => ({ coachingId: r.coaching_id, hasCheckin: r.has_checkin }));
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

async function submitCheckin(coachingId, clientId, data, userId, weekStartArg = null, isEdit = false) {
  const weekStart = weekStartArg || checkinWeekStart();
  const id = 'ci_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const row = {
    id,
    coaching_id: coachingId,
    client_id: clientId,
    week_start: weekStart,
    checked_in_at: new Date().toISOString(),
    weight_today: data.weightToday ?? null,
    weight_avg_last_week: data.weightAvgLastWeek ?? null,
    off_plan_notes: data.offPlanNotes || null,
    hydration_ml: data.hydrationMl ?? null,
    days_trained: data.daysTrained ?? null,
    steps: data.steps ?? null,
    cardio_minutes: data.cardioMinutes ?? null,
    cardio_distance_m: data.cardioDistanceM ?? null,
    cardio_pace_feeling: data.cardioPaceFeeling ?? null,
    cardio_effort: data.cardioEffort ?? null,
    performance_vs_last_week: data.performanceVsLastWeek || null,
    goal_note: data.goalNote || null,
    hunger: data.hunger ?? null,
    sleep_quality: data.sleepQuality ?? null,
    life_stress: data.lifeStress ?? null,
    work_stress: data.workStress ?? null,
    tiredness: data.tiredness ?? null,
    issues_notes: data.issuesNotes || null,
    general_note: data.generalNote || null,
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
    // Weight
    const wLines = [];
    const wUnit = (typeof window !== 'undefined' && window.__UNIT) || 'kg';
    if (data.weightToday != null) wLines.push(`Weight: ${data.weightToday} ${wUnit}`);
    if (data.weightAvgLastWeek != null) wLines.push(`Avg last week: ${data.weightAvgLastWeek} ${wUnit}`);
    if (wLines.length) lines.push('', ...wLines);
    // Training
    const tLines = [];
    if (data.daysTrained != null) tLines.push(`Training: ${data.daysTrained} days`);
    if (data.performanceVsLastWeek) tLines.push(`Performance: ${data.performanceVsLastWeek}`);
    if (tLines.length) lines.push('', ...tLines);
    // Cardio
    const cLines = [];
    if (data.steps != null) cLines.push(`Steps: ${Number(data.steps).toLocaleString()}`);
    if (data.cardioMinutes != null) {
      const dist = data.cardioDistanceM != null ? ` · ${(data.cardioDistanceM / 1000).toFixed(1)} km` : '';
      cLines.push(`Cardio: ${data.cardioMinutes} min${dist}`);
    }
    if (data.cardioPaceFeeling != null) cLines.push(`Pace: ${data.cardioPaceFeeling}/6`);
    if (data.cardioEffort != null) cLines.push(`Effort: ${data.cardioEffort}/10`);
    if (cLines.length) lines.push('', ...cLines);
    // Markers
    const mLines = [];
    if (data.hunger != null) mLines.push(`  Hunger: ${data.hunger}/10`);
    if (data.sleepQuality != null) mLines.push(`  Sleep: ${data.sleepQuality}/10`);
    if (data.lifeStress != null) mLines.push(`  Life stress: ${data.lifeStress}/10`);
    if (data.workStress != null) mLines.push(`  Work stress: ${data.workStress}/10`);
    if (data.tiredness != null) mLines.push(`  Tiredness: ${data.tiredness}/10`);
    if (mLines.length) lines.push('', 'Markers:', ...mLines);
    // Bottom block — no blank lines between items
    const bLines = [];
    if (data.hydrationMl != null) bLines.push(`Hydration: ${(data.hydrationMl / 1000).toFixed(1)} L/day`);
    if (data.offPlanNotes) bLines.push(`Off-plan: ${data.offPlanNotes}`);
    if (data.goalNote) bLines.push(`Goal: ${data.goalNote}`);
    if (data.issuesNotes) bLines.push(`Issues: ${data.issuesNotes}`);
    if (data.generalNote) bLines.push(`General: ${data.generalNote}`);
    if (bLines.length) lines.push('', ...bLines);
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
  return (data || []).map(r => ({
    id: r.id, coachingId: r.coaching_id, clientId: r.client_id,
    weekStart: r.week_start, checkedInAt: r.checked_in_at,
    weightToday: r.weight_today, weightAvgLastWeek: r.weight_avg_last_week,
    offPlanNotes: r.off_plan_notes, hydrationMl: r.hydration_ml,
    daysTrained: r.days_trained, steps: r.steps,
    cardioMinutes: r.cardio_minutes, cardioDistanceM: r.cardio_distance_m,
    cardioPaceFeeling: r.cardio_pace_feeling, cardioEffort: r.cardio_effort,
    performanceVsLastWeek: r.performance_vs_last_week,
    goalNote: r.goal_note,
    hunger: r.hunger, sleepQuality: r.sleep_quality,
    lifeStress: r.life_stress, workStress: r.work_stress, tiredness: r.tiredness,
    issuesNotes: r.issues_notes, generalNote: r.general_note,
  }));
}

async function deleteCheckin(checkinId, userId) {
  const { error } = await _supabase
    .from('zane_checkins')
    .delete()
    .eq('id', checkinId)
    .eq('client_id', userId);
  if (error) throw error;
}

window.LB = {
  supabase: _supabase,
  SUPABASE_URL, SUPABASE_ANON_KEY, PUSHOVER_URL,
  QS_EMAILS, hasQuickSwitchSession, quickSwitch, saveQsName, getQsName,
  signIn, signUp, signOut, deleteAllData, importFromBackup,
  loadFromSupabase, syncStore,
  saveToLocal, loadFromLocal, saveBase, loadBase, clearLocal,
  uid, todayISO, parseDate, findExercise, lastSessionForExercise, progressionSuggestion, todaysDay, nextDay, isWeekdayPlan, getPlanDaysForDate, getCyclePosForDate, getCycleNumForDate,
  effReps, e1rm, totalVolume, doneSetCount, buildSeedSets, inferCurrentExIdx, calcBlended,
  computeNextTrainingDate, computeNextReminderAt,
  cancelPushover, createSkip, updateSkipReason, deleteSkip,
  subscribeToChanges,
  loadClientStore, loadCoachClientsStatus, reloadCoachingState, enableSelfCoaching, inviteClient, respondToCoachingInvite, endCoaching,
  addCoachingNote, markCoachingNotesRead, loadCoachingNotes, loadCoachingThreads, createCoachingThread, deleteCoachingThread, getOrCreateCoachingThread,
  loadCoachingMacros, addCoachingMacros,
  diffSchedule,
  checkinWeekStart, submitCheckin, loadCheckins, deleteCheckin, loadCoachCheckinStatus, requestCheckin, setCheckinEnabled,
};
