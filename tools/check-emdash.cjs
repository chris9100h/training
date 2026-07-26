#!/usr/bin/env node
/* CI gate: no em-dashes (U+2014) in shipped sources.
   House rule (CLAUDE.md): never an em-dash, anywhere. It kept coming back
   because nothing checked, and a sweep found 926 of them across app text,
   changelog entries and comments.

   ONE deliberate exception: the lone placeholder glyph that stands for "no
   value" in the UI, i.e. an em-dash that IS the whole string or the whole JSX
   text node ('—', "—", >—<). Those are a typographic element, not prose. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const EM = '—';

const files = [
  ...fs.readdirSync(path.join(root, 'src')).filter(f => /\.(js|jsx)$/.test(f) && f !== 'supabase.js').map(f => `src/${f}`),
  ...fs.readdirSync(root).filter(f => f.endsWith('.html')),
  'sw.js',
];

const hits = [];
for (const rel of files) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    for (let c = line.indexOf(EM); c !== -1; c = line.indexOf(EM, c + 1)) {
      const before = line[c - 1];
      const after = line[c + 1];
      const isPlaceholder = (before === "'" && after === "'")
        || (before === '"' && after === '"')
        || (before === '>' && after === '<');
      if (isPlaceholder) continue;
      hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 110)}`);
    }
  });
}

if (hits.length) {
  console.error(`check-emdash: ${hits.length} em-dash(es) found\n`);
  hits.forEach(h => console.error('  ' + h));
  console.error('\nFix: use a comma, a colon, brackets, or split the sentence.');
  console.error(`Only a lone placeholder glyph ('${EM}' as a whole value) is allowed.`);
  process.exit(1);
}
console.log(`check-emdash: clean (${files.length} files)`);
