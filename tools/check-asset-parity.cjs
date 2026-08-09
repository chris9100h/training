#!/usr/bin/env node
/* Every file the app loads must also be precached by the Service Worker.
   There is no build step and no bundler to notice a mismatch, so the two
   lists are kept in sync by hand across two files:

     index.html  var SOURCES = [...]        the precompile loader's JSX list
     index.html  <script src="src/...">     plain scripts
     sw.js       const ASSETS = [...]       what gets precached on install

   A file added to the loader but forgotten in ASSETS looks completely fine in
   development and on a warm cache. It only breaks for a user who is offline,
   or mid-deploy, where every OTHER source comes from the versioned cache and
   this one has to hit the network: it fails, the loader aborts, and the whole
   app is a blank screen. The reverse (in ASSETS, not loaded) is milder but
   still real, install precaches all-or-nothing, so a stale path there fails
   the install and the Service Worker never activates at all.

   Deliberately NOT covered: the standalone public pages (welcome/features/
   autoreg and the script only autoreg.html loads). They live outside the app
   shell on purpose, carry their own ?v= busters, and sw.js keeps them out of
   the cache by name, see PUBLIC_PAGES there. This tool asserts they stay out
   of ASSETS rather than requiring them in it. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

const fail = (msg) => { console.error('FAIL ' + msg); process.exitCode = 1; };

// ── the loader's JSX list ────────────────────────────────────────────────
const sourcesMatch = html.match(/var SOURCES = \[([\s\S]*?)\];/);
if (!sourcesMatch) {
  console.error('FAIL could not find the SOURCES list in index.html');
  process.exit(1);
}
const jsxSources = [...sourcesMatch[1].matchAll(/'([^']+)'/g)].map(x => x[1]);

// ── plain <script src="src/..."> tags ────────────────────────────────────
// supabase.js is a vendored third-party bundle; it IS in ASSETS and is
// checked like any other, it is just not ours to lint elsewhere.
const scriptTags = [...html.matchAll(/<script src="(src\/[^"?]+)"/g)].map(x => x[1]);

// ── sw.js ASSETS + PUBLIC_PAGES ──────────────────────────────────────────
const assetsMatch = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
if (!assetsMatch) {
  console.error('FAIL could not find the ASSETS list in sw.js');
  process.exit(1);
}
// Entries read `BASE + '/src/x.jsx'`; the leading slash is stripped so both
// sides compare as repo-relative paths.
const assets = [...assetsMatch[1].matchAll(/'([^']+)'/g)].map(x => x[1].replace(/^\//, ''));
const assetSet = new Set(assets);

const publicMatch = sw.match(/const PUBLIC_PAGES = \[([\s\S]*?)\];/);
if (!publicMatch) {
  console.error('FAIL could not find the PUBLIC_PAGES list in sw.js');
  process.exit(1);
}
const publicPages = [...publicMatch[1].matchAll(/'([^']+)'/g)].map(x => x[1].replace(/^\//, ''));

// ── 1. everything the app loads is precached ─────────────────────────────
const loaded = [...jsxSources, ...scriptTags];
for (const rel of loaded) {
  if (!assetSet.has(rel)) {
    fail(`${rel} is loaded by index.html but missing from ASSETS in sw.js.\n     Offline (or mid-deploy) that fetch fails and the app boots to a blank screen.`);
  }
}

// ── 2. everything precached actually exists ──────────────────────────────
// install precaches all-or-nothing, so one bad path stops the SW activating.
for (const rel of assets) {
  if (!rel || rel === '') continue;  // BASE + '/' , the app shell itself
  if (!fs.existsSync(path.join(root, rel))) {
    fail(`ASSETS lists ${rel} in sw.js, but that file does not exist.\n     Precaching is all-or-nothing: the Service Worker install fails outright.`);
  }
}

// ── 3. sources exist on disk ─────────────────────────────────────────────
for (const rel of loaded) {
  if (!fs.existsSync(path.join(root, rel))) {
    fail(`index.html loads ${rel}, but that file does not exist.`);
  }
}

// ── 4. public pages stay out of the app cache ────────────────────────────
for (const rel of publicPages) {
  if (assetSet.has(rel)) {
    fail(`${rel} is in both PUBLIC_PAGES and ASSETS in sw.js.\n     A public page must not be precached, it updates via its own ?v= buster.`);
  }
  if (!fs.existsSync(path.join(root, rel))) {
    fail(`PUBLIC_PAGES lists ${rel}, but that file does not exist.`);
  }
}

// ── 5. every public HTML page at the repo root is declared ───────────────
// Catches the other half: a new standalone page that nobody told sw.js about
// falls straight into the same-origin stale-while-revalidate branch and gets
// frozen in the cache on first visit.
const rootHtml = fs.readdirSync(root).filter(f => f.endsWith('.html') && f !== 'index.html');
for (const f of rootHtml) {
  if (!publicPages.includes(f)) {
    fail(`${f} is a standalone public page but is not in PUBLIC_PAGES in sw.js.\n     Without it the Service Worker caches the page and serves it stale forever.`);
  }
}

if (process.exitCode) {
  console.error('\ncheck-asset-parity FAILED');
} else {
  console.log(`check-asset-parity OK: ${loaded.length} loaded sources all precached, ${assets.length} ASSETS entries all exist, ${publicPages.length} public paths held out of the cache`);
}
