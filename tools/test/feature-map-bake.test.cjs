#!/usr/bin/env node
const assert = require('assert');
const { canonicalRows, sameRowsets } = require('../bake-feature-map.cjs');

const rowA = {
  card_id: 'alpha', hidden: false, is_custom: false, cat: 'training',
  name: 'Alpha', role: 'user', summary: 'A', actions: ['Open'], sort: 1,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-02T00:00:00Z',
};
const rowB = {
  card_id: 'beta', hidden: true, is_custom: true, cat: 'health',
  name: 'Beta', role: 'both', summary: null, actions: [], sort: 2,
  created_at: '2026-08-03T00:00:00Z', updated_at: '2026-08-04T00:00:00Z',
};

assert.strictEqual(sameRowsets([rowA, rowB], [
  { ...rowB, updated_at: 'later' },
  { ...rowA, created_at: 'different' },
]), true, 'timestamps and row order must not change semantic equality');
assert.strictEqual(sameRowsets([rowA], [{ ...rowA, hidden: true }]), false, 'semantic edits must be detected');

const canonical = canonicalRows([rowB, rowA]);
assert.deepStrictEqual(canonical.map(row => row.card_id), ['alpha', 'beta']);
assert.deepStrictEqual(Object.keys(canonical[0]), [
  'card_id', 'hidden', 'is_custom', 'cat', 'name', 'role', 'summary', 'actions', 'sort',
]);
assert.strictEqual(Object.prototype.hasOwnProperty.call(canonical[0], 'updated_at'), false);

console.log('feature-map-bake: semantic snapshot is deterministic and ignores timestamps');
