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
const plainSources = ['src/store.js', 'src/whatsnew.js', 'sw.js', 'src/programs-db.js', 'src/feature-map-db.js'];

// Files that share one global scope in the browser (everything except sw.js,
// which runs in its own Service Worker realm, and vendored supabase.js).
// Classic <script>s share a single global object, which makes two DIFFERENT
// failure modes possible here:
//   - A duplicate top-level `function` declaration silently shadows the
//     earlier one for every unqualified call site (last one loaded wins).
//     Real incident this caught: a duplicate getCyclePosForDate in
//     screens-coaching-client.jsx silently broke mesocycle date alignment
//     for every unqualified caller in store.js.
//   - A duplicate top-level `const`/`let` declaration THROWS "Identifier
//     'X' has already been declared" the moment the second file's script
//     tag runs, which aborts that entire script, not just the redeclared
//     name: every other declaration in that file is silently lost too.
//     preset-env does NOT downlevel const/let to var for this app's
//     esmodules target (verified: `const x = 1` transpiles to `const x = 1`
//     unchanged), so this is a real, load-order-dependent crash, not a
//     theoretical one. Two real incidents this now catches: FOOD_HISTORY_
//     WINDOW_DAYS duplicated between store.js and screens-health.jsx took
//     down the entire Health tab (DailyLogScreen, HealthScreen, everything
//     else in the file), and isImprovement/isDecline duplicated between
//     screens-lib.jsx and screens-coaching-core.jsx took down the entire
//     Coaching module the moment that pairing first reached production.
const globalScopeSources = ['src/store.js', 'src/whatsnew.js', ...jsxSources];

let failed = false;
const functionDecls = new Map(); // name -> [{ file, body }]
const varDecls = new Map(); // name -> [file, ...] (const/let only; var/function-scoped names collide harmlessly)

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
        if (node.type === 'FunctionDeclaration' && node.id?.name) {
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
        } else if (node.type === 'VariableDeclaration' && (node.kind === 'const' || node.kind === 'let')) {
          for (const d of node.declarations) {
            const names = [];
            if (d.id.type === 'Identifier') names.push(d.id.name);
            else if (d.id.type === 'ObjectPattern') for (const p of d.id.properties) if (p.value?.type === 'Identifier') names.push(p.value.name);
            else if (d.id.type === 'ArrayPattern') for (const e of d.id.elements) if (e?.type === 'Identifier') names.push(e.name);
            for (const name of names) {
              if (!varDecls.has(name)) varDecls.set(name, []);
              varDecls.get(name).push(rel);
            }
          }
        }
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

for (const [name, files] of varDecls) {
  const uniqueFiles = [...new Set(files)];
  if (uniqueFiles.length < 2) continue;
  // Unlike function/var, a duplicate const/let is never a harmless overwrite:
  // it throws unconditionally, regardless of whether both sides declare the
  // exact same value.
  failed = true;
  console.error(`FAIL duplicate top-level const/let '${name}' declared in: ${uniqueFiles.join(', ')}`);
  console.error('     Classic scripts share one global scope — the file that loads second throws');
  console.error('     "Identifier has already been declared", which silently kills every other');
  console.error('     declaration in that file too, not just this name. Declare it in exactly one');
  console.error('     file and reference it as a plain global (or via window.LB) from the rest.');
}

process.exit(failed ? 1 : 0);
