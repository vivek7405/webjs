/**
 * Integration tests for the form-submission dispatcher (#1155): a
 * `<form action=${importedAction}>` renders a plain HTML form that posts to the
 * page's own url, and the `__webjs_action` hidden field names the server action
 * to run.
 *
 *   - invalid submit  => re-renders the SAME page (422) with field errors and
 *                        the submitted values preserved in the HTML.
 *   - valid submit    => 303 See Other to the PRG target (page's own path, or
 *                        the action's `redirect`).
 *   - no identity     => a non-GET to a page that binds nothing is a 405.
 *   - thrown redirect()/notFound()/forbidden()/unauthorized() are honored.
 *   - the action's declared `validate` / `middleware` / `invalidates` run here
 *     too, so an action cannot be protected over RPC and open over a form.
 *
 * Every test SCRAPES the identity out of the rendered page rather than
 * computing it. That is the point: it proves the renderer and the dispatcher
 * agree on the identity scheme, which two independently-correct halves could
 * easily not.
 *
 * Exercised through `createRequestHandler` against a tmpdir app fixture, using
 * Web-standard Request/Response (no real HTTP server).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRequestHandler } from '../../src/dev.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// A tmpdir app fixture cannot resolve the bare `@webjsdev/core` specifier
// server-side (no node_modules link). The browser path resolves it via the
// importmap, but SSR `import()`s the page module itself, so the fixture imports
// core from its absolute file URL. The runtime routing under test is unaffected.
const CORE = JSON.stringify(
  pathToFileURL(resolve(__dirname, '../../../core/index.js')).toString(),
);

let tmpRoot;
before(() => { tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-form-dispatch-')); });
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

/** Pull the rendered hidden identity field out of a page's HTML. */
function identityOf(html) {
  const m = /name="__webjs_action" value="([^"]*)"/.exec(html);
  return m ? m[1] : null;
}

/** An urlencoded form body. */
function form(fields) {
  const fd = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: fd.toString(),
  };
}

/**
 * Render the page, read the identity the renderer emitted, and submit it back
 * the way a browser would.
 */
async function submit(app, path, fields) {
  const page = await app.handle(new Request(`http://x${path}`));
  const id = identityOf(await page.text());
  assert.ok(id, `the page at ${path} must render a bound form`);
  return app.handle(new Request(`http://x${path}`, form({ ...fields, __webjs_action: id })));
}

// A signup-style page bound to a module action. Validates email; on failure
// returns fieldErrors + values (re-render with errors), on success redirects.
const SIGNUP_ACTION = `
'use server';
export async function signup(formData) {
  const email = String(formData.get('email') || '').trim();
  if (!email.includes('@')) {
    return {
      success: false,
      fieldErrors: { email: 'Enter a valid email' },
      values: { email },
      status: 422,
    };
  }
  return { success: true, redirect: '/welcome' };
}
`;
const SIGNUP_PAGE = `
import { html } from ${CORE};
import { signup } from '../../modules/signup/actions/signup.server.ts';
export default function Signup({ actionData }) {
  const err = actionData?.fieldErrors?.email || actionData?.error;
  const val = actionData?.values?.email || '';
  return html\`
    <form action=\${signup}>
      <input name="email" value="\${val}">
      \${err ? html\`<p class="error">\${err}</p>\` : ''}
      <button>Sign up</button>
    </form>
  \`;
}
`;
const SIGNUP_APP = {
  'modules/signup/actions/signup.server.ts': SIGNUP_ACTION,
  'app/signup/page.ts': SIGNUP_PAGE,
};

test('the rendered form carries an identity and no action attribute', async () => {
  const app = await createRequestHandler({ appDir: makeApp(SIGNUP_APP), dev: true });
  await app.warmup();

  const body = await (await app.handle(new Request('http://x/signup'))).text();
  assert.match(body, /<input type="hidden" name="__webjs_action" value="[0-9a-f]{10}\/signup">/);
  assert.match(body, /<form[^>]*method="post"/);
  assert.doesNotMatch(body, /<form[^>]*\saction=/, 'the form posts to its own url');
  assert.doesNotMatch(body, /async function signup/, 'the action source never ships');
});

test('POST with invalid data re-renders the page (422) with errors + preserved values', async () => {
  const app = await createRequestHandler({ appDir: makeApp(SIGNUP_APP), dev: true });
  await app.warmup();

  const resp = await submit(app, '/signup', { email: 'not-an-email' });
  assert.equal(resp.status, 422, 'failed action re-renders with 422');
  assert.ok((resp.headers.get('content-type') || '').includes('text/html'));
  const body = await resp.text();
  assert.match(body, /Enter a valid email/, 'field error rendered');
  assert.match(body, /value="not-an-email"/, 'submitted value repopulated');
});

test('POST with valid data returns 303 to the PRG target', async () => {
  const app = await createRequestHandler({ appDir: makeApp(SIGNUP_APP), dev: true });
  await app.warmup();

  const resp = await submit(app, '/signup', { email: 'a@b.com' });
  assert.equal(resp.status, 303, 'success PRG-redirects');
  assert.equal(resp.headers.get('location'), '/welcome');
});

test('the identity field is not visible to the action', async () => {
  // It is framework wire, not app data. An action that iterates the FormData
  // (building a record, echoing values into a 422 re-render) must not see a key
  // it did not put there.
  const app = await createRequestHandler({
    appDir: makeApp({
      'modules/echo/actions/echo.server.ts': `
'use server';
export async function echo(formData) {
  return { success: false, error: [...formData.keys()].join(',') };
}
`,
      'app/echo/page.ts': `
import { html } from ${CORE};
import { echo } from '../../modules/echo/actions/echo.server.ts';
export default ({ actionData }) => html\`<form action=\${echo}><p class="k">\${actionData?.error ?? ''}</p></form>\`;
`,
    }),
    dev: true,
  });
  await app.warmup();

  const body = await (await submit(app, '/echo', { a: '1', b: '2' })).text();
  assert.match(body, /<p class="k">a,b<\/p>/, 'the action sees only the fields the author wrote');
});

test('success result without an explicit redirect PRGs to the page own path', async () => {
  const app = await createRequestHandler({
    appDir: makeApp({
      'modules/save/actions/save.server.ts': `'use server';\nexport async function save() { return { success: true }; }\n`,
      'app/save/page.ts': `
import { html } from ${CORE};
import { save } from '../../modules/save/actions/save.server.ts';
export default () => html\`<form action=\${save}><p>ok</p></form>\`;
`,
    }),
    dev: true,
  });
  await app.warmup();

  const resp = await submit(app, '/save', { x: '1' });
  assert.equal(resp.status, 303);
  assert.equal(resp.headers.get('location'), '/save');
});

test('a page that binds no action answers 405 on POST, not 404', async () => {
  // The path exists and renders; the method is what is wrong. Under the page
  // `action` export this was a 404, which said the url did not exist.
  const app = await createRequestHandler({
    appDir: makeApp({
      'app/info/page.ts': `import { html } from ${CORE};\nexport default () => html\`<p>read-only</p>\`;\n`,
    }),
    dev: true,
  });
  await app.warmup();

  assert.equal((await app.handle(new Request('http://x/info'))).status, 200);

  const post = await app.handle(new Request('http://x/info', form({ x: '1' })));
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('a non-form POST to a page is 405 without the body being read', async () => {
  const app = await createRequestHandler({
    appDir: makeApp(SIGNUP_APP),
    dev: true,
  });
  await app.warmup();

  const resp = await app.handle(new Request('http://x/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"email":"a@b.com"}',
  }));
  assert.equal(resp.status, 405);
});

test('an identity whose hash no longer resolves re-renders with a resubmit message', async () => {
  // Deploy skew: a form held open across a deploy submits a hash the new build
  // has never seen. A 404 would lose everything typed, and a silent no-op would
  // show success for a write that did not happen.
  const app = await createRequestHandler({ appDir: makeApp(SIGNUP_APP), dev: true });
  await app.warmup();

  const resp = await app.handle(new Request('http://x/signup', form({
    email: 'a@b.com',
    __webjs_action: 'deadbeef00/signup',
  })));
  assert.equal(resp.status, 422, 'never a silent no-op');
  const body = await resp.text();
  assert.match(body, /This page was updated/, 'the message reaches the page on actionData');
  assert.match(body, /value="a@b\.com"/, 'and what was typed survives the round trip');
});

test('an identity naming a function the file does not export is a 404', async () => {
  // Distinct from skew: that file exists, so the deploy is current and the
  // identity is simply wrong. Re-rendering with "please resubmit" would send a
  // user round a loop that can never succeed.
  const app = await createRequestHandler({ appDir: makeApp(SIGNUP_APP), dev: true });
  await app.warmup();

  const page = await (await app.handle(new Request('http://x/signup'))).text();
  const hash = identityOf(page).split('/')[0];
  const resp = await app.handle(new Request('http://x/signup', form({
    __webjs_action: `${hash}/notARealExport`,
  })));
  assert.equal(resp.status, 404);
});

test('a forged identity naming a reserved config export is a 404', async () => {
  // `validate` is a function export, so without the reserved-name check a
  // crafted field would invoke it directly as though it were the action.
  const app = await createRequestHandler({
    appDir: makeApp({
      'modules/v/actions/v.server.ts': `
'use server';
export const validate = (fd) => ({ success: true, data: fd });
export async function saveIt(formData) { return { success: true, redirect: '/ok' }; }
`,
      'app/v/page.ts': `
import { html } from ${CORE};
import { saveIt } from '../../modules/v/actions/v.server.ts';
export default () => html\`<form action=\${saveIt}></form>\`;
`,
    }),
    dev: true,
  });
  await app.warmup();

  const page = await (await app.handle(new Request('http://x/v'))).text();
  const hash = identityOf(page).split('/')[0];
  const resp = await app.handle(new Request('http://x/v', form({ __webjs_action: `${hash}/validate` })));
  assert.equal(resp.status, 404);
});

test('a cross-origin submission is refused', async () => {
  // The page `action` export had no origin check at all and was shielded only
  // by SameSite=Lax cookies. The dispatcher applies the same check the RPC
  // endpoint does.
  const app = await createRequestHandler({ appDir: makeApp(SIGNUP_APP), dev: true });
  await app.warmup();

  const page = await (await app.handle(new Request('http://x/signup'))).text();
  const resp = await app.handle(new Request('http://x/signup', {
    ...form({ email: 'a@b.com', __webjs_action: identityOf(page) }),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'sec-fetch-site': 'cross-site',
      origin: 'https://evil.example.com',
    },
  }));
  assert.equal(resp.status, 403);
});

test('a same-origin submission with fetch metadata is allowed', async () => {
  // The counterfactual for the check above: a guard that refused everything
  // would satisfy it just as well.
  const app = await createRequestHandler({ appDir: makeApp(SIGNUP_APP), dev: true });
  await app.warmup();

  const page = await (await app.handle(new Request('http://x/signup'))).text();
  const resp = await app.handle(new Request('http://x/signup', {
    ...form({ email: 'a@b.com', __webjs_action: identityOf(page) }),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'sec-fetch-site': 'same-origin',
      origin: 'http://x',
    },
  }));
  assert.equal(resp.status, 303);
});

test("the action's declared validate runs on the form path", async () => {
  // Not running it would mean an action validated over RPC and unvalidated over
  // a form, which is a privilege gap rather than a missing feature.
  const app = await createRequestHandler({
    appDir: makeApp({
      'modules/val/actions/val.server.ts': `
'use server';
export const validate = (formData) => {
  const name = String(formData.get('name') || '');
  if (!name) return { success: false, fieldErrors: { name: 'Required' } };
  return { success: true, data: { name: name.toUpperCase() } };
};
export async function saveName(input) {
  return { success: false, error: 'got:' + input.name };
}
`,
      'app/val/page.ts': `
import { html } from ${CORE};
import { saveName } from '../../modules/val/actions/val.server.ts';
export default ({ actionData }) => html\`<form action=\${saveName}><p class="out">\${actionData?.error ?? actionData?.fieldErrors?.name ?? ''}</p></form>\`;
`,
    }),
    dev: true,
  });
  await app.warmup();

  const bad = await submit(app, '/val', {});
  assert.equal(bad.status, 422, 'a rejecting validator stops the action');
  assert.match(await bad.text(), /Required/);

  const good = await submit(app, '/val', { name: 'ada' });
  assert.match(await good.text(), /got:ADA/, "the validator's transform is what the action receives");
});

test("the action's declared middleware runs on the form path", async () => {
  const app = await createRequestHandler({
    appDir: makeApp({
      'modules/mw/actions/mw.server.ts': `
'use server';
export const middleware = [
  async (ctx, next) => ({ success: false, error: 'denied' }),
];
export async function guarded() { return { success: true, redirect: '/never' }; }
`,
      'app/mw/page.ts': `
import { html } from ${CORE};
import { guarded } from '../../modules/mw/actions/mw.server.ts';
export default ({ actionData }) => html\`<form action=\${guarded}><p class="out">\${actionData?.error ?? ''}</p></form>\`;
`,
    }),
    dev: true,
  });
  await app.warmup();

  const resp = await submit(app, '/mw', {});
  assert.equal(resp.status, 422, 'a short-circuiting middleware is a failure result');
  assert.match(await resp.text(), /denied/);
});

test("an action declaring method = 'GET' cannot be a form target", async () => {
  // A GET action is CSRF-exempt and rides its args in the url, so binding one
  // to a POST form is a contradiction. `webjs check` catches it at edit time;
  // this is the runtime backstop.
  const app = await createRequestHandler({
    appDir: makeApp({
      'modules/rd/actions/rd.server.ts': `
'use server';
export const method = 'GET';
export async function readIt() { return { success: true }; }
`,
      'app/rd/page.ts': `
import { html } from ${CORE};
import { readIt } from '../../modules/rd/actions/rd.server.ts';
export default () => html\`<form action=\${readIt}></form>\`;
`,
    }),
    dev: true,
  });
  await app.warmup();

  const resp = await submit(app, '/rd', {});
  assert.equal(resp.status, 405);
});

test('action that throws redirect() defaults to 307 (method-preserving, not PRG 303)', async () => {
  // A submission is a POST, so a thrown redirect with no explicit status
  // defaults to the method-preserving 307 here, deliberately NOT the GET gate's
  // 302. The PRG success path (303) is separate. #452.
  const app = await createRequestHandler({
    appDir: makeApp({
      'modules/gate/actions/gate.server.ts': `'use server';\nimport { redirect } from ${CORE};\nexport async function gate() { redirect('/login'); }\n`,
      'app/gate/page.ts': `
import { html } from ${CORE};
import { gate } from '../../modules/gate/actions/gate.server.ts';
export default () => html\`<form action=\${gate}></form>\`;
`,
    }),
    dev: true,
  });
  await app.warmup();

  const resp = await submit(app, '/gate', {});
  assert.equal(resp.status, 307, 'thrown action redirect defaults to 307');
  assert.equal(resp.headers.get('location'), '/login');
});

test('a thrown redirect with an explicit status overrides the 307 default', async () => {
  const app = await createRequestHandler({
    appDir: makeApp({
      'modules/g2/actions/g2.server.ts': `'use server';\nimport { redirect } from ${CORE};\nexport async function g2() { redirect('/done', 303); }\n`,
      'app/gate2/page.ts': `
import { html } from ${CORE};
import { g2 } from '../../modules/g2/actions/g2.server.ts';
export default () => html\`<form action=\${g2}></form>\`;
`,
    }),
    dev: true,
  });
  await app.warmup();

  const resp = await submit(app, '/gate2', {});
  assert.equal(resp.status, 303, 'explicit status wins');
  assert.equal(resp.headers.get('location'), '/done');
});

test('a redirect thrown during the FAILED-action re-render returns 302 (GET-shaped)', async () => {
  // A failed action re-renders the SAME page through ssrPage (a GET-shaped page
  // render at 422). If THAT render throws a gate redirect, it resolves via the
  // ssr.js catch site, so it gets the GET-gate 302 default, not the action 307.
  // This pins that the re-render is treated as a page render. #452.
  const app = await createRequestHandler({
    appDir: makeApp({
      'modules/rg/actions/rg.server.ts': `'use server';\nexport async function rg() { return { success: false, error: 'nope' }; }\n`,
      'app/regate/page.ts': `
import { html, redirect } from ${CORE};
import { rg } from '../../modules/rg/actions/rg.server.ts';
export default ({ actionData }) => {
  if (actionData) redirect('/login');
  return html\`<form action=\${rg}></form>\`;
};
`,
    }),
    dev: true,
  });
  await app.warmup();

  const resp = await submit(app, '/regate', {});
  assert.equal(resp.status, 302, 're-render gate redirect uses the GET 302 default');
  assert.equal(resp.headers.get('location'), '/login');
});

test('action that throws notFound() yields 404', async () => {
  const app = await createRequestHandler({
    appDir: makeApp({
      'modules/nf/actions/nf.server.ts': `'use server';\nimport { notFound } from ${CORE};\nexport async function nf() { notFound(); }\n`,
      'app/missing/page.ts': `
import { html } from ${CORE};
import { nf } from '../../modules/nf/actions/nf.server.ts';
export default () => html\`<form action=\${nf}></form>\`;
`,
    }),
    dev: true,
  });
  await app.warmup();

  assert.equal((await submit(app, '/missing', {})).status, 404);
});

test('GET render is unchanged: no actionData, status 200', async () => {
  const app = await createRequestHandler({ appDir: makeApp(SIGNUP_APP), dev: true });
  await app.warmup();

  const resp = await app.handle(new Request('http://x/signup'));
  assert.equal(resp.status, 200);
  const body = await resp.text();
  assert.doesNotMatch(body, /Enter a valid email/, 'no error block on a plain GET');
  assert.match(body, /value=""/, 'empty input on a plain GET');
});

test('OPEN-REDIRECT GUARD: a cross-origin result.redirect is NOT honored', async () => {
  // A user-controlled `result.redirect` must be restricted to a same-site local
  // path. An absolute `scheme://host` (or protocol-relative `//host`) target is
  // dropped and the PRG falls back to the page's own path, so a poisoned action
  // result cannot become an open redirect.
  const app = await createRequestHandler({
    appDir: makeApp({
      'modules/go/actions/go.server.ts': `
'use server';
export async function go(formData) {
  return { success: true, redirect: String(formData.get('next') || '') };
}
`,
      'app/go/page.ts': `
import { html } from ${CORE};
import { go } from '../../modules/go/actions/go.server.ts';
export default () => html\`<form action=\${go}><p>ok</p></form>\`;
`,
    }),
    dev: true,
  });
  await app.warmup();

  const evil = await submit(app, '/go', { next: 'https://evil.example.com/phish' });
  assert.equal(evil.status, 303);
  assert.equal(evil.headers.get('location'), '/go', 'cross-origin redirect must be ignored');

  const protoRel = await submit(app, '/go', { next: '//evil.example.com/phish' });
  assert.equal(protoRel.headers.get('location'), '/go', 'protocol-relative redirect must be ignored');

  const backslash = await submit(app, '/go', { next: '/\\evil.example.com' });
  assert.equal(backslash.headers.get('location'), '/go', 'backslash-prefixed redirect must be ignored');

  const ok = await submit(app, '/go', { next: '/dashboard?tab=1' });
  assert.equal(ok.headers.get('location'), '/dashboard?tab=1', 'same-site local path is honored');
});

test('ROBUST FAILURE: a { error } result without success:false re-renders, not redirects', async () => {
  // Failure detection must not require a literal `success: false`. An action
  // that returns `{ error, status }` (or `{ fieldErrors }`) WITHOUT it is still
  // a failure and re-renders the page, rather than swallowing the error and
  // PRG-redirecting.
  const app = await createRequestHandler({
    appDir: makeApp({
      'modules/er/actions/er.server.ts': `'use server';\nexport async function er() { return { error: 'Something went wrong', status: 400 }; }\n`,
      'app/err/page.ts': `
import { html } from ${CORE};
import { er } from '../../modules/er/actions/er.server.ts';
export default ({ actionData }) => html\`<form action=\${er}><p class="err">\${actionData?.error || 'no-error'}</p></form>\`;
`,
    }),
    dev: true,
  });
  await app.warmup();

  const resp = await submit(app, '/err', { x: '1' });
  assert.equal(resp.status, 400, 'error-only result re-renders with its status, not a 303');
  assert.match(await resp.text(), /Something went wrong/, 'the error is surfaced on the re-render');

  const app2 = await createRequestHandler({
    appDir: makeApp({
      'modules/fe/actions/fe.server.ts': `'use server';\nexport async function fe() { return { fieldErrors: { name: 'Required' }, values: { name: '' } }; }\n`,
      'app/fe/page.ts': `
import { html } from ${CORE};
import { fe } from '../../modules/fe/actions/fe.server.ts';
export default ({ actionData }) => html\`<form action=\${fe}><p class="fe">\${actionData?.fieldErrors?.name || 'none'}</p></form>\`;
`,
    }),
    dev: true,
  });
  await app2.warmup();
  const resp2 = await submit(app2, '/fe', { x: '1' });
  assert.equal(resp2.status, 422, 'fieldErrors-only result re-renders with 422');
  assert.match(await resp2.text(), /Required/, 'field error surfaced');
});

test('segment middleware wraps the form dispatch', async () => {
  const app = await createRequestHandler({
    appDir: makeApp({
      'modules/ad/actions/ad.server.ts': `'use server';\nexport async function ad() { return { success: true }; }\n`,
      'app/admin/page.ts': `
import { html } from ${CORE};
import { ad } from '../../modules/ad/actions/ad.server.ts';
export default () => html\`<form action=\${ad}></form>\`;
`,
      'app/admin/middleware.ts': `export default async function (req, next) { return new Response('blocked', { status: 401 }); }\n`,
    }),
    dev: true,
  });
  await app.warmup();

  const resp = await app.handle(new Request('http://x/admin', form({ x: '1' })));
  assert.equal(resp.status, 401, 'segment middleware runs before the dispatcher');
  assert.equal(await resp.text(), 'blocked');
});

test('segment middleware also wraps a submission that binds nothing', async () => {
  // The dispatcher always answers with a Response, 405 included, so a
  // middleware that post-processes `await next()` never sees an absent one.
  const app = await createRequestHandler({
    appDir: makeApp({
      'app/plain/page.ts': `import { html } from ${CORE};\nexport default () => html\`<p>x</p>\`;\n`,
      'app/plain/middleware.ts': `
export default async function (req, next) {
  const res = await next();
  res.headers.set('x-saw', String(res.status));
  return res;
}
`,
    }),
    dev: true,
  });
  await app.warmup();

  const resp = await app.handle(new Request('http://x/plain', form({ x: '1' })));
  assert.equal(resp.status, 405);
  assert.equal(resp.headers.get('x-saw'), '405');
});
