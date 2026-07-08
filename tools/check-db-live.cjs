#!/usr/bin/env node
// Live DB drift check, run by .github/workflows/db-drift.yml (weekly + manual).
// Compares the REAL Supabase database against supabase/schema.sql and
// docs/database.md. The offline counterpart (migrations vs repo files, runs
// on every push) is tools/check-db-docs.cjs.
//
// Stage 1 (always, no secrets): uses the public anon key from src/store.js.
//   - PostgREST OpenAPI spec (/rest/v1/) lists every table+column the anon
//     role can see: compared against schema.sql and docs/database.md.
//   - The spec's /rpc/ paths list every function anon may EXECUTE: must be
//     empty (grant leak canary, see "Grant-Fallen" in docs/database.md).
//
// Stage 2 (runs when SUPABASE_SERVICE_ROLE_KEY is set): calls the
// admin_schema_inventory() RPC (Migration 0142) for the authoritative view:
//   - all columns from information_schema (independent of anon grants)
//   - has_function_privilege('anon', ...) for every public function
//   - the supabase_realtime publication
//
// Setup for stage 2:
//   1. Run Migration 0142 (creates admin_schema_inventory, service_role only).
//   2. GitHub repo -> Settings -> Secrets and variables -> Actions ->
//      "New repository secret": name SUPABASE_SERVICE_ROLE_KEY, value from
//      Supabase Dashboard -> Project Settings -> API -> service_role key.
//   The workflow picks it up automatically on the next run.
//
// Test hooks (offline development): --spec <file> and --inventory <file>
// read saved JSON responses instead of hitting the network.

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
const EXPECTED_REALTIME = new Set(['zane_coaching', 'zane_coaching_notes']);

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
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const args = process.argv.slice(2);
const argVal = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const errors = [];
const infos = [];

function compareTable(t, liveCols, source) {
  const repo = schemaTables.get(t);
  if (!repo) {
    errors.push(`${source}: table ${t} exists live but not in supabase/schema.sql`);
    return;
  }
  for (const c of [...liveCols].sort()) {
    if (!repo.has(c)) errors.push(`${source}: column ${t}.${c} exists live but not in supabase/schema.sql`);
  }
  for (const c of [...repo].sort()) {
    if (!liveCols.has(c)) errors.push(`${source}: column ${t}.${c} is in supabase/schema.sql but not live`);
  }
  const sec = docSections.get(t);
  if (!sec) {
    errors.push(`${source}: table ${t} has no section in docs/database.md`);
    return;
  }
  for (const c of [...liveCols].sort()) {
    if (!sec.includes('`' + c + '`') && !sec.includes(c)) {
      errors.push(`${source}: live column ${t}.${c} is not mentioned in its docs/database.md section`);
    }
  }
}

async function getJson(url, key, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    const err = new Error(`${opts.method || 'GET'} ${url} -> HTTP ${res.status}: ${body}`);
    err.operational = true;
    throw err;
  }
  return res.json();
}

// ── Stage 1: anon OpenAPI spec ───────────────────────────────────────────────

async function stage1() {
  const specFile = argVal('--spec');
  const spec = specFile
    ? JSON.parse(fs.readFileSync(specFile, 'utf8'))
    : await getJson(`${SUPABASE_URL}/rest/v1/`, ANON_KEY, {
        headers: { Accept: 'application/openapi+json, application/json' },
      });

  const defs = spec.definitions || {};
  const liveTables = Object.keys(defs).filter((t) => t.startsWith('zane_'));
  if (!liveTables.length) {
    throw Object.assign(
      new Error('stage 1: OpenAPI spec contains no zane_ tables (anon table grants revoked? spec format changed?)'),
      { operational: true }
    );
  }
  for (const t of liveTables.sort()) {
    compareTable(t, new Set(Object.keys(defs[t].properties || {})), 'stage1');
  }
  for (const t of [...schemaTables.keys()].sort()) {
    if (t.startsWith('zane_') && !(t in defs)) {
      errors.push(`stage1: table ${t} is in supabase/schema.sql but not visible live (dropped, or anon grant revoked?)`);
    }
  }

  const anonRpcs = Object.keys(spec.paths || {})
    .filter((p) => p.startsWith('/rpc/'))
    .map((p) => p.slice(5))
    .sort();
  for (const fn of anonRpcs) {
    errors.push(`stage1: function ${fn} is EXECUTEable by anon (see "Grant-Fallen" in docs/database.md; expected: none)`);
  }

  const foreign = Object.keys(defs).filter((t) => !t.startsWith('zane_')).sort();
  if (foreign.length) infos.push(`stage1: non-app tables visible live (ignored): ${foreign.join(', ')}`);
  infos.push(`stage1 checked ${liveTables.length} live tables against schema.sql + docs, ${anonRpcs.length} anon-executable RPCs`);
}

// ── Stage 2: authoritative inventory via service role ────────────────────────

async function stage2() {
  const invFile = argVal('--inventory');
  if (!invFile && !SERVICE_KEY) {
    infos.push('stage2 skipped: SUPABASE_SERVICE_ROLE_KEY not set (see header of this file for setup)');
    return;
  }
  const inv = invFile
    ? JSON.parse(fs.readFileSync(invFile, 'utf8'))
    : await getJson(`${SUPABASE_URL}/rest/v1/rpc/admin_schema_inventory`, SERVICE_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

  const byTable = new Map();
  for (const { t, c } of inv.columns || []) {
    if (!byTable.has(t)) byTable.set(t, new Set());
    byTable.get(t).add(c);
  }
  for (const [t, cols] of [...byTable.entries()].sort()) {
    if (t.startsWith('zane_')) compareTable(t, cols, 'stage2');
  }
  for (const t of [...schemaTables.keys()].sort()) {
    if (t.startsWith('zane_') && !byTable.has(t)) {
      errors.push(`stage2: table ${t} is in supabase/schema.sql but does not exist live`);
    }
  }

  for (const fn of inv.functions || []) {
    if (fn.anon_exec) {
      errors.push(`stage2: has_function_privilege('anon', '${fn.sig || fn.f}') = true (expected: false for every function)`);
    }
  }

  const rt = (inv.realtime || []).map(String);
  const rtZane = new Set(rt.filter((t) => t.startsWith('zane_')));
  for (const t of [...EXPECTED_REALTIME].sort()) {
    if (!rtZane.has(t)) errors.push(`stage2: ${t} is missing from the supabase_realtime publication`);
  }
  for (const t of [...rtZane].sort()) {
    if (!EXPECTED_REALTIME.has(t)) {
      errors.push(`stage2: unexpected app table ${t} in the supabase_realtime publication (update docs + EXPECTED_REALTIME in this script if intended)`);
    }
  }
  const rtForeign = rt.filter((t) => !t.startsWith('zane_')).sort();
  if (rtForeign.length) infos.push(`stage2: non-app tables in realtime publication (ignored): ${rtForeign.join(', ')}`);

  const foreign = [...byTable.keys()].filter((t) => !t.startsWith('zane_')).sort();
  if (foreign.length) infos.push(`stage2: non-app tables in public schema (ignored): ${foreign.join(', ')}`);
  infos.push(`stage2 checked ${[...byTable.keys()].filter((t) => t.startsWith('zane_')).length} live tables, ${(inv.functions || []).length} functions, realtime publication`);
}

(async () => {
  try {
    await stage1();
    await stage2();
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
