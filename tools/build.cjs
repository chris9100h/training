#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Babel = require('@babel/standalone');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const staticFiles = [
  'index.html', 'sw.js', 'manifest.json', '.nojekyll',
  'welcome.html', 'features.html', 'autoreg.html', 'CNAME',
];
const staticDirectories = ['src', 'icons', 'Background', 'screenshots'];
const plainScripts = [
  'src/supabase.js',
  'src/store.js',
  'src/whatsnew.js',
  'src/exercise-db.js',
  'src/feature-map-db.js',
  'src/programs-db.js',
];
const criticalSources = [
  'src/ui.jsx',
  'src/screens-home.jsx',
  'src/app.jsx',
];
const routeBundles = {
  schedule: ['src/screens-schedule.jsx'],
  train: ['src/screens-train.jsx'],
  lib: ['src/screens-lib.jsx'],
  settings: ['src/screens-settings.jsx'],
  coaching: [
    'src/screens-coaching-core.jsx',
    'src/screens-coaching-client.jsx',
    'src/screens-coaching-detail.jsx',
    'src/screens-coaching-tabs.jsx',
  ],
  health: ['src/screens-health.jsx'],
  water: ['src/screens-water.jsx'],
  food: ['src/screens-food.jsx'],
  medications: ['src/screens-medications.jsx'],
  onboarding: ['src/screens-onboarding.jsx'],
  cardio: ['src/screens-cardio.jsx'],
  featuremap: ['src/screens-featuremap.jsx'],
  autoreg: ['src/screens-autoreg-guide.jsx'],
};

function readSources() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const match = html.match(/var SOURCES = \[([\s\S]*?)\];/);
  if (!match) throw new Error('Could not find SOURCES in index.html');
  return [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

// The plain-JS core files (store.js etc.) aren't in SOURCES, the precompile
// loader's JSX list: index.html loads them directly via <script src> tags
// between the BUILD_CORE_SCRIPTS markers, the same block patchIndex() below
// replaces with the single bundled core.js tag. Read that block back so
// plainScripts can be cross-checked the same way validateCoverage() already
// cross-checks the JSX bundles, instead of drifting silently.
function readCoreScripts() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const block = html.match(/<!-- BUILD_CORE_SCRIPTS_START -->([\s\S]*?)<!-- BUILD_CORE_SCRIPTS_END -->/);
  if (!block) throw new Error('Could not find BUILD_CORE_SCRIPTS markers in index.html');
  return [...block[1].matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
}

function copy(rel) {
  const from = path.join(root, rel);
  const to = path.join(dist, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

function compile(rel, source) {
  // Plain-JS core files already run directly in the no-build app. Keep them
  // byte-identical in the preview core too: Babel is only needed for JSX, and
  // transforming store.js would unnecessarily change the Supabase auth/write
  // path between the source fallback and the built preview.
  if (!rel.endsWith('.jsx')) return source;
  const presets = ['react', ['env', { targets: { esmodules: true } }]];
  return Babel.transform(source, {
    presets,
    sourceType: 'script',
    filename: rel,
    compact: true,
    comments: false,
  }).code;
}

function writeBundle(name, sources, totals) {
  const parts = [];
  for (const rel of sources) {
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    const code = compile(rel, source);
    parts.push(code);
    totals.input += Buffer.byteLength(source);
    totals.output += Buffer.byteLength(code);
  }
  const rel = `src/_build/${name}.js`;
  const outputPath = path.join(dist, rel);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, parts.join('\n') + '\n');
  return rel;
}

function patchIndex(bundlePaths) {
  const indexPath = path.join(dist, 'index.html');
  let index = fs.readFileSync(indexPath, 'utf8');
  const coreBlock = /<!-- BUILD_CORE_SCRIPTS_START -->[\s\S]*?<!-- BUILD_CORE_SCRIPTS_END -->/;
  if (!coreBlock.test(index)) throw new Error('Core script build markers missing from index.html');
  index = index.replace(coreBlock, [
    '<!-- BUILD_CORE_SCRIPTS_START -->',
    '<script src="src/_build/core.js"></script>',
    '<!-- BUILD_CORE_SCRIPTS_END -->',
  ].join('\n'));

  const buildMarker = 'var PRECOMPILED_BUILD = false;';
  if (!index.includes(buildMarker)) throw new Error('Build marker missing from index.html');
  index = index.replace(buildMarker, 'var PRECOMPILED_BUILD = true;');

  const bundleMarker = 'var PRECOMPILED_BUNDLES = null;';
  if (!index.includes(bundleMarker)) throw new Error('Bundle marker missing from index.html');
  index = index.replace(bundleMarker, `var PRECOMPILED_BUNDLES = ${JSON.stringify(bundlePaths)};`);
  fs.writeFileSync(indexPath, index);
}

function patchServiceWorker(bundlePaths) {
  const swPath = path.join(dist, 'sw.js');
  let sw = fs.readFileSync(swPath, 'utf8');
  const assets = [
    '/',
    '/index.html',
    '/manifest.json',
    ...Object.values(bundlePaths).map(rel => `/${rel}`),
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-180.png',
  ];
  const body = assets.map(rel => `  BASE + '${rel}',`).join('\n');
  const assetBlock = /const ASSETS = \[[\s\S]*?\];/;
  if (!assetBlock.test(sw)) throw new Error('ASSETS block missing from sw.js');
  sw = sw.replace(assetBlock, `const ASSETS = [\n${body}\n];`);
  fs.writeFileSync(swPath, sw);
}

function validateCoverage(jsxSources) {
  const bundled = new Set([...criticalSources, ...Object.values(routeBundles).flat()]);
  const missing = jsxSources.filter(rel => !bundled.has(rel));
  const extra = [...bundled].filter(rel => !jsxSources.includes(rel));
  if (missing.length) throw new Error(`JSX sources are not assigned to a route bundle: ${missing.join(', ')}`);
  if (extra.length) throw new Error(`Route bundle references unknown JSX sources: ${extra.join(', ')}`);
}

function validatePlainScripts(coreScripts) {
  const missing = coreScripts.filter(rel => !plainScripts.includes(rel));
  const extra = plainScripts.filter(rel => !coreScripts.includes(rel));
  if (missing.length) throw new Error(`index.html loads plain scripts missing from build.cjs's plainScripts: ${missing.join(', ')}`);
  if (extra.length) throw new Error(`build.cjs's plainScripts references scripts not loaded by index.html: ${extra.join(', ')}`);
  if (coreScripts.join('|') !== plainScripts.join('|')) {
    throw new Error(`plainScripts order does not match index.html's BUILD_CORE_SCRIPTS order: [${plainScripts.join(', ')}] vs [${coreScripts.join(', ')}]`);
  }
}

function build() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  for (const rel of staticFiles) {
    if (fs.existsSync(path.join(root, rel))) copy(rel);
  }
  for (const rel of staticDirectories) {
    if (fs.existsSync(path.join(root, rel))) copy(rel);
  }

  const jsxSources = readSources().filter(rel => rel.endsWith('.jsx'));
  validateCoverage(jsxSources);
  validatePlainScripts(readCoreScripts());
  const totals = { input: 0, output: 0 };
  const bundlePaths = {};
  bundlePaths.core = writeBundle('core', plainScripts, totals);
  bundlePaths.critical = writeBundle('critical', criticalSources, totals);
  for (const [name, sources] of Object.entries(routeBundles)) {
    bundlePaths[name] = writeBundle(name, sources, totals);
  }

  patchIndex(bundlePaths);
  patchServiceWorker(bundlePaths);
  const ratio = totals.input ? Math.round((totals.output / totals.input) * 100) : 0;
  console.log(`build OK: ${jsxSources.length} JSX sources -> ${Object.keys(bundlePaths).length} bundles in dist/ (${totals.input} -> ${totals.output} bytes, ${ratio}% of source)`);
}

try {
  build();
} catch (error) {
  console.error('build FAILED');
  console.error(error.stack || error);
  process.exitCode = 1;
}
