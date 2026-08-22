import { corsHeaders, jsonResponse, preflight, resolveUser } from '../_shared/edge.ts';
import { drainChatAttachmentCleanup } from '../_shared/chat-attachment-cleanup.ts';
import { fetchWithTimeout } from '../_shared/fetch.ts';

function base() { return Deno.env.get('SUPABASE_URL') ?? ''; }
function serviceKey() { return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''; }

function dbFetch(path: string, options: RequestInit = {}) {
  const key = serviceKey();
  return fetchWithTimeout(`${base()}/rest/v1/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  }, 12_000);
}

function scalarPaths(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(path => typeof path === 'string');
  if (value && typeof value === 'object') {
    const nested = (value as Record<string, unknown>).delete_coaching_chat_scope;
    return Array.isArray(nested) ? nested.filter(path => typeof path === 'string') : [];
  }
  return [];
}

Deno.serve(async req => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405);

  const caller = await resolveUser(req);
  if (!caller) return jsonResponse({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');
  const scope = action === 'delete-thread'
    ? 'thread'
    : action === 'delete-note' ? 'note'
    : action === 'delete-support-ticket' ? 'support-ticket' : '';
  const scopeId = scope === 'thread'
    ? String(body.threadId || '')
    : scope === 'note' ? String(body.noteId || '') : String(body.coachingId || '');
  if (!scope || !scopeId || scopeId.length > 200) {
    return jsonResponse({ error: 'invalid cleanup request' }, 400);
  }

  const response = await dbFetch('rpc/delete_coaching_chat_scope', {
    method: 'POST',
    body: JSON.stringify({ p_caller_id: caller.id, p_scope: scope, p_scope_id: scopeId }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const forbidden = /not allowed|admin access required/i.test(detail);
    console.error('[coaching-chat-cleanup] scope delete failed', response.status, detail);
    return jsonResponse({ error: forbidden ? 'forbidden' : 'chat cleanup failed' }, forbidden ? 403 : 502);
  }
  const queued = scalarPaths(await response.json().catch(() => []));

  try {
    const cleanup = await drainChatAttachmentCleanup();
    return jsonResponse({
      ok: true,
      queued: queued.length,
      cleanup,
      cleanupPending: cleanup.failed > 0,
    }, cleanup.failed > 0 ? 202 : 200);
  } catch (error) {
    // The database deletion already committed. Tombstones make this safe to
    // retry through the same idempotent action without losing object paths.
    console.error('[coaching-chat-cleanup] queue drain failed', error);
    return jsonResponse({ ok: true, queued: queued.length, cleanupPending: true }, 200);
  }
});
