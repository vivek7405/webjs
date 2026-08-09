/**
 * Integration tests for the secure-by-default response headers plus the
 * per-path header config (issue #232). Exercised through
 * createRequestHandler so they cover the real response pipeline, not the
 * merge function in isolation. Web-standard Request/Response, no real
 * HTTP server.
 *
 * The merge precedence under test, lowest to highest:
 *   secure defaults  <  per-path config (webjs.headers)  <  app middleware
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRequestHandler } from '../../src/dev.js';
import { compileHeaderRules, applySecurityHeaders, webRequestIsHttps } from '../../src/headers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_URL = pathToFileURL(
  resolve(__dirname, '../../../core/src/html.js')
).toString();

let tmpRoot;
before(() => { tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-headers-')); });
after(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

function makeApp(files) {
  const appDir = mkdtempSync(join(tmpRoot, 'app-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(appDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return appDir;
}

function page(body) {
  return (
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `export default function P() { return html\`${body}\`; }\n`
  );
}

/* ------------ secure defaults on document + asset responses ------------ */

test('defaults: a document response carries the secure baseline headers', async () => {
  const appDir = makeApp({ 'app/page.js': page('<h1>home</h1>') });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/'));
  assert.equal(resp.status, 200);
  // COUNTERFACTUAL anchor: revert applySecurityHeaders in handle() and
  // every one of these is null, so this test fails. The headers are not
  // produced anywhere else in the pipeline.
  assert.equal(resp.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(resp.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(resp.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(resp.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
});

test('defaults: a static asset response also carries the baseline headers', async () => {
  const appDir = makeApp({
    'app/page.js': page('<p>ok</p>'),
    'public/hello.txt': 'hello world',
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/public/hello.txt'));
  assert.equal(resp.status, 200);
  assert.equal(resp.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(resp.headers.get('x-frame-options'), 'SAMEORIGIN');
});

/* ------------ HSTS: prod + HTTPS only ------------ */

test('HSTS: present in production over HTTPS (X-Forwarded-Proto: https)', async () => {
  const appDir = makeApp({ 'app/page.js': page('<p>ok</p>') });
  const app = await createRequestHandler({ appDir, dev: false });
  const resp = await app.handle(new Request('http://x/', {
    headers: { 'x-forwarded-proto': 'https' },
  }));
  assert.equal(resp.headers.get('strict-transport-security'),
    'max-age=63072000; includeSubDomains');
});

test('HSTS: absent in dev even over HTTPS', async () => {
  const appDir = makeApp({ 'app/page.js': page('<p>ok</p>') });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/', {
    headers: { 'x-forwarded-proto': 'https' },
  }));
  assert.equal(resp.headers.get('strict-transport-security'), null);
});

test('HSTS: absent in production over plain HTTP', async () => {
  const appDir = makeApp({ 'app/page.js': page('<p>ok</p>') });
  const app = await createRequestHandler({ appDir, dev: false });
  // No X-Forwarded-Proto and an http:// URL: the request is plain HTTP.
  const resp = await app.handle(new Request('http://x/'));
  assert.equal(resp.headers.get('strict-transport-security'), null);
});

test('HSTS: X-Forwarded-Proto is NOT trusted when WEBJS_NO_TRUST_PROXY=1', async () => {
  const appDir = makeApp({ 'app/page.js': page('<p>ok</p>') });
  const prev = process.env.WEBJS_NO_TRUST_PROXY;
  process.env.WEBJS_NO_TRUST_PROXY = '1';
  try {
    const app = await createRequestHandler({ appDir, dev: false });
    const resp = await app.handle(new Request('http://x/', {
      headers: { 'x-forwarded-proto': 'https' },
    }));
    // Header ignored, URL is http -> no HSTS.
    assert.equal(resp.headers.get('strict-transport-security'), null);
  } finally {
    if (prev === undefined) delete process.env.WEBJS_NO_TRUST_PROXY;
    else process.env.WEBJS_NO_TRUST_PROXY = prev;
  }
});

/* ------------ per-path config: webjs.headers ------------ */

test('config: a webjs.headers rule adds a header on a matching path only', async () => {
  const appDir = makeApp({
    'package.json': JSON.stringify({
      name: 'host',
      webjs: {
        headers: [
          { source: '/embed/:path*', headers: [{ key: 'X-Custom', value: 'on' }] },
        ],
      },
    }),
    'app/page.js': page('<p>root</p>'),
    'app/embed/page.js': page('<p>embed</p>'),
  });
  const app = await createRequestHandler({ appDir, dev: true });

  const onMatch = await app.handle(new Request('http://x/embed'));
  assert.equal(onMatch.headers.get('x-custom'), 'on', 'rule applies on the matching path');

  const offMatch = await app.handle(new Request('http://x/'));
  assert.equal(offMatch.headers.get('x-custom'), null, 'rule does not apply off-path');
});

test('config: a rule can OVERRIDE a secure default on a matching path', async () => {
  const appDir = makeApp({
    'package.json': JSON.stringify({
      name: 'host',
      webjs: {
        headers: [
          { source: '/wide', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] },
        ],
      },
    }),
    'app/page.js': page('<p>root</p>'),
    'app/wide/page.js': page('<p>wide</p>'),
  });
  const app = await createRequestHandler({ appDir, dev: true });

  const overridden = await app.handle(new Request('http://x/wide'));
  assert.equal(overridden.headers.get('x-frame-options'), 'DENY', 'config overrides the default value');

  const defaulted = await app.handle(new Request('http://x/'));
  assert.equal(defaulted.headers.get('x-frame-options'), 'SAMEORIGIN', 'other paths keep the default');
});

test('config: a rule with a null value DISABLES a secure default on a path', async () => {
  const appDir = makeApp({
    'package.json': JSON.stringify({
      name: 'host',
      webjs: {
        headers: [
          { source: '/public-embed', headers: [{ key: 'X-Frame-Options', value: null }] },
        ],
      },
    }),
    'app/page.js': page('<p>root</p>'),
    'app/public-embed/page.js': page('<p>embed</p>'),
  });
  const app = await createRequestHandler({ appDir, dev: true });

  const disabled = await app.handle(new Request('http://x/public-embed'));
  assert.equal(disabled.headers.get('x-frame-options'), null, 'the default was removed on this path');
  // nosniff (a default not touched by the rule) is still present.
  assert.equal(disabled.headers.get('x-content-type-options'), 'nosniff');

  const elsewhere = await app.handle(new Request('http://x/'));
  assert.equal(elsewhere.headers.get('x-frame-options'), 'SAMEORIGIN', 'default intact elsewhere');
});

test('config: a malformed directive (CRLF value / bad name) does NOT crash the request', async () => {
  // Regression: an unvalidated directive value containing CR/LF, or an
  // invalid header NAME, made applySecurityHeaders throw on every matching
  // request (a self-inflicted 500). The bad directive must be dropped at
  // compile time, the request still serves 200, and a GOOD sibling
  // directive in the same config still applies.
  const appDir = makeApp({
    'package.json': JSON.stringify({
      name: 'host',
      webjs: {
        headers: [
          {
            source: '/danger',
            headers: [
              { key: 'X-Evil', value: 'a\r\nSet-Cookie: x=1' },  // CRLF value: dropped
              { key: 'X Bad Name', value: 'ok' },                 // invalid name: dropped
              { key: 'X-Good', value: 'kept' },                   // valid: applied
            ],
          },
        ],
      },
    }),
    'app/page.js': page('<p>root</p>'),
    'app/danger/page.js': page('<p>danger</p>'),
  });
  // Handler creation reads the config and warns once per dropped directive;
  // silence that expected noise for a clean test run.
  const prevWarn = console.warn;
  console.warn = () => {};
  let app;
  try {
    app = await createRequestHandler({ appDir, dev: true });
  } finally {
    console.warn = prevWarn;
  }

  const resp = await app.handle(new Request('http://x/danger'));
  assert.equal(resp.status, 200, 'a malformed directive must not crash the request');
  // The CRLF-bearing directive is dropped. (The invalid-NAME directive
  // cannot even be queried via Headers.get, which is exactly why it can
  // never land on the response; its drop is asserted at the
  // compileHeaderRules unit layer.)
  assert.equal(resp.headers.get('x-evil'), null, 'CRLF-bearing directive is dropped');
  // The good sibling directive still applies, and the defaults are intact.
  assert.equal(resp.headers.get('x-good'), 'kept', 'a valid sibling directive still applies');
  assert.equal(resp.headers.get('x-content-type-options'), 'nosniff');
});

/* ------------ precedence: app middleware wins ------------ */

test('precedence: app middleware setting a header wins over the secure default', async () => {
  const appDir = makeApp({
    'app/page.js': page('<p>ok</p>'),
    'middleware.js':
      `export default async function (req, next) {\n` +
      `  const resp = await next();\n` +
      `  const h = new Headers(resp.headers);\n` +
      `  h.set('X-Frame-Options', 'DENY');\n` +
      `  return new Response(resp.body, { status: resp.status, headers: h });\n` +
      `}\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/'));
  assert.equal(resp.headers.get('x-frame-options'), 'DENY',
    'middleware value is not clobbered by the default');
});

test('precedence: app middleware wins over the per-path config too', async () => {
  const appDir = makeApp({
    'package.json': JSON.stringify({
      name: 'host',
      webjs: {
        headers: [
          { source: '/', headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }] },
        ],
      },
    }),
    'app/page.js': page('<p>ok</p>'),
    'middleware.js':
      `export default async function (req, next) {\n` +
      `  const resp = await next();\n` +
      `  const h = new Headers(resp.headers);\n` +
      `  h.set('X-Frame-Options', 'DENY');\n` +
      `  return new Response(resp.body, { status: resp.status, headers: h });\n` +
      `}\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/'));
  assert.equal(resp.headers.get('x-frame-options'), 'DENY',
    'middleware wins even when a path rule targets the same header');
});

/* ------------ unit: compileHeaderRules + applySecurityHeaders + webRequestIsHttps ------------ */

test('compileHeaderRules: every dropped rule and directive warns', () => {
  // These branches all used to `continue` in silence, so a `source` misspelled
  // as `sources` produced no rule and no diagnostic, which is the same typo
  // class the boot config check exists to report. The valid sibling must still
  // compile, since dropping rather than throwing is the whole posture here.
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args[0]);
  let rules;
  try {
    rules = compileHeaderRules({
      webjs: {
        headers: [
          'not-an-object',
          { sources: '/typo', headers: [{ key: 'X', value: '1' }] },
          { source: '/bad-list', headers: 'nope' },
          { source: '/a/(', headers: [{ key: 'X', value: '1' }] },
          { source: '/bad-dir', headers: ['nope', { key: '' }, { key: 'X\nY', value: '1' }] },
          { source: '/ok', headers: [{ key: 'X-Ok', value: '1' }] },
        ],
      },
    });
  } finally {
    console.warn = realWarn;
  }

  assert.equal(rules.length, 1, 'only the valid rule compiles');
  assert.ok(rules[0].pattern.test({ pathname: '/ok' }));
  // Four bad rules, three bad directives inside /bad-dir, and one more for
  // /bad-dir itself, which is dropped once nothing survives its directives.
  assert.equal(warnings.length, 8, `expected 8 warnings, got ${warnings.length}`);
  assert.ok(
    warnings.some((w) => w.includes('no valid directives left on "/bad-dir"')),
    'a rule that loses every directive says the RULE was dropped, not just the directives',
  );
  for (const w of warnings) {
    assert.match(w, /dropping invalid webjs\.headers entry/);
  }
});

test('compileHeaderRules: a wrong-typed headers key warns, an absent one does not', () => {
  // The config LEVEL, above the rule and directive levels the other cases
  // cover. `"headers": {}` discards the whole config, and the schema types the
  // key `array` while the boot check inspects only scalar leaves, so nothing
  // else reports it either. An ABSENT key is the default, not a mistake, and
  // must stay silent or every app without the key warns on every boot.
  const seen = [];
  const realWarn = console.warn;
  console.warn = (...args) => seen.push(args[0]);
  try {
    assert.deepEqual(compileHeaderRules({ webjs: { headers: 'nope' } }), []);
    assert.deepEqual(compileHeaderRules({ webjs: { headers: {} } }), []);
    assert.equal(seen.length, 2, `a wrong-typed key warns, got ${seen.length}`);
    assert.match(seen[0], /headers must be an array/);

    seen.length = 0;
    assert.deepEqual(compileHeaderRules({ webjs: {} }), []);
    assert.deepEqual(compileHeaderRules({}), []);
    assert.deepEqual(compileHeaderRules(null), []);
    assert.deepEqual(seen, [], 'an absent key is the default and says nothing');
  } finally {
    console.warn = realWarn;
  }
});

test('compileHeaderRules: an empty headers array is dropped AND warned about', () => {
  // The gap this file missed the first time. `{ source, headers: [] }` is
  // SCHEMA-VALID (webjs-config.schema.json puts no minItems on headers) and the
  // boot config check never sees it (that check does not descend into headers),
  // so before this warning the rule was dropped with nothing anywhere saying so,
  // which is the exact silent-config failure the warnings exist to end.
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args[0]);
  let rules;
  try {
    rules = compileHeaderRules({
      webjs: {
        headers: [
          { source: '/empty', headers: [] },
          { source: '/ok', headers: [{ key: 'X-Ok', value: '1' }] },
        ],
      },
    });
  } finally {
    console.warn = realWarn;
  }

  assert.equal(rules.length, 1, 'the valid sibling still compiles');
  assert.equal(warnings.length, 1, `expected one warning, got ${warnings.length}`);
  assert.match(warnings[0], /no valid directives left on "\/empty"/);
});

test('compileHeaderRules: ignores a malformed config without throwing', () => {
  assert.deepEqual(compileHeaderRules(null), []);
  assert.deepEqual(compileHeaderRules({}), []);
  assert.deepEqual(compileHeaderRules({ webjs: { headers: 'nope' } }), []);
  // A bad pattern is skipped, a good sibling rule survives.
  const rules = compileHeaderRules({
    webjs: {
      headers: [
        { source: 42, headers: [{ key: 'X', value: '1' }] },           // bad source
        { source: '/ok', headers: [{ key: 'X', value: '1' }] },         // good
        { source: '/no-dirs', headers: 'nope' },                       // bad headers
      ],
    },
  });
  assert.equal(rules.length, 1);
  assert.ok(rules[0].pattern.test({ pathname: '/ok' }));
});

test('compileHeaderRules: drops a directive whose key/value the Headers parser rejects', () => {
  const prevWarn = console.warn;
  console.warn = () => {};
  try {
    const rules = compileHeaderRules({
      webjs: {
        headers: [
          {
            source: '/x',
            headers: [
              { key: 'X-Evil', value: 'a\r\nSet-Cookie: x=1' },  // CRLF value
              { key: 'X Bad Name', value: 'ok' },                 // invalid name
              { key: 'X-Good', value: 'kept' },                   // valid
            ],
          },
        ],
      },
    });
    // The rule survives with ONLY the valid directive.
    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0].directives, [{ key: 'X-Good', value: 'kept' }]);
  } finally {
    console.warn = prevWarn;
  }
});

test('compileHeaderRules: a delete directive (null value) validates only the key', () => {
  const prevWarn = console.warn;
  console.warn = () => {};
  try {
    const rules = compileHeaderRules({
      webjs: {
        headers: [
          {
            source: '/x',
            headers: [
              { key: 'X-Frame-Options', value: null },  // valid delete
              { key: 'Bad Name', value: null },          // invalid name: dropped
            ],
          },
        ],
      },
    });
    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0].directives, [{ key: 'X-Frame-Options', value: null }]);
  } finally {
    console.warn = prevWarn;
  }
});

test('applySecurityHeaders: never overwrites a header already on the response', () => {
  const res = new Response('x', { headers: { 'x-content-type-options': 'custom' } });
  const merged = applySecurityHeaders(res, { pathname: '/', https: false, prod: false });
  assert.equal(merged.headers.get('x-content-type-options'), 'custom');
});

test('webRequestIsHttps: trusts X-Forwarded-Proto, falls back to URL scheme', () => {
  assert.equal(webRequestIsHttps(new Request('http://x/', { headers: { 'x-forwarded-proto': 'https' } })), true);
  assert.equal(webRequestIsHttps(new Request('http://x/', { headers: { 'x-forwarded-proto': 'http' } })), false);
  assert.equal(webRequestIsHttps(new Request('https://x/')), true);
  assert.equal(webRequestIsHttps(new Request('http://x/')), false);
});
