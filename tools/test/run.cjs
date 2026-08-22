#!/usr/bin/env node
/*
 * One local/CI entry point for the focused unit tests. The live Supabase
 * probes in tools/test-*.cjs deliberately stay opt-in because they need real
 * credentials and can change external state.
 */
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const suites = [
  'feature-map-bake.test.cjs',
  'frontend-security-validation.test.cjs',
  'coaching-drive-storage.test.cjs',
  'reminder-time.test.cjs',
  'notification-delivery.test.cjs',
  'store.test.cjs',
  'keyboard-viewport.test.cjs',
];
const configuredTimeout = Number(process.env.ZANE_TEST_SUITE_TIMEOUT_MS);
const suiteTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 1000
  ? configuredTimeout
  : 120000;

const failures = [];
for (const suite of suites) {
  const file = path.join(__dirname, suite);
  console.log(`\n=== ${suite} ===`);
  const result = spawnSync(process.execPath, [file], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    timeout: suiteTimeoutMs,
    killSignal: 'SIGTERM',
  });
  if (result.error || result.status !== 0) {
    failures.push({ suite, status: result.status, error: result.error });
  }
}

if (failures.length) {
  console.error(`\n${failures.length} test suite(s) failed:`);
  for (const failure of failures) {
    const detail = failure.error ? failure.error.message : `exit ${failure.status}`;
    console.error(`- ${failure.suite}: ${detail}`);
  }
  process.exitCode = 1;
} else {
  console.log(`\nAll ${suites.length} focused unit suites passed.`);
}
