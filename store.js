/* Logbook store — Supabase backend */

const SUPABASE_URL = 'https://ebbuvdzgstrhrcsbrlez.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYnV2ZHpnc3RyaHJjc2JybGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjc4ODAsImV4cCI6MjA5MTYwMzg4MH0.RyTzHiqV1TPSZtM7lgenBJbUCTjj5fCUhoWauifjlIE';

const PUSHOVER_URL = `${SUPABASE_URL}/functions/v1/pushover`;

const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
function todayISO() { return new Date().toISOString().slice(0, 10); }

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
    _supabase.from('sessions').delete().eq('user_id', userId),
    _supabase.from('exercises').delete().eq('user_id', userId),
    _supabase.from('schedules').delete().eq('user_id', userId),
    _supabase.from('user_settings').delete().eq('user_id', userId),
    _supabase.from('profiles').delete().eq('id', userId),
  ]);
}

async function importFromBackup(backup, userId) {
  await deleteAllData(userId);
  const sett = backup.settings ?? {};
  await Promise.all([
    backup.user?.name && _supabase.from('profiles').upsert({ id: userId, name: backup.user.name }),
    backup.exercises?.length && _supabase.from('exercises').upsert(
      backup.exercises.map(e => ({ id: e.id, name: e.name, tags: e.tags ?? [], note: e.note ?? '', category: e.category ?? null, unilateral: e.unilateral ?? false, user_id: userId }))
    ),
    backup.schedules?.length && _supabase.from('schedules').upsert(
      backup.schedules.map(({ mode, ...s }) => ({ ...s, user_id: userId }))
    ),
    backup.sessions?.length && _supabase.from('sessions').upsert(
      backup.sessions.filter(s => s.id).map(s => {
        const { currentExIdx, cyclePos, restStart, restDuration, scheduleId, dayId, dayName, startedAt, ...rest } = s;
        const row = { ...rest, schedule_id: scheduleId, day_id: dayId, day_name: dayName, user_id: userId };
        if (startedAt != null) row.started_at = startedAt;
        return row;
      })
    ),
    _supabase.from('user_settings').upsert({
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
    }),
  ].filter(Boolean));
}

// ─── SETUP NEW USER ──────────────────────────────────────────────────────

async function setupNewUser(userId, name) {
  const seeded = seedStarter({
    user: { name }, exercises: [], schedules: [], sessions: [],
    activeScheduleId: null, cycleIndex: 0, lastAdvancedDate: null,
    inProgress: null, customDayTypes: [], settings: { unit: 'kg', restDefault: 120 },
  });
  await Promise.all([
    _supabase.from('profiles').upsert({ id: userId, name }),
    _supabase.from('exercises').insert(seeded.exercises.map(e => ({ ...e, user_id: userId }))),
    _supabase.from('schedules').insert(seeded.schedules.map(s => ({ ...s, user_id: userId }))),
    _supabase.from('user_settings').upsert({
      user_id: userId,
      active_schedule_id: seeded.activeScheduleId,
      cycle_index: 0, unit: 'kg', rest_default: 120,
    }),
  ]);
}

// ─── LOAD ────────────────────────────────────────────────────────────────

async function loadFromSupabase(userId, _depth = 0) {
  const [profileRes, exRes, schRes, sessRes, settRes] = await Promise.all([
    _supabase.from('profiles').select('id, name').eq('id', userId).maybeSingle(),
    _supabase.from('exercises').select('id, name, tags, note, category, unilateral').eq('user_id', userId),
    _supabase.from('schedules').select('id, name, days').eq('user_id', userId),
    _supabase.from('sessions').select('id, schedule_id, day_id, day_name, date, started_at, ended, entries')
      .eq('user_id', userId).order('date', { ascending: false }),
    _supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
  ]);

  // A failed request (offline, RLS, server error) also yields no data — bail
  // out so the caller can surface an error instead of mistaking this for a
  // new user and re-seeding starter data over an existing account.
  if (profileRes.error) throw profileRes.error;

  // First login after email confirmation — profile not yet created
  if (!profileRes.data) {
    // guard against infinite recursion if setupNewUser silently fails (e.g. RLS)
    if (_depth > 0) throw new Error('User profile setup failed');
    const { data: { user } } = await _supabase.auth.getUser();
    const name = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Athlete';
    await setupNewUser(userId, name);
    return loadFromSupabase(userId, _depth + 1);
  }

  const sett = settRes.data || {};

  const { data: { user: authUser } } = await _supabase.auth.getUser();

  return {
    user: { name: profileRes.data.name, email: authUser?.email || '' },
    exercises: exRes.data || [],
    schedules: schRes.data || [],
    // map snake_case DB columns → camelCase store fields
    sessions: (sessRes.data || []).map(s => ({
      id: s.id,
      scheduleId: s.schedule_id,
      dayId: s.day_id,
      dayName: s.day_name,
      date: s.date,
      startedAt: s.started_at ?? null,
      ended: s.ended,
      entries: s.entries,
    })),
    activeScheduleId: sett.active_schedule_id ?? null,
    cycleIndex: sett.cycle_index ?? 0,
    cycleStartDate: sett.cycle_start_date ?? null,
    lastAdvancedDate: sett.last_advanced_date ?? null,
    inProgress: sett.in_progress_session_id ?? null,
    customDayTypes: [],
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
      },
  };
}

// ─── SYNC ────────────────────────────────────────────────────────────────

function sessionToRow(s, userId) {
  // eslint-disable-next-line no-unused-vars
  const { currentExIdx, cyclePos, restStart, restDuration, scheduleId, dayId, dayName, startedAt, ...rest } = s;
  const row = { ...rest, schedule_id: scheduleId, day_id: dayId, day_name: dayName, user_id: userId };
  if (startedAt != null) row.started_at = startedAt;
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
    if (upsert.length)  ops.push(_supabase.from('exercises').upsert(upsert.map(e => ({ id: e.id, name: e.name, tags: e.tags ?? [], note: e.note ?? '', category: e.category ?? null, unilateral: e.unilateral ?? false, user_id: userId }))));
    if (removed.length) ops.push(_supabase.from('exercises').delete().in('id', removed.map(e => e.id)));
  }

  if (prev.schedules !== next.schedules) {
    const upsert = next.schedules.filter(s => {
      const p = prev.schedules.find(x => x.id === s.id);
      return !p || JSON.stringify(p) !== JSON.stringify(s);
    });
    const removed = prev.schedules.filter(s => !next.schedules.find(x => x.id === s.id));
    if (upsert.length)  ops.push(_supabase.from('schedules').upsert(upsert.map(({ mode, ...s }) => ({ ...s, user_id: userId }))));
    if (removed.length) ops.push(_supabase.from('schedules').delete().in('id', removed.map(s => s.id)));
  }

  if (prev.sessions !== next.sessions) {
    const upsert = next.sessions.filter(s => {
      const p = prev.sessions.find(x => x.id === s.id);
      return !p || JSON.stringify(p) !== JSON.stringify(s);
    });
    const removed = prev.sessions.filter(s => !next.sessions.find(x => x.id === s.id));
    if (upsert.length)  ops.push(_supabase.from('sessions').upsert(upsert.map(s => sessionToRow(s, userId))));
    if (removed.length) ops.push(_supabase.from('sessions').delete().in('id', removed.map(s => s.id)));
  }

  if (prev.user?.name !== next.user?.name && next.user?.name) {
    ops.push(_supabase.from('profiles').upsert({ id: userId, name: next.user.name }));
  }

  const settingsChanged =
    prev.activeScheduleId          !== next.activeScheduleId          ||
    prev.cycleIndex                !== next.cycleIndex                ||
    prev.cycleStartDate            !== next.cycleStartDate            ||
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
    prev.settings?.accentColor     !== next.settings?.accentColor     ||
    prev.settings?.darkMode        !== next.settings?.darkMode;

  if (settingsChanged) {
    ops.push(_supabase.from('user_settings').upsert({
      user_id: userId,
      active_schedule_id: next.activeScheduleId ?? null,
      cycle_index: next.cycleIndex ?? 0,
      cycle_start_date: next.cycleStartDate ?? null,
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
      in_progress_session_id: next.inProgress ?? null,
    }));
  }

  await Promise.all(ops);
}

// ─── SEED ────────────────────────────────────────────────────────────────

function seedStarter(state) {
  const exNames = [
    ['Back squat',        ['legs','compound','barbell']],
    ['Bench press',       ['push','compound','barbell']],
    ['Deadlift',          ['pull','compound','barbell']],
    ['OHP',               ['push','compound','barbell']],
    ['Pull-up',           ['pull','compound','bodyweight']],
    ['Barbell row',       ['pull','compound','barbell']],
    ['RDL',               ['legs','compound','barbell']],
    ['Leg press',         ['legs','machine']],
    ['Standing calves',   ['legs','machine']],
    ['Hammer curl',       ['pull','isolation','dumbbell']],
    ['Triceps pushdown',  ['push','isolation','cable']],
    ['Lateral raise',     ['push','isolation','dumbbell']],
  ];
  const exercises = exNames.map(([name, tags]) => ({ id: uid(), name, tags }));
  const byName = (n) => exercises.find(e => e.name === n).id;

  const sched = {
    id: uid(),
    name: '2 on 1 off · PPL',
    days: [
      { id: uid(), name: 'PUSH', items: [
        { exId: byName('Bench press'),      sets: 4, reps: 5  },
        { exId: byName('OHP'),              sets: 3, reps: 8  },
        { exId: byName('Lateral raise'),    sets: 3, reps: 12 },
        { exId: byName('Triceps pushdown'), sets: 3, reps: 12 },
      ]},
      { id: uid(), name: 'PULL', items: [
        { exId: byName('Deadlift'),    sets: 3, reps: 5  },
        { exId: byName('Barbell row'), sets: 4, reps: 6  },
        { exId: byName('Pull-up'),     sets: 3, reps: 8  },
        { exId: byName('Hammer curl'), sets: 3, reps: 10 },
      ]},
      { id: uid(), name: 'REST', items: [] },
      { id: uid(), name: 'LEGS', items: [
        { exId: byName('Back squat'),     sets: 4, reps: 5  },
        { exId: byName('RDL'),            sets: 3, reps: 8  },
        { exId: byName('Leg press'),      sets: 3, reps: 10 },
        { exId: byName('Standing calves'),sets: 4, reps: 12 },
      ]},
      { id: uid(), name: 'PUSH', items: [
        { exId: byName('OHP'),           sets: 4, reps: 6  },
        { exId: byName('Bench press'),   sets: 3, reps: 8  },
        { exId: byName('Lateral raise'), sets: 4, reps: 12 },
      ]},
      { id: uid(), name: 'REST', items: [] },
    ],
  };

  return {
    ...state,
    exercises: [...state.exercises, ...exercises],
    schedules: [...state.schedules, sched],
    activeScheduleId: sched.id,
    cycleIndex: 0,
    cycleStartDate: todayISO(),
  };
}

// ─── ADMIN OVERVIEW ──────────────────────────────────────────────────────

async function loadActiveSessionsOverview() {
  const { data, error } = await _supabase.rpc('get_active_sessions_overview');
  if (error) throw error;
  return data || [];
}

// ─── HELPERS ─────────────────────────────────────────────────────────────

function findExercise(state, exId) {
  return state.exercises.find(e => e.id === exId);
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

function todaysDay(state) {
  const sch = state.schedules.find(s => s.id === state.activeScheduleId);
  if (!sch || !sch.days.length) return null;
  if (isWeekdayPlan(sch)) {
    const js = new Date().getDay();
    const todayWd = js === 0 ? 6 : js - 1; // 0=Mo … 6=So
    const day = sch.days.find(d => d.weekday === todayWd);
    if (day) return { schedule: sch, day, idx: todayWd };
    return { schedule: sch, day: { id: 'rest-virtual', name: 'REST', items: [], weekday: todayWd }, idx: todayWd };
  }
  let idx;
  if (state.cycleStartDate) {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const start = new Date(state.cycleStartDate + 'T12:00:00');
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
  let curIdx;
  if (state.cycleStartDate) {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const start = new Date(state.cycleStartDate + 'T12:00:00');
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

window.LB = {
  supabase: _supabase,
  SUPABASE_URL, SUPABASE_ANON_KEY, PUSHOVER_URL,
  signIn, signUp, signOut, deleteAllData, importFromBackup,
  loadFromSupabase, syncStore, seedStarter,
  saveToLocal, loadFromLocal, saveBase, loadBase, clearLocal,
  uid, todayISO, findExercise, lastSessionForExercise, todaysDay, nextDay, isWeekdayPlan,
  loadActiveSessionsOverview,
};
