/**
 * Cross-runtime SSR action-result seeding test (#472, #529): boot a minimal app
 * whose shipping async component awaits a `'use server'` action during SSR, and
 * assert the resolved result is SEEDED into the page (the `#__webjs-seeds`
 * block) and that a dev render REPORTS its seed counts (#1309), under WHICHEVER
 * runtime executes this file. Run it under both:
 *
 *   node test/bun/seed.mjs
 *   bun  test/bun/seed.mjs
 *
 * Seeding installs differently per runtime (`registerSeedHooks`): Node's
 * `module.registerHooks` load hook, or a `Bun.plugin` `onLoad` on Bun (#529).
 * Both must produce the SAME seed block, so a shipping async component does not
 * re-fetch on hydration on either runtime. A plain assert script (not node:test)
 * so the SAME file runs identically on both; it exits non-zero on failure. Run it
 * from the repo root so the bare `@webjsdev/*` specifiers resolve.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequestHandler, hashFile } from '@webjsdev/server';
import { stringify } from '@webjsdev/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE = pathToFileURL(resolve(__dirname, '../../packages/core/index.js')).toString();
const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;

const dir = mkdtempSync(join(tmpdir(), 'webjs-seed-'));
const w = (rel, body) => { const abs = join(dir, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, body); };
try {
  // Seeding is default-on; an explicit webjs:{} is enough.
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'seed', type: 'module', webjs: {} }));
  w('app/layout.ts', `import { html } from ${JSON.stringify(CORE)};\nexport default ({ children }: { children: unknown }) => html\`<!doctype html><html><head></head><body>\${children}</body></html>\`;\n`);
  w('app/page.ts', `import { html } from ${JSON.stringify(CORE)};\nimport '../components/seeded-thing.ts';\nexport default function Page() { return html\`<main><seeded-thing></seeded-thing></main>\`; }\n`);
  // A `'use server'` action invoked during SSR by the component's async render().
  const actionRel = 'actions/get-thing.server.ts';
  // `getThing` is the enumerated/seeded action. `BRAND` is a destructuring
  // export the facade's regex MISSES, so it exercises the #535 export* catch-all
  // (it must resolve through the facade, not be dropped to undefined) on
  // whichever runtime runs this file.
  w(actionRel, `'use server';\nexport async function getThing(id: number) { return { id, label: 'thing-' + id }; }\nexport const { BRAND } = { BRAND: 'acme-co' };\n`);
  // A SHIPPING async component (a signal + @click make it ship, so the seed
  // matters): its async render() awaits the action, so SSR runs it.
  w('components/seeded-thing.ts', `import { WebComponent, html, signal } from ${JSON.stringify(CORE)};\nimport { getThing } from '../actions/get-thing.server.ts';\nexport class SeededThing extends WebComponent {\n  private bump = signal(0);\n  async render() {\n    const t = await getThing(7);\n    return html\`<p class="lbl">\${t.label}</p><button @click=\${() => this.bump.set(this.bump.get() + 1)}>+</button>\`;\n  }\n}\nSeededThing.register('seeded-thing');\n`);

  const app = await createRequestHandler({ appDir: dir, dev: false });
  if (app.warmup) await app.warmup();

  const res = await app.handle(new Request('http://localhost/'));
  assert.equal(res.status, 200, 'GET / should be 200');
  const htmlOut = await res.text();

  // 1. The SSR rendered the resolved data into the first paint (PE baseline).
  assert.ok(htmlOut.includes('thing-7'), `first paint must contain the resolved action data; got:\n${htmlOut.slice(0, 600)}`);

  // 2. The seed block is emitted with the action result keyed exactly as the
  //    client stub looks it up: hash(actionFile) / fn / stringify(args).
  assert.match(htmlOut, /id="__webjs-seeds"/, 'the SSR seed block must be emitted (seeding active on this runtime)');
  const hash = await hashFile(join(dir, actionRel));
  const argsKey = await stringify([7]);
  const seedKey = `${hash}/getThing/${argsKey}`;
  // The key is JSON-embedded in the block; the HTML-escaping turns `<`/`>`/`&`
  // into unicode escapes but leaves the key chars (`/`, hex, digits) intact.
  const block = htmlOut.match(/id="__webjs-seeds">([\s\S]*?)<\/script>/);
  assert.ok(block, 'seed block present');
  assert.ok(block[1].includes(seedKey), `the seed is keyed for getThing([7]); expected key ${seedKey} in:\n${block[1].slice(0, 400)}`);
  assert.ok(block[1].includes('thing-7'), 'the seed payload carries the resolved value');

  // 3. Fail-open catch-all (#535): a destructuring export the facade's regex
  //    MISSES must still resolve through the `export *`, not be dropped to
  //    undefined. The action module was loaded through the facade during SSR;
  //    re-importing returns that faceted namespace. Without the catch-all,
  //    BRAND is undefined here on both runtimes.
  const actionMod = await import(pathToFileURL(join(dir, actionRel)).toString());
  assert.equal(actionMod.BRAND, 'acme-co', 'a regex-missed export flows through the export* catch-all (fail-open)');
  assert.equal(typeof actionMod.getThing, 'function', 'the enumerated export stays usable');

  // 4. Dev observability (#1309). The COUNT is a direct function of whether the
  //    facade ran, and the facade INSTALLS differently per runtime (Node's
  //    `module.registerHooks` vs a `Bun.plugin` `onLoad`), so a regression on
  //    one runtime otherwise leaves the other green. A Bun-side facade
  //    regression reads `collected=0` here while Node still reads `collected=1`.
  const devApp = await createRequestHandler({ appDir: dir, dev: true });
  if (devApp.warmup) await devApp.warmup();
  const devRes = await devApp.handle(new Request('http://localhost/'));
  assert.equal(devRes.status, 200, 'GET / in dev should be 200');
  assert.equal(
    devRes.headers.get('x-webjs-seed'), 'collected=1, emitted=1',
    `the dev seed header must report one collected and one emitted seed on ${runtime}`,
  );
  const devHtml = await devRes.text();
  assert.match(
    devHtml, /id="__webjs-seeds" data-webjs-dev="ok"/,
    'the dev marker (the client\'s only dev gate) must ride the block on both runtimes',
  );

  console.log(`OK  SSR action seeding emits the seed block + is fail-open on a missed export + reports its dev counts on ${runtime} (#472, #529, #535, #1309)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
