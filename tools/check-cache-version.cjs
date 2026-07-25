#!/usr/bin/env node
// CI gate: the public pages in the repo root (features.html, autoreg.html, ...)
// live OUTSIDE the service worker, so unlike the app they have no SW cache
// version to force a refetch. Each relies on a ?v= cache-buster on the source
// it loads, and that buster must be bumped in lockstep with the SW cache
// version (const CACHE in sw.js). If they drift, a fresh deploy keeps serving
// stale bytes to the public page while the app itself already has the new ones,
// and nothing surfaces it, because the app's own SW bump hides the problem.
// This was a real bug class, so gate it.
//
// Every root .html except index.html (which IS the app, and is cached by the
// SW) is scanned, and every ?v= in it has to match. New public pages are
// therefore covered the moment they are added, without touching this file:
// autoreg.html shipped after the first version of this gate, which named
// features.html literally, and went unchecked until a bump caught it by hand.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const swMatch = sw.match(/const CACHE = 'zane-v([0-9.]+)'/);
if (!swMatch) {
  console.error('check-cache-version: could not find "const CACHE = \'zane-vX.XXX\'" in sw.js');
  process.exit(1);
}
const swVer = swMatch[1];

const pages = fs.readdirSync(root)
  .filter(f => f.endsWith('.html') && f !== 'index.html')
  .sort();
if (!pages.length) {
  console.error('check-cache-version: no public .html pages found in the repo root');
  process.exit(1);
}

const bad = [];
const seen = [];
let total = 0;
for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  // Whatever that page loads, not one hardcoded filename.
  const busters = [...html.matchAll(/src="([^"]+)\?v=([0-9.]+)"/g)];
  if (!busters.length) {
    console.error(`check-cache-version FAIL: ${page} has no "?v=" cache-buster.`);
    console.error(`Fix: load its source as <script src="…?v=${swVer}"></script> so a deploy can invalidate it, or delete the page if it is no longer served.`);
    process.exit(1);
  }
  total += busters.length;
  seen.push(`${page} (${busters.length})`);
  busters.filter(m => m[2] !== swVer).forEach(m => bad.push({ page, src: m[1], ver: m[2] }));
}

if (bad.length) {
  console.error(`check-cache-version FAIL: sw.js CACHE is zane-v${swVer}, but:`);
  bad.forEach(b => console.error(`  ${b.page}: ${b.src}?v=${b.ver}`));
  console.error(`Fix: set every "?v=" in the public pages to ${swVer} so they pull the fresh sources.`);
  process.exit(1);
}
console.log(`check-cache-version OK: sw.js and ${pages.length} public page${pages.length !== 1 ? 's' : ''} pinned to v${swVer}, ${total} buster${total !== 1 ? 's' : ''} checked: ${seen.join(', ')}`);
