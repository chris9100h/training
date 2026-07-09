#!/usr/bin/env node
// Offline DB-docs drift check, run by CI on every push (no network needed).
//
// Replays every migration in supabase/migrations/ (CREATE/ALTER/DROP TABLE,
// ADD/DROP/RENAME COLUMN, CREATE/DROP FUNCTION) into an expected inventory,
// then verifies:
//   1. every surviving table/column exists in supabase/schema.sql
//   2. every surviving zane_ table has a section in docs/database.md and
//      every column is mentioned in that section
//   3. every surviving function appears in schema.sql and docs/database.md
//   4. columns documented as bullets in docs/database.md exist in schema.sql
//      (no ghost columns)
//
// The live counterpart (checks the real database) is tools/check-db-live.cjs.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// Schema-parsing helpers are shared with check-backup-coverage.cjs so there is
// exactly one parser (see tools/lib/sql-schema.cjs).
const { stripSql, createTableBlocks, columnsFromBody } = require('./lib/sql-schema.cjs');

// ── Replay migrations into an expected inventory ────────────────────────────

const migDir = path.join(root, 'supabase', 'migrations');
const migFiles = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();

const tables = new Map(); // final table name -> Set(columns)
const functions = new Set();

for (const f of migFiles) {
  const sql = stripSql(fs.readFileSync(path.join(migDir, f), 'utf8'));

  for (const b of createTableBlocks(sql)) {
    if (!tables.has(b.name)) tables.set(b.name, new Set());
    for (const c of columnsFromBody(b.body)) tables.get(b.name).add(c);
  }

  // Whole ALTER TABLE statements (may carry several ADD/DROP actions).
  const alterRe = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?(\w+)"?([\s\S]*?);/gi;
  let m;
  while ((m = alterRe.exec(sql))) {
    const t = m[1].toLowerCase();
    const body = m[2];
    const ren = body.match(/rename\s+to\s+(?:public\.)?"?(\w+)"?/i);
    if (ren) {
      const to = ren[1].toLowerCase();
      tables.set(to, tables.get(t) || new Set());
      tables.delete(t);
      continue;
    }
    const colRen = body.match(/rename\s+column\s+"?(\w+)"?\s+to\s+"?(\w+)"?/i);
    if (colRen && tables.has(t)) {
      tables.get(t).delete(colRen[1].toLowerCase());
      tables.get(t).add(colRen[2].toLowerCase());
      continue;
    }
    if (!tables.has(t)) tables.set(t, new Set());
    let a;
    const addRe = /add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi;
    while ((a = addRe.exec(body))) tables.get(t).add(a[1].toLowerCase());
    const dropRe = /drop\s+column\s+(?:if\s+exists\s+)?"?(\w+)"?/gi;
    while ((a = dropRe.exec(body))) tables.get(t).delete(a[1].toLowerCase());
  }

  const dropTabRe = /drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi;
  while ((m = dropTabRe.exec(sql))) tables.delete(m[1].toLowerCase());

  const fnRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi;
  while ((m = fnRe.exec(sql))) functions.add(m[1].toLowerCase());
  const dropFnRe = /drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi;
  while ((m = dropFnRe.exec(sql))) functions.delete(m[1].toLowerCase());
}

// ── Parse schema.sql and docs/database.md ───────────────────────────────────

const schemaRaw = read('supabase/schema.sql');
const schema = stripSql(schemaRaw);
const schemaTables = new Map();
for (const b of createTableBlocks(schema)) schemaTables.set(b.name, new Set(columnsFromBody(b.body)));
const schemaFns = new Set();
{
  const fnRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi;
  let m;
  while ((m = fnRe.exec(schema))) schemaFns.add(m[1].toLowerCase());
}

const doc = read('docs/database.md');
const docSections = new Map();
{
  const parts = doc.split(/\n### `(zane_\w+)`\n/);
  for (let i = 1; i < parts.length; i += 2) {
    docSections.set(parts[i], parts[i + 1].split('\n### ')[0].split('\n## ')[0]);
  }
}

// ── Compare ──────────────────────────────────────────────────────────────────

const errors = [];

for (const [t, cols] of [...tables.entries()].sort()) {
  if (!schemaTables.has(t)) {
    errors.push(`table ${t} (from migrations) is missing in supabase/schema.sql`);
    continue;
  }
  for (const c of [...cols].sort()) {
    if (!schemaTables.get(t).has(c)) {
      errors.push(`column ${t}.${c} (from migrations) is missing in supabase/schema.sql`);
    }
  }
}

for (const [t, cols] of [...schemaTables.entries()].sort()) {
  if (!t.startsWith('zane_')) continue;
  const sec = docSections.get(t);
  if (!sec) {
    errors.push(`table ${t} has no "### \`${t}\`" section in docs/database.md`);
    continue;
  }
  for (const c of [...cols].sort()) {
    if (!sec.includes('`' + c + '`') && !sec.includes(c)) {
      errors.push(`column ${t}.${c} is not mentioned in its docs/database.md section`);
    }
  }
  // Ghost check: columns documented as "- `col` (" bullets must really exist.
  for (const dm of sec.matchAll(/^- `([a-z_0-9]+)` \(/gm)) {
    if (!schemaTables.get(t).has(dm[1])) {
      errors.push(`docs/database.md documents ${t}.${dm[1]}, which does not exist in schema.sql`);
    }
  }
}

for (const fn of [...functions].sort()) {
  if (!schemaFns.has(fn)) errors.push(`function ${fn} (from migrations) is missing in supabase/schema.sql`);
}
for (const fn of [...schemaFns].sort()) {
  if (!doc.includes(fn)) errors.push(`function ${fn} (schema.sql) is not mentioned in docs/database.md`);
}

if (errors.length) {
  console.error(`check-db-docs: ${errors.length} problem(s) found\n`);
  for (const e of errors) console.error('  - ' + e);
  console.error('\nFix: update supabase/schema.sql and docs/database.md alongside the migration');
  console.error('(workflow: CLAUDE.md, section "Datenbank (Supabase)").');
  process.exit(1);
}

console.log(
  `check-db-docs OK: ${tables.size} tables / ` +
  `${[...tables.values()].reduce((n, s) => n + s.size, 0)} columns / ` +
  `${functions.size} functions from ${migFiles.length} migrations ` +
  `match schema.sql and docs/database.md`
);
