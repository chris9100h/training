#!/usr/bin/env node
// CI gate: the public feature-map page (features.html) lives OUTSIDE the service
// worker, so unlike the app it has no SW cache version to force a refetch. It
// relies on a ?v= cache-buster on src/feature-map-db.js that must be bumped in
// lockstep with the SW cache version (const CACHE in sw.js). If they drift, a
// fresh deploy keeps serving the stale catalog to the public page while the app
// itself already has the new one. This was a real bug class, so gate it: assert
// every ?v= buster in features.html matches the sw.js CACHE version.
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

const feat = fs.readFileSync(path.join(root, 'features.html'), 'utf8');
const busters = [...feat.matchAll(/feature-map-db\.js\?v=([0-9.]+)/g)];
if (!busters.length) {
  console.error('check-cache-version: could not find any "feature-map-db.js?v=" buster in features.html');
  process.exit(1);
}

const bad = busters.filter(m => m[1] !== swVer);
if (bad.length) {
  console.error(`check-cache-version FAIL: sw.js CACHE is zane-v${swVer}, but features.html has ?v=${bad.map(m => m[1]).join(', ?v=')}`);
  console.error(`Fix: set every "feature-map-db.js?v=" in features.html to ${swVer} so the public page pulls the fresh catalog.`);
  process.exit(1);
}
console.log(`check-cache-version OK: sw.js and features.html both pinned to v${swVer} (${busters.length} buster${busters.length !== 1 ? 's' : ''})`);
