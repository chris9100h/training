#!/usr/bin/env node
/* Executes the actual shared reminder clock after TypeScript erasure. This
   pins DST-aware IANA conversion and the fixed-offset compatibility fallback
   without requiring a local Deno/Supabase runtime. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Babel = require('@babel/standalone');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'supabase', 'functions', '_shared', 'time.ts'), 'utf8');
const compiled = Babel.transform(source, {
  presets: ['typescript', ['env', { modules: 'commonjs' }]],
  sourceType: 'module',
  filename: 'supabase/functions/_shared/time.ts',
}).code;
const sandboxModule = { exports: {} };
vm.runInNewContext(compiled, { module: sandboxModule, exports: sandboxModule.exports, Intl, Date, Object, Math }, { filename: 'time.ts' });
const { localClock } = sandboxModule.exports;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Vienna is UTC+1 in January and UTC+2 in July. A fixed +60-minute offset
// would get the summer assertion wrong, which is the bug this helper prevents.
const winter = localClock(Date.UTC(2026, 0, 15, 18, 0, 0), 'Europe/Vienna', 60);
assert(winter.date === '2026-01-15' && winter.msSinceMidnight === 19 * 3600000, 'winter IANA conversion failed');
const summer = localClock(Date.UTC(2026, 6, 15, 17, 0, 0), 'Europe/Vienna', 60);
assert(summer.date === '2026-07-15' && summer.msSinceMidnight === 19 * 3600000, 'summer DST conversion failed');
const fallback = localClock(Date.UTC(2026, 0, 15, 18, 30, 0), null, 90);
assert(fallback.date === '2026-01-15' && fallback.msSinceMidnight === (20 * 3600) * 1000, 'offset fallback failed');

console.log('reminder-time OK: IANA winter/summer and offset fallback behave as expected');
