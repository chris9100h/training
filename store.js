/* Logbook store — pure localStorage CRUD layer */

const STORE_KEY = 'logbook.v1';

const DEFAULT_STATE = {
  user: null,                // { name }
  exercises: [],             // { id, name, tags: [] }
  schedules: [],             // { id, name, days: [{ id, name, items: [{ exId, sets, reps }] }] }
  activeScheduleId: null,
  cycleIndex: 0,             // which day in the cycle is "today"
  lastAdvancedDate: null,    // ISO date of last cycle advance
  sessions: [],              // { id, scheduleId, dayId, dayName, date, ended, entries: [{exId, name, plannedSets, plannedReps, sets: [{kg, reps}], note}] }
  inProgress: null,          // a sessions[] entry while training, also kept in sessions
  customDayTypes: [],        // user-defined day type labels like 'PUSH1', 'PUSH2', 'LEGS-A'
  settings: { unit: 'kg', restDefault: 120 },
};

function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
function todayISO() { return new Date().toISOString().slice(0, 10); }

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_STATE), ...parsed };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function saveStore(state) {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function resetStore() {
  localStorage.removeItem(STORE_KEY);
}

// Seed convenience — adds a starter PPL schedule + common exercises.
function seedStarter(state) {
  const exNames = [
    ['Back squat', ['legs','compound','barbell']],
    ['Bench press', ['push','compound','barbell']],
    ['Deadlift', ['pull','compound','barbell']],
    ['OHP', ['push','compound','barbell']],
    ['Pull-up', ['pull','compound','bodyweight']],
    ['Barbell row', ['pull','compound','barbell']],
    ['RDL', ['legs','compound','barbell']],
    ['Leg press', ['legs','machine']],
    ['Standing calves', ['legs','machine']],
    ['Hammer curl', ['pull','isolation','dumbbell']],
    ['Triceps pushdown', ['push','isolation','cable']],
    ['Lateral raise', ['push','isolation','dumbbell']],
  ];
  const exercises = exNames.map(([name, tags]) => ({ id: uid(), name, tags }));
  const byName = (n) => exercises.find(e => e.name === n).id;

  const sched = {
    id: uid(),
    name: '2 on 1 off · PPL',
    days: [
      { id: uid(), name: 'PUSH', items: [
        { exId: byName('Bench press'), sets: 4, reps: 5 },
        { exId: byName('OHP'), sets: 3, reps: 8 },
        { exId: byName('Lateral raise'), sets: 3, reps: 12 },
        { exId: byName('Triceps pushdown'), sets: 3, reps: 12 },
      ]},
      { id: uid(), name: 'PULL', items: [
        { exId: byName('Deadlift'), sets: 3, reps: 5 },
        { exId: byName('Barbell row'), sets: 4, reps: 6 },
        { exId: byName('Pull-up'), sets: 3, reps: 8 },
        { exId: byName('Hammer curl'), sets: 3, reps: 10 },
      ]},
      { id: uid(), name: 'REST', items: [] },
      { id: uid(), name: 'LEGS', items: [
        { exId: byName('Back squat'), sets: 4, reps: 5 },
        { exId: byName('RDL'), sets: 3, reps: 8 },
        { exId: byName('Leg press'), sets: 3, reps: 10 },
        { exId: byName('Standing calves'), sets: 4, reps: 12 },
      ]},
      { id: uid(), name: 'PUSH', items: [
        { exId: byName('OHP'), sets: 4, reps: 6 },
        { exId: byName('Bench press'), sets: 3, reps: 8 },
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
  };
}

// Helpers used widely
function findExercise(state, exId) {
  return state.exercises.find(e => e.id === exId);
}

function lastSessionForExercise(state, exId) {
  // most recent ended session containing entry for exId
  const sessions = state.sessions
    .filter(s => s.ended)
    .slice()
    .sort((a, b) => (b.ended || '').localeCompare(a.ended || ''));
  for (const s of sessions) {
    const entry = s.entries.find(e => e.exId === exId && (e.sets || []).some(x => x.kg != null || x.reps != null));
    if (entry) return { session: s, entry };
  }
  return null;
}

function todaysDay(state) {
  const sch = state.schedules.find(s => s.id === state.activeScheduleId);
  if (!sch || !sch.days.length) return null;
  const idx = state.cycleIndex % sch.days.length;
  return { schedule: sch, day: sch.days[idx], idx };
}

function nextDay(state) {
  const sch = state.schedules.find(s => s.id === state.activeScheduleId);
  if (!sch || !sch.days.length) return null;
  const idx = (state.cycleIndex + 1) % sch.days.length;
  return { schedule: sch, day: sch.days[idx], idx };
}

window.LB = {
  STORE_KEY, DEFAULT_STATE, loadStore, saveStore, resetStore, seedStarter,
  uid, todayISO, findExercise, lastSessionForExercise, todaysDay, nextDay,
};
