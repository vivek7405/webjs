/**
 * `submitForm` (#1155): submit a bound `<form action=${action}>` the way a
 * browser with JS OFF does.
 *
 * The helper exists because binding an action made the hidden `__webjs_action`
 * field load-bearing: it is what tells the dispatcher WHICH action to run, so a
 * hand-written POST that omits it is not a form submission and is answered 405.
 * Every app test that exercises a no-JS write path would otherwise hand-roll a
 * scrape for it, and getting that wrong does not look like a missing field: the
 * status is 405, an assertion fails, and a surrounding `catch` reports it as a
 * database that was never migrated. Two scaffold-shipped tests failed exactly
 * that way, which is what this helper is for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

import { createRequestHandler } from '../../src/dev.js';
import { submitForm, testRequest } from '../../src/testing.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// A tmpdir app fixture has no node_modules link, so it cannot resolve the bare
// `@webjsdev/core` specifier server-side; SSR `import()`s the page module
// itself. The fixture imports core by absolute file URL instead, which changes
// nothing about the dispatch path under test.
const CORE = JSON.stringify(
  pathToFileURL(resolve(__dirname, '../../../core/index.js')).toString(),
);

async function makeApp() {
  const dir = await mkdtemp(join(tmpdir(), 'webjs-submit-form-'));
  await mkdir(join(dir, 'app/signup'), { recursive: true });
  await mkdir(join(dir, 'app/two'), { recursive: true });
  await mkdir(join(dir, 'app/plain'), { recursive: true });
  await mkdir(join(dir, 'app/tricky'), { recursive: true });
  await mkdir(join(dir, 'modules/acct/actions'), { recursive: true });

  await writeFile(join(dir, 'modules/acct/actions/signup.server.ts'),
    `'use server';
export async function signup(formData) {
  const email = String(formData.get('email') || '');
  if (!email.includes('@')) return { success: false, fieldErrors: { email: 'bad' }, status: 422 };
  return { success: true, redirect: '/welcome' };
}
`);
  await writeFile(join(dir, 'modules/acct/actions/newsletter.server.ts'),
    `'use server';
export async function subscribe(formData) {
  return { success: true, redirect: '/subscribed/' + String(formData.get('list') || '') };
}
`);

  await writeFile(join(dir, 'app/signup/page.ts'),
    `import { html } from ${CORE};
import { signup } from '../../modules/acct/actions/signup.server.ts';
export default ({ actionData }) => html\`<form action=\${signup}>
  <input name="email">
  <p class="err">\${actionData?.fieldErrors?.email ?? ''}</p>
</form>\`;
`);
  // Two bound forms on one page, so the helper has something to disambiguate.
  await writeFile(join(dir, 'app/two/page.ts'),
    `import { html } from ${CORE};
import { signup } from '../../modules/acct/actions/signup.server.ts';
import { subscribe } from '../../modules/acct/actions/newsletter.server.ts';
export default () => html\`
  <form action=\${signup}><input name="email"></form>
  <form action=\${subscribe}><input name="list"></form>
\`;
`);
  // A page whose markup breaks a naive form scan two ways.
  await writeFile(join(dir, 'app/tricky/page.ts'),
    `import { html } from ${CORE};
import { signup } from '../../modules/acct/actions/signup.server.ts';
export default () => html\`
  <div>\${'<!-- <form id="ghost"><input name="__webjs_action" value="ghost/nope"></form> -->'}</div>
  <form data-note="a note ending in </form> text" action=\${signup}><input name="email"></form>
\`;
`);
  await writeFile(join(dir, 'app/plain/page.ts'),
    `import { html } from ${CORE};
export default () => html\`<form action="/elsewhere"><input name="q"></form>\`;
`);
  return dir;
}

/** One app for the whole file; each test only reads or submits. */
let app;
async function handler() {
  if (!app) {
    app = await createRequestHandler({ appDir: await makeApp(), dev: true });
    await app.warmup();
  }
  return app;
}

test('a bound form submits and redirects, with no identity handling in the test', async () => {
  const a = await handler();
  const res = await submitForm(a.handle, '/signup', { email: 'ada@example.com' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/welcome');
});

test('a failure result comes back as the 422 re-render, not a 405', async () => {
  // The 405 is the whole point: it is what a POST without the identity gets,
  // and it is indistinguishable from a broken app to a test that assumed the
  // submission ran.
  const a = await handler();
  const res = await submitForm(a.handle, '/signup', { email: 'not-an-email' });
  assert.equal(res.status, 422);
  assert.match(await res.text(), /bad/);
});

test('a hand-written POST without the identity is the 405 this helper avoids', async () => {
  const a = await handler();
  const res = await testRequest(a.handle, '/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'ada@example.com' }).toString(),
  });
  assert.equal(res.status, 405, 'without the field there is no action to dispatch to');
});

test('opts.match names a form on a page carrying several', async () => {
  const a = await handler();
  const res = await submitForm(a.handle, '/two', { list: 'weekly' }, { match: 'name="list"' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/subscribed/weekly', 'the SECOND form ran');

  const first = await submitForm(a.handle, '/two', { email: 'ada@example.com' }, { match: 'name="email"' });
  assert.equal(first.headers.get('location'), '/welcome', 'and the first is still reachable');
});

test('opts.index picks by position when the forms are otherwise alike', async () => {
  const a = await handler();
  const res = await submitForm(a.handle, '/two', { list: 'daily' }, { index: 1 });
  assert.equal(res.headers.get('location'), '/subscribed/daily');
});

test('an unbound form is reported as unbound, not silently submitted', async () => {
  const a = await handler();
  await assert.rejects(
    () => submitForm(a.handle, '/plain', { q: 'x' }),
    /carries no __webjs_action field/,
  );
});

test('a page with no form at all says so', async () => {
  const a = await handler();
  await assert.rejects(() => submitForm(a.handle, '/welcome', {}), /no <form> found/);
});

test('the form scan ignores a commented-out form and a close tag in an attribute', async () => {
  // Both fail SILENTLY with a bare /<form[\s\S]*?<\/form>/g, which is why they
  // are pinned here rather than left to the happy-path cases above. A commented
  // form shifts `opts.index` onto markup that is not on the page; a `</form>`
  // inside an attribute value ends the match before the identity field, so the
  // helper reports a bound form as unbound.
  const a = await handler();
  const res = await submitForm(a.handle, '/tricky', { email: 'ada@example.com' });
  assert.equal(res.status, 303, 'the real form was found and submitted');
  assert.equal(res.headers.get('location'), '/welcome');

  // index 0 is the REAL first form, not the commented one.
  const byIndex = await submitForm(a.handle, '/tricky', { email: 'ada@example.com' }, { index: 0 });
  assert.equal(byIndex.headers.get('location'), '/welcome');
});
