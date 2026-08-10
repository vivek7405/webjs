import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { rateLimit, parseWindow } from '../../src/rate-limit.js';
import { memoryStore, setStore } from '../../src/cache.js';

// Swap in a fresh in-memory store before every test. Tests that bucket
// under shared keys (`_anon_`, no-stamp default) would otherwise leak
// state across the suite and 429 each other.
beforeEach(() => setStore(memoryStore()));

test('parseWindow handles ms/s/m/h suffixes', () => {
  assert.equal(parseWindow(500), 500);
  assert.equal(parseWindow('250'), 250);
  assert.equal(parseWindow('30s'), 30_000);
  assert.equal(parseWindow('2m'), 120_000);
  assert.equal(parseWindow('1h'), 3_600_000);
  assert.equal(parseWindow('bogus'), 60_000);
});

test('rateLimit allows up to max then 429s with Retry-After', async () => {
  const mw = rateLimit({ window: '1s', max: 2 });
  const req = new Request('http://x/', { headers: { 'x-webjs-remote-ip': '9.9.9.9' } });
  const ok1 = await mw(req, async () => new Response('ok'));
  const ok2 = await mw(req, async () => new Response('ok'));
  const no3 = await mw(req, async () => new Response('ok'));
  assert.equal(ok1.status, 200);
  assert.equal(ok2.status, 200);
  assert.equal(no3.status, 429);
  assert.ok(no3.headers.get('retry-after'));
  assert.equal(no3.headers.get('x-ratelimit-remaining'), '0');
});

test('separate keys get separate buckets', async () => {
  const mw = rateLimit({ window: '1s', max: 1 });
  const reqA = new Request('http://x/', { headers: { 'x-webjs-remote-ip': '1.1.1.1' } });
  const reqB = new Request('http://x/', { headers: { 'x-webjs-remote-ip': '2.2.2.2' } });
  assert.equal((await mw(reqA, async () => new Response())).status, 200);
  assert.equal((await mw(reqB, async () => new Response())).status, 200);
  assert.equal((await mw(reqA, async () => new Response())).status, 429);
  assert.equal((await mw(reqB, async () => new Response())).status, 429);
});

test('custom key function is honoured', async () => {
  const mw = rateLimit({
    window: '1s',
    max: 1,
    key: (req) => req.headers.get('x-user') || 'anon',
  });
  const u1 = new Request('http://x/', { headers: { 'x-user': 'alice' } });
  const u2 = new Request('http://x/', { headers: { 'x-user': 'bob' } });
  assert.equal((await mw(u1, async () => new Response())).status, 200);
  assert.equal((await mw(u2, async () => new Response())).status, 200);
  assert.equal((await mw(u1, async () => new Response())).status, 429);
});

test('passes through x-ratelimit-* headers on the success path', async () => {
  const mw = rateLimit({ window: '1s', max: 5 });
  const req = new Request('http://x/', { headers: { 'x-webjs-remote-ip': '3.3.3.3' } });
  const r = await mw(req, async () => new Response('ok'));
  assert.equal(r.headers.get('x-ratelimit-limit'), '5');
  assert.equal(r.headers.get('x-ratelimit-remaining'), '4');
  assert.ok(r.headers.get('x-ratelimit-reset'));
});

test('trustProxy:true falls back through cf-connecting-ip, x-real-ip, then `_anon_`', async () => {
  // Behaviour only available when the deploy opts into trustProxy.
  // Default trustProxy:false would bucket all three under `_anon_`
  // (no `x-webjs-remote-ip` stamped on these synthetic requests).
  const mw = rateLimit({ window: '1s', max: 1, trustProxy: true });
  const cf = new Request('http://x/', { headers: { 'cf-connecting-ip': '4.4.4.4' } });
  const real = new Request('http://x/', { headers: { 'x-real-ip': '5.5.5.5' } });
  const anon = new Request('http://x/');
  // Each hits its own bucket on the first call and 429s on the second.
  assert.equal((await mw(cf, async () => new Response())).status, 200);
  assert.equal((await mw(cf, async () => new Response())).status, 429);
  assert.equal((await mw(real, async () => new Response())).status, 200);
  assert.equal((await mw(real, async () => new Response())).status, 429);
  assert.equal((await mw(anon, async () => new Response())).status, 200);
  assert.equal((await mw(anon, async () => new Response())).status, 429);
});

test('immutable response headers do not throw (catch branch)', async () => {
  // A cross-realm Response can expose immutable headers. Simulate that
  // by returning a Response whose `headers.set` throws.
  const mw = rateLimit({ window: '1s', max: 5 });
  const req = new Request('http://x/', { headers: { 'x-webjs-remote-ip': '8.8.8.8' } });
  const frozenHeaders = new Headers({ 'content-type': 'text/plain' });
  frozenHeaders.set = () => { throw new TypeError('immutable'); };
  const resp = new Response('ok', { headers: {} });
  Object.defineProperty(resp, 'headers', { value: frozenHeaders });
  const out = await mw(req, async () => resp);
  // Middleware swallows the error; pass-through still works.
  assert.equal(out.status, 200);
});

test('static string key acts as a bucket prefix (namespaces IP buckets)', async () => {
  // opts.key as a string prefixes the default IP-derived key: it doesn't
  // collapse all callers into one bucket.
  const mwA = rateLimit({ window: '1s', max: 1, key: 'group-a:' });
  const mwB = rateLimit({ window: '1s', max: 1, key: 'group-b:' });
  const req = new Request('http://x/', { headers: { 'x-webjs-remote-ip': '7.7.7.7' } });
  // Same IP, different prefix → independent buckets.
  assert.equal((await mwA(req, async () => new Response())).status, 200);
  assert.equal((await mwB(req, async () => new Response())).status, 200);
  // Second hit under the same prefix → 429.
  assert.equal((await mwA(req, async () => new Response())).status, 429);
});

test('custom message is surfaced in the 429 body', async () => {
  const mw = rateLimit({ window: '1s', max: 0, message: 'chill out' });
  const req = new Request('http://x/', { headers: { 'x-webjs-remote-ip': '10.10.10.10' } });
  const resp = await mw(req, async () => new Response());
  assert.equal(resp.status, 429);
  assert.deepEqual(await resp.json(), { error: 'chill out' });
});

/* ------------------ trustProxy + clientIp security surface ------------------ */

test('trustProxy:false (default): spoofed X-Forwarded-For does NOT escape the bucket', async () => {
  // Regression coverage for #114. The vulnerability the trustProxy
  // option closes: without it, an attacker rotates X-Forwarded-For
  // per request and stays under the rate limit forever.
  const mw = rateLimit({ window: '1s', max: 1 });
  const ip = 'x-webjs-remote-ip'; // the framework-stamped client IP
  // All three requests come from the same real client (same stamped
  // IP) but rotate XFF. Under trustProxy:false, XFF is IGNORED;
  // all three bucket together and the second + third return 429.
  const r1 = new Request('http://x/', { headers: { [ip]: '1.2.3.4', 'x-forwarded-for': '10.0.0.1' } });
  const r2 = new Request('http://x/', { headers: { [ip]: '1.2.3.4', 'x-forwarded-for': '10.0.0.2' } });
  const r3 = new Request('http://x/', { headers: { [ip]: '1.2.3.4', 'x-forwarded-for': '10.0.0.3' } });
  assert.equal((await mw(r1, async () => new Response())).status, 200);
  assert.equal((await mw(r2, async () => new Response())).status, 429,
    'second request from the same stamped IP must 429 even with rotated XFF');
  assert.equal((await mw(r3, async () => new Response())).status, 429);
});

test('trustProxy:true: rotated X-Forwarded-For DOES escape the bucket (caller opted in)', async () => {
  // Counterfactual: with trustProxy:true the deploy contract is
  // "you have a trusted reverse proxy in front, and it strips
  // inbound XFF before adding its own". If the contract is met,
  // rotating XFF can only come from a misconfigured proxy, not
  // from clients. This test verifies the trustProxy:true semantic
  // is faithfully different from the default.
  const mw = rateLimit({ window: '1s', max: 1, trustProxy: true });
  const r1 = new Request('http://x/', { headers: { 'x-forwarded-for': '10.0.0.1' } });
  const r2 = new Request('http://x/', { headers: { 'x-forwarded-for': '10.0.0.2' } });
  assert.equal((await mw(r1, async () => new Response())).status, 200);
  assert.equal((await mw(r2, async () => new Response())).status, 200,
    'different XFFs map to different buckets under trustProxy:true');
});

test('trustProxy:false: no stamped IP → all requests collapse to `_anon_` and share a bucket', async () => {
  // Embedded use (createRequestHandler under Express/Bun/Deno where
  // the adapter does not stamp x-webjs-remote-ip). Requests share
  // a bucket. Users wanting per-client buckets in that setup must
  // either stamp the IP themselves or pass a custom `key` function.
  const mw = rateLimit({ window: '1s', max: 1 });
  const r1 = new Request('http://x/');
  const r2 = new Request('http://x/', { headers: { 'x-forwarded-for': '1.1.1.1' } });
  assert.equal((await mw(r1, async () => new Response())).status, 200);
  assert.equal((await mw(r2, async () => new Response())).status, 429,
    'both requests collapse to `_anon_` even with different XFF values');
});

test('clientIp(req, {trustProxy:true}) prefers x-forwarded-for leftmost entry', async () => {
  const { clientIp } = await import('../../src/rate-limit.js');
  const req = new Request('http://x/', { headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3', 'x-webjs-remote-ip': '9.9.9.9' } });
  assert.equal(clientIp(req, { trustProxy: true }), '1.1.1.1',
    'trustProxy:true must return the leftmost XFF entry, NOT the stamped remote IP');
});

test('clientIp(req, {trustProxy:false}) ignores x-forwarded-for entirely', async () => {
  const { clientIp } = await import('../../src/rate-limit.js');
  const req = new Request('http://x/', { headers: { 'x-forwarded-for': '1.1.1.1', 'x-webjs-remote-ip': '9.9.9.9' } });
  assert.equal(clientIp(req), '9.9.9.9',
    'default trustProxy:false must return the stamped IP, ignoring XFF');
  const reqNoStamp = new Request('http://x/', { headers: { 'x-forwarded-for': '1.1.1.1' } });
  assert.equal(clientIp(reqNoStamp), '_anon_',
    'default trustProxy:false must NOT fall back to XFF when stamped IP is missing');
});

test('setTrustedRemoteIp: out-of-band IP is authoritative and ignores the inbound header (#756)', async () => {
  const { clientIp, setTrustedRemoteIp } = await import('../../src/rate-limit.js');
  // A client spoofs x-webjs-remote-ip on the wire; the Bun listener stamps the
  // real socket IP out of band. clientIp must return the trusted (WeakMap) value
  // and ignore the spoofed header, with NO Request clone.
  const req = new Request('http://x/', { headers: { 'x-webjs-remote-ip': '6.6.6.6' } });
  setTrustedRemoteIp(req, '5.5.5.5');
  assert.equal(clientIp(req), '5.5.5.5', 'trusted out-of-band IP wins over the spoofed header');
});

test('setTrustedRemoteIp(req, "") marks the request stamped-with-no-IP so the header is never trusted (#756)', async () => {
  const { clientIp, setTrustedRemoteIp } = await import('../../src/rate-limit.js');
  // When the listener could not resolve an IP it still stamps (empty), so a
  // spoofed inbound header does not leak through as the client IP.
  const req = new Request('http://x/', { headers: { 'x-webjs-remote-ip': '6.6.6.6' } });
  setTrustedRemoteIp(req, '');
  assert.equal(clientIp(req), '_anon_', 'an empty trusted stamp resolves to anon, not the spoofed header');
});

test('setTrustedRemoteIp: trusted IP also wins under trustProxy:true (below XFF) (#756)', async () => {
  const { clientIp, setTrustedRemoteIp } = await import('../../src/rate-limit.js');
  const req = new Request('http://x/', { headers: { 'x-webjs-remote-ip': '6.6.6.6' } });
  setTrustedRemoteIp(req, '5.5.5.5');
  // No XFF/CF/real-ip, so the trusted remote IP is the chosen fallback.
  assert.equal(clientIp(req, { trustProxy: true }), '5.5.5.5', 'trusted IP used as the remote-IP fallback, not the header');
});

test('stampRemoteIp: strips any inbound x-webjs-remote-ip and sets the new value', async () => {
  const { stampRemoteIp } = await import('../../src/rate-limit.js');
  const inbound = new Request('http://x/api', {
    method: 'POST',
    headers: {
      'x-webjs-remote-ip': '6.6.6.6',   // forged on the wire
      'x-other': 'kept',
    },
    body: 'payload',
    duplex: 'half',
  });
  const safe = stampRemoteIp(inbound, '127.0.0.1');
  assert.equal(safe.headers.get('x-webjs-remote-ip'), '127.0.0.1',
    'forged header must be replaced by the trusted socket address');
  assert.equal(safe.headers.get('x-other'), 'kept',
    'other headers must survive the rewrite');
  assert.equal(safe.method, 'POST');
  assert.equal(await safe.text(), 'payload',
    'body must round-trip through the new Request');
});

test('stampRemoteIp: missing remoteAddress just strips the inbound header (collapses to _anon_)', async () => {
  const { stampRemoteIp } = await import('../../src/rate-limit.js');
  const inbound = new Request('http://x/', { headers: { 'x-webjs-remote-ip': '6.6.6.6' } });
  const safe = stampRemoteIp(inbound, undefined);
  assert.equal(safe.headers.get('x-webjs-remote-ip'), null,
    'no trusted address means the header must NOT be present');
  // clientIp should fall back to _anon_, NOT the forged value.
  const { clientIp } = await import('../../src/rate-limit.js');
  assert.equal(clientIp(safe), '_anon_');
});

test('createRequestHandler WITHOUT stampRemoteIp trusts wire headers (documented boundary)', async () => {
  // Counterfactual covering the embedded-use threat boundary: the
  // built-in startServer path strips/stamps in toWebRequest, but
  // createRequestHandler hands the user back a `handle(req)` that
  // consumes whatever Request they construct. If the adapter copies
  // wire headers verbatim, x-webjs-remote-ip is trusted. This test
  // pins that boundary so a future refactor doesn't accidentally
  // make embedded use "magically safe" without going through
  // stampRemoteIp.
  const { clientIp } = await import('../../src/rate-limit.js');
  const forged = new Request('http://x/', { headers: { 'x-webjs-remote-ip': '6.6.6.6' } });
  assert.equal(clientIp(forged), '6.6.6.6',
    'without stampRemoteIp, forged header IS read; adapters MUST call the helper');
});

test('stampRemoteIp: preserves AbortSignal for host-side cancellation', async () => {
  const { stampRemoteIp } = await import('../../src/rate-limit.js');
  const ac = new AbortController();
  const inbound = new Request('http://x/', { headers: {}, signal: ac.signal });
  const safe = stampRemoteIp(inbound, '127.0.0.1');
  assert.equal(safe.signal.aborted, false, 'signal must not be pre-aborted');
  ac.abort();
  assert.equal(safe.signal.aborted, true,
    'aborting the source controller must propagate to the safe Request');
});

// ---------------------------------------------------------------------------
// WEBJS_NO_TRUST_PROXY=1 overrides `trustProxy: true` (#1254)
//
// The env switch is the operator's statement about the topology, so it only
// ever SUBTRACTS trust: under the flag an explicit opt-in resolves to the
// framework-stamped peer, exactly as the default path does.
// ---------------------------------------------------------------------------

/** Run `fn` with `WEBJS_NO_TRUST_PROXY` set to `value`, restoring it after. */
async function withNoTrustProxy(value, fn) {
  const prev = process.env.WEBJS_NO_TRUST_PROXY;
  if (value === undefined) delete process.env.WEBJS_NO_TRUST_PROXY;
  else process.env.WEBJS_NO_TRUST_PROXY = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.WEBJS_NO_TRUST_PROXY;
    else process.env.WEBJS_NO_TRUST_PROXY = prev;
  }
}

test('WEBJS_NO_TRUST_PROXY=1: clientIp({trustProxy:true}) returns the stamped peer, not XFF (#1254)', async () => {
  const { clientIp } = await import('../../src/rate-limit.js');
  const req = new Request('http://x/', {
    headers: {
      'x-forwarded-for': '1.1.1.1, 2.2.2.2',
      'cf-connecting-ip': '4.4.4.4',
      'x-real-ip': '8.8.8.8',
      'x-webjs-remote-ip': '9.9.9.9',
    },
  });
  await withNoTrustProxy('1', () => {
    assert.equal(clientIp(req, { trustProxy: true }), '9.9.9.9',
      'the env switch must override the explicit opt-in and land on the stamped peer');
  });
});

test('WEBJS_NO_TRUST_PROXY=1: clientIp({trustProxy:true}) with no stamp returns `_anon_`, never a forwarded value (#1254)', async () => {
  const { clientIp } = await import('../../src/rate-limit.js');
  const req = new Request('http://x/', {
    headers: { 'x-forwarded-for': '1.1.1.1', 'cf-connecting-ip': '4.4.4.4', 'x-real-ip': '8.8.8.8' },
  });
  await withNoTrustProxy('1', () => {
    assert.equal(clientIp(req, { trustProxy: true }), '_anon_',
      'the override must fall all the way through to anon rather than to a forwarded header');
  });
});

test('WEBJS_NO_TRUST_PROXY=1: rateLimit({trustProxy:true}) buckets rotated XFF together (#1254)', async () => {
  // The exact inverse of the flag-off case above, where rotating XFF escapes
  // the bucket. Same stamped peer, different XFF per request, one bucket.
  const mw = rateLimit({ window: '1s', max: 1, trustProxy: true });
  const ip = 'x-webjs-remote-ip';
  const r1 = new Request('http://x/', { headers: { [ip]: '1.2.3.4', 'x-forwarded-for': '10.0.0.1' } });
  const r2 = new Request('http://x/', { headers: { [ip]: '1.2.3.4', 'x-forwarded-for': '10.0.0.2' } });
  await withNoTrustProxy('1', async () => {
    assert.equal((await mw(r1, async () => new Response())).status, 200);
    assert.equal((await mw(r2, async () => new Response())).status, 429,
      'under the env switch a rotated XFF must NOT escape the bucket');
  });
});

test('WEBJS_NO_TRUST_PROXY: only the literal "1" overrides (#1254)', async () => {
  const { clientIp } = await import('../../src/rate-limit.js');
  const req = new Request('http://x/', {
    headers: { 'x-forwarded-for': '1.1.1.1', 'x-webjs-remote-ip': '9.9.9.9' },
  });
  // Matches the `!== '1'` semantics forwarded.test.js already pins for the
  // origin side, so the two readers cannot drift on what counts as "set".
  for (const v of ['0', 'true', 'yes', '', undefined]) {
    await withNoTrustProxy(v, () => {
      assert.equal(clientIp(req, { trustProxy: true }), '1.1.1.1',
        `WEBJS_NO_TRUST_PROXY=${JSON.stringify(v)} must NOT override the opt-in`);
    });
  }
});

test('WEBJS_NO_TRUST_PROXY=1: the override warns exactly once per process (#1254)', async () => {
  // A fresh module instance, so this test owns the module-scope warn latch and
  // cannot be tripped by whichever earlier test happened to fire it first.
  const { clientIp } = await import('../../src/rate-limit.js?warn-once');
  const seen = [];
  const realWarn = console.warn;
  console.warn = (...args) => seen.push(args.join(' '));
  try {
    const req = new Request('http://x/', {
      headers: { 'x-forwarded-for': '1.1.1.1', 'x-webjs-remote-ip': '9.9.9.9' },
    });
    // Flag unset: the opt-in is honoured and nothing is logged.
    await withNoTrustProxy(undefined, () => {
      clientIp(req, { trustProxy: true });
      clientIp(req, { trustProxy: true });
    });
    assert.equal(seen.length, 0, 'no warning may fire while the flag is unset');

    await withNoTrustProxy('1', () => {
      clientIp(req, { trustProxy: true });
      clientIp(req, { trustProxy: true });
      clientIp(req, { trustProxy: true });
    });
    assert.equal(seen.length, 1, 'the override must warn once, not once per request');
    assert.match(seen[0], /WEBJS_NO_TRUST_PROXY/);
    assert.match(seen[0], /trustProxy/);
    // The line must carry no request data, or it becomes a log of
    // client-supplied header values.
    assert.doesNotMatch(seen[0], /1\.1\.1\.1|9\.9\.9\.9/, 'the warning must carry no request data');
  } finally {
    console.warn = realWarn;
  }
});

test('WEBJS_NO_TRUST_PROXY=1: the default path (no option) is unchanged (#1254)', async () => {
  const { clientIp } = await import('../../src/rate-limit.js');
  const req = new Request('http://x/', {
    headers: { 'x-forwarded-for': '1.1.1.1', 'x-webjs-remote-ip': '9.9.9.9' },
  });
  await withNoTrustProxy('1', () => {
    assert.equal(clientIp(req), '9.9.9.9', 'the default path must still read only the stamped peer');
  });
});

/* ------------------ clientIpHeader: naming the visitor's header ------------------ */

test('clientIpHeader reads ONLY the named header (#1389)', async () => {
  const { clientIp } = await import('../../src/rate-limit.js');
  // The shape a Cloudflare deploy actually receives: XFF's leftmost entry is
  // the CDN's own egress address, and the visitor is in CF-Connecting-IP. The
  // default chain takes the wrong one of the two, which is the whole bug.
  const req = new Request('http://x/', {
    headers: {
      'x-forwarded-for': '172.68.1.9, 100.64.0.3',
      'cf-connecting-ip': '203.0.113.44',
      'x-webjs-remote-ip': '100.64.0.3',
    },
  });
  assert.equal(clientIp(req, { trustProxy: true }), '172.68.1.9', 'default chain still prefers XFF leftmost');
  assert.equal(
    clientIp(req, { trustProxy: true, header: 'cf-connecting-ip' }),
    '203.0.113.44',
    'the named header wins over XFF',
  );
});

test('clientIpHeader is matched case-insensitively and splits a chain', async () => {
  const { clientIp } = await import('../../src/rate-limit.js');
  const req = new Request('http://x/', {
    headers: { 'cf-connecting-ip': ' 203.0.113.44 , 10.0.0.1 ', 'x-webjs-remote-ip': '100.64.0.3' },
  });
  // A proxy that APPENDS to the named header must not mint a new bucket per
  // hop, which is the failure mode the option exists to end.
  assert.equal(clientIp(req, { trustProxy: true, header: 'CF-Connecting-IP' }), '203.0.113.44');
});

test('a missing or blank named header falls back to the peer, never to a shared key', async () => {
  const { clientIp } = await import('../../src/rate-limit.js');
  const missing = new Request('http://x/', { headers: { 'x-webjs-remote-ip': '100.64.0.3' } });
  assert.equal(clientIp(missing, { trustProxy: true, header: 'cf-connecting-ip' }), '100.64.0.3');

  // A blank value resolving to '' would be ONE key shared by every visitor
  // whose proxy sent the header empty, throttling strangers together.
  const blank = new Request('http://x/', {
    headers: { 'cf-connecting-ip': '   ', 'x-webjs-remote-ip': '100.64.0.3' },
  });
  assert.equal(clientIp(blank, { trustProxy: true, header: 'cf-connecting-ip' }), '100.64.0.3');

  const nothing = new Request('http://x/', { headers: { 'cf-connecting-ip': '' } });
  assert.equal(clientIp(nothing, { trustProxy: true, header: 'cf-connecting-ip' }), '_anon_');
});

test('clientIpHeader is inert without trustProxy, and under WEBJS_NO_TRUST_PROXY=1', async () => {
  const { clientIp } = await import('../../src/rate-limit.js');
  const req = new Request('http://x/', {
    headers: { 'cf-connecting-ip': '203.0.113.44', 'x-webjs-remote-ip': '100.64.0.3' },
  });
  // Naming a wire header to trust IS the trust decision, so it must not be
  // grantable by a second option that skips the first.
  assert.equal(clientIp(req, { header: 'cf-connecting-ip' }), '100.64.0.3');
  await withNoTrustProxy('1', () => {
    assert.equal(clientIp(req, { trustProxy: true, header: 'cf-connecting-ip' }), '100.64.0.3');
  });
});

test('rateLimit buckets by the named header, not by the CDN egress address', async () => {
  const mw = rateLimit({ window: '1s', max: 1, trustProxy: true, clientIpHeader: 'cf-connecting-ip' });
  // Two requests from ONE visitor that arrive through DIFFERENT CDN egress
  // addresses, which is what a fresh connection produces. They must share a
  // bucket; keyed on XFF they would not, and the visitor would never be limited.
  const first = new Request('http://x/', {
    headers: { 'x-forwarded-for': '172.68.1.9', 'cf-connecting-ip': '203.0.113.44' },
  });
  const second = new Request('http://x/', {
    headers: { 'x-forwarded-for': '172.69.7.2', 'cf-connecting-ip': '203.0.113.44' },
  });
  assert.equal((await mw(first, async () => new Response('ok'))).status, 200);
  assert.equal((await mw(second, async () => new Response('ok'))).status, 429, 'same visitor, second egress');

  // And a genuinely different visitor arriving through the SAME egress keeps
  // their own window, which is the other half of bucketing correctly.
  const other = new Request('http://x/', {
    headers: { 'x-forwarded-for': '172.68.1.9', 'cf-connecting-ip': '198.51.100.7' },
  });
  assert.equal((await mw(other, async () => new Response('ok'))).status, 200);
});
