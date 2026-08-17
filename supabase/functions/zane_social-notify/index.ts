import { sendNotification } from '../_shared/notifications.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EVENT_KINDS = new Set(['message', 'friend_request', 'finished_workout_comment', 'friend_started']);
const PREF_BY_EVENT: Record<string, string> = {
  message: 'social_push_messages',
  friend_request: 'social_push_friend_requests',
  finished_workout_comment: 'social_push_finished_comments',
  friend_started: 'social_push_friend_started',
};

async function dbFetch(path: string, options: RequestInit = {}) {
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    return await fetch(`${base}/rest/v1/${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function dbRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const result = await dbFetch(`rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!result.ok) throw new Error(`${name} failed: ${result.status} ${await result.text().catch(() => '')}`);
  return await result.json() as T;
}

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function oneLine(value: unknown, max = 100) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function resolveUser(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const apiKey = Deno.env.get('SUPABASE_ANON_KEY') || serviceKey;
  if (!base || !apiKey) return null;
  const result = await fetch(`${base}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: apiKey },
  }).catch(() => null);
  if (!result?.ok) return null;
  const user = await result.json().catch(() => null);
  return user?.id ?? null;
}

async function rows<T>(path: string, label: string): Promise<T[]> {
  const result = await dbFetch(path);
  if (!result.ok) {
    throw new Error(`${label} query failed: ${result.status} ${await result.text().catch(() => '')}`);
  }
  const body = await result.json().catch(() => []);
  if (!Array.isArray(body)) throw new Error(`${label} query returned an invalid shape`);
  return body as T[];
}

async function profileName(userId: string) {
  const result = await rows<{ name: string | null }>(
    `zane_profiles?id=eq.${encodeURIComponent(userId)}&select=name`,
    'profile',
  );
  return oneLine(result[0]?.name || 'Zane athlete', 60);
}

async function recipientSettings(userId: string, preference: string) {
  const result = await rows<Record<string, unknown>>(
    `zane_user_settings?user_id=eq.${encodeURIComponent(userId)}&select=push_enabled,pushover_user_key,use_pushover,${preference}`,
    'recipient settings',
  );
  return result[0] ?? null;
}

// Returns false for an already delivered event or a concurrent retry that is
// still inside the short retry window. A failed provider handoff leaves the
// row retryable because delivered_at stays null.
async function claimDelivery(eventKey: string, recipientId: string, eventKind: string) {
  const existing = await rows<{ last_attempt_at: string | null; delivered_at: string | null }>(
    `zane_social_notification_deliveries?event_key=eq.${encodeURIComponent(eventKey)}&recipient_id=eq.${encodeURIComponent(recipientId)}&select=last_attempt_at,delivered_at`,
    'delivery ledger',
  );
  const previous = existing[0];
  const now = new Date();
  if (previous?.delivered_at) return false;
  if (previous?.last_attempt_at && now.getTime() - new Date(previous.last_attempt_at).getTime() < 30_000) return false;

  if (!previous) {
    // Ignore a duplicate insert and inspect the returned representation. Only
    // the request that actually inserted the row may hand the event to the
    // provider; this closes the no-row race between two concurrent retries.
    const result = await dbFetch('zane_social_notification_deliveries', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({
        event_key: eventKey,
        recipient_id: recipientId,
        event_kind: eventKind,
        last_attempt_at: now.toISOString(),
      }),
    });
    if (!result.ok) throw new Error(`delivery claim failed: ${result.status} ${await result.text().catch(() => '')}`);
    const inserted = await result.json().catch(() => []);
    return Array.isArray(inserted) && inserted.length > 0;
  }

  // A retry after the short backoff must win a compare-and-set update. Two
  // callers can read the same stale timestamp, but only the first PATCH still
  // matches it; the other one gets an empty representation and stays a
  // duplicate instead of sending a second push.
  const cutoff = new Date(now.getTime() - 30_000).toISOString();
  const attemptFilter = previous.last_attempt_at
    ? `last_attempt_at=lt.${encodeURIComponent(cutoff)}`
    : 'last_attempt_at=is.null';
  const result = await dbFetch(
    `zane_social_notification_deliveries?event_key=eq.${encodeURIComponent(eventKey)}&recipient_id=eq.${encodeURIComponent(recipientId)}&delivered_at=is.null&${attemptFilter}&select=event_key`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ last_attempt_at: now.toISOString() }),
    },
  );
  if (!result.ok) throw new Error(`delivery claim failed: ${result.status} ${await result.text().catch(() => '')}`);
  const claimed = await result.json().catch(() => []);
  return Array.isArray(claimed) && claimed.length > 0;
}

async function markDelivered(eventKey: string, recipientId: string) {
  const result = await dbFetch(
    `zane_social_notification_deliveries?event_key=eq.${encodeURIComponent(eventKey)}&recipient_id=eq.${encodeURIComponent(recipientId)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ delivered_at: new Date().toISOString() }),
    },
  );
  if (!result.ok) console.error(`[social-notify] delivery mark failed: ${result.status}`);
}

async function clearAttempt(eventKey: string, recipientId: string) {
  const result = await dbFetch(
    `zane_social_notification_deliveries?event_key=eq.${encodeURIComponent(eventKey)}&recipient_id=eq.${encodeURIComponent(recipientId)}&delivered_at=is.null`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ last_attempt_at: null }),
    },
  );
  if (!result.ok) console.error(`[social-notify] attempt reset failed: ${result.status}`);
}

type PendingPush = {
  recipientId: string;
  title: string;
  message: string;
};

async function deliver(eventKind: string, eventId: string, push: PendingPush) {
  if (!push.recipientId) return 'skipped';
  const preference = PREF_BY_EVENT[eventKind];
  const settings = await recipientSettings(push.recipientId, preference);
  if (!settings?.push_enabled || settings[preference] !== true) return 'skipped';

  const eventKey = `${eventKind}:${eventId}`;
  if (!await claimDelivery(eventKey, push.recipientId, eventKind)) return 'duplicate';

  const sent = await sendNotification({
    userId: push.recipientId,
    title: oneLine(push.title, 80),
    message: oneLine(push.message, 120),
    usePushover: settings.use_pushover as boolean | null | undefined,
    pushoverUserKey: settings.pushover_user_key as string | null | undefined,
    logPrefix: 'social-notify',
  });
  if (sent) await markDelivered(eventKey, push.recipientId);
  // Clear the attempt stamp on failure. claimDelivery refuses a second attempt
  // within 30 seconds, so without this the client's immediate retry would come
  // straight back as a duplicate and the push would be lost anyway, even now
  // that the status code keeps the row queued.
  else await clearAttempt(eventKey, push.recipientId);
  return sent ? 'sent' : 'retryable';
}

async function notifyMessage(callerId: string, messageId: string): Promise<PendingPush[]> {
  const messages = await rows<{ sender_id: string; recipient_id: string | null; group_id: string | null; body: string; created_at: string }>(
    `zane_social_messages?id=eq.${encodeURIComponent(messageId)}&select=sender_id,recipient_id,group_id,body,created_at&limit=1`,
    'message',
  );
  const message = messages[0];
  if (!message) return [];
  if (message.sender_id !== callerId) throw new Error('forbidden');
  const sender = await profileName(callerId);
  const text = oneLine(message.body);
  if (message.recipient_id && message.recipient_id !== callerId) {
    if (!await dbRpc<boolean>('social_can_notify_message', { p_message_id: messageId, p_recipient_id: message.recipient_id })) return [];
    return [{ recipientId: message.recipient_id, title: `Zane · ${sender}`, message: text || 'New message' }];
  }
  if (!message.group_id) return [];
  const members = await rows<{ user_id: string }>(
    `zane_social_group_members?group_id=eq.${encodeURIComponent(message.group_id)}&select=user_id&limit=200`,
    'group members',
  );
  const groupRows = await rows<{ name: string | null }>(
    `zane_social_groups?id=eq.${encodeURIComponent(message.group_id)}&select=name`,
    'group',
  );
  const groupName = oneLine(groupRows[0]?.name || 'Friends group', 60);
  const candidates = members
    .map(member => member.user_id)
    .filter(userId => userId && userId !== callerId)
    .slice(0, 50)
    ;
  const allowed = await Promise.all(candidates.map(async recipientId => (
    await dbRpc<boolean>('social_can_notify_message', { p_message_id: messageId, p_recipient_id: recipientId }) ? recipientId : null
  )));
  return allowed.filter((recipientId): recipientId is string => !!recipientId)
    .map(recipientId => ({ recipientId, title: `Zane · ${groupName}`, message: text || 'New group message' }));
}

async function notifyFriendRequest(callerId: string, friendshipId: string): Promise<PendingPush[]> {
  const friendships = await rows<{ requester_id: string; addressee_id: string; status: string }>(
    `zane_social_friendships?id=eq.${encodeURIComponent(friendshipId)}&select=requester_id,addressee_id,status`,
    'friendship',
  );
  const friendship = friendships[0];
  if (!friendship) return [];
  if (friendship.requester_id !== callerId) throw new Error('forbidden');
  if (friendship.status !== 'pending') return [];
  if (!await dbRpc<boolean>('social_can_notify_friend_request', { p_friendship_id: friendshipId, p_recipient_id: friendship.addressee_id })) return [];
  const sender = await profileName(callerId);
  return [{ recipientId: friendship.addressee_id, title: 'Zane · Friend request', message: `${sender} sent you a friend request.` }];
}

async function notifyFinishedComment(callerId: string, commentId: string): Promise<PendingPush[]> {
  const comments = await rows<{ author_id: string; session_id: string; kind: string; body: string; created_at: string }>(
    `zane_social_workout_comments?id=eq.${encodeURIComponent(commentId)}&select=author_id,session_id,kind,body,created_at&limit=1`,
    'workout comment',
  );
  const comment = comments[0];
  if (!comment) return [];
  if (comment.author_id !== callerId) throw new Error('forbidden');
  const sessions = await rows<{ user_id: string; started_at: string | null; ended: string | null; day_name: string | null }>(
    `zane_sessions?id=eq.${encodeURIComponent(comment.session_id)}&select=user_id,started_at,ended,day_name&limit=1`,
    'workout session',
  );
  const session = sessions[0];
  // The setting is intentionally for finished workouts only. A live comment
  // remains an in-app overlay/broadcast and is never turned into an OS push.
  if (!session?.ended || session.user_id === callerId) return [];
  if (!await dbRpc<boolean>('social_can_notify_finished_comment', { p_comment_id: commentId, p_recipient_id: session.user_id })) return [];
  const label = comment.kind === 'cheer' ? 'Cheer' : 'Comment';
  return [{ recipientId: session.user_id, title: `Zane · ${label} on your workout`, message: oneLine(comment.body) || 'New workout comment' }];
}

async function notifyFriendStarted(callerId: string, sessionId: string): Promise<PendingPush[]> {
  const sessions = await rows<{ user_id: string; started_at: string | null; ended: string | null }>(
    `zane_sessions?id=eq.${encodeURIComponent(sessionId)}&select=user_id,started_at,ended&limit=1`,
    'workout session',
  );
  const session = sessions[0];
  // The offline-aware client may call us a moment before its session write has
  // reached Postgres. A 409 tells the caller to retry without treating this as
  // a successful, silent skip.
  if (!session) throw new Error('session not ready');
  if (session.user_id !== callerId) throw new Error('forbidden');
  if (session.ended || !session.started_at) return [];

  const [outgoing, incoming] = await Promise.all([
    rows<{ addressee_id: string }>(
      `zane_social_friendships?requester_id=eq.${encodeURIComponent(callerId)}&status=eq.accepted&select=addressee_id&limit=200`,
      'outgoing friendships',
    ),
    rows<{ requester_id: string }>(
      `zane_social_friendships?addressee_id=eq.${encodeURIComponent(callerId)}&status=eq.accepted&select=requester_id&limit=200`,
      'incoming friendships',
    ),
  ]);
  const ids = [...new Set([
    ...outgoing.map(row => row.addressee_id),
    ...incoming.map(row => row.requester_id),
  ])].filter(userId => userId && userId !== callerId).slice(0, 50);
  const allowed = await Promise.all(ids.map(async recipientId => (
    await dbRpc<boolean>('social_can_notify_friend_started', { p_session_id: sessionId, p_recipient_id: recipientId }) ? recipientId : null
  )));
  return allowed.filter((recipientId): recipientId is string => !!recipientId).map(recipientId => ({
    recipientId,
    title: 'Zane · Friend started a workout',
    message: 'A friend started a workout.',
  }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const callerId = await resolveUser(req);
  if (!callerId) return response({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const event = String(body?.event || '');
  const id = String(body?.id || '');
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const sessionLike = /^[A-Za-z0-9_-]{1,200}$/;
  if (!EVENT_KINDS.has(event) || !id || id.length > 200 || (event === 'friend_started' ? !sessionLike.test(id) : !uuidLike.test(id))) return response({ error: 'invalid event' }, 400);

  try {
    if (!await dbRpc<boolean>('social_take_notification_rate_limit', { p_caller_id: callerId })) {
      return response({ error: 'rate limited', retry: true }, 429);
    }
    const pending = event === 'message'
      ? await notifyMessage(callerId, id)
      : event === 'friend_request'
        ? await notifyFriendRequest(callerId, id)
        : event === 'finished_workout_comment'
          ? await notifyFinishedComment(callerId, id)
          : await notifyFriendStarted(callerId, id);

    const results = await Promise.all(pending.map(push => deliver(event, id, push)));
    const counts = {
      sent: results.filter(result => result === 'sent').length,
      skipped: results.filter(result => result === 'skipped').length,
      duplicates: results.filter(result => result === 'duplicate').length,
      retryable: results.filter(result => result === 'retryable').length,
    };
    // A provider handoff that failed and is worth retrying must not come back
    // as 200: the client outbox treats any ok as delivered and drops the row,
    // and no cron picks these up, so the push was simply lost. 503 is one of
    // the statuses flushSocialNotificationOutbox already keeps queued. Only
    // when nothing at all got through, since a partial success has already
    // reached a device and re-sending would nudge twice.
    if (counts.retryable > 0 && counts.sent === 0) return response(counts, 503);
    return response(counts);
  } catch (error) {
    console.error('[social-notify] failed:', error);
    if (error instanceof Error && error.message === 'session not ready') {
      return response({ retry: true }, 409);
    }
    return response({ error: 'notification lookup failed' }, 502);
  }
});
