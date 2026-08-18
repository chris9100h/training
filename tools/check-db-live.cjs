#!/usr/bin/env node
// Live DB drift check, run by .github/workflows/db-drift.yml (weekly + manual).
// Compares the REAL Supabase database against supabase/schema.sql and
// docs/database.md. The offline counterpart (migrations vs repo files, runs
// on every push) is tools/check-db-docs.cjs.
//
// Two modes, picked automatically:
//
// Inventory mode (when SUPABASE_SERVICE_ROLE_KEY is set): calls the
// admin_schema_inventory() RPC (Migration 0142) for the authoritative view:
//   - all public columns from information_schema, compared both ways against
//     schema.sql and docs/database.md
//   - has_function_privilege('anon', ...) for every public function (grant
//     leak canary, see "Grant-Fallen" in docs/database.md): must be false
//   - the supabase_realtime publication members
//
// Probe mode (no secret): uses the public anon key from src/store.js and
// checks that every zane_ table/column in schema.sql still exists live, via
// read-only PostgREST selects with limit=1 (RLS applies, returns no data).
// Limitation: columns added live but missing from schema.sql are invisible
// in this mode; only inventory mode catches those. (The PostgREST OpenAPI
// spec under /rest/v1/ would show them, but Supabase now serves that
// endpoint to the service_role key only, hence this design.)
//
// Setup for inventory mode:
//   1. Run Migration 0142 (creates admin_schema_inventory, service_role only).
//   2. GitHub repo -> Settings -> Secrets and variables -> Actions ->
//      "New repository secret": name SUPABASE_SERVICE_ROLE_KEY (exactly),
//      value from Supabase Dashboard -> Project Settings -> API ->
//      service_role key. The workflow picks it up on the next run; the log
//      line "service key: present/not set" shows whether it arrived.
//
// Test hook (offline development): --inventory <file> reads a saved
// inventory JSON instead of hitting the network.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// ── Shared parsing helpers (same logic as check-db-docs.cjs) ────────────────

function stripSql(src) {
  return src
    .replace(/\$[a-zA-Z_]*\$[\s\S]*?\$[a-zA-Z_]*\$/g, "''")
    .replace(/--[^\n]*/g, '');
}

function createTableBlocks(sql) {
  const blocks = [];
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < sql.length && depth > 0) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') depth--;
      i++;
    }
    blocks.push({ name: m[1].toLowerCase(), body: sql.slice(re.lastIndex, i - 1) });
  }
  return blocks;
}

const CONSTRAINT_WORDS = new Set(['primary', 'unique', 'constraint', 'foreign', 'check', 'like']);

function columnsFromBody(body) {
  const cols = [];
  let depth = 0;
  for (const raw of body.split('\n')) {
    const line = raw.trim().replace(/,$/, '');
    if (!line) continue;
    if (depth === 0) {
      const cm = line.match(/^"?([a-z_][a-z_0-9]*)"?\s+\w+/i);
      if (cm && !CONSTRAINT_WORDS.has(cm[1].toLowerCase())) cols.push(cm[1].toLowerCase());
    }
    for (const ch of line) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
  }
  return cols;
}

const schemaTables = new Map();
for (const b of createTableBlocks(stripSql(read('supabase/schema.sql')))) {
  schemaTables.set(b.name, new Set(columnsFromBody(b.body)));
}

const doc = read('docs/database.md');
const docSections = new Map();
{
  const parts = doc.split(/\n### `(zane_\w+)`\n/);
  for (let i = 1; i < parts.length; i += 2) {
    docSections.set(parts[i], parts[i + 1].split('\n### ')[0].split('\n## ')[0]);
  }
}

// Realtime publication: expected zane_ members. Foreign (non-zane) tables in
// the same database are reported as info only.
// Social and Coaching use private Broadcast invalidations. Their Postgres
// Changes tables are deliberately absent from the normal publication; the
// reversible admin transport switch restores them only during an emergency.
const EXPECTED_REALTIME = new Set();

// Functions where anon EXECUTE is intentional (documented in docs/database.md,
// "Grant-Fallen"). Every other function must have anon_exec === false.
// Keyed on the full signature, not the bare name, so a future overload cannot
// inherit the exception by sharing a name. Both entries feed the login-free
// public pages: features.html reads the published feature map, welcome.html
// reads the founding-seat count.
const EXPECTED_ANON_EXEC = new Set(['get_public_feature_map()', 'get_founding_seats()']);

// Functions that must NOT be callable by a logged-in user either: ops and
// service-role-only entry points, keyed on the full signature like the set
// above. This exists because the anon half of the Grant-Fallen problem is the
// half that was already fixed. An ALTER DEFAULT PRIVILEGES rule still grants
// EXECUTE directly to `authenticated` on every newly created function (0132
// removed only the anon equivalent), which is how 0207 shipped bump_api_usage
// callable by any signed-in user despite granting only service_role, and why
// 0208 had to revoke it by hand. Nothing watched for the next one.
//
// Deliberately an allowlist of the sensitive few rather than "every function
// must be false": most RPCs here are meant for authenticated callers, so a
// blanket rule would be all noise. Add a signature when a new function is
// service-role or ops only. Needs the authenticated_exec field from migration
// 0258; without it the check reports itself as unavailable instead of passing
// silently, which would be the same blind spot with extra confidence.
const EXPECTED_NO_AUTHENTICATED_EXEC = new Set([
  'bump_api_usage(uuid, text, integer)',
  'collapse_water_logs()',
  'admin_schema_inventory()',
  'db_health()',
  'social_take_notification_rate_limit(uuid, integer)',
  'social_pending_notification_recipients(text, uuid[])',
  'social_notification_message_recipients(uuid, uuid)',
  'social_notification_friend_started_recipients(text, uuid)',
  'social_claim_notification_deliveries(text, text, uuid[])',
  'social_finish_notification_deliveries(text, jsonb)',
  'claim_medication_reminders(uuid, jsonb, uuid, timestamp with time zone)',
  'claim_push_schedule(uuid, text, text)',
  'is_allowed_web_push_endpoint(text)',
  'social_can_notify_message(uuid, uuid)',
  'social_can_notify_finished_comment(uuid, uuid)',
  'social_can_notify_friend_started(text, uuid)',
  'social_can_notify_friend_request(uuid, uuid)',
  'claim_coaching_drive_exports(integer, text)',
  'finish_coaching_drive_export(uuid, text, text, text, text, text, integer, text, timestamp with time zone)',
  'enqueue_coaching_drive_export()',
  'enqueue_coaching_drive_photo_export()',
  'coaching_drive_photo_guard()',
]);

// ── Config ───────────────────────────────────────────────────────────────────

function fromStoreJs(re, label) {
  const m = read('src/store.js').match(re);
  if (!m) throw new Error(`could not parse ${label} from src/store.js`);
  return m[1] || m[2];
}

const SUPABASE_URL =
  process.env.SUPABASE_URL || fromStoreJs(/const SUPABASE_URL\s*=\s*[\s\S]*?['"]([^'"]+)['"]/, 'SUPABASE_URL');
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  fromStoreJs(/const SUPABASE_ANON_KEY\s*=\s*[\s\S]*?['"]([^'"]+)['"]/, 'SUPABASE_ANON_KEY');
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const args = process.argv.slice(2);
const argVal = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const errors = [];
const infos = [];

async function req(url, key, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(opts.headers || {}) },
  });
  return res;
}

// ── Probe mode: verify schema.sql columns still exist live (anon key) ───────

async function probeMode() {
  infos.push('probe mode: verifying schema.sql columns exist live (cannot discover live-only columns; set the service key for full coverage)');
  const zaneTables = [...schemaTables.entries()].filter(([t]) => t.startsWith('zane_')).sort();
  for (const [t, colsSet] of zaneTables) {
    const cols = [...colsSet].sort();
    const url = `${SUPABASE_URL}/rest/v1/${t}?select=${cols.join(',')}&limit=1`;
    const res = await req(url, ANON_KEY);
    if (res.ok) continue;
    if (res.status === 404) {
      errors.push(`probe: table ${t} is in supabase/schema.sql but does not exist live`);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      infos.push(`probe: table ${t} not readable with the anon key (grant revoked?), cannot verify`);
      continue;
    }
    if (res.status === 400) {
      // Some column is unknown live: probe one by one to name all of them.
      let allFine = true;
      for (const c of cols) {
        const r1 = await req(`${SUPABASE_URL}/rest/v1/${t}?select=${c}&limit=1`, ANON_KEY);
        if (r1.status === 400) {
          errors.push(`probe: column ${t}.${c} is in supabase/schema.sql but does not exist live`);
          allFine = false;
        }
      }
      if (allFine) {
        const body = (await res.text()).slice(0, 200);
        errors.push(`probe: table ${t} rejected the full column select but every single column probe passed (odd, check manually): ${body}`);
      }
      continue;
    }
    const body = (await res.text()).slice(0, 200);
    throw Object.assign(new Error(`probe: GET ${t} -> HTTP ${res.status}: ${body}`), { operational: true });
  }
  infos.push(`probe mode checked ${zaneTables.length} tables / ${zaneTables.reduce((n, [, s]) => n + s.size, 0)} columns from schema.sql against the live database`);
}

// ── Inventory mode: authoritative check via admin_schema_inventory() ────────

function compareTable(t, liveCols) {
  const repo = schemaTables.get(t);
  if (!repo) {
    errors.push(`inventory: table ${t} exists live but not in supabase/schema.sql`);
    return;
  }
  for (const c of [...liveCols].sort()) {
    if (!repo.has(c)) errors.push(`inventory: column ${t}.${c} exists live but not in supabase/schema.sql`);
  }
  for (const c of [...repo].sort()) {
    if (!liveCols.has(c)) errors.push(`inventory: column ${t}.${c} is in supabase/schema.sql but not live`);
  }
  const sec = docSections.get(t);
  if (!sec) {
    errors.push(`inventory: table ${t} has no section in docs/database.md`);
    return;
  }
  for (const c of [...liveCols].sort()) {
    if (!sec.includes('`' + c + '`') && !sec.includes(c)) {
      errors.push(`inventory: live column ${t}.${c} is not mentioned in its docs/database.md section`);
    }
  }
}

async function inventoryMode(invFile) {
  let inv;
  if (invFile) {
    inv = JSON.parse(fs.readFileSync(invFile, 'utf8'));
  } else {
    const res = await req(`${SUPABASE_URL}/rest/v1/rpc/admin_schema_inventory`, SERVICE_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (res.status === 404) {
      throw Object.assign(
        new Error('inventory: admin_schema_inventory() not found. Has Migration 0142 been applied?'),
        { operational: true }
      );
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      throw Object.assign(
        new Error(`inventory: POST rpc/admin_schema_inventory -> HTTP ${res.status}: ${body} (service key wrong or lacking EXECUTE?)`),
        { operational: true }
      );
    }
    inv = await res.json();
  }

  const byTable = new Map();
  for (const { t, c } of inv.columns || []) {
    if (!byTable.has(t)) byTable.set(t, new Set());
    byTable.get(t).add(c);
  }
  for (const [t, cols] of [...byTable.entries()].sort()) {
    if (t.startsWith('zane_')) compareTable(t, cols);
  }
  for (const t of [...schemaTables.keys()].sort()) {
    if (t.startsWith('zane_') && !byTable.has(t)) {
      errors.push(`inventory: table ${t} is in supabase/schema.sql but does not exist live`);
    }
  }

  // sig comes from oid::regprocedure, which drops the schema for anything on the
  // search_path, so `public.` is stripped to match how EXPECTED_ANON_EXEC is
  // written. Functions with no sig fall back to name() rather than being skipped.
  const fnSig = (fn) => String(fn.sig || `${fn.f}()`).replace(/^public\./, '');
  const allFnSigs = new Set((inv.functions || []).map(fnSig));
  const seenAnonExec = new Set();
  for (const fn of inv.functions || []) {
    if (fn.anon_exec) {
      const sig = fnSig(fn);
      if (EXPECTED_ANON_EXEC.has(sig)) {
        seenAnonExec.add(sig);
      } else {
        errors.push(`inventory: has_function_privilege('anon', '${sig}') = true (expected: false for every function)`);
      }
    }
  }
  for (const f of [...EXPECTED_ANON_EXEC].sort()) {
    if (!seenAnonExec.has(f)) {
      // Separate "the grant went missing" from "the function itself is gone": the
      // second is an existence problem, not a Grant-Fallen regression, and the
      // fix is completely different.
      if (!allFnSigs.has(f)) {
        errors.push(`inventory: expected anon-exec function ${f} is absent from the live function inventory (dropped or renamed?)`);
      } else {
        errors.push(`inventory: expected anon EXECUTE on ${f} is missing (see docs/database.md, "Grant-Fallen")`);
      }
    }
  }

  // The authenticated half of the same check. `authenticated_exec` arrives with
  // migration 0258; an inventory without it is reported as unavailable rather
  // than passing, since "no function reported true" and "no function reported
  // at all" look identical from here and only one of them is good news.
  const hasAuthExec = (inv.functions || []).some((fn) => 'authenticated_exec' in fn);
  if (!hasAuthExec) {
    infos.push('inventory: authenticated_exec not reported, service-role-only grants unchecked (apply migration 0258)');
  } else {
    const seenNoAuth = new Set();
    for (const fn of inv.functions || []) {
      const sig = fnSig(fn);
      if (!EXPECTED_NO_AUTHENTICATED_EXEC.has(sig)) continue;
      seenNoAuth.add(sig);
      if (fn.authenticated_exec) {
        errors.push(`inventory: has_function_privilege('authenticated', '${sig}') = true (service-role only, see docs/database.md "Grant-Fallen": needs an explicit REVOKE, the default-privileges rule re-grants it)`);
      }
    }
    for (const f of [...EXPECTED_NO_AUTHENTICATED_EXEC].sort()) {
      if (!seenNoAuth.has(f)) {
        errors.push(`inventory: service-role-only function ${f} is absent from the live function inventory (dropped, renamed, or its signature changed?)`);
      }
    }
  }

  const rt = (inv.realtime || []).map(String);
  const rtZane = new Set(rt.filter((t) => t.startsWith('zane_')));
  for (const t of [...EXPECTED_REALTIME].sort()) {
    if (!rtZane.has(t)) errors.push(`inventory: ${t} is missing from the supabase_realtime publication`);
  }
  for (const t of [...rtZane].sort()) {
    if (!EXPECTED_REALTIME.has(t)) {
      errors.push(`inventory: unexpected app table ${t} in the supabase_realtime publication (update docs + EXPECTED_REALTIME in this script if intended)`);
    }
  }
  const rtForeign = rt.filter((t) => !t.startsWith('zane_')).sort();
  if (rtForeign.length) infos.push(`inventory: non-app tables in realtime publication (ignored): ${rtForeign.join(', ')}`);

  const foreign = [...byTable.keys()].filter((t) => !t.startsWith('zane_')).sort();
  if (foreign.length) infos.push(`inventory: non-app tables in public schema (ignored): ${foreign.join(', ')}`);
  infos.push(`inventory mode checked ${[...byTable.keys()].filter((t) => t.startsWith('zane_')).length} live tables, ${(inv.functions || []).length} functions, realtime publication`);
}

(async () => {
  console.log(`service key: ${SERVICE_KEY ? `present (${SERVICE_KEY.length} chars)` : 'not set'}`);
  try {
    const invFile = argVal('--inventory');
    if (invFile || SERVICE_KEY) await inventoryMode(invFile);
    else await probeMode();
  } catch (e) {
    console.error(`check-db-live: ${e.message}`);
    process.exit(e.operational ? 2 : 1);
  }
  for (const i of infos) console.log('  info: ' + i);
  if (errors.length) {
    console.error(`\ncheck-db-live: ${errors.length} drift problem(s) found\n`);
    for (const e of errors) console.error('  - ' + e);
    console.error('\nEither the live database changed without a migration, or a migration was');
    console.error('applied without updating supabase/schema.sql / docs/database.md.');
    process.exit(1);
  }
  console.log('check-db-live OK: live database matches schema.sql and docs/database.md');
})();
