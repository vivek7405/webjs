import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withRequest, headers, cookies, getRequest } from '../packages/server/src/context.js';

test('headers() and cookies() are bound to the in-flight request', async () => {
  const req = new Request('http://x/', {
    headers: { 'x-flag': 'on', cookie: 'a=1; b=two' },
  });
  await withRequest(req, () => {
    assert.equal(headers().get('x-flag'), 'on');
    const c = cookies();
    assert.equal(c.get('a'), '1');
    assert.equal(c.get('b'), 'two');
    assert.ok(c.has('a') && !c.has('zzz'));
    assert.deepEqual(c.entries(), [['a', '1'], ['b', 'two']]);
    assert.strictEqual(getRequest(), req);
  });
});

test('headers()/cookies() throw outside a request scope', () => {
  assert.throws(() => headers(), /outside a request scope/);
  assert.throws(() => cookies(), /outside a request scope/);
});

test('contexts are isolated across concurrent requests', async () => {
  const r1 = new Request('http://x/', { headers: { 'x-id': 'one' } });
  const r2 = new Request('http://x/', { headers: { 'x-id': 'two' } });
  await Promise.all([
    withRequest(r1, async () => {
      // Yield to scheduler to interleave.
      await new Promise((r) => setImmediate(r));
      assert.equal(headers().get('x-id'), 'one');
    }),
    withRequest(r2, async () => {
      await new Promise((r) => setImmediate(r));
      assert.equal(headers().get('x-id'), 'two');
    }),
  ]);
});
