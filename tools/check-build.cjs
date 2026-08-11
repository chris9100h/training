#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const fail = (message) => {
  console.error('FAIL ' + message);
  process.exitCode = 1;
};

if (!fs.existsSync(dist)) {
  fail('dist/ does not exist. Run npm run build first.');
  process.exit(1);
}

const sourceHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const builtHtml = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const builtSw = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
if (!builtHtml.includes('var PRECOMPILED_BUILD = true;')) {
  fail('dist/index.html is not marked as a precompiled build.');
}

const bundleMatch = builtHtml.match(/var PRECOMPILED_BUNDLES = (\{[\s\S]*?\});/);
if (!bundleMatch) {
  fail('dist/index.html does not contain the precompiled bundle map.');
  process.exit(1);
}
let bundles;
try {
  bundles = JSON.parse(bundleMatch[1]);
} catch (error) {
  fail(`precompiled bundle map is not valid JSON: ${error.message}`);
  process.exit(1);
}
for (const [name, rel] of Object.entries(bundles)) {
  if (!fs.existsSync(path.join(dist, rel))) fail(`${name} bundle ${rel} is missing from dist/`);
}

const inlineHtml = builtHtml.replace(/<!--[\s\S]*?-->/g, '');
for (const match of inlineHtml.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (/\bsrc\s*=/.test(match[1])) continue;
  try {
    new vm.Script(match[2], { filename: 'dist/index.html:inline-script' });
  } catch (error) {
    fail(`dist/index.html inline script is invalid: ${error.message}`);
  }
}

const sourcesMatch = sourceHtml.match(/var SOURCES = \[([\s\S]*?)\];/);
if (!sourcesMatch) {
  fail('could not find SOURCES in index.html');
  process.exit(1);
}
const jsxSources = [...sourcesMatch[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
const scriptTags = [...builtHtml.matchAll(/<script src="(src\/[^"?]+)"/g)].map(match => match[1]);
const loaded = scriptTags;

for (const rel of loaded) {
  if (!fs.existsSync(path.join(dist, rel))) fail(`${rel} is missing from dist/`);
}

const assetsMatch = builtSw.match(/const ASSETS = \[([\s\S]*?)\];/);
if (!assetsMatch) {
  fail('could not find ASSETS in dist/sw.js');
  process.exit(1);
}
const assets = [...assetsMatch[1].matchAll(/'([^']+)'/g)]
  .map(match => match[1].replace(/^\//, ''));
for (const rel of assets) {
  if (!rel || rel === '') continue;
  if (!fs.existsSync(path.join(dist, rel))) fail(`${rel} is listed in dist/sw.js but missing from dist/`);
}

for (const rel of Object.values(bundles)) {
  if (!assets.includes(rel)) fail(`${rel} is a built bundle but missing from dist/sw.js ASSETS.`);
}

// Everything above only checks that files exist and parse. None of it ever
// EXECUTES a bundle, so a broken concatenation order, a dropped file, or a
// throw at module-init time (e.g. window.SYSTEM_PROGRAMS never getting set)
// would still pass every check here. core.js is plain JS (no JSX/React), so
// it can run in a minimal vm sandbox without a DOM: run the real dist/
// artifact and assert the globals it must set actually got set.
function runCoreBundle() {
  if (!bundles.core || !fs.existsSync(path.join(dist, bundles.core))) return; // already reported above
  const code = fs.readFileSync(path.join(dist, bundles.core), 'utf8');
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.console = console;
  sandbox.fetch = () => Promise.reject(new Error('no network in check-build'));
  sandbox.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  sandbox.navigator = { userAgent: 'check-build', onLine: true };
  sandbox.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.WebSocket = function () { throw new Error('no websocket in check-build'); };
  sandbox.crypto = globalThis.crypto;
  sandbox.atob = (s) => Buffer.from(s, 'base64').toString('binary');
  sandbox.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
  sandbox.URL = URL;
  sandbox.URLSearchParams = URLSearchParams;
  sandbox.TextEncoder = TextEncoder;
  sandbox.TextDecoder = TextDecoder;
  sandbox.Headers = Headers;
  sandbox.Request = Request;
  sandbox.Response = Response;
  sandbox.AbortController = AbortController;
  sandbox.Blob = Blob;
  vm.createContext(sandbox);
  try {
    vm.runInContext(code, sandbox, { filename: bundles.core });
  } catch (error) {
    fail(`${bundles.core} threw while executing: ${error.message}`);
    return;
  }
  // window.LB is store.js's own export surface; the other four are each a
  // single file's entire reason for being in the core bundle at all, so a
  // silently dropped/misordered file shows up here as a missing global,
  // exactly the failure mode file-existence checks above cannot see.
  const expectedGlobals = { LB: 'src/store.js', SYSTEM_PROGRAMS: 'src/programs-db.js', SYSTEM_EXERCISES: 'src/exercise-db.js', WHATS_NEW: 'src/whatsnew.js', FEATURE_MAP: 'src/feature-map-db.js' };
  for (const [key, source] of Object.entries(expectedGlobals)) {
    if (!sandbox[key]) fail(`${bundles.core} ran without error but window.${key} (from ${source}) was never set.`);
  }
}
runCoreBundle();

if (process.exitCode) {
  console.error('\ncheck-build FAILED');
} else {
  console.log(`check-build OK: ${jsxSources.length} JSX sources mapped to ${Object.keys(bundles).length} bundles, ${assets.length} precache entries present in dist/, core.js bundle executes and sets its expected globals`);
}

// The real Supabase client core.js constructs schedules background timers
// (session refresh, realtime heartbeat) that would otherwise keep this
// process alive/noisy well after every check above has already run; a
// browser tab living for the rest of the session is fine with that, a
// short-lived CI check process is not. Exit explicitly now that every check
// has recorded its result via exitCode.
process.exit(process.exitCode || 0);
