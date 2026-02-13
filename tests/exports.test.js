import test from 'node:test';
import assert from 'node:assert/strict';

test('exports provider factory', async () => {
  const module = await import('../dist/index.js');
  assert.equal(typeof module.createProviderRegistry, 'function');
});
