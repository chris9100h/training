#!/usr/bin/env node
/* Guards the one bug class that has now shipped twice: an overlay sizing
   itself against the LAYOUT viewport when it should use the VISIBLE one.

   The two mobile browsers disagree about what the on-screen keyboard does to
   the layout viewport (Chrome on Android honours our
   interactive-widget=resizes-content and shrinks it; iOS leaves it alone and
   overlays the keyboard), and a position:fixed overlay is laid out in exactly
   that viewport. Both shipped regressions came from the same shape of code:

     2026-08-19  Sheet reserved the keyboard height as backdrop padding even
                 where the browser had already shrunk the viewport, pushing
                 every sheet with a text field off the top of the screen.
     (older)     The wizards capped their panel at 86vh, which measures the
                 layout viewport, so on an iOS PWA a 774px panel sat in 520px
                 of visible space and lost its focused field off both edges.

   Neither is a syntax error and neither shows up on a desktop browser, so the
   only thing that catches them early is a rule. Two of them:

     A  A scope that reads visualViewport AND a layout-viewport height must
        get its answer from keyboardViewportReservation(), or be listed below.
     B  A scope that reads visualViewport must not size a box in vh/dvh unless
        that value is clamped by a percentage of its (already correctly sized)
        container, or is listed below.

   Known limit, deliberately not papered over: the scan works per named
   top-level function. A child component rendered inside a viewport-aware
   overlay but declared as its own function is not seen (e.g.
   AdminSupportChatFrame, which uses 65vh/100dvh inside FullSheet and was
   measured to be fine). Rule B catches the wizard shape because the panel is
   declared in the same function as the visualViewport subscription.

   Run: node tools/check-viewport-geometry.cjs */
const fs = require('fs');
const path = require('path');
const Babel = require('@babel/standalone');

const { parser, traverse } = Babel.packages;
const root = path.join(__dirname, '..');

// ─── Allowlists ─────────────────────────────────────────────────────
// Every entry needs a reason. If you are adding one to make CI pass, that is
// the moment to re-read docs/internals.md, "Keyboard & Viewport" first.

const ALLOWED_OWN_MATH = {
  'src/ui.jsx:keepFocusedInputVisible':
    'Measures the visible band directly (vv.offsetTop + vv.height) to scroll a field into it. '
    + 'Derives no keyboard height and sizes no box, so there is nothing to reserve.',
  'index.html:inline-script':
    'The app shell watcher itself, which publishes --app-viewport-top/height and therefore '
    + 'runs before ui.jsx exists. It is the one place allowed to answer this from scratch; '
    + 'its output is what every other layer then trusts.',
};

const ALLOWED_VIEWPORT_UNITS = {
  'src/ui.jsx:Sheet':
    'The 82dvh/88dvh branches apply only when the backdrop spans the full layout viewport '
    + '(no keyboard, or a browser that shrank the viewport itself, where dvh shrinks with it). '
    + 'The keyboard-open branch uses the measured vvHeight instead.',
};

// ─── Scan ───────────────────────────────────────────────────────────
const VIEWPORT_UNIT = /\b\d*\.?\d+(?:vh|dvh|svh|lvh)\b/;
// A vh value is fine when clamped against a percentage of the container, which
// is the documented correct shape: min(86vh, calc(100% - 48px)).
const CLAMPED_BY_PERCENT = /\b(?:min|clamp)\s*\([^)]*%/;
const SIZE_PROPS = new Set(['height', 'maxHeight', 'minHeight']);
const HELPER = 'keyboardViewportReservation';

function isLayoutViewportHeight(node) {
  // window.innerHeight / document*.clientHeight only. An element's own
  // clientHeight is ordinary layout measurement, not the viewport.
  if (node.type !== 'MemberExpression' || node.property?.type !== 'Identifier') return false;
  const prop = node.property.name;
  if (prop === 'innerHeight') return true;
  if (prop !== 'clientHeight') return false;
  const obj = node.object;
  const objName = obj?.type === 'Identifier' ? obj.name
    : obj?.type === 'MemberExpression' ? obj.property?.name
      : null;
  return objName === 'documentElement' || objName === 'document';
}

function scanScope(nodePath, code, name, line) {
  const rec = { name, line, viewportAware: false, layoutHeight: false, usesHelper: false, units: [] };
  const visit = {
    Identifier(q) {
      if (q.node.name === 'visualViewport') rec.viewportAware = true;
      if (q.node.name === HELPER) rec.usesHelper = true;
    },
    MemberExpression(q) {
      if (isLayoutViewportHeight(q.node)) rec.layoutHeight = true;
    },
    ObjectProperty(q) {
      const key = q.node.key?.name || q.node.key?.value;
      if (!SIZE_PROPS.has(key)) return;
      const src = code.slice(q.node.value.start, q.node.value.end);
      if (!VIEWPORT_UNIT.test(src)) return;
      // Split a ternary into its branches so one clamped branch cannot excuse
      // an unclamped sibling.
      const branches = q.node.value.type === 'ConditionalExpression'
        ? [q.node.value.consequent, q.node.value.alternate].map(b => code.slice(b.start, b.end))
        : [src];
      for (const branch of branches) {
        if (!VIEWPORT_UNIT.test(branch) || CLAMPED_BY_PERCENT.test(branch)) continue;
        rec.units.push({ key, line: q.node.loc.start.line, src: branch.replace(/\s+/g, ' ').slice(0, 90) });
      }
    },
  };
  visit.Identifier(nodePath);   // no-op for a path, kept for symmetry with traverse
  nodePath.traverse(visit);
  return rec;
}

function scanCode(code, label, { plugins = [] } = {}) {
  let ast;
  try {
    ast = parser.parse(code, { sourceType: 'script', plugins, errorRecovery: true });
  } catch (e) {
    console.error(`FAIL ${label}: could not parse (${e.message})`);
    process.exit(1);
  }
  const scopes = [];
  traverse.default(ast, {
    'FunctionDeclaration|FunctionExpression|ClassMethod'(p) {
      const name = p.node.id?.name || p.node.key?.name;
      // Top-level named functions only: nested helpers are covered by their
      // parent's traversal, so this counts each scope exactly once.
      if (!name || p.getFunctionParent()) return;
      scopes.push(scanScope(p, code, name, p.node.loc.start.line));
    },
  });
  return scopes;
}

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sourcesMatch = html.match(/var SOURCES = \[([\s\S]*?)\];/);
if (!sourcesMatch) {
  console.error('FAIL could not find the SOURCES list in index.html');
  process.exit(1);
}
const jsxSources = [...sourcesMatch[1].matchAll(/'([^']+)'/g)].map(x => x[1]);

const findings = [];
let scanned = 0;
let aware = 0;

for (const rel of jsxSources) {
  const code = fs.readFileSync(path.join(root, rel), 'utf8');
  scanned += 1;
  for (const scope of scanCode(code, rel, { plugins: ['jsx'] })) {
    if (!scope.viewportAware) continue;
    aware += 1;
    const key = `${rel}:${scope.name}`;
    if (scope.layoutHeight && !scope.usesHelper && !ALLOWED_OWN_MATH[key]) {
      findings.push({
        key, rule: 'A', where: `${rel}:${scope.line} (${scope.name})`,
        what: `reads visualViewport and a layout-viewport height but never calls ${HELPER}()`,
      });
    }
    for (const unit of scope.units) {
      if (ALLOWED_VIEWPORT_UNITS[key]) continue;
      findings.push({
        key, rule: 'B', where: `${rel}:${unit.line} (${scope.name})`,
        what: `${unit.key}: ${unit.src}`,
      });
    }
  }
}

// The shell watcher is plain inline script in index.html, not a named
// function, so treat each inline block as one scope.
const htmlWithoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
let inlineIndex = 0;
for (const match of htmlWithoutComments.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (/\bsrc\s*=/.test(match[1])) continue;
  inlineIndex += 1;
  const code = match[2];
  if (!/visualViewport/.test(code)) continue;
  scanned += 1;
  aware += 1;
  const usesHelper = code.includes(HELPER);
  const readsLayout = /\b(?:window\.innerHeight|documentElement\.clientHeight)\b/.test(code);
  if (readsLayout && !usesHelper && !ALLOWED_OWN_MATH['index.html:inline-script']) {
    findings.push({
      key: 'index.html:inline-script', rule: 'A',
      where: `index.html inline script #${inlineIndex}`,
      what: `reads visualViewport and a layout-viewport height but never calls ${HELPER}()`,
    });
  }
}

if (findings.length) {
  console.error('check-viewport-geometry FAILED\n');
  for (const f of findings) {
    console.error(`  [rule ${f.rule}] ${f.where}`);
    console.error(`      ${f.what}\n`);
  }
  console.error('Rule A: derive the space to reserve from keyboardViewportReservation() in');
  console.error('        src/ui.jsx. The keyboard\'s height is not the height to reserve:');
  console.error('        Chrome on Android already shrank the layout viewport for you, so');
  console.error('        reserving it again pushes the panel off the top of the screen.');
  console.error('Rule B: vh/dvh measure the layout viewport, which stays full height while an');
  console.error('        iOS keyboard is up. Inside an overlay that is already sized to the');
  console.error('        visible viewport, clamp against the container instead:');
  console.error('            maxHeight: \'min(86vh, calc(100% - 48px))\'');
  console.error('\nBackground: docs/internals.md, "Keyboard & Viewport".');
  console.error('If the code really is correct, add it to the allowlist at the top of this');
  console.error('file with a reason saying why.');
  process.exit(1);
}

const allowed = Object.keys(ALLOWED_OWN_MATH).length + Object.keys(ALLOWED_VIEWPORT_UNITS).length;
console.log(`check-viewport-geometry OK: ${aware} viewport-aware scopes across ${scanned} sources, `
  + `${allowed} allowlisted with reasons`);
