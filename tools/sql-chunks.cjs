#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

function splitStatements(sql) {
  const statements = [];
  let start = 0;
  let state = 'normal';
  let dollarTag = null;
  let blockDepth = 0;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (state === 'line-comment') {
      if (char === '\n') state = 'normal';
      continue;
    }

    if (state === 'block-comment') {
      if (char === '/' && next === '*') {
        blockDepth += 1;
        i += 1;
      } else if (char === '*' && next === '/') {
        blockDepth -= 1;
        i += 1;
        if (blockDepth === 0) state = 'normal';
      }
      continue;
    }

    if (state === 'single-quote') {
      if (char === "'" && next === "'") i += 1;
      else if (char === "'") state = 'normal';
      continue;
    }

    if (state === 'double-quote') {
      if (char === '"' && next === '"') i += 1;
      else if (char === '"') state = 'normal';
      continue;
    }

    if (state === 'dollar-quote') {
      if (sql.startsWith(dollarTag, i)) {
        i += dollarTag.length - 1;
        dollarTag = null;
        state = 'normal';
      }
      continue;
    }

    if (char === '-' && next === '-') {
      state = 'line-comment';
      i += 1;
    } else if (char === '/' && next === '*') {
      state = 'block-comment';
      blockDepth = 1;
      i += 1;
    } else if (char === "'") {
      state = 'single-quote';
    } else if (char === '"') {
      state = 'double-quote';
    } else if (char === '$') {
      const match = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) {
        dollarTag = match[0];
        state = 'dollar-quote';
        i += dollarTag.length - 1;
      }
    } else if (char === ';') {
      const statement = sql.slice(start, i + 1).trim();
      if (statement) statements.push(statement);
      start = i + 1;
    }
  }

  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  if (state !== 'normal' && state !== 'line-comment') {
    throw new Error(`Unterminated SQL construct: ${state}`);
  }
  return statements;
}

function packStatements(statements, maxChars) {
  const chunks = [];
  let current = '';
  for (const statement of statements) {
    if (statement.length > maxChars) {
      throw new Error(`One SQL statement has ${statement.length} characters; max is ${maxChars}`);
    }
    const candidate = current ? `${current}\n\n${statement}` : statement;
    if (candidate.length > maxChars) {
      chunks.push(current);
      current = statement;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function normalizeRelationName(value) {
  return value.replace(/"/g, '').split('.').pop().toLowerCase();
}

function createTableName(statement) {
  const match = statement.match(/\bCREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([^\s(]+)/i);
  if (!match) throw new Error('Could not read CREATE TABLE relation name');
  return normalizeRelationName(match[1]);
}

function keyConstraintTableName(statement) {
  const match = statement.match(/\bALTER\s+TABLE(?:\s+ONLY)?\s+([^\s]+)\s+ADD\s+CONSTRAINT\b/i);
  return match ? normalizeRelationName(match[1]) : null;
}

function sortTableStatements(statements) {
  const rows = statements.map((statement, originalIndex) => {
    const name = createTableName(statement);
    const dependencies = new Set();
    for (const match of statement.matchAll(/\bREFERENCES\s+([^\s(]+)/gi)) {
      dependencies.add(normalizeRelationName(match[1]));
    }
    dependencies.delete(name);
    return { statement, originalIndex, name, dependencies };
  });
  const localNames = new Set(rows.map(row => row.name));
  for (const row of rows) {
    row.dependencies = new Set([...row.dependencies].filter(name => localNames.has(name)));
  }

  const emitted = new Set();
  const sorted = [];
  while (sorted.length < rows.length) {
    const ready = rows
      .filter(row => !emitted.has(row.name))
      .filter(row => [...row.dependencies].every(name => emitted.has(name)))
      .sort((a, b) => a.originalIndex - b.originalIndex);
    if (!ready.length) {
      const blocked = rows
        .filter(row => !emitted.has(row.name))
        .map(row => `${row.name}->${[...row.dependencies].filter(name => !emitted.has(name)).join(',')}`);
      throw new Error(`Cyclic or unresolved CREATE TABLE dependencies: ${blocked.join('; ')}`);
    }
    for (const row of ready) {
      emitted.add(row.name);
      sorted.push(row.statement);
    }
  }
  return sorted;
}

const [, , file, command = 'meta', value = ''] = process.argv;
if (!file) {
  throw new Error('Usage: node tools/sql-chunks.cjs <file> [meta|chunk|prelude-meta|prelude-chunk|table-meta|table-chunk|function-meta|function-chunk|rest-meta|rest-chunk] [index]');
}

let sql = fs.readFileSync(file, 'utf8');
const rolloutMarker = '-- Database stability rollout (2026-08-14).';
const markerIndex = sql.indexOf(rolloutMarker);
if (markerIndex >= 0) sql = sql.slice(0, markerIndex);

const maxChars = 18000;
const statements = splitStatements(sql);
const isFunction = statement => /\bCREATE\s+OR\s+REPLACE\s+FUNCTION\b/i.test(statement);
const isTable = statement => /\bCREATE\s+TABLE\b/i.test(statement);
const isPrelude = statement => /(?:^|\n)\s*ALTER\s+DEFAULT\s+PRIVILEGES\b/i.test(statement);
const isKeyConstraint = statement => (
  /\bALTER\s+TABLE(?:\s+ONLY)?\s+[^\s]+\s+ADD\s+CONSTRAINT\b/i.test(statement)
  && /\b(?:PRIMARY\s+KEY|UNIQUE)\b/i.test(statement)
);
let selectedStatements = statements;
if (command.startsWith('function-')) {
  selectedStatements = statements.filter(isFunction);
} else if (command.startsWith('prelude-')) {
  selectedStatements = statements.filter(isPrelude);
} else if (command.startsWith('table-')) {
  const keysByTable = new Map();
  for (const statement of statements.filter(isKeyConstraint)) {
    const name = keyConstraintTableName(statement);
    if (!keysByTable.has(name)) keysByTable.set(name, []);
    keysByTable.get(name).push(statement);
  }
  selectedStatements = sortTableStatements(statements.filter(isTable)).flatMap(statement => [
    statement,
    ...(keysByTable.get(createTableName(statement)) || []),
  ]);
} else if (command.startsWith('rest-')) {
  selectedStatements = statements.filter(statement => (
    !isPrelude(statement) && !isFunction(statement) && !isTable(statement) && !isKeyConstraint(statement)
  ));
}
const chunks = packStatements(selectedStatements, maxChars);

if (command.endsWith('meta') || command === 'meta') {
  process.stdout.write(JSON.stringify({
    sourceCharacters: sql.length,
    statements: selectedStatements.length,
    chunks: chunks.length,
    largestStatement: Math.max(0, ...selectedStatements.map(statement => statement.length)),
    chunkCharacters: chunks.map(chunk => chunk.length),
  }));
} else if (command.endsWith('chunk') || command === 'chunk') {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index >= chunks.length) {
    throw new Error(`Chunk index must be between 0 and ${chunks.length - 1}`);
  }
  process.stdout.write(chunks[index]);
} else {
  throw new Error(`Unknown command: ${command}`);
}
