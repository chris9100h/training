#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const vm = require('node:vm');

const required = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_TEST_COACH_EMAIL',
  'SUPABASE_TEST_CLIENT_EMAIL',
  'SUPABASE_TEST_OUTSIDER_EMAIL',
  'SUPABASE_TEST_PASSWORD',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}

vm.runInThisContext(fs.readFileSync('src/supabase.js', 'utf8'), {
  filename: 'src/supabase.js',
});

const events = [];
const channels = [];
const activeClients = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(label, promise, timeoutMs = 15000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
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

async function loginOrSignUp(client, email) {
  let result = await withTimeout(
    `Sign in ${email}`,
    client.auth.signInWithPassword({ email, password: process.env.SUPABASE_TEST_PASSWORD }),
  );
  if (result.error && (result.error.code === 'invalid_credentials' || /invalid login credentials/i.test(result.error.message))) {
    result = await withTimeout(
      `Sign up ${email}`,
      client.auth.signUp({ email, password: process.env.SUPABASE_TEST_PASSWORD }),
    );
  }
  if (result.error) throw new Error(`${email}: ${result.error.message}`);
  return {
    id: result.data.user?.id || null,
    session: result.data.session || null,
    email,
  };
}

function subscribe(client, topic, label, timeoutMs = 12000) {
  return new Promise(resolve => {
    let settled = false;
    const channel = client
      .channel(topic, { config: { private: true } })
      .on('broadcast', { event: 'coaching_invalidate' }, event => {
        const payload = event?.payload ?? {};
        events.push({
          label,
          topic,
          id: payload.id ?? null,
          resource: payload.resource ?? null,
          payloadKeys: Object.keys(payload).sort(),
        });
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
    coach: makeClient(),
    client: makeClient(),
    outsider: makeClient(),
  };
  activeClients.push(...Object.values(clients));
  console.log('STEP auth');
  const identities = await Promise.all([
    loginOrSignUp(clients.coach, process.env.SUPABASE_TEST_COACH_EMAIL),
    loginOrSignUp(clients.client, process.env.SUPABASE_TEST_CLIENT_EMAIL),
    loginOrSignUp(clients.outsider, process.env.SUPABASE_TEST_OUTSIDER_EMAIL),
  ]);
  const users = {
    coach: identities[0],
    client: identities[1],
    outsider: identities[2],
  };

  if (identities.some(identity => !identity.session)) {
    console.log(`CONFIRM_REQUIRED ${JSON.stringify(Object.values(users).map(({ id, email }) => ({ id, email })))}`);
    process.exitCode = 2;
    return;
  }
  for (const [role, identity] of Object.entries(users)) {
    clients[role].realtime.setAuth(identity.session.access_token);
  }

  console.log('STEP subscribe');
  const subscriptions = await Promise.all([
    subscribe(clients.coach, `coaching:user:${users.coach.id}`, 'coach-own'),
    subscribe(clients.client, `coaching:user:${users.client.id}`, 'client-own'),
    subscribe(clients.outsider, `coaching:user:${users.outsider.id}`, 'outsider-own'),
    subscribe(clients.coach, `coaching:user:${users.client.id}`, 'coach-foreign'),
  ]);

  console.log(`STEP subscriptions ${JSON.stringify(subscriptions.map(({ label, status }) => ({ label, status })))}`);
  const { data: coachingId, error: inviteError } = await withTimeout(
    'Invite client',
    clients.coach.rpc('invite_client', { p_email: users.client.email }),
  );
  if (inviteError) throw inviteError;
  if (!coachingId || String(coachingId).startsWith('ERROR:')) throw new Error(String(coachingId || 'Invite failed'));
  console.log('STEP accept invitation');
  await withTimeout(
    'Accept invitation',
    clients.client.rpc('respond_to_coaching_invite', { p_coaching_id: coachingId, p_accept: true }),
  ).then(({ error }) => {
    if (error) throw error;
  });

  const noteId = `broadcast_note_${Date.now()}`;
  console.log('STEP note');
  const { error: noteError } = await withTimeout('Insert coaching note', clients.client.from('zane_coaching_notes').insert({
    id: noteId,
    coaching_id: coachingId,
    author_id: users.client.id,
    type: 'general',
    body: 'Synthetic Coaching Broadcast test',
  }));
  if (noteError) throw noteError;

  console.log('STEP status');
  const { error: statusError } = await withTimeout('Update client status', clients.client.from('zane_user_settings').update({
    status_mode: 'deload',
    status_mode_since: new Date().toISOString(),
  }).eq('user_id', users.client.id));
  if (statusError) throw statusError;

  const checkinId = `broadcast_checkin_${Date.now()}`;
  console.log('STEP check-in');
  const { error: checkinError } = await withTimeout('Insert check-in', clients.client.from('zane_checkins').insert({
    id: checkinId,
    coaching_id: coachingId,
    client_id: users.client.id,
    week_start: new Date().toISOString().slice(0, 10),
  }));
  if (checkinError) throw checkinError;

  console.log('STEP support');
  const { data: supportId, error: supportError } = await withTimeout(
    'Open support chat',
    clients.client.rpc('open_support_chat', { p_category: 'question' }),
  );
  if (supportError) throw supportError;
  const { error: supportNoteError } = await withTimeout('Insert support note', clients.client.from('zane_coaching_notes').insert({
    id: `broadcast_support_${Date.now()}`,
    coaching_id: supportId,
    author_id: users.client.id,
    type: 'general',
    body: 'Synthetic Support Broadcast test',
  }));
  if (supportNoteError) throw supportNoteError;

  await sleep(2500);

  const ownStatuses = subscriptions.filter(item => item.label.endsWith('-own')).map(item => item.status);
  const foreignStatus = subscriptions.find(item => item.label === 'coach-foreign')?.status;
  const invalidPayloads = events.filter(event => (
    event.payloadKeys.length !== 2
    || event.payloadKeys[0] !== 'id'
    || event.payloadKeys[1] !== 'resource'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.id || '')
    || !['relationships', 'notes', 'support', 'status'].includes(event.resource)
  ));
  const coachResources = resourcesFor('coach-own');
  const clientResources = resourcesFor('client-own');
  const outsiderResources = resourcesFor('outsider-own');
  const missingCoach = ['relationships', 'notes', 'support', 'status'].filter(resource => !coachResources.has(resource));
  const missingClient = ['relationships', 'notes', 'support'].filter(resource => !clientResources.has(resource));
  let rollback = null;

  if (process.env.SUPABASE_TEST_ROLLBACK === '1') {
    console.log('STEP rollback legacy');
    const { error: legacyError } = await withTimeout(
      'Switch coaching transport to legacy',
      clients.coach.rpc('admin_set_coaching_transport', { p_transport: 'legacy' }),
    );
    if (legacyError) throw legacyError;
    const { data: legacyConfig, error: legacyConfigError } = await withTimeout(
      'Read legacy runtime config',
      clients.coach.rpc('get_runtime_config'),
    );
    if (legacyConfigError) throw legacyConfigError;

    console.log('STEP rollback broadcast');
    const { error: broadcastError } = await withTimeout(
      'Switch coaching transport to broadcast',
      clients.coach.rpc('admin_set_coaching_transport', { p_transport: 'broadcast' }),
    );
    if (broadcastError) throw broadcastError;
    const { data: broadcastConfig, error: broadcastConfigError } = await withTimeout(
      'Read broadcast runtime config',
      clients.coach.rpc('get_runtime_config'),
    );
    if (broadcastConfigError) throw broadcastConfigError;
    rollback = {
      legacy: legacyConfig?.coachingTransport ?? null,
      broadcast: broadcastConfig?.coachingTransport ?? null,
    };
  }

  console.log(`FINAL ${JSON.stringify({
    users: Object.fromEntries(Object.entries(users).map(([role, { id, email }]) => [role, { id, email }])),
    subscriptions: subscriptions.map(({ label, topic, status, error }) => ({ label, topic, status, error })),
    resources: {
      coach: [...coachResources].sort(),
      client: [...clientResources].sort(),
      outsider: [...outsiderResources].sort(),
    },
    events: events.length,
    invalidPayloads,
    missingCoach,
    missingClient,
    rollback,
  })}`);

  const failed = ownStatuses.some(status => status !== 'SUBSCRIBED')
    || foreignStatus === 'SUBSCRIBED'
    || invalidPayloads.length > 0
    || missingCoach.length > 0
    || missingClient.length > 0
    || outsiderResources.size > 0
    || (rollback && (rollback.legacy !== 'legacy' || rollback.broadcast !== 'broadcast'));

  await clients.client.from('zane_user_settings').update({ status_mode: null, status_mode_since: null }).eq('user_id', users.client.id);
  await clients.client.from('zane_coaching').delete().eq('id', supportId);
  await clients.coach.from('zane_coaching').delete().eq('id', coachingId);
  for (const client of Object.values(clients)) client.realtime.disconnect();
  process.exitCode = failed ? 1 : 0;
}

main().catch(error => {
  console.error(error?.message || String(error));
  for (const client of activeClients) client.realtime.disconnect();
  process.exitCode = 1;
});
