#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const staticFiles = [
  'index.html', 'sw.js', 'manifest.json', '.nojekyll',
  'welcome.html', 'features.html', 'autoreg.html', 'CNAME',
];
const staticDirectories = ['src', 'icons', 'Background', 'screenshots'];

function readSources() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const match = html.match(/var SOURCES = \[([\s\S]*?)\];/);
  if (!match) throw new Error('Could not find SOURCES in index.html');
  return [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

function copy(rel) {
  const from = path.join(root, rel);
  const to = path.join(dist, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

async function build() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  for (const rel of staticFiles) {
    if (fs.existsSync(path.join(root, rel))) copy(rel);
  }
  for (const rel of staticDirectories) {
    if (fs.existsSync(path.join(root, rel))) copy(rel);
  }

  const jsxSources = readSources().filter(rel => rel.endsWith('.jsx'));
  let totalInput = 0;
  let totalOutput = 0;
  for (const rel of jsxSources) {
    const inputPath = path.join(root, rel);
    const outputPath = path.join(dist, rel);
    const source = fs.readFileSync(inputPath, 'utf8');
    const result = await esbuild.transform(source, {
      loader: 'jsx',
      target: 'es2020',
      jsx: 'transform',
      minifySyntax: true,
      minifyWhitespace: true,
      legalComments: 'none',
      sourcefile: rel,
    });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, result.code + '\n');
    totalInput += Buffer.byteLength(source);
    totalOutput += Buffer.byteLength(result.code);
  }

  const indexPath = path.join(dist, 'index.html');
  const index = fs.readFileSync(indexPath, 'utf8');
  const marker = 'var PRECOMPILED_BUILD = false;';
  if (!index.includes(marker)) throw new Error('Build marker missing from index.html');
  fs.writeFileSync(indexPath, index.replace(marker, 'var PRECOMPILED_BUILD = true;'));

  const ratio = totalInput ? Math.round((totalOutput / totalInput) * 100) : 0;
  console.log(`build OK: ${jsxSources.length} JSX sources -> dist/ (${totalInput} -> ${totalOutput} bytes, ${ratio}% of source)`);
}

build().catch(error => {
  console.error('build FAILED');
  console.error(error.stack || error);
  process.exitCode = 1;
});
