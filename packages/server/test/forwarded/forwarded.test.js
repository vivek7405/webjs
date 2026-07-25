/**
 * Tests for urlFromRequest: the helper that builds a URL from a Node
 * IncomingMessage while honoring standard reverse-proxy headers.
 *
 * Real-world impact: every webjs app deployed behind a TLS-terminating
 * proxy (Railway, Fly, Render, Vercel, Cloudflare, nginx, Caddy)
 * receives plain HTTP at the container with `X-Forwarded-Proto: https`
 * + `X-Forwarded-Host: your-domain.com` headers. Without honoring
 * those, `ctx.url.origin` returns `http://internal-host` and breaks
 * og:url / og:image meta tags, OAuth callback URLs, and any user code
 * building absolute URLs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlFromRequest, applyForwarded } from '../../src/forwarded.js';

function makeReq(url, headers = {}) {
  return { url, headers };
}

test('urlFromRequest: no proxy headers → http + Host header (current localhost behavior)', () => {
  const u = urlFromRequest(makeReq('/about', { host: 'localhost:3000' }));
  assert.equal(u.href, 'http://localhost:3000/about');
});

test('urlFromRequest: no Host header at all → falls back to localhost', () => {
  const u = urlFromRequest(makeReq('/', {}));
  assert.equal(u.href, 'http://localhost/');
});

test('urlFromRequest: undefined req.url → defaults to "/"', () => {
  const u = urlFromRequest(makeReq(undefined, { host: 'localhost:3000' }));
  assert.equal(u.pathname, '/');
});

test('urlFromRequest: X-Forwarded-Proto=https flips scheme', () => {
  const u = urlFromRequest(makeReq('/docs', {
    host: 'internal-host:3000',
    'x-forwarded-proto': 'https',
  }));
  assert.equal(u.protocol, 'https:');
});

test('urlFromRequest: X-Forwarded-Host overrides Host', () => {
  const u = urlFromRequest(makeReq('/docs', {
    host: 'internal-host:3000',
    'x-forwarded-host': 'docs.webjs.dev',
  }));
  assert.equal(u.host, 'docs.webjs.dev');
});

test('urlFromRequest: both forwarded headers → public origin restored end-to-end (the Railway case)', () => {
  const u = urlFromRequest(makeReq('/docs/getting-started', {
    host: 'webjs-docs.railway.internal:3000',
    'x-forwarded-host': 'docs.webjs.dev',
    'x-forwarded-proto': 'https',
  }));
  assert.equal(u.href, 'https://docs.webjs.dev/docs/getting-started');
  assert.equal(u.origin, 'https://docs.webjs.dev');
});

test('urlFromRequest: comma-separated proxy chain → first entry wins (closest to client)', () => {
  // CDN -> load balancer -> container. The CDN's view (https) is what
  // the browser sent; that's what we want, not the LB's intermediate.
  const u = urlFromRequest(makeReq('/x', {
    host: 'container:3000',
    'x-forwarded-proto': 'https, http',
    'x-forwarded-host': 'docs.webjs.dev, internal.lb',
  }));
  assert.equal(u.protocol, 'https:');
  assert.equal(u.host, 'docs.webjs.dev');
});

test('urlFromRequest: array-valued headers (Node sometimes returns these)', () => {
  // When the same header appears multiple times on the wire, Node's
  // IncomingMessage.headers returns it as an array. Pick the first.
  const u = urlFromRequest(makeReq('/x', {
    host: 'container',
    'x-forwarded-proto': ['https', 'http'],
    'x-forwarded-host': ['docs.webjs.dev', 'internal'],
  }));
  assert.equal(u.protocol, 'https:');
  assert.equal(u.host, 'docs.webjs.dev');
});

test('urlFromRequest: empty forwarded header values fall back to Host + http', () => {
  // Some buggy proxies set the header to empty string. Treat as absent.
  const u = urlFromRequest(makeReq('/', {
    host: 'fallback-host:3000',
    'x-forwarded-proto': '',
    'x-forwarded-host': '',
  }));
  assert.equal(u.protocol, 'http:');
  assert.equal(u.host, 'fallback-host:3000');
});

test('urlFromRequest: WEBJS_NO_TRUST_PROXY=1 disables proxy-header trust entirely', () => {
  const prev = process.env.WEBJS_NO_TRUST_PROXY;
  process.env.WEBJS_NO_TRUST_PROXY = '1';
  try {
    const u = urlFromRequest(makeReq('/x', {
      host: 'real-host:3000',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'attacker.example.com',
    }));
    // Forwarded values are ignored: fall back to Host header + http.
    assert.equal(u.protocol, 'http:');
    assert.equal(u.host, 'real-host:3000');
  } finally {
    if (prev !== undefined) process.env.WEBJS_NO_TRUST_PROXY = prev;
    else delete process.env.WEBJS_NO_TRUST_PROXY;
  }
});

test('urlFromRequest: preserves query string + hash through proxy', () => {
  const u = urlFromRequest(makeReq('/search?q=hello&page=2#results', {
    host: 'container',
    'x-forwarded-host': 'docs.webjs.dev',
    'x-forwarded-proto': 'https',
  }));
  assert.equal(u.href, 'https://docs.webjs.dev/search?q=hello&page=2#results');
});

/**
 * applyForwarded: the web-`Request` counterpart of urlFromRequest, used by the
 * Bun listener shell (#1090). The node shell builds its `Request` from an
 * already-corrected url, so the two entry points must agree for an identical
 * request or the same app behaves differently on Node and Bun.
 */

function webHeaders(h = {}) {
  return new Headers(h);
}

test('applyForwarded: proxy proto + host rewrite the origin', () => {
  const url = new URL('http://container:3000/about');
  const out = applyForwarded(url, webHeaders({
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'webjs.dev',
  }));
  assert.equal(out.href, 'https://webjs.dev/about');
});

test('applyForwarded: proto alone upgrades the scheme, keeping the host', () => {
  // Railway's shape: the Host header already carries the public domain, only
  // the scheme is internal. This is the exact case that shipped an http://
  // og:image on webjs.dev.
  const out = applyForwarded(new URL('http://webjs.dev/'), webHeaders({ 'x-forwarded-proto': 'https' }));
  assert.equal(out.href, 'https://webjs.dev/');
});

test('applyForwarded: no proxy headers returns the SAME instance (hot-path no-op)', () => {
  const url = new URL('http://localhost:5001/');
  const out = applyForwarded(url, webHeaders({}));
  // Identity, not just equality: the Bun shell keys its skip-the-rebuild
  // decision on this, so an app with no proxy does zero extra work.
  assert.equal(out, url);
});

test('applyForwarded: headers that agree with the url return the SAME instance', () => {
  const url = new URL('https://webjs.dev/x');
  const out = applyForwarded(url, webHeaders({
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'webjs.dev',
  }));
  assert.equal(out, url);
});

test('applyForwarded: comma-separated chain takes the value closest to the client', () => {
  // CDN then load balancer then container: Cloudflare in front of Railway is
  // exactly this shape.
  const out = applyForwarded(new URL('http://container/'), webHeaders({
    'x-forwarded-proto': 'https,http',
    'x-forwarded-host': 'webjs.dev, internal.railway',
  }));
  assert.equal(out.href, 'https://webjs.dev/');
});

test('applyForwarded: preserves path, query and hash across the origin swap', () => {
  const out = applyForwarded(new URL('http://container/search?q=hello&page=2#results'), webHeaders({
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'docs.webjs.dev',
  }));
  assert.equal(out.href, 'https://docs.webjs.dev/search?q=hello&page=2#results');
});

test('applyForwarded: WEBJS_NO_TRUST_PROXY=1 ignores the headers', () => {
  const prev = process.env.WEBJS_NO_TRUST_PROXY;
  process.env.WEBJS_NO_TRUST_PROXY = '1';
  try {
    const url = new URL('http://real-host:3000/x');
    const out = applyForwarded(url, webHeaders({
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'attacker.example.com',
    }));
    assert.equal(out, url);
  } finally {
    if (prev !== undefined) process.env.WEBJS_NO_TRUST_PROXY = prev;
    else delete process.env.WEBJS_NO_TRUST_PROXY;
  }
});

test('applyForwarded and urlFromRequest agree for the same request', () => {
  // The parity assertion: whatever the node shell computes from an
  // IncomingMessage, the Bun shell must compute from the web Request.
  const headers = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'webjs.dev' };
  const node = urlFromRequest(makeReq('/a/b?c=1', { host: 'container:3000', ...headers }));
  const bun = applyForwarded(new URL('http://container:3000/a/b?c=1'), webHeaders(headers));
  assert.equal(bun.href, node.href);
});
