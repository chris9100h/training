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

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
