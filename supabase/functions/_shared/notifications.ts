type NotificationArgs = {
  userId: string;
  title: string;
  message: string;
  usePushover: boolean | null | undefined;
  pushoverUserKey: string | null | undefined;
  logPrefix: string;
  ttl?: number;
};

function dbFetch(path: string, options: RequestInit = {}) {
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
}

// "true" means the provider accepted the handoff. Web Push itself can only
// promise that the web-push function accepted the request, not that a phone
// displayed it later. A missing subscription or a non-2xx provider response is
// still a failure and callers must keep their reminder state retryable.
export async function sendNotification(args: NotificationArgs): Promise<boolean> {
  const viaPushover = !!args.usePushover && !!args.pushoverUserKey;
  if (viaPushover) {
    const token = Deno.env.get('PUSHOVER_TOKEN') ?? '';
    if (!token) {
      console.error(`[${args.logPrefix}] PUSHOVER_TOKEN is not configured`);
      return false;
    }
    try {
      const response = await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          user: args.pushoverUserKey,
          title: args.title,
          message: args.message,
          priority: 0,
          ttl: args.ttl ?? 10800,
        }),
      });
      if (!response.ok) {
        console.error(`[${args.logPrefix}] pushover failed for ${args.userId}: ${response.status} ${await response.text().catch(() => '')}`);
        return false;
      }
      console.log(`[${args.logPrefix}] pushover accepted for ${args.userId}: ${response.status}`);
      return true;
    } catch (error) {
      console.error(`[${args.logPrefix}] pushover error for ${args.userId}:`, error);
      return false;
    }
  }

  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!base || !key) {
    console.error(`[${args.logPrefix}] Supabase service credentials are missing`);
    return false;
  }
  try {
    const subscriptionsResponse = await dbFetch(`zane_push_subscriptions?user_id=eq.${args.userId}&select=id`);
    if (!subscriptionsResponse.ok) {
      console.error(`[${args.logPrefix}] subscription lookup failed for ${args.userId}: ${subscriptionsResponse.status}`);
      return false;
    }
    const subscriptions: { id: string }[] = await subscriptionsResponse.json().catch(() => []);
    if (!subscriptions.length) {
      console.error(`[${args.logPrefix}] no web-push subscription for ${args.userId}`);
      return false;
    }
    const response = await fetch(`${base}/functions/v1/web-push`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: args.userId, title: args.title, message: args.message }),
    });
    // zane_social-notify uses the immediate path, which now waits for the
    // provider result and returns 200 only when at least one subscription was
    // accepted. A 202 is reserved for delayed reminder scheduling and must
    // stay retryable for this delivery ledger.
    if (response.status !== 200) {
      console.error(`[${args.logPrefix}] web-push handoff failed for ${args.userId}: ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[${args.logPrefix}] web-push error for ${args.userId}:`, error);
    return false;
  }
}
