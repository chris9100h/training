#!/usr/bin/env node
/* Executes the actual shared notification helper with mocked providers. The
   reminder state must advance only for a provider handoff that returned 2xx. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Babel = require('@babel/standalone');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'supabase', 'functions', '_shared', 'notifications.ts'), 'utf8');
const compiled = Babel.transform(source, {
  presets: ['typescript', ['env', { modules: 'commonjs' }]],
  sourceType: 'module',
  filename: 'supabase/functions/_shared/notifications.ts',
}).code;
const sandboxModule = { exports: {} };
const env = new Map([
  ['SUPABASE_URL', 'https://supabase.test'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'service-key'],
  ['PUSHOVER_TOKEN', 'push-token'],
]);
const sandbox = {
  module: sandboxModule,
  exports: sandboxModule.exports,
  console,
  Promise,
  JSON,
  Deno: { env: { get: key => env.get(key) ?? '' } },
  fetch: async (url) => {
    if (url === 'https://api.pushover.net/1/messages.json') return fakeResponse(500, 'provider down');
    if (url.includes('/rest/v1/zane_push_subscriptions')) return fakeResponse(200, [{ id: 'sub-1' }]);
    if (url.includes('/functions/v1/web-push')) return fakeResponse(200, 'accepted');
    throw new Error(`unexpected fetch: ${url}`);
  },
};
vm.runInNewContext(compiled, sandbox, { filename: 'notifications.ts' });
const { sendNotification } = sandboxModule.exports;

function fakeResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => String(body), json: async () => body };
}
function assert(condition, message) { if (!condition) throw new Error(message); }

(async () => {
  const pushoverFailed = await sendNotification({
    userId: 'u1', title: 't', message: 'm', usePushover: true, pushoverUserKey: 'p1', logPrefix: 'test',
  });
  assert(pushoverFailed === false, 'a non-2xx Pushover response was treated as delivered');

  env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  const webPushAccepted = await sendNotification({
    userId: 'u1', title: 't', message: 'm', usePushover: false, pushoverUserKey: null, logPrefix: 'test',
  });
  assert(webPushAccepted === true, 'a subscription plus immediate web-push handoff was not accepted');

  sandbox.fetch = async (url) => {
    if (url.includes('/rest/v1/zane_push_subscriptions')) return fakeResponse(200, [{ id: 'sub-1' }]);
    if (url.includes('/functions/v1/web-push')) return fakeResponse(202, 'scheduled');
    throw new Error(`unexpected fetch: ${url}`);
  };
  const delayedHandoff = await sendNotification({
    userId: 'u1', title: 't', message: 'm', usePushover: false, pushoverUserKey: null, logPrefix: 'test',
  });
  assert(delayedHandoff === false, 'a delayed web-push schedule was treated as delivered');

  sandbox.fetch = async (url) => {
    if (url.includes('/rest/v1/zane_push_subscriptions')) return fakeResponse(200, []);
    throw new Error(`unexpected fetch: ${url}`);
  };
  const noSubscription = await sendNotification({
    userId: 'u1', title: 't', message: 'm', usePushover: false, pushoverUserKey: null, logPrefix: 'test',
  });
  assert(noSubscription === false, 'a missing web-push subscription was treated as delivered');

  // ttl was declared in NotificationArgs and forwarded to Pushover but never
  // to Web Push, which hardcoded 300 seconds, so a reminder meant to stay
  // deliverable for 12 hours expired in five minutes on that channel.
  let webPushBody = null;
  sandbox.fetch = async (url, init) => {
    if (url.includes('/rest/v1/zane_push_subscriptions')) return fakeResponse(200, [{ id: 'sub-1' }]);
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

  console.log('notification-delivery OK: provider failure, missing subscriptions and ttl forwarding all hold');
})().catch(error => { console.error(error); process.exit(1); });
