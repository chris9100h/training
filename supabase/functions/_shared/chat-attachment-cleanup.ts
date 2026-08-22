import { fetchWithTimeout } from './fetch.ts';
import { isMissingStorageObjectResponse } from './storage-cleanup.ts';

const BUCKET = 'chat-attachments';
const MAX_DRAIN = 100;

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

function objectUrl(path: string) {
  const encoded = path.split('/').map(segment => encodeURIComponent(segment)).join('/');
  return `${base()}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encoded}`;
}

async function removeObject(path: string): Promise<boolean> {
  const key = serviceKey();
  const response = await fetchWithTimeout(objectUrl(path), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  }, 10_000);
  const body = response.status === 400 ? await response.text().catch(() => '') : '';
  return response.ok || isMissingStorageObjectResponse(response.status, body);
}

export async function drainChatAttachmentCleanup() {
  const list = await dbFetch('rpc/claim_chat_attachment_cleanup', {
    method: 'POST',
    body: JSON.stringify({ p_limit: MAX_DRAIN }),
  });
  if (!list.ok) throw new Error(`cleanup queue read failed (${list.status})`);
  const rows = await list.json().catch(() => []);
  const paths = Array.isArray(rows)
    ? rows.map(row => {
      if (typeof row === 'string') return row;
      return typeof row?.path === 'string' ? row.path : '';
    }).filter(Boolean)
    : [];
  let removed = 0;
  let failed = 0;

  for (let offset = 0; offset < paths.length; offset += 5) {
    const batch = paths.slice(offset, offset + 5);
    const results = await Promise.all(batch.map(async path => {
      try {
        if (!await removeObject(path)) return false;
        const deleted = await dbFetch(
          `zane_chat_attachment_cleanup?path=eq.${encodeURIComponent(path)}`,
          { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
        );
        return deleted.ok;
      } catch (error) {
        console.error('[chat-attachment-cleanup] object cleanup failed', path, error);
        return false;
      }
    }));
    removed += results.filter(Boolean).length;
    failed += results.filter(result => !result).length;
  }
  return { examined: paths.length, removed, failed };
}
