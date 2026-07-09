// Shared SQL-schema parsing helpers. Single source used by both the DB-docs
// drift check (check-db-docs.cjs) and the backup-coverage check
// (check-backup-coverage.cjs), so there is exactly one schema parser and the
// backup check inherits the same (migration- and live-DB-reconciled) truth.

// Strip -- comments and dollar-quoted function bodies so DDL keywords inside
// function source (e.g. dynamic SQL in DO blocks) never reach the parser.
function stripSql(src) {
  return src
    .replace(/\$[a-zA-Z_]*\$[\s\S]*?\$[a-zA-Z_]*\$/g, "''")
    .replace(/--[^\n]*/g, '');
}

// Scan "create table <name> (" and return each table's balanced column body.
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

// Parse a schema.sql string into Map(tableName -> Set(columns)).
function parseSchemaTables(schemaSrc) {
  const stripped = stripSql(schemaSrc);
  const tables = new Map();
  for (const b of createTableBlocks(stripped)) tables.set(b.name, new Set(columnsFromBody(b.body)));
  return tables;
}

module.exports = { stripSql, createTableBlocks, columnsFromBody, parseSchemaTables, CONSTRAINT_WORDS };
