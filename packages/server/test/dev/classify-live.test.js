/**
 * #1398 end-to-end on the server side: the dev watcher classifies the changed
 * file and the verdict rides the SSE `reload` frame.
 *
 * Booting the real dev server is the point. The filename only exists inside
 * `startServer`'s `fs.watch` loop, and before this change it was dropped one
 * line later, so a page edit and a component edit were BYTE-IDENTICAL on the
 * wire. That is exactly what these assertions fail on if the filename is ever
 * dropped again: both frames collapse to the same payload and the page test
 * reads `reload`.
 *
 * Denylisted from the Bun matrix alongside its siblings here, which read the
 * port via `server.address()`. `test/bun/dev-morph-verdict.mjs` carries the
 * cross-runtime assertion on the frame itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startServer } from '../../src/dev.js';

const REPO_NODE_MODULES = join(process.cwd(), 'node_modules');

/**
 * A minimal app: a root layout, a page rendering an interactive component, and
 * the component itself. The component must be genuinely interactive (an
 * `@click`), or elision drops it and it never enters the shipped closure.
 *
 * The temp dir gets a `node_modules` symlink back to the repo so the modules'
 * `@webjsdev/core` imports resolve during SSR.
 */
function scaffold() {
  const appDir = mkdtempSync(join(tmpdir(), 'webjs-classify-'));
  symlinkSync(REPO_NODE_MODULES, join(appDir, 'node_modules'), 'dir');
  mkdirSync(join(appDir, 'app'), { recursive: true });
  mkdirSync(join(appDir, 'components'), { recursive: true });
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'site', type: 'module' }));
  writeFileSync(join(appDir, 'app', 'layout.js'), `
import { html } from '@webjsdev/core';
export default function Layout({ children }) {
  return html\`<div><header>MARKER_A</header>\${children}</div>\`;
}
`);
  writeFileSync(join(appDir, 'app', 'page.js'), `
import { html } from '@webjsdev/core';
import '../components/counter.js';
export default function Page() {
  return html\`<main>MARKER_B<my-counter></my-counter></main>\`;
}
`);
  writeFileSync(join(appDir, 'components', 'counter.js'), `
import { WebComponent, html } from '@webjsdev/core';
class Counter extends WebComponent({ count: Number }) {
  constructor() { super(); this.count = 0; }
  render() { return html\`<button @click=\${() => { this.count++; }}>\${this.count}</button>\`; }
}
Counter.register('my-counter');
`);
  return appDir;
}

/** Resolve with the parsed `data:` payload of the FIRST `reload` frame. */
function waitForReloadFrame(port, ms) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { req.destroy(); } catch {} resolve(v); } };
    const req = get({ port, path: '/__webjs/events', headers: { accept: 'text/event-stream' } }, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        const m = /event: reload\ndata: (.*)\n/.exec(buf);
        if (m) finish(m[1]);
      });
    });
    req.on('error', () => finish(null));
    setTimeout(() => finish(null), ms);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Boot, warm the analysis (the classifier is gated on it and fails safe to
 * `reload` while cold), edit `file`, and return the frame's parsed verdict.
 */
async function verdictForEdit(appDir, file, body) {
  const srv = await startServer({ appDir, port: 0, dev: true });
  const port = srv.server.address().port;
  try {
    // A real request forces `ensureReady()` to completion, so the module graph
    // and the elision verdict are live before the edit lands.
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200, 'the fixture app renders');
    await res.text();
    const frame = waitForReloadFrame(port, 6000);
    await sleep(150); // let the SSE stream connect before the edit
    writeFileSync(join(appDir, file), body);
    const data = await frame;
    assert.ok(data, `a reload frame arrived for ${file}`);
    return JSON.parse(data);
  } finally {
    await srv.close();
  }
}

test('a PAGE edit rides a `page` verdict on the SSE frame (#1398)', async () => {
  const appDir = scaffold();
  const v = await verdictForEdit(appDir, 'app/page.js', `
import { html } from '@webjsdev/core';
import '../components/counter.js';
export default function Page() {
  return html\`<main>MARKER_B_EDITED<my-counter></my-counter></main>\`;
}
`);
  assert.equal(v.v, 'page');
  assert.equal(v.by, 'app/page.js', 'the frame names the file that produced the verdict');
  assert.equal(v.why, 'page-module');
});

// The counterfactual. If the filename is dropped in the watcher again, or the
// shipped closure is derived from the wrong set, this frame is identical to the
// one above and the assertion fails.
test('a COMPONENT edit rides a `reload` verdict, never a morph', async () => {
  const appDir = scaffold();
  const v = await verdictForEdit(appDir, 'components/counter.js', `
import { WebComponent, html } from '@webjsdev/core';
class Counter extends WebComponent({ count: Number }) {
  constructor() { super(); this.count = 0; }
  render() { return html\`<button @click=\${() => { this.count += 2; }}>\${this.count}</button>\`; }
}
Counter.register('my-counter');
`);
  assert.equal(v.v, 'reload');
  assert.equal(v.why, 'ships-to-browser');
});

// THE burst regression. A rebuild invalidates the lazy analysis, and nothing
// re-warms it until an HTTP request arrives, which the relay defers by its
// 2000ms quiet window (#1397) while the measured inter-save gap is about a
// second. So gating the classifier on "the analysis is CURRENT" turned the
// feature off for every edit after the first in a burst: the second save
// classified `analysis-cold` and the strongest-verdict rule collapsed the whole
// batch to a full reload. It is gated on "the sets are POPULATED" instead.
//
// Every other case here warms with a fetch before its single edit, so none of
// them can see this; the second edit has to land with no request in between.
test('a SECOND edit with no request in between still classifies (the burst case)', async () => {
  const appDir = scaffold();
  const srv = await startServer({ appDir, port: 0, dev: true });
  const port = srv.server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    await res.text();

    const first = waitForReloadFrame(port, 6000);
    await sleep(150);
    writeFileSync(join(appDir, 'app/page.js'), `
import { html } from '@webjsdev/core';
import '../components/counter.js';
export default function Page() {
  return html\`<main>EDIT_ONE<my-counter></my-counter></main>\`;
}
`);
    assert.equal(JSON.parse(await first).v, 'page', 'the first edit classifies');

    // No fetch here on purpose: this is what a burst looks like.
    const second = waitForReloadFrame(port, 6000);
    await sleep(150);
    writeFileSync(join(appDir, 'app/page.js'), `
import { html } from '@webjsdev/core';
import '../components/counter.js';
export default function Page() {
  return html\`<main>EDIT_TWO<my-counter></my-counter></main>\`;
}
`);
    const v = JSON.parse(await second);
    assert.equal(v.v, 'page', 'and so does the second, against the previous build\'s graph');
    assert.equal(v.why, 'page-module', 'rather than falling back to analysis-cold');
  } finally {
    await srv.close();
  }
});

test('a LAYOUT edit rides a `shell` verdict, because its own markup is outside every children range', async () => {
  const appDir = scaffold();
  const v = await verdictForEdit(appDir, 'app/layout.js', `
import { html } from '@webjsdev/core';
export default function Layout({ children }) {
  return html\`<div><header>MARKER_A_EDITED</header>\${children}</div>\`;
}
`);
  assert.equal(v.v, 'shell');
});
