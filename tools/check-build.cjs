#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

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

const sourcesMatch = sourceHtml.match(/var SOURCES = \[([\s\S]*?)\];/);
if (!sourcesMatch) {
  fail('could not find SOURCES in index.html');
  process.exit(1);
}
const jsxSources = [...sourcesMatch[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
const scriptTags = [...sourceHtml.matchAll(/<script src="(src\/[^"?]+)"/g)].map(match => match[1]);
const loaded = [...jsxSources, ...scriptTags];

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

if (process.exitCode) {
  console.error('\ncheck-build FAILED');
} else {
  console.log(`check-build OK: ${loaded.length} loaded files and ${assets.length} precache entries present in dist/`);
}
