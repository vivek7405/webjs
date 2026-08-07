/**
 * Cross-runtime proof that the app-level elision verdict (#1308) is IDENTICAL
 * under whichever runtime runs it:
 *
 *   node test/bun/elision-report.mjs
 *   bun  test/bun/elision-report.mjs
 *
 * WebJs runs on Node 24+ AND Bun (#508), and an app scaffolded with `--runtime
 * bun` runs `webjs elision` against a Bun-served app, so a verdict that drifted
 * between runtimes would mean the report told a Bun author something untrue
 * about their own app. The analysis is filesystem reads plus regular
 * expressions with no runtime-specific API, so there is nothing legitimate to
 * skip and this file carries no DENYLIST entry.
 *
 * The fixture covers one component of each verdict and one route module of each
 * class, so a divergence in ANY of the projection's moving parts (the tag sort,
 * the evidence pick, the path relativization, the summary counts) shows up as a
 * concrete row mismatch rather than a vague count difference. Run from the repo
 * root so `@webjsdev/server` resolves.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { analyzeAppElision } from '@webjsdev/server';

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;
const dir = mkdtempSync(join(tmpdir(), 'webjs-elision-x-'));

const write = (rel, src) => {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, src);
};

try {
  write('package.json', JSON.stringify({ name: 'elision-fixture', type: 'module' }));
  // Display-only: static markup, no events, no props, no hooks, light DOM.
  write('components/badge.js', `
import { WebComponent, html } from '@webjsdev/core';
export class Badge extends WebComponent {
  render() { return html\`<span>verified</span>\`; }
}
Badge.register('my-badge');
`);
  // Interactive: an @event binding is the plainest ship signal there is.
  write('components/counter.js', `
import { WebComponent, html } from '@webjsdev/core';
export class Counter extends WebComponent {
  render() { return html\`<button @click=\${() => {}}>+</button>\`; }
}
Counter.register('my-counter');
`);
  // Inert: its only component is elided, so this page ships nothing.
  write('app/about/page.js', "import { html } from '@webjsdev/core';\nimport '../../components/badge.js';\nexport default () => html`<my-badge></my-badge>`;");
  // Import-only: the page itself does no client work, and the only client work
  // its closure reaches is a shipping component.
  write('app/page.js', "import { html } from '@webjsdev/core';\nimport '../components/counter.js';\nexport default () => html`<my-counter></my-counter>`;");

  const r = await analyzeAppElision(dir);

  assert.equal(r.analysed, true, 'the fixture app must be analysable');
  assert.equal(r.skipped, null);

  // Component rows, exact.
  assert.deepEqual(
    r.components.map((c) => [c.file, c.tags.join(','), c.verdict, c.evidence]),
    [
      ['components/badge.js', 'my-badge', 'elided', null],
      ['components/counter.js', 'my-counter', 'shipped', 'own'],
    ],
    'both the verdicts and their order must match across runtimes',
  );
  assert.match(r.components[1].reason, /@event binding/, 'the ship reason is the analyser\'s own words');
  assert.equal(r.components[0].reason, null, 'an elided component reports no reason');

  // Route-module rows, exact.
  assert.deepEqual(
    r.routeModules.map((m) => [m.file, m.verdict, m.emits.join(',')]),
    [
      ['app/about/page.js', 'inert', ''],
      ['app/page.js', 'import-only', 'components/counter.js'],
    ],
  );

  assert.deepEqual(r.orphans, []);
  assert.deepEqual(r.summary, {
    components: 2, elided: 1, shipped: 1,
    routeModules: 2, inert: 1, importOnly: 1, shippedWhole: 0,
    orphans: 0,
  });

  // Two consumers print this object verbatim, so it must survive a JSON
  // round-trip identically on both runtimes.
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r, 'the report is JSON-serializable');

  console.log(`OK  webjs elision verdict is identical on ${runtime}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
