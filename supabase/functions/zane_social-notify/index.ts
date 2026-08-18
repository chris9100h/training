import { sendNotification } from '../_shared/notifications.ts';
import { socialAuthFailureStatus, socialNotificationStatus } from '../_shared/social-notification-result.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EVENT_KINDS = new Set(['message', 'friend_request', 'finished_workout_comment', 'friend_started']);
const DELIVERY_CHUNK_SIZE = 6;
const MAX_DELIVERIES_PER_INVOCATION = 24;
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

type UserResolution = { userId: string | null; status: number };

async function resolveUser(req: Request): Promise<UserResolution> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return { userId: null, status: 401 };
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const apiKey = Deno.env.get('SUPABASE_ANON_KEY') || serviceKey;
  if (!base || !apiKey) return { userId: null, status: socialAuthFailureStatus(null, false) };
  let result: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      result = await fetch(`${base}/auth/v1/user`, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, apikey: apiKey },
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (_) {
    return { userId: null, status: socialAuthFailureStatus(null) };
  }
  if (!result.ok) return { userId: null, status: socialAuthFailureStatus(result.status) };
  const user = await result.json().catch(() => null);
  return user?.id
    ? { userId: user.id, status: 200 }
    : { userId: null, status: socialAuthFailureStatus(null) };
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

type RecipientSettings = {
  user_id: string;
  push_enabled: boolean | null;
  pushover_user_key: string | null;
  use_pushover: boolean | null;
  social_push_messages: boolean | null;
  social_push_friend_requests: boolean | null;
  social_push_finished_comments: boolean | null;
  social_push_friend_started: boolean | null;
};

type DeliveryClaim = {
  recipient_id: string;
  claim_token: string | null;
  state: 'claimed' | 'delivered' | 'busy';
};

async function recipientSettingsBatch(userIds: string[]) {
  if (!userIds.length) return new Map<string, RecipientSettings>();
  const result = await rows<RecipientSettings>(
    `zane_user_settings?user_id=in.(${userIds.join(',')})&select=user_id,push_enabled,pushover_user_key,use_pushover,social_push_messages,social_push_friend_requests,social_push_finished_comments,social_push_friend_started`,
    'recipient settings',
  );
  return new Map(result.map(setting => [setting.user_id, setting]));
}

type PendingPush = {
  recipientId: string;
  title: string;
  message: string;
};

async function deliver(eventKind: string, push: PendingPush, settings: RecipientSettings | null) {
  if (!push.recipientId || !settings) return 'skipped';
  const preference = PREF_BY_EVENT[eventKind] as keyof RecipientSettings;
  if (!settings?.push_enabled || settings[preference] !== true) return 'skipped';

  const sent = await sendNotification({
    userId: push.recipientId,
    title: oneLine(push.title, 80),
    message: oneLine(push.message, 120),
    usePushover: settings.use_pushover as boolean | null | undefined,
    pushoverUserKey: settings.pushover_user_key as string | null | undefined,
    logPrefix: 'social-notify',
  });
  return sent ? 'sent' : 'retryable';
}

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
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
  const recipients = await dbRpc<{ recipient_id: string }[]>('social_notification_message_recipients', {
    p_message_id: messageId,
    p_caller_id: callerId,
  });
  if (message.recipient_id) {
    return recipients.map(row => ({ recipientId: row.recipient_id, title: `Zane · ${sender}`, message: text || 'New message' }));
  }
  if (!message.group_id) return [];
  const groupRows = await rows<{ name: string | null }>(
    `zane_social_groups?id=eq.${encodeURIComponent(message.group_id)}&select=name`,
    'group',
  );
  const groupName = oneLine(groupRows[0]?.name || 'Friends group', 60);
  return recipients.map(row => ({ recipientId: row.recipient_id, title: `Zane · ${groupName}`, message: text || 'New group message' }));
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

  const recipients = await dbRpc<{ recipient_id: string }[]>('social_notification_friend_started_recipients', {
    p_session_id: sessionId,
    p_caller_id: callerId,
  });
  return recipients.map(row => ({
    recipientId: row.recipient_id,
    title: 'Zane · Friend started a workout',
    message: 'A friend started a workout.',
  }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const caller = await resolveUser(req);
  if (!caller.userId) {
    return response(
      caller.status === 401 ? { error: 'unauthorized' } : { error: 'authentication unavailable', retry: true },
      caller.status,
    );
  }
  const callerId = caller.userId;

  const body = await req.json().catch(() => ({}));
  const event = String(body?.event || '');
  const id = String(body?.id || '');
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const sessionLike = /^[A-Za-z0-9_-]{1,200}$/;
  if (!EVENT_KINDS.has(event) || !id || id.length > 200 || (event === 'friend_started' ? !sessionLike.test(id) : !uuidLike.test(id))) return response({ error: 'invalid event' }, 400);

  try {
    if (!await dbRpc<boolean>('social_take_notification_rate_limit', { p_caller_id: callerId, p_cost: 1 })) {
      return response({ error: 'rate limited', retry: true }, 429);
    }
    const pending = event === 'message'
      ? await notifyMessage(callerId, id)
      : event === 'friend_request'
        ? await notifyFriendRequest(callerId, id)
        : event === 'finished_workout_comment'
          ? await notifyFinishedComment(callerId, id)
          : await notifyFriendStarted(callerId, id);

    const uniquePending = [...new Map(pending.map(push => [push.recipientId, push])).values()];
    const eventKey = `${event}:${id}`;
    const counts = {
      sent: 0,
      skipped: 0,
      duplicates: 0,
      retryable: 0,
    };
    if (uniquePending.length) {
      // Charge for every recipient examined, not only for newly claimed rows.
      // A replay of an already delivered large group event therefore cannot
      // scan the delivery ledger at the one-unit base rate.
      const workCost = Math.max(1, Math.ceil(uniquePending.length / 5));
      if (!await dbRpc<boolean>('social_take_notification_rate_limit', { p_caller_id: callerId, p_cost: workCost })) {
        return response({ ...counts, retryable: uniquePending.length, error: 'rate limited' }, 429);
      }
    }
    const pendingRecipients = uniquePending.length
      ? await dbRpc<{ recipient_id: string }[]>('social_pending_notification_recipients', {
          p_event_key: eventKey,
          p_recipient_ids: uniquePending.map(push => push.recipientId),
        })
      : [];
    const pendingRecipientIds = new Set(pendingRecipients.map(row => row.recipient_id));
    const deliveryPending = uniquePending.filter(push => pendingRecipientIds.has(push.recipientId));
    counts.duplicates += uniquePending.length - deliveryPending.length;
    let attempted = 0;
    for (let offset = 0; offset < deliveryPending.length; offset += DELIVERY_CHUNK_SIZE) {
      if (attempted >= MAX_DELIVERIES_PER_INVOCATION) {
        counts.retryable += deliveryPending.length - offset;
        break;
      }
      const batch = deliveryPending.slice(offset, offset + DELIVERY_CHUNK_SIZE);
      const claims = await dbRpc<DeliveryClaim[]>('social_claim_notification_deliveries', {
        p_event_key: eventKey,
        p_event_kind: event,
        p_recipient_ids: batch.map(push => push.recipientId),
      });
      const claimByRecipient = new Map(claims.map(claim => [claim.recipient_id, claim]));
      const claimed = batch.filter(push => claimByRecipient.get(push.recipientId)?.state === 'claimed');
      counts.duplicates += claims.filter(claim => claim.state === 'delivered').length;
      counts.retryable += claims.filter(claim => claim.state === 'busy').length
        + batch.filter(push => !claimByRecipient.has(push.recipientId)).length;
      if (!claimed.length) continue;

      const settings = await recipientSettingsBatch(claimed.map(push => push.recipientId));
      const results = await mapConcurrent(claimed, DELIVERY_CHUNK_SIZE, push => deliver(event, push, settings.get(push.recipientId) ?? null));
      const finishResults = claimed.map((push, index) => ({
        recipient_id: push.recipientId,
        claim_token: claimByRecipient.get(push.recipientId)!.claim_token,
        // Disabled/missing preferences are a terminal skip for this historical
        // event. Provider failures release only this exact claim for retry.
        delivered: results[index] !== 'retryable',
      }));
      const changed = await dbRpc<number>('social_finish_notification_deliveries', {
        p_event_key: eventKey,
        p_results: finishResults,
      });
      if (changed !== finishResults.length) throw new Error('delivery claim finalization mismatch');
      attempted += claimed.length;
      counts.sent += results.filter(result => result === 'sent').length;
      counts.skipped += results.filter(result => result === 'skipped').length;
      counts.retryable += results.filter(result => result === 'retryable').length;
    }
    // A provider handoff that failed and is worth retrying must not come back
    // as 200: the client outbox treats any ok as delivered and drops the row,
    // and no cron picks these up, so the push was simply lost. 503 is one of
    // the statuses flushSocialNotificationOutbox already keeps queued.
    // The delivery ledger is recipient-specific. Retrying a partial fanout is
    // therefore safe: successful recipients are returned as duplicates while
    // only the failed recipients get another provider attempt.
    return response(counts, socialNotificationStatus(counts));
  } catch (error) {
    console.error('[social-notify] failed:', error);
    if (error instanceof Error && error.message === 'session not ready') {
      return response({ retry: true }, 409);
    }
    return response({ error: 'notification lookup failed' }, 502);
  }
});
