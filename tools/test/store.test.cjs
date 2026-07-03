#!/usr/bin/env node
/* Focused unit tests for the pure / near-pure logic in src/store.js.
   No build step, no test framework — load store.js in a vm with a minimal
   window/supabase stub and assert against window.LB. Run: node this file. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

let testFrom; // swapped per test to control what supabase calls "return"
const rpcLog = []; // records every rpc(name, args) call

function loadStore() {
  const code = fs.readFileSync(path.join(__dirname, '../../src/store.js'), 'utf8');
  const fakeClient = {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
    from: (...args) => testFrom(...args),
    rpc: async (name, args) => { rpcLog.push({ name, args }); return { data: null, error: null }; },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  };
  const sandbox = {
    window: { supabase: { createClient: () => fakeClient }, addEventListener() {} },
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    console, fetch: async () => ({ ok: true }), setTimeout, clearTimeout, Math, Date, JSON,
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'store.js' });
  return sandbox.window.LB;
}

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); pass++; }
  catch (e) { console.error(`FAIL ${name}\n     ${e.message}`); fail++; }
}
async function testAsync(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); pass++; }
  catch (e) { console.error(`FAIL ${name}\n     ${e.message}`); fail++; }
}

(async () => {
  const LB = loadStore();

  // ── todayISO: local calendar date, not UTC ───────────────────────────────
  test('todayISO returns local YYYY-MM-DD matching local getDate', () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    assert.strictEqual(LB.todayISO(), expected);
  });

  // ── validateBackup ───────────────────────────────────────────────────────
  test('validateBackup accepts a well-formed backup', () => {
    assert.strictEqual(LB.validateBackup({
      sessions: [{ id: 's1', entries: [] }],
      exercises: [{ id: 'e1', name: 'Squat', tags: [] }],
      schedules: [{ id: 'sc1', days: [] }],
      settings: { unit: 'kg' },
    }), null);
  });
  test('validateBackup rejects a non-object', () => assert.ok(LB.validateBackup(null)));
  test('validateBackup rejects missing arrays', () => assert.ok(LB.validateBackup({ exercises: [], schedules: [] })));
  test('validateBackup rejects an exercise without id', () =>
    assert.ok(LB.validateBackup({ sessions: [], exercises: [{ name: 'x' }], schedules: [] })));
  test('validateBackup rejects exercise tags that are not an array', () =>
    assert.ok(LB.validateBackup({ sessions: [], exercises: [{ id: 'e1', tags: 'nope' }], schedules: [] })));
  test('validateBackup rejects a session with non-array entries', () =>
    assert.ok(LB.validateBackup({ sessions: [{ id: 's', entries: {} }], exercises: [], schedules: [] })));

  // ── syncStore error propagation (THE core fix) ───────────────────────────
  const settings = {};
  const baseStore = () => ({ exercises: [], schedules: [], sessions: [], skips: [], settings, user: { name: 'a' } });
  const builder = (result) => {
    const b = {
      upsert: () => Promise.resolve(result),
      insert: () => Promise.resolve(result),
      delete() { return b; },
      in: () => Promise.resolve(result),
      eq: () => Promise.resolve(result),
    };
    return b;
  };

  await testAsync('syncStore REJECTS when a write returns { error }', async () => {
    testFrom = () => builder({ data: null, error: { message: 'boom' } });
    const prev = baseStore();
    const next = { ...baseStore(), exercises: [{ id: 'e1', name: 'X', tags: [] }] };
    let threw = false;
    try { await LB.syncStore(prev, next, 'u1'); } catch (_) { threw = true; }
    assert.ok(threw, 'expected syncStore to reject on a failed write — this is what makes flushSync retry');
  });

  await testAsync('syncStore RESOLVES when writes succeed', async () => {
    testFrom = () => builder({ data: null, error: null });
    const prev = baseStore();
    const next = { ...baseStore(), exercises: [{ id: 'e1', name: 'X', tags: [] }] };
    await LB.syncStore(prev, next, 'u1'); // must not throw
  });

  // ── relational session sync (spectator regression) ───────────────────────
  // Since the JSONB dual-write was dropped, the relational rows are the only
  // copy the spectator/overview RPCs can read. A brand-new session must write
  // ALL its seeded sets (incl. pending ones), or the live view shows wrong
  // set totals ("4/4", "finishing soon").
  const mkSession = (secondDone) => ({
    id: 'sess1', scheduleId: 'sch', dayId: 'd', dayName: 'PULL', date: '2026-06-10',
    startedAt: '2026-06-10T10:00:00Z', ended: null,
    entries: [{
      exId: 'e1', name: 'Row', plannedSets: 3, plannedReps: 10,
      sets: [
        { kg: 50, reps: 10, done: true },
        { kg: 50, reps: 10, done: secondDone },
        { kg: 50, reps: 10, done: false },
      ],
    }],
  });

  await testAsync('syncStore writes ALL seeded sets for a brand-new session', async () => {
    rpcLog.length = 0;
    testFrom = () => builder({ data: null, error: null });
    const prev = baseStore(); // session not in prev = creation event
    const next = { ...baseStore(), sessions: [mkSession(false)] };
    await LB.syncStore(prev, next, 'u1');
    const call = rpcLog.find(c => c.name === 'sync_sets_batch');
    assert.ok(call, 'sync_sets_batch must be called for a brand-new session');
    assert.strictEqual(call.args.p_sets.length, 3, 'all seeded sets (incl. pending) must be written');
  });

  await testAsync('syncStore writes only CHANGED sets for an existing session', async () => {
    rpcLog.length = 0;
    testFrom = () => builder({ data: null, error: null });
    const prev = { ...baseStore(), sessions: [mkSession(false)] };
    const next = { ...baseStore(), sessions: [mkSession(true)] };
    await LB.syncStore(prev, next, 'u1');
    const call = rpcLog.find(c => c.name === 'sync_sets_batch');
    assert.ok(call, 'sync_sets_batch must be called when a set changed');
    assert.strictEqual(call.args.p_sets.length, 1, 'only the changed set is re-written');
  });

  // ── windowed history: aggregate fallbacks ────────────────────────────────
  // Boot loads sets only for a recent window; older ended sessions carry the
  // get_session_stats aggregates instead and must report volume/sets from them.
  const windowedOut = { id: 'old1', ended: '2025-01-10T10:00:00Z', entries: [], aggVolume: 1234, aggDoneSets: 9, aggExercises: 4 };
  const inWindow = {
    id: 'new1', ended: '2026-06-09T10:00:00Z',
    entries: [{ exId: 'e1', sets: [{ kg: 100, reps: 10, done: true }, { kg: 100, reps: 8, done: true, warmup: true }] }],
    aggVolume: 99999, aggDoneSets: 99, // stale aggregates must NOT win over loaded sets
  };

  test('totalVolume falls back to aggVolume for windowed-out sessions', () =>
    assert.strictEqual(LB.totalVolume(windowedOut), 1234));
  test('doneSetCount falls back to aggDoneSets for windowed-out sessions', () =>
    assert.strictEqual(LB.doneSetCount(windowedOut), 9));
  test('totalVolume prefers loaded sets over aggregates', () =>
    assert.strictEqual(LB.totalVolume(inWindow), 1000));
  test('doneSetCount prefers loaded sets over aggregates', () =>
    assert.strictEqual(LB.doneSetCount(inWindow), 1));
  test('totalVolume of a genuinely empty ended session without aggregates is 0', () =>
    assert.strictEqual(LB.totalVolume({ id: 'x', ended: '2026-01-01', entries: [] }), 0));

  // ── bestE1rmForExercise: server aggregate + local window combine ─────────
  const prState = {
    exerciseBests: { e1: 150 },
    sessions: [
      { id: 'live', ended: null, entries: [{ exId: 'e1', sets: [{ kg: 200, reps: 10, done: true }] }] },
      { id: 'recent', ended: '2026-06-09T10:00:00Z', entries: [{ exId: 'e1', sets: [{ kg: 140, reps: 10, done: true }] }] },
    ],
  };
  test('bestE1rmForExercise uses the cached server aggregate as baseline', () =>
    // local window best: 140*(1+10/30) ≈ 186.7 > aggregate 150
    assert.ok(Math.abs(LB.bestE1rmForExercise(prState, 'e1', 'live') - 140 * (1 + 10 / 30)) < 1e-9));
  test('bestE1rmForExercise keeps the aggregate when the window is weaker', () => {
    const st = { exerciseBests: { e1: 500 }, sessions: prState.sessions };
    assert.strictEqual(LB.bestE1rmForExercise(st, 'e1', 'live'), 500);
  });
  test('bestE1rmForExercise excludes the live session and tolerates a missing map', () =>
    assert.strictEqual(LB.bestE1rmForExercise({ sessions: prState.sessions.slice(0, 1) }, 'e1', 'live'), 0));

  // ── mergeSessions: windowed cache-first reload merge ─────────────────────
  const now = new Date('2026-06-10T12:00:00Z');
  test('mergeSessions drops sessions the server no longer has (old ones)', () => {
    const fresh = [{ id: 'a', date: '2026-06-01', ended: 'x', entries: [] }];
    const cur = [
      { id: 'a', date: '2026-06-01', ended: 'x', entries: [] },
      { id: 'gone', date: '2026-01-01', ended: 'x', entries: [] },
    ];
    const { sessions } = LB.mergeSessions(fresh, cur, null, null, now);
    assert.strictEqual(sessions.map(s => s.id).join(','), 'a');
  });
  test('mergeSessions keeps recent local-only ended sessions (not yet synced)', () => {
    const fresh = [];
    const cur = [{ id: 'loc', date: '2026-06-09', ended: 'x', entries: [] }];
    const { sessions } = LB.mergeSessions(fresh, cur, null, null, now);
    assert.strictEqual(sessions.map(s => s.id).join(','), 'loc');
  });
  test('mergeSessions always keeps the local-only in-progress session', () => {
    const fresh = [];
    const cur = [{ id: 'ip', date: '2026-01-01', ended: null, entries: [] }];
    const { sessions, activeExists } = LB.mergeSessions(fresh, cur, 'ip', null, now);
    assert.strictEqual(sessions.map(s => s.id).join(','), 'ip');
    assert.strictEqual(activeExists, true);
  });
  test('mergeSessions reports a vanished in-progress session as inactive', () => {
    const { activeExists } = LB.mergeSessions([], [], 'ghost', null, now);
    assert.strictEqual(activeExists, false);
  });
  test('mergeSessions preserves cached entries for sessions outside the boot window', () => {
    const cachedEntries = [{ exId: 'e1', sets: [{ kg: 80, reps: 8 }] }];
    const fresh = [{ id: 'old', date: '2025-01-01', ended: 'x', entries: [], aggVolume: 640 }];
    const cur = [{ id: 'old', date: '2025-01-01', ended: 'x', entries: cachedEntries }];
    const { sessions } = LB.mergeSessions(fresh, cur, null, null, now);
    assert.strictEqual(sessions[0].entries, cachedEntries, 'windowing must not wipe history already on the device');
    assert.strictEqual(sessions[0].aggVolume, 640, 'fresh aggregates still attached');
  });
  test('mergeSessions keeps LOCAL entries authoritative for the active session', () => {
    const localEntries = [{ exId: 'e1', sets: [{ kg: 100, reps: 5, done: true }] }];
    const fresh = [{ id: 'act', date: '2026-06-10', ended: null, entries: [{ exId: 'e1', sets: [] }] }];
    const cur = [{ id: 'act', date: '2026-06-10', ended: null, entries: localEntries, restStart: 123 }];
    const { sessions } = LB.mergeSessions(fresh, cur, 'act', null, now);
    assert.strictEqual(sessions[0].entries, localEntries);
    assert.strictEqual(sessions[0].restStart, 123);
  });
  // A recent session that was already confirmed synced (present in the base)
  // but is gone from fresh was deleted on another device. Keeping it would
  // make this device push it right back (resurrection bug).
  test('mergeSessions does NOT resurrect a synced session deleted on another device', () => {
    const sess = { id: 'del', date: '2026-06-09', ended: 'x', entries: [] };
    const { sessions } = LB.mergeSessions([], [sess], null, [sess], now);
    assert.strictEqual(sessions.length, 0, 'was in the synced base + gone from the server → deleted remotely');
  });
  test('mergeSessions still keeps never-synced recent sessions when a base exists', () => {
    const sess = { id: 'new', date: '2026-06-09', ended: 'x', entries: [] };
    const { sessions } = LB.mergeSessions([], [sess], null, [{ id: 'other' }], now);
    assert.strictEqual(sessions.map(s => s.id).join(','), 'new');
  });
  test('mergeSessions does NOT resurrect a session deleted locally (in base, not in cur, still on server)', () => {
    const sess = { id: 'del', date: '2026-06-09', ended: 'x', entries: [] };
    // fresh still has it (sync delete not yet propagated), cur doesn't (user deleted it), base has it
    const { sessions } = LB.mergeSessions([sess], [], null, [sess], now);
    assert.strictEqual(sessions.length, 0, 'locally deleted → must not come back from server');
  });
  test('mergeSessions includes new server sessions not in cur or base (cross-device created)', () => {
    const sess = { id: 'new', date: '2026-06-09', ended: 'x', entries: [] };
    const { sessions } = LB.mergeSessions([sess], [], null, [], now);
    assert.strictEqual(sessions.map(s => s.id).join(','), 'new', 'new session from another device must appear');
  });

  // ── sessionToRow keeps client-only fields out of the DB row ──────────────
  // agg* / entries are attached at load time; writing them would 400 on
  // PostgREST (no such columns) and break the sync retry loop.
  await testAsync('syncStore never writes entries/agg* fields to zane_sessions', async () => {
    const upserts = [];
    testFrom = (table) => {
      const b = {
        upsert: (rows) => { upserts.push({ table, rows }); return Promise.resolve({ data: null, error: null }); },
        insert: () => Promise.resolve({ data: null, error: null }),
        delete() { return b; },
        in: () => Promise.resolve({ data: null, error: null }),
        eq: () => Promise.resolve({ data: null, error: null }),
      };
      return b;
    };
    const prev = baseStore();
    const next = {
      ...baseStore(),
      sessions: [{ ...mkSession(false), aggVolume: 1, aggDoneSets: 2, aggExercises: 3 }],
    };
    await LB.syncStore(prev, next, 'u1');
    const sessUpsert = upserts.find(u => u.table === 'zane_sessions');
    assert.ok(sessUpsert, 'session row must be upserted');
    const row = sessUpsert.rows[0];
    for (const k of ['entries', 'aggVolume', 'aggDoneSets', 'aggExercises']) {
      assert.ok(!(k in row), `${k} must not be written to zane_sessions`);
    }
  });

  // ── historyWindowCutoffISO ────────────────────────────────────────────────
  test('historyWindowCutoffISO returns the date 70 days before now', () => {
    const cutoff = LB.historyWindowCutoffISO(new Date('2026-06-10T12:00:00Z'));
    assert.strictEqual(cutoff, '2026-04-01');
  });

  // ── detectCardioPRs ───────────────────────────────────────────────────────
  const cLog = (o) => ({ id: o.id || 'x', type: o.type ?? 'Running', durationMinutes: o.dur, distanceM: o.dist ?? null, date: o.date || '2026-06-01', createdAt: o.createdAt || o.date || '2026-06-01' });

  test('detectCardioPRs returns null on the first-ever log of a type', () => {
    assert.strictEqual(LB.detectCardioPRs(cLog({ id: 'n', dur: 30, dist: 5000 }), []), null);
  });

  test('detectCardioPRs flags all-time bests for distance, duration and pace', () => {
    const prior = [cLog({ id: 'a', dur: 30, dist: 5000, date: '2026-05-01' })]; // 6 min/km
    const r = LB.detectCardioPRs(cLog({ id: 'n', dur: 50, dist: 10000, date: '2026-06-01' }), prior); // 5 min/km, longer, farther
    assert.strictEqual(r.tier, 'best');
    const byKey = Object.fromEntries(r.items.map(i => [i.metric, i]));
    assert.ok(byKey.distance && byKey.distance.tier === 'best', 'distance best');
    assert.ok(byKey.duration && byKey.duration.tier === 'best', 'duration best');
    assert.ok(byKey.pace && byKey.pace.tier === 'best', 'pace best');
  });

  test('detectCardioPRs only compares within the same activity type', () => {
    const prior = [cLog({ id: 'b', type: 'Cycling', dur: 120, dist: 40000, date: '2026-05-01' })];
    // A 30-min / 5k run vs a long bike ride — no run history → null
    assert.strictEqual(LB.detectCardioPRs(cLog({ id: 'n', type: 'Running', dur: 30, dist: 5000 }), prior), null);
  });

  test('detectCardioPRs reports improvement over the last log when not an all-time best', () => {
    const prior = [
      cLog({ id: 'best', dur: 90, dist: 18000, date: '2026-04-01' }), // all-time longest 90 min
      cLog({ id: 'last', dur: 40, dist: 8000, date: '2026-05-20' }),  // most recent: 40 min
    ];
    const r = LB.detectCardioPRs(cLog({ id: 'n', dur: 50, dist: 9000, date: '2026-06-01' }), prior);
    const dur = r.items.find(i => i.metric === 'duration');
    assert.ok(dur && dur.tier === 'improvement', 'duration beats last (40) but not best (90) → improvement');
    assert.strictEqual(dur.prev, 40);
  });

  test('detectCardioPRs ignores the new log id and ties do not count', () => {
    const prior = [cLog({ id: 'a', dur: 30, dist: 5000, date: '2026-05-01' })];
    // Identical numbers → no strict beat → null
    assert.strictEqual(LB.detectCardioPRs(cLog({ id: 'n', dur: 30, dist: 5000, date: '2026-06-01' }), prior), null);
  });

  // ── Daily health logs ─────────────────────────────────────────────────────
  const MACROS = { proteinTraining: 200, carbsTraining: 250, fatTraining: 70, caloriesTraining: 2430,
                   proteinRest: 180, carbsRest: 150, fatRest: 60, caloriesRest: 1860 };

  test('isLoggedTrainingDay: only an ended session on that date counts', () => {
    const sessions = [
      { date: '2026-06-10T00:00:00', ended: '2026-06-10T11:00:00' },
      { date: '2026-06-11', ended: null }, // planned/started but not logged
    ];
    assert.strictEqual(LB.isLoggedTrainingDay(sessions, '2026-06-10'), true);
    assert.strictEqual(LB.isLoggedTrainingDay(sessions, '2026-06-11'), false); // earn your macros
    assert.strictEqual(LB.isLoggedTrainingDay(sessions, '2026-06-12'), false);
  });

  test('plannedTrainingDay: weekday plan returns training slot, null for rest/empty/no-plan', () => {
    const allTrain = { id: 'p1', mode: 'weekday', days: Array.from({ length: 7 }, (_, wd) => ({ weekday: wd, name: 'D', items: [{ exId: 'x' }] })) };
    assert.ok(LB.plannedTrainingDay({ activeScheduleId: 'p1', schedules: [allTrain] }, '2026-06-10'));
    const allRest = { id: 'p1', mode: 'weekday', days: Array.from({ length: 7 }, (_, wd) => ({ weekday: wd, name: 'REST', items: [] })) };
    assert.strictEqual(LB.plannedTrainingDay({ activeScheduleId: 'p1', schedules: [allRest] }, '2026-06-10'), null);
    assert.strictEqual(LB.plannedTrainingDay({ activeScheduleId: null, schedules: [] }, '2026-06-10'), null);
    // before the plan started → not yet a training day
    assert.strictEqual(LB.plannedTrainingDay({ activeScheduleId: 'p1', schedules: [allTrain], weekPlanStartDate: '2026-06-15' }, '2026-06-10'), null);
  });

  test('isTrainingDayForDate: performed always counts; planned counts only today/future', () => {
    const allTrain = { id: 'p1', mode: 'weekday', days: Array.from({ length: 7 }, (_, wd) => ({ weekday: wd, name: 'D', items: [{ exId: 'x' }] })) };
    const today = LB.todayISO();
    const shift = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    const future = shift(today, 3), past = shift(today, -3);
    const base = { activeScheduleId: 'p1', schedules: [allTrain], sessions: [] };
    assert.strictEqual(LB.isTrainingDayForDate(base, future), true);              // planned future → training
    assert.strictEqual(LB.isTrainingDayForDate(base, past), false);              // planned past, not done → rest
    const done = { ...base, sessions: [{ date: past + 'T10:00:00', ended: past + 'T11:00:00' }] };
    assert.strictEqual(LB.isTrainingDayForDate(done, past), true);               // performed past → training
    assert.strictEqual(LB.isTrainingDayForDate({ activeScheduleId: null, schedules: [], sessions: [] }, future), false);
  });

  test('dayTargetFromMacros picks training vs rest, null when unset', () => {
    // deepStrictEqual would trip on the vm realm's distinct Object.prototype —
    // compare by JSON instead (same as the rest of this suite avoids it).
    assert.strictEqual(JSON.stringify(LB.dayTargetFromMacros(MACROS, true)), JSON.stringify({ protein: 200, carbs: 250, fat: 70, calories: 2430 }));
    assert.strictEqual(JSON.stringify(LB.dayTargetFromMacros(MACROS, false)), JSON.stringify({ protein: 180, carbs: 150, fat: 60, calories: 1860 }));
    assert.strictEqual(LB.dayTargetFromMacros(null, true), null);
    assert.strictEqual(LB.dayTargetFromMacros({ proteinTraining: null, carbsTraining: null, fatTraining: null }, true), null);
  });

  test('macroAdherence: 100% on target, calorie-weighted, null if incomplete', () => {
    const t = { protein: 200, carbs: 250, fat: 70 };
    assert.strictEqual(LB.macroAdherence({ protein: 200, carbs: 250, fat: 70 }, t), 100);
    // protein 10% off, carbs/fat perfect
    // kcal: P=800, C=1000, F=630 → total=2430
    // weighted: (0.9×800 + 1×1000 + 1×630)/2430 = 2350/2430 ≈ 0.9670 → 97
    assert.strictEqual(LB.macroAdherence({ protein: 180, carbs: 250, fat: 70 }, t), 97);
    // protein 0 (score=0), carbs/fat perfect: (0×800 + 1×1000 + 1×630)/2430 = 1630/2430 ≈ 0.6708 → 67
    assert.strictEqual(LB.macroAdherence({ protein: 0, carbs: 250, fat: 70 }, t), 67);
    // calorie-weighting: small fat target (50g) has less impact than equal-weight would give
    // t2: P=150g(600kcal,24%), C=350g(1400kcal,57%), F=50g(450kcal,18%) → total=2450
    // 10g fat over (score=0.8): (1×600 + 1×1400 + 0.8×450)/2450 = 2360/2450 ≈ 0.9633 → 96
    // equal-weight would give (1+1+0.8)/3 = 0.9333 → 93 — calorie-weighting is fairer
    const t2 = { protein: 150, carbs: 350, fat: 50 };
    assert.strictEqual(LB.macroAdherence({ protein: 150, carbs: 350, fat: 60 }, t2), 96);
    assert.strictEqual(LB.macroAdherence({ protein: 200, carbs: null, fat: 70 }, t), null);
    assert.strictEqual(LB.macroAdherence({ protein: 200, carbs: 250, fat: 70 }, null), null);
  });

  test('effectiveMacroTargets prefers personal, falls back to coaching, else null', () => {
    const personal = { proteinTraining: 210 };
    assert.strictEqual(LB.effectiveMacroTargets(personal, MACROS), personal);
    assert.strictEqual(LB.effectiveMacroTargets(null, MACROS), MACROS);
    assert.strictEqual(LB.effectiveMacroTargets({}, MACROS), MACROS);
    assert.strictEqual(LB.effectiveMacroTargets(null, null), null);
  });

  test('dailyLogAdherence snapshots target + dayType, null when targets missing', () => {
    const log = { protein: 200, carbs: 250, fat: 70 };
    const r = LB.dailyLogAdherence(log, MACROS, true);
    assert.strictEqual(r.adherence, 100);
    assert.strictEqual(JSON.stringify(r.targetsSnap), JSON.stringify({ protein: 200, carbs: 250, fat: 70, calories: 2430, dayType: 'training' }));
    // Rest day uses rest targets
    assert.strictEqual(LB.dailyLogAdherence({ protein: 180, carbs: 150, fat: 60 }, MACROS, false).adherence, 100);
    // No targets → no adherence, no snapshot
    const noT = LB.dailyLogAdherence(log, null, true);
    assert.strictEqual(noT.adherence, null); assert.strictEqual(noT.targetsSnap, null);
    // Incomplete macros → no adherence
    const inc = LB.dailyLogAdherence({ protein: 200, carbs: 250 }, MACROS, true);
    assert.strictEqual(inc.adherence, null); assert.strictEqual(inc.targetsSnap, null);
  });

  test('dailyLogsWeekPrefill: today weight + week sum/averages', () => {
    const today = LB.todayISO(); // weight_today is sourced from TODAY's log
    const logs = [
      // target week Mon 2026-06-08 … Sun 2026-06-14
      { date: '2026-06-08', weight: 84.0, steps: 8000, calories: 2000, protein: 180, carbs: 200, fat: 60, waterMl: 2000, adherence: 90 },
      { date: '2026-06-10', weight: 83.6, steps: 10000, calories: 2200, protein: 200, carbs: 220, fat: 70, waterMl: 3000, adherence: 100 },
      // prior week
      { date: '2026-06-02', weight: 85.0 },
      { date: '2026-06-04', weight: 85.4 },
      // today's log (outside the reported week) — weight_today reads from here
      { date: today, weight: 96.6 },
    ];
    const p = LB.dailyLogsWeekPrefill(logs, '2026-06-08');
    assert.strictEqual(p.weight_today, 96.6);         // from today's log, not the week
    assert.strictEqual(p.weight_avg_last_week, 83.8); // avg of the reported week (Jun 8–14)
    assert.strictEqual(p.steps, 18000);               // SUM of the week's steps
    assert.strictEqual(p.calories_avg, 2100);
    assert.strictEqual(p.protein_avg, 190);
    assert.strictEqual(p.macro_adherence, 95);
    assert.strictEqual(p.count, 2);
    assert.strictEqual(LB.dailyLogsWeekPrefill([], '2026-06-08'), null);
  });

  // ── Flexible plans ────────────────────────────────────────────────────────
  const flexSch = { id: 'fx', name: 'FLEX', is_flex: true, versions: [], days: [
    { id: 'd0', name: 'PUSH', items: [{ exId: 'e1' }] },
    { id: 'd1', name: 'PULL', items: [{ exId: 'e2' }] },
    { id: 'd2', name: 'LEGS', items: [{ exId: 'e3' }] },
  ] };
  const flexState = (cycleIndex) => ({ activeScheduleId: 'fx', cycleIndex, cycleStartDate: null, schedules: [flexSch] });

  test('isFlexPlan detects the is_flex column, ignores legacy plans', () => {
    assert.strictEqual(LB.isFlexPlan(flexSch), true);
    assert.strictEqual(LB.isFlexPlan({ days: [], versions: [] }), false);
    assert.strictEqual(LB.isFlexPlan({ is_flex: false, days: [] }), false);
    assert.strictEqual(LB.isFlexPlan(null), false);
  });

  test('todaysDay on a flex plan reads the cycleIndex, never the date', () => {
    assert.strictEqual(LB.todaysDay(flexState(0)).day.id, 'd0');
    assert.strictEqual(LB.todaysDay(flexState(1)).day.id, 'd1');
    assert.strictEqual(LB.todaysDay(flexState(2)).idx, 2);
    // wraps around the rotation
    assert.strictEqual(LB.todaysDay(flexState(3)).day.id, 'd0');
    assert.strictEqual(LB.todaysDay(flexState(5)).day.id, 'd2');
  });

  test('nextDay on a flex plan is the following day in the rotation', () => {
    assert.strictEqual(LB.nextDay(flexState(0)).day.id, 'd1');
    assert.strictEqual(LB.nextDay(flexState(2)).day.id, 'd0'); // wraps
  });

  // ── weekPerformanceSignal ────────────────────────────────────────────────
  const wpSet = (kg, reps, done = true) => ({ kg, reps, done, warmup: false, skipped: false });
  const wpSession = (date, sets) => ({ id: date, ended: date + 'T18:00:00', date, dayId: 'd0',
    entries: [{ exId: 'e1', sets }] });

  test('weekPerformanceSignal returns null without a comparable prior week', () => {
    const state = { sessions: [wpSession('2026-06-09', [wpSet(100, 5)])] };
    assert.strictEqual(LB.weekPerformanceSignal(state, '2026-06-08'), null);
  });

  test('weekPerformanceSignal reports improvement when most sets beat the prior session', () => {
    const state = { sessions: [
      wpSession('2026-06-01', [wpSet(100, 5), wpSet(100, 5)]), // pre-week baseline
      wpSession('2026-06-09', [wpSet(105, 5), wpSet(105, 5)]), // this week: more weight
    ] };
    assert.strictEqual(LB.weekPerformanceSignal(state, '2026-06-08'), 'improved');
  });

  test('weekPerformanceSignal reports worse when most sets decline', () => {
    const state = { sessions: [
      wpSession('2026-06-01', [wpSet(100, 5), wpSet(100, 5)]),
      wpSession('2026-06-09', [wpSet(95, 5), wpSet(95, 5)]),
    ] };
    assert.strictEqual(LB.weekPerformanceSignal(state, '2026-06-08'), 'worse');
  });

  test('weekPerformanceSignal compares against pre-week sessions, not same-week ones', () => {
    const state = { sessions: [
      wpSession('2026-06-02', [wpSet(100, 5)]), // baseline before the week
      wpSession('2026-06-09', [wpSet(110, 5)]), // earlier in the reported week
      wpSession('2026-06-11', [wpSet(112, 5)]), // later same week — must NOT compare to Jun 9
    ] };
    // Both week sessions improve over the Jun 2 baseline → improved
    assert.strictEqual(LB.weekPerformanceSignal(state, '2026-06-08'), 'improved');
  });

  // ── pickGrowthRecipient / retractGrowthGrant (meso volume growth rotation) ──
  test('pickGrowthRecipient: single exercise always wins, matching pre-rotation main-lift-only behavior', () => {
    const r = LB.pickGrowthRecipient(['a_d1'], {}, {}, null);
    assert.strictEqual(r.recipientKey, 'a_d1');
    assert.strictEqual(r.growthCounts.a_d1, 1);
  });

  test('pickGrowthRecipient: single exercise stops granting once at its own ceiling', () => {
    const r = LB.pickGrowthRecipient(['a_d1'], { a_d1: 4 }, { a_d1: 7 }, null);
    assert.strictEqual(r.recipientKey, null);
    // growthCounts is left untouched when nobody is eligible
    assert.strictEqual(r.growthCounts.a_d1, 7);
  });

  test('pickGrowthRecipient: fewest grants wins, ties toward the main (first) exercise', () => {
    // Tied at 0 → main (a_d1) wins.
    const r1 = LB.pickGrowthRecipient(['a_d1', 'b_d1'], {}, {}, null);
    assert.strictEqual(r1.recipientKey, 'a_d1');
    // b already has fewer grants → b wins even though a is main.
    const r2 = LB.pickGrowthRecipient(['a_d1', 'b_d1'], {}, { a_d1: 2, b_d1: 1 }, null);
    assert.strictEqual(r2.recipientKey, 'b_d1');
    assert.strictEqual(r2.growthCounts.b_d1, 2);
    assert.strictEqual(r2.growthCounts.a_d1, 2);
  });

  test('pickGrowthRecipient: only exercises below the ceiling are eligible, even if they have fewer grants', () => {
    // b has fewer grants (0) but is already at its delta ceiling — a (delta 2) wins instead.
    const r = LB.pickGrowthRecipient(['a_d1', 'b_d1'], { a_d1: 2, b_d1: 4 }, { a_d1: 3, b_d1: 0 }, null);
    assert.strictEqual(r.recipientKey, 'a_d1');
  });

  test('pickGrowthRecipient: a never-before-seen exercise is seeded at the group max, not 0, so it cannot cut ahead', () => {
    // a=3, b=1 already established; c is new (absent from growthCounts).
    // groupMax=3 → c seeds to 3, so b (still at 1) correctly wins, not c.
    const r = LB.pickGrowthRecipient(['a_d1', 'b_d1', 'c_d1'], {}, { a_d1: 3, b_d1: 1 }, null);
    assert.strictEqual(r.recipientKey, 'b_d1');
    assert.strictEqual(r.growthCounts.c_d1, 3);
  });

  test('pickGrowthRecipient: groupMax for seeding reflects the true established max, unaffected by undoing this record\'s own prior grant', () => {
    // a is the sole holder of the group max (5) AND is this record's own
    // previous grant recipient; c is new. Undoing a's prior grant must not
    // transiently lower what c gets seeded at.
    const r = LB.pickGrowthRecipient(['a_d1', 'c_d1'], { a_d1: 0, c_d1: 0 }, { a_d1: 5 }, 'a_d1');
    assert.strictEqual(r.growthCounts.c_d1, 5);
  });

  test('pickGrowthRecipient: editing an already-answered "not enough" this session undoes the prior grant before re-deciding', () => {
    const first = LB.pickGrowthRecipient(['a_d1', 'b_d1'], {}, {}, null);
    assert.strictEqual(first.recipientKey, 'a_d1');
    // Re-answering the same question this session (prevGrantedTo = a_d1):
    // a's grant is undone first, so it ties with b at 0 again and wins back.
    const again = LB.pickGrowthRecipient(['a_d1', 'b_d1'], {}, first.growthCounts, 'a_d1');
    assert.strictEqual(again.recipientKey, 'a_d1');
    assert.strictEqual(again.growthCounts.a_d1, 1);
    assert.strictEqual(again.growthCounts.b_d1, 0);
  });

  test('retractGrowthGrant: undoes one grant, floors at 0, no-ops on a null key', () => {
    assert.strictEqual(LB.retractGrowthGrant({ a_d1: 1 }, 'a_d1').a_d1, 0);
    assert.strictEqual(LB.retractGrowthGrant({ a_d1: 0 }, 'a_d1').a_d1, 0);
    assert.strictEqual(JSON.stringify(LB.retractGrowthGrant({ a_d1: 1 }, null)), JSON.stringify({ a_d1: 1 }));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
