/* Google Drive/Sheets archive for coaching check-ins.
 *
 * The browser never sees a Google refresh token.  This function owns the OAuth
 * exchange, encrypts the token before it reaches the service-only table, and
 * processes a small database outbox.  A Drive/API failure changes export
 * status only; the check-in row has already been committed independently.
 */

import { isMissingStorageObjectResponse } from '../_shared/storage-cleanup.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const DRIVE_FILE = 'application/vnd.google-apps.folder';
const SHEET_FILE = 'application/vnd.google-apps.spreadsheet';
const BUCKET = 'coaching-drive-staging';
const PROGRESS_BUCKET = 'drive-progress-staging';
const MAX_PHOTOS = 8;

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: url } });
}

function base() { return Deno.env.get('SUPABASE_URL') ?? ''; }
function serviceKey() { return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''; }
function appOrigin() { return Deno.env.get('APP_ORIGIN') || 'https://zane-wo.com'; }

async function timedFetch(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

const GOOGLE_RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function wait(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

function retryAfterMs(res: Response, attempt: number) {
  const raw = res.headers.get('retry-after');
  const seconds = raw == null ? NaN : Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(5000, seconds * 1000);
  return Math.min(4000, 350 * (2 ** attempt));
}

// Google occasionally returns a short-lived 429/5xx during Drive/Sheets
// maintenance. A bounded retry avoids turning that into a needless outbox
// retry, while 401/403 remain immediately visible to the worker for re-auth or
// a durable error state. The same wrapper is used for OAuth and provider calls.
async function googleFetch(url: string, options: RequestInit = {}, timeoutMs = 20000): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await timedFetch(url, options, timeoutMs);
      if (!GOOGLE_RETRY_STATUS.has(res.status) || attempt === 2) return res;
      try { res.body?.cancel(); } catch (_) { /* best effort */ }
      await wait(retryAfterMs(res, attempt));
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
      await wait(Math.min(4000, 350 * (2 ** attempt)));
    }
  }
  throw lastError || new Error('Google request failed');
}

function db(path: string, options: RequestInit = {}) {
  const key = serviceKey();
  return timedFetch(`${base()}/rest/v1/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
}

async function resolveUser(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const res = await timedFetch(`${base()}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: anon } }, 5000).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null))?.id ?? null;
}

// Drive belongs to the coach side of the coaching workspace. A user may set
// that workspace up before accepting a single client (show_coaching_tab), or
// may reach it through an active external/self-coaching relationship. Keep the
// same gate on the server as in Settings; hiding the button alone would leave
// the OAuth endpoint callable by every authenticated client.
async function canUseCoachDrive(userId: string) {
  const [settingsRes, coachRes] = await Promise.all([
    db(`zane_user_settings?user_id=eq.${encodeURIComponent(userId)}&select=show_coaching_tab,be_your_own_coach&limit=1`),
    db(`zane_coaching?coach_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=id,client_id&limit=1`),
  ]);
  if (!settingsRes.ok || !coachRes.ok) throw new Error('coaching role lookup failed');
  const settings = (await settingsRes.json().catch(() => []))[0] || {};
  const relationships = await coachRes.json().catch(() => []);
  return Boolean(settings.show_coaching_tab || settings.be_your_own_coach || (Array.isArray(relationships) && relationships[0]?.id));
}

function randomBytes(size: number) { const b = new Uint8Array(size); crypto.getRandomValues(b); return b; }
function b64(bytes: Uint8Array) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function unb64(value: string) { const s = atob(value); return Uint8Array.from(s, c => c.charCodeAt(0)); }

async function cryptoKey() {
  const secret = Deno.env.get('GOOGLE_TOKEN_ENCRYPTION_KEY') ?? '';
  if (secret.length < 32) throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY is not configured');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function seal(value: string) {
  const iv = randomBytes(12); const key = await cryptoKey();
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
  return { ciphertext: b64(new Uint8Array(data)), iv: b64(iv) };
}

async function open(ciphertext: string, ivText: string) {
  const key = await cryptoKey();
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivText) }, key, unb64(ciphertext));
  return new TextDecoder().decode(data);
}

function googleClient() {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
  const redirectUri = Deno.env.get('GOOGLE_REDIRECT_URI') ?? '';
  if (!clientId || !clientSecret || !redirectUri) throw new Error('Google Drive OAuth is not configured');
  return { clientId, clientSecret, redirectUri };
}

async function googleToken(params: Record<string, string>) {
  const res = await googleFetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  }, 12000);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(`Google OAuth failed (${res.status})`);
    (error as any).status = res.status;
    (error as any).googleAuthCode = body?.error || null;
    throw error;
  }
  return body;
}

async function accessToken(connectionId: string) {
  const tokenRes = await db(`zane_coaching_drive_tokens?connection_id=eq.${encodeURIComponent(connectionId)}&select=refresh_token_ciphertext,refresh_token_iv,key_version`);
  if (!tokenRes.ok) throw new Error('Drive token lookup failed');
  const rows = await tokenRes.json().catch(() => []);
  if (!rows[0]) throw new Error('Drive connection has no token');
  const refresh = await open(rows[0].refresh_token_ciphertext, rows[0].refresh_token_iv);
  const { clientId, clientSecret } = googleClient();
  const body = await googleToken({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' });
  if (!body.access_token) throw new Error('Google returned no access token');
  if (body.refresh_token) {
    const sealed = await seal(body.refresh_token);
    const rotateRes = await db(`zane_coaching_drive_tokens?connection_id=eq.${encodeURIComponent(connectionId)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ refresh_token_ciphertext: sealed.ciphertext, refresh_token_iv: sealed.iv, key_version: 1, updated_at: new Date().toISOString() }),
    });
    if (!rotateRes.ok) throw new Error(`Drive token rotation failed (${rotateRes.status})`);
  }
  return body.access_token as string;
}

async function drive(path: string, access: string, options: RequestInit = {}) {
  const res = await googleFetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...options, headers: { Authorization: `Bearer ${access}`, ...(options.headers ?? {}) },
  }, 20000);
  if (!res.ok) {
    const err = new Error(`Google Drive ${res.status}`); (err as any).status = res.status;
    throw err;
  }
  return res;
}

async function sheets(path: string, access: string, options: RequestInit = {}) {
  const res = await googleFetch(`https://sheets.googleapis.com/v4/${path}`, {
    ...options, headers: { Authorization: `Bearer ${access}`, ...(options.headers ?? {}) },
  }, 20000);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const compact = detail.replace(/\s+/g, ' ').trim().slice(0, 800);
    const err = new Error(`Google Sheets ${res.status}${compact ? `: ${compact}` : ''}`); (err as any).status = res.status;
    throw err;
  }
  return res;
}

function q(value: string) {
  // Google Drive query literals require both backslashes and apostrophes to be
  // escaped. Check-in IDs are client-created text, so neither is safe to pass
  // through unchanged.
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

async function findFile(access: string, name: string, mimeType: string, parent: string | null) {
  const clauses = [`name = ${q(name)}`, `mimeType = ${q(mimeType)}`, 'trashed = false'];
  if (parent) clauses.push(`${q(parent)} in parents`);
  const params = new URLSearchParams({ q: clauses.join(' and '), spaces: 'drive', fields: 'files(id,name)', pageSize: '1' });
  const body = await (await drive(`files?${params}`, access)).json();
  return body.files?.[0] ?? null;
}

async function findFileByProperty(access: string, key: string, value: string, mimeType: string, parent: string | null) {
  const clauses = [`appProperties has { key = ${q(key)} and value = ${q(value)} }`, `mimeType = ${q(mimeType)}`, 'trashed = false'];
  if (parent) clauses.push(`${q(parent)} in parents`);
  const params = new URLSearchParams({ q: clauses.join(' and '), spaces: 'drive', fields: 'files(id,name,appProperties)', pageSize: '1' });
  const body = await (await drive(`files?${params}`, access)).json();
  return body.files?.[0] ?? null;
}

type DriveIdentity = { key: string; value: string };

async function ensureFolder(access: string, name: string, parent: string | null, identity: DriveIdentity | null = null) {
  const found = identity
    ? await findFileByProperty(access, identity.key, identity.value, DRIVE_FILE, parent)
    : await findFile(access, name, DRIVE_FILE, parent);
  if (found) return found.id as string;
  const body: Record<string, unknown> = { name, mimeType: DRIVE_FILE };
  if (parent) body.parents = [parent];
  if (identity) body.appProperties = { [identity.key]: identity.value };
  const res = await drive('files', access, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return (await res.json()).id as string;
}

async function ensureSheet(access: string, name: string, parent: string, identity: DriveIdentity | null = null) {
  const found = identity
    ? await findFileByProperty(access, identity.key, identity.value, SHEET_FILE, parent)
    : await findFile(access, name, SHEET_FILE, parent);
  if (found) return found.id as string;
  const body: Record<string, unknown> = { name, mimeType: SHEET_FILE, parents: [parent] };
  if (identity) body.appProperties = { [identity.key]: identity.value };
  const res = await drive('files', access, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return (await res.json()).id as string;
}

function flattenResponses(responses: Record<string, unknown>, checkin: any, schema: any[] = []) {
  const rows: string[][] = [
    ['ZANE COACHING CHECK-IN', ''],
    ['Client', String(checkin.client_name || checkin.client_id)],
    ['Week starting', String(checkin.week_start)],
    ['Submitted', String(checkin.checked_in_at || '')],
    ['', ''],
    ['Question', 'Answer'],
  ];
  const seen = new Set<string>();
  const fields = schema.flatMap(section => section?.fields || []);
  for (const field of fields) {
    const key = field.key; const value = responses?.[key];
    if (value == null || value === '') continue;
    seen.add(key);
    const printable = typeof value === 'object' ? JSON.stringify(value) : String(value);
    rows.push([String(field.label || key), printable]);
  }
  for (const [key, value] of Object.entries(responses || {})) {
    if (value == null || value === '') continue;
    if (seen.has(key)) continue;
    const printable = typeof value === 'object' ? JSON.stringify(value) : String(value);
    rows.push([key.replaceAll('_', ' '), printable]);
  }
  return rows;
}

async function firstSheetTitle(access: string, spreadsheetId: string) {
  const params = new URLSearchParams({ fields: 'sheets(properties(title))' });
  const res = await sheets(`spreadsheets/${encodeURIComponent(spreadsheetId)}?${params}`, access);
  const body = await res.json().catch(() => null);
  const title = body?.sheets?.[0]?.properties?.title;
  if (!title || typeof title !== 'string') throw new Error('Google Sheets has no writable sheet');
  return title;
}

function sheetRange(title: string, range: string) {
  // Quoting the title also handles a coach renaming the default tab to a name
  // containing spaces, apostrophes, or punctuation.
  return `'${String(title).replaceAll("'", "''")}'!${range}`;
}

async function replaceSheet(access: string, spreadsheetId: string, rows: string[][]) {
  // Use the actual first tab title. A1 ranges must use a complete column range
  // (`A:ZZZ`); the mixed `A1:ZZZ` form is rejected by Sheets with HTTP 400.
  const title = await firstSheetTitle(access, spreadsheetId);
  const clearRange = encodeURIComponent(sheetRange(title, 'A:ZZZ'));
  await sheets(`spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${clearRange}:clear`, access, { method: 'POST' });
  const end = String.fromCharCode(65 + Math.min(25, Math.max(1, rows.reduce((m, r) => Math.max(m, r.length), 1)) - 1)) + rows.length;
  const range = sheetRange(title, `A1:${end}`);
  const encoded = encodeURIComponent(range);
  await sheets(`spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encoded}?valueInputOption=RAW`, access, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ range, majorDimension: 'ROWS', values: rows }),
  });
}

async function appendOverview(access: string, spreadsheetId: string, rows: string[][]) {
  const title = await firstSheetTitle(access, spreadsheetId);
  const clearRange = encodeURIComponent(sheetRange(title, 'A:ZZZ'));
  await sheets(`spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${clearRange}:clear`, access, { method: 'POST' });
  const end = String.fromCharCode(65 + rows[0].length - 1) + rows.length;
  const range = sheetRange(title, `A1:${end}`);
  await sheets(`spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, access, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ range, majorDimension: 'ROWS', values: rows }),
  });
}

function storageObjectUrl(path: string, bucket = BUCKET) {
  // The metadata path is validated by the database trigger. Encoding every
  // segment here is still necessary defence in depth: service-role requests
  // must never allow URL normalisation to turn a client value into `../...`.
  const encoded = String(path).split('/').map(segment => encodeURIComponent(segment)).join('/');
  return `${base()}/storage/v1/object/${encodeURIComponent(bucket)}/${encoded}`;
}

async function deleteStagingObject(path: string, tolerateMissing = true, timeoutMs = 10000) {
  const res = await timedFetch(storageObjectUrl(path), {
    method: 'DELETE', headers: { Authorization: `Bearer ${serviceKey()}`, apikey: serviceKey() },
  }, timeoutMs);
  const body = res.status === 400 ? await res.text().catch(() => '') : '';
  if (res.ok || (tolerateMissing && isMissingStorageObjectResponse(res.status, body))) return;
  const error = new Error(`staging photo delete ${res.status}`); (error as any).status = res.status;
  throw error;
}

function progressStorageObjectUrl(path: string) { return storageObjectUrl(path, PROGRESS_BUCKET); }

async function deleteProgressStagingObject(path: string, tolerateMissing = true, timeoutMs = 10000) {
  const res = await timedFetch(progressStorageObjectUrl(path), {
    method: 'DELETE', headers: { Authorization: `Bearer ${serviceKey()}`, apikey: serviceKey() },
  }, timeoutMs);
  const body = res.status === 400 ? await res.text().catch(() => '') : '';
  if (res.ok || (tolerateMissing && isMissingStorageObjectResponse(res.status, body))) return;
  const error = new Error(`progress staging photo delete ${res.status}`); (error as any).status = res.status;
  throw error;
}

async function clearProgressStagingPath(id: string) {
  const res = await db(`zane_drive_progress_photos?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ staging_path: null, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`progress staging metadata cleanup ${res.status}`);
}

async function findDrivePhoto(access: string, folderId: string, photoId: string) {
  const params = new URLSearchParams({
    q: `appProperties has { key = 'zanePhotoId' and value = '${String(photoId).replaceAll("'", "\\'")}' } and trashed = false and ${q(folderId)} in parents`,
    spaces: 'drive', fields: 'files(id,name,webViewLink)', pageSize: '1',
  });
  const body = await (await drive(`files?${params}`, access)).json();
  return body.files?.[0] ?? null;
}

async function uploadDrivePhoto(access: string, folderId: string, photo: any) {
  // A worker can crash after Google accepted the upload but before the DB
  // status update. appProperties makes the retry find that exact file instead
  // of creating a duplicate photo in the coach's folder.
  const existing = await findDrivePhoto(access, folderId, photo.id);
  if (existing) return existing;
  const objectRes = await timedFetch(storageObjectUrl(photo.staging_path), { headers: { Authorization: `Bearer ${serviceKey()}`, apikey: serviceKey() } }, 20000);
  if (!objectRes.ok) { const error = new Error(`staging photo ${objectRes.status}`); (error as any).status = objectRes.status; throw error; }
  const blob = await objectRes.blob();
  const meta = { name: photo.file_name, mimeType: photo.mime_type, parents: [folderId], appProperties: { zanePhotoId: String(photo.id) } };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', blob, photo.file_name);
  const res = await googleFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', { method: 'POST', headers: { Authorization: `Bearer ${access}` }, body: form }, 30000);
  if (!res.ok) { const e = new Error(`Google photo upload ${res.status}`); (e as any).status = res.status; throw e; }
  return await res.json();
}

async function uploadProgressDrivePhoto(access: string, folderId: string, photo: any) {
  let fileId = photo.drive_file_id || null;
  if (!fileId) {
    const params = new URLSearchParams({ q: `appProperties has { key = 'zaneProgressPhotoId' and value = '${String(photo.id).replaceAll("'", "\\'")}' } and trashed = false and ${q(folderId)} in parents`, spaces: 'drive', fields: 'files(id,name,mimeType)', pageSize: '1' });
    const existingBody = await (await drive(`files?${params}`, access)).json().catch(() => ({}));
    const existing = existingBody?.files?.[0] || null;
    fileId = existing?.id || null;
  }
  // A worker may have uploaded to Drive and crashed before the DB acknowledgement.
  // In that case the staging object may already be gone, so resolve the
  // idempotent Drive file before trying to read Storage. A failed replacement
  // may also have kept the old Drive file while its new staging object was
  // cleaned up; keeping that old image visible is safer than retrying missing
  // bytes forever.
  if (fileId && !photo.staging_path) return { id: fileId };
  const objectRes = await timedFetch(progressStorageObjectUrl(photo.staging_path), {
    headers: { Authorization: `Bearer ${serviceKey()}`, apikey: serviceKey() },
  }, 20000);
  if (!objectRes.ok) {
    // Older workers deleted the staging object before acknowledging the DB.
    // Preserve the already-existing Drive file rather than creating a failed
    // retry loop; all new uploads use the safer finish-then-delete order below.
    if (fileId && objectRes.status === 404) return { id: fileId };
    const error = new Error(`progress staging photo ${objectRes.status}`); (error as any).status = objectRes.status; throw error;
  }
  const blob = await objectRes.blob();
  const ext = photo.mime_type === 'image/png' ? 'png' : photo.mime_type === 'image/webp' ? 'webp' : 'jpg';
  const driveName = `${String(photo.photo_date).slice(0, 10)} Progress Picture.${ext}`;
  if (fileId) {
    const upload = await googleFetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,mimeType`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${access}`, 'Content-Type': photo.mime_type }, body: blob,
    }, 30000);
    if (!upload.ok) { const e = new Error(`Google progress photo update ${upload.status}`); (e as any).status = upload.status; throw e; }
    const meta = await drive(`files/${encodeURIComponent(fileId)}?fields=id,name,mimeType`, access, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: driveName }),
    });
    return await meta.json();
  }
  const meta = { name: driveName, mimeType: photo.mime_type, parents: [folderId], appProperties: { zaneProgressPhotoId: String(photo.id), zaneProgressDate: String(photo.photo_date) } };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', blob, driveName);
  const res = await googleFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType', { method: 'POST', headers: { Authorization: `Bearer ${access}` }, body: form }, 30000);
  if (!res.ok) { const e = new Error(`Google progress photo upload ${res.status}`); (e as any).status = res.status; throw e; }
  return await res.json();
}

async function progressFolders(access: string, connection: any, year: string) {
  const root = await ensureFolder(access, 'ZANE', null, { key: 'zanePersonalRoot', value: '1' });
  const progress = await ensureFolder(access, 'Progress Pictures', root, { key: 'zaneProgressRoot', value: '1' });
  const yearFolder = await ensureFolder(access, year, progress, { key: 'zaneProgressYear', value: year });
  if (connection.progress_folder_id !== yearFolder) await updateConnection(connection.id, { progress_folder_id: yearFolder });
  return yearFolder;
}

async function listProgressPhotosForUser(userId: string, limit = 50, offset = 0, photoDate: string | null = null) {
  const dateFilter = photoDate && /^\d{4}-\d{2}-\d{2}$/.test(photoDate)
    ? `&photo_date=eq.${encodeURIComponent(photoDate)}` : '';
  const res = await db(`zane_drive_progress_photos?user_id=eq.${encodeURIComponent(userId)}&status=in.(uploaded,failed)&drive_file_id=not.is.null${dateFilter}&select=id,user_id,photo_date,drive_file_id,file_name,mime_type,byte_size,status,uploaded_at,updated_at&order=photo_date.desc&limit=${Math.min(51, Math.max(1, limit))}&offset=${Math.max(0, offset)}`);
  if (!res.ok) throw new Error('progress picture lookup failed');
  return await res.json().catch(() => []);
}

async function runProgressSync(worker: string) {
  const claim = await db('rpc/claim_drive_progress_uploads', { method: 'POST', body: JSON.stringify({ p_limit: 5, p_worker: worker }) });
  if (!claim.ok) throw new Error('progress photo claim failed');
  const rows = await claim.json().catch(() => []);
  let uploaded = 0, failed = 0;
  const accesses = new Map<string, string>(); const connections = new Map<string, any>();
  for (const photo of Array.isArray(rows) ? rows : []) {
    try {
      const connectionRes = await db(`zane_coaching_drive_connections?id=eq.${encodeURIComponent(photo.connection_id)}&status=eq.connected&select=*`);
      if (!connectionRes.ok) throw new Error('progress Drive connection lookup failed');
      const connection = (await connectionRes.json().catch(() => []))[0];
      if (!connection) throw new Error('Drive connection is not active');
      connections.set(connection.id, connection);
      let access = accesses.get(connection.id);
      if (!access) { access = await accessToken(connection.id); accesses.set(connection.id, access); }
      const folder = await progressFolders(access, connection, String(photo.photo_date).slice(0, 4));
      const result = await uploadProgressDrivePhoto(access, folder, photo);
      const finish = await db('rpc/finish_drive_progress_upload', { method: 'POST', body: JSON.stringify({ p_photo_id: photo.id, p_worker: worker, p_status: 'uploaded', p_drive_file_id: result.id }) });
      if (!finish.ok) throw new Error('progress photo finish failed');
      const finishBody = await finish.json().catch(() => null);
      const finishAcknowledged = finishBody === true
        || (Array.isArray(finishBody) && (finishBody[0] === true || finishBody[0]?.finish_drive_progress_upload === true))
        || finishBody?.finish_drive_progress_upload === true;
      if (!finishAcknowledged) throw new Error('progress photo finish was not acknowledged');
      // The DB row is now durable.  A failed cleanup is harmless and can be
      // retried by the bounded janitor without replaying the Drive upload.
      try {
        await deleteProgressStagingObject(photo.staging_path, true, 5000);
        await clearProgressStagingPath(photo.id);
      } catch (error) { console.error('[coaching-drive] progress staging cleanup', photo.id, error); }
      uploaded++;
    } catch (error) {
      const status = (error as any)?.status;
      const needs = status === 401 || status === 403 || (status === 400 && (error as any)?.googleAuthCode === 'invalid_grant');
      const retryAt = new Date(Date.now() + (needs ? 60 : Math.min(60, 2 ** Math.min(5, Number(photo.attempts || 1))) * 60) * 1000).toISOString();
      await db('rpc/finish_drive_progress_upload', { method: 'POST', body: JSON.stringify({ p_photo_id: photo.id, p_worker: worker, p_status: 'failed', p_error: String((error as any)?.message || 'Progress photo upload failed').slice(0, 500), p_next_attempt_at: retryAt }) }).catch(() => {});
      if (needs && photo.connection_id) await updateConnection(photo.connection_id, { status: 'needs_reauth', last_error: 'Google authorization expired while uploading a progress picture' }).catch(() => {});
      failed++;
    }
  }
  const deleteClaim = await db('rpc/claim_drive_progress_deletions', { method: 'POST', body: JSON.stringify({ p_limit: 5, p_worker: worker }) });
  if (deleteClaim.ok) {
    const deleted = await deleteClaim.json().catch(() => []);
    for (const photo of Array.isArray(deleted) ? deleted : []) {
      try {
        if (photo.drive_file_id && photo.connection_id) {
          const connection = connections.get(photo.connection_id) || (await (await db(`zane_coaching_drive_connections?id=eq.${encodeURIComponent(photo.connection_id)}&select=*`)).json().catch(() => []))[0];
          if (connection) {
            const access = accesses.get(connection.id) || await accessToken(connection.id);
            if (access) {
              try { await drive(`files/${encodeURIComponent(photo.drive_file_id)}`, access, { method: 'DELETE' }); }
              catch (error) { if ((error as any)?.status !== 404) throw error; }
            }
          }
        }
        if (photo.staging_path) await deleteProgressStagingObject(photo.staging_path, true, 5000);
        await db('rpc/finish_drive_progress_deletion', { method: 'POST', body: JSON.stringify({ p_photo_id: photo.id, p_worker: worker, p_success: true }) });
      } catch (error) {
        await db('rpc/finish_drive_progress_deletion', { method: 'POST', body: JSON.stringify({ p_photo_id: photo.id, p_worker: worker, p_success: false, p_error: String((error as any)?.message || 'Progress photo deletion failed').slice(0, 500) }) }).catch(() => {});
      }
    }
  }
  return { claimed: Array.isArray(rows) ? rows.length : 0, uploaded, failed };
}

async function updateConnection(id: string, values: Record<string, unknown>) {
  const res = await db(`zane_coaching_drive_connections?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ...values, updated_at: new Date().toISOString() }) });
  if (!res.ok) throw new Error(`Drive connection update failed (${res.status})`);
}

async function listCoachExports(coachId: string) {
  const rows: any[] = [];
  const pageSize = 500;
  for (let offset = 0; offset < 10000; offset += pageSize) {
    const res = await db(`zane_coaching_drive_exports?coach_id=eq.${encodeURIComponent(coachId)}&select=checkin_id,client_id,week_start,status,spreadsheet_id,photo_count,checkin:zane_checkins(responses)&order=week_start.desc&limit=${pageSize}&offset=${offset}`);
    if (!res.ok) throw new Error(`Drive overview lookup failed (${res.status})`);
    const page = await res.json().catch(() => null);
    if (!Array.isArray(page)) throw new Error('Drive overview returned invalid data');
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function listProfileNames(ids: string[]) {
  const names = new Map<string, string>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100);
    const res = await db(`zane_profiles?id=in.(${chunk.map(id => encodeURIComponent(id)).join(',')})&select=id,name`);
    if (!res.ok) throw new Error(`Drive profile lookup failed (${res.status})`);
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows)) throw new Error('Drive profile lookup returned invalid data');
    rows.forEach(row => names.set(row.id, row.name || row.id));
  }
  return names;
}

async function syncExport(exp: any, connection: any, access: string) {
  const checkRes = await db(`zane_checkins?id=eq.${encodeURIComponent(exp.checkin_id)}&coaching_id=eq.${encodeURIComponent(exp.coaching_id)}&client_id=eq.${encodeURIComponent(exp.client_id)}&select=id,client_id,coaching_id,week_start,checked_in_at,responses`);
  if (!checkRes.ok) throw new Error('check-in lookup failed');
  const checkin = (await checkRes.json().catch(() => []))[0];
  if (!checkin) { const error = new Error('check-in relationship no longer exists'); (error as any).permanent = true; throw error; }
  const relationRes = await db(`zane_coaching?id=eq.${encodeURIComponent(exp.coaching_id)}&coach_id=eq.${encodeURIComponent(exp.coach_id)}&client_id=eq.${encodeURIComponent(exp.client_id)}&status=eq.active&select=id`);
  if (!relationRes.ok) throw new Error('coaching relationship lookup failed');
  if (!((await relationRes.json().catch(() => []))[0])) { const error = new Error('coaching relationship is no longer active'); (error as any).permanent = true; throw error; }
  const profileRes = await db(`zane_profiles?id=eq.${encodeURIComponent(exp.client_id)}&select=name`);
  if (!profileRes.ok) throw new Error('client profile lookup failed');
  const profile = (await profileRes.json().catch(() => []))[0] || {};
  checkin.client_name = profile.name || exp.client_id;
  const schemaRes = await db(`zane_coaching?id=eq.${encodeURIComponent(exp.coaching_id)}&select=checkin_schema`);
  if (!schemaRes.ok) throw new Error('check-in schema lookup failed');
  const schema = (await schemaRes.json().catch(() => []))[0]?.checkin_schema || [];
  const root = connection.root_folder_id || await ensureFolder(access, 'ZANE Coaching', null);
  connection.root_folder_id = root;
  const clients = await ensureFolder(access, 'Clients', root);
  // Names are presentation only.  Stable Drive appProperties prevent two
  // clients named the same (or two check-ins in one week) from sharing and
  // overwriting one another's files; profile renames also keep history intact.
  const clientFolder = exp.client_folder_id || await ensureFolder(access, String(checkin.client_name || exp.client_id), clients, { key: 'zaneClientId', value: String(exp.client_id) });
  const sheet = exp.spreadsheet_id || await ensureSheet(access, `Check-in ${checkin.week_start}`, clientFolder, { key: 'zaneCheckinId', value: String(exp.checkin_id) });
  const photosRes = await db(`zane_coaching_drive_photos?checkin_id=eq.${encodeURIComponent(exp.checkin_id)}&status=in.(staged,uploaded)&select=*`);
  if (!photosRes.ok) throw new Error('check-in photo lookup failed');
  const photos = (await photosRes.json().catch(() => null));
  if (!Array.isArray(photos)) throw new Error('check-in photo lookup returned invalid data');
  photos.splice(MAX_PHOTOS);
  const photoRows: string[][] = [['Photos', 'Drive link']];
  let retryablePhotoFailure = false;
  let photoNeedsReauth = false;
  if (connection.include_photos) {
    for (const photo of photos) {
      try {
        const uploaded = photo.status === 'uploaded' && photo.drive_file_id
          ? { id: photo.drive_file_id, webViewLink: `https://drive.google.com/open?id=${photo.drive_file_id}` }
          : await uploadDrivePhoto(access, clientFolder, photo);
        if (photo.status !== 'uploaded' || !photo.drive_file_id) {
          // Delete first. If the DB patch fails after this point, the next run
          // finds the Drive file by appProperties and safely completes the row.
          await deleteStagingObject(photo.staging_path);
          const patchRes = await db(`zane_coaching_drive_photos?id=eq.${encodeURIComponent(photo.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'uploaded', drive_file_id: uploaded.id, uploaded_at: new Date().toISOString(), last_error: null }) });
          if (!patchRes.ok) throw new Error(`photo metadata update failed (${patchRes.status})`);
        } else {
          try { await deleteStagingObject(photo.staging_path); } catch (_) { /* janitor retries old uploaded rows */ }
        }
        photoRows.push([photo.file_name, uploaded.webViewLink || `https://drive.google.com/open?id=${uploaded.id}`]);
      } catch (error) {
        const status = (error as any)?.status;
        const transient = status == null || GOOGLE_RETRY_STATUS.has(status) || status === 401 || status === 403;
        if (transient) {
          retryablePhotoFailure = true;
          if (status === 401 || status === 403) photoNeedsReauth = true;
          await db(`zane_coaching_drive_photos?id=eq.${encodeURIComponent(photo.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_error: String((error as any)?.message || 'Photo export failed').slice(0, 500) }) });
        } else {
          // A terminal provider/storage 4xx must not strand the private
          // staging object. Keep the row retryable until the delete succeeds;
          // the janitor can then finish the cleanup if this request dies.
          let removed = false;
          try { await deleteStagingObject(photo.staging_path); removed = true; } catch (_) { /* keep staged for janitor */ }
          const failRes = await db(`zane_coaching_drive_photos?id=eq.${encodeURIComponent(photo.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(removed
            ? { status: 'failed', staging_cleaned_at: new Date().toISOString(), last_error: String((error as any)?.message || 'Photo export failed').slice(0, 500) }
            : { status: 'staged', last_error: `Photo cleanup pending: ${String((error as any)?.message || 'Photo export failed').slice(0, 440)}` }) });
          if (!failRes.ok) retryablePhotoFailure = true;
          if (!removed) retryablePhotoFailure = true;
        }
      }
    }
  } else {
    // The client may have staged a photo before the coach changed the setting.
    // Do not leave private staging bytes behind indefinitely; the coach's
    // explicit opt-out is a terminal, non-retryable decision for those files.
    for (const photo of photos) {
      if (photo.status !== 'staged') continue;
      await deleteStagingObject(photo.staging_path);
      const patchRes = await db(`zane_coaching_drive_photos?id=eq.${encodeURIComponent(photo.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed', last_error: 'Photo archiving is disabled by the coach' }) });
      if (!patchRes.ok) throw new Error(`photo opt-out update failed (${patchRes.status})`);
    }
  }
  await replaceSheet(access, sheet, [...flattenResponses(checkin.responses || {}, checkin, schema), ['', ''], ...photoRows]);
  if (photoNeedsReauth) {
    const error = new Error('Google authorization is required to export photos');
    (error as any).status = 401;
    (error as any).googleAuthCode = 'invalid_grant';
    throw error;
  }
  if (retryablePhotoFailure) throw new Error('one or more photos need another Drive export attempt');
  return { spreadsheetId: sheet, clientFolderId: clientFolder, photoCount: photoRows.length - 1 };
}

async function syncOverview(coachId: string, connection: any, access: string, overrides: Map<string, any>) {
  const hadRoot = Boolean(connection.root_folder_id);
  const hadOverview = Boolean(connection.overview_spreadsheet_id);
  const root = connection.root_folder_id || await ensureFolder(access, 'ZANE Coaching', null);
  connection.root_folder_id = root;
  const overviewId = connection.overview_spreadsheet_id || await ensureSheet(access, 'Check-in Overview', root, { key: 'zaneOverviewCoachId', value: String(coachId) });
  connection.overview_spreadsheet_id = overviewId;
  const all = await listCoachExports(coachId);
  const clientIds = [...new Set(all.map(row => row.client_id).filter(Boolean))];
  const names = await listProfileNames(clientIds);
  const overview: string[][] = [['Client', 'Week starting', 'Status', 'Weight', 'Days trained', 'Steps', 'Cardio minutes', 'Macro adherence', 'Detail sheet', 'Photos']];
  for (const row of all) {
    const values = row.checkin?.responses || {};
    const override = overrides.get(String(row.checkin_id));
    const status = override?.status || row.status;
    const spreadsheetId = override?.spreadsheetId || row.spreadsheet_id;
    const photoCount = override?.photoCount ?? row.photo_count ?? 0;
    overview.push([
      names.get(row.client_id) || row.client_id,
      row.week_start,
      status,
      String(values.weight_today ?? values.weight_avg_last_week ?? ''), String(values.days_trained ?? ''),
      String(values.steps ?? ''), String(values.cardio_minutes ?? ''), String(values.macro_adherence ?? ''),
      spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}` : '',
      String(photoCount),
    ]);
  }
  await appendOverview(access, overviewId, overview);
  if (!hadRoot || !hadOverview) {
    await updateConnection(connection.id, { root_folder_id: root, overview_spreadsheet_id: overviewId });
  }
}

async function startOAuth(userId: string) {
  const { clientId, redirectUri } = googleClient();
  const oldStateRes = await db(`zane_coaching_drive_oauth_states?coach_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' });
  if (!oldStateRes.ok) throw new Error('could not rotate OAuth state');
  const state = b64(randomBytes(32)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const stateRes = await db('zane_coaching_drive_oauth_states', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ state, coach_id: userId, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }) });
  if (!stateRes.ok) throw new Error('could not create OAuth state');
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'openid email https://www.googleapis.com/auth/drive.file', state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function resetExportIds(coachId: string, status = 'pending') {
  const res = await db(`zane_coaching_drive_exports?coach_id=eq.${encodeURIComponent(coachId)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ spreadsheet_id: null, drive_file_id: null, client_folder_id: null, status, next_attempt_at: new Date().toISOString(), last_error: null, locked_at: null, locked_by: null, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Drive export reset failed (${res.status})`);
}

async function requeueReauthExports(coachId: string) {
  const res = await db(`zane_coaching_drive_exports?coach_id=eq.${encodeURIComponent(coachId)}&status=eq.needs_reauth`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'pending', next_attempt_at: new Date().toISOString(), last_error: null, locked_at: null, locked_by: null, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Drive reauth export recovery failed (${res.status})`);
}

async function queueBackfill(coachId: string) {
  for (let offset = 0; offset < 10000; offset += 100) {
    const coachingRes = await db(`zane_coaching?coach_id=eq.${encodeURIComponent(coachId)}&status=eq.active&select=id,client_id&order=id&limit=100&offset=${offset}`);
    if (!coachingRes.ok) throw new Error('coaching backfill lookup failed');
    const relationshipRows = await coachingRes.json().catch(() => null);
    if (!Array.isArray(relationshipRows)) throw new Error('coaching backfill returned invalid data');
    const relationships = relationshipRows.filter(relation => !String(relation?.id || '').startsWith('support_'));
    const rows: any[] = [];
    for (const relation of relationships) {
      const checksRes = await db(`zane_checkins?coaching_id=eq.${encodeURIComponent(relation.id)}&select=id,week_start&order=week_start.desc&limit=12`);
      if (!checksRes.ok) throw new Error('check-in backfill lookup failed');
      const checks = await checksRes.json().catch(() => null);
      if (!Array.isArray(checks)) throw new Error('check-in backfill returned invalid data');
      checks.forEach(checkin => rows.push({ coach_id: coachId, client_id: relation.client_id, coaching_id: relation.id, checkin_id: checkin.id, week_start: checkin.week_start, status: 'pending', next_attempt_at: new Date().toISOString(), last_error: null, locked_at: null, locked_by: null }));
    }
    for (let i = 0; i < rows.length; i += 200) {
      const res = await db('zane_coaching_drive_exports?on_conflict=coach_id,checkin_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows.slice(i, i + 200)) });
      if (!res.ok) throw new Error('check-in backfill enqueue failed');
    }
    if (relationships.length < 100) break;
  }
}

async function callback(req: Request) {
  const url = new URL(req.url); const state = url.searchParams.get('state') || ''; const code = url.searchParams.get('code');
  if (url.searchParams.get('error')) return redirect(`${appOrigin()}?coachingDrive=cancelled`);
  if (!state || !code) return redirect(`${appOrigin()}?coachingDrive=error`);
  const stateRes = await db(`zane_coaching_drive_oauth_states?state=eq.${encodeURIComponent(state)}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=state,coach_id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ consumed_at: new Date().toISOString() }) });
  if (!stateRes.ok) return redirect(`${appOrigin()}?coachingDrive=expired`);
  const stateRow = (await stateRes.json().catch(() => []))[0];
  if (!stateRow) return redirect(`${appOrigin()}?coachingDrive=expired`);
  const coachingEligible = await canUseCoachDrive(stateRow.coach_id).catch(() => false);
  const { clientId, clientSecret, redirectUri } = googleClient();
  const token = await googleToken({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  if (!token.refresh_token) return redirect(`${appOrigin()}?coachingDrive=error`);
  const profileRes = token.access_token
    ? await googleFetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } }, 10000).catch(() => null)
    : null;
  const googleEmail = profileRes?.ok ? (await profileRes.json().catch(() => ({})))?.email : null;
  const sealed = await seal(token.refresh_token);
  const existingRes = await db(`zane_coaching_drive_connections?coach_id=eq.${encodeURIComponent(stateRow.coach_id)}&select=id,google_account_email,archive_enabled,include_photos`);
  if (!existingRes.ok) throw new Error('Drive connection lookup failed');
  const existing = (await existingRes.json().catch(() => []))[0];
  const accountChanged = Boolean(existing?.google_account_email && googleEmail && existing.google_account_email !== googleEmail);
  const connectionRes = await db('zane_coaching_drive_connections?on_conflict=coach_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ id: existing?.id || crypto.randomUUID(), coach_id: stateRow.coach_id, google_account_email: googleEmail || null, status: 'connected', archive_enabled: existing ? existing.archive_enabled !== false : coachingEligible, include_photos: existing ? existing.include_photos === true : false, ...(accountChanged ? { root_folder_id: null, overview_spreadsheet_id: null, progress_folder_id: null } : {}), last_error: null, connected_at: new Date().toISOString() }) });
  if (!connectionRes.ok) throw new Error(`Drive connection save failed (${connectionRes.status})`);
  const connectionRows = await connectionRes.json().catch(() => []);
  const connectionId = connectionRows[0]?.id || existing?.id;
  if (!connectionId) throw new Error('Drive connection id missing');
  const tokenRes = await db('zane_coaching_drive_tokens?on_conflict=connection_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ connection_id: connectionId, refresh_token_ciphertext: sealed.ciphertext, refresh_token_iv: sealed.iv, key_version: 1, updated_at: new Date().toISOString() }) });
  if (!tokenRes.ok) throw new Error(`Drive token save failed (${tokenRes.status})`);
  if (coachingEligible) {
    if (accountChanged) await resetExportIds(stateRow.coach_id);
    else await requeueReauthExports(stateRow.coach_id);
    await queueBackfill(stateRow.coach_id);
  }
  return redirect(`${appOrigin()}?coachingDrive=connected`);
}

async function cleanupStalePhotos(limit = 20, budgetMs = 6000) {
  const stagedCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const failedCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows: any[] = [];
  for (const query of [
    `zane_coaching_drive_photos?status=eq.staged&staging_cleaned_at=is.null&created_at=lt.${encodeURIComponent(stagedCutoff)}&select=id,staging_path&order=created_at&limit=${limit}`,
    `zane_coaching_drive_photos?status=eq.failed&staging_cleaned_at=is.null&created_at=lt.${encodeURIComponent(failedCutoff)}&select=id,staging_path&order=created_at&limit=${limit}`,
  ]) {
    const res = await db(query);
    if (!res.ok) throw new Error('stale photo lookup failed');
    const page = await res.json().catch(() => []);
    if (!Array.isArray(page)) throw new Error('stale photo lookup returned invalid data');
    rows.push(...page);
  }
  const deadline = Date.now() + budgetMs;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    try {
      await deleteStagingObject(row.staging_path, true, 2500);
      const patchRes = await db(`zane_coaching_drive_photos?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed', staging_cleaned_at: new Date().toISOString(), last_error: 'Staging photo expired and was cleaned up' }) });
      if (!patchRes.ok) console.error('[coaching-drive] stale photo metadata update failed', row.id, patchRes.status);
    } catch (error) {
      console.error('[coaching-drive] stale photo cleanup failed', row.id, error);
    }
  }
}

async function cleanupStaleProgressPhotos(limit = 20, budgetMs = 6000) {
  // A browser can disappear between the reservation and Storage upload, and a
  // worker can crash after a successful Drive upload.  Keep the private
  // staging bucket bounded without deleting the durable Drive file or its
  // timeline metadata.
  const uploadedCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const oldCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows: any[] = [];
  for (const query of [
    `zane_drive_progress_photos?status=eq.uploaded&staging_path=not.is.null&updated_at=lt.${encodeURIComponent(uploadedCutoff)}&select=id,staging_path,status&order=updated_at&limit=${limit}`,
    `zane_drive_progress_photos?status=eq.staged&staging_path=not.is.null&created_at=lt.${encodeURIComponent(oldCutoff)}&select=id,staging_path,status&order=created_at&limit=${limit}`,
    `zane_drive_progress_photos?status=eq.failed&staging_path=not.is.null&created_at=lt.${encodeURIComponent(oldCutoff)}&select=id,staging_path,status&order=created_at&limit=${limit}`,
  ]) {
    const res = await db(query);
    if (!res.ok) throw new Error('stale progress photo lookup failed');
    const page = await res.json().catch(() => []);
    if (!Array.isArray(page)) throw new Error('stale progress photo lookup returned invalid data');
    rows.push(...page);
  }
  const deadline = Date.now() + budgetMs;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    try {
      await deleteProgressStagingObject(row.staging_path, true, 2500);
      const patch = row.status === 'uploaded'
        ? { staging_path: null, updated_at: new Date().toISOString() }
        : { staging_path: null, status: 'failed', next_attempt_at: '9999-12-31T00:00:00Z', last_error: 'Progress picture staging expired and was cleaned up', updated_at: new Date().toISOString() };
      const patchRes = await db(`zane_drive_progress_photos?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
      if (!patchRes.ok) console.error('[coaching-drive] stale progress metadata update failed', row.id, patchRes.status);
    } catch (error) { console.error('[coaching-drive] stale progress photo cleanup failed', row.id, error); }
  }
}

async function cleanupExpiredPhotoReservations(limit = 20, budgetMs = 6000) {
  const res = await db(`zane_coaching_drive_photo_reservations?expires_at=lt.${encodeURIComponent(new Date().toISOString())}&select=staging_path&order=expires_at&limit=${limit}`);
  if (!res.ok) throw new Error('expired photo reservation lookup failed');
  const rows = await res.json().catch(() => []);
  if (!Array.isArray(rows)) throw new Error('expired photo reservation returned invalid data');
  const deadline = Date.now() + budgetMs;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    try {
      await deleteStagingObject(row.staging_path, true, 2500);
      const deleteRes = await db(`zane_coaching_drive_photo_reservations?staging_path=eq.${encodeURIComponent(row.staging_path)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (!deleteRes.ok) console.error('[coaching-drive] expired reservation delete failed', row.staging_path, deleteRes.status);
    } catch (error) {
      console.error('[coaching-drive] expired reservation cleanup failed', row.staging_path, error);
    }
  }
}

async function cleanupPhotoTombstones(limit = 20, budgetMs = 6000) {
  const res = await db(`zane_coaching_drive_photo_cleanup?select=staging_path&order=created_at&limit=${limit}`);
  if (!res.ok) throw new Error('photo cleanup tombstone lookup failed');
  const rows = await res.json().catch(() => []);
  if (!Array.isArray(rows)) throw new Error('photo cleanup tombstone returned invalid data');
  const deadline = Date.now() + budgetMs;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    try {
      await deleteStagingObject(row.staging_path, true, 2500);
      const deleteRes = await db(`zane_coaching_drive_photo_cleanup?staging_path=eq.${encodeURIComponent(row.staging_path)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (!deleteRes.ok) console.error('[coaching-drive] photo cleanup tombstone delete failed', row.staging_path, deleteRes.status);
    } catch (error) {
      console.error('[coaching-drive] photo cleanup tombstone failed', row.staging_path, error);
    }
  }
}

async function runPhotoJanitors() {
  // Janitors are bounded, best-effort maintenance. They must never delay or
  // prevent the core Drive outbox from being claimed when Storage is slow.
  for (const [name, job] of [
    ['expired-reservations', cleanupExpiredPhotoReservations],
    ['deleted-checkins', cleanupPhotoTombstones],
    ['stale-photos', cleanupStalePhotos],
    ['stale-progress-photos', cleanupStaleProgressPhotos],
  ] as const) {
    try { await job(20, 6000); }
    catch (error) { console.error(`[coaching-drive] ${name} janitor`, error); }
  }
}

async function claimPhotoJanitor(worker: string) {
  const res = await db('rpc/claim_coaching_drive_janitor', {
    method: 'POST', body: JSON.stringify({ p_worker: worker }),
  });
  if (!res.ok) {
    console.error('[coaching-drive] janitor lease lookup failed', res.status);
    return false;
  }
  const body = await res.json().catch(() => null);
  return body === true
    || (Array.isArray(body) && (body[0] === true || body[0]?.claim_coaching_drive_janitor === true))
    || body?.claim_coaching_drive_janitor === true;
}

async function markDriveIdsStale(coachId: string) {
  const res = await db(`zane_coaching_drive_connections?coach_id=eq.${encodeURIComponent(coachId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ root_folder_id: null, overview_spreadsheet_id: null, last_error: 'Drive folders were missing and will be recreated', updated_at: new Date().toISOString() }) });
  if (!res.ok) throw new Error(`Drive folder reset failed (${res.status})`);
  await resetExportIds(coachId);
}

async function releaseCoachLease(coachId: string, worker: string) {
  const res = await db('rpc/release_coaching_drive_worker_lease', {
    method: 'POST', body: JSON.stringify({ p_coach_id: coachId, p_worker: worker }),
  });
  if (!res.ok) console.error('[coaching-drive] coach lease release failed', coachId, res.status);
}

async function runSync() {
  const worker = `drive-${crypto.randomUUID()}`;
  const claimRes = await db('rpc/claim_coaching_drive_exports', { method: 'POST', body: JSON.stringify({ p_limit: 5, p_worker: worker }) });
  if (!claimRes.ok) throw new Error('export claim failed');
  const claimed = await claimRes.json().catch(() => null);
  if (!Array.isArray(claimed)) throw new Error('export claim returned invalid data');
  const coaches = [...new Set(claimed.map(exp => String(exp.coach_id)).filter(Boolean))];
  const connections = new Map<string, any>();
  const accesses = new Map<string, string>();
  const overviewOverrides = new Map<string, Map<string, any>>();
  let succeeded = 0, failed = 0;
  try {
    for (const exp of claimed) {
      try {
        const coachId = String(exp.coach_id);
        let connection = connections.get(coachId);
        if (!connection) {
          const conRes = await db(`zane_coaching_drive_connections?coach_id=eq.${encodeURIComponent(coachId)}&status=eq.connected&archive_enabled=eq.true&select=*`);
          if (!conRes.ok) throw new Error(`Drive connection lookup failed (${conRes.status})`);
          connection = (await conRes.json().catch(() => []))[0]; if (!connection) throw new Error('Drive connection is not active');
          connections.set(coachId, connection);
        }
        let access = accesses.get(coachId);
        if (!access) { access = await accessToken(connection.id); accesses.set(coachId, access); }
        const result = await syncExport(exp, connection, access);
        const finishRes = await db('rpc/finish_coaching_drive_export', { method: 'POST', body: JSON.stringify({ p_export_id: exp.id, p_worker: worker, p_status: 'succeeded', p_spreadsheet_id: result.spreadsheetId, p_client_folder_id: result.clientFolderId, p_photo_count: result.photoCount }) });
        if (!finishRes.ok) throw new Error(`export finish failed (${finishRes.status})`);
        const finishBody = await finishRes.json().catch(() => null);
        const finishAcknowledged = finishBody === true
          || (Array.isArray(finishBody) && (finishBody[0] === true || finishBody[0]?.finish_coaching_drive_export === true))
          || finishBody?.finish_coaching_drive_export === true;
        if (!finishAcknowledged) throw new Error('export finish was not acknowledged');
        await updateConnection(connection.id, { last_sync_at: new Date().toISOString(), last_error: null });
        if (!overviewOverrides.has(coachId)) overviewOverrides.set(coachId, new Map());
        overviewOverrides.get(coachId)!.set(String(exp.checkin_id), { status: 'succeeded', spreadsheetId: result.spreadsheetId, photoCount: result.photoCount });
        succeeded++;
      } catch (error) {
        const status = (error as any)?.status;
        const permanent = (error as any)?.permanent === true;
        const needs = status === 401 || (status === 400 && (error as any)?.googleAuthCode === 'invalid_grant');
        const retryAt = new Date(Date.now() + Math.min(60, 2 ** Math.min(5, Number(exp.attempts || 1))) * 60 * 1000).toISOString();
        if (status === 404) {
          try { await markDriveIdsStale(exp.coach_id); } catch (resetError) { console.error('[coaching-drive] stale folder reset', resetError); }
        }
        const finishRes = await db('rpc/finish_coaching_drive_export', { method: 'POST', body: JSON.stringify({ p_export_id: exp.id, p_worker: worker, p_status: needs ? 'needs_reauth' : 'failed', p_error: String((error as any)?.message || 'Drive export failed').slice(0, 500), p_next_attempt_at: permanent ? '9999-12-31T00:00:00Z' : retryAt }) });
        if (!finishRes.ok) console.error('[coaching-drive] export failure acknowledgement failed', exp.id, finishRes.status);
        if (needs) {
          const connectionRes = await db(`zane_coaching_drive_connections?coach_id=eq.${encodeURIComponent(exp.coach_id)}&select=id`);
          if (!connectionRes.ok) throw new Error('Drive reauth connection lookup failed');
          const connection = (await connectionRes.json().catch(() => []))[0];
          if (connection?.id) await updateConnection(connection.id, { status: 'needs_reauth', last_error: String((error as any)?.message || 'Google authorization expired').slice(0, 500) });
        }
        failed++;
      }
    }
    for (const coachId of coaches) {
      const connection = connections.get(coachId);
      const access = accesses.get(coachId);
      if (!connection || !access) continue;
      try { await syncOverview(coachId, connection, access, overviewOverrides.get(coachId) || new Map()); }
      catch (error) { console.error('[coaching-drive] overview update failed', coachId, error); }
    }
  } finally {
    for (const coachId of coaches) await releaseCoachLease(coachId, worker);
  }
  let progress = { claimed: 0, uploaded: 0, failed: 0 };
  try { progress = await runProgressSync(worker); }
  catch (error) { console.error('[coaching-drive] progress sync', error); }
  if (await claimPhotoJanitor(worker)) await runPhotoJanitors();
  return { claimed: claimed.length, succeeded, failed, progress };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = new URL(req.url);
  if (req.method === 'GET' && (url.searchParams.has('code') || url.searchParams.has('error') || url.searchParams.has('state'))) {
    try { return await callback(req); } catch (error) { console.error('[coaching-drive] callback', error); return redirect(`${appOrigin()}?coachingDrive=error`); }
  }
  const body = await req.json().catch(() => ({}));
  if (body.action === 'sync') {
    const secret = Deno.env.get('CRON_SECRET') || Deno.env.get('DRIVE_WORKER_SECRET') || '';
    if (!secret || req.headers.get('Authorization') !== `Bearer ${secret}`) return json({ error: 'unauthorized' }, 401);
    try { return json(await runSync()); } catch (error) { console.error('[coaching-drive] sync', error); return json({ error: 'sync failed' }, 502); }
  }
  const userId = await resolveUser(req); if (!userId) return json({ error: 'unauthorized' }, 401);
  if (body.action === 'start') { try { return json({ url: await startOAuth(userId) }); } catch (error) { return json({ error: String((error as any)?.message || 'OAuth unavailable') }, 503); } }
  if (body.action === 'photo-status') {
    const coachingId = String(body.coachingId || '');
    if (!coachingId || coachingId.length > 200) return json({ enabled: false });
    const relationRes = await db(`zane_coaching?id=eq.${encodeURIComponent(coachingId)}&client_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=coach_id`);
    if (!relationRes.ok) return json({ error: 'photo status unavailable' }, 502);
    const relation = (await relationRes.json().catch(() => []))[0];
    if (!relation?.coach_id) return json({ enabled: false });
    const connectionRes = await db(`zane_coaching_drive_connections?coach_id=eq.${encodeURIComponent(relation.coach_id)}&status=eq.connected&archive_enabled=eq.true&include_photos=eq.true&select=id&limit=1`);
    if (!connectionRes.ok) return json({ error: 'photo status unavailable' }, 502);
    return json({ enabled: Boolean((await connectionRes.json().catch(() => []))[0]) });
  }
  if (body.action === 'status') {
    const res = await db(`zane_coaching_drive_connections?coach_id=eq.${encodeURIComponent(userId)}&select=id,coach_id,google_account_email,root_folder_id,progress_folder_id,overview_spreadsheet_id,status,archive_enabled,include_photos,connected_at,last_sync_at,last_error`);
    if (!res.ok) return json({ error: 'Drive status unavailable' }, 502);
    return json((await res.json().catch(() => []))[0] || null);
  }
  if (body.action === 'disconnect') {
    const connectionRes = await db(`zane_coaching_drive_connections?coach_id=eq.${encodeURIComponent(userId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'paused', last_error: 'Disconnected by user', updated_at: new Date().toISOString() }) });
    if (!connectionRes.ok) return json({ error: 'Could not disconnect Google Drive' }, 502);
    const ownConnection = await db(`zane_coaching_drive_connections?coach_id=eq.${encodeURIComponent(userId)}&select=id`);
    if (!ownConnection.ok) return json({ error: 'Could not verify Drive disconnect' }, 502);
    const connectionId = (await ownConnection.json().catch(() => []))[0]?.id;
    if (connectionId) {
      const revoke = await db(`zane_coaching_drive_tokens?connection_id=eq.${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
      if (!revoke.ok) return json({ error: 'Could not revoke stored Drive token' }, 502);
    }
    const exportRes = await db(`zane_coaching_drive_exports?coach_id=eq.${encodeURIComponent(userId)}&status=in.(pending,processing,failed,needs_reauth)`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed', next_attempt_at: '9999-12-31T00:00:00Z', last_error: 'Drive disconnected by user', locked_at: null, locked_by: null, updated_at: new Date().toISOString() }) });
    if (!exportRes.ok) return json({ error: 'Could not pause Drive exports' }, 502);
    return json({ ok: true });
  }
  if (body.action === 'progress-list') {
    const rawLimit = Number(body.limit || 50); const rawOffset = Number(body.offset || 0);
    const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.floor(rawLimit))) : 50;
    const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
    const photoDate = typeof body.photoDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.photoDate) ? body.photoDate : null;
    try {
      const photos = await listProgressPhotosForUser(userId, limit + 1, offset, photoDate);
      return json({ photos: photos.slice(0, limit), hasMore: photos.length > limit });
    }
    catch (error) { return json({ error: String((error as any)?.message || 'Progress pictures unavailable') }, 502); }
  }
  if (body.action === 'progress-media') {
    const photoId = String(body.photoId || '');
    if (!/^[0-9a-f-]{36}$/i.test(photoId)) return json({ error: 'invalid progress picture' }, 400);
    const rowRes = await db(`zane_drive_progress_photos?id=eq.${encodeURIComponent(photoId)}&user_id=eq.${encodeURIComponent(userId)}&status=in.(uploaded,failed)&drive_file_id=not.is.null&select=connection_id,drive_file_id,mime_type`);
    if (!rowRes.ok) return json({ error: 'Progress picture unavailable' }, 502);
    const row = (await rowRes.json().catch(() => []))[0];
    if (!row?.drive_file_id || !row?.connection_id) return json({ error: 'Progress picture is not ready' }, 409);
    try {
      const access = await accessToken(row.connection_id);
      const media = await drive(`files/${encodeURIComponent(row.drive_file_id)}?alt=media`, access);
      return new Response(media.body, { status: 200, headers: { ...corsHeaders, 'Content-Type': row.mime_type || media.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'private, max-age=300' } });
    } catch (error) {
      const status = (error as any)?.status;
      const needsReauth = status === 401 || status === 403 || (status === 400 && (error as any)?.googleAuthCode === 'invalid_grant');
      if (needsReauth) await updateConnection(row.connection_id, { status: 'needs_reauth', last_error: 'Google authorization expired while loading a progress picture' }).catch(() => {});
      return json({ error: 'Progress picture could not be loaded' }, status === 404 ? 404 : needsReauth ? 401 : 502);
    }
  }
  if (body.action === 'progress-delete') {
    const photoId = String(body.photoId || '');
    if (!/^[0-9a-f-]{36}$/i.test(photoId)) return json({ error: 'invalid progress picture' }, 400);
    const rowRes = await db(`zane_drive_progress_photos?id=eq.${encodeURIComponent(photoId)}&user_id=eq.${encodeURIComponent(userId)}&select=id`);
    if (!rowRes.ok || !(await rowRes.json().catch(() => []))[0]) return json({ error: 'Progress picture not found' }, 404);
    const mark = await db(`zane_drive_progress_photos?id=eq.${encodeURIComponent(photoId)}&user_id=eq.${encodeURIComponent(userId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'deleting', next_attempt_at: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null, updated_at: new Date().toISOString() }) });
    if (!mark.ok) return json({ error: 'Could not remove progress picture' }, 502);
    return json({ ok: true });
  }
  if (body.action === 'configure') {
    if (!(await canUseCoachDrive(userId))) return json({ error: 'Coach mode is not enabled' }, 403);
    const enabling = body.archiveEnabled !== false;
    const current = await db(`zane_coaching_drive_connections?coach_id=eq.${encodeURIComponent(userId)}&select=id,status&limit=1`);
    if (!current.ok) return json({ error: 'Drive status unavailable' }, 502);
    const connection = (await current.json().catch(() => []))[0];
    if (!connection) return json({ error: 'Google Drive is not connected' }, 409);
    if (enabling) {
      if (connection.status !== 'connected') return json({ error: 'Reconnect Google Drive before enabling the archive' }, 409);
      const tokenRes = await db(`zane_coaching_drive_tokens?connection_id=eq.${encodeURIComponent(connection.id)}&select=connection_id&limit=1`);
      if (!tokenRes.ok) return json({ error: 'Drive token status unavailable' }, 502);
      if (!((await tokenRes.json().catch(() => []))[0])) return json({ error: 'Reconnect Google Drive before enabling the archive' }, 409);
    }
    const res = await db(`zane_coaching_drive_connections?coach_id=eq.${encodeURIComponent(userId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ archive_enabled: enabling, include_photos: enabling && body.includePhotos === true, status: enabling ? 'connected' : 'paused', updated_at: new Date().toISOString() }) });
    if (!res.ok) return json({ error: 'could not update Drive settings' }, 502);
    if (!enabling) {
      const pauseRes = await db(`zane_coaching_drive_exports?coach_id=eq.${encodeURIComponent(userId)}&status=in.(pending,processing,failed,needs_reauth)`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed', next_attempt_at: '9999-12-31T00:00:00Z', last_error: 'Drive archive disabled', locked_at: null, locked_by: null, updated_at: new Date().toISOString() }) });
      if (!pauseRes.ok) return json({ error: 'could not pause Drive exports' }, 502);
    } else {
      try { await queueBackfill(userId); } catch (error) { return json({ error: String((error as any)?.message || 'could not resume Drive exports') }, 502); }
    }
    return json({ ok: true });
  }
  if (body.action === 'retry') {
    if (!(await canUseCoachDrive(userId))) return json({ error: 'Coach mode is not enabled' }, 403);
    const res = await db(`zane_coaching_drive_exports?coach_id=eq.${encodeURIComponent(userId)}&status=in.(failed,needs_reauth)`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'pending', next_attempt_at: new Date().toISOString(), last_error: null, locked_at: null, locked_by: null, updated_at: new Date().toISOString() }) });
    if (!res.ok) return json({ error: 'could not retry Drive exports' }, 502);
    return json({ ok: true });
  }
  return json({ error: 'unknown action' }, 400);
});
