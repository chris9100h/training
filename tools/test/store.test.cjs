#!/usr/bin/env node
/* Focused unit tests for the pure / near-pure logic in src/store.js.
   No build step, no test framework: load store.js in a vm with a minimal
   window/supabase stub and assert against window.LB. Run: node this file. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

let testFrom; // swapped per test to control what supabase calls "return"
let testFetch = async () => ({ ok: true }); // swapped per test to control what fnFetch's raw fetch() "returns"
let testSession = null; // swapped per test to give fnFetch a bearer token to send
const rpcLog = []; // records every rpc(name, args) call
// The sandbox's own `window`, exposed so a test can set the globals store.js
// reads (window.__DELOAD / window.__CLEANUP). The test file's own `global.window`
// is a different object entirely, setting that one has no effect in here.
let storeWindow = null;

function loadStore() {
  const code = fs.readFileSync(path.join(__dirname, '../../src/store.js'), 'utf8');
  const fakeClient = {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: testSession } }),
    },
    from: (...args) => testFrom(...args),
    rpc: async (name, args) => { rpcLog.push({ name, args }); return { data: null, error: null }; },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  };
  const sandbox = {
    window: { supabase: { createClient: () => fakeClient }, addEventListener() {} },
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    console, fetch: (...args) => testFetch(...args), setTimeout, clearTimeout, Math, Date, JSON,
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
  storeWindow = sandbox.window;
  storeWindow.__testLocalStorage = sandbox.localStorage;
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

  test('saveSyncedState stores one atomic pair entry and loadLocalState reuses it as the base', () => {
    const state = { user: { name: 'A' }, sessions: [] };
    assert.strictEqual(LB.saveSyncedState(state, 'cache-user'), true);
    assert.ok(storeWindow.__testLocalStorage.getItem('logbook-pair-cache-user'));
    assert.strictEqual(storeWindow.__testLocalStorage.getItem('logbook-cache-user'), null);
    assert.strictEqual(storeWindow.__testLocalStorage.getItem('logbook-base-cache-user'), null);
    const loaded = LB.loadLocalState('cache-user');
    assert.strictEqual(JSON.stringify(loaded.store), JSON.stringify(state));
    assert.strictEqual(loaded.base, loaded.store);
  });

  test('saveLocalState folds a distinct base into the same atomic entry only while local edits are pending', () => {
    const base = { settings: { unit: 'kg' }, sessions: [] };
    const edited = { settings: { unit: 'lbs' }, sessions: [] };
    assert.strictEqual(LB.saveLocalState(edited, base, 'pending-user'), true);
    const rawPending = JSON.parse(storeWindow.__testLocalStorage.getItem('logbook-pair-pending-user'));
    assert.ok(rawPending.base, 'a pending edit must persist its own base inside the pair entry');
    const pending = LB.loadLocalState('pending-user');
    assert.strictEqual(pending.store.settings.unit, 'lbs');
    assert.strictEqual(pending.base.settings.unit, 'kg');
    assert.strictEqual(LB.saveSyncedState(edited, 'pending-user'), true);
    const rawSynced = JSON.parse(storeWindow.__testLocalStorage.getItem('logbook-pair-pending-user'));
    assert.strictEqual(rawSynced.base, null, 'base is omitted from the pair entry once local state is confirmed synced');
  });

  test('loadLocalState falls back to the pre-migration two-key format, then saveLocalState migrates it', () => {
    const legacyBase = { settings: { unit: 'kg' } };
    const legacyStore = { settings: { unit: 'lbs' } };
    storeWindow.__testLocalStorage.setItem('logbook-legacy-user', JSON.stringify(legacyStore));
    storeWindow.__testLocalStorage.setItem('logbook-base-legacy-user', JSON.stringify(legacyBase));
    const loaded = LB.loadLocalState('legacy-user');
    assert.strictEqual(loaded.store.settings.unit, 'lbs');
    assert.strictEqual(loaded.base.settings.unit, 'kg');
    assert.strictEqual(LB.saveLocalState(loaded.store, loaded.base, 'legacy-user'), true);
    assert.ok(storeWindow.__testLocalStorage.getItem('logbook-pair-legacy-user'), 'the atomic entry must exist after migrating');
    assert.strictEqual(storeWindow.__testLocalStorage.getItem('logbook-legacy-user'), null, 'the old store key must be cleaned up');
    assert.strictEqual(storeWindow.__testLocalStorage.getItem('logbook-base-legacy-user'), null, 'the old base key must be cleaned up');
  });

  test('saveToLocal (emergency flush) writes through the same atomic entry and keeps the last known base', () => {
    const base = { settings: { unit: 'kg' }, sessions: [] };
    const edited = { settings: { unit: 'lbs' }, sessions: [] };
    assert.strictEqual(LB.saveLocalState(edited, base, 'flush-user'), true);
    const flushed = { settings: { unit: 'lbs' }, sessions: [{ id: 'mid-typing' }] };
    assert.strictEqual(LB.saveToLocal(flushed, 'flush-user'), true);
    const loaded = LB.loadLocalState('flush-user');
    assert.strictEqual(JSON.stringify(loaded.store), JSON.stringify(flushed), 'the emergency flush value must be readable back');
    assert.strictEqual(loaded.base.settings.unit, 'kg', 'the emergency flush must not silently mark the edit as already synced');
  });

  await testAsync('refreshHealthLogs does not issue medication reads while the feature is disabled', async () => {
    const queried = [];
    testFrom = (table) => {
      queried.push(table);
      const result = { data: [], error: null };
      const query = {
        select() { return query; }, eq() { return query; }, gte() { return query; }, order() { return query; },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
      };
      return query;
    };
    const disabled = await LB.refreshHealthLogs('u1', { medsEnabled: false });
    assert.strictEqual(disabled.medicationsLoaded, false);
    assert.strictEqual(queried.some(table => table.startsWith('zane_medication')), false);

    queried.length = 0;
    const enabled = await LB.refreshHealthLogs('u1', { medsEnabled: true });
    assert.strictEqual(enabled.medicationsLoaded, true);
    assert.strictEqual(queried.filter(table => table.startsWith('zane_medication')).length, 6);
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
    assert.ok(threw, 'expected syncStore to reject on a failed write, this is what makes flushSync retry');
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

  // ── plus_load seeding and the deload/cleanup reduction ──────────────────
  test('bestEntryFromSetLists keeps the fields that say HOW a load was made up', () => {
    // This field list has silently dropped a field twice now, addedKg and then
    // hornLoads, each time with kg staying correct so nothing looked broken.
    const sets = [[{ kg: 100, reps: 8, addedKg: 20, done: true }]];
    const e = LB.bestEntryFromSetLists(sets);
    assert.strictEqual(e.entry.sets[0].addedKg, 20);
    const horned = [[{ kg: 90, reps: 8, hornLoads: [{ label: 'Std', kg: 40 }, { label: 'Mid', kg: 50 }], done: true }]];
    assert.deepStrictEqual(LB.bestEntryFromSetLists(horned).entry.sets[0].hornLoads,
      [{ label: 'Std', kg: 40 }, { label: 'Mid', kg: 50 }]);
    // And they have to come off the WINNING set, not the most recent one. Same
    // total, different distribution: the older session did more reps, so it
    // wins, and its horn split is the one that describes those reps.
    const twoSessions = [
      [{ kg: 90, reps: 6, hornLoads: [{ label: 'Std', kg: 45 }, { label: 'Mid', kg: 45 }], done: true }],
      [{ kg: 90, reps: 9, hornLoads: [{ label: 'Std', kg: 20 }, { label: 'Mid', kg: 70 }], done: true }],
    ];
    const won = LB.bestEntryFromSetLists(twoSessions).entry.sets[0];
    assert.strictEqual(won.reps, 9);
    assert.deepStrictEqual(won.hornLoads, [{ label: 'Std', kg: 20 }, { label: 'Mid', kg: 70 }]);
  });

  test('a deload reduces what the lifter actually moves, and floors the belt at zero', () => {
    const store = {
      exercises: [{ id: 'x', equipment: 'bodyweight', bodyweight_mode: 'plus_load', log_mode: 'weight' }],
      dailyLogs: [{ date: '2026-06-10', weight: 80 }],
      settings: {},
      sessions: [],
    };
    const last = { entry: { sets: [{ kg: 120, reps: 8, addedKg: 40, done: true }] } };
    const it = { exId: 'x', sets: 1, repsPerSet: null };
    // 120 total at 50 percent is 60, which is under the 80 kg body, so the belt
    // floors at 0 and the set becomes a bare pull-up. Never negative.
    const deloaded = LB.buildSeedSets(it, last, null, false, store, null, true, null);
    assert.strictEqual(deloaded[0].addedKg, 0);
    assert.strictEqual(deloaded[0].kg, 80);
    // Without a deload the belt is repeated as logged.
    const plain = LB.buildSeedSets(it, last, null, false, store, null, false, null);
    assert.strictEqual(plain[0].addedKg, 40);
    assert.strictEqual(plain[0].kg, 120);
  });

  test('chainRoundKg shows a chain round in the same space as its set', () => {
    // 80 kg body, 20 kg belt: the set stores kg 100 / addedKg 20 and renders
    // "+20", so a drop round stored as 90 must render as 10, not 90.
    const st = { kg: 100, addedKg: 20 };
    assert.strictEqual(LB.chainRoundKg(st, 90), 10);
    assert.strictEqual(LB.chainRoundKg(st, null), null);
    // An ordinary set is untouched, and so is a legacy set with no belt figure.
    assert.strictEqual(LB.chainRoundKg({ kg: 100 }, 90), 90);
    assert.strictEqual(LB.chainRoundKg({ kg: null, addedKg: 20 }, 90), 90);
  });

  // ── Multi-horn loading (PRIME-style plate-loaded machines) ───────────────
  test('hornLoadTotal sums the loaded horns and stays null when nothing is on', () => {
    assert.strictEqual(LB.hornLoadTotal([{ label: 'A', kg: 20 }, { label: 'B', kg: 10.5 }]), 30.5);
    // An untouched set must read empty, not as a real 0 kg lift.
    assert.strictEqual(LB.hornLoadTotal([{ label: 'A', kg: null }, { label: 'B', kg: null }]), null);
    assert.strictEqual(LB.hornLoadTotal([]), null);
    assert.strictEqual(LB.hornLoadTotal(null), null);
  });
  test('hornLoadLabel renders the split, setLoadLabel still renders the sum', () => {
    const st = { kg: 40, hornLoads: [{ label: 'Std', kg: 20 }, { label: 'Mid', kg: 20 }] };
    assert.strictEqual(LB.hornLoadLabel(st), '20 / 20');
    assert.strictEqual(LB.setLoadLabel(st), '40');
    assert.strictEqual(LB.hornLoadLabel({ kg: 40 }), null);
  });
  test('setLoadLabel plus_load behaviour is untouched by the horn helpers', () => {
    assert.strictEqual(LB.setLoadLabel({ kg: 90, addedKg: 10 }), '+10');
    assert.strictEqual(LB.setLoadLabel({ kg: 90 }), '90');
    assert.strictEqual(LB.setLoadLabel({}), null);
  });
  test('sameHornLoad separates splits that happen to sum alike', () => {
    const a = { hornLoads: [{ label: 'Std', kg: 20 }, { label: 'Mid', kg: 20 }] };
    const b = { hornLoads: [{ label: 'Std', kg: 40 }, { label: 'Mid', kg: 0 }] };
    // Both total 40, but the resistance curve is not the same work.
    assert.strictEqual(LB.sameHornLoad(a, b), false);
    assert.strictEqual(LB.sameHornLoad(a, { hornLoads: [{ label: 'Std', kg: 20 }, { label: 'Mid', kg: 20 }] }), true);
  });
  test('sameHornLoad compares the shape, so loading the same setup heavier still counts', () => {
    // The whole point: 20/20 to 30/30 is the same machine setup with more weight
    // on it. Comparing raw kilos would call that "not comparable" and suppress
    // progression on multi-horn machines entirely.
    const light = { hornLoads: [{ label: 'Std', kg: 20 }, { label: 'Mid', kg: 20 }] };
    const heavy = { hornLoads: [{ label: 'Std', kg: 30 }, { label: 'Mid', kg: 30 }] };
    assert.strictEqual(LB.sameHornLoad(light, heavy), true);
    // An uneven bias kept in proportion is also the same setup.
    assert.strictEqual(LB.sameHornLoad(
      { hornLoads: [{ label: 'Std', kg: 20 }, { label: 'Mid', kg: 10 }] },
      { hornLoads: [{ label: 'Std', kg: 40 }, { label: 'Mid', kg: 20 }] }), true);
    // Shifting the bias is not.
    assert.strictEqual(LB.sameHornLoad(
      { hornLoads: [{ label: 'Std', kg: 20 }, { label: 'Mid', kg: 10 }] },
      { hornLoads: [{ label: 'Std', kg: 10 }, { label: 'Mid', kg: 20 }] }), false);
  });
  test('sameHornLoad compares by label, not position', () => {
    const a = { hornLoads: [{ label: 'Std', kg: 20 }, { label: 'High', kg: 10 }] };
    const b = { hornLoads: [{ label: 'High', kg: 10 }, { label: 'Std', kg: 20 }] };
    assert.strictEqual(LB.sameHornLoad(a, b), true);
  });
  test('sameHornLoad treats two plain sets as equal and a switch of style as not', () => {
    assert.strictEqual(LB.sameHornLoad({ kg: 40 }, { kg: 60 }), true);
    assert.strictEqual(LB.sameHornLoad({ kg: 40, hornLoads: [{ label: 'A', kg: 40 }] }, { kg: 40 }), false);
  });
  test('isImprovement and isDecline stay silent across different horn splits', () => {
    const heavier = { kg: 60, reps: 10, done: true, hornLoads: [{ label: 'Std', kg: 60 }, { label: 'Mid', kg: 0 }] };
    const lighter = { kg: 40, reps: 10, done: true, hornLoads: [{ label: 'Std', kg: 20 }, { label: 'Mid', kg: 20 }] };
    // More total weight, but on a different distribution: not comparable.
    assert.strictEqual(LB.isImprovement(heavier, lighter), false);
    assert.strictEqual(LB.isDecline(lighter, heavier), false);
    // Same split, more weight: the normal verdict still fires.
    const sameSplitUp = { kg: 60, reps: 10, done: true, hornLoads: [{ label: 'Std', kg: 30 }, { label: 'Mid', kg: 30 }] };
    const sameSplitLo = { kg: 40, reps: 10, done: true, hornLoads: [{ label: 'Std', kg: 20 }, { label: 'Mid', kg: 20 }] };
    assert.strictEqual(LB.isImprovement(sameSplitUp, sameSplitLo), true);
    assert.strictEqual(LB.isDecline(sameSplitLo, sameSplitUp), true);
  });
  test('the horn gate is transparent for ordinary sets', () => {
    assert.strictEqual(LB.isImprovement({ kg: 100, reps: 5, done: true }, { kg: 95, reps: 5, done: true }), true);
    assert.strictEqual(LB.isDecline({ kg: 90, reps: 5, done: true }, { kg: 100, reps: 5, done: true }), true);
  });
  test('isMultiHorn reads the exercise horn list', () => {
    assert.strictEqual(LB.isMultiHorn({ horn_labels: ['Std', 'Mid'] }), true);
    assert.strictEqual(LB.isMultiHorn({ horn_labels: [] }), false);
    assert.strictEqual(LB.isMultiHorn({}), false);
    assert.deepStrictEqual(LB.exerciseHornLabels({ horn_labels: ['Std'] }), ['Std']);
  });

  // ── mergeBootScalars: top-level scalar resolution at boot ────────────────
  // The boot merge is where this project's most expensive mistakes have been
  // made, and app.jsx has no test harness, so the decision itself lives in
  // store.js purely so these can exist.
  const bs = {
    activeScheduleId: 'srv', cycleIndex: 3, cycleStartDate: '2026-06-01',
    weekPlanStartDate: '2026-06-01', lastAdvancedDate: '2026-06-05',
    activeMealTemplateId: null, statusMode: null, statusModeSince: null,
    activeCardioPlanId: null, deloadPromptDismissedAt: null, customDayTypes: [],
  };
  test('mergeBootScalars keeps an unsynced local plan switch', () => {
    const cur = { ...bs, activeScheduleId: 'local', cycleIndex: 0 };
    const out = LB.mergeBootScalars(bs, cur, { ...bs }, []);
    assert.strictEqual(out.activeScheduleId, 'local');
    assert.strictEqual(out.cycleIndex, 0);
  });
  test('mergeBootScalars takes the server value this device never touched', () => {
    const fresh = { ...bs, activeScheduleId: 'srv2', cycleIndex: 9 };
    const out = LB.mergeBootScalars(fresh, { ...bs }, { ...bs }, []);
    assert.strictEqual(out.activeScheduleId, 'srv2');
    assert.strictEqual(out.cycleIndex, 9);
  });
  test('mergeBootScalars never splits the plan tuple (weekPlanStartDate rides with the plan id)', () => {
    const cur = { ...bs, activeScheduleId: 'local', weekPlanStartDate: '2026-06-08' };
    const fresh = { ...bs, weekPlanStartDate: '2026-05-01' };
    const out = LB.mergeBootScalars(fresh, cur, { ...bs }, []);
    assert.strictEqual(out.activeScheduleId, 'local');
    assert.strictEqual(out.weekPlanStartDate, '2026-06-08');
  });
  test('mergeBootScalars keeps an offline weekPlanStartDate edit on its own', () => {
    const cur = { ...bs, weekPlanStartDate: '2026-06-15' };
    const out = LB.mergeBootScalars({ ...bs }, cur, { ...bs }, []);
    assert.strictEqual(out.weekPlanStartDate, '2026-06-15');
  });
  test('mergeBootScalars resolves statusMode and statusModeSince as one pair', () => {
    // The period is open and agrees with the local mode, so the status rules
    // below stay out of it and the group resolution is what is under test: the
    // local statusModeSince has to ride along with the local statusMode rather
    // than being taken from either the server row or the period.
    const cur = { ...bs, statusMode: 'sick', statusModeSince: '2026-06-09T08:00:00Z' };
    const fresh = { ...bs, statusModeSince: '2026-01-01T00:00:00Z' };
    const periods = [{ id: 'p1', mode: 'sick', startedAt: '2026-01-01T00:00:00Z', endedAt: null }];
    const out = LB.mergeBootScalars(fresh, cur, { ...bs }, periods);
    assert.strictEqual(out.statusMode, 'sick');
    assert.strictEqual(out.statusModeSince, '2026-06-09T08:00:00Z');
  });
  test('mergeBootScalars keeps offline activeCardioPlanId and deloadPromptDismissedAt', () => {
    const cur = { ...bs, activeCardioPlanId: 'cp1', deloadPromptDismissedAt: '2026-06-09' };
    const fresh = { ...bs, activeCardioPlanId: 'other', deloadPromptDismissedAt: null };
    const out = LB.mergeBootScalars(fresh, cur, { ...bs }, []);
    assert.strictEqual(out.activeCardioPlanId, 'cp1');
    assert.strictEqual(out.deloadPromptDismissedAt, '2026-06-09');
  });
  test('mergeBootScalars compares customDayTypes by value, not identity', () => {
    const untouched = LB.mergeBootScalars({ ...bs, customDayTypes: ['Rehab'] }, { ...bs, customDayTypes: [] }, { ...bs, customDayTypes: [] }, []);
    assert.deepStrictEqual(untouched.customDayTypes, ['Rehab']);
    const edited = LB.mergeBootScalars({ ...bs, customDayTypes: ['Rehab'] }, { ...bs, customDayTypes: ['Mobility'] }, { ...bs, customDayTypes: [] }, []);
    assert.deepStrictEqual(edited.customDayTypes, ['Mobility']);
  });
  test('mergeBootScalars keeps the local side when there is no base (legacy cache)', () => {
    const cur = { ...bs, activeScheduleId: 'local', activeMealTemplateId: 'mt1' };
    const out = LB.mergeBootScalars({ ...bs }, cur, null, []);
    assert.strictEqual(out.activeScheduleId, 'local');
    assert.strictEqual(out.activeMealTemplateId, 'mt1');
  });
  test('mergeBootScalars never writes undefined for a field the cache predates', () => {
    const cur = { ...bs, activeScheduleId: 'local' };
    delete cur.weekPlanStartDate;   // cache written before the column existed
    delete cur.customDayTypes;
    const out = LB.mergeBootScalars({ ...bs, weekPlanStartDate: '2026-06-01', customDayTypes: ['Rehab'] }, cur, null, []);
    assert.strictEqual(out.weekPlanStartDate, '2026-06-01');
    assert.deepStrictEqual(out.customDayTypes, ['Rehab']);
  });
  test('mergeBootScalars lets an open status period override a stale statusMode', () => {
    // Period rows are written straight to Supabase, statusMode rides the diff
    // queue, so the durable record can say sick while the settings row does not.
    const periods = [{ id: 'p1', mode: 'sick', startedAt: '2026-06-09T08:00:00Z', endedAt: null }];
    const out = LB.mergeBootScalars({ ...bs }, { ...bs }, { ...bs }, periods);
    assert.strictEqual(out.statusMode, 'sick');
    assert.strictEqual(out.statusModeSince, '2026-06-09T08:00:00Z');
  });
  test('mergeBootScalars leaves statusMode alone when the open period agrees', () => {
    const fresh = { ...bs, statusMode: 'sick', statusModeSince: '2026-06-09T08:00:00Z' };
    const periods = [{ id: 'p1', mode: 'sick', startedAt: '2026-06-01T00:00:00Z', endedAt: null }];
    const out = LB.mergeBootScalars(fresh, { ...fresh }, { ...fresh }, periods);
    assert.strictEqual(out.statusMode, 'sick');
    assert.strictEqual(out.statusModeSince, '2026-06-09T08:00:00Z');
  });
  test('mergeBootScalars ignores closed status periods', () => {
    const periods = [{ id: 'p1', mode: 'sick', startedAt: '2026-05-01T00:00:00Z', endedAt: '2026-05-08T00:00:00Z' }];
    const out = LB.mergeBootScalars({ ...bs }, { ...bs }, { ...bs }, periods);
    assert.strictEqual(out.statusMode, null);
  });
  test('mergeBootScalars clears a statusMode no open period backs (server side)', () => {
    // The mirror of the rule above. Every clear path closes the period with an
    // unwrapped write and leaves the scalar to the diff queue, so the settings
    // row can still say sick after the period is properly closed. Without this
    // the user is stuck in an overlay they already turned off.
    const fresh = { ...bs, statusMode: 'sick', statusModeSince: '2026-05-01T00:00:00Z' };
    const periods = [{ id: 'p1', mode: 'sick', startedAt: '2026-05-01T00:00:00Z', endedAt: '2026-05-08T00:00:00Z' }];
    const out = LB.mergeBootScalars(fresh, { ...fresh }, { ...fresh }, periods);
    assert.strictEqual(out.statusMode, null);
    assert.strictEqual(out.statusModeSince, null);
  });
  test('mergeBootScalars clears a statusMode the cache kept after the period went', () => {
    // Same contradiction from the other side: another device closed the period
    // but its own statusMode write never landed, so the server row still says
    // vacation with nothing open behind it. base carries the mode too, which is
    // what makes this a STALE value rather than an unsynced edit.
    const synced = { ...bs, statusMode: 'vacation', statusModeSince: '2026-05-01T00:00:00Z' };
    const out = LB.mergeBootScalars({ ...synced }, { ...synced }, { ...synced }, []);
    assert.strictEqual(out.statusMode, null);
    assert.strictEqual(out.statusModeSince, null);
  });
  test('mergeBootScalars never clears a status this device just set', () => {
    // The failure that shipped. app.jsx sets phase 'ready' off the cache while
    // loadFromSupabase is still in flight, so a user can tap Sick after the
    // snapshot was taken. The optimistic period carries id '_pending' and
    // mergeCollectionById drops it (server rows only), so the merged list is
    // empty and the clear branch used to blank a status set seconds earlier.
    // The server still holds the period, so it reappeared on the next launch.
    const base = { ...bs };                                  // last synced: normal
    const cur = { ...bs, statusMode: 'sick', statusModeSince: '2026-06-09T08:00:00Z' };
    const out = LB.mergeBootScalars({ ...bs }, cur, base, []);   // fresh = pre-tap snapshot
    assert.strictEqual(out.statusMode, 'sick');
    assert.strictEqual(out.statusModeSince, '2026-06-09T08:00:00Z');
  });
  test('mergeBootScalars keeps an offline status clear against a stale server mode', () => {
    // The mirror of the case above, and the reason the group rule has to stay
    // in charge: this device cleared the status, the period write landed, the
    // scalar write did not. cur must win even though the server still says sick.
    const base = { ...bs, statusMode: 'sick', statusModeSince: '2026-06-01T00:00:00Z' };
    const cur = { ...bs, statusMode: null, statusModeSince: null };
    const out = LB.mergeBootScalars({ ...base }, cur, base, []);
    assert.strictEqual(out.statusMode, null);
  });
  test('mergeBootScalars leaves statusMode alone when it has no period data at all', () => {
    // null periods means "the caller did not supply any", not "there are none".
    // Defensive only: app.jsx always hands over an array, so this guard is not
    // reachable in production and must not be mistaken for the real one above.
    const synced = { ...bs, statusMode: 'sick', statusModeSince: '2026-05-01T00:00:00Z' };
    const out = LB.mergeBootScalars({ ...synced }, { ...synced }, { ...synced }, null);
    assert.strictEqual(out.statusMode, 'sick');
    assert.strictEqual(out.statusModeSince, '2026-05-01T00:00:00Z');
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
  // With a base, "not in base" already means never confirmed synced. Applying
  // the 2-day recency rule on top of that deleted exactly the sessions that a
  // longer offline stretch (or a sync wedged on an unrelated failing row) had
  // been unable to push.
  test('mergeSessions keeps a never-synced OLD session when a base exists', () => {
    const sess = { id: 'oldlocal', date: '2026-05-01', ended: 'x', entries: [] };
    const { sessions } = LB.mergeSessions([], [sess], null, [{ id: 'other' }], now);
    assert.strictEqual(sessions.map(s => s.id).join(','), 'oldlocal', 'never-synced workouts must not expire from the cache');
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

  // ── mergeSessions: unsynced offline edits on ended in-window sessions (audit H1) ──
  // Both sides have entries (in-window session) and this device edited a set
  // while offline: the edit is in cur but not in the persisted base. The old
  // merge took the SERVER set fields (only technique/drops survived), so the
  // edit was dropped at boot and then either silently lost (refresh-first) or
  // reverted server-side by the post-merge flush (flush-first). The edit must
  // survive the merge; the follow-up flush diffs it against the server-based
  // sync base and pushes it.
  const mkInWindow = (kg, extra = {}) => ({
    id: 'w1', date: '2026-06-09', ended: '2026-06-09T12:00:00Z',
    entries: [{ exId: 'e1', name: 'Row', sets: [{ kg, reps: 8, done: true, ...extra }] }],
  });
  test('mergeSessions keeps an unsynced offline set edit on an ended in-window session', () => {
    const base = [mkInWindow(90)];
    const cur = [mkInWindow(100)]; // offline edit: 90 → 100
    const fresh = [mkInWindow(90)];
    const { sessions } = LB.mergeSessions(fresh, cur, null, base, now);
    assert.strictEqual(sessions[0].entries[0].sets[0].kg, 100, 'the offline edit must survive the boot merge');
  });
  test('mergeSessions keeps an offline-added set (length differs from base)', () => {
    const base = [{ id: 'w2', date: '2026-06-09', ended: 'x', entries: [{ exId: 'e1', sets: [{ kg: 90, reps: 8, done: true }] }] }];
    const cur = [{ id: 'w2', date: '2026-06-09', ended: 'x', entries: [{ exId: 'e1', sets: [{ kg: 90, reps: 8, done: true }, { kg: 100, reps: 5, done: false }] }] }];
    const fresh = [{ id: 'w2', date: '2026-06-09', ended: 'x', entries: [{ exId: 'e1', sets: [{ kg: 90, reps: 8, done: true }] }] }];
    const { sessions } = LB.mergeSessions(fresh, cur, null, base, now);
    assert.strictEqual(sessions[0].entries[0].sets.length, 2, 'offline-added set must survive the boot merge');
  });
  test('mergeSessions keeps an offline-added entry (entry count differs from base)', () => {
    const base = [{ id: 'w3', date: '2026-06-09', ended: 'x', entries: [{ exId: 'e1', sets: [{ kg: 90, reps: 8, done: true }] }] }];
    const cur = [{ id: 'w3', date: '2026-06-09', ended: 'x', entries: [
      { exId: 'e1', sets: [{ kg: 90, reps: 8, done: true }] },
      { exId: 'e2', sets: [{ kg: 40, reps: 12, done: false }] },
    ] }];
    const fresh = [{ id: 'w3', date: '2026-06-09', ended: 'x', entries: [{ exId: 'e1', sets: [{ kg: 90, reps: 8, done: true }] }] }];
    const { sessions } = LB.mergeSessions(fresh, cur, null, base, now);
    assert.strictEqual(sessions[0].entries.length, 2, 'offline-added entry must survive the boot merge');
  });
  test('mergeSessions trusts the server when local entries match the base (remote edit wins)', () => {
    const base = [mkInWindow(90)];
    const cur = [mkInWindow(90)]; // no local change
    const fresh = [mkInWindow(95)]; // edited on another device
    const { sessions } = LB.mergeSessions(fresh, cur, null, base, now);
    assert.strictEqual(sessions[0].entries[0].sets[0].kg, 95, 'server value must win when this device made no edit');
  });
  test('mergeSessions still rescues local technique/drops when entries match the base', () => {
    // base and cur must both carry the technique/drops (cur matches base, no
    // unsynced edit): giving it to cur alone made cur differ from base and
    // this test silently exercised the wholesale-keep-cur branch (same as
    // the very first test above) instead of the mergeEntrySets rescue branch
    // its name and assertions claim to cover (H1 verification, 2026-08-05).
    const base = [mkInWindow(90, { technique: 'drop', drops: [{ kg: 70, reps: 8 }] })];
    const cur = [mkInWindow(90, { technique: 'drop', drops: [{ kg: 70, reps: 8 }] })];
    const fresh = [mkInWindow(90)]; // server lost technique/drops in a flush race
    const { sessions } = LB.mergeSessions(fresh, cur, null, base, now);
    assert.strictEqual(sessions[0].entries[0].sets[0].technique, 'drop', 'unsynced technique must still be rescued');
    assert.strictEqual(sessions[0].entries[0].sets[0].kg, 90);
  });
  test('mergeSessions does NOT treat in-memory cardio fields as an unsynced edit', () => {
    const base = [{ id: 'w4', date: '2026-06-09', ended: 'x', entries: [{ exId: 'e1', sets: [{ kg: 90, reps: 8, done: true }] }] }];
    const cur = [{ id: 'w4', date: '2026-06-09', ended: 'x', entries: [{ exId: 'e1', isCardio: true, cardioDone: true, sets: [{ kg: 90, reps: 8, done: true }] }] }];
    const fresh = [{ id: 'w4', date: '2026-06-09', ended: 'x', entries: [{ exId: 'e1', sets: [{ kg: 92, reps: 8, done: true }] }] }];
    const { sessions } = LB.mergeSessions(fresh, cur, null, base, now);
    assert.strictEqual(sessions[0].entries[0].sets[0].kg, 92, 'no synced local edit → server wins');
    assert.strictEqual(sessions[0].entries[0].isCardio, true, 'in-memory cardio flags still rescued by the entry merge');
  });
  test('mergeSessions propagates a remote set deletion when there is no local edit', () => {
    const base = [{ id: 'w5', date: '2026-06-09', ended: 'x', entries: [{ exId: 'e1', sets: [{ kg: 90, reps: 8, done: true }, { kg: 80, reps: 6, done: true }] }] }];
    const cur = [{ id: 'w5', date: '2026-06-09', ended: 'x', entries: [{ exId: 'e1', sets: [{ kg: 90, reps: 8, done: true }, { kg: 80, reps: 6, done: true }] }] }];
    const fresh = [{ id: 'w5', date: '2026-06-09', ended: 'x', entries: [{ exId: 'e1', sets: [{ kg: 90, reps: 8, done: true }] }] }];
    const { sessions } = LB.mergeSessions(fresh, cur, null, base, now);
    assert.strictEqual(sessions[0].entries[0].sets.length, 1, 'remote deletion must not be resurrected');
  });
  // baseEntries === null (this device's persisted base never captured real
  // entries for this session, e.g. it sat out-of-window until a date edit
  // just moved it in, and the entries/sets sync failed in the same flush the
  // date write itself went through on): "nothing to compare against" must
  // not silently resolve to "trust the server", that reintroduced the exact
  // H1 data loss through a narrower door (H1 verification, 2026-08-05).
  test('mergeSessions keeps an unsynced offline edit when this session has no usable base (H1 gap)', () => {
    const base = [{ id: 'w1', date: '2026-06-09', ended: 'x', entries: [] }]; // windowed/never-hydrated base
    const cur = [mkInWindow(130)]; // offline edit, now in-window locally
    const fresh = [mkInWindow(90)]; // server's stale pre-edit value
    const { sessions } = LB.mergeSessions(fresh, cur, null, base, now);
    assert.strictEqual(sessions[0].entries[0].sets[0].kg, 130, 'the offline edit must survive even with no usable base to compare against');
  });

  // ── mergeSessions: unsynced session-scalar edits (audit H2) ──────────────
  // finish() (screens-train.jsx) sets `ended` and clears inProgress in the
  // SAME action, so a real just-finished session always has isActive=false
  // by the time any later boot merge runs. Before this fix `ended` had no
  // "differs from base -> keep local" protection at all (only entries/sets
  // did, H1), so a reload landing before the `ended` sync confirmed reverted
  // it straight back to the server's stale null, silently forgetting the
  // session had ever finished (real user report, 2026-08).
  test('mergeSessions keeps an unsynced local `ended` even though inProgress is already cleared', () => {
    const base = [{ id: 's1', date: '2026-06-10', ended: null, entries: [] }];
    const cur = [{ id: 's1', date: '2026-06-10', ended: '2026-06-10T11:00:00Z', durationMinutes: 42, entries: [] }];
    const fresh = [{ id: 's1', date: '2026-06-10', ended: null, entries: [] }]; // server predates the finish
    // inProgress is null: exactly finish()'s own post-condition, not the
    // session's id, so isActive is false for this session either way.
    const { sessions } = LB.mergeSessions(fresh, cur, null, base, now);
    assert.strictEqual(sessions[0].ended, '2026-06-10T11:00:00Z', 'the unsynced finish must survive the boot merge');
    assert.strictEqual(sessions[0].durationMinutes, 42);
  });
  test('mergeSessions trusts the server ended when local matches the base (remote finish wins)', () => {
    const base = [{ id: 's2', date: '2026-06-10', ended: null, entries: [] }];
    const cur = [{ id: 's2', date: '2026-06-10', ended: null, entries: [] }]; // no local change
    const fresh = [{ id: 's2', date: '2026-06-10', ended: '2026-06-10T11:00:00Z', entries: [] }]; // finished on another device
    const { sessions } = LB.mergeSessions(fresh, cur, null, base, now);
    assert.strictEqual(sessions[0].ended, '2026-06-10T11:00:00Z', 'server value must win when this device made no edit');
  });
  test('mergeSessions keeps an unsynced `ended` with no usable base (H2, mirrors the H1 gap)', () => {
    const cur = [{ id: 's3', date: '2026-06-10', ended: '2026-06-10T11:00:00Z', entries: [] }];
    const fresh = [{ id: 's3', date: '2026-06-10', ended: null, entries: [] }];
    const { sessions } = LB.mergeSessions(fresh, cur, null, null, now); // no base at all (legacy cache)
    assert.strictEqual(sessions[0].ended, '2026-06-10T11:00:00Z', 'nothing to compare against must not resolve to "trust the server"');
  });
  test('mergeSessions protects other synced session scalars the same way (feel, isCleanup)', () => {
    const base = [{ id: 's4', date: '2026-06-10', ended: 'x', feel: null, isCleanup: false, entries: [] }];
    const cur = [{ id: 's4', date: '2026-06-10', ended: 'x', feel: 'great', isCleanup: true, entries: [] }];
    const fresh = [{ id: 's4', date: '2026-06-10', ended: 'x', feel: null, isCleanup: false, entries: [] }];
    const { sessions } = LB.mergeSessions(fresh, cur, null, base, now);
    assert.strictEqual(sessions[0].feel, 'great');
    assert.strictEqual(sessions[0].isCleanup, true);
  });
  // The H2 scalar test above compared jsonb by reference, so ANY session
  // carrying a mesoRecap counted as "locally edited" forever: store and base
  // are two separately parsed subtrees of the persisted cache pair, never
  // reference-equal even when deep-equal. Every one of the 14 fields then got
  // pinned to the stale cache and pushed back over a newer server value.
  test('mergeSessions does not treat a deep-equal mesoRecap as a local edit', () => {
    const recap = { groups: [{ muscle: 'chest', general: [{ title: 'Soreness', sub: 'None' }], joint: [] }], gains: [] };
    const base = [{ id: 's5', date: '2026-06-10', ended: 'x', feel: 'ok', mesoRecap: recap, entries: [] }];
    // Separately parsed copy, exactly what loadLocalState's `parsed.base ?? store`
    // hands back whenever a sync was still pending when the cache was written.
    const cur = [{ id: 's5', date: '2026-06-10', ended: 'x', feel: 'ok', mesoRecap: JSON.parse(JSON.stringify(recap)), entries: [] }];
    const fresh = [{ id: 's5', date: '2026-06-10', ended: 'x', feel: 'great', mesoRecap: JSON.parse(JSON.stringify(recap)), entries: [] }];
    const { sessions } = LB.mergeSessions(fresh, cur, null, base, now);
    assert.strictEqual(sessions[0].feel, 'great', 'no local edit was made, so the other device\'s feel must win');
  });
  test('mergeSessions ignores jsonb key order when deciding "locally edited"', () => {
    // Postgres jsonb normalizes key order, the in-memory object keeps insertion
    // order, so a plain JSON.stringify compare would also have been wrong here.
    const base = [{ id: 's6', ended: 'x', feel: 'ok', mesoRecap: { a: 1, b: { x: 1, y: 2 } }, entries: [] }];
    const cur = [{ id: 's6', ended: 'x', feel: 'ok', mesoRecap: { b: { y: 2, x: 1 }, a: 1 }, entries: [] }];
    const fresh = [{ id: 's6', ended: 'x', feel: 'great', mesoRecap: { a: 1, b: { x: 1, y: 2 } }, entries: [] }];
    const { sessions } = LB.mergeSessions(fresh, cur, null, base, now);
    assert.strictEqual(sessions[0].feel, 'great');
  });
  test('mergeSessions still keeps a genuinely edited mesoRecap', () => {
    const base = [{ id: 's7', ended: 'x', mesoRecap: { groups: [], gains: [] }, entries: [] }];
    const cur = [{ id: 's7', ended: 'x', mesoRecap: { groups: [], gains: [{ key: 'bench_d1' }] }, entries: [] }];
    const fresh = [{ id: 's7', ended: 'x', mesoRecap: { groups: [], gains: [] }, entries: [] }];
    const { sessions } = LB.mergeSessions(fresh, cur, null, base, now);
    assert.deepStrictEqual(sessions[0].mesoRecap.gains, [{ key: 'bench_d1' }], 'a real post-hoc feedback edit must still survive');
  });
  test('mergeSessions only overrides the fields this device actually edited', () => {
    // An older cache has no signalWeight at all while the server does. The
    // all-or-nothing override nulled it out purely because `feel` differed.
    const base = [{ id: 's8', ended: 'x', feel: null, entries: [] }];
    const cur = [{ id: 's8', ended: 'x', feel: 'great', entries: [] }];
    const fresh = [{ id: 's8', ended: 'x', feel: null, signalWeight: 'full', readiness: 4, entries: [] }];
    const { sessions } = LB.mergeSessions(fresh, cur, null, base, now);
    assert.strictEqual(sessions[0].feel, 'great', 'the edited field still wins');
    assert.strictEqual(sessions[0].signalWeight, 'full', 'an untouched field must keep the server value, not be nulled');
    assert.strictEqual(sessions[0].readiness, 4);
  });
  test('mergeSessions with no base does not null fields the cache never had', () => {
    const cur = [{ id: 's9', ended: '2026-06-10T11:00:00Z', entries: [] }];
    const fresh = [{ id: 's9', ended: null, signalWeight: 'full', entries: [] }];
    const { sessions } = LB.mergeSessions(fresh, cur, null, null, now);
    assert.strictEqual(sessions[0].ended, '2026-06-10T11:00:00Z', 'the H2 no-base bias still holds for what the cache does carry');
    assert.strictEqual(sessions[0].signalWeight, 'full', 'but a field the cache never had must not be nulled');
  });
  // Per-field granularity must not split fields that are only meaningful
  // together. deriveSignalWeight maps readiness MANY-to-one onto signalWeight,
  // so a local 'rough' -> 'reentry' correction leaves signalWeight untouched;
  // taking the server's signalWeight next to the local readiness would score a
  // re-entry day as a full autoregulation signal.
  test('mergeSessions keeps readiness and signalWeight together when either is edited', () => {
    const base = [{ id: 's10', ended: 'x', readiness: 'rough', signalWeight: 'discounted', entries: [] }];
    const cur = [{ id: 's10', ended: 'x', readiness: 'reentry', signalWeight: 'discounted', entries: [] }];
    const fresh = [{ id: 's10', ended: 'x', readiness: 'normal', signalWeight: 'full', entries: [] }];
    const { sessions } = LB.mergeSessions(fresh, cur, null, base, now);
    assert.strictEqual(sessions[0].readiness, 'reentry');
    assert.strictEqual(sessions[0].signalWeight, 'discounted', 'signalWeight must follow its own readiness, not the server\'s');
  });
  test('mergeSessions keeps ended and durationMinutes together', () => {
    const base = [{ id: 's11', ended: null, startedAt: 'a', durationMinutes: null, entries: [] }];
    const cur = [{ id: 's11', ended: '2026-06-10T11:00:00Z', startedAt: 'a', durationMinutes: 42, entries: [] }];
    const fresh = [{ id: 's11', ended: null, startedAt: 'a', durationMinutes: 99, entries: [] }];
    const { sessions } = LB.mergeSessions(fresh, cur, null, base, now);
    assert.strictEqual(sessions[0].ended, '2026-06-10T11:00:00Z');
    assert.strictEqual(sessions[0].durationMinutes, 42, 'the duration belonging to the local finish, not the server\'s');
  });

  // ── the same jsonb key-order trap, one level down ────────────────────────
  // normSet feeds BOTH the sync diff and the boot merge's set-level test, and
  // drops/hornLoads are jsonb: the app writes {partials, stretch}, Postgres
  // hands back {stretch, partials}. A raw JSON.stringify called that an edit.
  test('normSet ignores jsonb key order in a set\'s drops', () => {
    // The app writes drops in this order (screens-train.jsx)...
    const local = { kg: 100, reps: 5, done: true, technique: 'lengthened_partial', drops: { partials: 3, stretch: 1 } };
    // ...and anything that has been through the jsonb column comes back in the
    // order Postgres normalizes to, which is what the persisted base holds.
    const fromJsonb = { kg: 100, reps: 5, done: true, technique: 'lengthened_partial', drops: { stretch: 1, partials: 3 } };
    assert.strictEqual(LB.normSet(local), LB.normSet(fromJsonb), 'key order alone must not read as a changed set');
    const reallyChanged = { ...local, drops: { partials: 4, stretch: 1 } };
    assert.notStrictEqual(LB.normSet(local), LB.normSet(reallyChanged), 'a real change must still register');
  });
  test('mergeSessions ignores jsonb key order in a set\'s drops', () => {
    const mkSet = (drops, kg) => ({ kg, reps: 5, done: true, technique: 'lengthened_partial', drops });
    const mkEntry = (drops, kg) => [{ exId: 'e1', name: 'Bench', sets: [mkSet(drops, kg)] }];
    // base is the last confirmed-synced snapshot, i.e. server-shaped (jsonb key
    // order); cur is this device's in-memory copy, in the app's own order. They
    // are the SAME set, and nothing was edited locally.
    const base = [{ id: 's12', ended: 'x', aggExercises: 1, entries: mkEntry({ stretch: 1, partials: 3 }, 100) }];
    const cur = [{ id: 's12', ended: 'x', aggExercises: 1, entries: mkEntry({ partials: 3, stretch: 1 }, 100) }];
    // Another device raised the load since.
    const fresh = [{ id: 's12', ended: 'x', aggExercises: 1, entries: mkEntry({ stretch: 1, partials: 3 }, 105) }];
    const { sessions } = LB.mergeSessions(fresh, cur, null, base, now);
    assert.strictEqual(sessions[0].entries[0].sets[0].kg, 105, 'no local edit was made, so the other device\'s load must win');
  });
  test('mergeCollectionById ignores jsonb key order but still keeps a real local edit', () => {
    const base = [{ id: 'p1', name: 'Push', days: [{ id: 'd1', name: 'A' }] }];
    const unchangedLocal = [{ id: 'p1', name: 'Push', days: [{ name: 'A', id: 'd1' }] }]; // jsonb order
    const renamedOnServer = [{ id: 'p1', name: 'Push v2', days: [{ id: 'd1', name: 'A' }] }];
    assert.strictEqual(
      LB.mergeCollectionById(renamedOnServer, unchangedLocal, base, null)[0].name, 'Push v2',
      'key order alone must not count as a local edit',
    );
    const editedLocal = [{ id: 'p1', name: 'Push local', days: [{ id: 'd1', name: 'A' }] }];
    assert.strictEqual(
      LB.mergeCollectionById(renamedOnServer, editedLocal, base, null)[0].name, 'Push local',
      'a genuine unsynced local edit must still win',
    );
  });

  await testAsync('H1 end-to-end: merged offline edit is pushed by the follow-up flush', async () => {
    rpcLog.length = 0;
    testFrom = () => builder({ data: null, error: null });
    const base = { ...baseStore(), sessions: [mkInWindow(90)] };
    const cur = { ...baseStore(), sessions: [mkInWindow(100)] }; // offline edit
    const fresh = { ...baseStore(), sessions: [mkInWindow(90)] }; // server snapshot predates the edit
    const { sessions } = LB.mergeSessions(fresh.sessions, cur.sessions, null, base.sessions, now);
    // Follow-up flush: sync base is the fresh server state, target is the merged store.
    const prev = { ...baseStore(), sessions: fresh.sessions };
    const next = { ...baseStore(), sessions };
    await LB.syncStore(prev, next, 'u1');
    const call = rpcLog.find(c => c.name === 'sync_sets_batch');
    assert.ok(call, 'sync_sets_batch must be called for the surviving edit');
    assert.strictEqual(call.args.p_sets.length, 1, 'only the edited set is re-written, not the whole session');
    assert.strictEqual(call.args.p_sets[0].kg, 100, 'the edited value is what gets pushed');
  });

  // ── resolveInProgressId: boot-merge in-progress-session pointer ──────────
  // This is the exact bug scenario: base matches cur (this device made no
  // unsynced change), fresh has moved on (another device started a real
  // session server-side). Trusting cur here is the multi-device session
  // kill: a second device that never started a session overwrites the
  // server's pointer with its own stale/null value.
  test('resolveInProgressId trusts fresh when cur matches base (no local change)', () => {
    const cur = { inProgress: null };
    const fresh = { inProgress: 'real-session' };
    const base = { inProgress: null };
    assert.strictEqual(LB.resolveInProgressId(cur, fresh, base), 'real-session');
  });
  test('resolveInProgressId trusts cur when it differs from base (unsynced local change)', () => {
    const cur = { inProgress: null }; // device just ended its own session
    const fresh = { inProgress: 'stale-session' };
    const base = { inProgress: 'stale-session' };
    assert.strictEqual(LB.resolveInProgressId(cur, fresh, base), null);
  });
  test('resolveInProgressId trusts cur when there is no base (legacy cache)', () => {
    const cur = { inProgress: 'local-only' };
    const fresh = { inProgress: null };
    assert.strictEqual(LB.resolveInProgressId(cur, fresh, null), 'local-only');
    assert.strictEqual(LB.resolveInProgressId(cur, fresh, undefined), 'local-only');
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
    // A 30-min / 5k run vs a long bike ride, no run history → null
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
    // deepStrictEqual would trip on the vm realm's distinct Object.prototype:
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
    // equal-weight would give (1+1+0.8)/3 = 0.9333 → 93, calorie-weighting is fairer
    const t2 = { protein: 150, carbs: 350, fat: 50 };
    assert.strictEqual(LB.macroAdherence({ protein: 150, carbs: 350, fat: 60 }, t2), 96);
    assert.strictEqual(LB.macroAdherence({ protein: 200, carbs: null, fat: 70 }, t), null);
    assert.strictEqual(LB.macroAdherence({ protein: 200, carbs: 250, fat: 70 }, null), null);
  });

  test('mealCategories: defaults, custom windows, and rejection of broken ones', () => {
    // JSON instead of deepStrictEqual: store.js runs in a vm sandbox, so its
    // arrays have a different Array prototype than this file's and a deep
    // strict compare fails on that alone (same reason the rest of this suite
    // compares by JSON).
    const starts = s => JSON.stringify(LB.mealCategories(s).map(c => c.startHour));
    const ends = s => JSON.stringify(LB.mealCategories(s).map(c => c.endHour));
    const DEFAULTS = JSON.stringify([0, 9, 11, 13, 16, 20]);
    // Unset, empty and null all mean "the built-in defaults".
    assert.strictEqual(starts(null), DEFAULTS);
    assert.strictEqual(starts({}), DEFAULTS);
    assert.strictEqual(starts({ mealWindows: null }), DEFAULTS);
    // Each category ends where the next begins, the last covers to midnight.
    assert.strictEqual(ends({}), JSON.stringify([9, 11, 13, 16, 20, 24]));
    // A valid custom set is used verbatim, ends following along.
    const late = [0, 11, 14, 16, 19, 22];
    assert.strictEqual(starts({ mealWindows: late }), JSON.stringify(late));
    assert.strictEqual(ends({ mealWindows: late }), JSON.stringify([11, 14, 16, 19, 22, 24]));
    // Anything that could produce a gap, an overlap or an uncovered morning is
    // rejected wholesale rather than half-applied: the grouping decides which
    // entries appear under which heading, so a broken value must not render.
    assert.strictEqual(starts({ mealWindows: [1, 9, 11, 13, 16, 20] }), DEFAULTS, 'first hour must be 0');
    assert.strictEqual(starts({ mealWindows: [0, 11, 9, 13, 16, 20] }), DEFAULTS, 'must ascend');
    assert.strictEqual(starts({ mealWindows: [0, 9, 9, 13, 16, 20] }), DEFAULTS, 'strictly, no empty category');
    assert.strictEqual(starts({ mealWindows: [0, 9, 11, 13, 16] }), DEFAULTS, 'wrong length');
    assert.strictEqual(starts({ mealWindows: [0, 9, 11, 13, 16, 24] }), DEFAULTS, 'a start of 24 is out of range');
    assert.strictEqual(starts({ mealWindows: [0, 9, 11, 13, 16, '20'] }), DEFAULTS, 'strings are not hours');
    assert.strictEqual(starts({ mealWindows: 'nope' }), DEFAULTS);
    // Labels stay put whatever the boundaries are.
    assert.strictEqual(JSON.stringify(LB.mealCategories({ mealWindows: late }).map(c => c.id)),
      JSON.stringify(['breakfast', 'snack1', 'lunch', 'snack2', 'dinner', 'snack3']));
  });

  test('estimateTdee: Mifflin-St Jeor, both sex constants, activity multiplier', () => {
    // 80 kg, 180 cm, 30 y: base = 10*80 + 6.25*180 - 5*30 = 800 + 1125 - 150 = 1775
    // male +5 -> 1780; x1.55 (moderate) = 2759
    assert.strictEqual(JSON.stringify(LB.estimateTdee({ weightKg: 80, heightCm: 180, age: 30, sex: 'male', activity: 'moderate' })),
      JSON.stringify({ bmr: 1780, tdee: 2759 }));
    // female -161 -> 1614; x1.2 (sedentary) = 1937
    assert.strictEqual(JSON.stringify(LB.estimateTdee({ weightKg: 80, heightCm: 180, age: 30, sex: 'female', activity: 'sedentary' })),
      JSON.stringify({ bmr: 1614, tdee: 1937 }));
    // Anything other than the equation's two constants takes the midpoint
    // (-78), so an unset/other answer still yields an estimate.
    assert.strictEqual(LB.estimateTdee({ weightKg: 80, heightCm: 180, age: 30, sex: null, activity: 'moderate' }).bmr, 1697);
    // An unknown activity key falls back to moderate rather than NaN.
    assert.strictEqual(LB.estimateTdee({ weightKg: 80, heightCm: 180, age: 30, sex: 'male', activity: 'nonsense' }).tdee, 2759);
    // Missing inputs produce no estimate at all, never a partial one.
    assert.strictEqual(LB.estimateTdee({ weightKg: 0, heightCm: 180, age: 30, sex: 'male', activity: 'moderate' }), null);
    assert.strictEqual(LB.estimateTdee({ weightKg: 80, heightCm: null, age: 30, sex: 'male', activity: 'moderate' }), null);
    assert.strictEqual(LB.estimateTdee({ weightKg: 80, heightCm: 180, age: null, sex: 'male', activity: 'moderate' }), null);
  });

  test('macroTargetsFromGoal: maintain splits nothing, protein/fat hold, carbs cycle', () => {
    // maintain, 4 training days, 80 kg, TDEE 3000.
    // protein = 80*2 = 160, fat = round(3000*0.25/9) = 83 (floor 0.5 g/kg = 40, so 83 wins)
    // training kcal = 3000*1.1 = 3300, rest = (21000 - 4*3300)/3 = 2600
    // carbsTraining = (3300 - 640 - 747)/4 = 478.25 -> 478
    // carbsRest = (2600 - 640 - 747)/4 = 303.25 -> 303
    const m = LB.macroTargetsFromGoal({ tdee: 3000, weightKg: 80, goal: 'maintain', trainingDays: 4 });
    assert.strictEqual(m.proteinTraining, 160);
    assert.strictEqual(m.proteinRest, 160, 'protein never swings with the day type');
    assert.strictEqual(m.fatTraining, 83);
    assert.strictEqual(m.fatRest, 83, 'fat never swings either, carbs absorb the difference');
    assert.strictEqual(m.carbsTraining, 478);
    assert.strictEqual(m.carbsRest, 303);
    // Calories are derived, not stored independently.
    assert.strictEqual(m.caloriesTraining, LB.caloriesFromMacros(160, 478, 83));
    // The weekly total still lands on 7 x the daily figure (rounding aside).
    const weekly = m.caloriesTraining * 4 + m.caloriesRest * 3;
    assert.ok(Math.abs(weekly - 3000 * 7) < 60, `weekly ${weekly} stays within rounding of 21000`);
  });

  test('minRestRatio: the automatic split, and the hardest cycle on offer', () => {
    // 4 training days: 3300 vs 2600 kcal on a 3000 average, so rest sits at
    // 78.8% of a training day. Independent of the intake, by construction.
    assert.strictEqual(Math.round(LB.minRestRatio(4) * 1000), 788);
    assert.strictEqual(LB.minRestRatio(4), LB.minRestRatio(4), 'depends on nothing but the day count');
    // With one rest day left the bump has to shrink, so the ratio comes back up.
    assert.ok(LB.minRestRatio(6) > 0.75 && LB.minRestRatio(6) < 0.79);
    // Nothing to cycle against at the extremes.
    assert.strictEqual(LB.minRestRatio(0), 1);
    assert.strictEqual(LB.minRestRatio(7), 1);
    assert.strictEqual(LB.minRestRatio(99), 1, 'clamped, not extrapolated');
    // Every real split leaves training days ahead of rest days.
    for (const d of [1, 2, 3, 4, 5, 6]) assert.ok(LB.minRestRatio(d) < 1, `${d} days cycles`);
  });

  test('macroTargetsFromGoal: restRatio evens the week out without changing its total', () => {
    const base = { tdee: 3000, weightKg: 80, goal: 'maintain', trainingDays: 4 };
    const auto = LB.macroTargetsFromGoal(base);
    // Omitting it reproduces the automatic split exactly, so the default keeps
    // following the day count rather than freezing at whatever was picked once.
    const explicit = LB.macroTargetsFromGoal({ ...base, restRatio: LB.minRestRatio(4) });
    assert.strictEqual(JSON.stringify(explicit), JSON.stringify(auto));
    // 1 means every day identical.
    const flat = LB.macroTargetsFromGoal({ ...base, restRatio: 1 });
    assert.strictEqual(flat.caloriesTraining, flat.caloriesRest);
    assert.strictEqual(flat.carbsTraining, flat.carbsRest);
    // Halfway sits between the two, still ahead on training days.
    const mid = LB.macroTargetsFromGoal({ ...base, restRatio: 0.9 });
    assert.ok(mid.caloriesTraining < auto.caloriesTraining && mid.caloriesTraining > flat.caloriesTraining);
    assert.ok(mid.caloriesRest > auto.caloriesRest && mid.caloriesRest < flat.caloriesRest);
    // Whatever the ratio, the week still averages out to the same intake.
    for (const r of [undefined, 0.8, 0.9, 0.95, 1]) {
      const m = LB.macroTargetsFromGoal({ ...base, restRatio: r });
      const avg = LB.weeklyAverageCalories(m.caloriesTraining, m.caloriesRest, 4);
      assert.ok(Math.abs(avg - 3000) < 20, `ratio ${r} averages ${avg}`);
    }
    // Below the automatic split it is clamped: that is the hardest cycle offered.
    const tooLow = LB.macroTargetsFromGoal({ ...base, restRatio: 0.2 });
    assert.strictEqual(JSON.stringify(tooLow), JSON.stringify(auto));
    // Above 1 is clamped too, so rest days can never out-eat training days.
    assert.strictEqual(JSON.stringify(LB.macroTargetsFromGoal({ ...base, restRatio: 3 })), JSON.stringify(flat));
    // With nothing to cycle against the ratio is simply irrelevant.
    const allTraining = LB.macroTargetsFromGoal({ ...base, trainingDays: 7, restRatio: 0.5 });
    assert.strictEqual(allTraining.caloriesTraining, allTraining.caloriesRest);
  });

  test('macroTargetsFromGoal: a rest day is never squeezed to an absurd figure', () => {
    // With few rest days left to absorb it, the training-day bump has to
    // shrink: at 6 of 7 a flat 10% would leave the single rest day 1800 kcal
    // under the average, i.e. a 1200 kcal day here.
    for (const days of [1, 2, 3, 4, 5, 6]) {
      const m = LB.macroTargetsFromGoal({ tdee: 3000, weightKg: 80, goal: 'maintain', trainingDays: days });
      assert.ok(m.caloriesRest >= 3000 * 0.75, `${days} training days leaves a ${m.caloriesRest} kcal rest day`);
      assert.ok(m.caloriesTraining > m.caloriesRest, `${days} training days still eats more on training days`);
      // Carbs never had to be clamped at zero to make the day fit.
      assert.ok(m.carbsRest > 0, `${days} training days leaves real carbs on a rest day`);
    }
  });

  test('macroTargetsFromGoal: protein/fat crowding out a cycled rest day does not overshoot the week', () => {
    // High protein+fat settings on an aggressively cycled single-training-day
    // week: protein*4 + fat*9 alone (2295 kcal) lands right at the rest day's
    // own calorie figure, clamping its carbs to 0. Before the fix, that made
    // the rest day's real calories 2295 instead of its intended lower figure
    // with nothing compensating trainingCal for the difference, so the week
    // quietly averaged above the 2325 kcal target instead of hitting it.
    const params = { tdee: 2600, weightKg: 90, goal: 'cut', rateKgPerWeek: 0.25, trainingDays: 1, proteinPerKg: 3, fatPerKg: 1.5 };
    const m = LB.macroTargetsFromGoal(params);
    assert.strictEqual(m.carbsRest, 0, 'the rest day is the one that gets crowded out');
    assert.ok(m.carbsTraining > 0, 'training day still has room, so only the rest day should clamp');
    const daily = Math.max(Math.round(2600 - 0.25 * 7700 / 7), Math.round(2600 * 0.6));
    const weeklyAvg = LB.weeklyAverageCalories(m.caloriesTraining, m.caloriesRest, params.trainingDays);
    assert.ok(Math.abs(weeklyAvg - daily) <= 2, `week averages ${weeklyAvg} against a ${daily} kcal target`);
  });

  test('macroTargetsFromGoal: a target too low for protein+fat alone still degrades cleanly', () => {
    // protein*4 + fat*9 (2550 kcal) here exceeds even the flat daily target
    // (1200 kcal), so no split can hit it: both day types should bottom out
    // at the same protein+fat floor, carbs at 0, rather than crash, go
    // negative, or leave the two day types inexplicably different.
    const m = LB.macroTargetsFromGoal({ tdee: 2000, weightKg: 100, goal: 'cut', rateKgPerWeek: 1.5, trainingDays: 1, proteinPerKg: 3, fatPerKg: 1.5 });
    assert.strictEqual(m.carbsTraining, 0);
    assert.strictEqual(m.carbsRest, 0);
    assert.strictEqual(m.caloriesTraining, m.caloriesRest);
    assert.ok(Number.isFinite(m.caloriesTraining) && m.caloriesTraining > 0);
  });

  test('macroTargetsFromGoal: 0 and 7 training days have nothing to cycle against', () => {
    for (const days of [0, 7]) {
      const m = LB.macroTargetsFromGoal({ tdee: 2500, weightKg: 70, goal: 'maintain', trainingDays: days });
      assert.strictEqual(m.carbsTraining, m.carbsRest, `${days} training days: both day types are identical`);
      assert.strictEqual(m.caloriesTraining, m.caloriesRest);
    }
  });

  test('macroTargetsFromGoal: cut and gain move the daily figure by the weekly rate', () => {
    const base = { tdee: 2800, weightKg: 75, trainingDays: 7 };
    const maintain = LB.macroTargetsFromGoal({ ...base, goal: 'maintain' });
    // 0.5 kg/week = 0.5*7700/7 = 550 kcal/day off (or onto) the daily figure.
    const cut = LB.macroTargetsFromGoal({ ...base, goal: 'cut', rateKgPerWeek: 0.5 });
    const gain = LB.macroTargetsFromGoal({ ...base, goal: 'gain', rateKgPerWeek: 0.5 });
    // Tolerance covers the few kcal lost to rounding every macro to whole grams.
    assert.ok(Math.abs((maintain.caloriesTraining - cut.caloriesTraining) - 550) <= 5, 'a cut lands ~550 kcal lower');
    assert.ok(Math.abs((gain.caloriesTraining - maintain.caloriesTraining) - 550) <= 5, 'a gain lands ~550 kcal higher');
    // Protein is a function of bodyweight, so it is defended in a deficit;
    // fat is a share of intake, so it moves with it; carbs take the rest.
    assert.strictEqual(cut.proteinTraining, maintain.proteinTraining, 'protein is defended in a deficit');
    assert.ok(cut.fatTraining < maintain.fatTraining, 'fat is a share of intake, so it scales with it');
    assert.ok(maintain.carbsTraining - cut.carbsTraining > cut.fatTraining, 'carbs still absorb most of the cut');
    // A sign-flipped rate is read as a magnitude, so "cut" can never add calories.
    assert.strictEqual(JSON.stringify(LB.macroTargetsFromGoal({ ...base, goal: 'cut', rateKgPerWeek: -0.5 })), JSON.stringify(cut));
  });

  test('macroTargetsFromGoal: guards against absurd inputs', () => {
    // An aggressive rate against a low TDEE is floored at 60% of TDEE rather
    // than prescribing a starvation intake off a slider.
    const extreme = LB.macroTargetsFromGoal({ tdee: 1600, weightKg: 55, goal: 'cut', rateKgPerWeek: 2, trainingDays: 7 });
    assert.strictEqual(extreme.caloriesTraining >= Math.round(1600 * 0.6) - 30, true, 'never drops far below the 60% floor');
    assert.strictEqual(extreme.carbsTraining >= 0, true, 'carbs never go negative');
    // Fat has its own 0.5 g/kg floor, so a very low intake does not buy carbs
    // by zeroing fat out.
    assert.strictEqual(extreme.fatTraining >= Math.round(55 * 0.5), true);
    // Without a weight or a TDEE there is nothing to compute.
    assert.strictEqual(LB.macroTargetsFromGoal({ tdee: 2500, weightKg: null, goal: 'maintain', trainingDays: 4 }), null);
    assert.strictEqual(LB.macroTargetsFromGoal({ tdee: null, weightKg: 80, goal: 'maintain', trainingDays: 4 }), null);
    // Training days outside 0-7 are clamped instead of producing a divide-by-zero.
    assert.ok(LB.macroTargetsFromGoal({ tdee: 2500, weightKg: 80, goal: 'maintain', trainingDays: 12 }));
    assert.ok(LB.macroTargetsFromGoal({ tdee: 2500, weightKg: 80, goal: 'maintain', trainingDays: -3 }));
  });

  test('macroTargetsFromGoal: fatPerKg is a target, and may go under the floor', () => {
    const base = { tdee: 3000, weightKg: 80, goal: 'maintain', trainingDays: 7 };
    const normal = LB.macroTargetsFromGoal(base);
    assert.strictEqual(normal.fatTraining, 83, '25% of intake without the option');
    // 0.6 g/kg x 80 kg = 48 g exactly, not "at most 48".
    const low = LB.macroTargetsFromGoal({ ...base, fatPerKg: 0.6 });
    assert.strictEqual(low.fatTraining, 48);
    assert.strictEqual(low.proteinTraining, normal.proteinTraining, 'protein is untouched by the fat option');
    // The 35 g of fat removed is 315 kcal, which is ~79 g of carbs.
    assert.strictEqual(low.carbsTraining - normal.carbsTraining, 79);
    assert.ok(Math.abs(low.caloriesTraining - normal.caloriesTraining) <= 3, 'same intake, different split');
    // A target in both directions: a factor above the normal split RAISES fat.
    assert.strictEqual(LB.macroTargetsFromGoal({ ...base, fatPerKg: 1.2 }).fatTraining, 96);
    // Under the floor it is still honoured, because the number came from the
    // user. Warning about it is the UI's job, not silently overruling them.
    assert.strictEqual(LB.FAT_FLOOR_PER_KG, 0.5);
    assert.strictEqual(LB.macroTargetsFromGoal({ ...base, fatPerKg: 0.3 }).fatTraining, 24);
    // The floor still governs the automatic split, where nobody asked for less.
    const lean = LB.macroTargetsFromGoal({ tdee: 1600, weightKg: 90, goal: 'cut', rateKgPerWeek: 1, trainingDays: 7 });
    assert.ok(lean.fatTraining >= Math.round(90 * LB.FAT_FLOOR_PER_KG));
  });

  test('estimateAdaptiveTdee: sign convention, losing weight implies a higher real TDEE than intake', () => {
    const days = [];
    for (let d = 1; d <= 14; d++) days.push({ date: `2025-01-${String(d).padStart(2, '0')}`, calories: 2000 });
    days[0].weight = 80;
    days[13].weight = 79;
    const r = LB.estimateAdaptiveTdee({ dailyLogs: days }, '2025-01-14');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.avgCalories, 2000);
    assert.strictEqual(r.weightChangeKg, -1);
    assert.strictEqual(r.daySpan, 13);
    // Burned more than eaten (lost weight), so real maintenance sits above intake.
    assert.strictEqual(r.tdee, 2592);
    assert.ok(r.tdee > r.avgCalories);
  });

  test('estimateAdaptiveTdee: mirror, gaining weight implies a lower real TDEE than intake', () => {
    const days = [];
    for (let d = 1; d <= 14; d++) days.push({ date: `2025-01-${String(d).padStart(2, '0')}`, calories: 2000 });
    days[0].weight = 79;
    days[13].weight = 80;
    const r = LB.estimateAdaptiveTdee({ dailyLogs: days }, '2025-01-14');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.weightChangeKg, 1);
    assert.strictEqual(r.tdee, 1408);
    assert.ok(r.tdee < r.avgCalories);
  });

  test('estimateAdaptiveTdee: insufficient data below every threshold', () => {
    const fullCalories = [];
    for (let d = 1; d <= 14; d++) fullCalories.push({ date: `2025-01-${String(d).padStart(2, '0')}`, calories: 2000 });

    // Too few days with calories logged (needs 5+), even with good weigh-ins.
    const fewCalorieDays = fullCalories.map((l, i) => {
      const base = i < 3 ? l : { ...l, calories: null };
      return i === 0 ? { ...base, weight: 80 } : i === 13 ? { ...base, weight: 79 } : base;
    });
    // LB.xxx return values come out of the vm sandbox in loadStore(), a
    // different realm than this file's own object literals, so compare via
    // JSON.stringify rather than assert.deepStrictEqual (same pattern as
    // estimateTdee/macroTargetsFromGoal's own comparisons above): deepStrictEqual
    // treats cross-realm plain objects as unequal despite identical own props.
    const insufficient = JSON.stringify({ ok: false, reason: 'insufficient_data' });
    assert.strictEqual(JSON.stringify(LB.estimateAdaptiveTdee({ dailyLogs: fewCalorieDays }, '2025-01-14')), insufficient);

    // Only one weigh-in (needs 2+).
    const oneWeighIn = fullCalories.map((l, i) => (i === 0 ? { ...l, weight: 80 } : l));
    assert.strictEqual(JSON.stringify(LB.estimateAdaptiveTdee({ dailyLogs: oneWeighIn }, '2025-01-14')), insufficient);

    // Two weigh-ins, but only 2 days apart (needs 5+ days span).
    const closeWeighIns = fullCalories.map((l, i) => (i === 0 ? { ...l, weight: 80 } : i === 2 ? { ...l, weight: 79.8 } : l));
    assert.strictEqual(JSON.stringify(LB.estimateAdaptiveTdee({ dailyLogs: closeWeighIns }, '2025-01-14')), insufficient);
  });

  test('estimateAdaptiveTdee: an odd weigh-in count drops the middle entry from both halves', () => {
    const days = [];
    for (let d = 1; d <= 14; d++) days.push({ date: `2025-01-${String(d).padStart(2, '0')}`, calories: 2000 });
    days[0].weight = 80;
    days[6].weight = 500; // wild outlier, must not survive into either half
    days[13].weight = 79;
    const r = LB.estimateAdaptiveTdee({ dailyLogs: days }, '2025-01-14');
    assert.strictEqual(r.ok, true);
    // Identical to the clean 2-weigh-in case above: the outlier never counted.
    assert.strictEqual(r.weightChangeKg, -1);
    assert.strictEqual(r.tdee, 2592);
  });

  test('estimateAdaptiveTdee: sick/vacation/deload days drop out of the calorie average entirely', () => {
    const days = [];
    for (let d = 1; d <= 14; d++) days.push({ date: `2025-01-${String(d).padStart(2, '0')}`, calories: 2000 });
    days[6].calories = 50; // 2025-01-07, barely ate while sick
    days[0].weight = 80;
    days[13].weight = 79;
    const state = {
      dailyLogs: days,
      statusPeriods: [{ mode: 'sick', startedAt: '2025-01-06T00:00:00.000Z', endedAt: '2025-01-08T00:00:00.000Z' }],
    };
    const r = LB.estimateAdaptiveTdee(state, '2025-01-14');
    assert.strictEqual(r.ok, true);
    // The sick day's 50kcal never enters the average, only the 13 normal days do.
    assert.strictEqual(r.avgCalories, 2000);
  });

  test('estimateAdaptiveTdee: today\'s own (still-partial) log never enters the calorie average', () => {
    const days = [];
    for (let d = 1; d <= 13; d++) days.push({ date: `2025-01-${String(d).padStart(2, '0')}`, calories: 2000 });
    // Today so far: only 200kcal logged, the day isn't over yet. Averaging
    // this in as if it were a complete day would drag avgCalories down to
    // ~1871, a fake "you're eating less" that has nothing to do with reality.
    days.push({ date: '2025-01-14', calories: 200, weight: 79 });
    days[0].weight = 80;
    const r = LB.estimateAdaptiveTdee({ dailyLogs: days }, '2025-01-14');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.avgCalories, 2000);
    // Today's weight, unlike its calories, is a complete reading the moment
    // it's logged and stays part of the trend: dropping it would throw away
    // real signal, not avoid a partial one.
    assert.strictEqual(r.weightChangeKg, -1);
  });

  test('adaptiveTdeeHistoryRow: preserves the estimate and weight signal for a dated point', () => {
    const days = [];
    for (let d = 1; d <= 14; d++) days.push({ date: `2025-01-${String(d).padStart(2, '0')}`, calories: 2000 });
    days[0].weight = 80;
    days[13].weight = 79;
    const row = LB.adaptiveTdeeHistoryRow({ dailyLogs: days }, 'user-1', '2025-01-14', {
      decision: 'applied',
      source: 'live',
      targetsSnapshot: { caloriesTraining: 2200 },
    });
    assert.ok(row);
    assert.strictEqual(row.id, 'tdee_user-1_2025-01-14');
    assert.strictEqual(row.tdee, 2592);
    assert.strictEqual(row.avgCalories, 2000);
    assert.strictEqual(row.weightStartKg, 80);
    assert.strictEqual(row.weightEndKg, 79);
    assert.strictEqual(row.weightChangeKg, -1);
    assert.strictEqual(row.daySpan, 13);
    assert.strictEqual(row.calorieDays, 13);
    assert.strictEqual(row.weighIns, 2);
    assert.strictEqual(row.decision, 'applied');
    assert.strictEqual(row.source, 'live');
    assert.strictEqual(row.targetsSnapshot.caloriesTraining, 2200);
  });

  test('reconstructAdaptiveTdeeHistory: uses only reliable macroCalc anchors', () => {
    const days = [];
    for (let d = 1; d <= 14; d++) days.push({ date: `2025-01-${String(d).padStart(2, '0')}`, calories: 2000 });
    days[0].weight = 80;
    days[13].weight = 79;
    const store = {
      dailyLogs: days,
      settings: { macroCalc: {
        lastCheckinAt: '2025-01-14',
        lastAppliedAt: '2025-01-14',
        trainingDays: 5,
        lastAppliedTargets: { caloriesTraining: 2200, caloriesRest: 1800 },
      } },
    };
    const rows = LB.reconstructAdaptiveTdeeHistory(store, 'user-1', [
      '2025-01-14',
      '2025-01-14',
      null,
    ]);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].decision, 'applied');
    assert.strictEqual(rows[0].source, 'reconstructed');
    assert.strictEqual(rows[0].targetsSnapshot.caloriesTraining, 2200);
    assert.strictEqual(rows[0].targetsSnapshot.weeklyAverageCalories, 2086);
    assert.strictEqual(rows[0].targetsSnapshot.deltaKcal, -506);
  });

  test('enrichAdaptiveTdeeHistoryTarget: repairs legacy snapshots without changing the decision', () => {
    const row = {
      asOfDate: '2025-01-14',
      tdee: 2592,
      source: 'live',
      decision: 'applied',
      targetsSnapshot: { caloriesTraining: 2200, caloriesRest: 1800 },
    };
    const enriched = LB.enrichAdaptiveTdeeHistoryTarget(row, { trainingDays: 5, goal: 'gain' });
    assert.strictEqual(enriched.source, 'live');
    assert.strictEqual(enriched.decision, 'applied');
    assert.strictEqual(enriched.targetsSnapshot.weeklyAverageCalories, 2086);
    assert.strictEqual(enriched.targetsSnapshot.deltaKcal, -506);
    assert.strictEqual(enriched.targetsSnapshot.trainingDays, 5);
    assert.strictEqual(enriched.targetsSnapshot.goal, 'gain');
  });

  test('mergeAdaptiveTdeeHistory: live decisions replace reconstructed rows for the same date', () => {
    const reconstructed = { asOfDate: '2025-01-14', source: 'reconstructed', decision: 'reconstructed', updatedAt: '2025-01-14T08:00:00.000Z' };
    const live = { asOfDate: '2025-01-14', source: 'live', decision: 'skipped', updatedAt: '2025-01-14T09:00:00.000Z' };
    const merged = LB.mergeAdaptiveTdeeHistory([reconstructed], [live]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0], live);
    assert.strictEqual(merged[0].decision, 'skipped');
  });

  test('mergeAdaptiveTdeeHistory: keeps richer target data on the live row', () => {
    const live = {
      asOfDate: '2025-01-14',
      source: 'live',
      decision: 'applied',
      targetsSnapshot: { caloriesTraining: 2200, caloriesRest: 1800 },
    };
    const repaired = {
      asOfDate: '2025-01-14',
      source: 'reconstructed',
      decision: 'applied',
      targetsSnapshot: { weeklyAverageCalories: 2086, deltaKcal: -506 },
    };
    const merged = LB.mergeAdaptiveTdeeHistory([live], [repaired]);
    assert.strictEqual(merged[0].source, 'live');
    assert.strictEqual(merged[0].decision, 'applied');
    assert.strictEqual(merged[0].targetsSnapshot.weeklyAverageCalories, 2086);
  });

  test('mergeAdaptiveTdeeHistory: keeps rich data when a newer live status is legacy-shaped', () => {
    const repaired = {
      asOfDate: '2025-01-14',
      source: 'reconstructed',
      decision: 'reconstructed',
      targetsSnapshot: { weeklyAverageCalories: 2086, deltaKcal: -506 },
    };
    const live = {
      asOfDate: '2025-01-14',
      source: 'live',
      decision: 'skipped',
      targetsSnapshot: { caloriesTraining: 2200, caloriesRest: 1800 },
    };
    const merged = LB.mergeAdaptiveTdeeHistory([repaired], [live]);
    assert.strictEqual(merged[0].source, 'live');
    assert.strictEqual(merged[0].decision, 'skipped');
    assert.strictEqual(merged[0].targetsSnapshot.weeklyAverageCalories, 2086);
  });

  test('weeklyAverageCalories: weights the two day types by how often they occur', () => {
    // 2 training at 4023 + 5 rest at 2743 = 21761 over the week, 3109 a day.
    assert.strictEqual(LB.weeklyAverageCalories(4023, 2743, 2), 3109);
    // The extremes are just the one day type, not a blend of both.
    assert.strictEqual(LB.weeklyAverageCalories(4023, 2743, 7), 4023);
    assert.strictEqual(LB.weeklyAverageCalories(4023, 2743, 0), 2743);
    // Day counts outside 0-7 are clamped rather than producing a figure that
    // silently assumes a longer week.
    assert.strictEqual(LB.weeklyAverageCalories(4023, 2743, 12), 4023);
    assert.strictEqual(LB.weeklyAverageCalories(4023, 2743, -3), 2743);
    // Missing calories read as zero instead of NaN.
    assert.strictEqual(LB.weeklyAverageCalories(null, 2743, 0), 2743);
    assert.strictEqual(LB.weeklyAverageCalories(2100, undefined, 7), 2100);

    // The property that makes the estimate coherent: an untouched estimate
    // averages back out to the intake it was built from, whatever the split.
    for (const days of [0, 1, 3, 4, 6, 7]) {
      const m = LB.macroTargetsFromGoal({ tdee: 3000, weightKg: 80, goal: 'maintain', trainingDays: days });
      const avg = LB.weeklyAverageCalories(m.caloriesTraining, m.caloriesRest, days);
      assert.ok(Math.abs(avg - 3000) < 20, `${days} training days averages ${avg}, near the 3000 it was built on`);
    }
    // And a cut lands the whole week below maintenance, not just its rest days.
    const cut = LB.macroTargetsFromGoal({ tdee: 3000, weightKg: 80, goal: 'cut', rateKgPerWeek: 0.5, trainingDays: 4 });
    const cutAvg = LB.weeklyAverageCalories(cut.caloriesTraining, cut.caloriesRest, 4);
    assert.ok(Math.abs((3000 - cutAvg) - 550) < 20, `averages ${cutAvg}, about 550 under maintenance`);
  });

  test('weeklyAverageMacros: same trainingDays-weighted blend as weeklyAverageCalories, per macro', () => {
    const training = { protein: 240, carbs: 605, fat: 60 };
    const rest = { protein: 240, carbs: 537, fat: 60 };
    // 2 training + 5 rest over the week: protein/fat are identical on both
    // sides so they pass through unchanged, only carbs actually blends.
    const week2 = LB.weeklyAverageMacros(training, rest, 2);
    assert.strictEqual(week2.protein, 240);
    assert.strictEqual(week2.fat, 60);
    assert.strictEqual(week2.carbs, Math.round((605 * 2 + 537 * 5) / 7));
    // The extremes are just the one day type. JSON.stringify, not
    // deepStrictEqual, see the cross-realm note on the insufficient-data
    // test above: LB return values come out of loadStore()'s vm sandbox.
    assert.strictEqual(JSON.stringify(LB.weeklyAverageMacros(training, rest, 7)), JSON.stringify(training));
    assert.strictEqual(JSON.stringify(LB.weeklyAverageMacros(training, rest, 0)), JSON.stringify(rest));
    // Missing macros read as zero instead of NaN, and a missing side object
    // doesn't throw.
    assert.strictEqual(JSON.stringify(LB.weeklyAverageMacros(null, rest, 0)), JSON.stringify(rest));
    assert.strictEqual(JSON.stringify(LB.weeklyAverageMacros(training, undefined, 7)), JSON.stringify(training));
  });

  test('rebalanceMacros: holds the calorie figure, others split proportionally', () => {
    // 160P / 400C / 80F = 640 + 1600 + 720 = 2960 kcal.
    const cur = { protein: 160, carbs: 400, fat: 80 };
    const target = LB.caloriesFromMacros(160, 400, 80);
    assert.strictEqual(target, 2960);
    // Raise protein by 40 g (160 kcal). Carbs and fat give that back in
    // proportion to what they carry (1600 vs 720 of 2320 kcal).
    const up = LB.rebalanceMacros(cur, 'protein', 200, { targetCalories: target });
    assert.strictEqual(up.protein, 200, 'the edited macro is left exactly as typed');
    assert.ok(up.carbs < 400 && up.fat < 80, 'both of the others move, not just one');
    // Tolerance covers rounding two macros to whole grams (up to ~6 kcal).
    assert.ok(Math.abs(LB.caloriesFromMacros(up.protein, up.carbs, up.fat) - target) <= 10, 'total holds');
    // Editing carbs moves protein and fat instead, same rule.
    const c = LB.rebalanceMacros(cur, 'carbs', 300, { targetCalories: target });
    assert.strictEqual(c.carbs, 300);
    assert.ok(c.protein > 160 && c.fat > 80);
    assert.ok(Math.abs(LB.caloriesFromMacros(c.protein, c.carbs, c.fat) - target) <= 10);
    // Without a target nothing rebalances, the edit just lands.
    const raw = LB.rebalanceMacros(cur, 'fat', 60, {});
    assert.strictEqual(JSON.stringify(raw), JSON.stringify({ protein: 160, carbs: 400, fat: 60 }));
  });

  test('rebalanceMacros: the low-fat target holds fat like a lock', () => {
    const cur = { protein: 160, carbs: 400, fat: 80 };
    const target = LB.caloriesFromMacros(160, 400, 80);
    const lowFat = { targetCalories: target, weightKg: 80, fatPerKg: 0.6 }; // 48 g
    // Editing protein puts fat ON the target and hands the whole remainder to
    // carbs, even though fat started well above it.
    const out = LB.rebalanceMacros(cur, 'protein', 120, lowFat);
    assert.strictEqual(out.protein, 120);
    assert.strictEqual(out.fat, 48, 'derived fat lands on the target, not merely under a cap');
    assert.ok(Math.abs(LB.caloriesFromMacros(out.protein, out.carbs, out.fat) - target) <= 10);
    // A target in both directions: fat starting below it is raised to meet it.
    const upward = LB.rebalanceMacros({ protein: 160, carbs: 500, fat: 20 }, 'protein', 160, lowFat);
    assert.strictEqual(upward.fat, 48);
    // Editing carbs sends the rest to protein, the only macro still free.
    const c = LB.rebalanceMacros(cur, 'carbs', 300, lowFat);
    assert.strictEqual(c.carbs, 300, 'the edit is never quietly undone');
    assert.strictEqual(c.fat, 48);
    assert.ok(c.protein > 160);
    // Typing a fat value wins over the target: both are explicit choices.
    assert.strictEqual(LB.rebalanceMacros(cur, 'fat', 90, lowFat).fat, 90);
    // So does locking fat by hand.
    assert.strictEqual(LB.rebalanceMacros(cur, 'protein', 120, { ...lowFat, locked: ['fat'] }).fat, 80);
  });

  test('rebalanceMacros: a locked macro never moves', () => {
    const cur = { protein: 160, carbs: 400, fat: 80 };
    const target = LB.caloriesFromMacros(160, 400, 80);
    // Lock protein, edit fat: only carbs may absorb.
    const a = LB.rebalanceMacros(cur, 'fat', 60, { targetCalories: target, locked: ['protein'] });
    assert.strictEqual(a.protein, 160, 'locked');
    assert.strictEqual(a.fat, 60);
    assert.ok(a.carbs > 400, 'carbs took the whole difference');
    assert.ok(Math.abs(LB.caloriesFromMacros(a.protein, a.carbs, a.fat) - target) <= 10);
    // Lock both others and the edit simply stands: the calorie total moves with
    // it, which the caller shows because it derives kcal from the macros.
    const b = LB.rebalanceMacros(cur, 'protein', 200, { targetCalories: target, locked: ['carbs', 'fat'] });
    assert.strictEqual(JSON.stringify(b), JSON.stringify({ protein: 200, carbs: 400, fat: 80 }));
    // Locking the macro being edited does not block the edit itself.
    const d = LB.rebalanceMacros(cur, 'protein', 200, { targetCalories: target, locked: ['protein'] });
    assert.strictEqual(d.protein, 200);
    assert.ok(d.carbs < 400 && d.fat < 80);
  });

  test('rebalanceMacros: replaying pins one at a time restores all of them', () => {
    // The exact move MacroEstimatorSheet makes when an input changes while
    // macros are pinned: rebuild from the new estimate, then re-apply each pin
    // in turn holding the others, so every pinned macro lands back on its own
    // value and only the free ones absorb the difference.
    const pinnedValues = { protein: 200, fat: 60 };
    const replay = (estimate, target) => {
      const pins = Object.keys(pinnedValues);
      return pins.reduce((day, k) => LB.rebalanceMacros(day, k, pinnedValues[k], {
        targetCalories: target, locked: pins.filter(o => o !== k),
      }), estimate);
    };

    const target = 3000;
    const out = replay({ protein: 160, carbs: 400, fat: 80 }, target);
    assert.strictEqual(out.protein, 200, 'first pin survived the second pass');
    assert.strictEqual(out.fat, 60, 'second pin applied');
    assert.ok(Math.abs(LB.caloriesFromMacros(out.protein, out.carbs, out.fat) - target) <= 10,
      'carbs, the only free macro, absorbed the rest');

    // A different starting estimate lands on the same pins with different
    // carbs, which is the whole point: the pinned numbers do not drift.
    const other = replay({ protein: 140, carbs: 300, fat: 100 }, 2600);
    assert.strictEqual(other.protein, 200);
    assert.strictEqual(other.fat, 60);
    assert.ok(other.carbs < out.carbs, 'the smaller day gets fewer carbs, not less protein');

    // Pinning everything means the calories cannot be held, and honestly are
    // not: nothing is left to absorb, so the pins simply stand.
    const allPinned = ['protein', 'carbs', 'fat'].reduce(
      (day, k) => LB.rebalanceMacros(day, k, { protein: 200, carbs: 100, fat: 60 }[k], {
        targetCalories: target, locked: ['protein', 'carbs', 'fat'].filter(o => o !== k),
      }), { protein: 160, carbs: 400, fat: 80 });
    assert.strictEqual(JSON.stringify(allPinned), JSON.stringify({ protein: 200, carbs: 100, fat: 60 }));
  });

  test('rebalanceMacros: guards against negatives and nonsense input', () => {
    const cur = { protein: 160, carbs: 400, fat: 80 };
    const target = 2960;
    // A macro big enough to blow the whole budget zeroes the others rather
    // than going negative. Calories then exceed the target, which the caller
    // shows honestly because it derives kcal from the macros.
    const huge = LB.rebalanceMacros(cur, 'protein', 900, { targetCalories: target });
    assert.strictEqual(huge.protein, 900);
    assert.strictEqual(huge.carbs, 0);
    assert.strictEqual(huge.fat, 0);
    // Negative and non-numeric edits are read as zero.
    assert.strictEqual(LB.rebalanceMacros(cur, 'protein', -50, { targetCalories: target }).protein, 0);
    assert.strictEqual(LB.rebalanceMacros(cur, 'protein', 'abc', { targetCalories: target }).protein, 0);
    // An unknown key is a no-op rather than a crash.
    assert.strictEqual(JSON.stringify(LB.rebalanceMacros(cur, 'sugar', 10, { targetCalories: target })), JSON.stringify(cur));
    // Both others at zero: the remainder splits evenly instead of dividing by zero.
    const even = LB.rebalanceMacros({ protein: 100, carbs: 0, fat: 0 }, 'protein', 50, { targetCalories: 1000 });
    assert.ok(even.carbs > 0 && even.fat > 0);
  });

  test('macroTargetsFromGoal: proteinPerKg is overridable, defaults to 2 g/kg', () => {
    const d = LB.macroTargetsFromGoal({ tdee: 2500, weightKg: 90, goal: 'maintain', trainingDays: 4 });
    assert.strictEqual(d.proteinTraining, 180);
    const hi = LB.macroTargetsFromGoal({ tdee: 2500, weightKg: 90, goal: 'maintain', trainingDays: 4, proteinPerKg: 2.5 });
    assert.strictEqual(hi.proteinTraining, 225);
    assert.ok(hi.carbsTraining < d.carbsTraining, 'the extra protein comes out of carbs, not out of thin air');
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

  test('dailyLogAdherence: a meal-of-choice day scores null but keeps its snapshot', () => {
    const log = { protein: 200, carbs: 250, fat: 70 };
    // Same log, same targets: only the flag differs.
    assert.strictEqual(LB.dailyLogAdherence(log, MACROS, true).adherence, 100);
    const moc = LB.dailyLogAdherence({ ...log, mealOfChoice: true }, MACROS, true);
    assert.strictEqual(moc.adherence, null, 'unscored');
    // The snapshot must SURVIVE, unlike a status day: a flex plan reads the day
    // type back out of it, so nulling it would silently flip the day to rest.
    assert.strictEqual(
      JSON.stringify(moc.targetsSnap),
      JSON.stringify({ protein: 200, carbs: 250, fat: 70, calories: 2430, dayType: 'training' }));
    // Rest day keeps its own snapshot the same way.
    assert.strictEqual(LB.dailyLogAdherence({ ...log, mealOfChoice: true }, MACROS, false).targetsSnap.dayType, 'rest');
    // A day that was already off target is equally unscored, not "bad".
    assert.strictEqual(LB.dailyLogAdherence({ protein: 10, carbs: 900, fat: 200, mealOfChoice: true }, MACROS, true).adherence, null);
    // No targets at all still wins over the flag: nothing to snapshot either.
    const noT = LB.dailyLogAdherence({ ...log, mealOfChoice: true }, null, true);
    assert.strictEqual(noT.adherence, null); assert.strictEqual(noT.targetsSnap, null);
  });

  test('mealOfChoiceRemainder: what is left to spend, floored at zero', () => {
    const target = { protein: 200, carbs: 400, fat: 70, calories: 3030 };
    const r = LB.mealOfChoiceRemainder(target, { protein: 150, carbs: 120, fat: 30 });
    assert.strictEqual(JSON.stringify(r), JSON.stringify({ protein: 50, carbs: 280, fat: 40, calories: 1680 }));
    // Calories are DERIVED from the clamped macros, never target minus actual:
    // 50*4 + 280*4 + 40*9 = 1680, which is what the entry gets written with.
    assert.strictEqual(r.calories, LB.caloriesFromMacros(r.protein, r.carbs, r.fat));
    // Already over on one macro clamps that one to 0 without going negative,
    // and without stealing calories from the others.
    const over = LB.mealOfChoiceRemainder(target, { protein: 260, carbs: 100, fat: 10 });
    assert.strictEqual(over.protein, 0);
    assert.strictEqual(over.carbs, 300);
    assert.strictEqual(over.calories, LB.caloriesFromMacros(0, 300, 60));
    // An untouched day leaves the whole target.
    const empty = LB.mealOfChoiceRemainder(target, { protein: 0, carbs: 0, fat: 0 });
    assert.strictEqual(JSON.stringify({ p: empty.protein, c: empty.carbs, f: empty.fat }), JSON.stringify({ p: 200, c: 400, f: 70 }));
    // No target, nothing to spend.
    assert.strictEqual(LB.mealOfChoiceRemainder(null, { protein: 10, carbs: 10, fat: 10 }), null);
  });

  test('mealOfChoiceWeekCount: Monday-anchored, ordinal by date', () => {
    // 2026-07-20 is a Monday, 2026-07-26 the Sunday that closes that week.
    const logs = [
      { date: '2026-07-19', mealOfChoice: true },  // Sunday BEFORE, previous week
      { date: '2026-07-22', mealOfChoice: true },
      { date: '2026-07-25', mealOfChoice: false }, // marked-false must not count
      { date: '2026-07-26', mealOfChoice: true },  // Sunday, still this week
      { date: '2026-07-27', mealOfChoice: true },  // next Monday, next week
    ];
    const wed = LB.mealOfChoiceWeekCount(logs, '2026-07-22');
    assert.strictEqual(wed.weekStart, '2026-07-20');
    assert.strictEqual(wed.count, 2);
    assert.strictEqual(wed.ordinal, 1);
    // Sunday belongs to the week that STARTED six days earlier, not the next one.
    const sun = LB.mealOfChoiceWeekCount(logs, '2026-07-26');
    assert.strictEqual(sun.weekStart, '2026-07-20');
    assert.strictEqual(sun.ordinal, 2, 'second of that week');
    // A date inside the week that is not itself marked has no ordinal.
    const thu = LB.mealOfChoiceWeekCount(logs, '2026-07-23');
    assert.strictEqual(thu.count, 2); assert.strictEqual(thu.ordinal, null);
    // The next Monday opens a fresh week.
    assert.strictEqual(LB.mealOfChoiceWeekCount(logs, '2026-07-27').weekStart, '2026-07-27');
    assert.strictEqual(LB.mealOfChoiceWeekCount(logs, '2026-07-27').count, 1);
    assert.strictEqual(LB.mealOfChoiceWeekCount([], '2026-07-22').count, 0);
  });

  test('withMealOfChoiceNote: owns one line, never the user\'s text', () => {
    // Empty note gets just the line.
    assert.strictEqual(LB.withMealOfChoiceNote(null, 'Pizza'), 'Meal of choice: Pizza');
    // Existing text is preserved and stays put; ours is appended.
    const withUser = LB.withMealOfChoiceNote('Slept badly\nSore knee', 'Pizza');
    assert.strictEqual(withUser, 'Slept badly\nSore knee\nMeal of choice: Pizza');
    // Rename replaces IN PLACE, so the user's lines never shuffle.
    const mid = LB.withMealOfChoiceNote('before\nMeal of choice: Pizza\nafter', 'Burger');
    assert.strictEqual(mid, 'before\nMeal of choice: Burger\nafter');
    // Idempotent: setting the same name twice must not duplicate the line.
    assert.strictEqual(LB.withMealOfChoiceNote(withUser, 'Pizza'), withUser);
    // No name still tells the coach what happened.
    assert.strictEqual(LB.withMealOfChoiceNote(null, ''), 'Meal of choice');
    // Clearing removes only our line, and returns null once nothing is left
    // (matching the offPlanNote.trim() || null convention at save time).
    assert.strictEqual(LB.withMealOfChoiceNote(mid, null), 'before\nafter');
    assert.strictEqual(LB.withMealOfChoiceNote('Meal of choice: Pizza', null), null);
    // An unrelated note is untouched by a clear.
    assert.strictEqual(LB.withMealOfChoiceNote('Birthday cake', null), 'Birthday cake');
    // Reading the name back, and degrading gracefully once it is hand-edited away.
    assert.strictEqual(LB.mealOfChoiceNoteName(withUser), 'Pizza');
    assert.strictEqual(LB.mealOfChoiceNoteName('Meal of choice'), null);
    assert.strictEqual(LB.mealOfChoiceNoteName('Slept badly'), null);
  });

  test('statusModeForDate: cache for today, intervals for everything else', () => {
    const today = LB.todayISO();
    const state = {
      statusMode: 'sick',
      statusPeriods: [
        { mode: 'vacation', startedAt: '2026-06-01T00:00:00.000Z', endedAt: '2026-06-09T00:00:00.000Z' },
        { mode: 'deload', startedAt: '2026-05-01T00:00:00.000Z', endedAt: null },
      ],
    };
    // Today answers from the live cache: an optimistic period row may not have
    // landed yet, which is why the inline copies short-circuit the same way.
    assert.strictEqual(LB.statusModeForDate(state, today), 'sick');
    assert.strictEqual(LB.statusModeForDate({ ...state, statusMode: null }, today), null);
    // A past date inside a closed period reports that period's mode.
    assert.strictEqual(LB.statusModeForDate(state, '2026-06-05'), 'vacation');
    // Outside every period, nothing.
    assert.strictEqual(LB.statusModeForDate(state, '2026-04-01'), null);
    // An open period covers every date from its start onwards.
    assert.strictEqual(LB.statusModeForDate({ statusPeriods: [state.statusPeriods[1]] }, '2026-05-20'), 'deload');
    assert.strictEqual(LB.statusModeForDate({ statusPeriods: [] }, '2026-05-20'), null);
    assert.strictEqual(LB.statusModeForDate(state, null), null);
  });

  test('isNutritionUnscoredMode: only sick and vacation blank a day', () => {
    // Being ill or away is an exceptional state for eating, so the day carries
    // no meaningful score. A deload or cleanup week only modulates TRAINING
    // load: the macro targets are unchanged and the day is scored like any
    // other. Treating all four alike blanked adherence for whole deload and
    // cleanup weeks, in the card, the coach view, the check-in prefill and the
    // adherence trend.
    assert.strictEqual(LB.isNutritionUnscoredMode('sick'), true);
    assert.strictEqual(LB.isNutritionUnscoredMode('vacation'), true);
    assert.strictEqual(LB.isNutritionUnscoredMode('deload'), false);
    assert.strictEqual(LB.isNutritionUnscoredMode('cleanup'), false);
    // No status at all is not "unscored", it is an ordinary day.
    assert.strictEqual(LB.isNutritionUnscoredMode(null), false);
    assert.strictEqual(LB.isNutritionUnscoredMode(undefined), false);
    assert.strictEqual(LB.isNutritionUnscoredMode(''), false);
    // A mode nobody has taught it about must NOT inherit the blanking.
    assert.strictEqual(LB.isNutritionUnscoredMode('taper'), false);
  });

  test('isRoutineDisruptedMode: only sick and vacation leave the trend', () => {
    // Gates the adaptive-TDEE window and the daily summary's weight trend.
    // Illness and travel distort intake and scale weight at once. A deload or
    // cleanup week does not: the training calories at stake are smaller than a
    // fortnight of weigh-in noise, the eating is unchanged, and excluding them
    // cut the 14-day window to 7, one step above the 5-day minimum.
    assert.strictEqual(LB.isRoutineDisruptedMode('sick'), true);
    assert.strictEqual(LB.isRoutineDisruptedMode('vacation'), true);
    assert.strictEqual(LB.isRoutineDisruptedMode('deload'), false);
    assert.strictEqual(LB.isRoutineDisruptedMode('cleanup'), false);
    assert.strictEqual(LB.isRoutineDisruptedMode(null), false);
    assert.strictEqual(LB.isRoutineDisruptedMode('taper'), false);
  });

  test('the two status predicates stay separate functions', () => {
    // They read the same today and answer different questions: one asks
    // whether a macro score means anything, the other whether a weigh-in can
    // be trusted. A later mode can land differently on the two (a peak week
    // scores fine and weighs terribly), so this pins that they are two
    // decisions, not one shared list behind two names.
    assert.notStrictEqual(LB.isNutritionUnscoredMode, LB.isRoutineDisruptedMode);
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
      // today's log (outside the reported week), weight_today reads from here
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

  test('dailyLogsWeekPrefill: excludes today from nutrition/adherence averages', () => {
    // Today is still accumulating (dailyLogAdherence scores whatever's logged
    // so far against the full day's target), so it must never be averaged in
    // alongside genuinely finished days, that would drag calories_avg/
    // macro_adherence toward "under target" on a week that wasn't. weekStart
    // is placed 3 days before today so today always lands mid-week no matter
    // which real weekday the test happens to run on.
    const today = LB.todayISO();
    const shift = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    const weekStart = shift(today, -3);
    const logs = [
      { date: weekStart, calories: 2000, protein: 180, carbs: 200, fat: 60, adherence: 100 },
      { date: shift(weekStart, 1), calories: 2000, protein: 180, carbs: 200, fat: 60, adherence: 100 },
      // Only breakfast logged so far today, a naive average would read this
      // as a bad day instead of an unfinished one.
      { date: today, calories: 400, protein: 30, carbs: 40, fat: 10, adherence: 20 },
    ];
    const p = LB.dailyLogsWeekPrefill(logs, weekStart);
    assert.strictEqual(p.calories_avg, 2000);   // not (2000+2000+400)/3
    assert.strictEqual(p.protein_avg, 180);
    assert.strictEqual(p.macro_adherence, 100); // not (100+100+20)/3
    assert.strictEqual(p.count, 3);             // today still counts as a logged day
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
      wpSession('2026-06-11', [wpSet(112, 5)]), // later same week, must NOT compare to Jun 9
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

  test('pickGrowthRecipient: no ceiling, a single exercise keeps winning no matter how many grants it already has', () => {
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

  test('pickGrowthRecipient: no ceiling, fewest grants still wins even against a much larger gap', () => {
    // b has 20 prior grants, a has 3, no ceiling excludes b from eligibility
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

  // ── normalizeHiddenHealthCards (macros/adherence merged into macroGroup) ──
  test('normalizeHiddenHealthCards: pre-merge ids map to macroGroup', () => {
    assert.strictEqual(JSON.stringify(LB.normalizeHiddenHealthCards(['macros'])), '["macroGroup"]');
    assert.strictEqual(JSON.stringify(LB.normalizeHiddenHealthCards(['adherence'])), '["macroGroup"]');
  });
  test('normalizeHiddenHealthCards: both old ids collapse to one entry, no duplicate', () => {
    assert.strictEqual(JSON.stringify(LB.normalizeHiddenHealthCards(['macros', 'adherence'])), '["macroGroup"]');
  });
  test('normalizeHiddenHealthCards: other ids and an already-migrated macroGroup pass through untouched', () => {
    assert.strictEqual(JSON.stringify(LB.normalizeHiddenHealthCards(['weight', 'macroGroup', 'steps'])), '["weight","macroGroup","steps"]');
  });
  test('normalizeHiddenHealthCards: null/undefined/empty inputs are safe', () => {
    assert.strictEqual(LB.normalizeHiddenHealthCards(null), null);
    assert.strictEqual(LB.normalizeHiddenHealthCards(undefined), null);
    assert.strictEqual(JSON.stringify(LB.normalizeHiddenHealthCards([])), '[]');
  });

  // ── clearMesoWeightBoostDeclines (a decline never outlives the session that set it) ──
  test('clearMesoWeightBoostDeclines: a declined key re-earned/re-evaluated this session is cleared', () => {
    const out = LB.clearMesoWeightBoostDeclines({ bench_d1: true }, ['bench_d1']);
    assert.ok(!('bench_d1' in out), 'stale decline must be removed');
  });
  test('clearMesoWeightBoostDeclines: a key not touched this session keeps its decline', () => {
    const out = LB.clearMesoWeightBoostDeclines({ bench_d1: true, squat_d2: true }, ['bench_d1']);
    assert.ok(!('bench_d1' in out), 'this session\'s key cleared');
    assert.strictEqual(out.squat_d2, true, 'other day\'s decline untouched');
  });
  test('clearMesoWeightBoostDeclines: nothing to clear returns the same reference', () => {
    const prev = { squat_d2: true };
    assert.strictEqual(LB.clearMesoWeightBoostDeclines(prev, ['bench_d1']), prev, 'no-op keeps identity');
  });
  test('clearMesoWeightBoostDeclines: null/empty inputs are safe', () => {
    assert.strictEqual(JSON.stringify(LB.clearMesoWeightBoostDeclines(null, [])), '{}');
    assert.strictEqual(JSON.stringify(LB.clearMesoWeightBoostDeclines(undefined, undefined)), '{}');
  });

  // ── revertMesoSessionBoosts (delete a meso session → restore what it overwrote) ──
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
  test('revertMesoSessionBoosts: an OLDER same-day session with no recap degrades to a plain clear', () => {
    const older = { id: 'Z', dayId: 'd1', ended: '2026-07-14T10:00:00Z', entries: [{ exId: 'tri' }] };
    const out = LB.revertMesoSessionBoosts(mesoStateWB, delSess, [older]);
    assert.ok(!('tri_d1' in out.weightBoosts), 'no recap to restore from → same as before this logic existed');
  });
  test('revertMesoSessionBoosts: restores the weight boost the prior same-exercise session had earned', () => {
    // delSess itself currently owns a DIFFERENT value (-2.5, e.g. a cut it applied);
    // the older session (before delSess) had earned +5 for the same key. Deleting
    // delSess must bring back the older session's own +5, not just clear to nothing
    // and not leave delSess's own -2.5 in place.
    const st = { weightBoosts: { tri_d1: -2.5 }, repMissCounts: {} };
    const older = {
      id: 'Z', dayId: 'd1', ended: '2026-07-08T10:00:00Z', entries: [{ exId: 'tri' }],
      mesoRecap: { gains: [{ name: 'Tri', key: 'tri_d1', weightDelta: 5, setDelta: 0 }] },
    };
    const out = LB.revertMesoSessionBoosts(st, delSess, [older]);
    assert.strictEqual(out.weightBoosts.tri_d1, 5, 'restored to the older session\'s own earned boost');
  });
  test('revertMesoSessionBoosts: falls back to matching by name when the prior recap predates the `key` field', () => {
    // Real production shape from before the 2026-07-19 change that started
    // carrying `key` through mesoRecap.gains: rows only had name/weightDelta/
    // setDelta. Restoring from a session finished before that date must still
    // work, matched by the name the prior session's own entry used for this exId.
    const st = { weightBoosts: { tri_d1: -2.5 }, repMissCounts: {} };
    const older = {
      id: 'Z', dayId: 'd1', ended: '2026-07-08T10:00:00Z', entries: [{ exId: 'tri', name: 'Triceps Pushdown' }],
      mesoRecap: { gains: [{ name: 'Triceps Pushdown', weightDelta: 5, setDelta: 0 }] }, // no `key`
    };
    const out = LB.revertMesoSessionBoosts(st, delSess, [older]);
    assert.strictEqual(out.weightBoosts.tri_d1, 5, 'restored via the name fallback, not silently cleared');
  });
  test('revertMesoSessionBoosts: an older session whose recap has no weightDelta for the key still clears', () => {
    const st = { weightBoosts: { tri_d1: 2.5 }, repMissCounts: {} };
    const older = {
      id: 'Z', dayId: 'd1', ended: '2026-07-08T10:00:00Z', entries: [{ exId: 'tri' }],
      mesoRecap: { gains: [{ name: 'Tri', key: 'tri_d1', weightDelta: 0, setDelta: 1 }] }, // set-gain only, no boost
    };
    const out = LB.revertMesoSessionBoosts(st, delSess, [older]);
    assert.ok(!('tri_d1' in out.weightBoosts), 'older session earned no boost for this key either → clear');
  });
  test('revertMesoSessionBoosts: a same-day session further back is not picked over the nearer one', () => {
    const st = { weightBoosts: { tri_d1: -2.5 }, repMissCounts: {} };
    const nearer = {
      id: 'Y', dayId: 'd1', ended: '2026-07-08T10:00:00Z', entries: [{ exId: 'tri' }],
      mesoRecap: { gains: [{ key: 'tri_d1', weightDelta: 2.5, setDelta: 0 }] },
    };
    const further = {
      id: 'X', dayId: 'd1', ended: '2026-07-01T10:00:00Z', entries: [{ exId: 'tri' }],
      mesoRecap: { gains: [{ key: 'tri_d1', weightDelta: 7.5, setDelta: 0 }] },
    };
    const out = LB.revertMesoSessionBoosts(st, delSess, [nearer, further]);
    assert.strictEqual(out.weightBoosts.tri_d1, 2.5, 'restores from the NEAREST earlier session, not an older one further back');
  });
  test('revertMesoSessionBoosts: restores repMissCounts from the deleted session\'s own pre-finish snapshot', () => {
    const st = { weightBoosts: {}, repMissCounts: { tri_d1: 0 } }; // delSess's own finish reset it to 0
    const sess = {
      id: 'A', dayId: 'd1', ended: '2026-07-15T10:00:00Z', entries: [{ exId: 'tri' }],
      mesoRecap: { raw: { repMissBase: { tri_d1: 1 } } }, // pre-finish streak was 1
    };
    const out = LB.revertMesoSessionBoosts(st, sess, []);
    assert.strictEqual(out.repMissCounts.tri_d1, 1, 'restored to the pre-session streak, not dropped to absent');
  });
  test('revertMesoSessionBoosts: repMissCounts falls back to a plain clear without a repMissBase snapshot', () => {
    const out = LB.revertMesoSessionBoosts(mesoStateWB, delSess, []);
    assert.ok(!('tri_d1' in out.repMissCounts), 'delSess carries no mesoRecap → same as before this logic existed');
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

  // ── remapMesoAnswersExId (swap-correction moves the joint record identity, #1) ──
  {
    const answers = {
      soreness: { chest: { muscle: 'chest', targets: [{ exId: 'A', name: 'Bench', key: 'A_d0' }], answer: 'still_sore', contrib: { A_d0: -1 } } },
      joint: { A: { exId: 'A', exName: 'Bench', answer: 'sharp', pump: 'low', weight: 'ok', contrib: { A_d0: -1 } } },
      volume: { chest: { muscle: 'chest', exIds: ['A', 'e2'], volume: 'not_enough', contrib: { A_d0: 1 } } },
    };
    test('remapMesoAnswersExId: moves the joint record identity to the new exId', () => {
      const out = LB.remapMesoAnswersExId(answers, 'A', 'B', 'Incline Bench');
      assert.ok(!('A' in out.joint), 'old joint key removed');
      assert.strictEqual(out.joint.B.exId, 'B');
      assert.strictEqual(out.joint.B.exName, 'Incline Bench');
      assert.strictEqual(out.joint.B.answer, 'sharp');
      assert.strictEqual(out.joint.B.pump, 'low');
      assert.strictEqual(out.joint.B.weight, 'ok');
    });
    test('remapMesoAnswersExId: KEEPS the joint contrib under the old key (deltas stay in sync)', () => {
      const out = LB.remapMesoAnswersExId(answers, 'A', 'B', 'Incline Bench');
      assert.strictEqual(out.joint.B.contrib.A_d0, -1, 'contrib key left under the old exId_dayId');
      assert.ok(!('B_d0' in out.joint.B.contrib), 'contrib NOT re-keyed to the new exId');
    });
    test('remapMesoAnswersExId: leaves soreness + volume entirely untouched', () => {
      const out = LB.remapMesoAnswersExId(answers, 'A', 'B', 'Incline Bench');
      assert.strictEqual(out.soreness, answers.soreness, 'soreness object identity preserved');
      assert.strictEqual(out.volume, answers.volume, 'volume object identity preserved');
    });
    test('remapMesoAnswersExId: no-op returns the same ref (absent / same id / target exists)', () => {
      assert.strictEqual(LB.remapMesoAnswersExId(answers, 'ZZZ', 'B', 'X'), answers);
      assert.strictEqual(LB.remapMesoAnswersExId(answers, 'A', 'A', 'X'), answers);
      const withB = { joint: { A: { exId: 'A' }, B: { exId: 'B', exName: 'keep' } } };
      const out = LB.remapMesoAnswersExId(withB, 'A', 'B', 'X');
      assert.strictEqual(out, withB, 'does not clobber an existing target record');
      assert.strictEqual(withB.joint.B.exName, 'keep');
    });
    test('remapMesoAnswersExId: does not mutate the input', () => {
      const snapshot = JSON.stringify(answers);
      LB.remapMesoAnswersExId(answers, 'A', 'B', 'Incline Bench');
      assert.strictEqual(JSON.stringify(answers), snapshot, 'input answers untouched');
    });
  }

  // ── deriveSignalWeight (#D, shared live/edit signal-hygiene) ──
  test('deriveSignalWeight: active deload -> none (ignores stamped value)', () => {
    assert.strictEqual(LB.deriveSignalWeight({ signalWeight: 'full', readiness: 'normal' }, true), 'none');
  });
  test('deriveSignalWeight: a stamped non-none value is preserved', () => {
    assert.strictEqual(LB.deriveSignalWeight({ signalWeight: 'discounted', readiness: 'rough' }, false), 'discounted');
  });
  test('deriveSignalWeight: stale none (deload ended) re-derives from readiness', () => {
    assert.strictEqual(LB.deriveSignalWeight({ signalWeight: 'none', readiness: 'normal' }, false), 'full');
    assert.strictEqual(LB.deriveSignalWeight({ signalWeight: 'none', readiness: 'rough' }, false), 'discounted');
    assert.strictEqual(LB.deriveSignalWeight({ signalWeight: 'none', readiness: 'reentry' }, false), 'discounted');
  });
  test('deriveSignalWeight: no signalWeight derives from readiness', () => {
    assert.strictEqual(LB.deriveSignalWeight({ readiness: 'normal' }, false), 'full');
    assert.strictEqual(LB.deriveSignalWeight({ readiness: 'rough' }, false), 'discounted');
  });

  // ── remapMesoStateExId / mesoRowHasExId / laterSessionTrainsExId (#E full swap re-key) ──
  {
    const ms = () => ({
      weightBoosts: { A_d0: 2.5, X_d0: 5 }, repMissCounts: { A_d0: 1 },
      deltas: { A_d0: 1, Y_d0: -1 }, growthCounts: { A_d0: 3 },
      jointFlags: { A: true }, pumpLowCounts: { A: 2 }, affinity: { A: { v: 'dislike', streak: 1 } },
    });
    test('remapMesoStateExId: moves exId_dayId levers A_d0->B_d0 and bare-exId levers A->B', () => {
      const out = LB.remapMesoStateExId(ms(), 'A', 'B', 'd0');
      assert.strictEqual(out.weightBoosts.B_d0, 2.5); assert.ok(!('A_d0' in out.weightBoosts));
      assert.strictEqual(out.weightBoosts.X_d0, 5, 'unrelated key kept');
      assert.strictEqual(out.repMissCounts.B_d0, 1);
      assert.strictEqual(out.deltas.B_d0, 1); assert.strictEqual(out.deltas.Y_d0, -1);
      assert.strictEqual(out.growthCounts.B_d0, 3);
      assert.strictEqual(out.jointFlags.B, true); assert.ok(!('A' in out.jointFlags));
      assert.strictEqual(out.pumpLowCounts.B, 2);
      assert.deepStrictEqual(out.affinity.B, { v: 'dislike', streak: 1 });
    });
    test('remapMesoStateExId: never clobbers an existing target lever', () => {
      const out = LB.remapMesoStateExId({ weightBoosts: { A_d0: 2.5, B_d0: 7 } }, 'A', 'B', 'd0');
      assert.strictEqual(out.weightBoosts.B_d0, 7, 'existing B kept');
      assert.strictEqual(out.weightBoosts.A_d0, 2.5, 'A left in place (not clobbered)');
    });
    test('remapMesoStateExId: no-op returns same ref, does not mutate', () => {
      const s = ms(); const snap = JSON.stringify(s);
      assert.strictEqual(LB.remapMesoStateExId(s, 'Z', 'B', 'd0'), s);
      assert.strictEqual(LB.remapMesoStateExId(s, 'A', 'A', 'd0'), s);
      LB.remapMesoStateExId(s, 'A', 'B', 'd0');
      assert.strictEqual(JSON.stringify(s), snap, 'input untouched');
    });
    test('mesoRowHasExId: true when the new exId owns any lever', () => {
      assert.strictEqual(LB.mesoRowHasExId({ weightBoosts: { B_d0: 5 } }, 'B', 'd0'), true);
      assert.strictEqual(LB.mesoRowHasExId({ jointFlags: { B: true } }, 'B', 'd0'), true);
      assert.strictEqual(LB.mesoRowHasExId({ weightBoosts: { C_d0: 5 } }, 'B', 'd0'), false);
      assert.strictEqual(LB.mesoRowHasExId(null, 'B', 'd0'), false);
    });
    test('laterSessionTrainsExId: owner test mirrors revertMesoSessionBoosts.retrainedLater', () => {
      const later = { id: 'L', ended: '2026-07-17T10:00:00Z', dayId: 'd0', scheduleId: 'p', entries: [{ exId: 'A' }] };
      assert.strictEqual(LB.laterSessionTrainsExId([later], 'A', 'd0', '2026-07-10T00:00:00Z', 'S', 'p'), true);
      assert.strictEqual(LB.laterSessionTrainsExId([{ ...later, dayId: 'd1' }], 'A', 'd0', '2026-07-10T00:00:00Z', 'S', 'p'), false, 'diff day');
      assert.strictEqual(LB.laterSessionTrainsExId([{ ...later, scheduleId: 'q' }], 'A', 'd0', '2026-07-10T00:00:00Z', 'S', 'p'), false, 'diff plan');
      assert.strictEqual(LB.laterSessionTrainsExId([{ ...later, entries: [{ exId: 'Z' }] }], 'A', 'd0', '2026-07-10T00:00:00Z', 'S', 'p'), false, 'did not retrain');
      assert.strictEqual(LB.laterSessionTrainsExId([{ ...later, id: 'S' }], 'A', 'd0', '2026-07-10T00:00:00Z', 'S', 'p'), false, 'excepted self');
      assert.strictEqual(LB.laterSessionTrainsExId([{ ...later, ended: '2026-07-05T00:00:00Z' }], 'A', 'd0', '2026-07-10T00:00:00Z', 'S', 'p'), false, 'earlier');
    });
  }

  // ── remapMesoRecapRawForSwap (#E full recap re-key) ──
  {
    const raw = () => ({
      answers: {
        soreness: { chest: { muscle: 'chest', targets: [{ exId: 'A', name: 'Bench', key: 'A_d0' }], answer: 'still_sore', contrib: { A_d0: -1 } } },
        joint: { A: { exId: 'A', exName: 'Bench', answer: 'sharp', pump: 'low', contrib: { A_d0: -1 } } },
        volume: { chest: { muscle: 'chest', exIds: ['A', 'e2'], volume: 'not_enough', contrib: { A_d0: 1 } } },
      },
      negOwner: { A_d0: 'joint' }, dayId: 'd0',
    });
    test('remapMesoRecapRawForSwap: re-keys joint identity + contrib to the new exId', () => {
      const out = LB.remapMesoRecapRawForSwap(raw(), 'A', 'B', 'd0', 'Incline');
      assert.strictEqual(out.answers.joint.B.exId, 'B');
      assert.strictEqual(out.answers.joint.B.exName, 'Incline');
      assert.strictEqual(out.answers.joint.B.contrib.B_d0, -1);
      assert.ok(!('A' in out.answers.joint));
    });
    test('remapMesoRecapRawForSwap: re-keys soreness targets+contrib, volume exIds+contrib, negOwner', () => {
      const out = LB.remapMesoRecapRawForSwap(raw(), 'A', 'B', 'd0', 'Incline');
      assert.strictEqual(out.answers.soreness.chest.targets[0].key, 'B_d0');
      assert.strictEqual(out.answers.soreness.chest.targets[0].name, 'Incline');
      assert.strictEqual(out.answers.soreness.chest.contrib.B_d0, -1);
      assert.deepStrictEqual(out.answers.volume.chest.exIds, ['B', 'e2']);
      assert.strictEqual(out.answers.volume.chest.contrib.B_d0, 1);
      assert.strictEqual(out.negOwner.B_d0, 'joint');
      assert.ok(!('A_d0' in out.negOwner));
    });
    test('remapMesoRecapRawForSwap: no-op returns same ref, does not mutate', () => {
      const r = raw(); const snap = JSON.stringify(r);
      assert.strictEqual(LB.remapMesoRecapRawForSwap(r, 'Z', 'B', 'd0', 'x'), r);
      LB.remapMesoRecapRawForSwap(r, 'A', 'B', 'd0', 'Incline');
      assert.strictEqual(JSON.stringify(r), snap, 'input untouched');
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
  test('reearnMesoBoostsFromAnswers: a post-hoc edit clears a stale decline on the re-evaluated key', () => {
    // The user declined e1_d1's boost in the live session (weightBoostDeclines set),
    // then later edits that session's feedback answers. The re-earn must clear the
    // stale decline too, mirroring computeMesoGains' live pairing of
    // reearnMesoWeightBoosts with clearMesoWeightBoostDeclines: an edit that changes
    // whether/how much a key earns can't leave an old per-instance answer stuck.
    const prev = { weightBoosts: { e1_d1: 2.5 }, weightBoostDeclines: { e1_d1: true } };
    const out = LB.reearnMesoBoostsFromAnswers(prev, passAnswers, earnInputs, false);
    assert.ok(!('e1_d1' in out.weightBoostDeclines), 'decline cleared on re-evaluation, whether it re-earned or not');
  });
  test('reearnMesoBoostsFromAnswers: a decline for a key NOT in this edit\'s earnInputs is left alone', () => {
    const prev = { weightBoosts: { e1_d1: 2.5, e2_d1: 2.5 }, weightBoostDeclines: { e1_d1: true, e2_d1: true } };
    const out = LB.reearnMesoBoostsFromAnswers(prev, passAnswers, earnInputs, false); // earnInputs only covers e1_d1
    assert.ok(!('e1_d1' in out.weightBoostDeclines), 'e1_d1 was re-evaluated, decline cleared');
    assert.strictEqual(out.weightBoostDeclines.e2_d1, true, 'e2_d1 untouched, not part of this edit');
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
    // key carried through so the session detail's "Changes earned" list can
    // toggle a positive weightDelta's decline after the fact.
    assert.strictEqual(JSON.stringify(gains), JSON.stringify([{ name: 'Bench', key: 'e1_d1', weightDelta: 2.5, setDelta: 1 }]));
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
  test('resolveMesoSeedSuggestion: a decline still vetoes even during week 1\'s no-prior-feedback carve-out', () => {
    // completions only advances at the end of a meso BLOCK, so noPriorFeedback
    // stays true for every session of the first block's week 1, not just its
    // first one. A decline recorded on a later week-1 session must still hold,
    // not fall through the noPriorFeedback carve-out meant for "never earned".
    const sp = { kg: 102.5, reps: 8 };
    assert.strictEqual(LB.resolveMesoSeedSuggestion(sp, null, seedLast, true, true, null, true), null, 'declined=true vetoes despite noPriorFeedback');
    assert.strictEqual(LB.resolveMesoSeedSuggestion(sp, null, seedLast, true, true, null, false), sp, 'declined=false (never earned) is unaffected, same as before');
  });
  test('resolveMesoSeedSuggestion: declined vetoes even if a caller passes the raw earned weightBoost instead of nulling it', () => {
    // The function must own "declined implies withheld" itself, not rely on
    // every caller pre-nulling weightBoost when declined is true. A future
    // caller that stops pre-nulling must not silently re-apply a declined bump.
    const sp = { kg: 102.5, reps: 8 };
    assert.strictEqual(LB.resolveMesoSeedSuggestion(sp, 2.5, seedLast, true, false, null, true), null, 'raw earned weightBoost still vetoed when declined=true');
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
    // Only a Range item's own repsMax caps the nudge, the global default /
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
    assert.strictEqual(seeded[0].reps, 11); // offset ceiling (10) is a trigger threshold, not a cap, keeps climbing
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

  test('realignCycleForToday: preserves history, a past date keeps its old rotation', () => {
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
    // a reps exercise carries no_weight_reps=true, but log_mode is authoritative
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
    // still wins for bounded-only logic), confirms it isn't nested inside/gated
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

  test('prev531MainLiftSession: pairs a session only with the SAME week of the PREVIOUS cycle', () => {
    const sch = { id: 'p531', program_type: '531', days: [{}],
      program_data: { includeDeload: true, mainLifts: { dips: { tm: 100, kind: 'upper' } } } };
    const store = { schedules: [sch], sessions: [] };
    const mkSess = (i) => ({ id: 'dips_' + i, ended: '2026-01-' + String(i + 1).padStart(2, '0') + 'T10:00:00', scheduleId: 'p531',
      entries: [{ exId: 'dips', sets: [] }] });
    // dayCount 1, includeDeload true -> maxWeek 4: idx 0-3 = cycle0 weeks 1-4
    // (4 = deload), idx 4-7 = cycle1 weeks 1-4.
    store.sessions = Array.from({ length: 8 }, (_, i) => mkSess(i));

    // The exact bug: cycle1 week1 (idx4) must pair with cycle0 week1 (idx0),
    // never with the chronologically-closer, but heavier, cycle0 week3 (idx2)
    // or the deload week4 (idx3) that actually ran right before it.
    assert.strictEqual(LB.prev531MainLiftSession(store, store.sessions[4], 'dips').id, 'dips_0');
    assert.strictEqual(LB.prev531MainLiftSession(store, store.sessions[5], 'dips').id, 'dips_1');
    assert.strictEqual(LB.prev531MainLiftSession(store, store.sessions[6], 'dips').id, 'dips_2');
    assert.strictEqual(LB.prev531MainLiftSession(store, store.sessions[7], 'dips').id, 'dips_3'); // deload vs deload

    // Cycle 0 has no earlier cycle to pair with at all.
    for (let i = 0; i < 4; i++) assert.strictEqual(LB.prev531MainLiftSession(store, store.sessions[i], 'dips'), null);

    // Not a main lift on this plan (e.g. an assistance exercise sharing the
    // same day): assistance keeps the normal "most recent session" behavior,
    // so this must abstain rather than pair it up too.
    assert.strictEqual(LB.prev531MainLiftSession(store, store.sessions[4], 'cable_fly'), null);

    // A session not itself a counted 531 position (bonus, still in progress,
    // or from a different plan entirely) has nothing to be positioned against.
    const bonus = { id: 'bonus', scheduleId: 'p531', isBonus: true, entries: [{ exId: 'dips', sets: [] }] };
    assert.strictEqual(LB.prev531MainLiftSession(store, bonus, 'dips'), null);
    assert.strictEqual(LB.prev531MainLiftSession(store, { id: 'nope', scheduleId: 'other-plan' }, 'dips'), null);
  });

  test('prev531MainLiftSession: interleaved multi-lift plan still pairs by exId, not array position', () => {
    // dayCount 2 (squat, bench), includeDeload false -> maxWeek 3. Logged in
    // strict squat-then-bench order each week: idx 0-5 = cycle0 (sq/bp x3
    // weeks), idx 6-7 = cycle1 week1's sq/bp.
    const sch = { id: 'p2', program_type: '531', days: [{}, {}],
      program_data: { includeDeload: false, mainLifts: { sq: { tm: 100, kind: 'squat' }, bp: { tm: 80, kind: 'bench' } } } };
    const mk = (exId, i) => ({ id: exId + '_' + i, ended: '2026-03-' + String(i + 1).padStart(2, '0') + 'T10:00:00', scheduleId: 'p2',
      entries: [{ exId, sets: [] }] });
    const store = { schedules: [sch], sessions: [
      mk('sq', 0), mk('bp', 1), mk('sq', 2), mk('bp', 3), mk('sq', 4), mk('bp', 5), mk('sq', 6), mk('bp', 7),
    ] };
    const sqCycle1Week1 = store.sessions[6];
    const bpCycle1Week1 = store.sessions[7];
    assert.strictEqual(LB.prev531MainLiftSession(store, sqCycle1Week1, 'sq').id, 'sq_0');
    assert.strictEqual(LB.prev531MainLiftSession(store, bpCycle1Week1, 'bp').id, 'bp_1');
  });

  test('prev531MainLiftSessionLive: the in-progress session pairs as if it had just been appended', () => {
    const sch = { id: 'p531', program_type: '531', days: [{}],
      program_data: { includeDeload: true, mainLifts: { dips: { tm: 100, kind: 'upper' } } } };
    const mkSess = (i) => ({ id: 'dips_' + i, ended: '2026-01-' + String(i + 1).padStart(2, '0') + 'T10:00:00', scheduleId: 'p531',
      entries: [{ exId: 'dips', sets: [] }] });
    // 4 ended sessions = cycle0 weeks 1-4 (4 = deload). The live session
    // (ended: null, still being logged) is the 5th, cycle1 week1, so it must
    // pair with idx0 (cycle0 week1), exactly like prev531MainLiftSession
    // would once this session itself finishes and becomes idx4.
    const store = { schedules: [sch], sessions: Array.from({ length: 4 }, (_, i) => mkSess(i)) };
    const live = { id: 'live', scheduleId: 'p531', dayId: 'd1', ended: null, entries: [{ exId: 'dips', sets: [] }] };
    assert.strictEqual(LB.prev531MainLiftSessionLive(store, live, 'dips').id, 'dips_0');

    // Still cycle 0 (only 2 ended sessions so far): no earlier cycle yet.
    const store2 = { schedules: [sch], sessions: [mkSess(0), mkSess(1)] };
    assert.strictEqual(LB.prev531MainLiftSessionLive(store2, live, 'dips'), null);

    // A bonus (or app-deload) live session never counts toward the rotation,
    // so it has no real position to derive a pairing from either.
    assert.strictEqual(LB.prev531MainLiftSessionLive(store, { ...live, isBonus: true }, 'dips'), null);
    assert.strictEqual(LB.prev531MainLiftSessionLive(store, { ...live, isDeload: true }, 'dips'), null);

    // Not a main lift: abstains, same as the ended-session version.
    assert.strictEqual(LB.prev531MainLiftSessionLive(store, live, 'cable_fly'), null);
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

  test('progressionSuggestion: a declined bump is suppressed for its own occurrence only, a sibling occurrence is unaffected', () => {
    // "leg" appears twice on day d1 (e.g. straight set + back-off block); only
    // occurrence 0's earned bump was declined, occurrence 1 earned its own and
    // was never asked, so it must still progress independently (no cross-
    // contamination between two occurrences of the same exercise, see the
    // matching occ-keying in recentSessionsForExercise).
    const store = {
      settings: { smartProgression: true },
      exercises: [{ id: 'leg', name: 'Leg Press' }],
      schedules: [],
      sessions: [{
        ended: '2026-07-01T10:00:00Z', dayId: 'd1', isDeload: false,
        entries: [
          { exId: 'leg', sets: [{ kg: 100, reps: 10, warmup: false }] },
          { exId: 'leg', sets: [{ kg: 50, reps: 10, warmup: false }] },
        ],
        progressionBumps: { leg_0: { name: 'Leg Press', currentKg: 100, nextKg: 102.5, declined: true } },
      }],
    };
    const ref = { entry: { sets: [{ kg: 100, reps: 10, warmup: false }] } };
    assert.strictEqual(LB.progressionSuggestion(store, 'leg', 'd1', 5, null, ref, null, null, 0), null, 'occurrence 0 was declined');
    const sugg = LB.progressionSuggestion(store, 'leg', 'd1', 5, null, ref, null, null, 1);
    assert.ok(sugg && sugg.kg > 100, 'occurrence 1 was never declined, still progresses');
  });

  test('progressionSuggestion: no decline recorded, bump goes through normally', () => {
    const store = {
      settings: { smartProgression: true },
      exercises: [{ id: 'leg', name: 'Leg Press' }],
      schedules: [],
      sessions: [{
        ended: '2026-07-01T10:00:00Z', dayId: 'd1', isDeload: false,
        entries: [{ exId: 'leg', sets: [{ kg: 100, reps: 10, warmup: false }] }],
        progressionBumps: {},
      }],
    };
    const ref = { entry: { sets: [{ kg: 100, reps: 10, warmup: false }] } };
    const sugg = LB.progressionSuggestion(store, 'leg', 'd1', 5, null, ref, null, null, 0);
    assert.ok(sugg && sugg.kg > 100, 'undeclined bump still fires');
  });
  test('progressionSuggestion: an explicitly accepted bump (declined:false) is not suppressed', () => {
    // Hell yeah now writes a record too (session detail's toggle chip needs
    // something to show for an accepted bump, not just declines), so an
    // accepted entry must be treated the same as no entry at all.
    const store = {
      settings: { smartProgression: true },
      exercises: [{ id: 'leg', name: 'Leg Press' }],
      schedules: [],
      sessions: [{
        ended: '2026-07-01T10:00:00Z', dayId: 'd1', isDeload: false,
        entries: [{ exId: 'leg', sets: [{ kg: 100, reps: 10, warmup: false }] }],
        progressionBumps: { leg_0: { name: 'Leg Press', currentKg: 97.5, nextKg: 100, declined: false } },
      }],
    };
    const ref = { entry: { sets: [{ kg: 100, reps: 10, warmup: false }] } };
    const sugg = LB.progressionSuggestion(store, 'leg', 'd1', 5, null, ref, null, null, 0);
    assert.ok(sugg && sugg.kg > 100, 'accepted bump does not block the next one');
  });

  test('incrementForExercise: no override, no equipment config -> the caller fallback', () => {
    const store = { settings: {} };
    const ex = { id: 'leg', equipment: 'machine' };
    assert.strictEqual(LB.incrementForExercise(store, ex, 2.5), 2.5);
    assert.strictEqual(LB.incrementForExercise(store, ex, 5), 5, 'each caller keeps its own fallback');
  });

  test('incrementForExercise: no per-exercise override -> falls back to the equipment-category config', () => {
    const store = { settings: { equipmentConfig: { machine: { increment: 1.25 } } } };
    const ex = { id: 'leg', equipment: 'machine' };
    assert.strictEqual(LB.incrementForExercise(store, ex, 2.5), 1.25);
  });

  test('incrementForExercise: a set per-exercise override wins over the equipment config and the fallback', () => {
    const store = { settings: { equipmentConfig: { machine: { increment: 1.25 } } } };
    const ex = { id: 'leg', equipment: 'machine', progression_increment: 0.5 };
    assert.strictEqual(LB.incrementForExercise(store, ex, 2.5), 0.5);
  });

  test('incrementForExercise: an override of exactly 0 or negative is treated as unset, never applied literally', () => {
    const store = { settings: { equipmentConfig: { machine: { increment: 1.25 } } } };
    assert.strictEqual(LB.incrementForExercise(store, { id: 'leg', equipment: 'machine', progression_increment: 0 }, 2.5), 1.25, 'a 0 override falls through to the equipment config, it can never mean "bump by 0"');
    assert.strictEqual(LB.incrementForExercise(store, { id: 'leg', equipment: 'machine', progression_increment: -1 }, 2.5), 1.25, 'a negative override falls through too, it would otherwise invert the Meso earn/cut sign convention');
  });

  test('incrementForExercise: an equipment-category increment of 0 or negative is also treated as unset', () => {
    const store = { settings: { equipmentConfig: { machine: { increment: 0 } } } };
    const ex = { id: 'leg', equipment: 'machine' };
    assert.strictEqual(LB.incrementForExercise(store, ex, 2.5), 2.5);
    store.settings.equipmentConfig.machine.increment = -3;
    assert.strictEqual(LB.incrementForExercise(store, ex, 2.5), 2.5);
  });

  test('incrementForExercise: a caller-supplied catCfg is used instead of re-deriving it, and still honors the same >0 rule', () => {
    const store = { settings: { equipmentConfig: { machine: { increment: 99 } } } }; // must be ignored: caller passed its own catCfg
    const ex = { id: 'leg', equipment: 'machine' };
    assert.strictEqual(LB.incrementForExercise(store, ex, 2.5, { increment: 4 }), 4);
    assert.strictEqual(LB.incrementForExercise(store, ex, 2.5, { increment: 0 }), 2.5);
  });

  test('progressionSuggestion: a per-exercise progression_increment override changes the suggested bump size', () => {
    const store = {
      settings: { smartProgression: true, equipmentConfig: { machine: { increment: 5 } } },
      exercises: [{ id: 'leg', name: 'Leg Press', equipment: 'machine', progression_increment: 1 }],
      schedules: [],
    };
    const ref = { entry: { sets: [{ kg: 100, reps: 10, warmup: false }] } };
    const sugg = LB.progressionSuggestion(store, 'leg', 'd1', 5, null, ref, null, null, 0);
    assert.ok(sugg, 'bump still fires');
    assert.strictEqual(sugg.kg, 101, 'uses the 1kg per-exercise override, not the 5kg equipment default');
  });

  test('progressionSuggestion: a 0 or negative progression_increment override falls back to the equipment config instead of permanently silencing the bump', () => {
    const store = {
      settings: { smartProgression: true, equipmentConfig: { machine: { increment: 5 } } },
      exercises: [{ id: 'leg', name: 'Leg Press', equipment: 'machine', progression_increment: 0 }],
      schedules: [],
    };
    const ref = { entry: { sets: [{ kg: 100, reps: 10, warmup: false }] } };
    const sugg = LB.progressionSuggestion(store, 'leg', 'd1', 5, null, ref, null, null, 0);
    assert.ok(sugg, 'bump still fires using the equipment-config increment, not silently disabled forever');
    assert.strictEqual(sugg.kg, 105);
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
      assert.strictEqual(out.version, 3, 'stamps the P3 blob version');
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

    test('backoffDeltas: resets grown lifts to plan base, leaves base/cut lifts', () => {
      const out = LB.backoffDeltas({ a: 3, b: 2, c: 1, d: 0, e: -1 });
      assert.strictEqual(out.a, 0, '+3 resets to base (0)');
      assert.strictEqual(out.b, 0, '+2 resets to base (0)');
      assert.strictEqual(out.c, 0, '+1 resets to base (0)');
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

    test('snapshotBlockStart: also snapshots startMrvByMuscle from current landmarks', () => {
      const withLm = LB.updateLandmarkMrv(null, 'Chest', 20);
      const out = LB.snapshotBlockStart(withLm, '2026-07-19', { Chest: 12 });
      assert.strictEqual(out.block.startMrvByMuscle.Chest, 20);
    });

    test('muscleRosterKeys: same exercise on two days yields two independent keys', () => {
      const sch = { days: [{ id: 'd1', items: [{ exId: 'bench' }] }, { id: 'd2', items: [{ exId: 'bench' }] }] };
      const muscleOf = (id) => (id === 'bench' ? 'Chest' : null);
      const keys = LB.muscleRosterKeys(sch, 'Chest', muscleOf);
      // JSON.stringify, not deepStrictEqual: the returned array lives in the vm
      // realm, so its prototype differs from this file's (same as the rest of
      // this suite avoids it).
      assert.strictEqual(JSON.stringify(keys), JSON.stringify(['bench_d1', 'bench_d2']));
    });

    test('muscleRosterKeys: a muscle with no current exercises returns an empty roster', () => {
      const sch = { days: [{ id: 'd1', items: [{ exId: 'squat' }] }] };
      const muscleOf = (id) => (id === 'squat' ? 'Quads' : null);
      assert.strictEqual(LB.muscleRosterKeys(sch, 'Chest', muscleOf).length, 0);
    });

    test('muscleRosterKeys: a cardio/muscle-less item is excluded via muscleOfExId returning null', () => {
      const sch = { days: [{ id: 'd1', items: [{ exId: 'bench' }, { exId: 'cardio1' }] }] };
      const muscleOf = (id) => (id === 'bench' ? 'Chest' : null); // cardio1 has no tags -> null
      assert.strictEqual(JSON.stringify(LB.muscleRosterKeys(sch, 'Chest', muscleOf)), JSON.stringify(['bench_d1']));
    });

    test('updateMevFloors: MRV grew since block start -> mevFloor grows by the delta', () => {
      const withMrv = LB.updateLandmarkMrv(null, 'Chest', 20); // mrv 20
      const st = { ...withMrv, block: { startMrvByMuscle: { Chest: 16 } } }; // block started at 16
      const out = LB.updateMevFloors(st);
      assert.strictEqual(out.landmarks.Chest.mevFloor, 4, 'grew by 20 - 16');
    });

    test('updateMevFloors: MRV shrank since block start -> mevFloor shrinks by the delta', () => {
      const withMrv = LB.updateLandmarkMrv(null, 'Chest', 14);
      const st = { ...withMrv, landmarks: { Chest: { ...withMrv.landmarks.Chest, mevFloor: 5 } }, block: { startMrvByMuscle: { Chest: 20 } } };
      const out = LB.updateMevFloors(st);
      assert.strictEqual(out.landmarks.Chest.mevFloor, 0, '5 + (14 - 20) clamps at 0, does not go negative');
    });

    test('updateMevFloors: a shrink larger than the banked floor is floored at 0, not negative', () => {
      const withMrv = LB.updateLandmarkMrv(null, 'Chest', 10);
      const st = { ...withMrv, landmarks: { Chest: { ...withMrv.landmarks.Chest, mevFloor: 1 } }, block: { startMrvByMuscle: { Chest: 20 } } };
      assert.strictEqual(LB.updateMevFloors(st).landmarks.Chest.mevFloor, 0);
    });

    test('updateMevFloors: first-ever block for a muscle (no prior snapshot) makes no floor change', () => {
      const withMrv = LB.updateLandmarkMrv(null, 'Chest', 18); // fresh landmark, no block.startMrvByMuscle yet
      const out = LB.updateMevFloors(withMrv);
      assert.strictEqual(out.landmarks.Chest.mevFloor, 0, 'no baseline to diff against yet');
    });

    test('redistributeMevFloors: total sets redistributed equals the banked floor', () => {
      const sch = { days: [{ id: 'd1', items: [{ exId: 'a' }, { exId: 'b' }] }] };
      const muscleOf = (id) => 'Chest';
      const autoregState = { landmarks: { Chest: { mrv: 20, mevFloor: 3 } } };
      const { deltas } = LB.redistributeMevFloors(autoregState, sch, muscleOf, {}, {});
      const total = (deltas.a_d1 || 0) + (deltas.b_d1 || 0);
      assert.strictEqual(total, 3);
    });

    test('redistributeMevFloors: rotates fairly across the roster (least-loaded-first)', () => {
      const sch = { days: [{ id: 'd1', items: [{ exId: 'a' }, { exId: 'b' }] }] };
      const muscleOf = () => 'Chest';
      const autoregState = { landmarks: { Chest: { mrv: 20, mevFloor: 3 } } };
      const { deltas } = LB.redistributeMevFloors(autoregState, sch, muscleOf, {}, {});
      assert.ok(Math.abs((deltas.a_d1 || 0) - (deltas.b_d1 || 0)) <= 1, '3 sets over 2 exercises splits 2/1, never 3/0');
    });

    test('redistributeMevFloors: growthCounts absorbs the grant so the next earned pick avoids the topped-up lift', () => {
      const sch = { days: [{ id: 'd1', items: [{ exId: 'a' }, { exId: 'b' }] }] };
      const muscleOf = () => 'Chest';
      // A single floor set so the grant is unambiguous (an even split across
      // both exercises would tie growthCounts and make "who's less loaded"
      // undefined).
      const autoregState = { landmarks: { Chest: { mrv: 20, mevFloor: 1 } } };
      const { growthCounts } = LB.redistributeMevFloors(autoregState, sch, muscleOf, {}, {});
      const next = LB.pickGrowthRecipient(['a_d1', 'b_d1'], growthCounts, null);
      // the lift that did NOT absorb the floor grant should win the next earned pick
      const loaded = (growthCounts.a_d1 || 0) >= (growthCounts.b_d1 || 0) ? 'a_d1' : 'b_d1';
      const unloaded = loaded === 'a_d1' ? 'b_d1' : 'a_d1';
      assert.strictEqual(next.recipientKey, unloaded);
    });

    test('redistributeMevFloors: composes on top of an already-backed-off deltas map without disturbing cuts', () => {
      const sch = { days: [{ id: 'd1', items: [{ exId: 'a' }] }] };
      const muscleOf = () => 'Chest';
      const autoregState = { landmarks: { Chest: { mrv: 20, mevFloor: 2 } } };
      const backedOff = LB.backoffDeltas({ a_d1: 3, other_d2: -1 }); // {a_d1: 0, other_d2: -1}
      const { deltas } = LB.redistributeMevFloors(autoregState, sch, muscleOf, backedOff, {});
      assert.strictEqual(deltas.a_d1, 2, 'floor grants land on top of the backed-off base');
      assert.strictEqual(deltas.other_d2, -1, 'an unrelated cut outside the roster is untouched');
    });

    test('redistributeMevFloors: an empty roster leaves deltas/growthCounts untouched, banks the floor', () => {
      const sch = { days: [{ id: 'd1', items: [{ exId: 'squat' }] }] }; // no Chest exercises currently
      const muscleOf = (id) => (id === 'squat' ? 'Quads' : null);
      const autoregState = { landmarks: { Chest: { mrv: 20, mevFloor: 5 } } };
      const { deltas, growthCounts } = LB.redistributeMevFloors(autoregState, sch, muscleOf, { x: 1 }, { y: 2 });
      // JSON.stringify, not deepStrictEqual: see the muscleRosterKeys tests above.
      assert.strictEqual(JSON.stringify(deltas), JSON.stringify({ x: 1 }));
      assert.strictEqual(JSON.stringify(growthCounts), JSON.stringify({ y: 2 }));
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
      ...(opts.dayId != null ? { dayId: opts.dayId } : {}),
      entries: opts.entries || [{ exId: 'bench', sets }],
      ...(opts.joint ? { mesoRecap: { raw: { answers: { joint: { bench: opts.joint } } } } } : {}),
    });
    const flat = [{ done: true, kg: 100, reps: 8 }];

    test('detectStall: flat e1RM over 4 sessions at green gates → stalled with evidence', () => {
      const sessions = [
        mk('E0', '2026-07-01T10:00:00Z', flat),
        mk('E1', '2026-07-04T10:00:00Z', flat),
        mk('E2', '2026-07-07T10:00:00Z', flat),
        mk('E3', '2026-07-10T10:00:00Z', flat),
      ];
      const out = LB.detectStall(sessions, 'bench', muscleOf, { planId: 'p', atCeiling: () => false, exName: 'Bench' });
      assert.strictEqual(out.stalled, true, 'flat e1RM at green gates is a stall');
      assert.ok(out.evidence[0].indexOf('Bench') === 0, 'evidence leads with the lift name');
    });

    test('detectStall: improving e1RM on the latest session → not stalled', () => {
      const sessions = [
        mk('E0', '2026-07-01T10:00:00Z', flat),
        mk('E1', '2026-07-04T10:00:00Z', flat),
        mk('E2', '2026-07-07T10:00:00Z', flat),
        mk('E3', '2026-07-10T10:00:00Z', [{ done: true, kg: 105, reps: 8 }]),
      ];
      assert.strictEqual(LB.detectStall(sessions, 'bench', muscleOf, { planId: 'p', atCeiling: () => false }).stalled, false);
    });

    test('detectStall: recovering from an intentional lighter session → not stalled even below the window\'s oldest', () => {
      // 100 -> 85 (deliberately light, not flagged isDeload) -> 85 -> 90: climbing
      // again session-over-session, even though 90 still hasn't cleared the
      // window's oldest (100). Must not read as "still stalled".
      const sessions = [
        mk('E0', '2026-07-01T10:00:00Z', flat),
        mk('E1', '2026-07-04T10:00:00Z', [{ done: true, kg: 85, reps: 8 }]),
        mk('E2', '2026-07-07T10:00:00Z', [{ done: true, kg: 85, reps: 8 }]),
        mk('E3', '2026-07-10T10:00:00Z', [{ done: true, kg: 90, reps: 8 }]),
      ];
      assert.strictEqual(LB.detectStall(sessions, 'bench', muscleOf, { planId: 'p', atCeiling: () => false }).stalled, false);
    });

    test('detectStall: a lighter session that keeps declining is still a stall', () => {
      // 100 -> 85 -> 82 -> 80: not recovering, every later session is a new LOW,
      // not a climb. Must still stall (the recovery carve-out is not a blanket
      // exemption for any window that contains a dip).
      const sessions = [
        mk('E0', '2026-07-01T10:00:00Z', flat),
        mk('E1', '2026-07-04T10:00:00Z', [{ done: true, kg: 85, reps: 8 }]),
        mk('E2', '2026-07-07T10:00:00Z', [{ done: true, kg: 82, reps: 8 }]),
        mk('E3', '2026-07-10T10:00:00Z', [{ done: true, kg: 80, reps: 8 }]),
      ];
      assert.strictEqual(LB.detectStall(sessions, 'bench', muscleOf, { planId: 'p', atCeiling: () => false }).stalled, true);
    });

    test('detectStall: muscle at its ceiling → not a stall (overreach owns it)', () => {
      const sessions = [
        mk('E0', '2026-07-01T10:00:00Z', flat), mk('E1', '2026-07-04T10:00:00Z', flat),
        mk('E2', '2026-07-07T10:00:00Z', flat), mk('E3', '2026-07-10T10:00:00Z', flat),
      ];
      assert.strictEqual(LB.detectStall(sessions, 'bench', muscleOf, { planId: 'p', atCeiling: () => true }).stalled, false, 'ceiling gate not green');
    });

    test('detectStall: a joint flag on the latest session → not a clean stall', () => {
      const sessions = [
        mk('E0', '2026-07-01T10:00:00Z', flat),
        mk('E1', '2026-07-04T10:00:00Z', flat),
        mk('E2', '2026-07-07T10:00:00Z', flat),
        mk('E3', '2026-07-10T10:00:00Z', flat, { joint: { exId: 'bench', answer: 'sharp' } }),
      ];
      assert.strictEqual(LB.detectStall(sessions, 'bench', muscleOf, { planId: 'p', atCeiling: () => false }).stalled, false, 'joint flag is not a green gate');
    });

    test('detectStall: a discounted (rough) session is ignored, never fakes or breaks a stall', () => {
      // Four full flat sessions = a stall. A newest DISCOUNTED session with a big PR
      // would break it if counted, but signalWeight discipline drops it.
      const sessions = [
        mk('E0', '2026-07-01T10:00:00Z', flat),
        mk('E1', '2026-07-04T10:00:00Z', flat),
        mk('E2', '2026-07-07T10:00:00Z', flat),
        mk('E3', '2026-07-10T10:00:00Z', flat),
        mk('E4', '2026-07-13T10:00:00Z', [{ done: true, kg: 130, reps: 10 }], { signalWeight: 'discounted' }),
      ];
      assert.strictEqual(LB.detectStall(sessions, 'bench', muscleOf, { planId: 'p', atCeiling: () => false }).stalled, true, 'the rough-day PR must not count');
    });

    test('detectStall: fewer than 4 weighted sessions → not enough data', () => {
      const sessions = [
        mk('E0', '2026-07-01T10:00:00Z', flat), mk('E1', '2026-07-04T10:00:00Z', flat), mk('E2', '2026-07-07T10:00:00Z', flat),
      ];
      assert.strictEqual(LB.detectStall(sessions, 'bench', muscleOf, { planId: 'p', atCeiling: () => false }).stalled, false, '3 sessions of history, one short of the 4 needed');
    });

    test('detectStall: reps-only (no kg) exercise never stalls (no e1RM)', () => {
      const bw = [{ done: true, reps: 12 }];
      const sessions = [
        mk('E0', '2026-07-01T10:00:00Z', bw), mk('E1', '2026-07-04T10:00:00Z', bw),
        mk('E2', '2026-07-07T10:00:00Z', bw), mk('E3', '2026-07-10T10:00:00Z', bw),
      ];
      assert.strictEqual(LB.detectStall(sessions, 'bench', muscleOf, { planId: 'p', atCeiling: () => false }).stalled, false, 'e1RM is meaningless without weight');
    });

    // Same exercise in two different day-slots (e.g. 2nd exercise, fresher, on Day A
    // vs 3rd, more pre-fatigued, on Day B). Both slots are steadily progressing on
    // their own terms, but Day B is consistently heavier/lower due to fatigue context.
    // Without a dayId filter the newest-4 window can pick 1 Day A + 3 Day B sessions,
    // where Day A's higher number sits at the OLDEST spot of the window and none of
    // the later Day B sessions beat it: a false stall from mixing two contexts. B3/B4
    // are deliberately EQUAL (a plateau, not a further rise) so this stays a clean
    // false stall on its own: an increase between them would also satisfy
    // detectStall's own "already climbing again" recovery check, for the right
    // reason (Day B really is climbing there) but for the wrong test, muddying what
    // this one demonstrates. A4 sits chronologically between B1 and B2 so it's the
    // single Day A session pulled into the pooled newest-4 window, anchoring it as
    // the oldest of the four.
    const dayMix = [
      mk('A1', '2026-01-01T10:00:00Z', [{ done: true, kg: 75, reps: 8 }], { dayId: 'A' }),
      mk('A2', '2026-01-08T10:00:00Z', [{ done: true, kg: 80, reps: 8 }], { dayId: 'A' }),
      mk('A3', '2026-01-15T10:00:00Z', [{ done: true, kg: 85, reps: 8 }], { dayId: 'A' }),
      mk('A4', '2026-03-01T10:00:00Z', [{ done: true, kg: 105, reps: 8 }], { dayId: 'A' }),
      mk('B1', '2026-02-01T10:00:00Z', [{ done: true, kg: 60, reps: 8 }], { dayId: 'B' }),
      mk('B2', '2026-04-01T10:00:00Z', [{ done: true, kg: 65, reps: 8 }], { dayId: 'B' }),
      mk('B3', '2026-04-10T10:00:00Z', [{ done: true, kg: 70, reps: 8 }], { dayId: 'B' }),
      mk('B4', '2026-04-20T10:00:00Z', [{ done: true, kg: 70, reps: 8 }], { dayId: 'B' }),
    ];

    test('detectStall: pooling two day-slots without a dayId filter can read as a false stall', () => {
      const out = LB.detectStall(dayMix, 'bench', muscleOf, { planId: 'p', atCeiling: () => false });
      assert.strictEqual(out.stalled, true, 'the newest-4 window crosses day contexts and hides both slots\' real progress');
    });

    test('detectStall: dayId scoping clears the false stall, each day-slot is progressing on its own', () => {
      const dayA = LB.detectStall(dayMix, 'bench', muscleOf, { planId: 'p', atCeiling: () => false, dayId: 'A' });
      const dayB = LB.detectStall(dayMix, 'bench', muscleOf, { planId: 'p', atCeiling: () => false, dayId: 'B' });
      assert.strictEqual(dayA.stalled, false, 'Day A alone (75 -> 80 -> 85 -> 105) is steadily progressing');
      assert.strictEqual(dayB.stalled, false, 'Day B alone (60 -> 65 -> 70 -> 70) climbed and held, not stalled either');
    });

    // Same exercise twice in one session (top set + back-off block). occ picks a
    // single entry per session instead of taking the best across both, so a flat,
    // genuinely stalled top set is not masked by an unrelated, improving back-off set.
    const occMix = [
      mk('S1', '2026-07-01T10:00:00Z', [], { entries: [
        { exId: 'bench', sets: [{ done: true, kg: 140, reps: 8 }] },
        { exId: 'bench', sets: [{ done: true, kg: 100, reps: 8 }] },
      ] }),
      mk('S2', '2026-07-09T10:00:00Z', [], { entries: [
        { exId: 'bench', sets: [{ done: true, kg: 140, reps: 8 }] },
        { exId: 'bench', sets: [{ done: true, kg: 110, reps: 8 }] },
      ] }),
      mk('S3', '2026-07-17T10:00:00Z', [], { entries: [
        { exId: 'bench', sets: [{ done: true, kg: 140, reps: 8 }] },
        { exId: 'bench', sets: [{ done: true, kg: 130, reps: 8 }] },
      ] }),
      mk('S4', '2026-07-25T10:00:00Z', [], { entries: [
        { exId: 'bench', sets: [{ done: true, kg: 140, reps: 8 }] },
        { exId: 'bench', sets: [{ done: true, kg: 145, reps: 8 }] },
      ] }),
    ];

    test('detectStall: occ scoping isolates the top set, a flat top set stalls on its own', () => {
      const out = LB.detectStall(occMix, 'bench', muscleOf, { planId: 'p', atCeiling: () => false, occ: 0 });
      assert.strictEqual(out.stalled, true, 'the top set is flat at 140kg across all 4 sessions');
    });

    test('detectStall: occ scoping isolates the back-off set, its own improvement is not lost', () => {
      const out = LB.detectStall(occMix, 'bench', muscleOf, { planId: 'p', atCeiling: () => false, occ: 1 });
      assert.strictEqual(out.stalled, false, 'the back-off set climbs 100 -> 110 -> 130 -> 145');
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
    test('blockStartTs: falls back to startDate (local noon) for older mesos without startedAt', () => {
      // startDate is a bare day, anchored at LOCAL noon (parseDate), not UTC midnight,
      // so it stays on the intended calendar day for users west of UTC.
      assert.strictEqual(LB.blockStartTs({ scheduleId: 'p', startDate: '2026-07-01' }, []), LB.parseDate('2026-07-01').getTime());
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
      assert.strictEqual(st.version, 3, 'stamps the current P3 blob version');
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

  // ── Autoreg v2 polish: readiness-edit rep-miss cut recompute ─────────────────
  // recomputeMesoRepMissCut mirrors computeMesoGains' cut gate: a 'full' session
  // advances the per-key miss streak (cut at 2 early misses); 'discounted' freezes it.
  test('recomputeMesoRepMissCut: full->discounted freezes an applied rep-miss cut', () => {
    // Session was logged 'full' with an early miss that tripped the 2nd-miss cut:
    // weightBoosts[e1_d1] = -2.5, repMissCounts reset to 0, streak base was 1.
    const ms = { repMissCounts: { e1_d1: 0 }, weightBoosts: { e1_d1: -2.5 } };
    const earnInputs = [{ key: 'e1_d1', increment: 2.5, earlyMiss: true, attempted: true }];
    const out = LB.recomputeMesoRepMissCut(ms, earnInputs, { e1_d1: 1 }, 'full', 'discounted');
    assert.ok(!('e1_d1' in out.weightBoosts) || out.weightBoosts.e1_d1 >= 0, 'the -increment cut is dropped on discounted');
    assert.strictEqual(out.repMissCounts.e1_d1, 1, 'the streak is restored to its pre-session base, frozen');
  });

  test('recomputeMesoRepMissCut: discounted->full re-enables the cut from the frozen streak', () => {
    // Session was 'discounted' so it never advanced the streak (base == current == 1),
    // and no cut was applied. Flipping to 'full' with an early miss reaches 2 -> cut.
    const ms = { repMissCounts: { e1_d1: 1 }, weightBoosts: {} };
    const earnInputs = [{ key: 'e1_d1', increment: 2.5, earlyMiss: true, attempted: true }];
    const out = LB.recomputeMesoRepMissCut(ms, earnInputs, { e1_d1: 1 }, 'discounted', 'full');
    assert.strictEqual(out.weightBoosts.e1_d1, -2.5, 'the cut is re-armed at 2 consecutive misses');
    assert.strictEqual(out.repMissCounts.e1_d1, 0, 'the streak resets after the cut, as in computeMesoGains');
  });

  test('recomputeMesoRepMissCut: discounted->full with one miss advances but does not cut', () => {
    const ms = { repMissCounts: { e1_d1: 0 }, weightBoosts: {} };
    const earnInputs = [{ key: 'e1_d1', increment: 2.5, earlyMiss: true, attempted: true }];
    const out = LB.recomputeMesoRepMissCut(ms, earnInputs, { e1_d1: 0 }, 'discounted', 'full');
    assert.strictEqual(out.repMissCounts.e1_d1, 1, 'streak advances to 1');
    assert.ok(!('e1_d1' in out.weightBoosts), 'no cut yet at a single miss');
  });

  test('recomputeMesoRepMissCut: a same-side edit (full->full) is a no-op', () => {
    const ms = { repMissCounts: { e1_d1: 0 }, weightBoosts: { e1_d1: -2.5 } };
    const earnInputs = [{ key: 'e1_d1', increment: 2.5, earlyMiss: true, attempted: true }];
    const out = LB.recomputeMesoRepMissCut(ms, earnInputs, { e1_d1: 1 }, 'full', 'full');
    assert.strictEqual(out, ms, 'no-op returns the same object, leaving the cut untouched');
  });

  test('recomputeMesoRepMissCut: an unattempted exercise never touches the streak', () => {
    const ms = { repMissCounts: { e1_d1: 1 }, weightBoosts: {} };
    const earnInputs = [{ key: 'e1_d1', increment: 2.5, earlyMiss: false, attempted: false }];
    const out = LB.recomputeMesoRepMissCut(ms, earnInputs, { e1_d1: 1 }, 'discounted', 'full');
    assert.strictEqual(out.repMissCounts.e1_d1, 1, 'the streak is left as-is for an unattempted lift');
  });

  // ── AI Daily Summary ──────────────────────────────────────────────────────
  // dailySummaryDayIsEmpty / buildDailySummaryPayload / generateDailySummary /
  // splitHeadlineBody: the pure data-transformation half of the feature (the
  // Edge Function itself, and any DOM rendering, are verified separately via
  // a Playwright harness, not here).
  const Y = '2026-07-27'; // an arbitrary "yesterday" for these fixtures

  test('dailySummaryDayIsEmpty: true for a genuinely empty day', () => {
    assert.strictEqual(LB.dailySummaryDayIsEmpty({ dailyLogs: [] }, Y), true);
  });
  test('dailySummaryDayIsEmpty: false the moment weight is logged', () => {
    assert.strictEqual(LB.dailySummaryDayIsEmpty({ dailyLogs: [{ date: Y, weight: 80 }] }, Y), false);
  });
  test('dailySummaryDayIsEmpty: false with a non-planned food log entry', () => {
    assert.strictEqual(LB.dailySummaryDayIsEmpty({ dailyLogs: [], foodLogs: [{ date: Y, planned: false }] }, Y), false);
  });
  test('dailySummaryDayIsEmpty: a PLANNED (not yet eaten) food entry alone does not count', () => {
    assert.strictEqual(LB.dailySummaryDayIsEmpty({ dailyLogs: [], foodLogs: [{ date: Y, planned: true }] }, Y), true);
  });
  test('dailySummaryDayIsEmpty: false with a water log entry', () => {
    assert.strictEqual(LB.dailySummaryDayIsEmpty({ dailyLogs: [], waterLogs: [{ date: Y, amountMl: 500 }] }, Y), false);
  });
  test('dailySummaryDayIsEmpty: false when a medication is due, even if zero were taken', () => {
    const store = {
      dailyLogs: [], medications: [{ id: 'm1', name: 'Vitamin D' }],
      medicationPlans: [{ id: 'p1', active: true }],
      medicationScheduleSlots: [{ id: 's1', medicationId: 'm1', medicationPlanId: 'p1', weekdays: [0, 1, 2, 3, 4, 5, 6], hour: 8 }],
      medicationLogs: [],
    };
    assert.strictEqual(LB.dailySummaryDayIsEmpty(store, Y), false);
  });
  test('dailySummaryDayIsEmpty: a configured medication that is not due that weekday still counts as empty', () => {
    const wd = LB.isoWd(new Date(Y + 'T12:00:00'));
    const otherWd = (wd + 1) % 7;
    const store = {
      dailyLogs: [], medications: [{ id: 'm1', name: 'Vitamin D' }],
      medicationPlans: [{ id: 'p1', active: true }],
      medicationScheduleSlots: [{ id: 's1', medicationId: 'm1', medicationPlanId: 'p1', weekdays: [otherWd], hour: 8 }],
      medicationLogs: [],
    };
    assert.strictEqual(LB.dailySummaryDayIsEmpty(store, Y), true);
  });

  test('buildDailySummaryPayload: full day carries every field through', () => {
    const store = {
      dailyLogs: [{ date: Y, weight: 82.4, steps: 8000, calories: 2400, protein: 160, carbs: 230, fat: 75, waterMl: 2000, targetsSnap: { calories: 2400, dayType: 'training' }, adherence: 92, note: 'felt good' }],
      foodLogs: [{ date: Y, planned: false, foodName: 'Chicken', quantityG: 200, calories: 330 }, { date: Y, planned: true, foodName: 'Planned Rice' }],
      glucoseLogs: [{ date: Y, valueMmol: 5.2, context: 'fasted' }],
      bloodPressureLogs: [{ date: Y, systolic: 120, diastolic: 80 }],
      bodyTempLogs: [{ date: Y, valueC: 36.8 }],
      medications: [], medicationPlans: [], medicationScheduleSlots: [], medicationLogs: [],
    };
    const p = LB.buildDailySummaryPayload(store, Y);
    assert.strictEqual(p.weight, 82.4);
    assert.strictEqual(p.steps, 8000);
    assert.strictEqual(p.calories, 2400);
    assert.strictEqual(p.adherence, 92);
    assert.strictEqual(p.waterMl, 2000);
    assert.strictEqual(p.note, 'felt good');
    assert.deepStrictEqual(p.targets, { calories: 2400, dayType: 'training' });
    assert.strictEqual(p.foodItems.length, 1, 'the planned (not yet eaten) entry is excluded');
    assert.strictEqual(p.foodItems[0].name, 'Chicken');
    assert.strictEqual(p.glucose.length, 1);
    assert.strictEqual(p.bloodPressure.length, 1);
    assert.strictEqual(p.bodyTemp.length, 1);
  });
  test('buildDailySummaryPayload: partial day (weight only) leaves everything else null/empty', () => {
    const store = { dailyLogs: [{ date: Y, weight: 80 }], foodLogs: [], medications: [], medicationPlans: [], medicationScheduleSlots: [], medicationLogs: [] };
    const p = LB.buildDailySummaryPayload(store, Y);
    assert.strictEqual(p.weight, 80);
    assert.strictEqual(p.calories, null);
    assert.strictEqual(p.steps, null);
    assert.deepStrictEqual(p.foodItems, []);
    assert.strictEqual(p.targets, null);
  });
  test('buildDailySummaryPayload: 14-day weight trend is ascending, nulls excluded, this day inclusive', () => {
    const store = {
      dailyLogs: [
        { date: '2026-07-20', weight: 81 },
        { date: '2026-07-25', weight: null }, // logged day, no weight: excluded
        { date: '2026-07-23', weight: 80.5 },
        { date: Y, weight: 80 },
        { date: '2026-06-01', weight: 90 }, // way outside the 14-day window
      ],
      foodLogs: [], medications: [], medicationPlans: [], medicationScheduleSlots: [], medicationLogs: [],
    };
    const p = LB.buildDailySummaryPayload(store, Y);
    assert.deepStrictEqual(p.weightTrend.map(x => x.date), ['2026-07-20', '2026-07-23', Y], 'ascending, null-weight day and the out-of-window day both dropped');
  });
  test('buildDailySummaryPayload: sick/vacation/deload days drop out of the weight trend', () => {
    const store = {
      dailyLogs: [
        { date: '2026-07-20', weight: 81 },
        { date: '2026-07-22', weight: 100 }, // sick day, wildly off, must be excluded even though it has a logged weight
        { date: '2026-07-23', weight: 80.5 },
        { date: Y, weight: 80 },
      ],
      // Generous 2-day UTC span bracketing the 22nd (same margin the
      // estimateAdaptiveTdee sick-day test above uses): keeps this
      // timezone-robust, the exact statusModeForDate boundary check isn't
      // what this test is about.
      statusPeriods: [{ mode: 'sick', startedAt: '2026-07-21T00:00:00.000Z', endedAt: '2026-07-23T00:00:00.000Z' }],
      foodLogs: [], medications: [], medicationPlans: [], medicationScheduleSlots: [], medicationLogs: [],
    };
    const p = LB.buildDailySummaryPayload(store, Y);
    assert.deepStrictEqual(p.weightTrend.map(x => x.date), ['2026-07-20', '2026-07-23', Y], 'only the sick day is dropped, same exclusion estimateAdaptiveTdee already applies to this signal');
  });
  test('buildDailySummaryPayload: goal passes through from macroCalc, null when unset', () => {
    const store = { dailyLogs: [{ date: Y, weight: 80 }], foodLogs: [], medications: [], medicationPlans: [], medicationScheduleSlots: [], medicationLogs: [] };
    assert.strictEqual(LB.buildDailySummaryPayload(store, Y).goal, null, 'no macroCalc at all (never ran the estimator)');
    const storeWithGoal = { ...store, settings: { macroCalc: { goal: 'gain' } } };
    assert.strictEqual(LB.buildDailySummaryPayload(storeWithGoal, Y).goal, 'gain');
  });
  test('buildDailySummaryPayload: medication due/taken counts and names', () => {
    const wd = LB.isoWd(new Date(Y + 'T12:00:00'));
    const store = {
      dailyLogs: [], foodLogs: [],
      medications: [{ id: 'm1', name: 'Zinc' }, { id: 'm2', name: 'Magnesium' }],
      medicationPlans: [{ id: 'p1', active: true }, { id: 'p2', active: false }],
      medicationScheduleSlots: [
        { id: 's1', medicationId: 'm1', medicationPlanId: 'p1', weekdays: [wd], hour: 8 }, // due, active plan
        { id: 's2', medicationId: 'm2', medicationPlanId: 'p2', weekdays: [wd], hour: 9 }, // due weekday, but plan INACTIVE
      ],
      medicationLogs: [{ date: Y, scheduleSlotId: 's1', planned: false }], // taken
    };
    const p = LB.buildDailySummaryPayload(store, Y);
    assert.strictEqual(p.medsDue, 1, 'only the active-plan slot counts as due');
    assert.strictEqual(p.medsTaken, 1);
    assert.deepStrictEqual(p.medsTakenNames, ['Zinc']);
  });
  test('buildDailySummaryPayload: a due-but-unlogged dose counts toward due, not taken', () => {
    const wd = LB.isoWd(new Date(Y + 'T12:00:00'));
    const store = {
      dailyLogs: [], foodLogs: [],
      medications: [{ id: 'm1', name: 'Zinc' }],
      medicationPlans: [{ id: 'p1', active: true }],
      medicationScheduleSlots: [{ id: 's1', medicationId: 'm1', medicationPlanId: 'p1', weekdays: [wd], hour: 8 }],
      medicationLogs: [],
    };
    const p = LB.buildDailySummaryPayload(store, Y);
    assert.strictEqual(p.medsDue, 1);
    assert.strictEqual(p.medsTaken, 0);
    assert.deepStrictEqual(p.medsTakenNames, []);
  });
  test('buildDailySummaryPayload: a slot whose end date has already passed is not due', () => {
    const wd = LB.isoWd(new Date(Y + 'T12:00:00'));
    const store = {
      dailyLogs: [], foodLogs: [],
      medications: [{ id: 'm1', name: 'Zinc' }],
      medicationPlans: [{ id: 'p1', active: true }],
      medicationScheduleSlots: [{ id: 's1', medicationId: 'm1', medicationPlanId: 'p1', weekdays: [wd], hour: 8, endDate: '2026-01-01' }],
      medicationLogs: [],
    };
    assert.strictEqual(LB.buildDailySummaryPayload(store, Y).medsDue, 0);
  });

  test('dailySummaryDayIsEmpty: false when a session was trained, even with nothing else logged', () => {
    const store = { dailyLogs: [], sessions: [{ id: 's1', date: Y, ended: `${Y}T18:00:00Z`, entries: [] }] };
    assert.strictEqual(LB.dailySummaryDayIsEmpty(store, Y), false);
  });
  test('buildDailySummaryPayload: training carries the day\'s session and totals', () => {
    const store = {
      dailyLogs: [], foodLogs: [], medications: [], medicationPlans: [], medicationScheduleSlots: [], medicationLogs: [],
      exercises: [],
      sessions: [{
        id: 's1', dayId: 'd1', dayName: 'Push A', date: Y, ended: `${Y}T18:00:00Z`,
        durationMinutes: 55, feel: 'good',
        entries: [{
          exId: 'bench', name: 'Bench Press',
          sets: [
            { kg: 80, reps: 8, done: true },
            { kg: 80, reps: 8, done: true },
            { kg: 80, reps: 0, done: false, warmup: true }, // warm-up: dropped
            { kg: 80, reps: 0, done: false, skipped: true }, // skipped: dropped
          ],
        }],
      }],
    };
    const p = LB.buildDailySummaryPayload(store, Y);
    assert.strictEqual(p.training.length, 1);
    const t = p.training[0];
    assert.strictEqual(t.dayName, 'Push A');
    assert.strictEqual(t.durationMinutes, 55);
    assert.strictEqual(t.feel, 'good');
    assert.strictEqual(t.doneSets, 2, 'warm-up and skipped sets excluded');
    assert.strictEqual(t.volumeKg, 80 * 8 * 2);
    assert.strictEqual(t.highlights.length, 0, 'no comparison session, nothing to diff against');
    assert.strictEqual(t.comparison, null, 'no earlier session of this dayId to compare against');
  });
  test('buildDailySummaryPayload: training pairs with the most recent earlier session of the same dayId', () => {
    const store = {
      dailyLogs: [], foodLogs: [], medications: [], medicationPlans: [], medicationScheduleSlots: [], medicationLogs: [],
      exercises: [],
      sessions: [
        { id: 'old', dayId: 'd1', dayName: 'Push A', date: '2026-07-13', ended: '2026-07-13T18:00:00Z',
          entries: [{ exId: 'bench', name: 'Bench Press', sets: [{ kg: 75, reps: 8, done: true }] }] },
        { id: 'mid', dayId: 'd1', dayName: 'Push A', date: '2026-07-20', ended: '2026-07-20T18:00:00Z',
          entries: [{ exId: 'bench', name: 'Bench Press', sets: [{ kg: 77.5, reps: 8, done: true }] }] },
        { id: 'other-day', dayId: 'd2', dayName: 'Pull A', date: '2026-07-24', ended: '2026-07-24T18:00:00Z',
          entries: [{ exId: 'row', name: 'Row', sets: [{ kg: 60, reps: 10, done: true }] }] },
        { id: 'today', dayId: 'd1', dayName: 'Push A', date: Y, ended: `${Y}T18:00:00Z`,
          entries: [{ exId: 'bench', name: 'Bench Press', sets: [{ kg: 80, reps: 8, done: true }] }] },
      ],
    };
    const t = LB.buildDailySummaryPayload(store, Y).training[0];
    assert.ok(t.comparison, 'the nearer same-dayId session, not the other day\'s or the older one, wins');
    assert.strictEqual(t.comparison.date, '2026-07-20');
    assert.strictEqual(t.comparison.volumeKg, 77.5 * 8);
    assert.strictEqual(t.highlights.length, 1);
    assert.strictEqual(t.highlights[0].name, 'Bench Press');
    assert.strictEqual(t.highlights[0].pct, 3, '(640-620)/620 rounds to +3%');
  });
  test('buildDailySummaryPayload: training highlights cap at one riser + one faller, biggest movers win', () => {
    const store = {
      dailyLogs: [], foodLogs: [], medications: [], medicationPlans: [], medicationScheduleSlots: [], medicationLogs: [],
      exercises: [],
      sessions: [
        { id: 'prev', dayId: 'd1', dayName: 'Push A', date: '2026-07-20', ended: '2026-07-20T18:00:00Z',
          entries: [
            { exId: 'a', name: 'Big Riser', sets: [{ kg: 100, reps: 5, done: true }] },   // vol 500
            { exId: 'b', name: 'Big Faller', sets: [{ kg: 100, reps: 10, done: true }] }, // vol 1000
            { exId: 'c', name: 'Small Riser', sets: [{ kg: 50, reps: 10, done: true }] }, // vol 500
            { exId: 'd', name: 'Small Faller', sets: [{ kg: 60, reps: 10, done: true }] }, // vol 600
          ] },
        { id: 'today', dayId: 'd1', dayName: 'Push A', date: Y, ended: `${Y}T18:00:00Z`,
          entries: [
            { exId: 'a', name: 'Big Riser', sets: [{ kg: 130, reps: 5, done: true }] },   // vol 650, +30%
            { exId: 'b', name: 'Big Faller', sets: [{ kg: 80, reps: 10, done: true }] },  // vol 800, -20%
            { exId: 'c', name: 'Small Riser', sets: [{ kg: 52, reps: 10, done: true }] }, // vol 520, +4%
            { exId: 'd', name: 'Small Faller', sets: [{ kg: 55, reps: 10, done: true }] }, // vol 550, -8%
          ] },
      ],
    };
    const t = LB.buildDailySummaryPayload(store, Y).training[0];
    assert.strictEqual(t.highlights.length, 2, 'only the single biggest riser and biggest faller survive, not the smaller movers');
    assert.strictEqual(t.highlights[0].name, 'Big Riser');
    assert.strictEqual(t.highlights[0].pct, 30);
    assert.strictEqual(t.highlights[1].name, 'Big Faller');
    assert.strictEqual(t.highlights[1].pct, -20);
  });
  test('buildDailySummaryPayload: training comparison skips a deload session further back', () => {
    const store = {
      dailyLogs: [], foodLogs: [], medications: [], medicationPlans: [], medicationScheduleSlots: [], medicationLogs: [],
      exercises: [],
      sessions: [
        { id: 'normal', dayId: 'd1', dayName: 'Push A', date: '2026-07-13', ended: '2026-07-13T18:00:00Z',
          entries: [{ exId: 'bench', name: 'Bench Press', sets: [{ kg: 77.5, reps: 8, done: true }] }] },
        { id: 'deload', dayId: 'd1', dayName: 'Push A', date: '2026-07-20', ended: '2026-07-20T18:00:00Z', isDeload: true,
          entries: [{ exId: 'bench', name: 'Bench Press', sets: [{ kg: 50, reps: 8, done: true }] }] },
        { id: 'today', dayId: 'd1', dayName: 'Push A', date: Y, ended: `${Y}T18:00:00Z`,
          entries: [{ exId: 'bench', name: 'Bench Press', sets: [{ kg: 80, reps: 8, done: true }] }] },
      ],
    };
    const t = LB.buildDailySummaryPayload(store, Y).training[0];
    assert.strictEqual(t.comparison.date, '2026-07-13', 'the deload week is skipped as a comparison baseline');
  });
  test('buildDailySummaryPayload: no training key present when nothing was trained that day', () => {
    const store = { dailyLogs: [{ date: Y, weight: 80 }], foodLogs: [], medications: [], medicationPlans: [], medicationScheduleSlots: [], medicationLogs: [] };
    assert.strictEqual(LB.buildDailySummaryPayload(store, Y).training.length, 0);
  });

  test('dailySummaryDayIsEmpty: false when only cardio was logged, even with nothing else', () => {
    const store = { dailyLogs: [], cardioLogs: [{ date: Y, type: 'Running', durationMinutes: 30 }] };
    assert.strictEqual(LB.dailySummaryDayIsEmpty(store, Y), false);
  });
  test('buildDailySummaryPayload: cardio carries type, duration, formatted distance, effort and time', () => {
    const store = {
      dailyLogs: [], foodLogs: [], medications: [], medicationPlans: [], medicationScheduleSlots: [], medicationLogs: [],
      cardioLogs: [{
        id: 'c1', date: Y, type: 'Running', durationMinutes: 32, distanceM: 5200,
        effort: 7, paceFeeling: 4, note: 'felt good', createdAt: `${Y}T07:15:00Z`,
      }],
    };
    const p = LB.buildDailySummaryPayload(store, Y);
    assert.strictEqual(p.cardio.length, 1);
    const c = p.cardio[0];
    assert.strictEqual(c.type, 'Running');
    assert.strictEqual(c.durationMinutes, 32);
    assert.strictEqual(c.distance, '5.2 km', 'default km, no logbook-cardio-dist-unit set');
    assert.strictEqual(c.effort, 7);
    assert.strictEqual(c.paceFeeling, 4);
    assert.strictEqual(c.note, 'felt good');
    assert.ok(/^\d{2}:\d{2}$/.test(c.time), 'zero-padded HH:MM, exact value depends on the local timezone');
  });
  test('buildDailySummaryPayload: cardio time is null for a backdated entry (logged a different day than it happened)', () => {
    const store = {
      dailyLogs: [], foodLogs: [], medications: [], medicationPlans: [], medicationScheduleSlots: [], medicationLogs: [],
      // Dated for Y (yesterday's forgotten run), but actually saved a month
      // later (far enough out to be unambiguous in any timezone): attaching
      // that save time to Y's session would be wrong, not just imprecise,
      // so time must come back null rather than guess.
      cardioLogs: [{ id: 'c1', date: Y, type: 'Running', durationMinutes: 30, createdAt: '2026-08-27T12:00:00Z' }],
    };
    const c = LB.buildDailySummaryPayload(store, Y).cardio[0];
    assert.strictEqual(c.time, null, 'createdAt falls on a different calendar day than Y');
  });
  test('buildDailySummaryPayload: cardio time/distance are null without a timestamp/distance logged', () => {
    const store = {
      dailyLogs: [], foodLogs: [], medications: [], medicationPlans: [], medicationScheduleSlots: [], medicationLogs: [],
      cardioLogs: [{ id: 'c1', date: Y, type: 'Cycling', durationMinutes: 45 }],
    };
    const c = LB.buildDailySummaryPayload(store, Y).cardio[0];
    assert.strictEqual(c.time, null);
    assert.strictEqual(c.distance, null, 'no distanceM logged');
  });
  test('buildDailySummaryPayload: no cardio entries on a day none was logged', () => {
    const store = { dailyLogs: [{ date: Y, weight: 80 }], foodLogs: [], medications: [], medicationPlans: [], medicationScheduleSlots: [], medicationLogs: [] };
    assert.strictEqual(LB.buildDailySummaryPayload(store, Y).cardio.length, 0);
  });

  test('splitHeadlineBody: splits on the first newline, trims each part', () => {
    const { headline, body } = LB.splitHeadlineBody('Solid day\n\nWeight is trending down, keep it up.');
    assert.strictEqual(headline, 'Solid day');
    assert.strictEqual(body, 'Weight is trending down, keep it up.');
  });
  test('splitHeadlineBody: no newline at all -> no headline, the whole text is the body', () => {
    const { headline, body } = LB.splitHeadlineBody('Just one continuous sentence with no break at all.');
    assert.strictEqual(headline, null);
    assert.strictEqual(body, 'Just one continuous sentence with no break at all.');
  });
  test('splitHeadlineBody: empty/missing text does not throw', () => {
    // Field-by-field, not deepStrictEqual on the whole object: a plain object
    // constructed INSIDE the vm sandbox has a different Object.prototype than
    // one built here, so a whole-object deepStrictEqual fails on identity
    // even when every field matches (arrays of primitives don't have this
    // issue, which is why other deepStrictEqual calls in this file are fine).
    const a = LB.splitHeadlineBody('');
    assert.strictEqual(a.headline, null);
    assert.strictEqual(a.body, '');
    const b = LB.splitHeadlineBody(undefined);
    assert.strictEqual(b.headline, null);
    assert.strictEqual(b.body, '');
  });

  await testAsync('generateDailySummary: a mocked success response parses summary + generatedAt', async () => {
    testSession = { access_token: 'fake-token' };
    testFetch = async () => ({ ok: true, json: async () => ({ summary: 'Headline\n\nBody text.', generatedAt: '2026-07-28T00:00:00.000Z' }) });
    const res = await LB.generateDailySummary({ date: Y });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.summary, 'Headline\n\nBody text.');
    assert.strictEqual(res.generatedAt, '2026-07-28T00:00:00.000Z');
  });
  await testAsync('generateDailySummary: a mocked failure response surfaces the error, does not throw', async () => {
    testSession = { access_token: 'fake-token' };
    testFetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'Summary writer failed (500). Try again.' }) });
    const res = await LB.generateDailySummary({ date: Y });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error, 'Summary writer failed (500). Try again.');
  });
  await testAsync('generateDailySummary: no session (signed out) reports a network error, does not throw', async () => {
    testSession = null;
    const res = await LB.generateDailySummary({ date: Y });
    assert.strictEqual(res.ok, false);
  });
  testSession = null; // restore the default for any test appended after this block

  // ── AI Coach opinion on a check-in ───────────────────────────────────────
  // generateCheckinOpinion mirrors generateDailySummary's exact shape (only
  // a checkinId is sent, the Edge Function itself does the reads/prompt
  // building server-side using the caller's own token, per the auth design
  // in ai-checkin-opinion/index.ts), so the client-side test surface is the
  // same three cases.
  await testAsync('generateCheckinOpinion: a mocked success response parses opinion + generatedAt', async () => {
    testSession = { access_token: 'fake-token' };
    testFetch = async () => ({ ok: true, json: async () => ({ opinion: 'Solid week\n\nKeep this up.', generatedAt: '2026-07-28T00:00:00.000Z' }) });
    const res = await LB.generateCheckinOpinion('ci1');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.opinion, 'Solid week\n\nKeep this up.');
    assert.strictEqual(res.generatedAt, '2026-07-28T00:00:00.000Z');
  });
  await testAsync('generateCheckinOpinion: a mocked failure response surfaces the error, does not throw', async () => {
    testSession = { access_token: 'fake-token' };
    testFetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'Check-in not found, or you are not authorized to view it.' }) });
    const res = await LB.generateCheckinOpinion('ci1');
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error, 'Check-in not found, or you are not authorized to view it.');
  });
  await testAsync('generateCheckinOpinion: no session (signed out) reports a network error, does not throw', async () => {
    testSession = null;
    const res = await LB.generateCheckinOpinion('ci1');
    assert.strictEqual(res.ok, false);
  });
  testSession = null; // restore the default for any test appended after this block

  // ── Bodyweight + added load ────────────────────────────────────────────────
  // kg keeps the TOTAL so e1RM/PR/volume are untouched; addedKg is what the user
  // typed. These guard the split staying consistent in both directions.
  const bwPlusStore = {
    exercises: [
      { id: 'pu', equipment: 'bodyweight', bodyweight_mode: 'plus_load', log_mode: 'weight' },
      { id: 'dip', equipment: 'bodyweight', bodyweight_mode: 'pull', log_mode: 'weight' },
      { id: 'legacy', equipment: 'bodyweight', pull_bodyweight: true, log_mode: 'weight' },
      { id: 'plain', equipment: 'bodyweight', log_mode: 'weight' },
      { id: 'bar', equipment: 'dual_plates', log_mode: 'weight' },
    ],
    dailyLogs: [{ date: '2026-08-01', weight: 80 }],
    settings: {},
  };
  test('bodyweightMode: reads the new column', () => {
    assert.strictEqual(LB.bodyweightMode(bwPlusStore.exercises[0]), 'plus_load');
    assert.strictEqual(LB.bodyweightMode(bwPlusStore.exercises[1]), 'pull');
  });
  test('bodyweightMode: falls back to the legacy boolean', () => {
    assert.strictEqual(LB.bodyweightMode(bwPlusStore.exercises[2]), 'pull');
  });
  test('bodyweightMode: null for a plain bodyweight exercise and for non-bodyweight gear', () => {
    assert.strictEqual(LB.bodyweightMode(bwPlusStore.exercises[3]), null);
    assert.strictEqual(LB.bodyweightMode({ equipment: 'dual_plates', bodyweight_mode: 'plus_load' }), null);
  });
  test('shouldPullBodyweight: true for pull, false for plus_load', () => {
    // plus_load must NOT pre-fill the field with bodyweight: the field holds the
    // belt load, so pre-filling 80 there would log 160 total.
    assert.strictEqual(LB.shouldPullBodyweight(bwPlusStore.exercises[1]), true);
    assert.strictEqual(LB.shouldPullBodyweight(bwPlusStore.exercises[0]), false);
  });
  test('isBodyweightPlusLoad: only for the plus_load mode', () => {
    assert.strictEqual(LB.isBodyweightPlusLoad(bwPlusStore.exercises[0]), true);
    assert.strictEqual(LB.isBodyweightPlusLoad(bwPlusStore.exercises[1]), false);
  });
  test('setLoadLabel: belt load for a plus_load set, plain weight otherwise', () => {
    assert.strictEqual(LB.setLoadLabel({ kg: 90, addedKg: 10 }), '+10');
    assert.strictEqual(LB.setLoadLabel({ kg: 90 }), '90');
    assert.strictEqual(LB.setLoadLabel({ kg: null }), null);
    assert.strictEqual(LB.setLoadLabel(null), null);
  });
  test('setLoadLabel: a zero added load still reads as +0, not as the total', () => {
    // Bodyweight-only set on a plus_load exercise: the belt was empty, and it
    // must not suddenly render as "80".
    assert.strictEqual(LB.setLoadLabel({ kg: 80, addedKg: 0 }), '+0');
  });
  test('splitBodyweightLoad: recovers the frozen bodyweight from the stored pair', () => {
    const r = LB.splitBodyweightLoad({ kg: 90, addedKg: 10 });
    assert.strictEqual(r.total, 90); assert.strictEqual(r.added, 10); assert.strictEqual(r.base, 80);
  });
  test('splitBodyweightLoad: a set with no addedKg is all bodyweight', () => {
    const r = LB.splitBodyweightLoad({ kg: 82 });
    assert.strictEqual(r.total, 82); assert.strictEqual(r.added, null); assert.strictEqual(r.base, 82);
  });
  test('buildSeedSets: plus_load repeats the belt load and rebuilds the total from today', () => {
    // Last session: 78 kg bodyweight + 10 on the belt = 88 total.
    // Today the user weighs 80, so the same belt load is 90 total.
    const it = { sets: 1, exId: 'pu', reps: 8 };
    const last = { entry: { sets: [{ warmup: false, kg: 88, addedKg: 10, reps: 8, done: true }] } };
    const seeded = LB.buildSeedSets(it, last, null, false, bwPlusStore, null);
    assert.strictEqual(seeded[0].addedKg, 10);
    assert.strictEqual(seeded[0].kg, 90);
  });
  test('buildSeedSets: plus_load with no previous belt load seeds empty, not a bare bodyweight', () => {
    const it = { sets: 1, exId: 'pu', reps: 8 };
    const last = { entry: { sets: [{ warmup: false, kg: 80, reps: 8, done: true }] } };
    const seeded = LB.buildSeedSets(it, last, null, false, bwPlusStore, null);
    assert.strictEqual(seeded[0].addedKg, null);
    assert.strictEqual(seeded[0].kg, null);
  });
  test('buildSeedSets: a normal exercise is untouched by the plus_load path', () => {
    const it = { sets: 1, exId: 'bar', reps: 8 };
    const last = { entry: { sets: [{ warmup: false, kg: 100, reps: 8, done: true }] } };
    const seeded = LB.buildSeedSets(it, last, null, false, bwPlusStore, null);
    assert.strictEqual(seeded[0].kg, 100);
    assert.strictEqual(seeded[0].addedKg, undefined);
  });

  // ── Cleanup week (migration 0251) ────────────────────────────────────────
  // The deload overlay's sibling: same reduction mechanics, opposite relation
  // to the progression chain (the reduced loads stay in it).
  const cleanupStore = {
    exercises: [
      { id: 'bar', name: 'Barbell Row', equipment: 'barbell' },
      { id: 'dip', name: 'Assisted Dip', equipment: 'machine', movement_type: 'assisted' },
      { id: 'bw',  name: 'Pull-up', equipment: 'bodyweight' },
      { id: 'run', name: 'Treadmill', movement_type: 'cardio' },
      { id: 'hold', name: 'Plank', log_mode: 'time' },
    ],
    settings: {},
  };
  const cleanupLast = (kg) => ({ entry: { sets: [{ warmup: false, kg, reps: 8, done: true }] } });

  test('cleanupAppliesToExercise: the exemptions match buildSeedSets exactly', () => {
    // The single source of truth for "was this lift actually reduced", shared
    // by the live opt-out chip and the post-hoc PR/regression suppression in
    // session detail/compare. Every buildSeedSets exemption above must agree
    // with this predicate, or the chip and the read-only views would disagree
    // about which exercises a cleanup week touched.
    assert.strictEqual(LB.cleanupAppliesToExercise(cleanupStore, 'bar', null), true);
    assert.strictEqual(LB.cleanupAppliesToExercise(cleanupStore, 'dip', null), false, 'assisted is exempt');
    assert.strictEqual(LB.cleanupAppliesToExercise(cleanupStore, 'bw', null), false, 'bodyweight is exempt');
    assert.strictEqual(LB.cleanupAppliesToExercise(cleanupStore, 'run', null), false, 'cardio is exempt');
    assert.strictEqual(LB.cleanupAppliesToExercise(cleanupStore, 'hold', null), false, 'time-based is exempt');
    assert.strictEqual(LB.cleanupAppliesToExercise(cleanupStore, null, null), false, 'no exId');
    assert.strictEqual(LB.cleanupAppliesToExercise(cleanupStore, 'nope', null), false, 'unknown exId');
  });
  test('cleanupAppliesToExercise: a 5/3/1 main lift is exempt, its assistance work is not', () => {
    // buildSeedSets never even sees a 531 main lift (buildSessionEntries seeds
    // it straight off the Training Max), so this is the one exemption
    // buildSeedSets itself has no matching branch for.
    const store531 = {
      ...cleanupStore,
      schedules: [{ id: 'p531', program_type: '531', days: [{ id: 'd1', items: [{ exId: 'bar' }] }],
        program_data: { mainLifts: { bar: { tm: 100, kind: 'row', stall: 0 } } } }],
    };
    assert.strictEqual(LB.cleanupAppliesToExercise(store531, 'bar', 'd1'), false, 'the main lift itself');
    assert.strictEqual(LB.cleanupAppliesToExercise(store531, 'dip', 'd1'), false, 'assisted, exempt for its own reason');
    // A different exId on the same day that never got registered as a main
    // lift is unaffected, still reduced normally, only 'bar' is exempt here.
    const storeAssistExtra = { ...store531, exercises: [...store531.exercises, { id: 'assist_bar', equipment: 'barbell' }],
      schedules: [{ ...store531.schedules[0], days: [{ id: 'd1', items: [{ exId: 'bar' }, { exId: 'assist_bar' }] }] }] };
    assert.strictEqual(LB.cleanupAppliesToExercise(storeAssistExtra, 'assist_bar', 'd1'), true);
  });

  test('buildSeedSets: cleanup reduces by the configured percent, on the 2.5 grid', () => {
    const seeded = LB.buildSeedSets({ sets: 1, exId: 'bar', reps: 8 }, cleanupLast(100), null, false,
      cleanupStore, null, null, { percent: 20 });
    assert.strictEqual(seeded[0].kg, 80);
  });
  test('buildSeedSets: cleanup rounds to the 2.5 grid like a deload does', () => {
    // 97.5 * 0.8 = 78 -> 77.5 on the grid.
    const seeded = LB.buildSeedSets({ sets: 1, exId: 'bar', reps: 8 }, cleanupLast(97.5), null, false,
      cleanupStore, null, null, { percent: 20 });
    assert.strictEqual(seeded[0].kg, 77.5);
  });
  test('buildSeedSets: cleanup reduces the LAST load, not the progression suggestion', () => {
    // Same trap the deload path guards: 100 kg with a +5 suggestion must seed
    // 80, not 84. Mirrors the deload comment on the baseKg line.
    const seeded = LB.buildSeedSets({ sets: 1, exId: 'bar', reps: 8 }, cleanupLast(100),
      { kg: 105, reps: 8 }, false, cleanupStore, null, null, { percent: 20 });
    assert.strictEqual(seeded[0].kg, 80);
  });
  test('buildSeedSets: cleanup percent is clamped to 10-30 either way', () => {
    const tooLow = LB.buildSeedSets({ sets: 1, exId: 'bar', reps: 8 }, cleanupLast(100), null, false,
      cleanupStore, null, null, { percent: 5 });
    assert.strictEqual(tooLow[0].kg, 90, '5% clamps up to 10%');
    const tooHigh = LB.buildSeedSets({ sets: 1, exId: 'bar', reps: 8 }, cleanupLast(100), null, false,
      cleanupStore, null, null, { percent: 40 });
    assert.strictEqual(tooHigh[0].kg, 70, '40% clamps down to 30%');
  });
  test('buildSeedSets: an opted-out exercise seeds its full load', () => {
    const seeded = LB.buildSeedSets({ sets: 1, exId: 'bar', reps: 8 }, cleanupLast(100), null, false,
      cleanupStore, null, null, { percent: 20, optOuts: { bar: true } });
    assert.strictEqual(seeded[0].kg, 100);
  });
  test('buildSeedSets: an opt-out on ANOTHER exercise does not leak across', () => {
    const seeded = LB.buildSeedSets({ sets: 1, exId: 'bar', reps: 8 }, cleanupLast(100), null, false,
      cleanupStore, null, null, { percent: 20, optOuts: { dip: true } });
    assert.strictEqual(seeded[0].kg, 80);
  });
  test('buildSeedSets: cleanup leaves assisted loads alone (reducing them makes it harder)', () => {
    const seeded = LB.buildSeedSets({ sets: 1, exId: 'dip', reps: 8 }, cleanupLast(-40), null, false,
      cleanupStore, null, null, { percent: 20 });
    assert.strictEqual(seeded[0].kg, -40);
  });
  test('buildSeedSets: cleanup leaves a bodyweight seed alone', () => {
    const seeded = LB.buildSeedSets({ sets: 1, exId: 'bw', reps: 8 }, cleanupLast(80), null, false,
      cleanupStore, 80, null, { percent: 20 });
    assert.strictEqual(seeded[0].kg, 80);
  });
  test('buildSeedSets: a reduced plus_load set records the load it was reduced FROM', () => {
    // The floor in withPlusLoad is lossy: once the belt clamps to 0 the stored
    // pair is (bodyweight, +0) whatever the real belt was. The cleanup opt-out
    // has to undo the reduction, and it used to do that by multiplying the
    // stored total back up, which invents bodyweight * (1/f - 1). At 80 kg and
    // 20 percent every belt from 0 to 15 came back as +20, so a bare pull-up
    // was prescribed as a 20 kg weighted one. cleanupFullLoad is the recorded
    // answer that makes the toggle a lookup instead of a reconstruction.
    const store = {
      exercises: [{ id: 'wpu', equipment: 'bodyweight', bodyweight_mode: 'plus_load', log_mode: 'weight' }],
      dailyLogs: [{ date: LB.todayISO(), weight: 80 }],
      settings: {}, sessions: [],
    };
    const lastWith = (belt) => ({ entry: { sets: [{ warmup: false, kg: 80 + belt, addedKg: belt, reps: 8, done: true }] } });
    const seed = (belt, cleanupOpts) =>
      LB.buildSeedSets({ sets: 1, exId: 'wpu', reps: 8 }, lastWith(belt), null, false, store, null, null, cleanupOpts)[0];

    // The invariant the toggle rests on, across the whole floored range and
    // beyond it: re-applying the factor to the recorded full load has to land
    // back on exactly what was seeded, and the recorded load has to equal what
    // the seeder itself produces for the opted-out state.
    for (const belt of [0, 2.5, 5, 7.5, 10, 15, 20, 25, 30]) {
      const reduced = seed(belt, { percent: 20 });
      const full = reduced.cleanupFullLoad;
      assert.ok(full, `belt +${belt}: no cleanupFullLoad recorded`);
      const truth = seed(belt, { percent: 20, optOuts: { wpu: true } });
      assert.strictEqual(full.kg, truth.kg, `belt +${belt}: recorded total`);
      assert.strictEqual(full.addedKg ?? null, truth.addedKg ?? null, `belt +${belt}: recorded belt`);
      // And back down again, the arithmetic the toggle runs.
      const bw = Math.round((full.kg - (full.addedKg ?? 0)) * 100) / 100;
      const target = Math.round((full.kg * 0.8) / 2.5) * 2.5;
      const belt2 = Math.max(0, Math.round((target - bw) * 100) / 100);
      assert.strictEqual(Math.round((bw + belt2) * 100) / 100, reduced.kg, `belt +${belt}: round trip total`);
      assert.strictEqual(belt2, reduced.addedKg, `belt +${belt}: round trip belt`);
    }
    // No reduction, nothing to record: the field must not appear, or the toggle
    // would restore a "full load" onto a set that was never reduced.
    assert.strictEqual(seed(10, null).cleanupFullLoad, undefined);
  });

  test('buildSeedSets: a bodyweight lift is exempt however the caller was called', () => {
    // This is the hole the test above could not see. It hands over
    // bodyweightKg = 80, and the old gate inferred "nothing to reduce" from
    // that argument alone, so the assertion passed for the wrong reason and
    // kept passing after the session-start callers stopped supplying a weight
    // for this exact exercise (bodyweight_mode null, the default every catalog
    // import stamps). Reducing a Pull-Up to 64 kg is not a lighter week, it is
    // a number the lifter cannot act on.
    const noBw = LB.buildSeedSets({ sets: 1, exId: 'bw', reps: 8 }, cleanupLast(80), null, false,
      cleanupStore, null, null, { percent: 20 });
    assert.strictEqual(noBw[0].kg, 80, 'cleanup must not touch it with no bodyweight passed');
    const deloaded = LB.buildSeedSets({ sets: 1, exId: 'bw', reps: 8 }, cleanupLast(80), null, false,
      cleanupStore, null, true, null);
    assert.strictEqual(deloaded[0].kg, 80, 'and neither must a deload');
    // The invariant the pair above exists to protect: buildSeedSets and the
    // predicate that decides whether the opt-out row renders have to agree, or
    // a reduced set has no control that can restore it.
    assert.strictEqual(LB.cleanupAppliesToExercise(cleanupStore, 'bw', null), false);
  });
  test('buildSeedSets: deload still wins over a cleanup config', () => {
    const seeded = LB.buildSeedSets({ sets: 1, exId: 'bar', reps: 8 }, cleanupLast(100), null, false,
      cleanupStore, null, true, { percent: 20 });
    assert.strictEqual(seeded[0].kg, 50);
  });
  test('buildSeedSets: cleanupOpts false means "not in a cleanup", not "use the global"', () => {
    // What a coach preview passes for a client who isn't in a cleanup. If this
    // read as null the viewer's own window.__CLEANUP would leak into the seeds.
    storeWindow.__CLEANUP = { percent: 30 };
    try {
      const seeded = LB.buildSeedSets({ sets: 1, exId: 'bar', reps: 8 }, cleanupLast(100), null, false,
        cleanupStore, null, null, false);
      assert.strictEqual(seeded[0].kg, 100);
      const viaGlobal = LB.buildSeedSets({ sets: 1, exId: 'bar', reps: 8 }, cleanupLast(100), null, false,
        cleanupStore, null, null, null);
      assert.strictEqual(viaGlobal[0].kg, 70, 'null still falls back to the global');
    } finally { delete storeWindow.__CLEANUP; }
  });

  // Compounding guard: while a cleanup runs, its own sessions are hidden from
  // the seed history so session 2 doesn't seed off session 1's reduced load.
  const cleanupWindowState = {
    statusMode: 'cleanup',
    statusModeSince: '2026-06-10T00:00:00Z',
    sessions: [
      { id: 'pre', ended: '2026-06-09T11:00:00Z', startedAt: '2026-06-09T10:00:00Z', dayId: 'd1',
        entries: [{ exId: 'e1', sets: [{ kg: 100, reps: 8, done: true }] }] },
      { id: 'in',  ended: '2026-06-11T11:00:00Z', startedAt: '2026-06-11T10:00:00Z', dayId: 'd1',
        entries: [{ exId: 'e1', sets: [{ kg: 80, reps: 8, done: true }] }] },
    ],
  };
  test('recentSessionsForExercise: an active cleanup hides its own sessions', () => {
    const rows = LB.recentSessionsForExercise(cleanupWindowState, 'e1', 'd1');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].session.id, 'pre');
  });
  test('recentSessionsForExercise: once the cleanup ends they are the new baseline', () => {
    const after = { ...cleanupWindowState, statusMode: null, statusModeSince: null };
    const rows = LB.recentSessionsForExercise(after, 'e1', 'd1');
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].session.id, 'in', 'newest first, the cleanup session leads');
  });
  test('recentSessionsForExercise: a session started before the cleanup still counts', () => {
    const rows = LB.recentSessionsForExercise(cleanupWindowState, 'e1', 'd1');
    assert.ok(rows.some(r => r.session.id === 'pre'));
  });

  // Auto-end. deloadPlanDays falls back to 7 without a matching schedule.
  // Local-time literals (no trailing Z) throughout: the window is counted in
  // calendar days, so a UTC instant would land on a different local date (and
  // flip these assertions) depending on the timezone the tests run in.
  const cleanupClock = (sinceLocal) => ({ statusMode: 'cleanup', statusModeSince: sinceLocal, schedules: [], sessions: [] });
  test('cleanupElapsed: false before the week is up, true on the day it completes', () => {
    const since = '2026-06-01T20:00:00';
    assert.strictEqual(LB.cleanupElapsed(cleanupClock(since), new Date('2026-06-05T09:00:00')), false);
    assert.strictEqual(LB.cleanupElapsed(cleanupClock(since), new Date('2026-06-08T09:00:00')), true);
  });
  test('cleanupElapsed: the window flips at midnight, not at the activation time', () => {
    // Regression: counted as 24h units from the activation moment, a cleanup
    // started at 20:00 was still active all through the final day's morning,
    // so the first session of the cycle that should already be back to normal
    // still seeded reduced. Same calendar day, hours earlier, must be over.
    const since = '2026-06-01T20:00:00';
    assert.strictEqual(LB.cleanupElapsed(cleanupClock(since), new Date('2026-06-08T06:00:00')), true);
    // ...and the day before is still genuinely inside the window.
    assert.strictEqual(LB.cleanupElapsed(cleanupClock(since), new Date('2026-06-07T23:59:00')), false);
  });
  test('cleanupElapsed: false when no cleanup is running at all', () => {
    assert.strictEqual(LB.cleanupElapsed({ statusMode: null, statusModeSince: null }), false);
    assert.strictEqual(LB.cleanupElapsed({ statusMode: 'deload', statusModeSince: '2026-06-01T00:00:00' }), false);
  });
  test('cleanupDaysRemaining: counts down and clamps at 0', () => {
    const since = '2026-06-01T20:00:00';
    assert.strictEqual(LB.cleanupDaysRemaining(cleanupClock(since), new Date('2026-06-03T09:00:00')), 5);
    assert.strictEqual(LB.cleanupDaysRemaining(cleanupClock(since), new Date('2026-06-20T09:00:00')), 0);
  });
  // Start alignment: a cleanup covers a whole cycle, so it waits for the next
  // one rather than reducing the tail of the current one.
  const cyclePlanStore = (cycleStartDate, dayCount) => ({
    activeScheduleId: 'p1',
    cycleStartDate,
    schedules: [{ id: 'p1', days: Array.from({ length: dayCount }, (_, i) => ({ id: `d${i}`, name: `D${i}`, items: [{ exId: 'e1' }] })) }],
  });
  test('nextCleanupStartISO: an 8-day cycle started on day 8 begins tomorrow', () => {
    // cycleStartDate 2026-06-01 with 8 days: 2026-06-08 is day 8 (pos 7).
    const iso = LB.nextCleanupStartISO(cyclePlanStore('2026-06-01', 8), new Date('2026-06-08T18:00:00'));
    assert.strictEqual(LB.fmtISO(new Date(iso)), '2026-06-09');
  });
  test('nextCleanupStartISO: on day 1 it waits for the NEXT cycle, not today', () => {
    const iso = LB.nextCleanupStartISO(cyclePlanStore('2026-06-01', 8), new Date('2026-06-01T18:00:00'));
    assert.strictEqual(LB.fmtISO(new Date(iso)), '2026-06-09');
  });
  test('nextCleanupStartISO: lands on local midnight, so the window covers whole days', () => {
    const d = new Date(LB.nextCleanupStartISO(cyclePlanStore('2026-06-01', 8), new Date('2026-06-08T18:00:00')));
    assert.strictEqual(d.getHours(), 0);
    assert.strictEqual(d.getMinutes(), 0);
  });
  test('nextCleanupStartISO: a flex plan has no date boundary, so it starts now', () => {
    const flex = { activeScheduleId: 'p1', schedules: [{ id: 'p1', is_flex: true, sessions_per_week: 3, days: [{ id: 'a', items: [{ exId: 'e1' }] }] }] };
    assert.strictEqual(LB.nextCleanupStartISO(flex, new Date('2026-06-08T18:00:00')), null);
  });
  test('cleanupStarted: false while the start is still ahead, true from that day on', () => {
    const pending = { statusMode: 'cleanup', statusModeSince: '2026-06-09T00:00:00' };
    assert.strictEqual(LB.cleanupStarted(pending, new Date('2026-06-08T23:00:00')), false);
    assert.strictEqual(LB.cleanupStarted(pending, new Date('2026-06-09T00:30:00')), true);
    assert.strictEqual(LB.cleanupStarted(pending, new Date('2026-06-12T09:00:00')), true);
  });
  test('cleanupElapsed: a not-yet-started cleanup never counts as elapsed', () => {
    const pending = { statusMode: 'cleanup', statusModeSince: '2026-06-09T00:00:00', schedules: [], sessions: [] };
    assert.strictEqual(LB.cleanupElapsed(pending, new Date('2026-06-08T23:00:00')), false);
  });
  test('cleanupDaysRemaining: a pending cleanup still shows its full length', () => {
    const pending = { statusMode: 'cleanup', statusModeSince: '2026-06-09T00:00:00', schedules: [], sessions: [] };
    assert.strictEqual(LB.cleanupDaysRemaining(pending, new Date('2026-06-08T09:00:00')), 7);
  });

  test('cleanupDaysRemaining: agrees with cleanupElapsed on the final day', () => {
    // The label must not still promise a day left on the morning the overlay
    // ends (the two used to run off separately-rounded arithmetic).
    const since = '2026-06-01T20:00:00';
    const end = new Date('2026-06-08T06:00:00');
    assert.strictEqual(LB.cleanupDaysRemaining(cleanupClock(since), end), 0);
    assert.strictEqual(LB.cleanupElapsed(cleanupClock(since), end), true);
  });

  // The autoreg exclusions. All of these need an explicit !isCleanup because a
  // cleanup session keeps signalWeight 'full' on purpose (see detectStall).
  const cleanupHistory = (flag) => ({
    exerciseBests: {},
    sessions: [{ id: 's1', ended: '2026-06-09T10:00:00Z', dayId: 'd1', ...flag,
      entries: [{ exId: 'e1', sets: [{ kg: 100, reps: 5, done: true, timeSec: 60 }] }] }],
  });
  test('bestE1rmForExercise: a cleanup session is not a PR baseline', () => {
    assert.ok(LB.bestE1rmForExercise(cleanupHistory({}), 'e1') > 0);
    assert.strictEqual(LB.bestE1rmForExercise(cleanupHistory({ isCleanup: true }), 'e1'), 0);
  });
  test('bestAssistLoad: a cleanup session is not a PR baseline', () => {
    assert.strictEqual(LB.bestAssistLoad(cleanupHistory({}), 'e1'), 100);
    assert.strictEqual(LB.bestAssistLoad(cleanupHistory({ isCleanup: true }), 'e1'), null);
  });
  test('bestTimeForExercise: a cleanup session is not a PR baseline', () => {
    assert.strictEqual(LB.bestTimeForExercise(cleanupHistory({}), 'e1'), 60);
    assert.strictEqual(LB.bestTimeForExercise(cleanupHistory({ isCleanup: true }), 'e1'), null);
  });

  test('detectStall: cleanup sessions are excluded from the e1RM series', () => {
    // Four flat sessions would stall; flagging them all cleanup empties the
    // series instead, so nothing can read as a stall.
    const flatSessions = (flag) => [1, 2, 3, 4].map(i => ({
      id: `s${i}`, ended: `2026-06-0${i}T10:00:00Z`, scheduleId: 'p1', dayId: 'd1',
      signalWeight: 'full', ...flag,
      entries: [{ exId: 'e1', sets: [{ kg: 100, reps: 5, done: true }] }],
    }));
    const muscleOf = () => 'back';
    const opts = { planId: 'p1', dayId: 'd1', exName: 'Row' };
    assert.strictEqual(LB.detectStall(flatSessions({}), 'e1', muscleOf, opts).stalled, true,
      'control: flat full-signal sessions do stall');
    assert.strictEqual(LB.detectStall(flatSessions({ isCleanup: true }), 'e1', muscleOf, opts).stalled, false,
      'the same sessions flagged cleanup must not');
  });

  test('isMesoSessionEditable: a cleanup session stays editable (a deload does not)', () => {
    // A cleanup week is asked the same questions as any other week, so its recap
    // carries real answers and has to stay correctable. Only a deload, which
    // collects nothing at all, is locked out.
    const meso = { id: 'm1', scheduleId: 'p1', startedAt: '2026-06-01T00:00:00Z' };
    const base = { id: 's1', scheduleId: 'p1', ended: '2026-06-09T10:00:00Z',
      mesoRecap: { raw: { answers: {} } } };
    assert.strictEqual(LB.isMesoSessionEditable(base, [base], meso), true);
    const asCleanup = { ...base, isCleanup: true };
    assert.strictEqual(LB.isMesoSessionEditable(asCleanup, [asCleanup], meso), true);
    const asDeload = { ...base, isDeload: true };
    assert.strictEqual(LB.isMesoSessionEditable(asDeload, [asDeload], meso), false);
  });

  test('deriveSignalWeight: a readiness-only probe ignores a pinned signalWeight', () => {
    // How computeMesoGains' cutSignal and screens-lib's oldCut re-derive the cut
    // gate for a cleanup session: the STORED signalWeight is pinned 'full' for
    // detectOverreach, so the cut has to be read off the readiness answer alone.
    const pinned = { readiness: 'rough', signalWeight: 'full', isCleanup: true };
    assert.strictEqual(LB.deriveSignalWeight(pinned, false), 'full', 'the stored field still wins for the detector');
    assert.strictEqual(LB.deriveSignalWeight({ readiness: pinned.readiness }, false), 'discounted',
      'stripping it exposes the rough day the cut must honour');
    assert.strictEqual(LB.deriveSignalWeight({ readiness: 'reentry' }, false), 'discounted');
    assert.strictEqual(LB.deriveSignalWeight({ readiness: 'normal' }, false), 'full');
    assert.strictEqual(LB.deriveSignalWeight({ readiness: 'fresh' }, false), 'full');
  });

  test('recomputeMesoRepMissCut: a cleanup session re-arms its cut on a rough -> normal edit', () => {
    // The readiness edit of a pinned cleanup session must hand the readiness-derived
    // pair to the recompute, not the pinned 'full' twice: the latter is a same-side
    // no-op and would silently swallow the correction.
    const ms = { repMissCounts: { e1_d1: 1 }, weightBoosts: {} };
    const earnInputs = [{ key: 'e1_d1', increment: 2.5, earlyMiss: true, attempted: true }];
    const session = { readiness: 'rough', signalWeight: 'full', isCleanup: true };
    const oldCut = LB.deriveSignalWeight({ readiness: session.readiness }, false);
    const newCut = LB.deriveSignalWeight({ readiness: 'normal' }, false);
    const out = LB.recomputeMesoRepMissCut(ms, earnInputs, { e1_d1: 1 }, oldCut, newCut);
    assert.strictEqual(out.weightBoosts.e1_d1, -2.5, 'the cut lands once the rough answer is withdrawn');
    const noop = LB.recomputeMesoRepMissCut(ms, earnInputs, { e1_d1: 1 }, 'full', 'full');
    assert.strictEqual(noop, ms, 'control: passing the pinned value on both sides does nothing');
  });

  test('applyMesoFeedbackEdit: a low-pump edit counts toward the swap hint, cleanup included', () => {
    // A cleanup week is NOT exempt here: the reduced load tends to improve the pump
    // (better mind-muscle connection), so a flat pump during one is a stronger hint
    // that the exercise is a poor fit, not a weaker one. ctx carries no cleanup flag.
    const msOf = () => ({ deltas: {}, growthCounts: {}, pumpLowCounts: {}, jointFlags: {}, affinity: {} });
    const rawOf = () => ({
      answers: { soreness: {}, volume: {}, joint: { e1: { exId: 'e1', muscle: 'chest', answer: 'none', pump: 'moderate', pumpLowApplied: false, contrib: {} } } },
      negOwner: {}, frozen: false, dayId: 'd0',
    });
    const edit = { type: 'joint', subject: 'e1', answer: 'none', pump: 'low' };
    const out = LB.applyMesoFeedbackEdit(msOf(), rawOf(), edit, { dayId: 'd0', loadOnly: false });
    assert.strictEqual(out.mesoState.pumpLowCounts.e1, 1);
    assert.strictEqual(out.raw.answers.joint.e1.pump, 'low');
    // Idempotent: re-applying the same edit must not double-count.
    const again = LB.applyMesoFeedbackEdit(out.mesoState, out.raw, edit, { dayId: 'd0', loadOnly: false });
    assert.strictEqual(again.mesoState.pumpLowCounts.e1, 1);
  });

  // ── Food masses: grams canonical, oz/lb display for imperial viewers ─────
  test('gToOz/ozToG: a round trip survives to well under a tenth of a gram', () => {
    for (const g of [1, 5, 62, 100, 248, 453.59237, 1000, 2500]) {
      assert.ok(Math.abs(LB.ozToG(LB.gToOz(g)) - g) < 0.001, `${g}g round-trips`);
    }
    assert.strictEqual(Math.round(LB.gToOz(LB.LB_G)), 16, 'a pound is 16 ounces');
    assert.strictEqual(LB.gToOz(0), 0);
    assert.strictEqual(LB.ozToG(null), 0, 'null reads as zero, not NaN');
  });

  test('formatMassG: metric steps up to kg at 1000g', () => {
    assert.strictEqual(LB.formatMassG(248, false), '248g');
    assert.strictEqual(LB.formatMassG(62.4, false), '62.4g');
    assert.strictEqual(LB.formatMassG(999, false), '999g');
    assert.strictEqual(LB.formatMassG(1000, false), '1kg', 'no trailing zeros');
    assert.strictEqual(LB.formatMassG(1250, false), '1.25kg');
    assert.strictEqual(LB.formatMassG(0, false), '0g');
    // Float noise from summing many logged quantities must not leak through.
    assert.strictEqual(LB.formatMassG(741.2300000000001, false), '741.2g');
    // The step-up is decided on the ROUNDED value, so this is 1kg, not "1000g".
    assert.strictEqual(LB.formatMassG(999.96, false), '1kg');
  });

  test('formatMassG: imperial steps up to lb at one pound', () => {
    assert.strictEqual(LB.formatMassG(28.349523125, true), '1 oz');
    assert.strictEqual(LB.formatMassG(248, true), '8.75 oz');
    assert.strictEqual(LB.formatMassG(LB.LB_G - 1, true), '15.96 oz', 'just under a pound stays oz');
    assert.strictEqual(LB.formatMassG(LB.LB_G, true), '1 lb');
    assert.strictEqual(LB.formatMassG(1000, true), '2.2 lb');
    assert.strictEqual(LB.formatMassG(0, true), '0 oz');
  });

  test('roundShoppingQty: the metric grid is unchanged (5g under 50g, else 25g)', () => {
    assert.strictEqual(LB.roundShoppingQty(12, false).text, '10g');
    assert.strictEqual(LB.roundShoppingQty(13, false).text, '15g');
    assert.strictEqual(LB.roundShoppingQty(240, false).text, '250g');
    // Decided off the ROUNDED value, so 990 becomes 1kg rather than "1000g".
    assert.strictEqual(LB.roundShoppingQty(990, false).text, '1kg');
    assert.strictEqual(LB.roundShoppingQty(0, false).text, '0g');
    assert.strictEqual(LB.roundShoppingQty(1, false).text, '5g', 'never rounds a real need to nothing');
  });

  test('roundShoppingQty: the imperial grid is native, not a converted metric one', () => {
    // Under 2oz: quarter ounces, so spice-sized amounts stay reachable.
    assert.strictEqual(LB.roundShoppingQty(5, true).text, '0.25 oz');
    assert.strictEqual(LB.roundShoppingQty(20, true).text, '0.75 oz');
    // 2 to 16oz: half ounces.
    assert.strictEqual(LB.roundShoppingQty(100, true).text, '3.5 oz');
    assert.strictEqual(LB.roundShoppingQty(248, true).text, '8.5 oz');
    // A pound and up: quarter pounds.
    assert.strictEqual(LB.roundShoppingQty(500, true).text, '1 lb');
    assert.strictEqual(LB.roundShoppingQty(1000, true).text, '2.25 lb');
    assert.strictEqual(LB.roundShoppingQty(0, true).text, '0 oz');
    assert.strictEqual(LB.roundShoppingQty(1, true).text, '0.25 oz', 'never rounds a real need to nothing');
  });

  test('roundShoppingQty: grams comes back so the buy quantity needs no re-parse', () => {
    assert.strictEqual(LB.roundShoppingQty(240, false).grams, 250);
    const imperial = LB.roundShoppingQty(248, true);
    assert.strictEqual(imperial.text, '8.5 oz');
    assert.ok(Math.abs(imperial.grams - LB.ozToG(8.5)) < 0.001, 'grams matches the label it printed');
  });


  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
