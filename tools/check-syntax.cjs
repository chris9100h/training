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
const plainSources = ['src/store.js', 'src/whatsnew.js', 'sw.js', 'src/programs-db.js'];

// Files that share one global scope in the browser (everything except sw.js,
// which runs in its own Service Worker realm, and vendored supabase.js). A
// duplicate top-level `function` declaration across any of these silently
// shadows the earlier one for every unqualified call site, because classic
// <script>s share a single global object — unlike `const`/`let` aliases
// (e.g. `const isImprovement = LB.isImprovement;`), which are a deliberate,
// safe pattern in this codebase since preset-env downlevels them to `var`.
// Real incident this caught: a duplicate getCyclePosForDate in
// screens-coaching-client.jsx silently broke mesocycle date alignment for
// every unqualified caller in store.js.
const globalScopeSources = ['src/store.js', 'src/whatsnew.js', ...jsxSources];

let failed = false;
const functionDecls = new Map(); // name -> [{ file, body }]

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
    if (globalScopeSources.includes(rel)) {
      const parsed = Babel.transform(src, { presets: ['react'], sourceType: 'script', ast: true, code: true, filename: rel });
      for (const node of parsed.ast.program.body) {
        if (node.type !== 'FunctionDeclaration' || !node.id?.name) continue;
        const name = node.id.name;
        // Babel injects synthetic helpers (_extends, _objectSpread, ...) for
        // JSX spread props etc. — these never appear as `function NAME` in the
        // hand-authored source, only in the transformed output, and are
        // legitimately duplicated verbatim across files. Skip them; we only
        // care about collisions between actually-authored declarations.
        if (!new RegExp(`\\bfunction\\s+${name}\\b`).test(src)) continue;
        const body = parsed.code.slice(node.start, node.end);
        if (!functionDecls.has(name)) functionDecls.set(name, []);
        functionDecls.get(name).push({ file: rel, body });
      }
    }
  } catch (e) {
    failed = true;
    console.error(`FAIL ${rel}\n     ${String(e.message).split('\n')[0]}`);
  }
}

for (const [name, entries] of functionDecls) {
  if (entries.length < 2) continue;
  // Identical bodies (e.g. a Babel-injected helper duplicated verbatim in
  // every file) are a harmless no-op overwrite, not a real collision.
  if (new Set(entries.map(e => e.body)).size < 2) continue;
  failed = true;
  console.error(`FAIL duplicate top-level function '${name}' with DIFFERING bodies in: ${entries.map(e => e.file).join(', ')}`);
  console.error('     Classic scripts share one global scope — whichever file loads last silently');
  console.error('     overwrites the others for every unqualified (non-LB.-prefixed) call site.');
}

process.exit(failed ? 1 : 0);
