#!/usr/bin/env node
/* Parse every Supabase Edge Function, including shared TypeScript helpers.
   The browser-side syntax gate cannot see these files, and a broken function
   otherwise only becomes visible after deployment. This is a syntax/type
   erasure check, not a replacement for a live Deno integration test. */
const fs = require('fs');
const path = require('path');
const Babel = require('@babel/standalone');

const root = path.join(__dirname, '..', 'supabase', 'functions');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
}
walk(root);

let failed = false;
for (const file of files.sort()) {
  const rel = path.relative(path.join(__dirname, '..'), file).replaceAll(path.sep, '/');
  try {
    Babel.transform(fs.readFileSync(file, 'utf8'), {
      presets: ['typescript'],
      sourceType: 'module',
      filename: rel,
    });
    console.log(`ok   ${rel}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${rel}\n     ${String(error.message).split('\n')[0]}`);
  }
}

if (failed) process.exit(1);
console.log(`check-edge-functions OK: ${files.length} TypeScript files parsed`);
