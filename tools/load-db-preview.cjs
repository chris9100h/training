#!/usr/bin/env node
'use strict';

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_TEST_EMAIL', 'SUPABASE_TEST_PASSWORD'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}

const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
const anonKey = process.env.SUPABASE_ANON_KEY;
const durationSeconds = Math.max(10, Number(process.argv[2] || 600));
const durationMs = durationSeconds * 1000;
const metrics = {
  requests: 0,
  errors: 0,
  timeouts: 0,
  inFlight: 0,
  maxInFlight: 0,
  durations: [],
  statuses: {},
  labels: {},
  errorSamples: {},
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function login() {
  const response = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.SUPABASE_TEST_EMAIL,
      password: process.env.SUPABASE_TEST_PASSWORD,
    }),
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token || !payload.user?.id) {
    throw new Error(`Preview login failed with HTTP ${response.status}`);
  }
  return { token: payload.access_token, userId: payload.user.id };
}

function recordLabel(label, ok) {
  const current = metrics.labels[label] || { requests: 0, errors: 0 };
  current.requests += 1;
  if (!ok) current.errors += 1;
  metrics.labels[label] = current;
}

async function request(auth, label, path, init = {}) {
  const started = Date.now();
  metrics.requests += 1;
  metrics.inFlight += 1;
  metrics.maxInFlight = Math.max(metrics.maxInFlight, metrics.inFlight);
  try {
    const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
      method: init.method || 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(8000),
    });
    const responseBody = await response.text();
    metrics.statuses[response.status] = (metrics.statuses[response.status] || 0) + 1;
    if (!response.ok) {
      metrics.errors += 1;
      if (!metrics.errorSamples[label]) {
        metrics.errorSamples[label] = {
          status: response.status,
          body: responseBody.slice(0, 500),
        };
      }
    }
    recordLabel(label, response.ok);
    return response.ok;
  } catch (error) {
    metrics.errors += 1;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') metrics.timeouts += 1;
    recordLabel(label, false);
    return false;
  } finally {
    metrics.inFlight -= 1;
    metrics.durations.push(Date.now() - started);
  }
}

async function runPool(tasks, concurrency) {
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const task = tasks[next];
      next += 1;
      await task();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
}

function tableTask(auth, table) {
  return () => request(auth, `boot:${table}`, `${table}?select=*&limit=1`);
}

async function coldBoot(auth) {
  const cutoff = new Date(Date.now() - 70 * 86400000).toISOString().slice(0, 10);
  const coreTables = [
    'zane_user_settings', 'zane_exercises', 'zane_schedules', 'zane_sessions',
    'zane_daily_logs', 'zane_cardio_logs', 'zane_meso_states', 'zane_food_logs',
    'zane_water_logs', 'zane_medications', 'zane_medication_logs', 'zane_status_periods',
  ];
  const core = coreTables.map(table => tableTask(auth, table));
  core.push(
    () => request(auth, 'boot:runtime', 'rpc/get_runtime_config', { method: 'POST', body: {} }),
    () => request(auth, 'boot:best', 'rpc/get_exercise_best_e1rm', { method: 'POST', body: { p_user_id: null } }),
  );
  await runPool(core, 4);

  const deferredTables = [
    'zane_push_subscriptions', 'zane_plan_drafts', 'zane_food_recipes',
    'zane_food_favorites', 'zane_medication_schedule_slots',
  ];
  const deferred = deferredTables.map(table => tableTask(auth, table));
  deferred.push(() => request(auth, 'boot:stats', 'rpc/get_session_stats', {
    method: 'POST', body: { p_user_id: null, p_cutoff: cutoff },
  }));
  await runPool(deferred, 2);
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function progress(started) {
  const elapsedSeconds = Math.round((Date.now() - started) / 1000);
  console.log(JSON.stringify({
    elapsedSeconds,
    requests: metrics.requests,
    errors: metrics.errors,
    timeouts: metrics.timeouts,
    maxInFlight: metrics.maxInFlight,
    p95Ms: percentile(metrics.durations, 0.95),
  }));
}

async function main() {
  const auth = await login();
  const started = Date.now();
  await Promise.all(Array.from({ length: 20 }, () => coldBoot(auth)));

  const today = new Date().toISOString().slice(0, 10);
  const monday = new Date();
  const day = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - day + 1);
  const weekStart = monday.toISOString().slice(0, 10);
  await Promise.all(Array.from({ length: 5 }, () => request(auth, 'social:dashboard', 'rpc/social_get_dashboard', {
    method: 'POST', body: { p_week_start: weekStart, p_today: today },
  })));

  let nextSocial = Date.now();
  let nextViewer = Date.now();
  let nextBackground = Date.now() + 120000;
  let nextProgress = Date.now() + 60000;
  while (Date.now() - started < durationMs) {
    const now = Date.now();
    const work = [];
    if (now >= nextSocial) {
      nextSocial = now + 10000;
      for (let i = 0; i < 5; i += 1) {
        work.push(request(auth, 'social:badge', 'rpc/social_get_badge', { method: 'POST', body: {} }));
      }
    }
    if (now >= nextViewer) {
      nextViewer = now + 5000;
      for (let i = 0; i < 3; i += 1) {
        work.push(request(auth, 'viewer:feed', 'rpc/social_get_workout_feed', { method: 'POST', body: {} }));
      }
    }
    if (now >= nextBackground) {
      nextBackground = now + 120000;
      for (let i = 0; i < 20; i += 1) {
        work.push(request(auth, 'background:runtime', 'rpc/get_runtime_config', { method: 'POST', body: {} }));
      }
    }
    if (work.length) await Promise.all(work);
    if (now >= nextProgress) {
      progress(started);
      nextProgress += 60000;
    }
    await sleep(100);
  }

  progress(started);
  const errorRate = metrics.requests ? metrics.errors / metrics.requests : 0;
  const summary = {
    durationSeconds,
    requests: metrics.requests,
    errors: metrics.errors,
    errorRate,
    timeouts: metrics.timeouts,
    maxInFlight: metrics.maxInFlight,
    p50Ms: percentile(metrics.durations, 0.50),
    p95Ms: percentile(metrics.durations, 0.95),
    p99Ms: percentile(metrics.durations, 0.99),
    statuses: metrics.statuses,
    failingLabels: Object.fromEntries(Object.entries(metrics.labels).filter(([, value]) => value.errors > 0)),
    errorSamples: metrics.errorSamples,
  };
  console.log(`FINAL ${JSON.stringify(summary)}`);
  if (metrics.timeouts > 0 || errorRate > 0.01) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
