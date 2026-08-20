const fs = require('fs');
const vm = require('vm');
const Babel = require('@babel/standalone');

/**
 * Load one of the small TypeScript edge-function helpers in a Node VM.
 * Keeping the transpile/VM setup here makes the focused helper tests use the
 * same execution path without hiding their individual fixtures or assertions.
 */
function loadTypeScriptModule(filePath, globals = {}) {
  const source = fs.readFileSync(filePath, 'utf8');
  const code = Babel.transform(source, {
    presets: ['typescript', ['env', { modules: 'commonjs' }]],
    sourceType: 'module',
    filename: filePath,
  }).code;
  const module = { exports: {} };
  const context = {
    ...globals,
    module,
    exports: module.exports,
  };
  vm.runInNewContext(code, context, { filename: filePath });
  return module.exports;
}

module.exports = { loadTypeScriptModule };
