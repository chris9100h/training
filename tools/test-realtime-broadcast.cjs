#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

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

// Auth users in a real branch receive random UUIDs. Keep the IDs dynamic so
// this harness exercises the actual accounts instead of an impossible fixture.
const userIds = {};
const waitSeconds = Math.max(20, Number(process.argv[2] || 60));
const expectNoEvents = process.env.SUPABASE_EXPECT_NO_EVENTS === 'true';
const triggerSocialMatrix = process.env.SUPABASE_TRIGGER_SOCIAL === '1';
const events = [];
const channels = [];
const activeClients = [];

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

async function login(client, email) {
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: process.env.SUPABASE_TEST_PASSWORD,
  });
  if (error) throw error;
  if (!data.user?.id || !data.session?.access_token) {
    throw new Error(`Unexpected login identity for ${email}`);
  }
  client.realtime.setAuth(data.session.access_token);
  return data.user.id;
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

async function expectOk(label, promise) {
  let timer;
  const result = await Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after 15000 ms`)), 15000);
    }),
  ]).finally(() => clearTimeout(timer));
  if (result?.error) throw new Error(`${label}: ${result.error.message || result.error}`);
  return result?.data;
}

async function triggerSyntheticSocialMatrix(clients, ids) {
  console.log('STEP trigger social matrix');
  const friendshipId = await expectOk(
    'Create friendship request',
    clients.admin.rpc('social_send_friend_request', { p_target_id: ids.peer }),
  );
  await expectOk(
    'Accept friendship request',
    clients.peer.rpc('social_respond_friend_request', { p_friendship_id: friendshipId, p_accept: true }),
  );

  for (const [label, client] of [['admin', clients.admin], ['peer', clients.peer]]) {
    await expectOk(
      `Enable workout visibility for ${label}`,
      client.rpc('social_update_profile', {
        p_handle: null,
        p_steps_visible: false,
        p_workouts_visible: true,
        p_adherence_visible: false,
      }),
    );
  }

  const groupId = await expectOk(
    'Create group',
    clients.admin.rpc('social_create_group', { p_name: `Broadcast test ${Date.now()}` }),
  );
  const groupRow = await expectOk(
    'Read group join code',
    clients.admin.from('zane_social_groups').select('join_code').eq('id', groupId).single(),
  );
  await expectOk('Join group', clients.peer.rpc('social_join_group', { p_join_code: groupRow.join_code }));

  const messageId = randomUUID();
  await expectOk('Insert direct message', clients.admin.from('zane_social_messages').insert({
    id: messageId,
    sender_id: ids.admin,
    recipient_id: ids.peer,
    body: 'Synthetic Broadcast matrix message',
  }));

  const shareId = await expectOk(
    'Create plan share',
    clients.admin.rpc('social_create_plan_share', {
      p_recipient_id: ids.peer,
      p_plan_name: 'Broadcast matrix plan',
      p_snapshot: { synthetic: true, createdAt: new Date().toISOString() },
    }),
  );

  const sessionId = `broadcast_matrix_${Date.now()}`;
  const commentId = randomUUID();
  await expectOk('Insert synthetic session', clients.admin.from('zane_sessions').insert({
    id: sessionId,
    user_id: ids.admin,
    date: new Date().toISOString(),
    started_at: new Date().toISOString(),
    ended: new Date().toISOString(),
    entries: [],
  }));
  const comment = await expectOk(
    'Insert workout comment',
    clients.admin.rpc('social_add_workout_comment', {
      p_session_id: sessionId,
      p_body: 'Synthetic Broadcast matrix feed event',
      p_kind: 'comment',
    }),
  );

  return { friendshipId, groupId, messageId, shareId, sessionId, commentId: comment?.id || commentId };
}

async function cleanupSyntheticSocialMatrix(clients, ids, synthetic) {
  if (!synthetic) return;
  try { await clients.admin.rpc('social_delete_plan_share', { p_share_id: synthetic.shareId }); } catch (_) {}
  try { await clients.admin.rpc('social_delete_group', { p_group_id: synthetic.groupId }); } catch (_) {}
  try { await clients.admin.from('zane_social_messages').delete().eq('id', synthetic.messageId); } catch (_) {}
  try { await clients.admin.rpc('social_remove_friend', { p_target_id: ids.peer }); } catch (_) {}
  await clients.admin.from('zane_sessions').delete().eq('id', synthetic.sessionId);
  for (const client of [clients.admin, clients.peer]) {
    try {
      await client.rpc('social_update_profile', {
        p_handle: null,
        p_steps_visible: false,
        p_workouts_visible: false,
        p_adherence_visible: false,
      });
    } catch (_) {}
  }
}

async function main() {
  const clients = {
    admin: makeClient(),
    peer: makeClient(),
    outsider: makeClient(),
  };
  activeClients.push(...Object.values(clients));

  const [adminId, peerId, outsiderId] = await Promise.all([
    login(clients.admin, process.env.SUPABASE_TEST_ADMIN_EMAIL),
    login(clients.peer, process.env.SUPABASE_TEST_PEER_EMAIL),
    login(clients.outsider, process.env.SUPABASE_TEST_OUTSIDER_EMAIL),
  ]);
  Object.assign(userIds, { admin: adminId, peer: peerId, outsider: outsiderId });

  const subscriptions = await Promise.all([
    subscribe(clients.admin, `social:user:${userIds.admin}`, 'admin-own'),
    subscribe(clients.peer, `social:user:${userIds.peer}`, 'peer-own'),
    subscribe(clients.outsider, `social:user:${userIds.outsider}`, 'outsider-own'),
    subscribe(clients.admin, `social:user:${userIds.peer}`, 'admin-foreign'),
  ]);

  // Production canary toggles are office-admin-only. Preview branches can
  // run the matrix against the global Broadcast transport directly.
  const useCanary = process.env.SUPABASE_SKIP_CANARY !== '1';
  if (useCanary) {
    const { error: grantError } = await clients.admin.rpc('admin_set_social_broadcast_canary', {
      p_email: process.env.SUPABASE_TEST_PEER_EMAIL,
      p_enabled: true,
    });
    if (grantError) throw grantError;
  }
  const { data: runtimeConfig, error: runtimeError } = await clients.peer.rpc('get_runtime_config');
  if (runtimeError) throw runtimeError;

  console.log(`READY ${JSON.stringify({
    waitSeconds,
    expectNoEvents,
    subscriptions: subscriptions.map(({ label, topic, status, error }) => ({ label, topic, status, error })),
    peerRuntimeConfig: runtimeConfig,
  })}`);

  let synthetic = null;
  if (triggerSocialMatrix) synthetic = await triggerSyntheticSocialMatrix(clients, userIds);

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

  const { error: cleanupGrantError } = useCanary
    ? await clients.admin.rpc('admin_set_social_broadcast_canary', {
      p_email: process.env.SUPABASE_TEST_PEER_EMAIL,
      p_enabled: false,
    })
    : { error: null };

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

  await cleanupSyntheticSocialMatrix(clients, userIds, synthetic);

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
  for (const client of activeClients) client.realtime.disconnect();
  process.exitCode = 1;
});
