#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Babel = require('@babel/standalone');

const helperPath = path.join(__dirname, '..', '..', 'supabase', 'functions', '_shared', 'storage-cleanup.ts');
const source = fs.readFileSync(helperPath, 'utf8');
const code = Babel.transform(source, {
  presets: ['typescript', ['env', { modules: 'commonjs' }]],
  sourceType: 'module',
  filename: helperPath,
}).code;
const mod = { exports: {} };
const context = { module: mod, exports: mod.exports };
vm.runInNewContext(code, context, { filename: helperPath });

const isMissing = mod.exports.isMissingStorageObjectResponse;
assert.strictEqual(typeof isMissing, 'function');
assert.strictEqual(isMissing(404), true);
assert.strictEqual(isMissing(400, '{"error":"NotFound","message":"Object not found"}'), true);
assert.strictEqual(isMissing(400, 'The resource was not found'), true);
assert.strictEqual(isMissing(400, '{"code":"NoSuchKey"}'), true);
assert.strictEqual(isMissing(400, 'invalid object path'), false);
assert.strictEqual(isMissing(400, 'Unauthorized'), false);
assert.strictEqual(isMissing(401, 'Object not found'), false);
assert.strictEqual(isMissing(500, 'Object not found'), false);
console.log('coaching-drive-storage: missing-object responses handled idempotently');
