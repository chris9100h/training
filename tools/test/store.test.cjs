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

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
