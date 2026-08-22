const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Babel = require('@babel/standalone');

const repoRoot = path.resolve(__dirname, '..', '..');

/**
 * Load one of the small TypeScript edge-function helpers in a Node VM.
 * Keeping the transpile/VM setup here makes the focused helper tests use the
 * same execution path without hiding their individual fixtures or assertions.
 */
function loadTypeScriptModule(filePath, globals = {}, cache = new Map()) {
  const resolvedPath = path.resolve(filePath);
  const relativePath = path.relative(repoRoot, resolvedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`TypeScript test import is outside the repository: ${resolvedPath}`);
  }
  if (cache.has(resolvedPath)) return cache.get(resolvedPath).exports;

  const source = fs.readFileSync(resolvedPath, 'utf8');
  const code = Babel.transform(source, {
    presets: ['typescript', ['env', { modules: 'commonjs' }]],
    sourceType: 'module',
    filename: resolvedPath,
  }).code;
  const module = { exports: {} };
  cache.set(resolvedPath, module);
  const localRequire = specifier => {
    if (typeof specifier !== 'string' || !specifier.startsWith('.')) {
      throw new Error(`TypeScript test import must be relative: ${String(specifier)}`);
    }
    const importedPath = path.resolve(path.dirname(resolvedPath), specifier);
    return loadTypeScriptModule(importedPath, globals, cache);
  };
  const context = {
    ...globals,
    module,
    exports: module.exports,
    require: localRequire,
    __filename: resolvedPath,
    __dirname: path.dirname(resolvedPath),
  };
  vm.runInNewContext(code, context, { filename: resolvedPath });
  return module.exports;
}

module.exports = { loadTypeScriptModule };
