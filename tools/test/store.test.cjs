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
  // Load the read-only data catalogs into the same window so LB helpers that read
  // window.* (e.g. instantiateProgram → window.SYSTEM_EXERCISES) see them, exactly
  // as the browser does via the plain <script> tags in index.html.
  for (const f of ['src/exercise-db.js', 'src/programs-db.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../../', f), 'utf8');
    new Function('window', src)(sandbox.window);
  }
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

  // ── repeated-exercise occurrence matching (same exercise twice in a day) ──
  const dupState = {
    sessions: [
      { id: 'p1', ended: '2026-06-08T10:00:00Z', dayId: 'd1', isDeload: false, entries: [
        { exId: 'e1', sets: [{ kg: 200, reps: 5, done: true }] },   // occurrence 0: heavy
        { exId: 'e1', sets: [{ kg: 100, reps: 15, done: true }] },  // occurrence 1: back-off
      ] },
    ],
  };
  test('bestRecentEntry occ=0 reads the first occurrence (heavy)', () =>
    assert.strictEqual(LB.bestRecentEntry(dupState, 'e1', 'd1', 3, 0).entry.sets[0].kg, 200));
  test('bestRecentEntry occ=1 reads the second occurrence, not the first', () =>
    assert.strictEqual(LB.bestRecentEntry(dupState, 'e1', 'd1', 3, 1).entry.sets[0].kg, 100));
  test('bestRecentEntry defaults to occ=0 (backward compatible)', () =>
    assert.strictEqual(LB.bestRecentEntry(dupState, 'e1', 'd1').entry.sets[0].kg, 200));

  const singleOccState = {
    sessions: [
      { id: 'p2', ended: '2026-06-08T10:00:00Z', dayId: 'd1', isDeload: false, entries: [
        { exId: 'e1', sets: [{ kg: 150, reps: 8, done: true }] },
      ] },
    ],
  };
  test('bestRecentEntry occ=1 is fail-safe (null) when past sessions had it once', () =>
    assert.strictEqual(LB.bestRecentEntry(singleOccState, 'e1', 'd1', 3, 1), null));
  test('bestRecentEntry occ=0 still works for a normal single-occurrence exercise', () =>
    assert.strictEqual(LB.bestRecentEntry(singleOccState, 'e1', 'd1', 3, 0).entry.sets[0].kg, 150));
  test('recentSessionsForExercise occ=1 collects each session\'s second occurrence', () => {
    const twoSess = { sessions: [
      { id: 'a', ended: '2026-06-09T10:00:00Z', dayId: 'd1', isDeload: false, entries: [
        { exId: 'e1', sets: [{ kg: 210, reps: 5, done: true }] },
        { exId: 'e1', sets: [{ kg: 110, reps: 15, done: true }] },
      ] },
      { id: 'b', ended: '2026-06-02T10:00:00Z', dayId: 'd1', isDeload: false, entries: [
        { exId: 'e1', sets: [{ kg: 200, reps: 5, done: true }] },
        { exId: 'e1', sets: [{ kg: 100, reps: 15, done: true }] },
      ] },
    ] };
    const rows = LB.recentSessionsForExercise(twoSess, 'e1', 'd1', 3, 1);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].entry.sets[0].kg, 110);
    assert.strictEqual(rows[1].entry.sets[0].kg, 100);
  });

  // ── techniqueRounds: weighted-stretch finisher extraction ────────────────
  test('techniqueRounds surfaces a stretch finisher on a drop set last round', () => {
    const r = LB.techniqueRounds({ technique: 'drop', drops: [{ kg: 100, reps: 10 }, { kg: 80, reps: 8, stretch: { kg: 60, timeSec: 30 } }] });
    assert.strictEqual(r.badge, 'DROP SET');
    assert.strictEqual(r.rounds.length, 2);
    assert.deepStrictEqual(r.stretch, { kg: 60, timeSec: 30 });
    assert.strictEqual(r.partials, 0);
  });
  test('techniqueRounds reads a standalone weighted_stretch', () => {
    const r = LB.techniqueRounds({ technique: 'weighted_stretch', drops: { stretch: { kg: 40, timeSec: 45 } } });
    assert.strictEqual(r.kind, 'weighted_stretch');
    assert.strictEqual(r.badge, 'STRETCH');
    assert.deepStrictEqual(r.stretch, { kg: 40, timeSec: 45 });
  });
  test('techniqueRounds carries a stretch alongside lengthened partials', () => {
    const r = LB.techniqueRounds({ technique: 'lengthened_partial', drops: { partials: 5, stretch: { kg: 50, timeSec: 20 } } });
    assert.strictEqual(r.partials, 5);
    assert.deepStrictEqual(r.stretch, { kg: 50, timeSec: 20 });
  });
  test('techniqueRounds exposes finishers per round (not just the last)', () => {
    const r = LB.techniqueRounds({ technique: 'drop', drops: [
      { kg: 100, reps: 10, partials: 3 },
      { kg: 80, reps: 8, stretch: { kg: 60, timeSec: 30 } },
    ] });
    assert.strictEqual(r.rounds[0].partials, 3);
    assert.strictEqual(r.rounds[0].stretch, null);
    assert.strictEqual(r.rounds[1].partials, 0);
    assert.deepStrictEqual(r.rounds[1].stretch, { kg: 60, timeSec: 30 });
    // top-level stays the LAST round's, for older single-finisher callers
    assert.deepStrictEqual(r.stretch, { kg: 60, timeSec: 30 });
    assert.strictEqual(r.partials, 0);
  });
  test('techniqueRounds stretch is null when absent (backward compatible)', () => {
    assert.strictEqual(LB.techniqueRounds({ technique: 'drop', drops: [{ kg: 100, reps: 10 }, { kg: 80, reps: 8 }] }).stretch, null);
    assert.strictEqual(LB.techniqueRounds({ technique: null }).stretch, null);
    assert.strictEqual(LB.techniqueRounds({ technique: 'lengthened_partial', drops: { partials: 3 } }).stretch, null);
  });

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

  test('effectiveMacroTargets: coach macros always win, personal is the fallback', () => {
    const personal = { proteinTraining: 210 };
    // Coach macros take priority whenever present (real coach or self-coaching).
    assert.strictEqual(LB.effectiveMacroTargets(personal, MACROS), MACROS);
    assert.strictEqual(LB.effectiveMacroTargets(null, MACROS), MACROS);
    assert.strictEqual(LB.effectiveMacroTargets({}, MACROS), MACROS);
    // No coach macros → personal targets are used as the fallback.
    assert.strictEqual(LB.effectiveMacroTargets(personal, null), personal);
    assert.strictEqual(LB.effectiveMacroTargets(personal, {}), personal);
    assert.strictEqual(LB.effectiveMacroTargets(null, null), null);
  });

  test('hasMacroTargets: true only when a macro (not just calories) is set', () => {
    assert.strictEqual(LB.hasMacroTargets(null), false);
    assert.strictEqual(LB.hasMacroTargets({}), false);
    assert.strictEqual(LB.hasMacroTargets({ caloriesTraining: 2000, caloriesRest: 1800 }), false);
    assert.strictEqual(LB.hasMacroTargets({ proteinRest: 150 }), true);
    assert.strictEqual(LB.hasMacroTargets({ carbsTraining: 300 }), true);
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
    const r = LB.pickGrowthRecipient(['a_d1'], {}, null);
    assert.strictEqual(r.recipientKey, 'a_d1');
    assert.strictEqual(r.growthCounts.a_d1, 1);
  });

  test('pickGrowthRecipient: no ceiling — a single exercise keeps winning no matter how many grants it already has', () => {
    const r = LB.pickGrowthRecipient(['a_d1'], { a_d1: 7 }, null);
    assert.strictEqual(r.recipientKey, 'a_d1');
    assert.strictEqual(r.growthCounts.a_d1, 8);
  });

  test('pickGrowthRecipient: fewest grants wins, ties toward the main (first) exercise', () => {
    // Tied at 0 → main (a_d1) wins.
    const r1 = LB.pickGrowthRecipient(['a_d1', 'b_d1'], {}, null);
    assert.strictEqual(r1.recipientKey, 'a_d1');
    // b already has fewer grants → b wins even though a is main.
    const r2 = LB.pickGrowthRecipient(['a_d1', 'b_d1'], { a_d1: 2, b_d1: 1 }, null);
    assert.strictEqual(r2.recipientKey, 'b_d1');
    assert.strictEqual(r2.growthCounts.b_d1, 2);
    assert.strictEqual(r2.growthCounts.a_d1, 2);
  });

  test('pickGrowthRecipient: no ceiling — fewest grants still wins even against a much larger gap', () => {
    // b has 20 prior grants, a has 3 — no ceiling excludes b from eligibility
    // anymore, but a still wins purely because it has fewer grants so far.
    const r = LB.pickGrowthRecipient(['a_d1', 'b_d1'], { a_d1: 3, b_d1: 20 }, null);
    assert.strictEqual(r.recipientKey, 'a_d1');
    assert.strictEqual(r.growthCounts.a_d1, 4);
    assert.strictEqual(r.growthCounts.b_d1, 20);
  });

  test('pickGrowthRecipient: a never-before-seen exercise is seeded at the group max, not 0, so it cannot cut ahead', () => {
    // a=3, b=1 already established; c is new (absent from growthCounts).
    // groupMax=3 → c seeds to 3, so b (still at 1) correctly wins, not c.
    const r = LB.pickGrowthRecipient(['a_d1', 'b_d1', 'c_d1'], { a_d1: 3, b_d1: 1 }, null);
    assert.strictEqual(r.recipientKey, 'b_d1');
    assert.strictEqual(r.growthCounts.c_d1, 3);
  });

  test('pickGrowthRecipient: groupMax for seeding reflects the true established max, unaffected by undoing this record\'s own prior grant', () => {
    // a is the sole holder of the group max (5) AND is this record's own
    // previous grant recipient; c is new. Undoing a's prior grant must not
    // transiently lower what c gets seeded at.
    const r = LB.pickGrowthRecipient(['a_d1', 'c_d1'], { a_d1: 5 }, 'a_d1');
    assert.strictEqual(r.growthCounts.c_d1, 5);
  });

  test('pickGrowthRecipient: editing an already-answered "not enough" this session undoes the prior grant before re-deciding', () => {
    const first = LB.pickGrowthRecipient(['a_d1', 'b_d1'], {}, null);
    assert.strictEqual(first.recipientKey, 'a_d1');
    // Re-answering the same question this session (prevGrantedTo = a_d1):
    // a's grant is undone first, so it ties with b at 0 again and wins back.
    const again = LB.pickGrowthRecipient(['a_d1', 'b_d1'], first.growthCounts, 'a_d1');
    assert.strictEqual(again.recipientKey, 'a_d1');
    assert.strictEqual(again.growthCounts.a_d1, 1);
    assert.strictEqual(again.growthCounts.b_d1, 0);
  });

  test('retractGrowthGrant: undoes one grant, floors at 0, no-ops on a null key', () => {
    assert.strictEqual(LB.retractGrowthGrant({ a_d1: 1 }, 'a_d1').a_d1, 0);
    assert.strictEqual(LB.retractGrowthGrant({ a_d1: 0 }, 'a_d1').a_d1, 0);
    assert.strictEqual(JSON.stringify(LB.retractGrowthGrant({ a_d1: 1 }, null)), JSON.stringify({ a_d1: 1 }));
  });

  test('pickGrowthRecipient: two independent grants one session (soreness then volume) via the shared pool spread to two exercises', () => {
    // The low-soreness grant and the "not enough" volume grant share the same
    // growthCounts pool. Soreness is asked first: it grants to the main lift and
    // bumps the pool. The volume grant, fed that updated pool, must then rotate
    // to the OTHER exercise instead of piling a second +1 onto the main lift.
    const soreness = LB.pickGrowthRecipient(['a_d1', 'b_d1'], {}, null);
    assert.strictEqual(soreness.recipientKey, 'a_d1');
    const volume = LB.pickGrowthRecipient(['a_d1', 'b_d1'], soreness.growthCounts, null);
    assert.strictEqual(volume.recipientKey, 'b_d1');
    assert.strictEqual(volume.growthCounts.a_d1, 1);
    assert.strictEqual(volume.growthCounts.b_d1, 1);
  });

  // ── pickDeclineRecipient (decline trims the most-grown exercise) ──
  test('pickDeclineRecipient: an all-even group trims the main (first) lift, matching the old main-lift-only behavior', () => {
    assert.strictEqual(LB.pickDeclineRecipient(['a_d1', 'b_d1', 'c_d1'], {}, null), 'a_d1');
    // ties still resolve toward the main lift even when everyone sits at +2
    assert.strictEqual(LB.pickDeclineRecipient(['a_d1', 'b_d1'], { a_d1: 2, b_d1: 2 }, null), 'a_d1');
  });

  test('pickDeclineRecipient: the most-grown secondary is trimmed instead of a lower main lift (the divergence fix)', () => {
    // main lift already low (delta 0), a secondary sitting high (delta 4) →
    // the -1 must land on the secondary, not drain the main lift further.
    assert.strictEqual(LB.pickDeclineRecipient(['a_d1', 'b_d1', 'c_d1'], { a_d1: 0, b_d1: 4, c_d1: 1 }, null), 'b_d1');
  });

  test('pickDeclineRecipient: undoes this record prior contribution before re-deciding, so a re-confirm is stable', () => {
    // deltas already reflect this record having trimmed b (b was 4, now 3);
    // re-confirming the same answer must undo that -1 (b back to 4) and pick b
    // again, not drift the -1 onto a different exercise each time.
    const deltas = { a_d1: 0, b_d1: 3, c_d1: 1 };
    const prevContrib = { b_d1: -1 };
    assert.strictEqual(LB.pickDeclineRecipient(['a_d1', 'b_d1', 'c_d1'], deltas, prevContrib), 'b_d1');
  });

  test('pickDeclineRecipient: undoes a whole "too much" prior contribution (multiple -1s) when re-deciding for "pushed"', () => {
    // record previously answered "too much" (every key -1); editing to "pushed"
    // must re-decide from the true pre-answer deltas (all restored by +1), so
    // the genuinely most-grown exercise wins rather than a post-shrink artifact.
    const deltas = { a_d1: 1, b_d1: 3, c_d1: 0 }; // already includes the too-much -1s
    const prevContrib = { a_d1: -1, b_d1: -1, c_d1: -1 };
    // pre-answer deltas: a=2, b=4, c=1 → b is highest
    assert.strictEqual(LB.pickDeclineRecipient(['a_d1', 'b_d1', 'c_d1'], deltas, prevContrib), 'b_d1');
  });

  test('pickDeclineRecipient: empty group is a no-op (null)', () => {
    assert.strictEqual(LB.pickDeclineRecipient([], { a_d1: 3 }, null), null);
  });

  // ── mesoSetTarget / mesoRepOutcome (rep performance → earn vs. rep-miss-streak cut) ──
  test('mesoSetTarget: per-set target used when the array has more than one distinct entry', () => {
    assert.strictEqual(LB.mesoSetTarget(0, 10, [8, 10]), 8);
    assert.strictEqual(LB.mesoSetTarget(1, 10, [8, 10]), 10);
  });
  test('mesoSetTarget: index past the per-set array falls back to its last entry', () => {
    assert.strictEqual(LB.mesoSetTarget(3, 10, [8, 10]), 10);
  });
  test('mesoSetTarget: a single-entry (or absent) per-set array falls back to the uniform/Range-floor plannedReps', () => {
    assert.strictEqual(LB.mesoSetTarget(0, 10, [10]), 10);
    assert.strictEqual(LB.mesoSetTarget(0, 10, null), 10);
    assert.strictEqual(LB.mesoSetTarget(0, 8, undefined), 8); // Range mode: plannedReps IS the floor
  });

  test('mesoRepOutcome: every set hits its target → allHit true, earlyMiss false', () => {
    const sets = [{ done: true, reps: 10 }, { done: true, reps: 10 }, { done: true, reps: 10 }];
    const out = LB.mesoRepOutcome(sets, 10, null);
    assert.strictEqual(out.allHit, true);
    assert.strictEqual(out.earlyMiss, false);
  });
  test('mesoRepOutcome: an earlier set missing its target is an earlyMiss (weight too heavy)', () => {
    const sets = [{ done: true, reps: 8 }, { done: true, reps: 10 }, { done: true, reps: 10 }];
    const out = LB.mesoRepOutcome(sets, 10, null);
    assert.strictEqual(out.allHit, false);
    assert.strictEqual(out.earlyMiss, true);
  });
  test('mesoRepOutcome: only the LAST set missing (all-out fatigue) does NOT count as earlyMiss', () => {
    const sets = [{ done: true, reps: 10 }, { done: true, reps: 10 }, { done: true, reps: 7 }];
    const out = LB.mesoRepOutcome(sets, 10, null);
    assert.strictEqual(out.allHit, false, 'still not a full earn, unchanged strictness');
    assert.strictEqual(out.earlyMiss, false, 'last-set fatigue miss is exempt from the streak');
  });
  test('mesoRepOutcome: a single working set has no earlier set to lean on, a miss counts directly', () => {
    const out = LB.mesoRepOutcome([{ done: true, reps: 5 }], 10, null);
    assert.strictEqual(out.allHit, false);
    assert.strictEqual(out.earlyMiss, true);
  });
  test('mesoRepOutcome: a single working set that hits is a clean earn, no miss', () => {
    const out = LB.mesoRepOutcome([{ done: true, reps: 10 }], 10, null);
    assert.strictEqual(out.allHit, true);
    assert.strictEqual(out.earlyMiss, false);
  });
  test('mesoRepOutcome: per-set targets are respected, set 1\'s lower target saves it from being a miss', () => {
    // Per-Set 8/10: first set only needs 8, hits it; second (last) set falls short of 10 but is exempt anyway.
    const sets = [{ done: true, reps: 8 }, { done: true, reps: 9 }];
    const out = LB.mesoRepOutcome(sets, null, [8, 10]);
    assert.strictEqual(out.allHit, false);
    assert.strictEqual(out.earlyMiss, false);
  });
  test('mesoRepOutcome: per-set targets, the first (non-last) set missing ITS OWN target is an earlyMiss', () => {
    const sets = [{ done: true, reps: 6 }, { done: true, reps: 10 }]; // first needed 8, got 6
    const out = LB.mesoRepOutcome(sets, null, [8, 10]);
    assert.strictEqual(out.earlyMiss, true);
  });
  test('mesoRepOutcome: a not-done (skipped mid-computation) set counts as a miss regardless of reps', () => {
    const sets = [{ done: false, reps: 10 }, { done: true, reps: 10 }];
    const out = LB.mesoRepOutcome(sets, 10, null);
    assert.strictEqual(out.allHit, false);
    assert.strictEqual(out.earlyMiss, true);
  });
  test('mesoRepOutcome: no working sets is a safe no-op', () => {
    const out = LB.mesoRepOutcome([], 10, null);
    assert.strictEqual(out.allHit, false);
    assert.strictEqual(out.earlyMiss, false);
  });

  // ── mesoEarnTarget (range double-progression EARN ladder) ──
  test('mesoEarnTarget: multi-set range, first set targets the top, last the floor', () => {
    assert.strictEqual(LB.mesoEarnTarget(0, 2, 8, null, 12), 12); // first → rangeMax
    assert.strictEqual(LB.mesoEarnTarget(1, 2, 8, null, 12), 8);  // last  → rangeMin
  });
  test('mesoEarnTarget: three sets interpolate to the midpoint in between', () => {
    assert.strictEqual(LB.mesoEarnTarget(0, 3, 8, null, 12), 12);
    assert.strictEqual(LB.mesoEarnTarget(1, 3, 8, null, 12), 10); // middle → rangeMid
    assert.strictEqual(LB.mesoEarnTarget(2, 3, 8, null, 12), 8);
  });
  test('mesoEarnTarget: a single working set targets the range midpoint', () => {
    assert.strictEqual(LB.mesoEarnTarget(0, 1, 8, null, 12), 10); // 8-12 → 10
  });
  test('mesoEarnTarget: no range (uniform) returns plannedReps unchanged', () => {
    assert.strictEqual(LB.mesoEarnTarget(0, 3, 10, null, null), 10);
    assert.strictEqual(LB.mesoEarnTarget(2, 3, 10, null, null), 10);
  });
  test('mesoEarnTarget: per-set targets win over the range ladder', () => {
    assert.strictEqual(LB.mesoEarnTarget(0, 2, 8, [6, 9], 12), 6);
    assert.strictEqual(LB.mesoEarnTarget(1, 2, 8, [6, 9], 12), 9);
  });

  // ── mesoRepOutcome, Range double progression: boost only earned at the top ──
  test('mesoRepOutcome (range 8-12): first tops out, last holds the floor → earn', () => {
    const out = LB.mesoRepOutcome([{ done: true, reps: 12 }, { done: true, reps: 8 }], 8, null, 12);
    assert.strictEqual(out.allHit, true);
    assert.strictEqual(out.earlyMiss, false);
  });
  test('mesoRepOutcome (range 8-12): first set below the top → no earn, but not a miss (weight holds)', () => {
    const out = LB.mesoRepOutcome([{ done: true, reps: 11 }, { done: true, reps: 8 }], 8, null, 12);
    assert.strictEqual(out.allHit, false);    // 11 < rangeMax → boost not earned
    assert.strictEqual(out.earlyMiss, false); // 11 >= floor 8 → weight not too heavy
  });
  test('mesoRepOutcome (range 8-12): an early set below the floor is still a miss (weight too heavy)', () => {
    const out = LB.mesoRepOutcome([{ done: true, reps: 7 }, { done: true, reps: 8 }], 8, null, 12);
    assert.strictEqual(out.allHit, false);
    assert.strictEqual(out.earlyMiss, true);  // 7 < floor 8
  });
  test('mesoRepOutcome (range, single set): earns only at the midpoint, not the floor', () => {
    assert.strictEqual(LB.mesoRepOutcome([{ done: true, reps: 9 }], 8, null, 12).allHit, false); // 9 < mid 10
    assert.strictEqual(LB.mesoRepOutcome([{ done: true, reps: 10 }], 8, null, 12).allHit, true);
  });
  test('mesoRepOutcome (range, single set): below the floor is a miss (single set is not exempt)', () => {
    const out = LB.mesoRepOutcome([{ done: true, reps: 7 }], 8, null, 12);
    assert.strictEqual(out.allHit, false);   // 7 < mid 10 → no earn
    assert.strictEqual(out.earlyMiss, true); // 7 < floor 8, and a lone set counts directly
  });
  test('mesoRepOutcome: no rep target at all (ad-hoc mid-session add) never earns a boost', () => {
    // A brand-new exercise carries no plannedReps until the post-session plan
    // wizard assigns one. Its earn gate must stay shut (there is no top-of-range
    // to clear) instead of auto-passing off any rep count, which used to fire a
    // weight bump on a fresh add. The miss gate stays permissive: no target so
    // nothing is "too heavy".
    const sets = [{ done: true, reps: 20 }, { done: true, reps: 20 }];
    const out = LB.mesoRepOutcome(sets, null, null, null);
    assert.strictEqual(out.allHit, false, 'no target → cannot earn a weight bump');
    assert.strictEqual(out.earlyMiss, false, 'no target → cannot be a rep miss either');
  });
  test('mesoRepOutcome (per-set): the MISS gate uses each set\'s own per-set floor, last set exempt', () => {
    // first set under its per-set target 10 → early miss
    assert.strictEqual(LB.mesoRepOutcome([{ done: true, reps: 9 }, { done: true, reps: 8 }], null, [10, 8], null).earlyMiss, true);
    // only the LAST set is low (5 < 8); it is exempt, so no early miss
    assert.strictEqual(LB.mesoRepOutcome([{ done: true, reps: 10 }, { done: true, reps: 5 }], null, [10, 8], null).earlyMiss, false);
  });

  // ── reshapeSetsUnilateral (set rep shape follows a swap's unilateral-ness) ──
  // (field-by-field asserts: the vm realm's distinct Object.prototype trips
  // deepStrictEqual, same as the rest of this suite avoids it.)
  test('reshapeSetsUnilateral: unilateral → bilateral collapses L/R to the min single rep', () => {
    const out = LB.reshapeSetsUnilateral([{ kg: 50, repsL: 13, repsR: 12 }, { kg: 50, repsL: 12, repsR: 12 }], false);
    assert.strictEqual(out[0].reps, 12); assert.strictEqual(out[0].repsL, null); assert.strictEqual(out[0].repsR, null); assert.strictEqual(out[0].kg, 50);
    assert.strictEqual(out[1].reps, 12); assert.strictEqual(out[1].repsL, null); assert.strictEqual(out[1].repsR, null);
  });
  test('reshapeSetsUnilateral: bilateral → unilateral mirrors the single rep onto both sides', () => {
    const out = LB.reshapeSetsUnilateral([{ kg: 50, reps: 13 }], true);
    assert.strictEqual(out[0].repsL, 13); assert.strictEqual(out[0].repsR, 13); assert.strictEqual(out[0].reps, null); assert.strictEqual(out[0].kg, 50);
  });
  test('reshapeSetsUnilateral: sets already in the target shape (or empty) pass through untouched', () => {
    const already = [{ kg: 50, reps: 10 }];
    assert.strictEqual(LB.reshapeSetsUnilateral(already, false)[0], already[0], 'no needless rewrite');
    const empty = [{ kg: null, reps: null }];
    assert.strictEqual(LB.reshapeSetsUnilateral(empty, true)[0], empty[0], 'nothing logged to mirror');
  });
  test('reshapeSetsUnilateral: a one-sided log still collapses to that side\'s reps', () => {
    const out = LB.reshapeSetsUnilateral([{ kg: 40, repsL: 8, repsR: null }], false);
    assert.strictEqual(out[0].reps, 8); assert.strictEqual(out[0].repsL, null); assert.strictEqual(out[0].repsR, null);
  });

  // ── reearnMesoWeightBoosts (weight boost must be re-earned every session) ──
  test('reearnMesoWeightBoosts: a boost not re-earned this session is dropped, not kept', () => {
    // bench earned a boost last session but is trained again this session with
    // no boost earned → its stale boost must be cleared, not carried forward.
    const out = LB.reearnMesoWeightBoosts({ bench_d1: 2.5 }, ['bench_d1'], {});
    assert.ok(!('bench_d1' in out), 'stale boost must be removed');
  });
  test('reearnMesoWeightBoosts: a boost re-earned this session is set to the new value', () => {
    const out = LB.reearnMesoWeightBoosts({ bench_d1: 2.5 }, ['bench_d1'], { bench_d1: 2.5 });
    assert.strictEqual(out.bench_d1, 2.5);
  });
  test('reearnMesoWeightBoosts: other training days\' boosts are left untouched', () => {
    // squat (a different day, not in this session's keys) keeps its boost even
    // though bench (this session) earned nothing.
    const out = LB.reearnMesoWeightBoosts({ bench_d1: 2.5, squat_d2: 5 }, ['bench_d1'], {});
    assert.ok(!('bench_d1' in out), 'this session\'s un-earned boost dropped');
    assert.strictEqual(out.squat_d2, 5, 'other day\'s boost preserved');
  });
  test('reearnMesoWeightBoosts: earning on a fresh key adds it', () => {
    const out = LB.reearnMesoWeightBoosts({}, ['bench_d1'], { bench_d1: 2.5 });
    assert.strictEqual(out.bench_d1, 2.5);
  });
  test('reearnMesoWeightBoosts: null/empty inputs are safe', () => {
    assert.strictEqual(JSON.stringify(LB.reearnMesoWeightBoosts(null, [], null)), '{}');
    assert.strictEqual(JSON.stringify(LB.reearnMesoWeightBoosts(undefined, undefined, undefined)), '{}');
  });

  // ── revertMesoSessionBoosts (delete a meso session → drop its orphaned boost) ──
  const mesoStateWB = { weightBoosts: { tri_d1: 2.5, chest_d1: 5, tri_d2: 2.5 }, repMissCounts: { tri_d1: 1 } };
  const delSess = { id: 'A', dayId: 'd1', ended: '2026-07-15T10:00:00Z', entries: [{ exId: 'tri' }, { exId: 'chest' }] };
  test('revertMesoSessionBoosts: clears the deleted session\'s day keys, leaves other days', () => {
    const out = LB.revertMesoSessionBoosts(mesoStateWB, delSess, []);
    assert.ok(!('tri_d1' in out.weightBoosts), 'tri_d1 boost dropped');
    assert.ok(!('chest_d1' in out.weightBoosts), 'chest_d1 boost dropped');
    assert.strictEqual(out.weightBoosts.tri_d2, 2.5, 'a different day\'s boost is untouched');
    assert.ok(!('tri_d1' in out.repMissCounts), 'tri_d1 rep-miss count dropped');
  });
  test('revertMesoSessionBoosts: a later same-day session keeps ITS retrained key, orphans the rest', () => {
    const later = { id: 'B', dayId: 'd1', ended: '2026-07-16T10:00:00Z', entries: [{ exId: 'tri' }] };
    const out = LB.revertMesoSessionBoosts(mesoStateWB, delSess, [later]);
    assert.strictEqual(out.weightBoosts.tri_d1, 2.5, 'tri retrained later → its boost survives');
    assert.ok(!('chest_d1' in out.weightBoosts), 'chest NOT retrained later → orphaned boost cleared');
    assert.strictEqual(out.weightBoosts.tri_d2, 2.5, 'a different day is untouched');
    assert.strictEqual(out.repMissCounts.tri_d1, 1, 'tri rep-miss count survives too');
  });
  test('revertMesoSessionBoosts: a later same-day session that retrained ALL exercises is a full no-op', () => {
    const later = { id: 'B', dayId: 'd1', ended: '2026-07-16T10:00:00Z', entries: [{ exId: 'tri' }, { exId: 'chest' }] };
    assert.strictEqual(LB.revertMesoSessionBoosts(mesoStateWB, delSess, [later]), mesoStateWB);
  });
  test('revertMesoSessionBoosts: an OLDER same-day session does not block the rollback', () => {
    const older = { id: 'Z', dayId: 'd1', ended: '2026-07-14T10:00:00Z', entries: [{ exId: 'tri' }] };
    const out = LB.revertMesoSessionBoosts(mesoStateWB, delSess, [older]);
    assert.ok(!('tri_d1' in out.weightBoosts));
  });
  test('revertMesoSessionBoosts: deleting a deload session is a no-op', () => {
    const out = LB.revertMesoSessionBoosts(mesoStateWB, { ...delSess, isDeload: true }, []);
    assert.strictEqual(out, mesoStateWB);
  });
  test('revertMesoSessionBoosts: no entries / no dayId is a safe no-op', () => {
    assert.strictEqual(LB.revertMesoSessionBoosts(mesoStateWB, { id: 'A', dayId: 'd1', entries: [] }, []), mesoStateWB);
    assert.strictEqual(LB.revertMesoSessionBoosts(mesoStateWB, { id: 'A', dayId: null, entries: [{ exId: 'tri' }] }, []), mesoStateWB);
  });
  test('revertMesoSessionBoosts: nothing to clear returns the same object (no churn)', () => {
    const clean = { weightBoosts: { other_d9: 2.5 }, repMissCounts: {} };
    assert.strictEqual(LB.revertMesoSessionBoosts(clean, delSess, []), clean);
  });
  test('revertMesoSessionBoosts: cardio entries are ignored when building keys', () => {
    const st = { weightBoosts: { tri_d1: 2.5 }, repMissCounts: {} };
    const sess = { id: 'A', dayId: 'd1', ended: '2026-07-15T10:00:00Z', entries: [{ isCardio: true }, { exId: 'tri' }] };
    const out = LB.revertMesoSessionBoosts(st, sess, []);
    assert.ok(!('tri_d1' in out.weightBoosts));
  });

  // ── isMesoSessionEditable (only the plan's most-recent session, with raw) ──
  {
    const meso = { scheduleId: 'p1', startedAt: '2026-07-01T00:00:00Z' };
    const withRaw = (over) => ({ id: 'S', scheduleId: 'p1', ended: '2026-07-15T10:00:00Z',
      mesoRecap: { raw: { answers: {} } }, ...over });
    test('isMesoSessionEditable: most-recent session of the plan with raw → true', () => {
      const s = withRaw();
      assert.strictEqual(LB.isMesoSessionEditable(s, [s], meso), true);
    });
    test('isMesoSessionEditable: a later session on the same plan → false', () => {
      const s = withRaw();
      const later = { id: 'L', scheduleId: 'p1', ended: '2026-07-16T10:00:00Z' };
      assert.strictEqual(LB.isMesoSessionEditable(s, [s, later], meso), false);
    });
    test('isMesoSessionEditable: a later session on a DIFFERENT plan does not lock it', () => {
      const s = withRaw();
      const otherPlan = { id: 'O', scheduleId: 'p2', ended: '2026-07-20T10:00:00Z' };
      assert.strictEqual(LB.isMesoSessionEditable(s, [s, otherPlan], meso), true);
    });
    test('isMesoSessionEditable: deload / no-raw / prior-block / live-session → false', () => {
      assert.strictEqual(LB.isMesoSessionEditable(withRaw({ isDeload: true }), [], meso), false);
      assert.strictEqual(LB.isMesoSessionEditable({ id: 'S', scheduleId: 'p1', ended: '2026-07-15T10:00:00Z' }, [], meso), false);
      assert.strictEqual(LB.isMesoSessionEditable(withRaw({ ended: '2026-06-01T00:00:00Z' }), [], meso), false); // before startedAt
      const s = withRaw();
      const live = { id: 'IP', scheduleId: 'p1', ended: null };
      assert.strictEqual(LB.isMesoSessionEditable(s, [s, live], meso), false);
    });
  }

  // ── applyMesoFeedbackEdit (post-hoc feedback correction, mirrors the handlers) ──
  test('applyMesoFeedbackEdit: no-op edit (same answer) leaves state byte-identical', () => {
    const ms = { deltas: { e1_d0: -1 }, growthCounts: {}, pumpLowCounts: {}, jointFlags: {} };
    const raw = { answers: { soreness: { chest: { muscle: 'chest', targets: [{ exId: 'e1', name: 'Bench', key: 'e1_d0' }], answer: 'still_sore', contrib: { e1_d0: -1 } } }, joint: {}, volume: {} }, negOwner: { e1_d0: 'soreness' }, frozen: false, dayId: 'd0' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'soreness', subject: 'chest', answer: 'still_sore' }, { dayId: 'd0', loadOnly: false });
    assert.strictEqual(JSON.stringify(out.mesoState.deltas), JSON.stringify({ e1_d0: -1 }));
    assert.strictEqual(JSON.stringify(out.mesoState.growthCounts), '{}');
    assert.strictEqual(JSON.stringify(out.raw.negOwner), JSON.stringify({ e1_d0: 'soreness' }));
  });
  test('applyMesoFeedbackEdit: soreness still_sore → never flips a -1 decline into a +1 growth grant', () => {
    const ms = { deltas: { e1_d0: -1 }, growthCounts: {}, pumpLowCounts: {}, jointFlags: {} };
    const raw = { answers: { soreness: { chest: { muscle: 'chest', targets: [{ exId: 'e1', name: 'Bench', key: 'e1_d0' }], answer: 'still_sore', contrib: { e1_d0: -1 } } }, joint: {}, volume: {} }, negOwner: { e1_d0: 'soreness' }, frozen: false, dayId: 'd0' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'soreness', subject: 'chest', answer: 'never' }, { dayId: 'd0', loadOnly: false });
    assert.strictEqual(out.mesoState.deltas.e1_d0, 1);      // -1 -> +1 (diff +2 applied)
    assert.strictEqual(out.mesoState.growthCounts.e1_d0, 1); // growth granted
    assert.ok(!('e1_d0' in out.raw.negOwner), 'negative slot released');
  });
  test('applyMesoFeedbackEdit: soreness never with 2+ targets grants +1 to the LEAST-grown target', () => {
    const ms = { deltas: {}, growthCounts: { e1_d0: 2, e2_d0: 0 }, pumpLowCounts: {}, jointFlags: {} };
    const raw = { answers: { soreness: { chest: { muscle: 'chest', targets: [{ exId: 'e1', name: 'Bench', key: 'e1_d0' }, { exId: 'e2', name: 'Fly', key: 'e2_d0' }], answer: 'healed_just', contrib: {} } }, joint: {}, volume: {} }, negOwner: {}, frozen: false, dayId: 'd0' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'soreness', subject: 'chest', answer: 'never' }, { dayId: 'd0', loadOnly: false });
    assert.strictEqual(out.mesoState.deltas.e2_d0, 1, '+1 lands on the least-grown target e2');
    assert.ok(!out.mesoState.deltas.e1_d0, 'the more-grown target e1 gets nothing');
    assert.strictEqual(out.mesoState.growthCounts.e2_d0, 1, 'growth count advances on e2');
  });
  test('applyMesoFeedbackEdit: soreness still_sore with 2+ targets cuts the MOST-grown target', () => {
    const ms = { deltas: { e1_d0: 2, e2_d0: 0 }, growthCounts: {}, pumpLowCounts: {}, jointFlags: {} };
    const raw = { answers: { soreness: { chest: { muscle: 'chest', targets: [{ exId: 'e1', name: 'Bench', key: 'e1_d0' }, { exId: 'e2', name: 'Fly', key: 'e2_d0' }], answer: 'healed_just', contrib: {} } }, joint: {}, volume: {} }, negOwner: {}, frozen: false, dayId: 'd0' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'soreness', subject: 'chest', answer: 'still_sore' }, { dayId: 'd0', loadOnly: false });
    assert.strictEqual(out.mesoState.deltas.e1_d0, 1, '-1 lands on the most-grown target e1 (2 -> 1)');
    assert.strictEqual(out.raw.negOwner.e1_d0, 'soreness', 'soreness claims the negative slot');
  });
  test('applyMesoFeedbackEdit: joint sharp → none clears the -1 and keeps a baseline flag', () => {
    const ms = { deltas: { e1_d1: -1 }, growthCounts: {}, pumpLowCounts: {}, jointFlags: { e1: true } };
    const raw = { answers: { soreness: {}, joint: { e1: { exId: 'e1', muscle: 'chest', exName: 'Bench', flagBaseline: true, answer: 'sharp', contrib: { e1_d1: -1 } } }, volume: {} }, negOwner: { e1_d1: 'joint' }, frozen: false, dayId: 'd1' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'joint', subject: 'e1', answer: 'none' }, { dayId: 'd1', loadOnly: false });
    assert.strictEqual(out.mesoState.deltas.e1_d1, 0);       // -1 undone
    assert.strictEqual(out.mesoState.jointFlags.e1, true);   // baseline flag NOT erased
  });
  test('applyMesoFeedbackEdit: joint none → sharp sets the flag and a -1', () => {
    const ms = { deltas: {}, growthCounts: {}, pumpLowCounts: {}, jointFlags: {} };
    const raw = { answers: { soreness: {}, joint: { e1: { exId: 'e1', muscle: 'chest', exName: 'Bench', flagBaseline: false, answer: 'none', contrib: { e1_d1: 0 } } }, volume: {} }, negOwner: {}, frozen: false, dayId: 'd1' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'joint', subject: 'e1', answer: 'sharp' }, { dayId: 'd1', loadOnly: false });
    assert.strictEqual(out.mesoState.deltas.e1_d1, -1);
    assert.strictEqual(out.mesoState.jointFlags.e1, true);
    assert.strictEqual(out.raw.negOwner.e1_d1, 'joint');
  });
  test('applyMesoFeedbackEdit: volume too_much → just_right removes the -1s', () => {
    const ms = { deltas: { e1_d1: -1, e2_d1: -1 }, growthCounts: {}, pumpLowCounts: {}, jointFlags: {} };
    const raw = { answers: { soreness: {}, joint: {}, volume: { chest: { muscle: 'chest', exIds: ['e1', 'e2'], pump: 'moderate', volume: 'too_much', contrib: { e1_d1: -1, e2_d1: -1 } } } }, negOwner: { e1_d1: 'volume', e2_d1: 'volume' }, frozen: false, dayId: 'd1' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'volume', subject: 'chest', answer: null, pump: 'moderate', volume: 'just_right' }, { dayId: 'd1', loadOnly: false });
    assert.strictEqual(out.mesoState.deltas.e1_d1, 0);
    assert.strictEqual(out.mesoState.deltas.e2_d1, 0);
  });
  test('applyMesoFeedbackEdit: volume not_enough grants +1 to the LEAST-grown exercise', () => {
    const ms = { deltas: {}, growthCounts: { e1_d1: 3, e2_d1: 0 }, pumpLowCounts: {}, jointFlags: {} };
    const raw = { answers: { soreness: {}, joint: {}, volume: { chest: { muscle: 'chest', exIds: ['e1', 'e2'], pump: 'moderate', volume: 'just_right', contrib: { e1_d1: 0, e2_d1: 0 } } } }, negOwner: {}, frozen: false, dayId: 'd1' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'volume', subject: 'chest', pump: 'moderate', volume: 'not_enough' }, { dayId: 'd1', loadOnly: false });
    assert.strictEqual(out.mesoState.deltas.e2_d1, 1, '+1 lands on the least-grown e2');
    assert.ok(!out.mesoState.deltas.e1_d1, 'the more-grown e1 gets nothing');
    assert.strictEqual(out.mesoState.growthCounts.e2_d1, 1, 'growth count advances on e2');
  });
  test('applyMesoFeedbackEdit: volume pushed cuts the MOST-grown exercise and claims the neg slot', () => {
    const ms = { deltas: { e1_d1: 2, e2_d1: 0 }, growthCounts: {}, pumpLowCounts: {}, jointFlags: {} };
    const raw = { answers: { soreness: {}, joint: {}, volume: { chest: { muscle: 'chest', exIds: ['e1', 'e2'], pump: 'moderate', volume: 'just_right', contrib: { e1_d1: 0, e2_d1: 0 } } } }, negOwner: {}, frozen: false, dayId: 'd1' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'volume', subject: 'chest', pump: 'moderate', volume: 'pushed' }, { dayId: 'd1', loadOnly: false });
    assert.strictEqual(out.mesoState.deltas.e1_d1, 1, '-1 lands on the most-grown e1 (2 -> 1)');
    assert.strictEqual(out.raw.negOwner.e1_d1, 'volume', 'volume claims the negative slot');
    assert.strictEqual(out.mesoState.deltas.e2_d1, 0, 'the un-grown e2 is untouched');
  });
  test('applyMesoFeedbackEdit: negOwner stops a second question stacking a -1 on the same key', () => {
    const ms = { deltas: { e1_d1: -1 }, growthCounts: {}, pumpLowCounts: {}, jointFlags: {} };
    const raw = { answers: { soreness: {}, joint: {}, volume: { chest: { muscle: 'chest', exIds: ['e1'], pump: 'moderate', volume: 'just_right', contrib: {} } } }, negOwner: { e1_d1: 'joint' }, frozen: false, dayId: 'd1' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'volume', subject: 'chest', pump: 'moderate', volume: 'too_much' }, { dayId: 'd1', loadOnly: false });
    assert.strictEqual(out.mesoState.deltas.e1_d1, -1); // volume's -1 suppressed (joint owns the slot)
  });
  test('applyMesoFeedbackEdit: load-only soreness never touches deltas', () => {
    const ms = { deltas: {}, growthCounts: {}, pumpLowCounts: {}, jointFlags: {} };
    const raw = { answers: { soreness: { chest: { muscle: 'chest', targets: [{ exId: 'e1', name: 'Bench', key: 'e1_d0' }], answer: 'still_sore', contrib: {} } }, joint: {}, volume: {} }, negOwner: {}, frozen: false, dayId: 'd0' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'soreness', subject: 'chest', answer: 'never' }, { dayId: 'd0', loadOnly: true });
    assert.strictEqual(JSON.stringify(out.mesoState.deltas), '{}');
    assert.strictEqual(out.raw.answers.soreness.chest.answer, 'never');
  });
  test('applyMesoFeedbackEdit: frozen (final week) volume edit never moves deltas', () => {
    const ms = { deltas: {}, growthCounts: {}, pumpLowCounts: {}, jointFlags: {} };
    const raw = { answers: { soreness: {}, joint: {}, volume: { chest: { muscle: 'chest', exIds: ['e1'], volume: 'just_right', contrib: {} } } }, negOwner: {}, frozen: true, dayId: 'd1' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'volume', subject: 'chest', volume: 'not_enough' }, { dayId: 'd1', loadOnly: false });
    assert.strictEqual(JSON.stringify(out.mesoState.deltas), '{}', 'frozen: a workload edit earns no set delta');
  });

  // ── reearnMesoBoostsFromAnswers (weight re-earn from edited gates) ──
  // New model: joint, pump AND weight-feel are all per exId on the joint record, in
  // every mode. volumeOk is gone (workload only drives set deltas). soreness holds
  // the weight in load-only only.
  const earnInputs = [{ exId: 'e1', key: 'e1_d1', muscle: 'chest', allHit: true, increment: 2.5 }];
  const passAnswers = { joint: { e1: { answer: 'none', pump: 'amazing', weight: 'just_right' } }, volume: { chest: { muscle: 'chest', exIds: ['e1'], volume: 'just_right' } }, soreness: {} };
  test('reearnMesoBoostsFromAnswers: all gates pass + allHit → boost earned', () => {
    const out = LB.reearnMesoBoostsFromAnswers({ weightBoosts: {} }, passAnswers, earnInputs, false);
    assert.strictEqual(out.weightBoosts.e1_d1, 2.5);
  });
  test('reearnMesoBoostsFromAnswers: a too-heavy weight-feel drops the boost (Volume+Load, per exId)', () => {
    const ans = { joint: { e1: { answer: 'none', pump: 'amazing', weight: 'too_much' } }, volume: { chest: { muscle: 'chest', exIds: ['e1'], volume: 'just_right' } }, soreness: {} };
    const out = LB.reearnMesoBoostsFromAnswers({ weightBoosts: { e1_d1: 2.5 } }, ans, earnInputs, false);
    assert.ok(!('e1_d1' in out.weightBoosts));
  });
  test('reearnMesoBoostsFromAnswers: a low pump drops the boost (per exId, every mode)', () => {
    const ans = { joint: { e1: { answer: 'none', pump: 'low', weight: 'just_right' } }, volume: { chest: { muscle: 'chest', exIds: ['e1'], volume: 'just_right' } }, soreness: {} };
    const out = LB.reearnMesoBoostsFromAnswers({ weightBoosts: { e1_d1: 2.5 } }, ans, earnInputs, false);
    assert.ok(!('e1_d1' in out.weightBoosts));
  });
  test('reearnMesoBoostsFromAnswers: a rep-miss cut (negative) is preserved, feedback cannot erase it', () => {
    const missInputs = [{ exId: 'e1', key: 'e1_d1', muscle: 'chest', allHit: false, increment: 2.5 }];
    const out = LB.reearnMesoBoostsFromAnswers({ weightBoosts: { e1_d1: -2.5 } }, passAnswers, missInputs, false);
    assert.strictEqual(out.weightBoosts.e1_d1, -2.5);
  });
  test('reearnMesoBoostsFromAnswers: load-only still-sore muscle blocks the boost (all other gates green)', () => {
    const ans = { joint: { e1: { answer: 'none', pump: 'amazing', weight: 'just_right' } }, volume: { chest: { muscle: 'chest', exIds: ['e1'] } }, soreness: { chest: { muscle: 'chest', answer: 'still_sore' } } };
    const out = LB.reearnMesoBoostsFromAnswers({ weightBoosts: {} }, ans, earnInputs, true);
    assert.ok(!('e1_d1' in out.weightBoosts));
  });
  // ── per-exercise gates in every mode (pump + weight-feel keyed by exId) ──
  test('mesoGateSetsFromAnswers: pump and weight-feel are per exId in every mode, no volumeOk', () => {
    const a = { joint: { e1: { answer: 'none', pump: 'moderate', weight: 'just_right' }, e2: { answer: 'none', pump: 'low', weight: 'too_much' } }, volume: { chest: { muscle: 'chest', exIds: ['e1', 'e2'], volume: 'just_right' } }, soreness: { chest: { muscle: 'chest', answer: 'still_sore' } } };
    const g = LB.mesoGateSetsFromAnswers(a, false);
    assert.ok(g.pumpOk.has('e1') && !g.pumpOk.has('e2'), 'pump gate per exId');
    assert.ok(g.weightOk.has('e1') && !g.weightOk.has('e2'), 'weight gate per exId even in Volume+Load');
    assert.ok(g.soreBlock.has('chest'), 'soreness stays per muscle');
    assert.strictEqual(g.volumeOk, undefined, 'volumeOk no longer exists');
  });
  test('mesoGateSetsFromAnswers: weight-feel keyed by exId from joint[exId].weight (load-only)', () => {
    const a = { joint: { e1: { answer: 'none', pump: 'moderate', weight: 'just_right' }, e2: { answer: 'none', pump: 'moderate', weight: 'too_much' } }, volume: { chest: { muscle: 'chest' } }, soreness: {} };
    const g = LB.mesoGateSetsFromAnswers(a, true);
    assert.ok(g.weightOk.has('e1'), 'e1 (just_right) allows the bump');
    assert.ok(!g.weightOk.has('e2'), 'e2 (too heavy) holds only itself');
    assert.ok(g.pumpOk.has('e1') && g.pumpOk.has('e2'), 'pump now per exId');
  });
  test('mesoGateSetsFromAnswers: legacy per-muscle fallback spreads BOTH pump and weight over the muscle exIds', () => {
    const a = { joint: { e1: { answer: 'none' }, e2: { answer: 'none' } }, volume: { chest: { muscle: 'chest', exIds: ['e1', 'e2'], pump: 'moderate', volume: 'just_right' } }, soreness: {} };
    const g = LB.mesoGateSetsFromAnswers(a, true);
    assert.ok(g.weightOk.has('e1') && g.weightOk.has('e2'), 'legacy just_right weight spreads over both exIds');
    assert.ok(g.pumpOk.has('e1') && g.pumpOk.has('e2'), 'legacy moderate pump spreads over both exIds');
  });
  test('mesoGateSetsFromAnswers: old Volume+Load session falls back to volume[muscle].volume with workload semantics', () => {
    // Old A/C session: no per-exercise weight-feel, weight was gated by the workload
    // answer. "pushed" blocked the bump in workload semantics (loadOnly=false), and the
    // fallback must reproduce that (a weight-feel "pushed"/"hard" would ALLOW it).
    const a = { joint: { e1: { answer: 'none' }, e2: { answer: 'none' } }, volume: { chest: { muscle: 'chest', exIds: ['e1', 'e2'], pump: 'moderate', volume: 'pushed' } }, soreness: {} };
    assert.ok(!LB.mesoGateSetsFromAnswers(a, false).weightOk.has('e1'), 'pushed workload blocks the bump in old A/C');
    assert.ok(LB.mesoGateSetsFromAnswers(a, true).weightOk.has('e1'), 'the same code as a load-only weight answer would allow it');
  });
  test('mesoGateSetsFromAnswers: per-exId weight wins over the legacy per-muscle answer (no union)', () => {
    const a = { joint: { e1: { answer: 'none', pump: 'moderate', weight: 'too_much' }, e2: { answer: 'none', pump: 'moderate', weight: 'just_right' } }, volume: { chest: { muscle: 'chest', exIds: ['e1', 'e2'], volume: 'just_right' } }, soreness: {} };
    const g = LB.mesoGateSetsFromAnswers(a, false);
    assert.ok(!g.weightOk.has('e1'), 'per-exId too_much is not overridden by the muscle just_right');
    assert.ok(g.weightOk.has('e2'));
  });
  test('mesoGateSetsFromAnswers: MIXED raw resolves per exId (own weight wins, unweighted falls back), no cross-pollution', () => {
    const a = { joint: { e1: { answer: 'none', pump: 'moderate' }, e2: { answer: 'none', pump: 'moderate', weight: 'just_right' } }, volume: { chest: { muscle: 'chest', exIds: ['e1', 'e2'], volume: 'too_much' } }, soreness: {} };
    const g = LB.mesoGateSetsFromAnswers(a, false);
    assert.ok(g.weightOk.has('e2'), 'e2 keeps its own just_right, the muscle too_much never touches it');
    assert.ok(!g.weightOk.has('e1'), 'e1 (no per-exercise weight) inherits the muscle too_much hold');
  });
  test('mesoGateSetsFromAnswers: MIXED raw, a GRANTING muscle answer is inherited by the unanswered sibling (weight and pump)', () => {
    // The load-bearing mixed case: muscle answer GRANTS, e2 has its own answer, e1 is
    // unanswered and must inherit the muscle grant (not be silently dropped).
    const a = { joint: { e1: { answer: 'none' }, e2: { answer: 'none', pump: 'moderate', weight: 'just_right' } }, volume: { chest: { muscle: 'chest', exIds: ['e1', 'e2'], pump: 'moderate', volume: 'just_right' } }, soreness: {} };
    const g = LB.mesoGateSetsFromAnswers(a, false);
    assert.ok(g.weightOk.has('e1') && g.weightOk.has('e2'), 'e1 inherits the muscle just_right weight, e2 keeps its own');
    assert.ok(g.pumpOk.has('e1') && g.pumpOk.has('e2'), 'e1 inherits the muscle moderate pump, e2 keeps its own');
  });
  test('reearnMesoBoostsFromAnswers: a muscle-less exercise with no per-exercise pump/weight earns on reps + joint alone', () => {
    // An untagged (muscle-less) exercise in a pre-change session has no per-exercise
    // pump/weight and no muscle rec to fall back on. It must stay exempt from those
    // gates, not lose its bump on a later edit.
    const inputs = [{ exId: 'x1', key: 'x1_d1', muscle: null, allHit: true, increment: 2.5 }];
    const ans = { joint: { x1: { answer: 'none' } }, volume: {}, soreness: {} };
    const out = LB.reearnMesoBoostsFromAnswers({ weightBoosts: { x1_d1: 2.5 } }, ans, inputs, false);
    assert.strictEqual(out.weightBoosts.x1_d1, 2.5, 'muscle-less exercise keeps its bump (pump/weight gates exempt)');
  });
  test('reearnMesoBoostsFromAnswers: a muscle-less exercise WITH its own too-heavy weight is still gated', () => {
    const inputs = [{ exId: 'x1', key: 'x1_d1', muscle: null, allHit: true, increment: 2.5 }];
    const ans = { joint: { x1: { answer: 'none', pump: 'amazing', weight: 'too_much' } }, volume: {}, soreness: {} };
    const out = LB.reearnMesoBoostsFromAnswers({ weightBoosts: { x1_d1: 2.5 } }, ans, inputs, false);
    assert.ok(!('x1_d1' in out.weightBoosts), 'once it has its own weight answer, the gate applies even without a muscle');
  });
  test('reearnMesoBoostsFromAnswers: holds only the too-heavy exercise, bumps the others (same muscle, per exId)', () => {
    const inputs = [
      { exId: 'e1', key: 'e1_d1', muscle: 'shoulders', allHit: true, increment: 2.5 },
      { exId: 'e2', key: 'e2_d1', muscle: 'shoulders', allHit: true, increment: 2.5 },
    ];
    const ans = {
      joint: { e1: { answer: 'none', pump: 'moderate', weight: 'just_right' }, e2: { answer: 'none', pump: 'moderate', weight: 'too_much' } },
      volume: { shoulders: { muscle: 'shoulders' } }, soreness: {},
    };
    const out = LB.reearnMesoBoostsFromAnswers({ weightBoosts: {} }, ans, inputs, false);
    assert.strictEqual(out.weightBoosts.e1_d1, 2.5, 'e1 (just right) bumps');
    assert.ok(!('e2_d1' in out.weightBoosts), 'e2 (too heavy) holds, same muscle');
  });
  test('applyMesoFeedbackEdit: a joint weight edit updates joint[exId].weight, no set delta, and re-earn follows', () => {
    const ms = { deltas: {}, growthCounts: {}, pumpLowCounts: {}, jointFlags: {} };
    const raw = { answers: { soreness: {}, joint: { e1: { exId: 'e1', muscle: 'shoulders', answer: 'none', pump: 'amazing', weight: 'just_right', contrib: {} } }, volume: { shoulders: { muscle: 'shoulders', exIds: ['e1'] } } }, negOwner: {}, frozen: true, dayId: 'd1' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'joint', subject: 'e1', answer: 'none', weight: 'too_much' }, { dayId: 'd1', loadOnly: true });
    assert.strictEqual(out.raw.answers.joint.e1.weight, 'too_much', 'weight persisted on the joint record');
    assert.strictEqual(out.raw.answers.joint.e1.answer, 'none', 'joint answer preserved');
    assert.strictEqual(JSON.stringify(out.mesoState.deltas), '{}', 'frozen: no set delta from a weight edit');
    const inputs = [{ exId: 'e1', key: 'e1_d1', muscle: 'shoulders', allHit: true, increment: 2.5 }];
    const re = LB.reearnMesoBoostsFromAnswers(out.mesoState, out.raw.answers, inputs, true);
    assert.ok(!('e1_d1' in re.weightBoosts), 'after editing to too heavy, the boost is withheld');
  });
  test('applyMesoFeedbackEdit: a joint edit carrying pump updates the record and the per-exId low-pump counter', () => {
    const ms = { deltas: {}, growthCounts: {}, pumpLowCounts: {}, jointFlags: {} };
    const raw = { answers: { soreness: {}, joint: { e1: { exId: 'e1', muscle: 'chest', answer: 'none', pump: 'moderate', weight: 'just_right', contrib: {} } }, volume: { chest: { muscle: 'chest', exIds: ['e1'], volume: 'just_right' } } }, negOwner: {}, frozen: false, dayId: 'd1' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'joint', subject: 'e1', answer: 'none', weight: 'just_right', pump: 'low' }, { dayId: 'd1', loadOnly: false });
    assert.strictEqual(out.raw.answers.joint.e1.pump, 'low', 'pump persisted on the joint record');
    assert.strictEqual(out.mesoState.pumpLowCounts.e1, 1, 'low-pump counter incremented for this exId');
    assert.strictEqual(out.raw.answers.joint.e1.pumpLowApplied, true);
  });
  test('applyMesoFeedbackEdit: editing pump back up decrements the per-exId low-pump counter (idempotent)', () => {
    const ms = { deltas: {}, growthCounts: {}, pumpLowCounts: { e1: 1 }, jointFlags: {} };
    const raw = { answers: { soreness: {}, joint: { e1: { exId: 'e1', muscle: 'chest', answer: 'none', pump: 'low', pumpLowApplied: true, weight: 'just_right', contrib: {} } }, volume: {} }, negOwner: {}, frozen: false, dayId: 'd1' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'joint', subject: 'e1', answer: 'none', weight: 'just_right', pump: 'amazing' }, { dayId: 'd1', loadOnly: false });
    assert.strictEqual(out.mesoState.pumpLowCounts.e1, 0, 'counter goes back down');
    assert.strictEqual(out.raw.answers.joint.e1.pumpLowApplied, false);
  });
  test('applyMesoFeedbackEdit: an affinity edit sets the sticky value and advances the streak from the stored base', () => {
    // affinityStreakBase (captured live = the streak BEFORE this session) is 1, so a
    // dislike edit lands the streak at 2 (fires the adherence swap hint). It gates
    // nothing: no delta, no weight change.
    const ms = { deltas: {}, growthCounts: {}, pumpLowCounts: {}, jointFlags: {}, affinity: { e1: { v: 'dislike', streak: 2 } } };
    const raw = { answers: { soreness: {}, joint: { e1: { exId: 'e1', muscle: 'chest', answer: 'none', pump: 'moderate', weight: 'just_right', affinity: 'ok', affinityStreakBase: 1, contrib: {} } }, volume: {} }, negOwner: {}, frozen: false, dayId: 'd1' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'joint', subject: 'e1', answer: 'none', weight: 'just_right', pump: 'moderate', affinity: 'dislike' }, { dayId: 'd1', loadOnly: false });
    assert.strictEqual(out.raw.answers.joint.e1.affinity, 'dislike', 'answer persisted');
    assert.strictEqual(out.mesoState.affinity.e1.v, 'dislike');
    assert.strictEqual(out.mesoState.affinity.e1.streak, 2, 'streak = base(1) + 1');
    assert.strictEqual(JSON.stringify(out.mesoState.deltas), '{}', 'affinity moves no set delta');
  });
  test('applyMesoFeedbackEdit: editing affinity to love resets the streak to 0', () => {
    const ms = { deltas: {}, growthCounts: {}, pumpLowCounts: {}, jointFlags: {}, affinity: { e1: { v: 'dislike', streak: 2 } } };
    const raw = { answers: { soreness: {}, joint: { e1: { exId: 'e1', muscle: 'chest', answer: 'none', pump: 'moderate', weight: 'just_right', affinity: 'dislike', affinityStreakBase: 1, contrib: {} } }, volume: {} }, negOwner: {}, frozen: false, dayId: 'd1' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'joint', subject: 'e1', answer: 'none', weight: 'just_right', pump: 'moderate', affinity: 'love' }, { dayId: 'd1', loadOnly: false });
    assert.strictEqual(out.mesoState.affinity.e1.v, 'love');
    assert.strictEqual(out.mesoState.affinity.e1.streak, 0, 'love resets the streak');
  });
  test('applyMesoFeedbackEdit: a null affinity (deselected) leaves the sticky value and streak untouched', () => {
    const ms = { deltas: {}, growthCounts: {}, pumpLowCounts: {}, jointFlags: {}, affinity: { e1: { v: 'dislike', streak: 2 } } };
    const raw = { answers: { soreness: {}, joint: { e1: { exId: 'e1', muscle: 'chest', answer: 'none', pump: 'moderate', weight: 'just_right', affinity: 'dislike', affinityStreakBase: 1, contrib: {} } }, volume: {} }, negOwner: {}, frozen: false, dayId: 'd1' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'joint', subject: 'e1', answer: 'none', weight: 'just_right', pump: 'moderate', affinity: null }, { dayId: 'd1', loadOnly: false });
    assert.strictEqual(out.mesoState.affinity.e1.v, 'dislike', 'deselect does not change the value');
    assert.strictEqual(out.mesoState.affinity.e1.streak, 2, 'deselect does not re-confirm or reset');
  });
  test('applyMesoFeedbackEdit: a volume edit only drives set deltas, never pump', () => {
    const ms = { deltas: {}, growthCounts: {}, pumpLowCounts: {}, jointFlags: {} };
    const raw = { answers: { soreness: {}, joint: { e1: { exId: 'e1', muscle: 'chest', answer: 'none', pump: 'moderate', weight: 'just_right', contrib: {} } }, volume: { chest: { muscle: 'chest', exIds: ['e1'], volume: 'just_right', contrib: {} } } }, negOwner: {}, frozen: false, dayId: 'd1' };
    const out = LB.applyMesoFeedbackEdit(ms, raw, { type: 'volume', subject: 'chest', volume: 'not_enough' }, { dayId: 'd1', loadOnly: false });
    assert.strictEqual(out.raw.answers.volume.chest.volume, 'not_enough', 'workload updated');
    assert.strictEqual(out.mesoState.deltas.e1_d1, 1, 'a +1 set delta earned');
    assert.ok(!('pump' in out.raw.answers.volume.chest), 'pump is not on the volume record anymore');
  });

  test('mesoRecapGainsFromEdit: combines set deltas and weight deltas per exercise', () => {
    const answers = { soreness: {}, joint: {}, volume: { chest: { muscle: 'chest', exIds: ['e1'], contrib: { e1_d1: 1 } } } };
    const gains = LB.mesoRecapGainsFromEdit(answers, { e1_d1: 2.5 }, [{ exId: 'e1', key: 'e1_d1', name: 'Bench' }], 'd1');
    assert.strictEqual(JSON.stringify(gains), JSON.stringify([{ name: 'Bench', weightDelta: 2.5, setDelta: 1 }]));
  });

  // ── resolveMesoSeedSuggestion (feedback owns weight on a meso plan) ──
  const seedLast = { entry: { sets: [{ kg: 100, reps: 8 }] } };
  test('resolveMesoSeedSuggestion: earned boost with no Smart Progression applies the boost', () => {
    const out = LB.resolveMesoSeedSuggestion(null, 2.5, seedLast, true);
    assert.strictEqual(out.kg, 102.5);
    assert.strictEqual(out.reps, 8);
  });
  test('resolveMesoSeedSuggestion: earned boost keeps the Smart Progression suggestion when it fired (same increment)', () => {
    const sp = { kg: 105, reps: 5 };
    assert.strictEqual(LB.resolveMesoSeedSuggestion(sp, 2.5, seedLast, true), sp);
  });
  test('resolveMesoSeedSuggestion: withheld boost VETOES Smart Progression on a meso plan (weight holds)', () => {
    const sp = { kg: 102.5, reps: 8 };
    assert.strictEqual(LB.resolveMesoSeedSuggestion(sp, null, seedLast, true), null);
  });
  test('resolveMesoSeedSuggestion: first block week 1 (no prior feedback) lets Smart Progression through', () => {
    const sp = { kg: 102.5, reps: 8 };
    assert.strictEqual(LB.resolveMesoSeedSuggestion(sp, null, seedLast, true, true), sp);
  });
  test('resolveMesoSeedSuggestion: off a meso plan Smart Progression is untouched', () => {
    const sp = { kg: 102.5, reps: 8 };
    assert.strictEqual(LB.resolveMesoSeedSuggestion(sp, null, seedLast, false), sp);
  });
  test('resolveMesoSeedSuggestion: no boost and no Smart Progression is a no-op', () => {
    assert.strictEqual(LB.resolveMesoSeedSuggestion(null, null, seedLast, true), null);
  });
  test('resolveMesoSeedSuggestion: earned boost but no reference set falls back to the suggestion', () => {
    assert.strictEqual(LB.resolveMesoSeedSuggestion(null, 2.5, null, true), null);
  });
  test('resolveMesoSeedSuggestion: rep-miss cut applies downward when Smart Progression is silent', () => {
    const out = LB.resolveMesoSeedSuggestion(null, -2.5, seedLast, true);
    assert.strictEqual(out.kg, 97.5);
  });
  test('resolveMesoSeedSuggestion: rep-miss cut is authoritative and beats an up-suggestion', () => {
    const out = LB.resolveMesoSeedSuggestion({ kg: 105, reps: 5 }, -2.5, seedLast, true);
    assert.strictEqual(out.kg, 97.5); // cut wins, not the 105 suggestion
  });
  test('resolveMesoSeedSuggestion: a cut can never drive the seed below zero', () => {
    const lightLast = { entry: { sets: [{ kg: 2.5, reps: 10 }] } };
    assert.strictEqual(LB.resolveMesoSeedSuggestion(null, -2.5, lightLast, true).kg, 0);
  });
  test('resolveMesoSeedSuggestion: a bump resets the seeded reps to the range floor (double progression)', () => {
    // last session hit 12 (top of an 8-12 range) at 100 kg and earned a boost;
    // next seed climbs the weight AND drops reps back to the floor (8), not 12.
    const topLast = { entry: { sets: [{ kg: 100, reps: 12 }] } };
    const out = LB.resolveMesoSeedSuggestion(null, 2.5, topLast, true, false, 8);
    assert.strictEqual(out.kg, 102.5);
    assert.strictEqual(out.reps, 8); // reset to rangeMin, not carried at 12
  });
  test('resolveMesoSeedSuggestion: a cut also reseeds reps at the floor', () => {
    const missLast = { entry: { sets: [{ kg: 100, reps: 6 }] } };
    const out = LB.resolveMesoSeedSuggestion(null, -2.5, missLast, true, false, 8);
    assert.strictEqual(out.kg, 97.5);
    assert.strictEqual(out.reps, 8);
  });
  test('resolveMesoSeedSuggestion: no repFloor passed keeps last reps (backward compatible)', () => {
    const out = LB.resolveMesoSeedSuggestion(null, 2.5, seedLast, true);
    assert.strictEqual(out.reps, 8); // seedLast reps == 8, unchanged
  });

  // ── mesoMuscleTrainedBeforeStart (week-1 soreness on a mid-plan activation) ──
  const muscleOf = (id) => ({ leg1: 'quads', leg2: 'quads', back1: 'back' }[id] ?? null);
  const sess = (o) => ({ ended: '2026-01-05T10:00:00Z', isDeload: false, scheduleId: 'plan1', entries: [{ exId: 'leg1' }], ...o });
  const BLOCK_START = new Date('2026-01-10T00:00:00Z').getTime();
  test('mesoMuscleTrainedBeforeStart: a fresh plan (no sessions) stays silent', () => {
    assert.strictEqual(LB.mesoMuscleTrainedBeforeStart([], 'plan1', BLOCK_START, 'quads', muscleOf), false);
  });
  test('mesoMuscleTrainedBeforeStart: the muscle trained before the block start counts', () => {
    assert.strictEqual(LB.mesoMuscleTrainedBeforeStart([sess({})], 'plan1', BLOCK_START, 'quads', muscleOf), true);
  });
  test('mesoMuscleTrainedBeforeStart: a session AFTER the start does not count', () => {
    assert.strictEqual(LB.mesoMuscleTrainedBeforeStart([sess({ ended: '2026-01-12T10:00:00Z' })], 'plan1', BLOCK_START, 'quads', muscleOf), false);
  });
  test('mesoMuscleTrainedBeforeStart: a different muscle does not count', () => {
    assert.strictEqual(LB.mesoMuscleTrainedBeforeStart([sess({ entries: [{ exId: 'back1' }] })], 'plan1', BLOCK_START, 'quads', muscleOf), false);
  });
  test('mesoMuscleTrainedBeforeStart: deload and other-plan sessions are ignored', () => {
    assert.strictEqual(LB.mesoMuscleTrainedBeforeStart([sess({ isDeload: true })], 'plan1', BLOCK_START, 'quads', muscleOf), false);
    assert.strictEqual(LB.mesoMuscleTrainedBeforeStart([sess({ scheduleId: 'other' })], 'plan1', BLOCK_START, 'quads', muscleOf), false);
  });
  test('mesoMuscleTrainedBeforeStart: a windowed session with no entries cannot match', () => {
    assert.strictEqual(LB.mesoMuscleTrainedBeforeStart([sess({ entries: [] })], 'plan1', BLOCK_START, 'quads', muscleOf), false);
  });

  // ── volumeAnswerAllowsBump (load-only weight-feel: "Hard" still earns the bump) ──
  test('volumeAnswerAllowsBump: just_right / not_enough always allow the bump', () => {
    assert.strictEqual(LB.volumeAnswerAllowsBump('just_right', false), true);
    assert.strictEqual(LB.volumeAnswerAllowsBump('not_enough', true), true);
  });
  test('volumeAnswerAllowsBump: "pushed" (Hard) allows the bump only in load-only mode', () => {
    assert.strictEqual(LB.volumeAnswerAllowsBump('pushed', true), true);
    assert.strictEqual(LB.volumeAnswerAllowsBump('pushed', false), false);
  });
  test('volumeAnswerAllowsBump: "too_much" (Too heavy) always holds', () => {
    assert.strictEqual(LB.volumeAnswerAllowsBump('too_much', true), false);
    assert.strictEqual(LB.volumeAnswerAllowsBump('too_much', false), false);
  });

  // ── mesoPausedDays (recovery time must not fast-forward the meso week) ──
  test('mesoPausedDays: deload days in the window are all excluded', () => {
    // 5-day deload Jan 10–14 inside a meso running Jan 1 → Jan 20.
    const periods = [{ mode: 'deload', startedAt: '2026-01-10T12:00:00Z', endedAt: '2026-01-14T12:00:00Z' }];
    assert.strictEqual(LB.mesoPausedDays(periods, new Set(), '2026-01-01', '2026-01-20'), 5);
  });
  test('mesoPausedDays: sick days are excluded just like deload', () => {
    const periods = [{ mode: 'sick', startedAt: '2026-01-05T12:00:00Z', endedAt: '2026-01-07T12:00:00Z' }];
    assert.strictEqual(LB.mesoPausedDays(periods, new Set(), '2026-01-01', '2026-01-20'), 3);
  });
  test('mesoPausedDays: an OPEN (still active) period runs to today', () => {
    const periods = [{ mode: 'sick', startedAt: '2026-01-18T12:00:00Z', endedAt: null }];
    // Jan 18, 19, 20 = 3 days.
    assert.strictEqual(LB.mesoPausedDays(periods, new Set(), '2026-01-01', '2026-01-20'), 3);
  });
  test('mesoPausedDays: vacation excludes only idle days; trained vacation days count', () => {
    // 4-day vacation Jan 10–13; user trained on Jan 11 and Jan 13.
    const periods = [{ mode: 'vacation', startedAt: '2026-01-10T12:00:00Z', endedAt: '2026-01-13T12:00:00Z' }];
    const trained = new Set(['2026-01-11', '2026-01-13']);
    // Jan 10 + Jan 12 idle = 2 excluded; Jan 11 + Jan 13 trained = counted.
    assert.strictEqual(LB.mesoPausedDays(periods, trained, '2026-01-01', '2026-01-20'), 2);
  });
  test('mesoPausedDays: no periods, empty, or reversed window → 0', () => {
    assert.strictEqual(LB.mesoPausedDays([], new Set(), '2026-01-01', '2026-01-20'), 0);
    assert.strictEqual(LB.mesoPausedDays(null, new Set(), '2026-01-01', '2026-01-20'), 0);
    assert.strictEqual(LB.mesoPausedDays([{ mode: 'sick', startedAt: '2026-01-05T12:00:00Z', endedAt: null }], new Set(), '2026-01-20', '2026-01-01'), 0);
  });

  // ── mesoRirForWeek (configurable, taper can go beyond failure) ──
  test('mesoRirForWeek: default 3 → 0 taper reproduces the classic curve', () => {
    // 6-week meso: 3,2,2,1,1,0 (rounded linear).
    const rirs = [1, 2, 3, 4, 5, 6].map(w => LB.mesoRirForWeek(w, 6));
    assert.strictEqual(rirs[0], 3);
    assert.strictEqual(rirs[5], 0);
    assert.ok(rirs.every((v, i) => i === 0 || v <= rirs[i - 1]), 'monotonically non-increasing');
  });
  test('mesoRirForWeek: a negative end RIR is preserved (no floor at 0)', () => {
    // 4-week meso, start 3, end -3: 3, 1, -1, -3.
    assert.strictEqual(LB.mesoRirForWeek(1, 4, 3, -3), 3);
    assert.strictEqual(LB.mesoRirForWeek(4, 4, 3, -3), -3);
    assert.strictEqual(LB.mesoRirForWeek(3, 4, 3, -3), -1);
  });
  test('mesoRirForWeek: lower start (2) and negative end (-2) taper correctly', () => {
    assert.strictEqual(LB.mesoRirForWeek(1, 5, 2, -2), 2);
    assert.strictEqual(LB.mesoRirForWeek(5, 5, 2, -2), -2);
    assert.strictEqual(LB.mesoRirForWeek(3, 5, 2, -2), 0);
  });
  test('mesoRirForWeek: a 1-week (or 0) meso just returns the end RIR', () => {
    assert.strictEqual(LB.mesoRirForWeek(1, 1, 3, -3), -3);
    assert.strictEqual(LB.mesoRirForWeek(1, 0, 3, 0), 0);
  });

  const smartProgStore = { settings: { smartProgression: true, progressionRangeTop: 4 } };
  const noSmartProgStore = { settings: { smartProgression: false, progressionRangeTop: 4 } };

  test('progressionEnabled: Range repsMax is always on, regardless of the global setting', () => {
    assert.strictEqual(LB.progressionEnabled(noSmartProgStore, 12, null), true);
    assert.strictEqual(LB.progressionEnabled(smartProgStore, 12, null), true);
  });
  test('progressionEnabled: an explicit progressionOffset of 0 is off regardless of the global setting', () => {
    assert.strictEqual(LB.progressionEnabled(smartProgStore, null, 0), false);
  });
  test('progressionEnabled: an explicit positive progressionOffset is on regardless of the global setting', () => {
    assert.strictEqual(LB.progressionEnabled(noSmartProgStore, null, 6), true);
  });
  test('progressionEnabled: unset progressionOffset inherits the global setting', () => {
    assert.strictEqual(LB.progressionEnabled(smartProgStore, null, null), true);
    assert.strictEqual(LB.progressionEnabled(noSmartProgStore, null, null), false);
  });
  test('progressionEnabled: an explicit progressionOffset of 0 wins even for a Range item', () => {
    // Lets a Range exercise (e.g. lateral raises with a "12-15" display target)
    // still opt out of auto weight-bump progression entirely.
    assert.strictEqual(LB.progressionEnabled(smartProgStore, 12, 0), false);
  });
  test('progressionCeilingFor: Range repsMax wins as an absolute ceiling', () => {
    assert.strictEqual(LB.progressionCeilingFor(smartProgStore, 8, 12, 6), 12);
  });
  test('progressionCeilingFor: explicit offset adds onto the base, ignoring the global range top', () => {
    assert.strictEqual(LB.progressionCeilingFor(smartProgStore, 8, null, 2), 10);
  });
  test('progressionCeilingFor: falls back to base + global progressionRangeTop', () => {
    assert.strictEqual(LB.progressionCeilingFor(smartProgStore, 8, null, null), 12);
  });

  test('buildSeedSets caps the +1 progression nudge at a Range item\'s repsMax', () => {
    const it = { sets: 1, reps: 8, repsMax: 12 };
    const atCap = { entry: { sets: [{ warmup: false, kg: 100, reps: 12, done: true }] } };
    const seeded = LB.buildSeedSets(it, atCap, null, false, noSmartProgStore, null);
    assert.strictEqual(seeded[0].reps, 12); // must not climb to 13 past the range ceiling, even with the global setting off
  });
  test('buildSeedSets still bumps +1 while below a Range item\'s repsMax', () => {
    const it = { sets: 1, reps: 8, repsMax: 12 };
    const belowCap = { entry: { sets: [{ warmup: false, kg: 100, reps: 9, done: true }] } };
    const seeded = LB.buildSeedSets(it, belowCap, null, false, noSmartProgStore, null);
    assert.strictEqual(seeded[0].reps, 10);
  });
  test('buildSeedSets never seeds below last session, even past a Range item\'s repsMax', () => {
    // Last session went to failure at 13 on an 8-12 range at the same weight.
    // The cap must not drop the seed back to 12 (that would prescribe less than
    // the user just proved they can do); seed the actual 13.
    const it = { sets: 1, reps: 8, repsMax: 12 };
    const pastCap = { entry: { sets: [{ warmup: false, kg: 100, reps: 13, done: true }] } };
    const seeded = LB.buildSeedSets(it, pastCap, null, false, noSmartProgStore, null);
    assert.strictEqual(seeded[0].reps, 13);
  });
  test('buildSeedSets leaves the classic (non-Range) +1 nudge uncapped past the global ceiling', () => {
    // Only a Range item's own repsMax caps the nudge — the global default /
    // a custom progressionOffset ceiling is just an internal trigger
    // threshold, not a user-drawn boundary, so it keeps climbing (matches
    // classic Smart Progression's long-standing behavior).
    const it = { sets: 1, reps: 8 };
    const pastCap = { entry: { sets: [{ warmup: false, kg: 100, reps: 12, done: true }] } };
    const seeded = LB.buildSeedSets(it, pastCap, null, false, smartProgStore, null);
    assert.strictEqual(seeded[0].reps, 13);
  });
  test('buildSeedSets still bumps +1 below the global ceiling when Smart Progression is on', () => {
    const it = { sets: 1, reps: 8 };
    const last = { entry: { sets: [{ warmup: false, kg: 100, reps: 10, done: true }] } };
    const seeded = LB.buildSeedSets(it, last, null, false, smartProgStore, null);
    assert.strictEqual(seeded[0].reps, 11);
  });
  test('buildSeedSets does not bump reps at all when the global setting is off and there is no override', () => {
    const it = { sets: 1, reps: 8 };
    const last = { entry: { sets: [{ warmup: false, kg: 100, reps: 10, done: true }] } };
    const seeded = LB.buildSeedSets(it, last, null, false, noSmartProgStore, null);
    assert.strictEqual(seeded[0].reps, 10); // unchanged, no progression nudge
  });
  test('buildSeedSets honors a per-exercise progressionOffset override even with the global setting off, uncapped', () => {
    const it = { sets: 1, reps: 8, progressionOffset: 2 };
    const last = { entry: { sets: [{ warmup: false, kg: 100, reps: 10, done: true }] } };
    const seeded = LB.buildSeedSets(it, last, null, false, noSmartProgStore, null);
    assert.strictEqual(seeded[0].reps, 11); // offset ceiling (10) is a trigger threshold, not a cap — keeps climbing
  });
  test('buildSeedSets respects an explicit progressionOffset of 0 (off) even with the global setting on', () => {
    const it = { sets: 1, reps: 8, progressionOffset: 0 };
    const last = { entry: { sets: [{ warmup: false, kg: 100, reps: 10, done: true }] } };
    const seeded = LB.buildSeedSets(it, last, null, false, smartProgStore, null);
    assert.strictEqual(seeded[0].reps, 10); // unchanged, no progression nudge despite the global setting being on
  });

  test('dedupeVersionsByDate: a same-date entry placed first replaces the later one for that date', () => {
    const versions = [
      { validFrom: '2026-07-05', days: ['new'] },
      { validFrom: '2026-07-05', days: ['old'] },
      { validFrom: '2026-06-01', days: ['older'] },
    ];
    const result = LB.dedupeVersionsByDate(versions);
    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(result[0], { validFrom: '2026-07-05', days: ['new'] });
    assert.deepStrictEqual(result[1], { validFrom: '2026-06-01', days: ['older'] });
  });
  test('dedupeVersionsByDate: distinct dates all survive, sorted newest first', () => {
    const versions = [
      { validFrom: '2026-06-01', days: [] },
      { validFrom: '2026-07-05', days: [] },
    ];
    const result = LB.dedupeVersionsByDate(versions);
    assert.deepStrictEqual(result.map(v => v.validFrom), ['2026-07-05', '2026-06-01']);
  });

  // ── withCarriedWindowEntries (audit B1: no re-upload of windowed sessions) ──
  test('withCarriedWindowEntries: carries last-synced entries into a windowed (entries:[]) session', () => {
    const fresh = [{ id: 's1', entries: [] }]; // server windowed it (sets not loaded)
    const base = [{ id: 's1', entries: [{ exId: 'e', sets: [{ kg: 100, reps: 5 }] }] }];
    const out = LB.withCarriedWindowEntries(fresh, base);
    assert.deepStrictEqual(out[0].entries, base[0].entries);
  });

  test('withCarriedWindowEntries: leaves a session the server DID load (entries present) untouched', () => {
    const serverEntries = [{ exId: 'e', sets: [{ kg: 110, reps: 5 }] }];
    const fresh = [{ id: 's1', entries: serverEntries }];
    const base = [{ id: 's1', entries: [{ exId: 'e', sets: [{ kg: 100, reps: 5 }] }] }];
    const out = LB.withCarriedWindowEntries(fresh, base);
    assert.strictEqual(out[0].entries, serverEntries); // server copy wins, not stale base
  });

  test('withCarriedWindowEntries: a windowed session unknown to the base keeps entries:[] (re-syncs once)', () => {
    const fresh = [{ id: 's2', entries: [] }];
    const base = [{ id: 's1', entries: [{ exId: 'e', sets: [{ kg: 100, reps: 5 }] }] }];
    const out = LB.withCarriedWindowEntries(fresh, base);
    assert.deepStrictEqual(out[0].entries, []);
  });

  test('withCarriedWindowEntries: no base (first boot) leaves everything as-is', () => {
    const fresh = [{ id: 's1', entries: [] }];
    assert.deepStrictEqual(LB.withCarriedWindowEntries(fresh, null), fresh);
  });

  // ── realignCycleForToday (return-from-break nudge) ──────────────────────────
  // Realign is built on the version-change "start at day K from this date" flow:
  // it adds a new version effective today with a cycleOffset that lands today on
  // the picked day, converting an unversioned plan to versioned. The cycle NUMBER
  // continues across the boundary (never resets to 1) and past dates keep their
  // old rotation.
  test('realignCycleForToday: unversioned → today lands on the picked day', () => {
    const days = Array.from({ length: 8 }, () => ({})); // 8-day cycle
    const sch = { id: 'p1', days };
    const patch = LB.realignCycleForToday({ schedules: [sch], cycleStartDate: '2026-06-01' }, sch, '2026-07-05', 4);
    const patched = patch.schedules[0];
    // unversioned plan is now versioned …
    assert.ok(patched.versions && patched.versions.length >= 2);
    // … and today resolves to the picked position
    assert.strictEqual(LB.getCyclePosForDate(patched, '2026-07-05'), 4);
  });

  test('realignCycleForToday: targetPos 0 → today is day 1 (no cycleOffset on the new version)', () => {
    const days = Array.from({ length: 8 }, () => ({}));
    const sch = { id: 'p1', days };
    const patch = LB.realignCycleForToday({ schedules: [sch], cycleStartDate: '2026-06-01' }, sch, '2026-07-05', 0);
    const patched = patch.schedules[0];
    assert.strictEqual(LB.getCyclePosForDate(patched, '2026-07-05'), 0);
    // newest version starts today, day 1 → no offset stored
    assert.strictEqual(patched.versions[0].validFrom, '2026-07-05');
    assert.strictEqual(patched.versions[0].cycleOffset, undefined);
  });

  test('realignCycleForToday: already-versioned → prepends a new version, today maps to target', () => {
    const days = Array.from({ length: 8 }, () => ({}));
    const sch = { id: 'p1', days, versions: [{ validFrom: '2026-06-10', days, cycleOffset: 0 }] };
    const patch = LB.realignCycleForToday({ schedules: [sch] }, sch, '2026-07-05', 4);
    const patched = patch.schedules[0];
    assert.strictEqual(patched.versions.length, 2);
    assert.strictEqual(patched.versions[0].validFrom, '2026-07-05');
    assert.strictEqual(LB.getCyclePosForDate(patched, '2026-07-05'), 4);
  });

  test('realignCycleForToday: returns null for flex / weekday plans', () => {
    assert.strictEqual(LB.realignCycleForToday({ schedules: [] }, { id: 'f', is_flex: true, days: [{}] }, '2026-07-05', 0), null);
    assert.strictEqual(LB.realignCycleForToday({ schedules: [] }, { id: 'w', days: [{ weekday: 0 }] }, '2026-07-05', 0), null);
  });

  test('realignCycleForToday: unversioned preserves the cycle NUMBER (never resets to 1)', () => {
    const days = Array.from({ length: 8 }, () => ({}));
    const sch = { id: 'p1', days };
    const today = '2026-07-05';
    // cycleStartDate several cycles back → user is deep into the plan, not cycle 1
    const state = { schedules: [sch], cycleStartDate: '2026-06-01' };
    const dsBefore = Math.round((new Date(today + 'T12:00:00') - new Date('2026-06-01T12:00:00')) / 86400000);
    const numBefore = Math.floor(dsBefore / 8) + 1;
    assert.ok(numBefore > 1); // sanity: a non-trivial cycle number
    const patched = LB.realignCycleForToday(state, sch, today, 0).schedules[0];
    // day position snapped to the picked target …
    assert.strictEqual(LB.getCyclePosForDate(patched, today), 0);
    // … and the CYCLE NUMBER continues (never drops, never resets to 1)
    const numAfter = LB.getCycleNumForDate(patched, today);
    assert.ok(numAfter >= numBefore);
    assert.ok(numAfter > 1);
  });

  test('realignCycleForToday: preserves history — a past date keeps its old rotation', () => {
    const days = Array.from({ length: 8 }, () => ({}));
    const sch = { id: 'p1', days };
    const today = '2026-07-05';
    const state = { schedules: [sch], cycleStartDate: '2026-06-01' };
    // a date well before today, under the original unversioned anchor
    const pastPos = LB.cyclePosFromStartDate('2026-06-01', 8, '2026-06-20');
    const patched = LB.realignCycleForToday(state, sch, today, 0).schedules[0];
    // the old version still governs the past → same rotation position
    assert.strictEqual(LB.getCyclePosForDate(patched, '2026-06-20'), pastPos);
  });

  // ── exerciseLogMode / shouldPullBodyweight (logging modes) ──────────────────
  test('exerciseLogMode: log_mode wins when set', () => {
    assert.strictEqual(LB.exerciseLogMode({ log_mode: 'checkbox' }), 'checkbox');
    assert.strictEqual(LB.exerciseLogMode({ log_mode: 'reps' }), 'reps');
    assert.strictEqual(LB.exerciseLogMode({ log_mode: 'weight' }), 'weight');
  });
  test('exerciseLogMode: legacy fallback from no_weight_reps', () => {
    assert.strictEqual(LB.exerciseLogMode({ no_weight_reps: true }), 'reps');
    assert.strictEqual(LB.exerciseLogMode({ no_weight_reps: false }), 'weight');
    assert.strictEqual(LB.exerciseLogMode({}), 'weight');
    assert.strictEqual(LB.exerciseLogMode(null), 'weight');
  });
  test('exerciseLogMode: log_mode takes precedence over legacy flag', () => {
    // a bodyweight weight-mode exercise still carries no_weight_reps=false, and
    // a reps exercise carries no_weight_reps=true — but log_mode is authoritative
    assert.strictEqual(LB.exerciseLogMode({ log_mode: 'weight', no_weight_reps: true }), 'weight');
  });
  test('shouldPullBodyweight: only bodyweight + explicit opt-in', () => {
    assert.strictEqual(LB.shouldPullBodyweight({ equipment: 'bodyweight', pull_bodyweight: true }), true);
    assert.strictEqual(LB.shouldPullBodyweight({ equipment: 'bodyweight', pull_bodyweight: false }), false);
    assert.strictEqual(LB.shouldPullBodyweight({ equipment: 'bodyweight' }), false);
    assert.strictEqual(LB.shouldPullBodyweight({ equipment: 'barbell_dual', pull_bodyweight: true }), false);
    assert.strictEqual(LB.shouldPullBodyweight(null), false);
  });

  // ── systemExerciseToRow (Exercise DB → editable copy) ───────────────────────
  test('systemExerciseToRow: normalizes catalog shape to a store row', () => {
    const row = LB.systemExerciseToRow({ id: 'sys_x', name: 'Single-Arm Cable Row', tags: ['Back', 'Biceps'], equipment: 'cable', movement: 'unilateral', logMode: 'weight' });
    assert.strictEqual(row.name, 'Single-Arm Cable Row');
    assert.deepStrictEqual([...row.tags], ['Back', 'Biceps']);
    assert.strictEqual(row.equipment, 'cable');
    assert.strictEqual(row.movement_type, 'unilateral');
    assert.strictEqual(row.unilateral, true);
    assert.strictEqual(row.log_mode, 'weight');
    assert.strictEqual(row.no_weight_reps, false);
    assert.strictEqual(row.pull_bodyweight, false);
    assert.ok(row.id && row.id !== 'sys_x'); // fresh id, not the catalog id
    assert.strictEqual(row.progression_reps, null);
  });
  test('systemExerciseToRow: category (rest-timer size) carries through / defaults null', () => {
    const withCat = LB.systemExerciseToRow({ id: 'sys_sq', name: 'Back Squat', tags: ['Quads'], equipment: 'barbell_dual', category: 'big' });
    assert.strictEqual(withCat.category, 'big'); // rest size copied so the duplicate gets a real rest time
    const noCat = LB.systemExerciseToRow({ id: 'sys_n', name: 'X', tags: ['Chest'], equipment: 'machine' });
    assert.strictEqual(noCat.category, null); // absent → null (falls back to default rest)
  });
  test('every SYSTEM_EXERCISES entry has a valid rest-timer category', () => {
    const dbSandbox = { window: {} };
    vm.createContext(dbSandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/exercise-db.js'), 'utf8'), dbSandbox, { filename: 'exercise-db.js' });
    const valid = new Set(['big', 'medium', 'small']);
    const bad = (dbSandbox.window.SYSTEM_EXERCISES || []).filter(e => !valid.has(e.category));
    assert.strictEqual(bad.length, 0, `entries without a valid category: ${bad.map(e => e.name).join(', ')}`);
  });
  test('systemExerciseToRow: reps mode → no_weight_reps true; defaults when omitted', () => {
    const reps = LB.systemExerciseToRow({ id: 'sys_p', name: 'Push-Up', tags: ['Chest'], equipment: 'bodyweight', logMode: 'reps' });
    assert.strictEqual(reps.log_mode, 'reps');
    assert.strictEqual(reps.no_weight_reps, true);
    assert.strictEqual(reps.unilateral, false); // no movement → bilateral
    assert.strictEqual(reps.movement_type, 'bilateral');
    const bare = LB.systemExerciseToRow({ id: 'sys_b', name: 'Bench', tags: ['Chest'], equipment: 'barbell_dual' });
    assert.strictEqual(bare.log_mode, 'weight'); // logMode omitted → weight
    assert.strictEqual(bare.no_weight_reps, false);
    assert.strictEqual(bare.movement_type, 'bilateral');
  });
  test('systemExerciseToRow: tags are copied, not shared by reference', () => {
    const src = { id: 'sys_t', name: 'X', tags: ['Quads'], equipment: 'machine' };
    const row = LB.systemExerciseToRow(src);
    row.tags.push('Glutes');
    assert.deepStrictEqual(src.tags, ['Quads']); // original untouched
  });

  // ── buildPlanSkeleton (plan setup wizard → new schedule object) ─────────────
  test('buildPlanSkeleton: cycle PPL x2 → REST closes each block', () => {
    const sch = LB.buildPlanSkeleton({ name: 'test', type: 'cycle', presetKey: 'ppl6' });
    assert.strictEqual(sch.mode, undefined);       // cycle has no mode
    assert.strictEqual(sch.is_flex, undefined);
    assert.deepStrictEqual([...sch.days.map(d => d.name)], ['PUSH', 'PULL', 'LEGS', 'REST', 'PUSH', 'PULL', 'LEGS', 'REST']);
    assert.ok(sch.days.every(d => d.id && Array.isArray(d.items) && d.items.length === 0));
    assert.ok(sch.days[0].id !== sch.days[1].id); // fresh unique ids
  });
  test('buildPlanSkeleton: cycle PPL x1 → one block + trailing REST', () => {
    const sch = LB.buildPlanSkeleton({ name: 't', type: 'cycle', presetKey: 'ppl3' });
    assert.deepStrictEqual([...sch.days.map(d => d.name)], ['PUSH', 'PULL', 'LEGS', 'REST']);
  });
  test('buildPlanSkeleton: flex has NO rest days (block repeated flat)', () => {
    const sch = LB.buildPlanSkeleton({ name: 'fl', type: 'flex', presetKey: 'ppl6' });
    assert.strictEqual(sch.is_flex, true);
    assert.strictEqual(sch.sessions_per_week, 6);  // 6 training days, no rest
    assert.strictEqual(sch.mode, undefined);
    assert.deepStrictEqual([...sch.days.map(d => d.name)], ['PUSH', 'PULL', 'LEGS', 'PUSH', 'PULL', 'LEGS']);
    assert.ok(!sch.days.some(d => d.name === 'REST'));
  });
  test('buildPlanSkeleton: weekday with a split → rotation maps onto sorted days', () => {
    const sch = LB.buildPlanSkeleton({ name: 'wk', type: 'weekday', presetKey: 'ppl3', weekdays: [4, 0, 2] });
    assert.strictEqual(sch.mode, 'weekday');
    assert.deepStrictEqual([...sch.days.map(d => d.weekday)], [0, 2, 4]); // sorted
    assert.deepStrictEqual([...sch.days.map(d => d.name)], ['PUSH', 'PULL', 'LEGS']); // rotation in order
    assert.strictEqual(sch.is_flex, undefined);
  });
  test('buildPlanSkeleton: weekday custom (no preset) → FULL days', () => {
    const sch = LB.buildPlanSkeleton({ name: 'wk', type: 'weekday', weekdays: [0, 2] });
    assert.ok(sch.days.every(d => d.name === 'FULL'));
  });
  test('buildPlanSkeleton: weekday custom uses per-day types in weekday order', () => {
    const sch = LB.buildPlanSkeleton({ name: 'wk', type: 'weekday', presetKey: 'custom', weekdays: [4, 0, 2], customDays: ['PUSH', 'PULL', 'LEGS'] });
    // weekdays sort to [0,2,4]; customDays map onto them in order
    assert.deepStrictEqual([...sch.days.map(d => `${d.name}@${d.weekday}`)], ['PUSH@0', 'PULL@2', 'LEGS@4']);
  });
  test('buildPlanSkeleton: custom uses explicit per-day types (customDays wins)', () => {
    const sch = LB.buildPlanSkeleton({ name: 'c', type: 'cycle', presetKey: 'custom', customCount: 4, customDays: ['PUSH', 'PULL', 'REST', 'LEGS'] });
    assert.deepStrictEqual([...sch.days.map(d => d.name)], ['PUSH', 'PULL', 'REST', 'LEGS']);
    const fallback = LB.buildPlanSkeleton({ name: 'c', type: 'cycle', presetKey: 'custom', customCount: 5 });
    assert.strictEqual(fallback.days.length, 5);   // no customDays → count of FULL
    assert.ok(fallback.days.every(d => d.name === 'FULL'));
    const one = LB.buildPlanSkeleton({ name: 'c', type: 'cycle', presetKey: 'custom', customCount: 0 });
    assert.strictEqual(one.days.length, 1);        // floored to at least 1
  });
  test('buildPlanSkeleton: custom day can carry imported exercises (deep-copied)', () => {
    const src = { name: 'LEG DAY', items: [{ exId: 'e1', sets: 3, reps: 8 }, { exId: 'e2', sets: 4, reps: 10 }] };
    const sch = LB.buildPlanSkeleton({ type: 'cycle', presetKey: 'custom', customCount: 2, customDays: ['PUSH', src] });
    assert.strictEqual(sch.days[0].name, 'PUSH');
    assert.strictEqual(sch.days[0].items.length, 0);            // a typed day has no exercises
    assert.strictEqual(sch.days[1].name, 'LEG DAY');
    assert.strictEqual(sch.days[1].items.length, 2);            // imported exercises carried
    sch.days[1].items[0].exId = 'CHANGED';
    assert.strictEqual(src.items[0].exId, 'e1');                // source untouched (deep copy)
  });
  test('buildPlanSkeleton: meso weeks + RIR set when provided, absent otherwise', () => {
    const meso = LB.buildPlanSkeleton({ name: 'm', type: 'cycle', presetKey: 'full3', mesoWeeks: 8, mesoStartRir: 3, mesoEndRir: -1 });
    assert.strictEqual(meso.mesocycle_weeks, 8);
    assert.strictEqual(meso.mesocycle_start_rir, 3);
    assert.strictEqual(meso.mesocycle_end_rir, -1);
    const noMeso = LB.buildPlanSkeleton({ name: 'm', type: 'cycle', presetKey: 'full3' });
    assert.strictEqual(noMeso.mesocycle_weeks, undefined);
    assert.strictEqual(noMeso.mesocycle_start_rir, undefined);
  });
  test('buildPlanSkeleton: name falls back to "My Plan" when blank', () => {
    const sch = LB.buildPlanSkeleton({ name: '   ', type: 'cycle', presetKey: 'full3' });
    assert.strictEqual(sch.name, 'My Plan');
  });
  test('splitDayCount: block length x repeats, 0 for custom/unknown', () => {
    assert.strictEqual(LB.splitDayCount('ppl6'), 6);
    assert.strictEqual(LB.splitDayCount('ppl3'), 3);
    assert.strictEqual(LB.splitDayCount('ul4'), 4);
    assert.strictEqual(LB.splitDayCount('full3'), 3);
    assert.strictEqual(LB.splitDayCount('custom'), 0);
    assert.strictEqual(LB.splitDayCount(undefined), 0);
  });
  test('frequencyHint / mesoTaperPreview render sensible text', () => {
    assert.strictEqual(LB.frequencyHint(3), 'That\'s a start.');
    assert.strictEqual(LB.frequencyHint(5), 'Solid.');
    assert.ok(LB.frequencyHint(25).length > 0);
    assert.ok(LB.mesoTaperPreview(6, 3, 0).includes('Week 1 = 3 RIR'));
    assert.ok(LB.mesoTaperPreview(6, 3, -2).includes('partials/set')); // negative end → partials note
  });

  test('mesoRirEnabled: default true, only explicit false disables', () => {
    assert.strictEqual(LB.mesoRirEnabled({}), true);
    assert.strictEqual(LB.mesoRirEnabled({ mesocycle_rir_enabled: true }), true);
    assert.strictEqual(LB.mesoRirEnabled({ mesocycle_rir_enabled: null }), true);
    assert.strictEqual(LB.mesoRirEnabled(undefined), true);
    assert.strictEqual(LB.mesoRirEnabled({ mesocycle_rir_enabled: false }), false);
  });

  test('buildPlanSkeleton: mesoRirEnabled false is persisted, otherwise omitted', () => {
    const off = LB.buildPlanSkeleton({ name: 'M', type: 'cycle', presetKey: 'ppl3', mesoWeeks: 6, mesoRirEnabled: false });
    assert.strictEqual(off.mesocycle_rir_enabled, false);
    assert.strictEqual(LB.mesoRirEnabled(off), false);
    // Default (true / undefined) leaves the column unset so the DB default wins.
    const on = LB.buildPlanSkeleton({ name: 'M', type: 'cycle', presetKey: 'ppl3', mesoWeeks: 6, mesoRirEnabled: true });
    assert.strictEqual('mesocycle_rir_enabled' in on, false);
    assert.strictEqual(LB.mesoRirEnabled(on), true);
    // Non-meso plan never carries the flag.
    const plain = LB.buildPlanSkeleton({ name: 'P', type: 'cycle', presetKey: 'ppl3', mesoRirEnabled: false });
    assert.strictEqual('mesocycle_rir_enabled' in plain, false);
  });

  test('mesoActive: on when either mesocycle_weeks or mesocycle_autoregulate is set', () => {
    assert.strictEqual(LB.mesoActive({}), false);
    assert.strictEqual(LB.mesoActive(undefined), false);
    assert.strictEqual(LB.mesoActive({ mesocycle_weeks: null, mesocycle_autoregulate: false }), false);
    assert.strictEqual(LB.mesoActive({ mesocycle_weeks: 6 }), true);
    assert.strictEqual(LB.mesoActive({ mesocycle_autoregulate: true }), true);
    assert.strictEqual(LB.mesoActive({ mesocycle_weeks: 6, mesocycle_autoregulate: true }), true);
  });

  test('buildPlanSkeleton: mesocycleAutoregulate true is persisted outside the bounded-block config, otherwise omitted', () => {
    const auto = LB.buildPlanSkeleton({ name: 'A', type: 'cycle', presetKey: 'ppl3', mesocycleAutoregulate: true });
    assert.strictEqual(auto.mesocycle_autoregulate, true);
    assert.strictEqual(auto.mesocycle_weeks, undefined);
    assert.strictEqual(LB.mesoActive(auto), true);
    // Default (falsy/omitted) never carries the flag.
    const plain = LB.buildPlanSkeleton({ name: 'P', type: 'cycle', presetKey: 'ppl3' });
    assert.strictEqual('mesocycle_autoregulate' in plain, false);
    // Harmless alongside a bounded meso too (mesoActive is an OR, mesocycle_weeks
    // still wins for bounded-only logic) — confirms it isn't nested inside/gated
    // by the mesoWeeks block.
    const both = LB.buildPlanSkeleton({ name: 'B', type: 'cycle', presetKey: 'ppl3', mesoWeeks: 6, mesocycleAutoregulate: true });
    assert.strictEqual(both.mesocycle_weeks, 6);
    assert.strictEqual(both.mesocycle_autoregulate, true);
  });

  test('buildPlanSkeleton: mesocycleAutoregulateMode load is persisted, both/undefined omitted', () => {
    const load = LB.buildPlanSkeleton({ name: 'L', type: 'cycle', presetKey: 'ppl3', mesocycleAutoregulate: true, mesocycleAutoregulateMode: 'load' });
    assert.strictEqual(load.mesocycle_autoregulate_mode, 'load');
    // Default 'both' leaves the column unset (DB/app default handles it).
    const both = LB.buildPlanSkeleton({ name: 'B', type: 'cycle', presetKey: 'ppl3', mesocycleAutoregulate: true, mesocycleAutoregulateMode: 'both' });
    assert.strictEqual('mesocycle_autoregulate_mode' in both, false);
    // Mode is ignored without autoregulate on (mutually only meaningful together).
    const noAuto = LB.buildPlanSkeleton({ name: 'N', type: 'cycle', presetKey: 'ppl3', mesocycleAutoregulateMode: 'load' });
    assert.strictEqual('mesocycle_autoregulate_mode' in noAuto, false);
  });

  test('autoregLoadOnly: only true for an unbounded autoregulate plan set to load', () => {
    assert.strictEqual(LB.autoregLoadOnly({ mesocycle_autoregulate: true, mesocycle_autoregulate_mode: 'load' }), true);
    // Default / both regulates both halves.
    assert.strictEqual(LB.autoregLoadOnly({ mesocycle_autoregulate: true }), false);
    assert.strictEqual(LB.autoregLoadOnly({ mesocycle_autoregulate: true, mesocycle_autoregulate_mode: 'both' }), false);
    // A bounded mesocycle always regulates both, even with a stray 'load'.
    assert.strictEqual(LB.autoregLoadOnly({ mesocycle_weeks: 6, mesocycle_autoregulate_mode: 'load' }), false);
    // Off entirely.
    assert.strictEqual(LB.autoregLoadOnly({ mesocycle_autoregulate_mode: 'load' }), false);
    assert.strictEqual(LB.autoregLoadOnly({}), false);
  });

  // ── healScheduleWeekdays (self-heal legacy weekday plans) ───────────────────
  test('healScheduleWeekdays: weekday plan with no weekdays gets Mon-first slots, order kept', () => {
    const sch = { id: 'p1', mode: 'weekday', days: [
      { id: 'a', name: 'PUSH', items: [] }, { id: 'b', name: 'PULL', items: [] },
      { id: 'c', name: 'LEGS', items: [] }, { id: 'd', name: 'UPPER', items: [] },
      { id: 'e', name: 'LOWER', items: [] },
    ] };
    const healed = LB.healScheduleWeekdays(sch);
    assert.strictEqual(healed.mode, 'weekday');
    assert.strictEqual(healed.days.map(d => d.weekday).join(','), '0,1,2,3,4');
    assert.strictEqual(healed.days.map(d => d.name).join(','), 'PUSH,PULL,LEGS,UPPER,LOWER');
    assert.strictEqual(LB.isWeekdayPlan(healed), true);
  });

  test('healScheduleWeekdays: fills gaps around already-valid weekdays', () => {
    const sch = { id: 'p1', mode: 'weekday', days: [
      { id: 'a', name: 'A', weekday: 2, items: [] }, // valid, stays
      { id: 'b', name: 'B', items: [] },             // → first free = 0
      { id: 'c', name: 'C', weekday: 5, items: [] }, // valid, stays
      { id: 'd', name: 'D', items: [] },             // → next free = 1
    ] };
    assert.strictEqual(LB.healScheduleWeekdays(sch).days.map(d => d.weekday).join(','), '2,0,5,1');
  });

  test('healScheduleWeekdays: consistent weekday plan is returned untouched', () => {
    const sch = { id: 'p1', mode: 'weekday', days: [
      { id: 'a', name: 'A', weekday: 0, items: [] }, { id: 'b', name: 'B', weekday: 3, items: [] },
    ] };
    assert.strictEqual(LB.healScheduleWeekdays(sch), sch); // same reference, no churn
  });

  test('healScheduleWeekdays: more than 7 weekday-less days demote to a cycle', () => {
    const days = Array.from({ length: 8 }, (_, i) => ({ id: 'd' + i, name: 'D', items: [] }));
    const healed = LB.healScheduleWeekdays({ id: 'p1', mode: 'weekday', days });
    assert.strictEqual(healed.mode, undefined);
    assert.strictEqual(healed.days.some(d => 'weekday' in d), false);
    assert.strictEqual(healed.days.length, 8);
  });

  test('healScheduleWeekdays: stray weekday on a non-weekday plan is stripped to a clean cycle', () => {
    const sch = { id: 'p1', days: [
      { id: 'a', name: 'A', weekday: 2, items: [] }, { id: 'b', name: 'B', items: [] },
    ] };
    const healed = LB.healScheduleWeekdays(sch);
    assert.strictEqual(healed.days.some(d => 'weekday' in d), false);
    assert.strictEqual(LB.isWeekdayPlan(healed), false);
  });

  test('healScheduleWeekdays: plain cycle / flex / all-weekday plans pass through unchanged', () => {
    const cycle = { id: 'p1', days: [{ id: 'a', name: 'A', items: [] }, { id: 'b', name: 'REST', items: [] }] };
    assert.strictEqual(LB.healScheduleWeekdays(cycle), cycle);
    const flex = { id: 'p2', is_flex: true, days: [{ id: 'a', name: 'A', items: [] }] };
    assert.strictEqual(LB.healScheduleWeekdays(flex), flex);
    // Every day already carries a valid weekday (effectively a weekday plan even
    // without the mode flag) → renders fine, leave it be.
    const allWd = { id: 'p3', days: [{ id: 'a', name: 'A', weekday: 1, items: [] }, { id: 'b', name: 'B', weekday: 4, items: [] }] };
    assert.strictEqual(LB.healScheduleWeekdays(allWd), allWd);
  });

  test('isTrainingDayForDate: flex defaults to rest, override + logged session flip it', () => {
    const today = LB.todayISO();
    const flexPlan = { id: 'p1', is_flex: true, days: [{ id: 'd1', name: 'FULL', items: [{ exId: 'e1' }] }] };
    const base = { schedules: [flexPlan], activeScheduleId: 'p1', cycleIndex: 0, sessions: [], dailyLogs: [] };
    // No override, no session: a flex day defaults to REST ("earn it").
    assert.strictEqual(LB.isTrainingDayForDate(base, today), false);
    // Explicit Rest override → still rest.
    const rest = { ...base, dailyLogs: [{ date: today, targetsSnap: { dayType: 'rest' } }] };
    assert.strictEqual(LB.isTrainingDayForDate(rest, today), false);
    // Explicit Training override → training.
    const train = { ...base, dailyLogs: [{ date: today, targetsSnap: { dayType: 'training' } }] };
    assert.strictEqual(LB.isTrainingDayForDate(train, today), true);
    // A logged session wins even against a stale Rest override.
    const trained = { ...rest, sessions: [{ id: 's1', ended: today + 'T10:00:00Z', date: today }] };
    assert.strictEqual(LB.isTrainingDayForDate(trained, today), true);
    // Cycle/weekday keep the optimistic assumption and ignore the flex override.
    const cyclePlan = { id: 'p2', days: [{ id: 'd1', name: 'FULL', items: [{ exId: 'e1' }] }] };
    const cycle = { schedules: [cyclePlan], activeScheduleId: 'p2', cycleStartDate: today, sessions: [], dailyLogs: [{ date: today, targetsSnap: { dayType: 'rest' } }] };
    assert.strictEqual(LB.isTrainingDayForDate(cycle, today), true); // planned today = training regardless
  });

  test('todayCycleStripIndex: a shorter future version does not shift today back', () => {
    const mkDays = n => Array.from({ length: n }, (_, i) => ({ id: 'd' + i, name: 'D' + i, items: [] }));
    // Active version: 9-day cycle starting 2026-04-26 (so 2026-07-06 is the last
    // day, index 8, of cycle 8). A NEW 8-day version is scheduled from tomorrow.
    const vOld = { validFrom: '2026-04-26', days: mkDays(9) };
    const vNew = { validFrom: '2026-07-07', days: mkDays(8) };
    const sch = { id: 'p', days: vNew.days, versions: [vNew, vOld] }; // newest-first; sch.days = future version
    // Today is the 9th day (index 8) of the currently-active 9-day cycle.
    assert.strictEqual(LB.getCycleNumForDate(sch, '2026-07-06'), 8);
    assert.strictEqual(LB.todayCycleStripIndex(sch, '2026-07-06', 0), 8);
    // Sanity: with no future version the newest version IS active, index unchanged.
    const schNoFuture = { id: 'p', days: vOld.days, versions: [vOld] };
    assert.strictEqual(LB.todayCycleStripIndex(schNoFuture, '2026-07-06', 0), 8);
    // Guard clauses: unversioned / weekday / flex fall back to the passed index.
    assert.strictEqual(LB.todayCycleStripIndex({ id: 'p', days: mkDays(9) }, '2026-07-06', 3), 3);
    assert.strictEqual(LB.todayCycleStripIndex({ id: 'p', is_flex: true, days: mkDays(9), versions: [vOld] }, '2026-07-06', 2), 2);
  });

  // ── Pre-built programs (programs-db.js + LB.instantiateProgram) ─────────────
  const _catWin = {};
  new Function('window', fs.readFileSync(path.join(__dirname, '../../src/exercise-db.js'), 'utf8'))(_catWin);
  new Function('window', fs.readFileSync(path.join(__dirname, '../../src/programs-db.js'), 'utf8'))(_catWin);
  const SYS_EX = _catWin.SYSTEM_EXERCISES || [];
  const SYS_PROG = _catWin.SYSTEM_PROGRAMS || [];

  test('every pre-built program references only real catalog exercises', () => {
    const names = new Set(SYS_EX.map(e => (e.name || '').toUpperCase()));
    const missing = [];
    for (const p of SYS_PROG) for (const d of p.days) for (const it of d.items) {
      if (!names.has((it.ex || '').toUpperCase())) missing.push(`${p.name}/${d.name}: ${it.ex}`);
    }
    assert.deepStrictEqual(missing, [], 'unknown exercise names: ' + missing.join(', '));
  });

  test('pre-built programs are well-formed (unique ids, ~16 sets/session, valid Range reps)', () => {
    assert.ok(SYS_PROG.length >= 1, 'expected at least one program');
    const ids = SYS_PROG.map(p => p.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'program ids must be unique');
    for (const p of SYS_PROG) {
      assert.strictEqual(p.days.length, p.daysPerWeek, `${p.name}: days must match daysPerWeek`);
      for (const d of p.days) {
        const sets = d.items.reduce((a, it) => a + it.sets, 0);
        assert.ok(sets >= 14 && sets <= 18, `${p.name}/${d.name}: ${sets} sets outside 14-18`);
        for (const it of d.items) {
          assert.ok(it.reps > 0, `${p.name}/${d.name}/${it.ex}: reps must be > 0`);
          if (it.repsMax != null) assert.ok(it.repsMax >= it.reps, `${p.name}/${d.name}/${it.ex}: repsMax < reps`);
        }
      }
    }
  });

  test('instantiateProgram builds a flex mesocycle with materialized (non-sys_) exercises', () => {
    const program = SYS_PROG.find(p => p.id === 'prog_fb3') || SYS_PROG[0];
    const { schedule, newExercises } = LB.instantiateProgram({ exercises: [] }, program);
    assert.strictEqual(schedule.is_flex, true);
    assert.strictEqual(schedule.sessions_per_week, program.days.length);
    assert.strictEqual(schedule.mesocycle_weeks, program.meso.weeks);
    assert.strictEqual(schedule.mesocycle_start_rir, program.meso.startRir);
    assert.strictEqual(schedule.mesocycle_end_rir, program.meso.endRir);
    assert.strictEqual(schedule.days.length, program.days.length);
    const exIds = new Set(newExercises.map(e => e.id));
    for (const d of schedule.days) for (const it of d.items) {
      assert.ok(!String(it.exId).startsWith('sys_'), 'plan item must not hold a sys_ id');
      assert.ok(exIds.has(it.exId), 'plan item must reference a materialized exercise');
      assert.ok(it.sets > 0 && it.reps > 0, 'item sets/reps carried over');
    }
    // A name repeated across days materializes ONE row (dedup): unique names == new rows.
    const uniq = new Set();
    for (const d of program.days) for (const it of d.items) uniq.add(it.ex.toUpperCase());
    assert.strictEqual(newExercises.length, uniq.size, 'one materialized row per unique exercise name');
  });

  test('instantiateProgram reuses a same-named existing user exercise instead of duplicating', () => {
    const program = SYS_PROG.find(p => p.id === 'prog_fb3') || SYS_PROG[0];
    const usedName = program.days[0].items[0].ex;
    const state = { exercises: [{ id: 'user_existing', name: usedName, tags: [] }] };
    const { schedule, newExercises } = LB.instantiateProgram(state, program);
    assert.ok(!newExercises.some(e => (e.name || '').toUpperCase() === usedName.toUpperCase()), 'must not duplicate a same-named exercise');
    assert.ok(schedule.days.some(d => d.items.some(it => it.exId === 'user_existing')), 'plan item must reference the reused existing exercise id');
  });

  test('5/3/1 wave math: percentages, rounding, AMRAP top set', () => {
    const w1 = LB.fiveThreeOneSets(100, 1, 'kg');
    // Compare by value via join(): LB runs in a vm realm, so its arrays are not
    // reference-equal to this realm's and assert.deepStrictEqual would reject them.
    assert.strictEqual(w1.map(s => s.kg).join(','), '65,75,85');
    assert.strictEqual(w1.map(s => s.reps).join(','), '5,5,5');
    assert.strictEqual(w1[2].amrap, true);
    assert.ok(!w1[0].amrap && !w1[1].amrap, 'only the top set is AMRAP');
    // rounds to 2.5 kg: 70/80/90% of 102.5 = 71.75/82/92.25
    assert.strictEqual(LB.fiveThreeOneSets(102.5, 2, 'kg').map(s => s.kg).join(','), '72.5,82.5,92.5');
    // lbs rounds to 5: 65/75/85% of 185 = 120.25/138.75/157.25
    assert.strictEqual(LB.fiveThreeOneSets(185, 1, 'lbs').map(s => s.kg).join(','), '120,140,155');
    // week 3 tapers to a single AMRAP rep; week 4 is the deload (no AMRAP)
    assert.strictEqual(LB.fiveThreeOneSets(100, 3, 'kg')[2].reps, 1);
    assert.ok(LB.fiveThreeOneSets(100, 4, 'kg').every(s => !s.amrap));
    // null TM (preview before setup) yields null loads but keeps reps/pct
    const wp = LB.fiveThreeOneSets(null, 1, 'kg');
    assert.strictEqual(wp[0].kg, null);
    assert.strictEqual(wp[0].pct, 65);
  });

  test('5/3/1 TM helpers: from-1RM, per-cycle bump, week clamp, plan flag', () => {
    assert.strictEqual(LB.tmFrom531(100, 'kg'), 90);
    assert.strictEqual(LB.tmFrom531(102, 'kg'), 92.5); // 91.8 rounds to 92.5
    assert.strictEqual(LB.tmFrom531(0, 'kg'), null);
    assert.strictEqual(LB.tmBump531('squat', 'kg'), 5);
    assert.strictEqual(LB.tmBump531('bench', 'kg'), 2.5);
    assert.strictEqual(LB.tmBump531('deadlift', 'lbs'), 10);
    assert.strictEqual(LB.tmBump531('ohp', 'lbs'), 5);
    assert.strictEqual(LB.week531(0, true), 1);
    assert.strictEqual(LB.week531(3, true), 4);
    assert.strictEqual(LB.week531(4, true), 1); // next cycle wraps to week 1
    assert.strictEqual(LB.week531(3, false), 1); // 3-week block wraps without a deload
    assert.strictEqual(LB.is531Plan({ program_type: '531' }), true);
    assert.strictEqual(LB.is531Plan({ program_type: null }), false);
    assert.strictEqual(LB.is531Plan(null), false);
  });

  test('current531Week / current531Cycle count logged sessions into weeks and cycles', () => {
    const sch = { id: 'p531', program_type: '531', days: [{}, {}, {}, {}], program_data: { includeDeload: true } };
    const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: 's' + i, ended: '2026-01-01', scheduleId: 'p531' }));
    assert.strictEqual(LB.current531Week(sch, []), 1);
    assert.strictEqual(LB.current531Week(sch, mk(4)), 2);   // 4 sessions = one full pass = week 2
    assert.strictEqual(LB.current531Week(sch, mk(12)), 4);  // 12/4 = 3 weeks done -> week 4
    assert.strictEqual(LB.current531Week(sch, mk(16)), 1);  // 16/4 = 4 -> next cycle, week 1
    assert.strictEqual(LB.current531Cycle(sch, mk(16)), 1);
    assert.strictEqual(LB.current531Cycle(sch, mk(15)), 0);
    // app-deload sessions (statusMode) don't advance the 5/3/1 count
    const withDeload = [...mk(4), { id: 'd', ended: '2026-02-01', scheduleId: 'p531', isDeload: true }];
    assert.strictEqual(LB.current531Week(sch, withDeload), 2);
    // bonus sessions carry the plan's scheduleId but don't advance the plan
    // position, so they must not advance the wave either (a bonus finished
    // with "advance cycle" loses its isBonus flag and then counts normally)
    const withBonus = [...mk(4), { id: 'b1', ended: '2026-02-02', scheduleId: 'p531', isBonus: true }, { id: 'b2', ended: '2026-02-03', scheduleId: 'p531', isBonus: true }];
    assert.strictEqual(LB.current531Week(sch, withBonus), 2);
    assert.strictEqual(LB.current531Cycle(sch, [...mk(15), { id: 'b3', ended: '2026-02-04', scheduleId: 'p531', isBonus: true }]), 0); // bonus can't tip the cycle end
    // in-progress sessions (ended null) never count
    assert.strictEqual(LB.current531Week(sch, [...mk(4), { id: 'ip', ended: null, scheduleId: 'p531' }]), 2);
    // a 3-week block (deload off) wraps faster
    const sch3 = { ...sch, program_data: { includeDeload: false } };
    assert.strictEqual(LB.current531Week(sch3, mk(8)), 3);   // 8/4 = 2 -> week 3
    assert.strictEqual(LB.current531Week(sch3, mk(12)), 1);  // 12/4 = 3 -> wraps to week 1
    assert.strictEqual(LB.current531Week({ program_type: null }, mk(4)), null);
  });

  test('compute531CycleBumps flags hit/miss; resolve531CycleEnd bumps, stalls, resets, logs history', () => {
    const mkSch = (lifts) => ({ id: 'p', program_type: '531', days: lifts.map(() => ({})),
      program_data: { unit: 'kg', includeDeload: false,
        mainLifts: Object.fromEntries(lifts.map(m => [m.id, { tm: m.tm, kind: m.kind, stall: m.stall || 0 }])),
        tmHistory: Object.fromEntries(lifts.map(m => [m.id, [{ cycle: 0, tm: m.tm, reason: 'start' }]])) } });
    // one session: warmup + two straight sets + a final AMRAP set at topReps
    const mkSess = (exId, i, topReps) => ({ id: exId + '_' + i, ended: '2026-01-' + String(i + 1).padStart(2, '0') + 'T10:00:00', scheduleId: 'p',
      entries: [{ exId, sets: [{ kg: 40, reps: 5, warmup: true }, { kg: 60, reps: 5 }, { kg: 70, reps: 4 }, { kg: 80, reps: topReps }] }] });
    // single lift, dayCount 1 -> sessions 0,1,2 are weeks 1,2,3 of cycle 0
    const sq = mkSch([{ id: 'sq', tm: 100, kind: 'squat' }]);
    const hitCycle = [mkSess('sq', 0, 5), mkSess('sq', 1, 3), mkSess('sq', 2, 1)];
    const missCycle = [mkSess('sq', 0, 5), mkSess('sq', 1, 3), mkSess('sq', 2, 0)];

    // compute: hit -> bumped, miss -> missed, no data -> neither
    let r = LB.compute531CycleBumps(sq, hitCycle, 0);
    assert.strictEqual(r.sq.newTm, 105);           // squat lower body: +5 kg
    assert.strictEqual(r.sq.bumped, true);
    assert.strictEqual(r.sq.missed, false);
    r = LB.compute531CycleBumps(sq, missCycle, 0);
    assert.strictEqual(r.sq.bumped, false);
    assert.strictEqual(r.sq.missed, true);
    const noData = LB.compute531CycleBumps(sq, [], 0).sq;
    assert.strictEqual(noData.bumped, false);
    assert.strictEqual(noData.missed, false);
    // bench upper body: +2.5 kg
    const bp = mkSch([{ id: 'bp', tm: 80, kind: 'bench' }]);
    assert.strictEqual(LB.compute531CycleBumps(bp, [mkSess('bp', 0, 5), mkSess('bp', 1, 3), mkSess('bp', 2, 1)], 0).bp.newTm, 82.5);

    // resolve: a hit bumps, clears stall, appends a 'bump' point, stamps bumpedCycle
    let res = LB.resolve531CycleEnd(sq.program_data, LB.compute531CycleBumps(sq, hitCycle, 0), 0);
    assert.strictEqual(res.programData.mainLifts.sq.tm, 105);
    assert.strictEqual(res.programData.mainLifts.sq.stall, 0);
    assert.strictEqual(res.programData.bumpedCycle, 0);
    assert.strictEqual(res.bumped.length, 1);
    assert.strictEqual(res.programData.tmHistory.sq.map(h => h.reason).join(','), 'start,bump');
    assert.strictEqual(res.programData.tmHistory.sq[1].tm, 105);

    // resolve: first miss holds, stall -> 1, no new history point
    res = LB.resolve531CycleEnd(sq.program_data, LB.compute531CycleBumps(sq, missCycle, 0), 0);
    assert.strictEqual(res.programData.mainLifts.sq.tm, 100);
    assert.strictEqual(res.programData.mainLifts.sq.stall, 1);
    assert.strictEqual(res.held.length, 1);
    assert.strictEqual(res.reset.length, 0);
    assert.strictEqual(res.programData.tmHistory.sq.length, 1);

    // resolve: second miss in a row (stall already 1) -> reset TM to 90%, stall 0, 'reset' point
    const stalled = mkSch([{ id: 'sq', tm: 100, kind: 'squat', stall: 1 }]);
    res = LB.resolve531CycleEnd(stalled.program_data, LB.compute531CycleBumps(stalled, missCycle, 0), 0);
    assert.strictEqual(res.programData.mainLifts.sq.tm, 90);   // round531(100 * 0.9) = 90
    assert.strictEqual(res.programData.mainLifts.sq.stall, 0);
    assert.strictEqual(res.reset.length, 1);
    assert.strictEqual(res.programData.tmHistory.sq.map(h => h.reason).join(','), 'start,reset');

    // resolve: lifts with no data this cycle are left untouched (no stall, no history)
    const two = mkSch([{ id: 'sq', tm: 100, kind: 'squat' }, { id: 'bp', tm: 80, kind: 'bench' }]);
    res = LB.resolve531CycleEnd(two.program_data, LB.compute531CycleBumps(two, [], 0), 0);
    assert.strictEqual(res.programData.mainLifts.bp.tm, 80);
    assert.strictEqual(res.programData.mainLifts.bp.stall || 0, 0);
    assert.strictEqual((res.programData.tmHistory.bp || []).length, 1);
    assert.strictEqual(res.bumped.length + res.held.length + res.reset.length, 0);
  });

  test('compute531CycleBumps reads the AMRAP-flagged set, not a low-rep Joker appended after it', () => {
    const mkSch = () => ({ id: 'p', program_type: '531', days: [{}],
      program_data: { unit: 'kg', includeDeload: false,
        mainLifts: { sq: { tm: 100, kind: 'squat', stall: 0 } },
        tmHistory: { sq: [{ cycle: 0, tm: 100, reason: 'start' }] } } });
    // Ramp sets + the flagged AMRAP top set (hits its min) + a heavier Joker
    // single appended AFTER it. Positionally the Joker is last; the fix must read
    // the amrap-flagged set, else weeks 1-2 (min 5/3) read the reps=1 Joker as a
    // miss and the TM wrongly holds.
    const mkSess = (i, topReps) => ({ id: 'sq_' + i, ended: '2026-02-' + String(i + 1).padStart(2, '0') + 'T10:00:00', scheduleId: 'p',
      entries: [{ exId: 'sq', sets: [
        { kg: 60, reps: 5 }, { kg: 70, reps: 4 },
        { kg: 80, reps: topReps, amrap: true },
        { kg: 92.5, reps: 1 },
      ] }] });
    const cyc = [mkSess(0, 5), mkSess(1, 3), mkSess(2, 1)];
    const r = LB.compute531CycleBumps(mkSch(), cyc, 0);
    assert.strictEqual(r.sq.bumped, true);
    assert.strictEqual(r.sq.newTm, 105);
  });

  test('suggest531Tm: fair TM from an AMRAP-implied 1RM, flags when it beats the current TM', () => {
    // 102 x 12 -> est 1RM 142.8 -> fair TM 90% = 128.52 -> round 127.5, above 120 + 2.5
    let s = LB.suggest531Tm(LB.e1rm(102, 12), 120, 'bench', 'kg');
    assert.strictEqual(s.tm, 127.5);
    assert.strictEqual(s.higher, true);
    // 102 x 8 -> est 1RM 129.2 -> fair ~117.5, not a full increment above 120
    s = LB.suggest531Tm(LB.e1rm(102, 8), 120, 'bench', 'kg');
    assert.strictEqual(s.higher, false);
    // no estimate -> null / not higher
    const none = LB.suggest531Tm(0, 120, 'bench', 'kg');
    assert.strictEqual(none.tm, null);
    assert.strictEqual(none.higher, false);
  });

  test('tmBump531: extra lifts bump by upper/lower class like the canonical four', () => {
    assert.strictEqual(LB.tmBump531('lower', 'kg'), 5);   // like squat/deadlift
    assert.strictEqual(LB.tmBump531('upper', 'kg'), 2.5); // like bench/ohp
    assert.strictEqual(LB.tmBump531('lower', 'lbs'), 10);
    assert.strictEqual(LB.tmBump531('upper', 'lbs'), 5);
    assert.strictEqual(LB.tmBump531('squat', 'kg'), 5);   // canonical unchanged
    assert.strictEqual(LB.tmBump531('bench', 'kg'), 2.5);
  });

  test('add531MainLift: registers a lift on existing program_data, seeds a Wendler day', () => {
    const pd = { unit: 'kg', mainLifts: { sq: { tm: 100, kind: 'squat', stall: 0 } }, tmHistory: { sq: [{ cycle: 0, tm: 100, reason: 'start' }] } };
    const { programData, items } = LB.add531MainLift(pd, { exId: 'row', kind: 'upper', tm: 60, cycle: 2, assistanceIds: ['a1', 'a2'] });
    assert.strictEqual(programData.mainLifts.row.tm, 60);
    assert.strictEqual(programData.mainLifts.row.kind, 'upper');
    assert.strictEqual(programData.mainLifts.row.stall, 0);
    assert.strictEqual(programData.mainLifts.sq.tm, 100, 'existing lift untouched');
    // history stamped at the plan's current cycle (chart starts where it was added)
    assert.strictEqual(programData.tmHistory.row.map(h => `${h.cycle}:${h.reason}`).join(','), '2:start');
    // the day: main lift (3x5) + assistance as Range items (Smart Progression)
    assert.strictEqual(items.map(i => i.exId).join(','), 'row,a1,a2');
    assert.strictEqual(items[0].sets, 3);
    assert.strictEqual(items[0].reps, 5);
    assert.strictEqual(items[1].repsMax, 12);
    // no TM yet -> empty history, no start point
    const noTm = LB.add531MainLift(pd, { exId: 'ohp2', kind: 'lower' });
    assert.strictEqual(noTm.programData.mainLifts.ohp2.tm, null);
    assert.strictEqual(noTm.programData.tmHistory.ohp2.length, 0);
  });

  test('build531Plan: an extra lift names its day after the exercise and carries its own assistance', () => {
    const res = LB.build531Plan({ exercises: [{ id: 'row1', name: 'Barbell Row' }, { id: 'aid1', name: 'Face Pull' }] }, {
      unit: 'kg', lifts: [{ kind: 'lower', ex: 'row1', tm: 60, name: 'Barbell Row', assistance: ['aid1'] }],
    });
    assert.strictEqual(res.schedule.days.length, 1);
    assert.strictEqual(res.schedule.days[0].name, 'Barbell Row', 'day named after the exercise, not "lower"');
    assert.strictEqual(res.schedule.program_data.mainLifts.row1.kind, 'lower');
    assert.strictEqual(res.schedule.days[0].items.map(i => i.exId).join(','), 'row1,aid1');
  });

  test('is531MainLift: true only for a registered main lift on the plan owning the day', () => {
    const store = {
      schedules: [
        { id: 'p531', program_type: '531', days: [{ id: 'd1', items: [{ exId: 'sq' }, { exId: 'leg' }] }],
          program_data: { mainLifts: { sq: { tm: 100, kind: 'squat', stall: 0 } } } },
        { id: 'pnorm', days: [{ id: 'd2', items: [{ exId: 'sq' }] }] },
      ],
    };
    assert.strictEqual(LB.is531MainLift(store, 'sq', 'd1'), true);   // main lift on the 531 day
    assert.strictEqual(LB.is531MainLift(store, 'leg', 'd1'), false); // assistance, not a main lift
    assert.strictEqual(LB.is531MainLift(store, 'sq', 'd2'), false);  // same exId, but a normal plan's day
    assert.strictEqual(LB.is531MainLift(store, 'sq', null), false);  // no day (freestyle) -> false
    assert.strictEqual(LB.is531MainLift(store, null, 'd1'), false);
  });

  test('progressionSuggestion: suppressed for a 5/3/1 main lift, normal for its assistance', () => {
    const store = {
      settings: { smartProgression: true },
      exercises: [{ id: 'sq', name: 'Squat' }, { id: 'leg', name: 'Leg Press' }],
      schedules: [
        { id: 'p531', program_type: '531', days: [{ id: 'd1', items: [{ exId: 'sq' }, { exId: 'leg' }] }],
          program_data: { mainLifts: { sq: { tm: 100, kind: 'squat', stall: 0 } } } },
      ],
    };
    // A reference where the working set cleared its target, so progression WOULD fire.
    const ref = { entry: { sets: [{ kg: 100, reps: 10, warmup: false }] } };
    assert.strictEqual(LB.progressionSuggestion(store, 'sq', 'd1', 5, null, ref, null, null), null, 'main lift never gets a Smart Progression bump');
    const sugg = LB.progressionSuggestion(store, 'leg', 'd1', 5, null, ref, null, null);
    assert.ok(sugg && sugg.kg > 100, 'assistance on the 531 day still progresses');
  });

  test('build531Plan: catalog names resolve, 4 days, program_data stamped, assistance uncapped', () => {
    const FTO = _catWin.FIVE_THREE_ONE;
    assert.ok(FTO && Array.isArray(FTO.lifts) && FTO.lifts.length === 4, 'FIVE_THREE_ONE has 4 lifts');
    const names = new Set(SYS_EX.map(e => (e.name || '').toUpperCase()));
    for (const l of FTO.lifts) assert.ok(names.has((l.ex || '').toUpperCase()), 'main lift in catalog: ' + l.ex);
    const config = {
      unit: 'kg', includeDeload: true,
      lifts: FTO.lifts.map((l, i) => ({ ...l, tm: [140, 100, 180, 60][i] })),
      assistance: { squat: ['Leg Press', 'Seated Leg Curl'], bench: ['Incline Dumbbell Press'], deadlift: ['Lat Pulldown'], ohp: ['Machine Lateral Raise'] },
    };
    const { schedule, newExercises } = LB.build531Plan({ exercises: [] }, config);
    assert.strictEqual(schedule.program_type, '531');
    assert.strictEqual(schedule.is_flex, true);
    assert.strictEqual(schedule.days.length, 4);
    assert.strictEqual(schedule.program_data.unit, 'kg');
    assert.strictEqual(schedule.program_data.includeDeload, true);
    const ml = schedule.program_data.mainLifts;
    assert.strictEqual(Object.keys(ml).length, 4);
    assert.strictEqual(Object.values(ml).map(v => v.kind).sort().join(','), 'bench,deadlift,ohp,squat');
    // each lift starts un-stalled with a seeded TM-history point at cycle 0
    const th = schedule.program_data.tmHistory;
    assert.strictEqual(Object.keys(th).length, 4, 'tmHistory seeded per lift');
    for (const exId of Object.keys(ml)) {
      assert.strictEqual(ml[exId].stall, 0, 'lift seeded with stall 0');
      assert.strictEqual(th[exId].length, 1, 'one seed point per lift');
      assert.strictEqual(th[exId][0].reason, 'start');
      assert.strictEqual(th[exId][0].tm, ml[exId].tm);
      assert.strictEqual(th[exId][0].cycle, 0);
    }
    for (const d of schedule.days) for (const it of d.items) assert.ok(!String(it.exId).startsWith('sys_'), 'no sys_ id in plan');
    for (const exId of Object.keys(ml)) assert.ok(!exId.startsWith('sys_'), 'no sys_ id in mainLifts');
    for (const d of schedule.days) {
      assert.strictEqual(d.items[0].sets, 3);
      assert.ok(ml[d.items[0].exId], 'day leads with a tracked main lift');
      assert.ok(d.items.length >= 1, 'day has at least its main lift');
      for (let i = 1; i < d.items.length; i++) assert.ok(!ml[d.items[i].exId], 'assistance is not a tracked main lift');
    }
    assert.ok(newExercises.length >= 4, 'materialized the main lifts (and assistance)');
    // assistance is uncapped: supply as many as you like (owned ids so they all
    // resolve), and every one comes through
    const ownedAssist = ['a1', 'a2', 'a3', 'a4', 'a5'].map(id => ({ id, name: id }));
    const over = LB.build531Plan({ exercises: ownedAssist }, { unit: 'kg', lifts: [FTO.lifts[0]],
      assistance: { squat: ['a1', 'a2', 'a3', 'a4', 'a5'] } });
    assert.strictEqual(over.schedule.days[0].items.length, 6, 'main + all 5 assistance, no cap');
    // no assistance -> just the main lift per day
    const bare = LB.build531Plan({ exercises: [] }, { unit: 'kg', lifts: FTO.lifts.map(l => ({ ...l, tm: 100 })), assistance: {} });
    for (const d of bare.schedule.days) assert.strictEqual(d.items.length, 1, 'main lift only when assistance is off');
    // assistance supplied as an already-owned exId (wizard picks) passes through, not re-materialized
    const owned = { id: 'user_ex1', name: 'My Curl', tags: [] };
    const withId = LB.build531Plan({ exercises: [owned] }, { unit: 'kg', lifts: [{ ...FTO.lifts[0], tm: 100 }], assistance: { squat: ['user_ex1'] } });
    assert.ok(withId.schedule.days[0].items.some(it => it.exId === 'user_ex1'), 'owned assistance exId reused');
    assert.ok(!withId.newExercises.some(e => e.id === 'user_ex1'), 'owned exId not duplicated');
  });

  test('time-based sets: fmtDuration formats, 0 volume, still counted as done', () => {
    assert.strictEqual(LB.fmtDuration(45), '45s');
    assert.strictEqual(LB.fmtDuration(60), '1:00');
    assert.strictEqual(LB.fmtDuration(75), '1:15');
    assert.strictEqual(LB.fmtDuration(600), '10:00');
    assert.strictEqual(LB.fmtDuration(null), '');
    // a finished HIIT session: three logged intervals, no weight
    const ended = { ended: '2026-01-01', entries: [{ exId: 'jr', sets: [
      { timeSec: 75, done: true }, { timeSec: 75, done: true }, { timeSec: 60, done: true },
    ] }] };
    assert.strictEqual(LB.totalVolume(ended, []), 0, 'time sets add nothing to volume');
    assert.strictEqual(LB.doneSetCount(ended), 3, 'all three time sets count as done');
    // warm-ups/skipped never count
    const mixed = { ended: '2026-01-01', entries: [{ exId: 'jr', sets: [
      { timeSec: 30, warmup: true }, { timeSec: 75, done: true }, { timeSec: 60, skipped: true },
    ] }] };
    assert.strictEqual(LB.doneSetCount(mixed), 1, 'only the working logged time set counts');
  });

  test('assisted volume: bodyweight minus assistance, fallback without a logged weight', () => {
    assert.strictEqual(LB.isAssisted({ movement_type: 'assisted' }), true);
    assert.strictEqual(LB.isAssisted({ movement_type: 'bilateral' }), false);
    assert.strictEqual(LB.isAssisted({}), false);
    const exs = [{ id: 'ad', movement_type: 'assisted' }];
    const bw80 = [{ date: '2026-01-01', weight: 80 }];
    // assisted dips: assistance stored negative, both sets are done
    const ended = { ended: '2026-01-01', date: '2026-01-01', entries: [{ exId: 'ad', sets: [
      { kg: -40, reps: 8, done: true }, { kg: -35, reps: 6, done: true },
    ] }] };
    assert.strictEqual(LB.doneSetCount(ended), 2, 'both assisted sets count as done');
    // no exercise meta / no logged bodyweight: old behavior, assistance adds nothing
    assert.strictEqual(LB.totalVolume(ended, []), 0, 'no exercise meta → assistance adds no volume');
    assert.strictEqual(LB.totalVolume(ended, exs), 0, 'assisted but no logged bodyweight → 0');
    // bodyweight 80: (80-40)*8 + (80-35)*6 = 320 + 270 = 590
    assert.strictEqual(LB.totalVolume(ended, exs, bw80), 590, 'bodyweight minus assistance counts');
    // assistance exceeding bodyweight clamps to 0
    assert.strictEqual(LB.totalVolume(ended, exs, [{ date: '2026-01-01', weight: 30 }]), 0, 'assistance > bodyweight clamps to 0');
    // less assistance (-35) beats more (-40): improvement, no false regression
    const prev = { kg: -40, reps: 8, done: true };
    const curr = { kg: -35, reps: 8, done: true };
    assert.strictEqual(LB.isImprovement(curr, prev), true, 'less assistance is an improvement');
    assert.strictEqual(LB.isDecline(curr, prev), false, 'less assistance is not a decline');
    assert.strictEqual(LB.isDecline({ kg: -45, reps: 8, done: true }, prev), true, 'more assistance is a decline');
    // graduated past zero into added weight: bodyweight applies across the whole range
    const grad = { ended: '2026-01-01', date: '2026-01-01', entries: [{ exId: 'ad', sets: [
      { kg: -5, reps: 8, done: true }, { kg: 10, reps: 5, done: true },
    ] }] };
    assert.strictEqual(LB.totalVolume(grad, []), 50, 'fallback: only the positive graduated set counts (10x5)');
    assert.strictEqual(LB.totalVolume(grad, exs, bw80), 1050, 'with bodyweight: (80-5)*8 + (80+10)*5 = 1050');
  });

  test('bodyweightForDate: nearest logged weight to a date, null when none', () => {
    const logs = [{ date: '2026-01-01', weight: 80 }, { date: '2026-02-01', weight: 82 }, { date: '2026-03-01', weight: 78 }];
    assert.strictEqual(LB.bodyweightForDate(logs, '2026-01-05'), 80, 'closest is Jan 1');
    assert.strictEqual(LB.bodyweightForDate(logs, '2026-02-05'), 82, 'closest is Feb 1');
    assert.strictEqual(LB.bodyweightForDate(logs, '2026-03-05'), 78, 'closest is Mar 1');
    assert.strictEqual(LB.bodyweightForDate([], '2026-01-01'), null, 'no logs → null');
    assert.strictEqual(LB.bodyweightForDate([{ date: '2026-01-01', weight: null }], '2026-01-01'), null, 'null weight ignored');
  });

  test('bestAssistLoad: highest (least-negative) load across ended sessions, null when empty', () => {
    const state = { sessions: [
      { id: 's1', ended: '2026-01-01', dayId: 'd1', entries: [{ exId: 'ad', sets: [{ kg: -40, reps: 8 }, { kg: -45, reps: 6 }] }] },
      { id: 's2', ended: '2026-01-08', dayId: 'd1', entries: [{ exId: 'ad', sets: [{ kg: -35, reps: 8 }, { kg: -30, reps: 5 }] }] },
      { id: 's3', ended: null, dayId: 'd1', entries: [{ exId: 'ad', sets: [{ kg: -20, reps: 8 }] }] }, // in-progress, ignored
    ] };
    assert.strictEqual(LB.bestAssistLoad(state, 'ad'), -30, 'least assistance is -30 (highest kg among ended)');
    assert.strictEqual(LB.bestAssistLoad(state, 'ad', 's2'), -40, 'excluding s2 leaves -40 as the best');
    assert.strictEqual(LB.bestAssistLoad(state, 'nope'), null, 'no history returns null (not 0)');
    // warm-ups/skipped never count
    const state2 = { sessions: [{ id: 's1', ended: '2026-01-01', entries: [{ exId: 'ad', sets: [
      { kg: -10, reps: 8, warmup: true }, { kg: -40, reps: 8 },
    ] }] }] };
    assert.strictEqual(LB.bestAssistLoad(state2, 'ad'), -40, 'the -10 warm-up does not count as the best');
  });

  test('time-based history: recent-session lookup finds time-only sessions and carries timeSec', () => {
    const state = { sessions: [
      { id: 's1', ended: '2026-01-01T10:00:00', dayId: 'd1', entries: [{ exId: 'jr', sets: [
        { timeSec: 75, done: true }, { timeSec: 75, done: true }, { timeSec: 60, done: true },
      ] }] },
    ] };
    assert.strictEqual(LB.recentSessionsForExercise(state, 'jr', 'd1').length, 1, 'time-only session is found');
    const ref = LB.bestRecentEntry(state, 'jr', 'd1');
    assert.ok(ref, 'bestRecentEntry returns a reference for a time exercise');
    assert.strictEqual((ref.entry.sets || []).map(s => s.timeSec).join(','), '75,75,60', 'reference carries per-set timeSec');
  });

  test('buildTimeSeedSets: authored target > last logged > authored tail > 30s default', () => {
    const last = { entry: { sets: [{ timeSec: 75, done: true }, { timeSec: 60, done: true }] } };
    // authored per-set targets win where present; a null slot falls through to
    // the last logged time at that position, then the default
    assert.strictEqual(LB.buildTimeSeedSets({ sets: 3, timeSecPerSet: [45, null, null] }, last).map(s => s.timeSec).join(','), '45,60,30');
    // a shorter authored list extends via its tail value
    assert.strictEqual(LB.buildTimeSeedSets({ sets: 3, timeSecPerSet: [45] }, null).map(s => s.timeSec).join(','), '45,45,45');
    // no authored targets: last logged per position, default beyond
    assert.strictEqual(LB.buildTimeSeedSets({ sets: 3 }, last).map(s => s.timeSec).join(','), '75,60,30');
    // no history at all: 30s default, at least one set
    assert.strictEqual(LB.buildTimeSeedSets({ sets: 0 }, null).map(s => s.timeSec).join(','), '30');
    // every seeded set starts unchecked
    assert.strictEqual(LB.buildTimeSeedSets({ sets: 2 }, last).every(s => s.done === false), true);
  });

  test('buildSeedSets routes time-mode items to buildTimeSeedSets (in-session swap path)', () => {
    const store = { exercises: [{ id: 'jr', name: 'Jump Rope', log_mode: 'time' }], settings: {} };
    const last = { entry: { sets: [{ timeSec: 90, done: true }] } };
    const seeds = LB.buildSeedSets({ exId: 'jr', sets: 2 }, last, null, false, store, null);
    assert.strictEqual(seeds.map(s => s.timeSec).join(','), '90,30', 'swap seeds durations, not kg/reps');
    assert.strictEqual(seeds.some(s => 'kg' in s), false, 'no weight fields on time seeds');
  });

  // ── mergePlanDrafts: multi-device plan-editor draft merge ────────────────
  // Map merge keyed by scheduleId, entries { draft, updatedAt }. Base = the
  // last-synced map; membership in base distinguishes "deleted since sync" from
  // "never synced".
  const pd = (u, tag) => ({ draft: { id: 's', tag: tag ?? u }, updatedAt: u });
  test('mergePlanDrafts: both sides present → newer updatedAt wins', () => {
    const fresh = { s: pd('2026-07-12T10:00:00Z', 'server') };
    const cur = { s: pd('2026-07-12T11:00:00Z', 'local') };
    assert.strictEqual(LB.mergePlanDrafts(fresh, cur, {}).s.draft.tag, 'local');
    // and the reverse: server newer wins
    const fresh2 = { s: pd('2026-07-12T12:00:00Z', 'server') };
    assert.strictEqual(LB.mergePlanDrafts(fresh2, cur, {}).s.draft.tag, 'server');
  });
  test('mergePlanDrafts: equal timestamps → local wins (tie goes to this device)', () => {
    const t = '2026-07-12T10:00:00Z';
    const out = LB.mergePlanDrafts({ s: pd(t, 'server') }, { s: pd(t, 'local') }, {});
    assert.strictEqual(out.s.draft.tag, 'local');
  });
  test('mergePlanDrafts: server-only draft not in base → kept (another device started it)', () => {
    const out = LB.mergePlanDrafts({ s: pd('2026-07-12T10:00:00Z') }, {}, {});
    assert.ok(out.s, 'a genuinely new server-side draft is adopted');
  });
  test('mergePlanDrafts: server-only draft that was in base → dropped (Saved/Discarded here)', () => {
    const base = { s: pd('2026-07-12T09:00:00Z') };
    const out = LB.mergePlanDrafts({ s: pd('2026-07-12T09:00:00Z') }, {}, base);
    assert.strictEqual('s' in out, false, 'deleting locally must not be resurrected from the stale server row');
  });
  test('mergePlanDrafts: local-only draft not in base → kept (never-synced work)', () => {
    const out = LB.mergePlanDrafts({}, { s: pd('2026-07-12T10:00:00Z') }, {});
    assert.ok(out.s, 'an offline/unsynced local draft survives the merge');
  });
  test('mergePlanDrafts: local-only draft that was in base → dropped (Saved/Discarded elsewhere)', () => {
    const base = { s: pd('2026-07-12T09:00:00Z') };
    const out = LB.mergePlanDrafts({}, { s: pd('2026-07-12T09:00:00Z') }, base);
    assert.strictEqual('s' in out, false, 'a draft another device resolved must not linger locally');
  });
  test('mergePlanDrafts: null base (legacy cache) → keep both one-sided drafts', () => {
    const out = LB.mergePlanDrafts({ a: pd('2026-07-12T10:00:00Z') }, { b: pd('2026-07-12T10:00:00Z') }, null);
    assert.ok(out.a && out.b, 'without a base we cannot tell delete from never-synced, so keep both');
  });
  test('mergePlanDrafts: empty / undefined inputs → empty map', () => {
    // Object.keys, not deepStrictEqual: the returned object lives in the vm
    // realm, so its prototype differs from this file's and deepStrictEqual
    // rejects two structurally-equal {} across realms.
    assert.strictEqual(Object.keys(LB.mergePlanDrafts(undefined, undefined, undefined)).length, 0);
    assert.strictEqual(Object.keys(LB.mergePlanDrafts(null, null, null)).length, 0);
  });

  // ── Autoreg v2 P1: microcycle accounting (hard sets per muscle) ──────────────
  {
    const muscleOf = (id) => ({ bench: 'Chest', squat: 'Quads', curl: 'Biceps' }[id] || null);
    // A bench entry: 2 hard sets (a plain done set + a technique set), plus a
    // warmup, a skipped, and an undone set that must all be excluded.
    const benchEntry = () => ({ exId: 'bench', sets: [
      { done: true },
      { done: true, warmup: true },
      { done: true, skipped: true },
      { done: false },
      { done: true, technique: 'myo' },
    ] });
    const squatEntry = () => ({ exId: 'squat', sets: [{ done: true }, { done: true }, { done: true }] });
    const untagged = () => ({ exId: 'mystery', sets: [{ done: true }, { done: true }] });

    test('microcycleSetsByMuscle: hard-set count excludes warmup/skipped/undone, technique counts as 1', () => {
      const sch = { id: 'p', is_flex: true, days: [{ id: 'd1' }] };
      const s = { id: 's', scheduleId: 'p', ended: '2026-07-13T10:00:00Z', date: '2026-07-13', entries: [benchEntry(), untagged()] };
      const out = LB.microcycleSetsByMuscle([s], sch, muscleOf);
      assert.strictEqual(out.Chest, 2, 'plain done + technique = 2, warmup/skipped/undone excluded');
      assert.ok(!('null' in out) && out[null] === undefined, 'untagged exercise ignored');
    });

    test('microcycleSetsByMuscle: FLEX buckets by rotation index (dayId), current vs previous', () => {
      const sch = { id: 'p', is_flex: true, days: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }] }; // len 3
      const mk = (id, ended, dayId, entries) => ({ id, scheduleId: 'p', ended, date: ended.slice(0, 10), dayId, entries });
      // Two full rotations. Order in the array should not matter (fn sorts by ended).
      const sessions = [
        mk('a1', '2026-07-01T10:00:00Z', 'd1', [benchEntry()]),
        mk('a2', '2026-07-02T10:00:00Z', 'd2', [benchEntry()]),
        mk('a3', '2026-07-03T10:00:00Z', 'd3', [benchEntry()]),
        mk('b1', '2026-07-04T10:00:00Z', 'd1', [benchEntry()]),
        mk('b2', '2026-07-05T10:00:00Z', 'd2', [benchEntry()]),
        mk('b3', '2026-07-06T10:00:00Z', 'd3', [benchEntry(), squatEntry()]),
      ];
      const opts = { startDate: '2026-06-30', startedAt: '2026-06-30T00:00:00Z' };
      const cur = LB.microcycleSetsByMuscle(sessions, sch, muscleOf, { ...opts, which: 0 });
      assert.strictEqual(cur.Chest, 6, 'current rotation = its 3 sessions x 2 hard sets');
      assert.strictEqual(cur.Quads, 3, 'squat only in the current rotation');
      const prev = LB.microcycleSetsByMuscle(sessions, sch, muscleOf, { ...opts, which: 1 });
      assert.strictEqual(prev.Chest, 6, 'previous rotation = the earlier 3 sessions');
      assert.ok(!prev.Quads, 'no squat in the previous rotation');
    });

    test('microcycleSetsByMuscle: FLEX skipped-day rotation never borrows from the adjacent one', () => {
      const sch = { id: 'p', is_flex: true, days: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }] }; // len 3
      const mk = (id, ended, dayId, entries) => ({ id, scheduleId: 'p', ended, date: ended.slice(0, 10), dayId, entries });
      // Rotation A is complete (d1,d2,d3). Rotation B (current) skipped d2: only d1,d3.
      const sessions = [
        mk('a1', '2026-07-01T10:00:00Z', 'd1', [benchEntry()]),
        mk('a2', '2026-07-02T10:00:00Z', 'd2', [benchEntry()]),
        mk('a3', '2026-07-03T10:00:00Z', 'd3', [benchEntry()]),
        mk('b1', '2026-07-04T10:00:00Z', 'd1', [benchEntry()]),
        mk('b3', '2026-07-05T10:00:00Z', 'd3', [benchEntry(), squatEntry()]),
      ];
      const opts = { startDate: '2026-06-30', startedAt: '2026-06-30T00:00:00Z' };
      const cur = LB.microcycleSetsByMuscle(sessions, sch, muscleOf, { ...opts, which: 0 });
      // Only b1 + b3 (Chest 4), NOT the old trained-count slice which would have
      // borrowed a3 into the current window and reported Chest 6.
      assert.strictEqual(cur.Chest, 4, 'current rotation is only its own two trained days');
      assert.strictEqual(cur.Quads, 3, 'squat (in b3) belongs to the current rotation');
      const prev = LB.microcycleSetsByMuscle(sessions, sch, muscleOf, { ...opts, which: 1 });
      assert.strictEqual(prev.Chest, 6, 'previous rotation keeps all three of its days');
    });

    test('microcycleSetsByMuscle: WEEKDAY window is the pause-adjusted meso week + scheduleId scoped', () => {
      const sch = { id: 'wp', mode: 'weekday', days: [{ weekday: 0 }] };
      const mk = (id, date, scheduleId) => ({ id, scheduleId: scheduleId || 'wp', ended: date + 'T10:00:00Z', date, entries: [benchEntry()] });
      // A 7-day deload sits mid-block. Without pause-adjustment s2 (rawDays 12) would
      // fall in meso week 1; with 7 frozen days subtracted it drops back to week 0,
      // sharing the current window with s1. s4 (rawDays 15 - 7 = 8) is week 1 = today.
      const statusPeriods = [{ mode: 'deload', startedAt: '2026-07-05T00:00:00Z', endedAt: '2026-07-11T00:00:00Z' }];
      const sessions = [
        mk('s1', '2026-07-02'),
        mk('s2', '2026-07-13'),
        mk('s4', '2026-07-16'),
        mk('other', '2026-07-16', 'zz'), // cross-plan: must be excluded (FIX 3)
      ];
      const opts = { startDate: '2026-07-01', statusPeriods, todayStr: '2026-07-16' };
      const cur = LB.microcycleSetsByMuscle(sessions, sch, muscleOf, { ...opts, which: 0 });
      assert.strictEqual(cur.Chest, 2, 'current meso week holds only s4 (cross-plan session excluded)');
      const prev = LB.microcycleSetsByMuscle(sessions, sch, muscleOf, { ...opts, which: 1 });
      assert.strictEqual(prev.Chest, 4, 'the prior meso week holds s1 AND s2, grouped by the pause adjustment');
    });

    test('microcycleSetsByMuscle: CYCLE window uses cumulative cycle numbering', () => {
      const sch = { id: 'cp', days: [{}, {}, {}], versions: [{ validFrom: '2026-07-01', days: [{}, {}, {}] }] }; // len 3
      const mk = (id, date) => ({ id, scheduleId: 'cp', ended: date + 'T10:00:00Z', date, entries: [benchEntry()] });
      // Cycle 1 = 07-01..07-03, Cycle 2 = 07-04..07-06.
      const sessions = [mk('c1', '2026-07-02'), mk('c2', '2026-07-05')];
      const cur = LB.microcycleSetsByMuscle(sessions, sch, muscleOf, { which: 0, todayStr: '2026-07-06' });
      assert.strictEqual(cur.Chest, 2, 'current cycle (2) holds the 07-05 session');
      const prev = LB.microcycleSetsByMuscle(sessions, sch, muscleOf, { which: 1, todayStr: '2026-07-06' });
      assert.strictEqual(prev.Chest, 2, 'previous cycle (1) holds the 07-02 session');
    });
  }

  // ── Autoreg v2 P3: landmarks (learned MRV EMA) + block backoff ───────────────
  {
    test('updateLandmarkMrv: first observation seeds the ceiling', () => {
      const out = LB.updateLandmarkMrv(null, 'Chest', 18);
      assert.strictEqual(out.landmarks.Chest.mrv, 18, 'first flag seeds mrv at the observed set count');
      assert.strictEqual(out.landmarks.Chest.mev, 9, 'mev is a light half-of-mrv default');
      assert.strictEqual(out.version, 2, 'stamps the P3 blob version');
    });

    test('updateLandmarkMrv: a single low spike does NOT fully drop a learned ceiling', () => {
      const seeded = LB.updateLandmarkMrv(null, 'Chest', 20);
      const spiked = LB.updateLandmarkMrv(seeded, 'Chest', 10); // one rough block
      assert.ok(spiked.landmarks.Chest.mrv > 10, 'EMA keeps the ceiling above the one-off low observation');
      assert.ok(spiked.landmarks.Chest.mrv < 20, 'but it moves down toward it, it does not ignore the signal');
      assert.strictEqual(spiked.landmarks.Chest.mrv, Math.round(0.35 * 10 + 0.65 * 20), 'EMA blend at alpha 0.35');
    });

    test('updateLandmarkMrv: invalid input is a same-ref no-op', () => {
      const seeded = LB.updateLandmarkMrv(null, 'Chest', 20);
      assert.strictEqual(LB.updateLandmarkMrv(seeded, 'Chest', 0), seeded, 'zero sets never lowers the ceiling');
      assert.strictEqual(LB.updateLandmarkMrv(seeded, null, 12), seeded, 'no muscle is a no-op');
    });

    test('numeric MRV cap decision: banked volume >= learned MRV freezes (else detector-only)', () => {
      // Mirror of the live atCeiling helper: freeze when cycleSets[m] >= landmarks[m].mrv.
      const atCeiling = (overreach, landmarks, cycleSets, muscle) => {
        if (overreach[muscle] && overreach[muscle].atCeiling) return true;
        const lm = landmarks[muscle];
        return !!(lm && lm.mrv != null && (cycleSets[muscle] || 0) >= lm.mrv);
      };
      const landmarks = LB.updateLandmarkMrv(null, 'Chest', 16).landmarks;
      assert.strictEqual(atCeiling({}, landmarks, { Chest: 16 }, 'Chest'), true, 'at MRV freezes');
      assert.strictEqual(atCeiling({}, landmarks, { Chest: 17 }, 'Chest'), true, 'over MRV freezes');
      assert.strictEqual(atCeiling({}, landmarks, { Chest: 15 }, 'Chest'), false, 'under MRV stays open');
      assert.strictEqual(atCeiling({}, {}, { Chest: 99 }, 'Chest'), false, 'no learned mrv → detector-only (open)');
      assert.strictEqual(atCeiling({ Chest: { atCeiling: true } }, {}, {}, 'Chest'), true, 'detector alone still freezes');
    });

    test('backoffDeltas: reduces grown lifts by ~2, never below base, leaves base/cut lifts', () => {
      const out = LB.backoffDeltas({ a: 3, b: 2, c: 1, d: 0, e: -1 }, 2);
      assert.strictEqual(out.a, 1, '+3 backs off to +1');
      assert.strictEqual(out.b, 0, '+2 backs off exactly to base (0), not below');
      assert.strictEqual(out.c, 0, '+1 floors at base (0), never negative');
      assert.strictEqual(out.d, 0, 'a lift already at base is untouched');
      assert.strictEqual(out.e, -1, 'a cut lift is left as-is (backoff never RAISES volume)');
    });

    test('snapshotBlockStart: records block start volume, preserves landmarks across the reset', () => {
      const withLm = LB.updateLandmarkMrv(null, 'Chest', 20);
      const out = LB.snapshotBlockStart(withLm, '2026-07-16', { Chest: 12 });
      assert.strictEqual(out.landmarks.Chest.mrv, 20, 'landmarks persist across the block snapshot');
      assert.strictEqual(out.block.startDate, '2026-07-16', 'records the new block start date');
      assert.strictEqual(out.block.startVolByMuscle.Chest, 12, 'records per-muscle start volume');
    });
  }

  // ── Autoreg v2 P1: overreach detector (stateless, last-2-exposures) ──────────
  {
    const muscleOf = (id) => (id === 'bench' ? 'Chest' : id === 'squat' ? 'Quads' : null);
    const sch = { id: 'p', is_flex: true, days: [{ id: 'd1' }, { id: 'd2' }] };
    const ans = (sore, jointAns) => ({
      soreness: sore ? { Chest: { muscle: 'Chest', answer: sore } } : {},
      joint: jointAns ? { bench: { exId: 'bench', answer: jointAns } } : {},
      volume: {},
    });
    const mk = (id, ended, opts = {}) => ({
      id, scheduleId: 'p', ended, date: ended.slice(0, 10),
      ...(opts.signalWeight ? { signalWeight: opts.signalWeight } : {}),
      entries: opts.entries || [{ exId: 'bench', sets: [{ done: true, kg: 100, reps: 8 }] }],
      ...(opts.answers ? { mesoRecap: { raw: { answers: opts.answers } } } : {}),
    });

    test('detectOverreach: still_sore + joint on both last exposures → atCeiling with evidence', () => {
      const sessions = [
        mk('E1', '2026-07-10T10:00:00Z', { answers: ans('still_sore', 'sharp') }),
        mk('E2', '2026-07-13T10:00:00Z', { answers: ans('still_sore', 'sharp') }),
      ];
      const out = LB.detectOverreach(sessions, sch, muscleOf);
      assert.ok(out.Chest && out.Chest.atCeiling === true, 'Chest flagged at ceiling');
      assert.ok(out.Chest.evidence[0].indexOf('Chest') === 0, 'evidence string leads with the muscle');
    });

    test('detectOverreach: a clean latest exposure stands the detector down', () => {
      const sessions = [
        mk('E1', '2026-07-10T10:00:00Z', { answers: ans('still_sore', 'sharp') }),
        mk('E2', '2026-07-13T10:00:00Z', { answers: ans('never', null) }),
      ];
      const out = LB.detectOverreach(sessions, sch, muscleOf);
      assert.ok(!(out.Chest && out.Chest.atCeiling), 'not at ceiling after a clean session');
    });

    test('detectOverreach: still_sore + FLAT e1RM across exposures → atCeiling (rep-regression path)', () => {
      const flat = { done: true, kg: 100, reps: 8 };
      const sessions = [
        mk('E0', '2026-07-07T10:00:00Z', { answers: ans('still_sore', null), entries: [{ exId: 'bench', sets: [flat] }] }),
        mk('E1', '2026-07-10T10:00:00Z', { answers: ans('still_sore', null), entries: [{ exId: 'bench', sets: [flat] }] }),
        mk('E2', '2026-07-13T10:00:00Z', { answers: ans('still_sore', null), entries: [{ exId: 'bench', sets: [flat] }] }),
      ];
      assert.ok(LB.detectOverreach(sessions, sch, muscleOf).Chest?.atCeiling, 'flat reps at same load, both sore → ceiling');
    });

    test('detectOverreach: reps improving on the latest exposure → not at ceiling', () => {
      const sessions = [
        mk('E1', '2026-07-10T10:00:00Z', { answers: ans('still_sore', null), entries: [{ exId: 'bench', sets: [{ done: true, kg: 100, reps: 8 }] }] }),
        mk('E2', '2026-07-13T10:00:00Z', { answers: ans('still_sore', null), entries: [{ exId: 'bench', sets: [{ done: true, kg: 100, reps: 10 }] }] }),
      ];
      assert.ok(!LB.detectOverreach(sessions, sch, muscleOf).Chest?.atCeiling, 'improving reps stand it down');
    });

    test('detectOverreach: frequency-adaptive: the 2 exposures may span rotations (1x/rotation muscle)', () => {
      const sessions = [
        mk('E1', '2026-07-08T10:00:00Z', { answers: ans('still_sore', 'sharp') }),
        // a Quads-only session sits between the two Chest exposures (Chest is 1x/rotation)
        mk('Q1', '2026-07-10T10:00:00Z', { entries: [{ exId: 'squat', sets: [{ done: true, kg: 100, reps: 8 }] }] }),
        mk('E2', '2026-07-12T10:00:00Z', { answers: ans('still_sore', 'sharp') }),
      ];
      assert.ok(LB.detectOverreach(sessions, sch, muscleOf).Chest?.atCeiling, 'the last 2 Chest exposures confirm regardless of the gap');
    });

    test('detectOverreach: a discounted (rough) latest session is not counted as an exposure', () => {
      const base = [
        mk('E0', '2026-07-07T10:00:00Z', { answers: ans('never', null) }),
        mk('E1', '2026-07-10T10:00:00Z', { answers: ans('still_sore', 'sharp') }),
      ];
      // Discounted E2: skipped, so exposures fall back to [E1, E0(clean)] → not both signal.
      const discounted = [...base, mk('E2', '2026-07-13T10:00:00Z', { signalWeight: 'discounted', answers: ans('still_sore', 'sharp') })];
      assert.ok(!LB.detectOverreach(discounted, sch, muscleOf).Chest?.atCeiling, 'rough day must not trip the ceiling');
      // Same session at full weight DOES count → [E2, E1] both signal.
      const full = [...base, mk('E2', '2026-07-13T10:00:00Z', { signalWeight: 'full', answers: ans('still_sore', 'sharp') })];
      assert.ok(LB.detectOverreach(full, sch, muscleOf).Chest?.atCeiling, 'a full session on the same data confirms');
    });

    test('detectOverreach: a single exposure cannot confirm a ceiling', () => {
      const sessions = [mk('E1', '2026-07-13T10:00:00Z', { answers: ans('still_sore', 'sharp') })];
      assert.ok(!LB.detectOverreach(sessions, sch, muscleOf).Chest?.atCeiling, 'one exposure is not enough to confirm');
    });

    test('detectOverreach: a weighted to bodyweight switch is not a fake regression', () => {
      // E0, E1 weighted flat (a legit regression pair, both sore); E2 logs the same
      // lift bodyweight (kg null). Without the metric-kind guard, E2s reps would be
      // compared against E1s e1RM and read as a regression, false-flagging a ceiling.
      // The guard makes the switch incomparable, so E2 has no regression and, with no
      // joint flag, does not trigger.
      const w = { done: true, kg: 100, reps: 8 };
      const bw = { done: true, reps: 12 };
      const sessions = [
        mk('E0', '2026-07-07T10:00:00Z', { answers: ans('still_sore', null), entries: [{ exId: 'bench', sets: [w] }] }),
        mk('E1', '2026-07-10T10:00:00Z', { answers: ans('still_sore', null), entries: [{ exId: 'bench', sets: [w] }] }),
        mk('E2', '2026-07-13T10:00:00Z', { answers: ans('still_sore', null), entries: [{ exId: 'bench', sets: [bw] }] }),
      ];
      assert.ok(!LB.detectOverreach(sessions, sch, muscleOf).Chest?.atCeiling, 'a metric switch must not fabricate a ceiling');
    });
  }

  // ── Autoreg v2 P4: strength-stall detector ───────────────────────────────────
  {
    const muscleOf = (id) => (id === 'bench' ? 'Chest' : id === 'squat' ? 'Quads' : null);
    const mk = (id, ended, sets, opts = {}) => ({
      id, scheduleId: 'p', ended, date: ended.slice(0, 10), isDeload: !!opts.isDeload,
      ...(opts.signalWeight ? { signalWeight: opts.signalWeight } : {}),
      entries: [{ exId: 'bench', sets }],
      ...(opts.joint ? { mesoRecap: { raw: { answers: { joint: { bench: opts.joint } } } } } : {}),
    });
    const flat = [{ done: true, kg: 100, reps: 8 }];

    test('detectStall: flat e1RM over 3 sessions at green gates → stalled with evidence', () => {
      const sessions = [
        mk('E0', '2026-07-07T10:00:00Z', flat),
        mk('E1', '2026-07-10T10:00:00Z', flat),
        mk('E2', '2026-07-13T10:00:00Z', flat),
      ];
      const out = LB.detectStall(sessions, 'bench', muscleOf, { planId: 'p', atCeiling: () => false, exName: 'Bench' });
      assert.strictEqual(out.stalled, true, 'flat e1RM at green gates is a stall');
      assert.ok(out.evidence[0].indexOf('Bench') === 0, 'evidence leads with the lift name');
    });

    test('detectStall: improving e1RM on the latest session → not stalled', () => {
      const sessions = [
        mk('E0', '2026-07-07T10:00:00Z', flat),
        mk('E1', '2026-07-10T10:00:00Z', flat),
        mk('E2', '2026-07-13T10:00:00Z', [{ done: true, kg: 105, reps: 8 }]),
      ];
      assert.strictEqual(LB.detectStall(sessions, 'bench', muscleOf, { planId: 'p', atCeiling: () => false }).stalled, false);
    });

    test('detectStall: muscle at its ceiling → not a stall (overreach owns it)', () => {
      const sessions = [mk('E0', '2026-07-07T10:00:00Z', flat), mk('E1', '2026-07-10T10:00:00Z', flat), mk('E2', '2026-07-13T10:00:00Z', flat)];
      assert.strictEqual(LB.detectStall(sessions, 'bench', muscleOf, { planId: 'p', atCeiling: () => true }).stalled, false, 'ceiling gate not green');
    });

    test('detectStall: a joint flag on the latest session → not a clean stall', () => {
      const sessions = [
        mk('E0', '2026-07-07T10:00:00Z', flat),
        mk('E1', '2026-07-10T10:00:00Z', flat),
        mk('E2', '2026-07-13T10:00:00Z', flat, { joint: { exId: 'bench', answer: 'sharp' } }),
      ];
      assert.strictEqual(LB.detectStall(sessions, 'bench', muscleOf, { planId: 'p', atCeiling: () => false }).stalled, false, 'joint flag is not a green gate');
    });

    test('detectStall: a discounted (rough) session is ignored, never fakes or breaks a stall', () => {
      // Three full flat sessions = a stall. A newest DISCOUNTED session with a big PR
      // would break it if counted, but signalWeight discipline drops it.
      const sessions = [
        mk('E0', '2026-07-07T10:00:00Z', flat),
        mk('E1', '2026-07-10T10:00:00Z', flat),
        mk('E2', '2026-07-13T10:00:00Z', flat),
        mk('E3', '2026-07-16T10:00:00Z', [{ done: true, kg: 130, reps: 10 }], { signalWeight: 'discounted' }),
      ];
      assert.strictEqual(LB.detectStall(sessions, 'bench', muscleOf, { planId: 'p', atCeiling: () => false }).stalled, true, 'the rough-day PR must not count');
    });

    test('detectStall: fewer than 3 weighted sessions → not enough data', () => {
      const sessions = [mk('E0', '2026-07-07T10:00:00Z', flat), mk('E1', '2026-07-10T10:00:00Z', flat)];
      assert.strictEqual(LB.detectStall(sessions, 'bench', muscleOf, { planId: 'p', atCeiling: () => false }).stalled, false);
    });

    test('detectStall: reps-only (no kg) exercise never stalls (no e1RM)', () => {
      const bw = [{ done: true, reps: 12 }];
      const sessions = [mk('E0', '2026-07-07T10:00:00Z', bw), mk('E1', '2026-07-10T10:00:00Z', bw), mk('E2', '2026-07-13T10:00:00Z', bw)];
      assert.strictEqual(LB.detectStall(sessions, 'bench', muscleOf, { planId: 'p', atCeiling: () => false }).stalled, false, 'e1RM is meaningless without weight');
    });
  }

  // ── Autoreg v2 P4: concrete swap suggestion ──────────────────────────────────
  {
    const muscleOf = (id) => ({ bench: 'Chest', db_press: 'Chest', machine_press: 'Chest', squat: 'Quads' }[id] || null);
    const exercises = [
      { id: 'bench', name: 'Barbell Bench', tags: ['Chest'], equipment: 'barbell_dual', movement_type: 'bilateral' },
      { id: 'db_press', name: 'Dumbbell Press', tags: ['Chest'], equipment: 'dumbbell', movement_type: 'bilateral' },
      { id: 'machine_press', name: 'Machine Press', tags: ['Chest'], equipment: 'machine', movement_type: 'bilateral' },
      { id: 'squat', name: 'Back Squat', tags: ['Quads'], equipment: 'barbell_dual', movement_type: 'bilateral' },
    ];

    test('suggestSwap: same muscle, different equipment, user-owned sibling', () => {
      const out = LB.suggestSwap('bench', exercises, [], muscleOf);
      assert.ok(out && out.id !== 'bench', 'returns a sibling');
      assert.strictEqual(out.isSystem, false, 'a user-owned copy is preferred');
      assert.notStrictEqual(out.id, 'squat', 'never a different-muscle exercise');
    });

    test('suggestSwap: skips an affinity-disliked candidate', () => {
      const out = LB.suggestSwap('bench', exercises, [], muscleOf, { affinity: { db_press: { v: 'dislike' }, machine_press: { v: 'dislike' } } });
      assert.strictEqual(out, null, 'both chest siblings disliked → no suggestion');
    });

    test('suggestSwap: skips a recently swapped-away id (excludeIds)', () => {
      const out = LB.suggestSwap('bench', exercises, [], muscleOf, { excludeIds: ['db_press', 'machine_press'] });
      assert.strictEqual(out, null, 'excluded siblings leave no candidate');
    });

    test('suggestSwap: no different-equipment sibling → null (never a same-equipment pick)', () => {
      const thin = [
        { id: 'bench', name: 'Barbell Bench', tags: ['Chest'], equipment: 'barbell_dual', movement_type: 'bilateral' },
        { id: 'incline_bb', name: 'Incline Barbell', tags: ['Chest'], equipment: 'barbell_dual', movement_type: 'bilateral' },
      ];
      assert.strictEqual(LB.suggestSwap('bench', thin, [], muscleOf), null, 'same equipment + same movement is not a real variation');
    });

    test('suggestSwap: falls back to a system sibling, bucketed by tag priority', () => {
      const onlyBench = [{ id: 'bench', name: 'Barbell Bench', tags: ['Chest'], equipment: 'barbell_dual', movement_type: 'bilateral' }];
      const sys = [
        { id: 'sys_pec_deck', name: 'Pec Deck', tags: ['Chest'], equipment: 'machine', category: 'small' },
        { id: 'sys_squat', name: 'Back Squat', tags: ['Quads'], equipment: 'barbell_dual' },
      ];
      const out = LB.suggestSwap('bench', onlyBench, sys, (id) => (id === 'bench' ? 'Chest' : null));
      assert.ok(out && out.isSystem === true && out.id === 'sys_pec_deck', 'a system chest sibling with different equipment');
    });

    test('suggestSwap: a system sibling already owned by name is skipped', () => {
      const owned = [
        { id: 'bench', name: 'Barbell Bench', tags: ['Chest'], equipment: 'barbell_dual', movement_type: 'bilateral' },
        { id: 'mine', name: 'Pec Deck', tags: ['Chest'], equipment: 'machine', movement_type: 'bilateral' },
      ];
      const sys = [{ id: 'sys_pec_deck', name: 'Pec Deck', tags: ['Chest'], equipment: 'machine' }];
      const ownedMuscleOf = (id) => (id === 'bench' || id === 'mine' ? 'Chest' : null);
      const out = LB.suggestSwap('bench', owned, sys, ownedMuscleOf, {});
      // The user already owns "Pec Deck", so the user-owned copy is returned, not the sys id.
      assert.ok(out && out.id === 'mine' && out.isSystem === false, 'prefer the owned copy over the catalog duplicate');
    });
  }

  // ── Autoreg v2 P4: post-break re-entry ramp ──────────────────────────────────
  {
    const flexSch = { id: 'p', is_flex: true, days: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }] };
    const trained = (id, date) => ({ id, scheduleId: 'p', ended: date + 'T10:00:00Z', date, isDeload: false });

    test('reentryRamp: fires after a > 7-day sick/vacation break', () => {
      const sp = [{ mode: 'vacation', startedAt: '2026-07-01', endedAt: '2026-07-12' }]; // 11 days
      const out = LB.reentryRamp(sp, [], flexSch, { todayStr: '2026-07-14' });
      assert.strictEqual(out.active, true, 'an 11-day break arms the ramp');
      assert.strictEqual(out.breakDays, 11);
    });

    test('reentryRamp: inert for a short break (≤ 7 days)', () => {
      const sp = [{ mode: 'sick', startedAt: '2026-07-05', endedAt: '2026-07-10' }]; // 5 days
      assert.strictEqual(LB.reentryRamp(sp, [], flexSch, { todayStr: '2026-07-12' }).active, false);
    });

    test('reentryRamp: decays over ONE rotation, then goes inert', () => {
      const sp = [{ mode: 'vacation', startedAt: '2026-07-01', endedAt: '2026-07-12' }];
      const twoBack = [trained('a', '2026-07-13'), trained('b', '2026-07-15')];
      assert.strictEqual(LB.reentryRamp(sp, twoBack, flexSch, { todayStr: '2026-07-16' }).active, true, 'still inside the first rotation (2 of 3)');
      const rotationDone = [...twoBack, trained('c', '2026-07-17')];
      assert.strictEqual(LB.reentryRamp(sp, rotationDone, flexSch, { todayStr: '2026-07-18' }).active, false, 'a full rotation back → normal');
    });

    test('reentryRamp: an active (open) break does not fire (not back yet)', () => {
      const sp = [{ mode: 'sick', startedAt: '2026-07-01', endedAt: null }];
      assert.strictEqual(LB.reentryRamp(sp, [], flexSch, { todayStr: '2026-07-20' }).active, false);
    });

    test('reentryRamp: a long break stretches over two microcycles', () => {
      const sp = [{ mode: 'sick', startedAt: '2026-06-01', endedAt: '2026-07-10' }]; // ~39 days
      const out = LB.reentryRamp(sp, [trained('a', '2026-07-11'), trained('b', '2026-07-13'), trained('c', '2026-07-15')], flexSch, { todayStr: '2026-07-16' });
      assert.strictEqual(out.microcycles, 2, 'weeks-long break → longer ramp');
      assert.strictEqual(out.active, true, '3 of 6 sessions back is still inside the stretched ramp');
    });
  }

  // ── Autoreg v2 P2: block start window ────────────────────────────────────────
  {
    const ms = { scheduleId: 'p', startedAt: '2026-07-01T08:00:00Z', startDate: '2026-07-01' };
    const sess = (id, ended, opts = {}) => ({ id, scheduleId: opts.scheduleId ?? 'p', ended, date: (ended || '').slice(0, 10), isDeload: !!opts.isDeload });

    test('blockStartTs: uses startedAt when no deload has happened', () => {
      assert.strictEqual(LB.blockStartTs(ms, []), Date.parse('2026-07-01T08:00:00Z'));
    });
    test('blockStartTs: falls back to startDate for older mesos without startedAt', () => {
      assert.strictEqual(LB.blockStartTs({ scheduleId: 'p', startDate: '2026-07-01' }, []), Date.parse('2026-07-01'));
    });
    test('blockStartTs: a later completed deload end wins over the block anchor', () => {
      const sp = [{ mode: 'deload', startedAt: '2026-07-10T00:00:00Z', endedAt: '2026-07-17T00:00:00Z' }];
      assert.strictEqual(LB.blockStartTs(ms, sp), Date.parse('2026-07-17T00:00:00Z'));
    });
    test('blockStartTs: an active (open) deload is ignored, sick/vacation never count', () => {
      const sp = [{ mode: 'deload', startedAt: '2026-07-10T00:00:00Z', endedAt: null },
                  { mode: 'vacation', startedAt: '2026-07-20T00:00:00Z', endedAt: '2026-07-25T00:00:00Z' }];
      assert.strictEqual(LB.blockStartTs(ms, sp), Date.parse('2026-07-01T08:00:00Z'));
    });
    test('blockSessions: keeps this plan, ended, non-deload sessions after block start', () => {
      const sessions = [
        sess('before', '2026-06-30T10:00:00Z'),
        sess('in', '2026-07-05T10:00:00Z'),
        sess('deload', '2026-07-06T10:00:00Z', { isDeload: true }),
        sess('other', '2026-07-07T10:00:00Z', { scheduleId: 'q' }),
        { id: 'open', scheduleId: 'p', ended: null },
      ];
      const out = LB.blockSessions(sessions, ms, []).map(s => s.id);
      assert.deepStrictEqual(out, ['in']);
    });
  }

  // ── Autoreg v2 P2: block recap aggregation ───────────────────────────────────
  {
    const S = (id, gains, opts = {}) => ({ id, ended: (opts.date || '2026-07-05') + 'T10:00:00Z', date: opts.date || '2026-07-05', signalWeight: opts.signalWeight, mesoRecap: { gains } });

    test('buildBlockRecap: folds set + weight deltas across the block', () => {
      const r = LB.buildBlockRecap([
        S('a', [{ name: 'Bench', weightDelta: 2.5, setDelta: 1 }], { date: '2026-07-02' }),
        S('b', [{ name: 'Bench', weightDelta: 2.5, setDelta: 0 }, { name: 'Squat', weightDelta: 5, setDelta: 2 }], { date: '2026-07-04' }),
      ]);
      assert.strictEqual(r.sessionCount, 2);
      assert.strictEqual(r.prCount, 3, 'three positive weight deltas across the block');
      assert.strictEqual(r.setGains.find(x => x.name === 'Bench').setDelta, 1);
      assert.strictEqual(r.setGains.find(x => x.name === 'Squat').setDelta, 2);
      assert.strictEqual(r.loadPRs.find(x => x.name === 'Bench').weightDelta, 5, 'Bench kg folds 2.5+2.5');
    });
    test('buildBlockRecap: best session is the one with the most PRs', () => {
      const r = LB.buildBlockRecap([
        S('a', [{ name: 'Bench', weightDelta: 2.5 }], { date: '2026-07-02' }),
        S('b', [{ name: 'Bench', weightDelta: 2.5 }, { name: 'Row', weightDelta: 2.5 }], { date: '2026-07-04' }),
      ]);
      assert.strictEqual(r.bestSession.date, '2026-07-04');
      assert.strictEqual(r.bestSession.prs, 2);
    });
    test('buildBlockRecap: a deload (signalWeight none) session is excluded, a rough (discounted) PR still counts', () => {
      const r = LB.buildBlockRecap([
        S('none', [{ name: 'Bench', weightDelta: 2.5 }], { signalWeight: 'none' }),
        S('rough', [{ name: 'Squat', weightDelta: 2.5 }], { signalWeight: 'discounted' }),
      ]);
      assert.strictEqual(r.sessionCount, 1, 'the none session is dropped');
      assert.strictEqual(r.prCount, 1, 'the discounted PR is real and counts');
      assert.strictEqual(r.loadPRs[0].name, 'Squat');
    });
    test('buildBlockRecap: a negative weight delta (rep-miss cut) is not a PR', () => {
      const r = LB.buildBlockRecap([S('a', [{ name: 'Bench', weightDelta: -2.5, setDelta: 0 }])]);
      assert.strictEqual(r.prCount, 0);
      assert.strictEqual(r.loadPRs.length, 0, 'a cut is never a load PR');
      assert.strictEqual(r.bestSession, null);
    });
  }

  // ── Autoreg v2 P2: anti-nag deload governance ────────────────────────────────
  {
    test('deloadNudgeDecision: first at-ceiling finish, nothing recorded yet -> full offer', () => {
      const d = LB.deloadNudgeDecision(null, 0, true);
      assert.strictEqual(d.mode, 'full');
      assert.strictEqual(d.escalation, 0);
    });
    test('deloadNudgeDecision: not at ceiling -> none (auto stand-down)', () => {
      assert.strictEqual(LB.deloadNudgeDecision({ deloadNudge: { block: { declinedAt: 'x', cooldownUntil: 5, escalation: 1 } } }, 2, false).mode, 'none');
    });
    test('deloadNudgeDecision: inside the cooldown -> hint only, carries escalation', () => {
      const st = { deloadNudge: { block: { declinedAt: 'x', cooldownUntil: 5, escalation: 1 } } };
      const d = LB.deloadNudgeDecision(st, 3, true);
      assert.strictEqual(d.mode, 'hint');
      assert.strictEqual(d.escalation, 1);
    });
    test('deloadNudgeDecision: cooldown elapsed, still at ceiling -> full re-ask with escalation', () => {
      const st = { deloadNudge: { block: { declinedAt: 'x', cooldownUntil: 5, escalation: 1 } } };
      const d = LB.deloadNudgeDecision(st, 5, true);
      assert.strictEqual(d.mode, 'full');
      assert.strictEqual(d.escalation, 1);
    });
    test('recordDeloadDecline: first decline arms a 3-session cooldown at escalation 1', () => {
      const st = LB.recordDeloadDecline(null, 4);
      assert.strictEqual(st.deloadNudge.block.cooldownUntil, 7);
      assert.strictEqual(st.deloadNudge.block.escalation, 1);
      assert.strictEqual(st.version, 2, 'stamps the current P3 blob version');
      assert.ok(st.deloadNudge.block.declinedAt, 'stamps declinedAt');
    });
    test('recordDeloadDecline: a second decline bumps escalation and re-arms the cooldown', () => {
      const first = LB.recordDeloadDecline(null, 4);   // cooldownUntil 7, esc 1
      const second = LB.recordDeloadDecline(first, 8);  // past cooldown, re-ask declined
      assert.strictEqual(second.deloadNudge.block.escalation, 2);
      assert.strictEqual(second.deloadNudge.block.cooldownUntil, 11);
    });
    test('recordDeloadDecline: is immutable (does not mutate the input state)', () => {
      const st = { version: 1, deloadNudge: { block: { declinedAt: 'a', cooldownUntil: 7, escalation: 0 } } };
      const next = LB.recordDeloadDecline(st, 10);
      assert.strictEqual(st.deloadNudge.block.escalation, 0, 'input untouched');
      assert.strictEqual(next.deloadNudge.block.escalation, 1);
    });
    test('clearDeloadNudge: drops the block nudge and preserves other keys', () => {
      const st = { version: 1, landmarks: { Chest: {} }, deloadNudge: { block: { declinedAt: 'a', cooldownUntil: 7, escalation: 0 } } };
      const cleared = LB.clearDeloadNudge(st);
      assert.ok(!cleared.deloadNudge, 'block was the only nudge, so deloadNudge is gone');
      assert.deepStrictEqual(cleared.landmarks, { Chest: {} }, 'unrelated keys survive');
    });
    test('clearDeloadNudge: returns the SAME reference when there is nothing to clear', () => {
      const st = { version: 1 };
      assert.strictEqual(LB.clearDeloadNudge(st), st);
      assert.strictEqual(LB.clearDeloadNudge(null), null);
    });
  }

  // ── Autoreg v2 P1: MRV cap mirror in applyMesoFeedbackEdit ───────────────────
  test('applyMesoFeedbackEdit: an at-ceiling muscle freezes a volume not_enough +1 (non-destructive)', () => {
    const ms = { deltas: {}, growthCounts: {}, pumpLowCounts: {}, jointFlags: {} };
    const raw = { answers: { soreness: {}, joint: {}, volume: { Chest: { muscle: 'Chest', exIds: ['e1'], contrib: {} } } }, negOwner: {}, frozen: false, dayId: 'd1' };
    const capped = LB.applyMesoFeedbackEdit(ms, raw, { type: 'volume', subject: 'Chest', volume: 'not_enough' }, { dayId: 'd1', loadOnly: false, atCeilingMuscles: new Set(['Chest']) });
    assert.ok(!capped.mesoState.deltas.e1_d1, 'no +1 added while at ceiling');
    const free = LB.applyMesoFeedbackEdit(ms, raw, { type: 'volume', subject: 'Chest', volume: 'not_enough' }, { dayId: 'd1', loadOnly: false });
    assert.strictEqual(free.mesoState.deltas.e1_d1, 1, 'the same edit adds +1 when not at ceiling');
  });

  test('applyMesoFeedbackEdit: an at-ceiling muscle freezes a soreness +1 grant', () => {
    const ms = { deltas: {}, growthCounts: {}, pumpLowCounts: {}, jointFlags: {} };
    const raw = { answers: { soreness: { Chest: { muscle: 'Chest', targets: [{ exId: 'e1', name: 'Bench', key: 'e1_d0' }], contrib: {} } }, joint: {}, volume: {} }, negOwner: {}, frozen: false, dayId: 'd0' };
    const capped = LB.applyMesoFeedbackEdit(ms, raw, { type: 'soreness', subject: 'Chest', answer: 'never' }, { dayId: 'd0', loadOnly: false, atCeilingMuscles: new Set(['Chest']) });
    assert.ok(!capped.mesoState.deltas.e1_d0, 'no soreness +1 while at ceiling');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
