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

if (process.exitCode) {
  console.error('\ncheck-build FAILED');
} else {
  console.log(`check-build OK: ${jsxSources.length} JSX sources mapped to ${Object.keys(bundles).length} bundles, ${assets.length} precache entries present in dist/`);
}
