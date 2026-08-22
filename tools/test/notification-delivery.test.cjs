#!/usr/bin/env node
/* Executes the actual shared notification helper with mocked providers. The
   reminder state must advance only for a provider handoff that returned 2xx. */
const path = require('path');
const { loadTypeScriptModule } = require('./_helpers.cjs');

const root = path.join(__dirname, '..', '..');
const env = new Map([
  ['SUPABASE_URL', 'https://supabase.test'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'service-key'],
  ['PUSHOVER_TOKEN', 'push-token'],
]);
let fetchImpl = async (url) => {
  if (url === 'https://api.pushover.net/1/messages.json') return fakeResponse(500, 'provider down');
  if (url.includes('/functions/v1/web-push')) return fakeResponse(200, 'accepted');
  throw new Error(`unexpected fetch: ${url}`);
};
const { sendNotification } = loadTypeScriptModule(
  path.join(root, 'supabase', 'functions', '_shared', 'notifications.ts'),
  {
    console,
    Promise,
    JSON,
    AbortController,
    Response,
    Headers,
    setTimeout,
    clearTimeout,
    Deno: { env: { get: key => env.get(key) ?? '' } },
    fetch: (...args) => fetchImpl(...args),
  },
);
const { socialAuthFailureStatus, socialNotificationStatus } = loadTypeScriptModule(
  path.join(root, 'supabase', 'functions', '_shared', 'social-notification-result.ts'),
);
const { canonicalMedicationReminderEntries, medicationClaimedIds } = loadTypeScriptModule(
  path.join(root, 'supabase', 'functions', '_shared', 'medication-reminder.ts'),
);
const { isAllowedWebPushEndpoint } = loadTypeScriptModule(
  path.join(root, 'supabase', 'functions', '_shared', 'web-push-security.ts'),
  { URL },
);
let bodyFetchImpl = async () => new Response('ok');
const { fetchWithTimeout } = loadTypeScriptModule(
  path.join(root, 'supabase', 'functions', '_shared', 'fetch.ts'),
  {
    AbortController,
    Response,
    Headers,
    setTimeout,
    clearTimeout,
    fetch: (...args) => bodyFetchImpl(...args),
  },
);

function fakeResponse(status, body) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json' },
  });
}
function assert(condition, message) { if (!condition) throw new Error(message); }

(async () => {
  bodyFetchImpl = async (_url, options) => ({
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    arrayBuffer: () => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  });
  const timeoutStartedAt = Date.now();
  await fetchWithTimeout('https://provider.test/slow-body', {}, 25).then(
    () => { throw new Error('a stalled response body escaped the timeout'); },
    error => assert(error?.name === 'AbortError', 'stalled body did not abort through the shared timeout'),
  );
  assert(Date.now() - timeoutStartedAt < 1000, 'stalled body timeout took too long');

  bodyFetchImpl = async () => new Response(null, { status: 204 });
  const noContent = await fetchWithTimeout('https://provider.test/no-content', {}, 100);
  assert(noContent.status === 204 && await noContent.text() === '', 'null-body responses were not preserved');

  assert(isAllowedWebPushEndpoint('https://web.push.apple.com/QE-valid-token'), 'Apple Web Push endpoint was rejected');
  assert(isAllowedWebPushEndpoint('https://fcm.googleapis.com/fcm/send/valid-token'), 'FCM endpoint was rejected');
  for (const endpoint of [
    'http://web.push.apple.com/not-https',
    'https://127.0.0.1/internal',
    'https://169.254.169.254/latest/meta-data',
    'https://attacker.example/push',
    'https://web.push.apple.com.evil.example/fake',
  ]) {
    assert(!isAllowedWebPushEndpoint(endpoint), `unsafe push endpoint was accepted: ${endpoint}`);
  }

  const stalePlannedDose = {
    id: 'dose-1', date: '2026-08-17', time: '08:00', medication_name: 'Old name',
    schedule_slot_id: 'slot-1', reminder_sent_at: null, reminder_count: 0, snoozed_until: null,
  };
  const canonicalDoses = canonicalMedicationReminderEntries(
    [stalePlannedDose, { ...stalePlannedDose, id: 'removed', schedule_slot_id: 'removed-slot' }],
    new Map([['2026-08-17_slot-1', { time: '20:00', medicationName: 'Current name' }]]),
  );
  assert(canonicalDoses.length === 1 && canonicalDoses[0].time === '20:00'
      && canonicalDoses[0].medication_name === 'Current name',
    'reminders must use the live schedule, not a stale planned log row');
  const allowedClaimIds = new Set(['dose-1', 'dose-2']);
  assert(medicationClaimedIds([{ id: 'dose-1' }, { id: 'dose-2' }], allowedClaimIds).join(',') === 'dose-1,dose-2',
    'valid atomic-claim response ids were not preserved');
  assert(medicationClaimedIds(null, allowedClaimIds) === null
      && medicationClaimedIds({ id: 'dose-1' }, allowedClaimIds) === null
      && medicationClaimedIds([{}], allowedClaimIds) === null
      && medicationClaimedIds([{ id: '' }], allowedClaimIds) === null
      && medicationClaimedIds([{ id: 'unexpected' }], allowedClaimIds) === null
      && medicationClaimedIds([{ id: 'dose-1' }, { id: 'dose-1' }], allowedClaimIds) === null,
    'an unreadable/non-array 2xx claim body must enter the CAS rollback path');

  assert(socialNotificationStatus({ sent: 1, skipped: 0, duplicates: 0, retryable: 1 }) === 503,
    'a partial fanout failure must remain queued for the failed recipient');
  assert(socialNotificationStatus({ sent: 0, skipped: 0, duplicates: 2, retryable: 0 }) === 200,
    'a fully delivered or duplicate fanout should complete');
  assert(socialAuthFailureStatus(401) === 401 && socialAuthFailureStatus(403) === 401,
    'an explicit GoTrue token rejection must require reauthentication');
  assert(socialAuthFailureStatus(429) === 503 && socialAuthFailureStatus(500) === 503
      && socialAuthFailureStatus(null) === 503 && socialAuthFailureStatus(null, false) === 503,
    'Auth transport, throttle, server and configuration failures must remain retryable');

  const pushoverFailed = await sendNotification({
    userId: 'u1', title: 't', message: 'm', usePushover: true, pushoverUserKey: 'p1', logPrefix: 'test',
  });
  assert(pushoverFailed === false, 'a non-2xx Pushover response was treated as delivered');

  env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  const webPushAccepted = await sendNotification({
    userId: 'u1', title: 't', message: 'm', usePushover: false, pushoverUserKey: null, logPrefix: 'test',
  });
  assert(webPushAccepted === true, 'a subscription plus immediate web-push handoff was not accepted');

  fetchImpl = async (url) => {
    if (url.includes('/functions/v1/web-push')) return fakeResponse(202, 'scheduled');
    throw new Error(`unexpected fetch: ${url}`);
  };
  const delayedHandoff = await sendNotification({
    userId: 'u1', title: 't', message: 'm', usePushover: false, pushoverUserKey: null, logPrefix: 'test',
  });
  assert(delayedHandoff === false, 'a delayed web-push schedule was treated as delivered');

  fetchImpl = async (url) => url.includes('/functions/v1/web-push')
    ? fakeResponse(503, 'no subscription accepted')
    : (() => { throw new Error(`unexpected fetch: ${url}`); })();
  const noSubscription = await sendNotification({
    userId: 'u1', title: 't', message: 'm', usePushover: false, pushoverUserKey: null, logPrefix: 'test',
  });
  assert(noSubscription === false, 'a missing web-push subscription was treated as delivered');

  // ttl was declared in NotificationArgs and forwarded to Pushover but never
  // to Web Push, which hardcoded 300 seconds, so a reminder meant to stay
  // deliverable for 12 hours expired in five minutes on that channel.
  let webPushBody = null;
  fetchImpl = async (url, init) => {
    if (url.includes('/functions/v1/web-push')) { webPushBody = JSON.parse(init.body); return fakeResponse(200, 'accepted'); }
    throw new Error(`unexpected fetch: ${url}`);
  };
  await sendNotification({
    userId: 'u1', title: 't', message: 'm', usePushover: false, pushoverUserKey: null, ttl: 43200, logPrefix: 'test',
  });
  assert(webPushBody && webPushBody.ttl === 43200, 'ttl was not forwarded to web-push');

  webPushBody = null;
  await sendNotification({
    userId: 'u1', title: 't', message: 'm', usePushover: false, pushoverUserKey: null, logPrefix: 'test',
  });
  assert(webPushBody && webPushBody.ttl === undefined, 'a caller without a ttl must not pin one, web-push defaults it');

  console.log('notification-delivery OK: provider failure, partial fanout retry, subscriptions and ttl forwarding all hold');
})().catch(error => { console.error(error); process.exit(1); });
