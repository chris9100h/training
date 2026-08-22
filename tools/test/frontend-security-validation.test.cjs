const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function extractFunction(source, name) {
  const functionStart = source.indexOf(`function ${name}`);
  assert.notEqual(functionStart, -1, `function ${name} must exist`);
  const asyncStart = source.lastIndexOf('async ', functionStart);
  const start = asyncStart >= 0 && asyncStart + 6 === functionStart ? asyncStart : functionStart;
  const paramsStart = source.indexOf('(', start);
  let paramsDepth = 0;
  let bodyStart = -1;
  let paramsQuote = null;
  let paramsEscaped = false;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (paramsQuote) {
      if (paramsEscaped) { paramsEscaped = false; continue; }
      if (char === '\\') { paramsEscaped = true; continue; }
      if (char === paramsQuote) paramsQuote = null;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') { paramsQuote = char; continue; }
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) { bodyStart = source.indexOf('{', index); break; }
    }
  }
  assert.notEqual(bodyStart, -1, `function ${name} body must exist`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (char === '\'' || char === '"' || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract function ${name}`);
}

function loadFunctions(relativePath, names, context = {}) {
  const source = readSource(relativePath);
  const sandbox = { console, Promise, Set, Map, JSON, Number, String, Array, Object, Math, Date, ...context };
  vm.createContext(sandbox);
  vm.runInContext(`${names.map(name => extractFunction(source, name)).join('\n')}\nthis.__functions = { ${names.join(', ')} };`, sandbox);
  return sandbox.__functions;
}

test('shared import label sanitizer removes markup, controls and invisible direction characters', () => {
  const lib = loadFunctions('src/screens-lib.jsx', ['sanitizeImportedLabel', 'libraryBulkSelectable']);
  assert.equal(lib.sanitizeImportedLabel('  <b>Plan\u0000 name</b>\u202e  ', 120), 'Plan name');
  assert.equal(lib.sanitizeImportedLabel('<img src=x onerror=bad>Legs', 120), 'Legs');
  assert.equal(lib.sanitizeImportedLabel('abcdef', 3), 'abc');

  const friends = loadFunctions('src/screens-friends.jsx', ['socialSanitizeImportedLabel', 'socialBoundStringArray'], {
    window: { Screens: { sanitizeImportedLabel: lib.sanitizeImportedLabel } },
  });
  assert.equal(friends.socialSanitizeImportedLabel('<i>Shared</i>\u0007 plan', 120), 'Shared plan');
  assert.deepEqual(Array.from(friends.socialBoundStringArray(['<b>one</b>', '\u202etwo', '', 4], 10, 20)), ['one', 'two']);

  const coaching = loadFunctions('src/screens-coaching-client.jsx', [
    'coachingSanitizeImportedLabel', 'coachingSanitizeImportedLabels',
    'coachingFiniteNumber', 'coachingSanitizeImportedExercise',
    'coachingSanitizeImportedPlanItem', 'coachingSanitizeImportedProgramData',
    'coachingSanitizeImportedPlanLabels',
  ], {
    window: { Screens: { sanitizeImportedLabel: lib.sanitizeImportedLabel } },
    LB: { sanitizeYoutubeUrl: () => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    COACH_PLAN_IMPORT_LIMITS: { exercises: 500, setsPerItem: 30, historyPerLift: 64 },
  });
  const exercise = coaching.coachingSanitizeImportedExercise({
    name: '<b>Squat</b>\u0000', tags: ['<i>legs</i>'], horn_labels: ['<x>Left</x>', 'Right\u202e'],
    youtube_url: 'https://youtu.be/dQw4w9WgXcQ?t=10',
  });
  assert.equal(exercise.name, 'Squat');
  assert.deepEqual(Array.from(exercise.tags), ['legs']);
  assert.deepEqual(Array.from(exercise.horn_labels), ['Left', 'Right']);
  assert.equal(exercise.youtube_url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const plan = coaching.coachingSanitizeImportedPlanLabels({
    name: '<b>Block</b>',
    days: [{ name: '<i>Day 1</i>', items: [{ exId: 'raw-1', supersetGroup: '<b>A</b>', plannedTechniques: ['<x>Drop</x>'] }] }],
    versions: [{ validFrom: '2026-08-01', label: '<u>Week 2</u>', days: [{ name: 'Day\u0007 2', items: [] }] }],
  }, { 'raw-1': 'safe-1' });
  assert.equal(plan.name, 'Block');
  assert.equal(plan.days[0].name, 'Day 1');
  assert.equal(plan.days[0].items[0].exId, 'safe-1');
  assert.equal(plan.days[0].items[0].supersetGroup, 'A');
  assert.deepEqual(Array.from(plan.days[0].items[0].plannedTechniques), ['Drop']);
  assert.equal(plan.versions[0].label, undefined);
});

test('every exercise import and render path uses the central YouTube sanitizer', () => {
  const libSource = readSource('src/screens-lib.jsx');
  const coachingSource = readSource('src/screens-coaching-client.jsx');
  const friendsSource = readSource('src/screens-friends.jsx');
  const scheduleSource = readSource('src/screens-schedule.jsx');
  const trainSource = readSource('src/screens-train.jsx');
  assert.doesNotMatch(libSource, /function sanitizeYoutubeUrl\(/);
  assert.equal((libSource.match(/LB\.sanitizeYoutubeUrl\(/g) || []).length, 4);
  assert.match(coachingSource, /youtube_url: LB\.sanitizeYoutubeUrl\(exercise\.youtube_url\)/);
  assert.match(friendsSource, /youtube_url: LB\.sanitizeYoutubeUrl\(ex\.youtube_url\)/);
  assert.equal((scheduleSource.match(/youtube_url: LB\.sanitizeYoutubeUrl\(ex\.youtube_url\)/g) || []).length, 2);
  assert.match(trainSource, /const exerciseYoutubeUrl = LB\.sanitizeYoutubeUrl\(exercise\?\.youtube_url\)/);
  assert.match(trainSource, /<a href=\{exerciseYoutubeUrl\}/);
});

test('latest-only coaching consumers stay narrow and history consumers use bounded pages', () => {
  const home = readSource('src/screens-home.jsx');
  assert.match(home, /LB\.hasCheckinForWeek\(coachingId, weekStart\)/);
  assert.match(home, /LB\.loadLatestCoachingMacros\(coachingId\)/);
  assert.doesNotMatch(home, /LB\.loadCheckins\(coachingId, \{ includePhotos: false \}\)/);

  for (const file of ['src/screens-health.jsx', 'src/screens-food.jsx', 'src/screens-coaching-tabs.jsx']) {
    assert.match(readSource(file), /LB\.loadLatestCoachingMacros\(coachingId\)/, file);
  }
  const coachingCore = readSource('src/screens-coaching-core.jsx');
  assert.match(coachingCore, /LB\.loadCheckins\(key, \{ limit: 26 \}\)/);
  assert.match(coachingCore, /LB\.loadCoachingMacrosForCheckins\(key, visibleCheckins\)/);
  assert.match(coachingCore, /LB\.loadCoachingThreads\(key, \{ limit: 50 \}\)/);
  assert.match(coachingCore, /LB\.loadCoachingThreadsByIds\(key, unreadIds\)/);
  assert.match(coachingCore, /LB\.loadCoachingThreadsByIds\(coachingId, missingIds\)/);
  assert.match(readSource('src/screens-coaching-detail.jsx'), /LB\.loadCoachingMacros\(key, \{ limit: 25 \}\)/);
});

test('both social state loaders use the shared batch signer', () => {
  const storeSource = readSource('src/store.js');
  assert.equal(
    (storeSource.match(/const attachments = await signedSocialAttachments\(/g) || []).length,
    2,
  );
  assert.doesNotMatch(storeSource, /row => signedSocialAttachment\(row\)\.catch/);
});

test('social plan import receipts are device-local and cross-device imports remain syncable', () => {
  const funcs = loadFunctions('src/screens-friends.jsx', [
    'socialReadImportedPlanReceipts', 'socialRememberImportedPlanReceipt', 'socialPlanAlreadyImported', 'socialMergeImportedPlan',
  ], { SOCIAL_IMPORTED_PLAN_RECEIPTS_KEY: 'zane.social.imported-plans.v1' });
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  const receipts = funcs.socialReadImportedPlanReceipts(storage, 'user-1');
  funcs.socialRememberImportedPlanReceipt(storage, 'user-1', 'share-1', receipts);
  assert.equal(funcs.socialPlanAlreadyImported({ id: 'share-1' }, receipts), true);
  assert.equal(funcs.socialPlanAlreadyImported({ id: 'share-2', importedAt: '2026-08-22' }, receipts), false);
  assert.deepEqual(Array.from(funcs.socialReadImportedPlanReceipts(storage, 'user-1')), ['share-1']);
  assert.equal(funcs.socialReadImportedPlanReceipts({ getItem: () => '{bad' }, 'user-1').size, 0);

  const merged = funcs.socialMergeImportedPlan({
    exercises: [{ id: 'keep' }, { id: 'replace', name: 'Old' }],
    schedules: [{ id: 'old-plan' }, { id: 'shared-plan', name: 'Old' }],
  }, { id: 'shared-plan', name: 'Persisted' }, [{ id: 'replace', name: 'New' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(merged.exercises)), [{ id: 'keep' }, { id: 'replace', name: 'New' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(merged.schedules)), [{ id: 'old-plan' }, { id: 'shared-plan', name: 'Persisted' }]);

  const source = readSource('src/screens-friends.jsx');
  assert.match(source, /socialRememberImportedPlanReceipt\([^;]+share\.id/);
  assert.match(source, /pendingPlanReceiptIds/);
  assert.match(source, /await LB\.markSocialPlanImported\(id\)/);
  const importStart = source.indexOf('const importPlanOnce = async share =>');
  const importEnd = source.indexOf('const importPlan = async share =>', importStart);
  const importSource = source.slice(importStart, importEnd);
  const atomicCall = importSource.indexOf('await LB.importSocialPlanShareAtomically');
  assert.notEqual(atomicCall, -1);
  assert.ok(atomicCall < importSource.indexOf('socialRememberImportedPlanReceipt'));
  assert.ok(atomicCall < importSource.indexOf('setStore('));
  assert.match(importSource, /await LB\.loadImportedSocialPlan\(importResult\.scheduleId\)/);
  assert.doesNotMatch(importSource, /await LB\.markSocialPlanImported/);
  assert.match(source, /share\.importedAt \? 'Sync' : 'Import'/);
});

test('health parsers reject partial values while preserving locale decimals', () => {
  const health = loadFunctions('src/screens-health.jsx', [
    'healthNum', 'healthInt', 'healthNormalizeEntryTime', 'healthEntryTime',
    'healthBloodPressureValidation', 'healthDailyValidationError', 'glucoseFromInput', 'tempFromInput',
  ], { GLUCOSE_FACTOR: 18.0182 });
  assert.equal(health.healthNum('1,5'), 1.5);
  assert.equal(health.healthNum('.5'), 0.5);
  assert.equal(health.healthNum('12abc'), null);
  assert.equal(health.healthNum('.'), null);
  assert.equal(health.healthInt('12.5'), null);
  assert.equal(health.healthInt('12 steps'), null);

  assert.equal(health.healthNormalizeEntryTime('9:05'), '09:05');
  assert.equal(health.healthNormalizeEntryTime('25:00'), null);
  assert.equal(health.healthEntryTime('', '08:30'), '08:30');
  assert.equal(health.healthEntryTime('9', '08:30'), null);

  assert.equal(health.healthBloodPressureValidation('120', '80').error, null);
  assert.match(health.healthBloodPressureValidation('80', '120').error, /higher/);
  assert.match(health.healthBloodPressureValidation('120x', '80').error, /whole numbers/);
  assert.match(health.healthBloodPressureValidation('500', '80').error, /plausible/);

  const options = { foodLocked: false, waterLocked: false, netCarbs: true, waterEntryToMl: value => value };
  assert.match(health.healthDailyValidationError({ weight: '-2' }, options), /weight/);
  assert.match(health.healthDailyValidationError({ steps: '100x' }, options), /steps/);
  assert.match(health.healthDailyValidationError({ carbs: '10', fiber: '12' }, options), /Fiber/);
  assert.match(health.healthDailyValidationError({ water: '200000' }, options), /water/);
  assert.equal(health.healthDailyValidationError({ weight: '82,5', steps: '12000', water: '2500' }, options), null);

  assert.equal(health.glucoseFromInput('5,5', 'mmol'), 5.5);
  assert.equal(health.glucoseFromInput('5.5x', 'mmol'), null);
  assert.equal(health.glucoseFromInput('0.1', 'mmol'), null);
  assert.ok(Math.abs(health.glucoseFromInput('90', 'mgdl') - 4.995) < 0.001);
  assert.equal(health.tempFromInput('37,2', 'c'), 37.2);
  assert.equal(health.tempFromInput('37.2c', 'c'), null);
  assert.equal(health.tempFromInput('10', 'c'), null);

  const source = readSource('src/screens-health.jsx');
  assert.match(source, /if \(savingGlucose\) return;/);
  assert.match(source, /disabled=\{!glForm\.value \|\| savingGlucose\}/);
});

test('custom coaching numeric responses use full-string validation', () => {
  const coaching = loadFunctions('src/screens-coaching-tabs.jsx', [
    'checkinStrictDecimal', 'checkinStrictInteger', 'toResponse', 'checkinResponseValidationError',
  ], {
    LB: { distToM: (value, unit) => unit === 'mi' ? value * 1609.344 : value * 1000 },
    UI: { waterEntryToMl: value => value * 29.5735 },
  });
  assert.equal(coaching.toResponse({ type: 'decimal' }, '2,5', 'km'), 2.5);
  assert.equal(coaching.toResponse({ type: 'decimal' }, '2.5kg', 'km'), null);
  assert.equal(coaching.toResponse({ type: 'integer' }, '12 reps', 'km'), null);
  assert.equal(coaching.toResponse({ type: 'integer' }, '12', 'km'), 12);
  assert.equal(coaching.toResponse({ type: 'percent' }, '101', 'km'), null);
  assert.equal(coaching.toResponse({ type: 'pace' }, '0:00', 'km'), null);
  assert.equal(coaching.toResponse({ type: 'pace' }, '6:05', 'km'), '6:05');
  assert.equal(coaching.toResponse({ _distanceField: true, label: 'Distance' }, '1.2x', 'km'), null);
  assert.equal(coaching.toResponse({ _distanceField: true, label: 'Distance' }, '1,2', 'km'), 1200);
  assert.match(coaching.checkinResponseValidationError({ type: 'decimal', label: 'Custom score' }, '3x', 'km'), /Custom score/);
  assert.equal(coaching.checkinResponseValidationError({ type: 'decimal', label: 'Custom score' }, '', 'km'), null);
});

test('required choice schema fields need a usable option before any save path', () => {
  const { checkinRequiredChoiceValidationError } = loadFunctions('src/screens-coaching-detail.jsx', ['checkinRequiredChoiceValidationError']);
  assert.match(checkinRequiredChoiceValidationError([{ fields: [{ type: 'choice', required: true, label: 'Mood', options: [] }] }]), /Mood/);
  assert.match(checkinRequiredChoiceValidationError([{ fields: [{ type: 'choice', required: true, label: 'Mood', options: [{ label: 'Good', value: '' }] }] }]), /Mood/);
  assert.equal(checkinRequiredChoiceValidationError([{ fields: [{ type: 'choice', required: true, label: 'Mood', options: [{ label: 'Good', value: 'good' }] }] }]), null);
  assert.equal(checkinRequiredChoiceValidationError([{ fields: [{ type: 'choice', required: false, label: 'Mood', options: [] }] }]), null);

  const source = readSource('src/screens-coaching-detail.jsx');
  assert.match(source, /const handleSave = async \(\) => \{\s*const validationError = checkinRequiredChoiceValidationError\(draft\)/);
  assert.match(source, /const handleSaveForAll = async \(\) => \{\s*const validationError = checkinRequiredChoiceValidationError\(draft\)/);
});

test('medication quantities reject lone dots, malformed values and unsafe stock edits', () => {
  const med = loadFunctions('src/screens-medications.jsx', ['mdNum', 'mdDecimalFilter', 'mdFmtQty', 'mdStockSheetTotal', 'mdStockSheetValidationError']);
  assert.equal(med.mdNum('.'), null);
  assert.equal(med.mdNum('1.2x'), null);
  assert.equal(med.mdNum('NaN'), null);
  assert.equal(med.mdNum('-1'), null);
  assert.equal(med.mdNum(',5'), 0.5);
  assert.equal(med.mdDecimalFilter('-5'), '-5');
  assert.equal(med.mdDecimalFilter('1,5'), '1.5');
  assert.equal(med.mdFmtQty(NaN, 'pills'), '');

  const base = { packageSize: 30, stockStr: '', stockPacksStr: '2', stockExtraStr: '5', lowStockThresholdStr: '10' };
  assert.equal(med.mdStockSheetTotal(base), 65);
  assert.equal(med.mdStockSheetValidationError(base), null);
  assert.match(med.mdStockSheetValidationError({ ...base, stockPacksStr: '.' }), /package/);
  assert.match(med.mdStockSheetValidationError({ ...base, stockPacksStr: '', stockExtraStr: '', stockStr: '3x' }), /stock amount/);
  assert.match(med.mdStockSheetValidationError({ ...base, lowStockThresholdStr: '0' }), /threshold/);

  const source = readSource('src/screens-medications.jsx');
  assert.match(source, /Enter a valid package size above 0/);
  assert.match(source, /const validationError = mdStockSheetValidationError\(stockSheet\)/);
});

test('Library Select All evaluates only exercises that can be bulk-selected', () => {
  const { libraryBulkSelectable } = loadFunctions('src/screens-lib.jsx', ['libraryBulkSelectable']);
  const rows = [{ id: 'strength', movement_type: 'bilateral' }, { id: 'cardio', movement_type: 'cardio' }];
  assert.deepEqual(Array.from(libraryBulkSelectable(rows), row => row.id), ['strength']);
  const source = readSource('src/screens-lib.jsx');
  assert.match(source, /allFilteredSelected = bulkSelectable\.length > 0 && bulkSelectable\.every/);
  assert.match(source, /new Set\(bulkSelectable\.map/);
});

test('coaching attachments keep stable paths and clean up failed inserts and author deletions', async () => {
  const calls = [];
  const LB = {
    SUPABASE_URL: 'https://signed.example',
    uploadChatImage: async () => { calls.push('upload'); return 'user-1/file.jpg'; },
    signChatImage: async path => { calls.push(`sign:${path}`); return 'https://signed.example/file'; },
    addCoachingNote: async (...args) => { calls.push(['add', args[7]]); throw new Error('insert failed'); },
    deleteChatImage: async path => { calls.push(`delete-image:${path}`); return true; },
    deleteCoachingNote: async id => { calls.push(`delete-note:${id}`); },
  };
  const funcs = loadFunctions('src/screens-coaching-core.jsx', ['coachingCreateChatNote', 'coachingDeleteChatNote'], { LB });
  await assert.rejects(() => funcs.coachingCreateChatNote({
    coachingId: 'support_user-1', threadId: 'thread-1', userId: 'user-1', body: '',
    imageFile: { name: 'file.jpg', type: 'image/jpeg' }, imagePreview: 'data:image/jpeg;base64,x',
  }), /insert failed/);
  assert.equal(calls.at(-1), 'delete-image:user-1/file.jpg');
  const addCall = calls.find(call => Array.isArray(call) && call[0] === 'add');
  assert.equal(addCall[1][0].url, 'user-1/file.jpg');
  assert.equal(addCall[1][0].path, 'user-1/file.jpg');

  calls.length = 0;
  const removed = await funcs.coachingDeleteChatNote({
    id: 'note-1',
    attachments: [{ storagePath: 'user-1/a.jpg', url: 'https://signed/a' }, { path: 'user-1/b.jpg' }],
  }, 'user-1');
  assert.equal(removed, true);
  assert.deepEqual(calls, ['delete-note:note-1', 'delete-image:user-1/a.jpg', 'delete-image:user-1/b.jpg']);
});

test('coaching macros accept only bounded whole-number strings', () => {
  const funcs = loadFunctions('src/screens-coaching-detail.jsx', ['coachingMacroValue', 'coachingMacroValidationError'], {
    COACHING_MACRO_MAX_GRAMS: 2000,
    COACHING_MACRO_FIELDS: [['proteinTraining', 'Training-day protein']],
  });
  assert.equal(funcs.coachingMacroValue('0'), 0);
  assert.equal(funcs.coachingMacroValue(' 250 '), 250);
  assert.equal(funcs.coachingMacroValue(''), null);
  assert.equal(funcs.coachingMacroValue('-1'), undefined);
  assert.equal(funcs.coachingMacroValue('12g'), undefined);
  assert.equal(funcs.coachingMacroValue('2.5'), undefined);
  assert.equal(funcs.coachingMacroValue('2001'), undefined);
  assert.match(funcs.coachingMacroValidationError({ proteinTraining: '12g' }), /whole number/);
  assert.equal(funcs.coachingMacroValidationError({ proteinTraining: '' }), '');
});

test('coach plan imports enforce structural caps, allowlist fields and dedupe one payload', () => {
  const limits = { bytes: 250000, nodes: 20000, depth: 14, exercises: 500, days: 14, versions: 52, itemsPerDay: 100, setsPerItem: 30, historyPerLift: 64 };
  let nextId = 0;
  const funcs = loadFunctions('src/screens-coaching-client.jsx', [
    'coachingSanitizeImportedLabel', 'coachingSanitizeImportedLabels', 'coachingFiniteNumber',
    'coachingJsonWithinImportLimits', 'coachingPlanImportValidationError',
    'coachingSanitizeImportedExercise', 'coachingPrepareImportedExercises',
    'coachingSanitizeImportedPlanItem', 'coachingSanitizeImportedProgramData',
    'coachingSanitizeImportedPlanLabels',
  ], {
    window: { Screens: null },
    LB: { uid: () => `new-${++nextId}`, sanitizeYoutubeUrl: value => /^https:\/\/www\.youtube\.com\//.test(value || '') ? value : null },
    COACH_PLAN_IMPORT_LIMITS: limits,
  });

  const exercises = [
    { id: 'raw-a', name: 'Squat', unexpected: { privileged: true } },
    { id: 'raw-b', name: ' squat ' },
    { id: 'raw-c', name: 'Bench', movement_type: 'cardio', log_mode: 'weight_reps', youtube_url: 'javascript:alert(1)' },
  ];
  const prepared = funcs.coachingPrepareImportedExercises(exercises, []);
  assert.equal(prepared.newExercises.length, 2);
  assert.equal(prepared.idMap['raw-a'], prepared.idMap['raw-b']);
  assert.equal(prepared.newExercises[0].unexpected, undefined);
  assert.equal(prepared.newExercises[1].movement_type, 'cardio');
  assert.equal(prepared.newExercises[1].log_mode, 'weight_reps');
  assert.equal(prepared.newExercises[1].youtube_url, null);

  const rawSchedule = {
    name: '<b>Imported</b>', owner_id: 'attacker', arbitrary: { nested: true },
    days: [{ id: 'attacker-day', name: 'Day', poison: true, items: [{ exId: 'raw-a', sets: 3, reps: 5, admin: true }] }],
    versions: [],
  };
  const clean = funcs.coachingSanitizeImportedPlanLabels(rawSchedule, prepared.idMap);
  assert.equal(clean.name, 'Imported');
  assert.equal(clean.owner_id, undefined);
  assert.equal(clean.arbitrary, undefined);
  assert.equal(clean.days[0].id, undefined);
  assert.equal(clean.days[0].poison, undefined);
  assert.equal(clean.days[0].items[0].admin, undefined);
  assert.equal(clean.days[0].items[0].exId, prepared.idMap['raw-a']);
  assert.equal(funcs.coachingSanitizeImportedPlanLabels({ days: [{ items: [{ exId: 'missing' }] }] }, prepared.idMap), null);

  const validPayload = { type: 'zane-plan', schedule: rawSchedule, exercises };
  assert.equal(funcs.coachingPlanImportValidationError(validPayload, 1000), '');
  assert.match(funcs.coachingPlanImportValidationError(validPayload, limits.bytes + 1), /too large/);
  assert.match(funcs.coachingPlanImportValidationError({ ...validPayload, exercises: Array.from({ length: 501 }, (_, id) => ({ id, name: `E${id}` })) }), /at most 500/);
  let deep = { value: true };
  for (let index = 0; index < limits.depth + 2; index += 1) deep = { child: deep };
  assert.match(funcs.coachingPlanImportValidationError({ ...validPayload, extra: deep }), /too complex/);
});

test('coach training plan import crosses the database boundary in one atomic RPC', async () => {
  const source = readSource('src/screens-coaching-client.jsx');
  const insertSource = extractFunction(source, 'coachingInsertImportedPlan');
  assert.match(insertSource, /await LB\.pushTrainingPlanToClient\(\{/);
  assert.match(insertSource, /coachingId,/);
  assert.match(insertSource, /clientId,/);
  assert.match(insertSource, /schedule,/);
  assert.match(insertSource, /exercises: newExercises/);
  assert.doesNotMatch(insertSource, /LB\.supabase\.from\(/);
  assert.doesNotMatch(source, /function coachingRollbackImportedExercises/);

  const storeSource = readSource('src/store.js');
  const pushSource = extractFunction(storeSource, 'pushTrainingPlanToClient');
  assert.match(pushSource, /_supabase\.rpc\('push_training_plan_to_client'/);
  assert.match(pushSource, /p_operation_id: scheduleRow\.id/);
  assert.match(pushSource, /p_schedule: scheduleRow/);
  assert.match(pushSource, /p_exercises: exerciseRows/);
});

test('final database and Edge hardening keeps retries atomic and durable', () => {
  const migration = readSource('supabase/migrations/20260822111556_atomic_shared_and_coach_plan_imports.sql');
  const schema = readSource('supabase/schema.sql');
  for (const source of [migration, schema]) {
    assert.match(source, /CREATE OR REPLACE FUNCTION public\.push_training_plan_to_client\(/);
    assert.match(source, /REVOKE EXECUTE ON FUNCTION public\.push_training_plan_to_client\(text, text, jsonb, jsonb\) FROM PUBLIC, anon;/);
    assert.match(source, /GRANT EXECUTE ON FUNCTION public\.push_training_plan_to_client\(text, text, jsonb, jsonb\) TO authenticated;/);

    const medicationStart = source.indexOf('CREATE OR REPLACE FUNCTION public.push_medication_plan_to_client');
    assert.notEqual(medicationStart, -1);
    const medicationEnd = source.indexOf('\n$function$;', medicationStart);
    const medicationSource = source.slice(medicationStart, medicationEnd);
    const retryReturn = medicationSource.indexOf('IF v_existing_plan.id IS NOT NULL THEN RETURN v_plan_id; END IF;');
    const medicationInsert = medicationSource.indexOf('INSERT INTO public.zane_medication_plans');
    assert.ok(retryReturn >= 0 && retryReturn < medicationInsert, 'medication retry must return before replacing user inventory');
  }
  assert.match(migration, /ALTER COLUMN schedule_id SET NOT NULL;/);
  assert.match(schema, /CREATE TABLE public\.zane_social_plan_share_imports \([\s\S]*?schedule_id text NOT NULL,/);

  const skipMigration = readSource('supabase/migrations/20260822111520_unique_archived_missed_days.sql');
  const lock = skipMigration.indexOf('LOCK TABLE public.zane_skips IN SHARE ROW EXCLUSIVE MODE;');
  const dedupe = skipMigration.indexOf('WITH ranked AS');
  const uniqueIndex = skipMigration.indexOf('CREATE UNIQUE INDEX');
  assert.ok(lock >= 0 && lock < dedupe && dedupe < uniqueIndex, 'skip dedupe and index creation must share one table lock');

  const fetchSource = readSource('supabase/functions/_shared/fetch.ts');
  assert.match(fetchSource, /const body = await response\.arrayBuffer\(\);/);
  assert.match(fetchSource, /\[204, 205, 304\]\.includes\(response\.status\) \? null : body/);
  assert.ok(fetchSource.indexOf('await response.arrayBuffer()') < fetchSource.indexOf('clearTimeout(timer)'));

  const cleanupEndpoint = readSource('supabase/functions/coaching-chat-cleanup/index.ts');
  const reminder = readSource('supabase/functions/reminder/index.ts');
  assert.match(cleanupEndpoint, /drainChatAttachmentCleanup/);
  assert.match(cleanupEndpoint, /cleanup\.failed > 0 \? 202 : 200/);
  assert.match(reminder, /await drainChatAttachmentCleanup\(\)/);
});

test('support messages sign private paths and delete uploads when insert fails', async () => {
  const calls = [];
  let insertError = true;
  const LB = {
    SUPABASE_URL: 'https://signed.example',
    uid: () => 'note-1',
    uploadChatImage: async () => { calls.push('upload'); return 'user-1/private.jpg'; },
    insertCoachingNote: async args => {
      calls.push(['insert', args]);
      if (insertError) {
        calls.push(`cleanup:${args.uploadedPaths[0]}`);
        throw new Error('insert failed');
      }
      return args.id;
    },
    hydrateChatAttachments: async attachments => attachments.map(attachment => ({ ...attachment, storagePath: attachment.path, url: 'https://signed.example/storage/v1/object/sign/chat-attachments/user-1/private.jpg?token=x' })),
  };
  const funcs = loadFunctions('src/screens-settings.jsx', ['supportAttachmentDisplayUrl', 'supportCreateChatNote'], { LB });
  const input = { coachingId: 'support_user-1', userId: 'user-1', body: '', imageFile: { name: 'private.jpg', type: 'image/jpeg' }, imagePreview: 'data:image/jpeg;base64,preview' };
  await assert.rejects(() => funcs.supportCreateChatNote(input), /insert failed/);
  assert.equal(calls.at(-1), 'cleanup:user-1/private.jpg');
  const insertArgs = calls.find(call => Array.isArray(call))[1];
  const persisted = insertArgs.attachments[0];
  assert.equal(persisted.path, 'user-1/private.jpg');
  assert.equal(persisted.url, 'user-1/private.jpg');
  assert.deepEqual(Array.from(insertArgs.uploadedPaths), ['user-1/private.jpg']);

  calls.length = 0;
  insertError = false;
  const note = await funcs.supportCreateChatNote(input);
  assert.equal(note.attachments[0].storagePath, 'user-1/private.jpg');
  assert.match(funcs.supportAttachmentDisplayUrl(note.attachments[0]), /storage\/v1\/object\/sign\/chat-attachments/);
  assert.equal(funcs.supportAttachmentDisplayUrl({ url: 'user-1/private.jpg' }), null);
  assert.equal(funcs.supportAttachmentDisplayUrl({ url: 'https://attacker.example/tracker.png' }), null);
  assert.equal(calls.some(call => typeof call === 'string' && call.startsWith('cleanup:')), false);
});

test('chat bottom detection and verified zbar loader preserve user position and integrity', () => {
  const { coachingChatNearBottom } = loadFunctions('src/screens-coaching-core.jsx', ['coachingChatNearBottom']);
  assert.equal(coachingChatNearBottom({ scrollHeight: 1000, scrollTop: 800, clientHeight: 160 }), true);
  assert.equal(coachingChatNearBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 160 }), false);

  const coachingSource = readSource('src/screens-coaching-core.jsx');
  assert.match(coachingSource, /hasNewNotes && isAtBottomRef\.current/);
  assert.match(coachingSource, /shouldScrollBottomRef\.current = true;\s*isAtBottomRef\.current = true;\s*setNotes/);
  const indexSource = readSource('index.html');
  assert.match(indexSource, /crypto\.subtle\.digest\('SHA-384'/);
  assert.match(indexSource, /dist\/inlined\/index\.mjs/);
  assert.doesNotMatch(indexSource, /import\('https:\/\/cdn\.jsdelivr\.net\/npm\/@undecaf\/zbar-wasm/);
});

test('CI network operations have bounded timeouts and lockfile has registry integrity', () => {
  for (const file of ['tools/bake-feature-map.cjs', 'tools/check-db-live.cjs']) {
    const source = readSource(file);
    assert.match(source, /AbortController/);
    assert.match(source, /REQUEST_TIMEOUT_MS/);
    assert.match(source, /clearTimeout\(timer\)/);
  }
  for (const file of ['.github/workflows/bake-feature-map.yml', '.github/workflows/check.yml', '.github/workflows/db-drift.yml', '.github/workflows/deploy-edge-function.yml']) {
    assert.match(readSource(file), /timeout-minutes:/, file);
  }
  const lock = JSON.parse(readSource('package-lock.json'));
  const babel = lock.packages['node_modules/@babel/standalone'];
  assert.match(babel.resolved, /^https:\/\/registry\.npmjs\.org\//);
  assert.match(babel.integrity, /^sha512-/);
  assert.match(readSource('.gitignore'), /^supabase\/\.temp\/$/m);
});
