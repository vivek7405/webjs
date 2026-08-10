/**
 * `rateLimit`'s client-IP resolution is identical under Node and Bun (#1389).
 *
 * Why per runtime. The resolution reads the request's headers AND, when no
 * forwarded header applies, the framework-stamped peer, and the two listener
 * shells stamp that peer in DIFFERENT ways: the node:http shell sets the
 * `x-webjs-remote-ip` header on a rebuilt Request, while the Bun shell stamps it
 * out of band through a WeakMap so it does not have to clone one (#756). A
 * resolution change can therefore be correct on one shell and wrong on the
 * other, and the fallback rungs are exactly where that shows.
 *
 * What is pinned, in order of what it protects:
 *
 *   - the NAMED header wins over `X-Forwarded-For`. This is the reported bug:
 *     behind a CDN the leftmost XFF entry is the CDN's egress address, which is
 *     pinned per connection, so a limiter keyed on it hands out one bucket per
 *     connection and refuses nobody.
 *   - a BLANK named header falls through to the peer rather than resolving to
 *     `''`, which would be one bucket shared by every visitor whose proxy sent
 *     the header empty.
 *   - the named header is INERT without `trustProxy`, since naming a wire header
 *     to trust is itself the trust decision.
 *   - the DEFAULT chain is unchanged, so apps that name no header keep the
 *     resolution they already have.
 *
 * A plain assert script (not `*.test.mjs`, so the node:test runner does not
 * double-run it); it exits non-zero on failure. Run from the repo root so the
 * bare `@webjsdev/server` specifier resolves to the workspace package.
 */
import assert from 'node:assert/strict';
import { clientIp, stampRemoteIp } from '@webjsdev/server';

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;

// The header shape a Cloudflare plus Railway deploy really receives: the CDN
// egress in XFF's first position, the visitor in CF-Connecting-IP, and a
// carrier-grade-NAT router address as the socket peer.
const CDN_EGRESS = '172.68.1.9';
const VISITOR = '203.0.113.44';
const PEER = '100.64.0.3';

function cdnRequest(extra = {}) {
  return new Request('http://x/', {
    headers: { 'x-forwarded-for': `${CDN_EGRESS}, ${PEER}`, 'cf-connecting-ip': VISITOR, ...extra },
  });
}

// --- the named header wins ---------------------------------------------------

assert.equal(
  clientIp(cdnRequest(), { trustProxy: true, header: 'cf-connecting-ip' }),
  VISITOR,
  `${runtime}: the named header must resolve to the visitor`,
);

assert.equal(
  clientIp(cdnRequest(), { trustProxy: true }),
  CDN_EGRESS,
  `${runtime}: the default chain must still read XFF leftmost`,
);

// --- the fallback rungs, which is where the two shells differ ----------------

// Peer via the node shell's header. Both runtimes accept this form, since the
// Bun shell's WeakMap is consulted first and simply has no entry here.
const headerStamped = new Request('http://x/', { headers: { 'x-webjs-remote-ip': PEER } });
assert.equal(
  clientIp(headerStamped, { trustProxy: true, header: 'cf-connecting-ip' }),
  PEER,
  `${runtime}: a missing named header falls back to the header-stamped peer`,
);

// Peer via the Bun shell's out-of-band stamp. `stampRemoteIp` is the documented
// embedded-adapter entry point onto the same path.
const oobStamped = stampRemoteIp(new Request('http://x/'), PEER);
assert.equal(
  clientIp(oobStamped, { trustProxy: true, header: 'cf-connecting-ip' }),
  PEER,
  `${runtime}: a missing named header falls back to the out-of-band peer`,
);

const blank = new Request('http://x/', {
  headers: { 'cf-connecting-ip': '   ', 'x-webjs-remote-ip': PEER },
});
assert.equal(
  clientIp(blank, { trustProxy: true, header: 'cf-connecting-ip' }),
  PEER,
  `${runtime}: a blank named header must not become a shared bucket key`,
);

assert.equal(
  clientIp(new Request('http://x/'), { trustProxy: true, header: 'cf-connecting-ip' }),
  '_anon_',
  `${runtime}: nothing to read at all resolves to the anon fallback`,
);

// --- the option cannot grant trust on its own --------------------------------

assert.equal(
  clientIp(cdnRequest({ 'x-webjs-remote-ip': PEER }), { header: 'cf-connecting-ip' }),
  PEER,
  `${runtime}: the named header is inert without trustProxy`,
);

console.log(`[rate-limit-client-ip] ${runtime}: client-IP resolution parity OK`);
