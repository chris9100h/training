type NotificationArgs = {
  userId: string;
  title: string;
  message: string;
  usePushover: boolean | null | undefined;
  pushoverUserKey: string | null | undefined;
  logPrefix: string;
  ttl?: number;
};

async function fetchWithTimeout(input: string, options: RequestInit = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function dbFetch(path: string, options: RequestInit = {}) {
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return fetchWithTimeout(`${base}/rest/v1/${path}`, {
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
      const response = await fetchWithTimeout('https://api.pushover.net/1/messages.json', {
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
    // web-push already owns the subscription lookup and reports 503 when no
    // device accepted the message. Doing the same query here doubled every
    // recipient's DB work, especially painful for group fan-out.
    const response = await fetchWithTimeout(`${base}/functions/v1/web-push`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      // ttl was accepted in NotificationArgs and forwarded to Pushover, but
      // never to Web Push, which hardcoded 300 seconds. Reminders that ask for
      // hours were silently expiring in five minutes on that channel.
      body: JSON.stringify({ userId: args.userId, title: args.title, message: args.message, ...(args.ttl ? { ttl: args.ttl } : {}) }),
    }, 25_000);
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
