/**
 * Cross-runtime proof that a BOUNDARY response carries the same keyed
 * children-boundary markers a successful render does (#1298).
 *
 * Runs under WHICHEVER runtime executes it (Bun via the CI `bun` job /
 * `bun test/bun/ssr-boundary-chain.mjs`, Node via the `.test.mjs` wrapper in
 * `npm test`). Sibling of `keyed-boundaries.mjs`, which proves the same
 * emission on the HAPPY path.
 *
 * This is runtime-sensitive surface for the same reason the happy path is, plus
 * one of its own: the boundary render is reached through the SSR dispatch
 * catch, so it rides the throw path (a rejected async render, `isForbidden` /
 * `isNotFound` sentinel identity across module instances) as well as the string
 * path. A runtime divergence in either would leave one runtime emitting a
 * marker-less boundary response, which the client router cannot soft-swap, and
 * nothing on the happy path would show it.
 *
 * Asserts on a real app boot + real GETs:
 *   - a 500 through error.ts carries matched keyed pairs for the layouts at and
 *     above the boundary's segment, and the layouts' own markup
 *   - a 403 through forbidden.ts does the same
 *   - every open marker has exactly one matching close and no id repeats
 *   - the boundary's module is booted and the page's is not
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createRequestHandler } from '@webjsdev/server';

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;
const here = dirname(fileURLToPath(import.meta.url));
// The tmp app has no node_modules, so its modules import core by absolute file
// URL (the same pattern the server unit fixtures and keyed-boundaries.mjs use).
const HTML_URL = pathToFileURL(resolve(here, '../../packages/core/src/html.js')).toString();
const CORE_URL = pathToFileURL(resolve(here, '../../packages/core/index.js')).toString();

/** Markers in DOM order: `{ close, segment }`. */
const markersOf = (html) => [...html.matchAll(/<!--(\/?)wj:children:([^:>]+)(?::([^>]*))?-->/g)]
  .map((m) => ({ close: m[1] === '/', segment: m[2] }));

/** Every open has one close, no id repeats, and the nesting is well formed. */
function assertPaired(html, what) {
  const ms = markersOf(html);
  const opens = ms.filter((m) => !m.close).map((m) => m.segment);
  const closes = ms.filter((m) => m.close).map((m) => m.segment);
  assert.deepEqual([...opens].sort(), [...closes].sort(), `${what}: every open has a close on ${runtime}`);
  assert.equal(new Set(opens).size, opens.length, `${what}: no duplicate segment id on ${runtime}`);
  const stack = [];
  for (const m of ms) {
    if (!m.close) stack.push(m.segment);
    else assert.equal(stack.pop(), m.segment, `${what}: markers nest correctly on ${runtime}`);
  }
  assert.equal(stack.length, 0, `${what}: no marker left open on ${runtime}`);
}

const dir = mkdtempSync(join(tmpdir(), 'webjs-bun-boundary-chain-'));
const prevError = console.error;
try {
  const appDir = join(dir, 'app');
  mkdirSync(join(appDir, 'docs', 'crash'), { recursive: true });
  mkdirSync(join(appDir, 'docs', 'gated'), { recursive: true });
  writeFileSync(join(dir, 'package.json'),
    JSON.stringify({ name: 'fx', type: 'module', imports: { '#*': './*' } }));
  writeFileSync(join(appDir, 'layout.ts'),
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `export default ({ children }: any) => html\`<div id="root-chrome">\${children}</div>\`;\n`);
  writeFileSync(join(appDir, 'docs', 'layout.ts'),
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `export default ({ children }: any) => html\`<div id="docs-chrome">\${children}</div>\`;\n`);
  writeFileSync(join(appDir, 'docs', 'error.ts'),
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `export default ({ error }: any) => html\`<p id="boundary">\${error.message}</p>\`;\n`);
  writeFileSync(join(appDir, 'docs', 'crash', 'page.ts'),
    `export default () => { throw new Error('kaboom'); };\n`);
  writeFileSync(join(appDir, 'docs', 'gated', 'forbidden.ts'),
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `export default () => html\`<p id="fb">no</p>\`;\n`);
  writeFileSync(join(appDir, 'docs', 'gated', 'page.ts'),
    `import { forbidden } from ${JSON.stringify(CORE_URL)};\n` +
    `export default () => { forbidden(); };\n`);

  const h = await createRequestHandler({ appDir: dir, dev: false });
  if (h.warmup) await h.warmup();
  // The 500 path logs the unhandled render error by design; keep the proof's
  // output to its own assertions.
  console.error = () => {};

  // 1. A 500 through the nearest error.ts renders inside its layout chain.
  {
    const res = await h.handle(new Request('http://localhost/docs/crash'));
    assert.equal(res.status, 500, `GET /docs/crash on ${runtime}`);
    const body = await res.text();
    assert.ok(body.includes('id="boundary"'), `the boundary rendered on ${runtime}`);
    assert.ok(body.includes('id="root-chrome"'), `the root layout wraps the boundary on ${runtime}`);
    assert.ok(body.includes('id="docs-chrome"'), `the /docs layout wraps the boundary on ${runtime}`);
    assert.ok(body.includes('<!--wj:children:/:/-->'), `root keyed open on ${runtime}`);
    assert.ok(body.includes('<!--wj:children:/docs:/docs-->'), `/docs keyed open on ${runtime}`);
    assert.ok(body.includes('<!--wj:children:/docs/crash:/docs/crash-->'), `page-region keyed open on ${runtime}`);
    assertPaired(body, '500');
    assert.ok(/import\s+"[^"]*docs\/error\.ts/.test(body), `the boundary module is booted on ${runtime}`);
    assert.ok(!/import\s+"[^"]*docs\/crash\/page\.ts/.test(body), `the page module is NOT booted on ${runtime}`);
  }

  // 2. A 403 through forbidden.ts takes the same path.
  {
    const res = await h.handle(new Request('http://localhost/docs/gated'));
    assert.equal(res.status, 403, `GET /docs/gated on ${runtime}`);
    const body = await res.text();
    assert.ok(body.includes('id="fb"'), `the 403 boundary rendered on ${runtime}`);
    assert.ok(body.includes('id="root-chrome"') && body.includes('id="docs-chrome"'),
      `the 403 renders inside its layout chain on ${runtime}`);
    assertPaired(body, '403');
  }

  console.error = prevError;
  console.log(`[ssr-boundary-chain] OK on ${runtime}`);
} finally {
  console.error = prevError;
  rmSync(dir, { recursive: true, force: true });
}
