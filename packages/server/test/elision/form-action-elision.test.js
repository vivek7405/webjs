/**
 * A bound form ships NO JavaScript (#1155).
 *
 * This is the property that makes the binding worth having over the `@submit`
 * + `preventDefault` shape it replaces: that shape's event binding is an
 * interactivity signal, so it forced the whole component into the browser to
 * do something a plain HTML form already does. `action=${fn}` is not a signal.
 * The renderer resolves it at SSR and emits ordinary markup, so a page or a
 * component whose only client-relevant content is a bound form stays elided
 * and the form still works.
 *
 * Both halves are asserted together on purpose. "The module was elided" alone
 * would pass just as well if the form had also stopped working, which is
 * exactly the regression worth catching.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRequestHandler } from '../../src/dev.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE = JSON.stringify(
  pathToFileURL(resolve(__dirname, '../../../core/index.js')).toString(),
);

let tmpRoot;
before(() => { tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-form-elision-')); });
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

const ACTION = `'use server';
export async function subscribe(formData) {
  return { success: true, redirect: '/?ok=' + formData.get('email') };
}
`;

/** Render, read the emitted identity, and submit it the way a browser would. */
async function submitFrom(app, html) {
  const id = /name="__webjs_action" value="([^"]*)"/.exec(html);
  assert.ok(id, 'the page must render a bound form');
  return app.handle(new Request('http://x/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin' },
    body: new URLSearchParams({ __webjs_action: id[1], email: 'a@b.com' }).toString(),
  }));
}

test('a page whose only client-relevant content is a bound form ships no JS, and submits', async () => {
  const appDir = makeApp({
    'act.server.js': ACTION,
    'app/page.js': `import { html } from ${CORE};
import { subscribe } from '../act.server.js';
export default () => html\`<form action=\${subscribe}><input name="email"></form>\`;
`,
  });
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();

  const body = await (await app.handle(new Request('http://x/'))).text();
  assert.ok(!body.includes('/page.js'), 'the page module must not be shipped to the browser');
  assert.doesNotMatch(body, /async function subscribe/, 'and the action source must not ship either');

  const res = await submitFrom(app, body);
  assert.equal(res.status, 303, 'the elided page\'s form still submits');
  assert.equal(res.headers.get('location'), '/?ok=a@b.com');
});

test('a component whose only content is a bound form is elided, and its form still submits', async () => {
  // The shape the `@submit` + preventDefault idiom could never have: that
  // binding is an interactivity signal, so the component always shipped.
  const appDir = makeApp({
    'act.server.js': ACTION,
    'components/sub-form.js': `import { html, WebComponent } from ${CORE};
import { subscribe } from '../act.server.js';
class SubForm extends WebComponent({}) {
  render() { return html\`<form action=\${subscribe}><input name="email"></form>\`; }
}
SubForm.register('sub-form');
`,
    'app/page.js': `import { html } from ${CORE};
import '../components/sub-form.js';
export default () => html\`<sub-form></sub-form>\`;
`,
  });
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();

  const body = await (await app.handle(new Request('http://x/'))).text();
  assert.ok(!body.includes('sub-form.js'), 'the component module must not be shipped');
  assert.match(body, /<form/, 'the form is in the SSR output, which is the whole point');

  const res = await submitFrom(app, body);
  assert.equal(res.status, 303, 'the elided component\'s form still submits');
  assert.equal(res.headers.get('location'), '/?ok=a@b.com');
});

test('COUNTERFACTUAL: adding a real interactivity signal ships the component again', async () => {
  // Without this, the two assertions above would pass just as well against an
  // analyser that elided everything, which would prove nothing about the
  // binding specifically.
  const appDir = makeApp({
    'act.server.js': ACTION,
    'components/sub-form.js': `import { html, WebComponent } from ${CORE};
import { subscribe } from '../act.server.js';
class SubForm extends WebComponent({}) {
  render() { return html\`<form action=\${subscribe}><input name="email"><button @click=\${() => {}}>go</button></form>\`; }
}
SubForm.register('sub-form');
`,
    'app/page.js': `import { html } from ${CORE};
import '../components/sub-form.js';
export default () => html\`<sub-form></sub-form>\`;
`,
  });
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();

  const body = await (await app.handle(new Request('http://x/'))).text();
  assert.ok(body.includes('sub-form.js'), 'an @click makes the component ship, as it always did');
});
