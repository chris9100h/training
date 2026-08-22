#!/usr/bin/env node
/* Focused unit tests for keyboardViewportReservation() in src/ui.jsx, the
   helper every Sheet uses to decide how much bottom space to reserve for the
   on-screen keyboard.

   Why this has its own suite: the same mistake has now been made twice, and
   both times it shipped, because the two mobile browsers disagree about what
   the keyboard does to the LAYOUT viewport (which is what a position:fixed
   overlay is laid out in):

     Chrome on Android honours interactive-widget=resizes-content and shrinks
     the layout viewport itself, so a fixed overlay already ends above the keys
     and must reserve NOTHING. Reserving the keyboard height there pushes the
     sheet clean off the top of the screen.

     iOS keeps the layout viewport at full height and overlays the keyboard, so
     the very same overlay runs on behind it and must reserve ALL of it.

   The helper is pure, so it is lifted out of the JSX by name and run directly.
   No build step, no test framework. Run: node this file. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const FN = 'keyboardViewportReservation';

function loadHelper() {
  const source = fs.readFileSync(path.join(__dirname, '../../src/ui.jsx'), 'utf8');
  const start = source.indexOf(`function ${FN}(`);
  assert.ok(start > -1, `${FN} not found in src/ui.jsx (renamed or removed?)`);
  // Pure function, no JSX inside: cut to the first line that closes it at
  // column 0, which is the file's own formatting for every top-level function.
  const end = source.indexOf('\n}\n', start);
  assert.ok(end > start, `could not find the end of ${FN}`);
  const code = source.slice(start, end + 3);
  assert.ok(!/<[A-Za-z]/.test(code), `${FN} must stay JSX-free so this test can run it unbuilt`);
  const context = {};
  vm.runInNewContext(`${code}\nthis.fn = ${FN};`, context);
  return context.fn;
}

const reservation = loadHelper();

// A 900px-tall phone with a 380px keyboard, leaving 520px visible.
const FULL = 900;
const VISIBLE = 520;
const KEYBOARD = FULL - VISIBLE;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('Android (resizes-content): browser already shrank the layout viewport, reserve nothing', () => {
  const r = reservation({
    layoutHeight: VISIBLE,        // Chrome shrank this together with the visual viewport
    visualHeight: VISIBLE,
    visualOffsetTop: 0,
    baselineHeight: FULL,         // last keyboard-free height
    typing: true,
  });
  assert.strictEqual(r.keyboardGap, KEYBOARD, 'the keyboard must still be detected as open');
  assert.strictEqual(r.reserve, 0, 'a fixed layer ending above the keys must reserve nothing');
});

test('iOS (keyboard overlays a full-height layout viewport): reserve the whole keyboard', () => {
  const r = reservation({
    layoutHeight: FULL,           // unchanged, the keyboard just sits on top
    visualHeight: VISIBLE,
    visualOffsetTop: 0,
    baselineHeight: FULL,
    typing: true,
  });
  assert.strictEqual(r.keyboardGap, KEYBOARD);
  assert.strictEqual(r.reserve, KEYBOARD, 'the overlay runs on behind the keyboard here');
});

test('iOS with the visual viewport panned up: the pan counts towards the covered part', () => {
  const r = reservation({
    layoutHeight: FULL,
    visualHeight: VISIBLE,
    visualOffsetTop: 40,          // WebKit panned the page under the keyboard
    typing: true,
    baselineHeight: FULL,
  });
  assert.strictEqual(r.reserve, FULL - VISIBLE - 40);
});

test('no field focused: never reserve, whatever the viewports say', () => {
  const r = reservation({
    layoutHeight: FULL,
    visualHeight: VISIBLE,        // e.g. a browser toolbar, not a keyboard
    visualOffsetTop: 0,
    baselineHeight: FULL,
    typing: false,
  });
  assert.strictEqual(r.keyboardGap, 0);
  assert.strictEqual(r.reserve, 0);
});

test('keyboard dismissed while the field keeps focus: nothing reserved', () => {
  const r = reservation({
    layoutHeight: FULL,
    visualHeight: FULL,
    visualOffsetTop: 0,
    baselineHeight: FULL,
    typing: true,
  });
  assert.strictEqual(r.keyboardGap, 0);
  assert.strictEqual(r.reserve, 0);
});

test('stale baseline shorter than the live layout viewport cannot force a reservation', () => {
  // Rotation or a collapsing browser toolbar can leave the stored baseline
  // behind. The reservation must follow the live viewports, not the stale one.
  const r = reservation({
    layoutHeight: FULL,
    visualHeight: FULL,
    visualOffsetTop: 0,
    baselineHeight: 400,
    typing: true,
  });
  assert.strictEqual(r.reserve, 0);
});

test('reservation never exceeds what the keyboard actually covers', () => {
  // A baseline inflated by a since-collapsed browser toolbar must not be paid
  // for on top of the keyboard.
  const r = reservation({
    layoutHeight: VISIBLE + 100,
    visualHeight: VISIBLE,
    visualOffsetTop: 0,
    baselineHeight: FULL + 200,
    typing: true,
  });
  assert.strictEqual(r.reserve, 100, 'clamped to the covered part of the fixed layer');
});

test('reservation is never negative', () => {
  const r = reservation({
    layoutHeight: VISIBLE,
    visualHeight: FULL,           // visual viewport larger than layout (pinch-zoom out)
    visualOffsetTop: 0,
    baselineHeight: FULL,
    typing: true,
  });
  assert.ok(r.reserve >= 0, `reserve was ${r.reserve}`);
  assert.ok(r.keyboardGap >= 0, `keyboardGap was ${r.keyboardGap}`);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}\n        ${error.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
