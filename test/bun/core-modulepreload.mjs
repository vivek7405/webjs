/**
 * Cross-runtime proof that the core-runtime `modulepreload` hint (#1118) is
 * emitted identically on Node and Bun. WebJs runs on Node 24+ OR Bun, and this
 * hint is rendered by `packages/server/src/ssr.js`, which the Bun-parity gate
 * treats as runtime-sensitive: the served head is assembled there, and the
 * href is read out of the importmap the same builder feeds the page.
 *
 * The correctness condition is byte-identity between the hint's href and the
 * importmap target. A divergence does not break the page, it silently makes the
 * browser treat the preload and the import as two resources and fetch the
 * runtime TWICE, so a runtime that composed the url differently (a path join, a
 * base-path prefix, a `?v=` content hash) would cost every visitor a duplicate
 * download with no visible symptom. Run from the repo root:
 *
 *   node test/bun/core-modulepreload.mjs
 *   bun  test/bun/core-modulepreload.mjs
 *
 * Asserts, on whichever runtime executes it: a page that ships a boot module
 * carries exactly one core modulepreload whose href equals the importmap
 * target byte for byte and which is emitted ahead of the app module hints, and
 * a fully elided page that ships no boot module carries none.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRequestHandler } from '../../packages/server/src/dev.js';

const runtime = typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node';
const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_SRC = resolve(__dirname, '../../packages/core/src');
const HTML_URL = pathToFileURL(join(CORE_SRC, 'html.js')).toString();
const COMPONENT_URL = pathToFileURL(join(CORE_SRC, 'component.js')).toString();

const root = mkdtempSync(join(tmpdir(), 'webjs-core-preload-bun-'));

/** @param {string} html */
function modulepreloadLinks(html) {
  return [...html.matchAll(/<link rel="modulepreload"[^>]*>/g)].map((m) => m[0]);
}

/** @param {string} html */
function coreTarget(html) {
  const m = html.match(/<script type="importmap"[^>]*>([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]).imports['@webjsdev/core'] || null : null;
}

/** Build a one-route app and return its served home HTML. */
async function renderHome(name, pageSource, extra = {}) {
  const appDir = join(root, name);
  mkdirSync(join(appDir, 'app'), { recursive: true });
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }));
  writeFileSync(
    join(appDir, 'app', 'layout.js'),
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `export default ({ children }) => html\`<main>\${children}</main>\`;\n`,
  );
  for (const [rel, body] of Object.entries(extra)) {
    const abs = join(appDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  writeFileSync(join(appDir, 'app', 'page.js'), pageSource);
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();
  return await (await app.handle(new Request('http://x/'))).text();
}

// 1. A page that ships a boot module carries the hint, and its href is EXACTLY
// the importmap target. This is the whole correctness condition.
const shipped = await renderHome(
  'ships',
  `import { html } from ${JSON.stringify(HTML_URL)};\n` +
  `import './widget.js';\n` +
  `export default () => html\`<x-widget></x-widget>\`;\n`,
  {
    'app/widget.js':
      `import { WebComponent } from ${JSON.stringify(COMPONENT_URL)};\n` +
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export class XWidget extends WebComponent {\n` +
      `  render() { return html\`<button @click=\${() => {}}>hi</button>\`; }\n` +
      `}\n` +
      `XWidget.register('x-widget');\n`,
  },
);

const target = coreTarget(shipped);
assert.ok(target, `${runtime}: @webjsdev/core must be in the served importmap`);

const links = modulepreloadLinks(shipped);
const hints = links.filter((l) => l.includes(`href="${target}"`));
assert.equal(hints.length, 1, `${runtime}: exactly one core modulepreload, href === the importmap target`);

// 2. Emitted FIRST, ahead of the page/component hints: every one of them imports
// core, so hinting it later would not remove the round trip it exists to remove.
assert.ok(
  links[0].includes(`href="${target}"`),
  `${runtime}: the core hint must lead the preload run, got ${links[0]}`,
);

// 3. A fully elided page ships no boot module, so it must not be handed a
// preload for a runtime it never loads (the #780 no-over-fetch rule, which is
// also what keeps the hint off a verbatim `global-error` document).
const elided = await renderHome(
  'elided',
  `import { html } from ${JSON.stringify(HTML_URL)};\n` +
  `export default () => html\`<main>static</main>\`;\n`,
);
assert.ok(!/<script type="module"/.test(elided), `${runtime}: the elided page must ship no boot script`);
const elidedTarget = coreTarget(elided);
assert.ok(
  !modulepreloadLinks(elided).some((l) => elidedTarget && l.includes(`href="${elidedTarget}"`)),
  `${runtime}: a page that never loads core must not preload it`,
);

// Clean up the fixture, matching every sibling in this directory. Both `npm
// test` and the Bun CI step run this file, so leaking would strand a
// `webjs-core-preload-bun-*` directory in the temp dir on every single run.
rmSync(root, { recursive: true, force: true });

console.log(`[core-modulepreload] ok on ${runtime}`);
