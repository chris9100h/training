#!/usr/bin/env node
/* Transpiles every app source exactly like the in-app precompile loader does
   (Babel standalone, presets react+env with esmodules targets, sourceType
   script) and fails on the first error. This catches the worst failure mode
   of the no-build setup:
   a single syntax error blanks the entire app, and GitHub Pages deploys
   every push immediately.

   The JSX file list is parsed from the loader's SOURCES array in index.html
   so CI can never drift from what the app actually loads. */
const fs = require('fs');
const path = require('path');
const Babel = require('@babel/standalone');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const m = html.match(/var SOURCES = \[([\s\S]*?)\];/);
if (!m) {
  console.error('FAIL could not find the SOURCES list in index.html');
  process.exit(1);
}
const jsxSources = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);

// Plain scripts loaded via <script src> (vendored supabase.js excluded:
// minified third-party bundle, not authored here).
const plainSources = ['src/store.js', 'src/whatsnew.js', 'sw.js'];

let failed = false;
for (const rel of [...plainSources, ...jsxSources]) {
  const file = path.join(root, rel);
  let src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch (e) {
    failed = true;
    console.error(`FAIL ${rel} — listed in index.html but missing on disk`);
    continue;
  }
  try {
    Babel.transform(src, { presets: ['react', ['env', { targets: { esmodules: true } }]], sourceType: 'script', filename: rel });
    console.log(`ok   ${rel}`);
  } catch (e) {
    failed = true;
    console.error(`FAIL ${rel}\n     ${String(e.message).split('\n')[0]}`);
  }
}

process.exit(failed ? 1 : 0);
