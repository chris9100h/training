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
const EXPECTED_REALTIME = new Set(['zane_coaching', 'zane_coaching_notes', 'zane_user_settings', 'zane_checkins']);

// Functions where anon EXECUTE is intentional (documented in docs/database.md,
// "Grant-Fallen"). Every other function must have anon_exec === false.
const EXPECTED_ANON_EXEC = new Set(['get_public_feature_map']);

// ── Config ───────────────────────────────────────────────────────────────────

function fromStoreJs(re, label) {
  const m = read('src/store.js').match(re);
  if (!m) throw new Error(`could not parse ${label} from src/store.js`);
  return m[1];
}

const SUPABASE_URL =
  process.env.SUPABASE_URL || fromStoreJs(/const SUPABASE_URL = '([^']+)'/, 'SUPABASE_URL');
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  fromStoreJs(/const SUPABASE_ANON_KEY = '([^']+)'/, 'SUPABASE_ANON_KEY');
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

  // EXPECTED_ANON_EXEC keys on the bare function NAME, not the signature. That is
  // safe only because get_public_feature_map is the single intended anon-exec
  // function; if a future overload shares the name it would be blanket-allowed, so
  // if more anon-exec functions ever appear, switch this to signature-scoped keys.
  const allFnNames = new Set((inv.functions || []).map((fn) => fn.f));
  const seenAnonExec = new Set();
  for (const fn of inv.functions || []) {
    if (fn.anon_exec) {
      if (EXPECTED_ANON_EXEC.has(fn.f)) {
        seenAnonExec.add(fn.f);
      } else {
        errors.push(`inventory: has_function_privilege('anon', '${fn.sig || fn.f}') = true (expected: false for every function)`);
      }
    }
  }
  for (const f of [...EXPECTED_ANON_EXEC].sort()) {
    if (!seenAnonExec.has(f)) {
      // Separate "the grant went missing" from "the function itself is gone": the
      // second is an existence problem, not a Grant-Fallen regression, and the
      // fix is completely different.
      if (!allFnNames.has(f)) {
        errors.push(`inventory: expected anon-exec function ${f}() is absent from the live function inventory (dropped or renamed?)`);
      } else {
        errors.push(`inventory: expected anon EXECUTE on ${f}() is missing (see docs/database.md, "Grant-Fallen")`);
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
