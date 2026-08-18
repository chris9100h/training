/* Google Drive/Sheets archive for coaching check-ins.
 *
 * The browser never sees a Google refresh token.  This function owns the OAuth
 * exchange, encrypts the token before it reaches the service-only table, and
 * processes a small database outbox.  A Drive/API failure changes export
 * status only; the check-in row has already been committed independently.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const DRIVE_FILE = 'application/vnd.google-apps.folder';
const SHEET_FILE = 'application/vnd.google-apps.spreadsheet';
const BUCKET = 'coaching-drive-staging';
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
    const err = new Error(`Google Sheets ${res.status}`); (err as any).status = res.status;
    throw err;
  }
  return res;
}

function q(value: string) { return `'${String(value).replaceAll("'", "\\'")}'`; }

async function findFile(access: string, name: string, mimeType: string, parent: string | null) {
  const clauses = [`name = ${q(name)}`, `mimeType = ${q(mimeType)}`, 'trashed = false'];
  if (parent) clauses.push(`${q(parent)} in parents`);
  const params = new URLSearchParams({ q: clauses.join(' and '), spaces: 'drive', fields: 'files(id,name)', pageSize: '1' });
  const body = await (await drive(`files?${params}`, access)).json();
  return body.files?.[0] ?? null;
}

async function ensureFolder(access: string, name: string, parent: string | null) {
  const found = await findFile(access, name, DRIVE_FILE, parent);
  if (found) return found.id as string;
  const body: Record<string, unknown> = { name, mimeType: DRIVE_FILE };
  if (parent) body.parents = [parent];
  const res = await drive('files', access, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return (await res.json()).id as string;
}

async function ensureSheet(access: string, name: string, parent: string) {
  const found = await findFile(access, name, SHEET_FILE, parent);
  if (found) return found.id as string;
  const res = await drive('files', access, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: SHEET_FILE, parents: [parent] }) });
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

async function replaceSheet(access: string, spreadsheetId: string, rows: string[][]) {
  await sheets(`spreadsheets/${encodeURIComponent(spreadsheetId)}/values/Sheet1:clear`, access, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const end = String.fromCharCode(65 + Math.min(25, Math.max(1, rows.reduce((m, r) => Math.max(m, r.length), 1)) - 1)) + rows.length;
  const encoded = encodeURIComponent(`Sheet1!A1:${end}`);
  await sheets(`spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encoded}?valueInputOption=RAW`, access, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ range: `Sheet1!A1:${end}`, majorDimension: 'ROWS', values: rows }),
  });
}

async function appendOverview(access: string, spreadsheetId: string, rows: string[][]) {
  await sheets(`spreadsheets/${encodeURIComponent(spreadsheetId)}/values/Sheet1:clear`, access, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const end = String.fromCharCode(65 + rows[0].length - 1) + rows.length;
  await sheets(`spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`Sheet1!A1:${end}`)}?valueInputOption=RAW`, access, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ range: `Sheet1!A1:${end}`, majorDimension: 'ROWS', values: rows }),
  });
}

function storageObjectUrl(path: string) {
  // The metadata path is validated by the database trigger. Encoding every
  // segment here is still necessary defence in depth: service-role requests
  // must never allow URL normalisation to turn a client value into `../...`.
  const encoded = String(path).split('/').map(segment => encodeURIComponent(segment)).join('/');
  return `${base()}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encoded}`;
}

async function deleteStagingObject(path: string, tolerateMissing = true) {
  const res = await timedFetch(storageObjectUrl(path), {
    method: 'DELETE', headers: { Authorization: `Bearer ${serviceKey()}`, apikey: serviceKey() },
  }, 10000);
  if (res.ok || (tolerateMissing && res.status === 404)) return;
  const error = new Error(`staging photo delete ${res.status}`); (error as any).status = res.status;
  throw error;
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
  const checkRes = await db(`zane_checkins?id=eq.${encodeURIComponent(exp.checkin_id)}&select=id,client_id,week_start,checked_in_at,responses`);
  if (!checkRes.ok) throw new Error('check-in lookup failed');
  const checkin = (await checkRes.json().catch(() => []))[0];
  if (!checkin) throw new Error('check-in no longer exists');
  const profileRes = await db(`zane_profiles?id=eq.${encodeURIComponent(exp.client_id)}&select=name`);
  if (!profileRes.ok) throw new Error('client profile lookup failed');
  const profile = (await profileRes.json().catch(() => []))[0] || {};
  checkin.client_name = profile.name || exp.client_id;
  const schemaRes = await db(`zane_coaching?id=eq.${encodeURIComponent(exp.coaching_id)}&select=checkin_schema`);
  if (!schemaRes.ok) throw new Error('check-in schema lookup failed');
  const schema = (await schemaRes.json().catch(() => []))[0]?.checkin_schema || [];
  const root = connection.root_folder_id || await ensureFolder(access, 'ZANE Coaching', null);
  const clients = await ensureFolder(access, 'Clients', root);
  const clientFolder = exp.client_folder_id || await ensureFolder(access, String(checkin.client_name || exp.client_id), clients);
  const sheet = exp.spreadsheet_id || await ensureSheet(access, `Check-in ${checkin.week_start}`, clientFolder);
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
          const failRes = await db(`zane_coaching_drive_photos?id=eq.${encodeURIComponent(photo.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed', last_error: String((error as any)?.message || 'Photo export failed').slice(0, 500) }) });
          if (!failRes.ok) retryablePhotoFailure = true;
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
  const overviewId = connection.overview_spreadsheet_id || await ensureSheet(access, 'Check-in Overview', root);
  const all = await listCoachExports(exp.coach_id);
  const clientIds = [...new Set(all.map(row => row.client_id).filter(Boolean))];
  const names = await listProfileNames(clientIds);
  const overview: string[][] = [['Client', 'Week starting', 'Status', 'Weight', 'Days trained', 'Steps', 'Cardio minutes', 'Macro adherence', 'Detail sheet', 'Photos']];
  for (const row of all) {
    const values = row.checkin?.responses || {};
    overview.push([
      names.get(row.client_id) || row.client_id,
      row.checkin_id === exp.checkin_id ? row.week_start : row.week_start,
      row.checkin_id === exp.checkin_id ? 'succeeded' : row.status,
      String(values.weight_today ?? values.weight_avg_last_week ?? ''), String(values.days_trained ?? ''),
      String(values.steps ?? ''), String(values.cardio_minutes ?? ''), String(values.macro_adherence ?? ''),
      row.checkin_id === exp.checkin_id
        ? `https://docs.google.com/spreadsheets/d/${sheet}`
        : row.spreadsheet_id ? `https://docs.google.com/spreadsheets/d/${row.spreadsheet_id}` : '',
      String(row.checkin_id === exp.checkin_id ? photoRows.length - 1 : (row.photo_count ?? 0)),
    ]);
  }
  await appendOverview(access, overviewId, overview);
  if (!connection.root_folder_id || !connection.overview_spreadsheet_id) await updateConnection(connection.id, { root_folder_id: root, overview_spreadsheet_id: overviewId });
  if (photoNeedsReauth) {
    const error = new Error('Google authorization is required to export photos');
    (error as any).status = 401;
    (error as any).googleAuthCode = 'invalid_grant';
    throw error;
  }
  if (retryablePhotoFailure) throw new Error('one or more photos need another Drive export attempt');
  return { spreadsheetId: sheet, clientFolderId: clientFolder, photoCount: photoRows.length - 1 };
}

async function startOAuth(userId: string) {
  const { clientId, redirectUri } = googleClient();
  const coachRes = await db(`zane_coaching?coach_id=eq.${encodeURIComponent(userId)}&client_id=neq.${encodeURIComponent(userId)}&status=eq.active&select=id&limit=1`);
  if (!coachRes.ok) throw new Error('coaching relationship lookup failed');
  const coachRows = await coachRes.json().catch(() => []);
  if (!coachRows[0]) throw new Error('only active coaches can connect Google Drive');
  const oldStateRes = await db(`zane_coaching_drive_oauth_states?coach_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' });
  if (!oldStateRes.ok) throw new Error('could not rotate OAuth state');
  const state = b64(randomBytes(32)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const stateRes = await db('zane_coaching_drive_oauth_states', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ state, coach_id: userId, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }) });
  if (!stateRes.ok) throw new Error('could not create OAuth state');
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'https://www.googleapis.com/auth/drive.file', state });
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
    const coachingRes = await db(`zane_coaching?coach_id=eq.${encodeURIComponent(coachId)}&client_id=neq.${encodeURIComponent(coachId)}&status=eq.active&select=id,client_id&order=id&limit=100&offset=${offset}`);
    if (!coachingRes.ok) throw new Error('coaching backfill lookup failed');
    const relationships = await coachingRes.json().catch(() => null);
    if (!Array.isArray(relationships)) throw new Error('coaching backfill returned invalid data');
    const rows: any[] = [];
    for (const relation of relationships) {
      const checksRes = await db(`zane_checkins?coaching_id=eq.${encodeURIComponent(relation.id)}&select=id,week_start&order=week_start.desc&limit=12`);
      if (!checksRes.ok) throw new Error('check-in backfill lookup failed');
      const checks = await checksRes.json().catch(() => null);
      if (!Array.isArray(checks)) throw new Error('check-in backfill returned invalid data');
      checks.forEach(checkin => rows.push({ coach_id: coachId, client_id: relation.client_id, coaching_id: relation.id, checkin_id: checkin.id, week_start: checkin.week_start }));
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
  if (!state || !code) return redirect(`${appOrigin()}?coachingDrive=error`);
  const stateRes = await db(`zane_coaching_drive_oauth_states?state=eq.${encodeURIComponent(state)}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=state,coach_id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ consumed_at: new Date().toISOString() }) });
  if (!stateRes.ok) return redirect(`${appOrigin()}?coachingDrive=expired`);
  const stateRow = (await stateRes.json().catch(() => []))[0];
  if (!stateRow) return redirect(`${appOrigin()}?coachingDrive=expired`);
  const { clientId, clientSecret, redirectUri } = googleClient();
  const token = await googleToken({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  if (!token.refresh_token) return redirect(`${appOrigin()}?coachingDrive=error`);
  const profileRes = token.access_token
    ? await googleFetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } }, 10000).catch(() => null)
    : null;
  const googleEmail = profileRes?.ok ? (await profileRes.json().catch(() => ({})))?.email : null;
  const sealed = await seal(token.refresh_token);
  const existingRes = await db(`zane_coaching_drive_connections?coach_id=eq.${encodeURIComponent(stateRow.coach_id)}&select=id,google_account_email`);
  if (!existingRes.ok) throw new Error('Drive connection lookup failed');
  const existing = (await existingRes.json().catch(() => []))[0];
  const accountChanged = Boolean(existing?.google_account_email && googleEmail && existing.google_account_email !== googleEmail);
  const connectionRes = await db('zane_coaching_drive_connections?on_conflict=coach_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ id: existing?.id || crypto.randomUUID(), coach_id: stateRow.coach_id, google_account_email: googleEmail || null, status: 'connected', archive_enabled: true, ...(accountChanged ? { root_folder_id: null, overview_spreadsheet_id: null } : {}), last_error: null, connected_at: new Date().toISOString() }) });
  if (!connectionRes.ok) throw new Error(`Drive connection save failed (${connectionRes.status})`);
  const connectionRows = await connectionRes.json().catch(() => []);
  const connectionId = connectionRows[0]?.id || existing?.id;
  if (!connectionId) throw new Error('Drive connection id missing');
  const tokenRes = await db('zane_coaching_drive_tokens?on_conflict=connection_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ connection_id: connectionId, refresh_token_ciphertext: sealed.ciphertext, refresh_token_iv: sealed.iv, key_version: 1, updated_at: new Date().toISOString() }) });
  if (!tokenRes.ok) throw new Error(`Drive token save failed (${tokenRes.status})`);
  if (accountChanged) await resetExportIds(stateRow.coach_id);
  else await requeueReauthExports(stateRow.coach_id);
  await queueBackfill(stateRow.coach_id);
  return redirect(`${appOrigin()}?coachingDrive=connected`);
}

async function cleanupStalePhotos() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const res = await db(`zane_coaching_drive_photos?status=eq.staged&created_at=lt.${encodeURIComponent(cutoff)}&select=id,staging_path&order=created_at&limit=100`);
  if (!res.ok) throw new Error('stale photo lookup failed');
  const rows = await res.json().catch(() => []);
  if (!Array.isArray(rows)) throw new Error('stale photo lookup returned invalid data');
  for (const row of rows) {
    try {
      await deleteStagingObject(row.staging_path);
      const patchRes = await db(`zane_coaching_drive_photos?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed', last_error: 'Staging photo expired after 30 days' }) });
      if (!patchRes.ok) console.error('[coaching-drive] stale photo metadata update failed', row.id, patchRes.status);
    } catch (error) {
      console.error('[coaching-drive] stale photo cleanup failed', row.id, error);
    }
  }
}

async function markDriveIdsStale(coachId: string) {
  const res = await db(`zane_coaching_drive_connections?coach_id=eq.${encodeURIComponent(coachId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ root_folder_id: null, overview_spreadsheet_id: null, last_error: 'Drive folders were missing and will be recreated', updated_at: new Date().toISOString() }) });
  if (!res.ok) throw new Error(`Drive folder reset failed (${res.status})`);
  await resetExportIds(coachId);
}

async function runSync() {
  const worker = `drive-${crypto.randomUUID()}`;
  await cleanupStalePhotos();
  const claimRes = await db('rpc/claim_coaching_drive_exports', { method: 'POST', body: JSON.stringify({ p_limit: 5, p_worker: worker }) });
  if (!claimRes.ok) throw new Error('export claim failed');
  const claimed = await claimRes.json().catch(() => null);
  if (!Array.isArray(claimed)) throw new Error('export claim returned invalid data');
  let succeeded = 0, failed = 0;
  for (const exp of claimed) {
    try {
      const conRes = await db(`zane_coaching_drive_connections?coach_id=eq.${encodeURIComponent(exp.coach_id)}&status=eq.connected&archive_enabled=eq.true&select=*`);
      const connection = (await conRes.json().catch(() => []))[0]; if (!connection) throw new Error('Drive connection is not active');
      const access = await accessToken(connection.id);
      const result = await syncExport(exp, connection, access);
      const finishRes = await db('rpc/finish_coaching_drive_export', { method: 'POST', body: JSON.stringify({ p_export_id: exp.id, p_worker: worker, p_status: 'succeeded', p_spreadsheet_id: result.spreadsheetId, p_client_folder_id: result.clientFolderId, p_photo_count: result.photoCount }) });
      if (!finishRes.ok) throw new Error(`export finish failed (${finishRes.status})`);
      const finishBody = await finishRes.json().catch(() => null);
      const finishAcknowledged = finishBody === true
        || (Array.isArray(finishBody) && (finishBody[0] === true || finishBody[0]?.finish_coaching_drive_export === true))
        || finishBody?.finish_coaching_drive_export === true;
      if (!finishAcknowledged) throw new Error('export finish was not acknowledged');
      await updateConnection(connection.id, { last_sync_at: new Date().toISOString(), last_error: null });
      succeeded++;
    } catch (error) {
      const status = (error as any)?.status;
      const needs = status === 401 || (status === 400 && (error as any)?.googleAuthCode === 'invalid_grant');
      const retryAt = new Date(Date.now() + Math.min(60, 2 ** Math.min(5, Number(exp.attempts || 1))) * 60 * 1000).toISOString();
      if (status === 404) {
        try { await markDriveIdsStale(exp.coach_id); } catch (resetError) { console.error('[coaching-drive] stale folder reset', resetError); }
      }
      const finishRes = await db('rpc/finish_coaching_drive_export', { method: 'POST', body: JSON.stringify({ p_export_id: exp.id, p_worker: worker, p_status: needs ? 'needs_reauth' : 'failed', p_error: String((error as any)?.message || 'Drive export failed').slice(0, 500), p_next_attempt_at: retryAt }) });
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
  return { claimed: claimed.length, succeeded, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.has('code')) {
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
    const res = await db(`zane_coaching_drive_connections?coach_id=eq.${encodeURIComponent(userId)}&select=id,coach_id,google_account_email,root_folder_id,overview_spreadsheet_id,status,archive_enabled,include_photos,connected_at,last_sync_at,last_error`);
    if (!res.ok) return json({ error: 'Drive status unavailable' }, 502);
    return json((await res.json().catch(() => []))[0] || null);
  }
  if (body.action === 'disconnect') {
    const connectionRes = await db(`zane_coaching_drive_connections?coach_id=eq.${encodeURIComponent(userId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ archive_enabled: false, include_photos: false, status: 'paused', last_error: 'Disconnected by coach', updated_at: new Date().toISOString() }) });
    if (!connectionRes.ok) return json({ error: 'Could not disconnect Google Drive' }, 502);
    const ownConnection = await db(`zane_coaching_drive_connections?coach_id=eq.${encodeURIComponent(userId)}&select=id`);
    if (!ownConnection.ok) return json({ error: 'Could not verify Drive disconnect' }, 502);
    const connectionId = (await ownConnection.json().catch(() => []))[0]?.id;
    if (connectionId) {
      const revoke = await db(`zane_coaching_drive_tokens?connection_id=eq.${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
      if (!revoke.ok) return json({ error: 'Could not revoke stored Drive token' }, 502);
    }
    const exportRes = await db(`zane_coaching_drive_exports?coach_id=eq.${encodeURIComponent(userId)}&status=in.(pending,processing,failed,needs_reauth)`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed', next_attempt_at: '9999-12-31T00:00:00Z', last_error: 'Drive disconnected by coach', locked_at: null, locked_by: null, updated_at: new Date().toISOString() }) });
    if (!exportRes.ok) return json({ error: 'Could not pause Drive exports' }, 502);
    return json({ ok: true });
  }
  if (body.action === 'configure') {
    const current = await db(`zane_coaching_drive_connections?coach_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`);
    if (!current.ok) return json({ error: 'Drive status unavailable' }, 502);
    if (!((await current.json().catch(() => []))[0])) return json({ error: 'Google Drive is not connected' }, 409);
    const res = await db(`zane_coaching_drive_connections?coach_id=eq.${encodeURIComponent(userId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ archive_enabled: body.archiveEnabled !== false, include_photos: body.includePhotos === true, status: body.archiveEnabled === false ? 'paused' : 'connected' }) });
    if (!res.ok) return json({ error: 'could not update Drive settings' }, 502);
    return json({ ok: true });
  }
  if (body.action === 'retry') {
    const res = await db(`zane_coaching_drive_exports?coach_id=eq.${encodeURIComponent(userId)}&status=in.(failed,needs_reauth)`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'pending', next_attempt_at: new Date().toISOString(), last_error: null, locked_at: null, locked_by: null, updated_at: new Date().toISOString() }) });
    if (!res.ok) return json({ error: 'could not retry Drive exports' }, 502);
    return json({ ok: true });
  }
  return json({ error: 'unknown action' }, 400);
});
