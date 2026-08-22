import { fetchWithTimeout } from '../_shared/fetch.ts';
import { sendNotification } from '../_shared/notifications.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
  }, 12_000);
}

type SweepResult = {
  action?: 'none' | 'closed' | 'deleted';
  session_id?: string;
  user_id?: string;
  is_tracked?: boolean;
  duration_minutes?: number | null;
  timeout_minutes?: number;
  push_enabled?: boolean;
  use_pushover?: boolean;
  pushover_user_key?: string | null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Cron-only shared secret. This target has no browser caller identity, so an
  // unset secret must fail closed as well as an incorrect one.
  const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const run = async () => {
    const now = new Date().toISOString();
    const sessionsRes = await dbFetch('zane_sessions?ended=is.null&select=id&order=id');
    if (!sessionsRes.ok) {
      console.error(`[auto-close] sessions query failed: ${sessionsRes.status} ${await sessionsRes.text().catch(() => '')}`);
      return { closed: 0, deleted: 0 };
    }
    const payload = await sessionsRes.json().catch(() => null);
    if (!Array.isArray(payload)) {
      console.error('[auto-close] sessions query returned an invalid body');
      return { closed: 0, deleted: 0 };
    }

    let closed = 0;
    let deleted = 0;
    for (const row of payload) {
      const sessionId = typeof row?.id === 'string' ? row.id : '';
      if (!sessionId) continue;

      let sweepRes: Response;
      try {
        sweepRes = await dbFetch('rpc/sweep_stale_session', {
          method: 'POST',
          body: JSON.stringify({ p_session_id: sessionId, p_now: now }),
        });
      } catch (error) {
        console.error(`[auto-close] sweep transport failed for session ${sessionId}:`, error);
        continue;
      }
      if (!sweepRes.ok) {
        console.error(`[auto-close] sweep failed for session ${sessionId}: ${sweepRes.status} ${await sweepRes.text().catch(() => '')}`);
        continue;
      }
      const result = await sweepRes.json().catch(() => null) as SweepResult | null;
      if (!result || typeof result !== 'object') {
        console.error(`[auto-close] sweep returned an invalid body for session ${sessionId}`);
        continue;
      }
      if (result.action === 'deleted') {
        deleted++;
        console.log(`[auto-close] deleted ${result.is_tracked ? 'butt-start' : 'empty untracked orphan'} session ${sessionId}`);
        continue;
      }
      if (result.action !== 'closed') continue;

      closed++;
      console.log(`[auto-close] closed ${result.is_tracked ? '' : 'untracked '}session ${sessionId} (${result.duration_minutes ?? 'unknown'} min)`);
      if (!result.is_tracked || !result.push_enabled || !result.user_id) continue;

      const message = result.duration_minutes != null
        ? `Session auto-ended after ${result.timeout_minutes ?? 90} min of inactivity (${result.duration_minutes} min total).`
        : `Session auto-ended after ${result.timeout_minutes ?? 90} min of inactivity.`;
      await sendNotification({
        userId: result.user_id,
        title: 'Zane · Session ended',
        message,
        usePushover: result.use_pushover,
        pushoverUserKey: result.pushover_user_key,
        logPrefix: 'auto-close',
      });
    }

    console.log(`[auto-close] done, closed: ${closed}, deleted: ${deleted}`);
    return { closed, deleted };
  };

  const result = await run().catch((error) => {
    console.error('[auto-close] fatal:', error);
    return { error: String(error) };
  });

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
