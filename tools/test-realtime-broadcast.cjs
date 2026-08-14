#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const vm = require('node:vm');

const required = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_TEST_ADMIN_EMAIL',
  'SUPABASE_TEST_PEER_EMAIL',
  'SUPABASE_TEST_OUTSIDER_EMAIL',
  'SUPABASE_TEST_PASSWORD',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}

vm.runInThisContext(fs.readFileSync('src/supabase.js', 'utf8'), {
  filename: 'src/supabase.js',
});

const userIds = {
  admin: '11111111-1111-4111-8111-111111111111',
  peer: '22222222-2222-4222-8222-222222222222',
  outsider: '33333333-3333-4333-8333-333333333333',
};
const waitSeconds = Math.max(20, Number(process.argv[2] || 60));
const expectNoEvents = process.env.SUPABASE_EXPECT_NO_EVENTS === 'true';
const events = [];
const channels = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeClient() {
  return supabase.createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

async function login(client, email, expectedUserId) {
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: process.env.SUPABASE_TEST_PASSWORD,
  });
  if (error) throw error;
  if (data.user?.id !== expectedUserId || !data.session?.access_token) {
    throw new Error(`Unexpected login identity for ${email}`);
  }
  client.realtime.setAuth(data.session.access_token);
}

function subscribe(client, topic, label, timeoutMs = 12000) {
  return new Promise(resolve => {
    let settled = false;
    const channel = client
      .channel(topic, { config: { private: true } })
      .on('broadcast', { event: 'social_invalidate' }, event => {
        const payload = event?.payload ?? {};
        const record = {
          label,
          topic,
          id: payload.id ?? null,
          resource: payload.resource ?? null,
          payloadKeys: Object.keys(payload).sort(),
        };
        events.push(record);
        console.log(`EVENT ${JSON.stringify(record)}`);
      })
      .subscribe((status, error) => {
        if (settled || status === 'CLOSED') return;
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          settled = true;
          resolve({ label, topic, status, error: error?.message || null, channel });
        }
      });
    channels.push({ client, channel });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ label, topic, status: 'TEST_TIMEOUT', error: null, channel });
    }, timeoutMs);
  });
}

function resourcesFor(label) {
  return new Set(events.filter(event => event.label === label).map(event => event.resource));
}

async function main() {
  const clients = {
    admin: makeClient(),
    peer: makeClient(),
    outsider: makeClient(),
  };

  await Promise.all([
    login(clients.admin, process.env.SUPABASE_TEST_ADMIN_EMAIL, userIds.admin),
    login(clients.peer, process.env.SUPABASE_TEST_PEER_EMAIL, userIds.peer),
    login(clients.outsider, process.env.SUPABASE_TEST_OUTSIDER_EMAIL, userIds.outsider),
  ]);

  const subscriptions = await Promise.all([
    subscribe(clients.admin, `social:user:${userIds.admin}`, 'admin-own'),
    subscribe(clients.peer, `social:user:${userIds.peer}`, 'peer-own'),
    subscribe(clients.outsider, `social:user:${userIds.outsider}`, 'outsider-own'),
    subscribe(clients.admin, `social:user:${userIds.peer}`, 'admin-foreign'),
  ]);

  const { error: grantError } = await clients.admin.rpc('admin_set_social_broadcast_canary', {
    p_email: process.env.SUPABASE_TEST_PEER_EMAIL,
    p_enabled: true,
  });
  if (grantError) throw grantError;
  const { data: runtimeConfig, error: runtimeError } = await clients.peer.rpc('get_runtime_config');
  if (runtimeError) throw runtimeError;

  console.log(`READY ${JSON.stringify({
    waitSeconds,
    expectNoEvents,
    subscriptions: subscriptions.map(({ label, topic, status, error }) => ({ label, topic, status, error })),
    peerRuntimeConfig: runtimeConfig,
  })}`);

  await sleep(waitSeconds * 1000);

  const ownStatuses = subscriptions
    .filter(item => item.label.endsWith('-own'))
    .map(item => item.status);
  const foreignStatus = subscriptions.find(item => item.label === 'admin-foreign')?.status;
  const invalidPayloads = events.filter(event => (
    event.payloadKeys.length !== 2
    || event.payloadKeys[0] !== 'id'
    || event.payloadKeys[1] !== 'resource'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.id || '')
    || typeof event.resource !== 'string'
  ));
  const requiredForAdminAndPeer = ['dashboard', 'groups', 'messages', 'shares', 'feed'];
  const adminResources = resourcesFor('admin-own');
  const peerResources = resourcesFor('peer-own');
  const outsiderResources = resourcesFor('outsider-own');
  const missingAdmin = requiredForAdminAndPeer.filter(resource => !adminResources.has(resource));
  const missingPeer = requiredForAdminAndPeer.filter(resource => !peerResources.has(resource));

  const { error: cleanupGrantError } = await clients.admin.rpc('admin_set_social_broadcast_canary', {
    p_email: process.env.SUPABASE_TEST_PEER_EMAIL,
    p_enabled: false,
  });

  const summary = {
    subscriptions: subscriptions.map(({ label, topic, status, error }) => ({ label, topic, status, error })),
    events: events.length,
    resources: {
      admin: [...adminResources].sort(),
      peer: [...peerResources].sort(),
      outsider: [...outsiderResources].sort(),
    },
    invalidPayloads,
    missingAdmin,
    missingPeer,
    cleanupGrantError: cleanupGrantError?.message || null,
  };
  console.log(`FINAL ${JSON.stringify(summary)}`);

  const failed = ownStatuses.some(status => status !== 'SUBSCRIBED')
    || foreignStatus === 'SUBSCRIBED'
    || (expectNoEvents ? events.length !== 0 : events.length === 0)
    || invalidPayloads.length > 0
    || (!expectNoEvents && missingAdmin.length > 0)
    || (!expectNoEvents && missingPeer.length > 0)
    || cleanupGrantError;
  for (const client of Object.values(clients)) client.realtime.disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(error => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
