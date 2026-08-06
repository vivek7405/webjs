# Testing

## What This Covers

- The four test layers (unit, browser, e2e, smoke) and where each file lives.
- The `handle()` harness from `@webjsdev/server/testing` for driving the real request pipeline against a native `Response`.
- `npm run test` and `npm run test:browser`, plus when a browser or e2e test is REQUIRED (hydration, client router, slots, custom-element upgrade).
- Bun cross-runtime parity for runtime-sensitive code.
- Rendering the app and LOOKING for visual defects a static check cannot catch (a collapsed or reflowing layout).
- Convention validation with `webjs check`.

Read this when you are adding tests for a feature, deciding which layer a test belongs in, or verifying a UI or theming change. For component mount and hydration helpers see `components.md`. For testing actions and the `ActionResult` envelope see `data-and-actions.md`.

## Test layers

Feature folders are primary, and the test kind is a subfolder inside the feature ONLY when that kind is present. Never create an empty `browser/` or `e2e/` folder.

| Kind | Location | What it does |
|---|---|---|
| unit + integration | `test/<feature>/<name>.test.{js,ts,mjs}` | Imports modules and asserts. No spawned process, no network. |
| browser | `test/<feature>/browser/<name>.test.js` | Real DOM, events, shadow / light DOM, in Chromium, Firefox, and WebKit. |
| e2e | `test/<feature>/e2e/<name>.test.{ts,mjs}` | Boots a real process and drives it over HTTP / browser / stdout. Opt in with `WEBJS_E2E=1`. |
| smoke | `test/<feature>/smoke/<name>.test.{js,ts}` | Fast deploy-time sanity check, a subset of e2e in spirit. |

Assert only on what the layer needs. A block that inspects only the HTTP response, the SSR HTML string, headers, or the importmap does NOT need a browser. Keep in the browser suite only blocks that genuinely need a DOM (live state via `page.evaluate`, hydration, client-router nav, slots, view transitions, streaming into the DOM, custom-element upgrade).

### A browser test that clicks a real link or submits a real form MUST cancel the default

web-test-runner aborts the whole SESSION, not one file, when the page navigates. So a test that clicks a real `<a href>` or submits a real `<form>` is a single point of failure for every browser test file you have: whenever the client router loses the race to intercept, the browser performs the real navigation and the run dies reporting `0 failed` and then exiting non-zero, which reads as an infrastructure blip rather than a test problem. Cancel the default so an interception gap fails ONE test on its own assertion.

Register the canceling listener on `window` in the BUBBLE phase. That is the last step of the propagation path, so it runs after the router's own document-level listeners, and `preventDefault()` still cancels the default action because that action runs only once dispatch completes.

**Never use the capture phase.** Capture sets `defaultPrevented` before the router ever sees the event, and the router returns immediately on that flag (the same guard that lets a component's `@click` opt out). Every guarded router test then passes while testing nothing. Capture is correct only when suppressing the router is the actual goal, for a test that exercises a menu or a drawer rather than navigation; say so in a comment when you do it, because it looks identical to the mistake. Do not reach for `stopPropagation` either, which hides the click from the router and turns the assertion into a tautology.

Cancel a form on its `submit` event, not on the submit control's `click`. The form's default action fires on submit, so canceling the click stops the form from ever submitting and the router never sees it.

Resolve the anchor from `e.composedPath()`, not `e.target.closest('a[href]')`. The listener is on `window`, so a click inside a shadow root (a `static shadow = true` component) arrives retargeted to the host, and `closest()` walks only light-tree ancestors and never finds the link, which fails open exactly where the router itself handles the case. A pure-fragment `href="#x"` link needs no guard at all, since it never navigates the page away.

There is a SECOND channel a click guard cannot reach: the router assigns `location.href` when it degrades a soft navigation, and `preventDefault` does not cancel a script assignment. Do not try to intercept `location.href` itself, which is non-configurable on Chromium, Firefox, and WebKit alike, so its setter cannot be redefined on any of them. Listen for `webjs:navigation-fallback` on `document` and assert none fired; its `cause` is the diagnosis.

It is a few lines, so write it in your suite's setup and detach it in teardown:

```js
const onClick = (e) => {
  for (const el of e.composedPath()) {
    if (el instanceof HTMLAnchorElement && el.hasAttribute('href')) { e.preventDefault(); return; }
  }
};
const onSubmit = (e) => e.preventDefault();
window.addEventListener('click', onClick);     // bubble, never capture
window.addEventListener('submit', onSubmit);
```

(The WebJs framework repo keeps its own copy of exactly this in one shared module, `test/browser-nav-guard.js`, whose `installNavGuard()` returns `{ fallbacks, hardNavigations, remove }`. That module is framework-repo infrastructure and is not part of a scaffolded app.)

## App runners (`webjs test`)

```sh
npm run test              # unit + browser tests (both layers; e2e only with WEBJS_E2E=1)
npm run test:browser      # web-test-runner against test/**/browser/**
WEBJS_E2E=1 npm run test  # adds the e2e layer
```

`npm run test` dispatches on the runtime (`node --test` on Node, `bun test` on Bun). The scaffold's `web-test-runner.config.js` globs `test/**/browser/**/*.test.js` and is already wired, so you do not set it up.

A scaffolded app has one root `test/` directory shaped the same way (feature first, kind second):

```
test/
  auth/
    auth.test.ts                 # signup / login / currentUser
    browser/login-form.test.js   # only if exercising DOM
  posts/
    posts.test.ts
    browser/post-editor.test.js
```

## The `handle()` harness (`@webjsdev/server/testing`)

`createRequestHandler({ appDir }).handle(request)` drives the FULL request pipeline (middleware, routing, SSR, form-dispatched actions, server-action RPC, auth, CSRF) and returns a native `Response`. It is the same entry the framework's own suite uses, so the most realistic way to test an app is to fire a `Request` through it and assert on the `Response`, with no spawned process and no network. `@webjsdev/server/testing` ships thin builders over that `handle()`, each a few lines over native `Request` / `Response` that reuse the REAL cookie names, header names, and wire serializer. For a browser test that needs to drive the app in a real DOM, `createBrowserTestHandler()` from `@webjsdev/server/testing` exposes the same `handle()` pipeline to the WTR Chromium session.

```js
import { createRequestHandler } from '@webjsdev/server';
import { testRequest, submitForm, invokeActionForTest, rawActionRequest, loginAndGetCookies, withSessionCookie }
  from '@webjsdev/server/testing';

const app = await createRequestHandler({ appDir: process.cwd(), dev: true });

const res = await testRequest(app.handle, '/about');
assert.equal(res.status, 200);
assert.match(await res.text(), /About/);
```

A bare path is prefixed with a dummy origin (the pipeline reads only `pathname` and `search`); a full URL string or a pre-built `Request` also works. The optional third arg is a standard `RequestInit`.

### Auth and session helpers

Server-action CSRF is an Origin / `Sec-Fetch-Site` check, so a test needs no CSRF setup. `loginAndGetCookies` drives the REAL credentials login through `handle()` and captures the genuine signed session cookie, so a follow-up request can hit a protected route as the logged-in user.

```js
const gated = await testRequest(app.handle, '/dashboard');
assert.equal(gated.status, 302);                     // -> /login

const { cookies } = await loginAndGetCookies(app.handle, { email, password });
const dash = await testRequest(app.handle, '/dashboard', withSessionCookie({}, cookies));
assert.equal(dash.status, 200);
```

### `submitForm`: the no-JS write path

Use it for any page whose form binds an action (`<form action=${myAction}>`). A bound form carries a hidden `__webjs_action` field holding the action's identity, and that field is what tells the dispatcher which action to run, so a hand-written `POST` that omits it is not a form submission at all and is answered **405**. `submitForm` renders the page, reuses the identity the server put there, and posts it back, which is exactly what a browser with JS off does.

```js
import { submitForm } from '@webjsdev/server/testing';

// success is a 303 PRG
const ok = await submitForm(app.handle, '/signup', { name: 'Ada', email: 'ada@example.com', password: 'hunter2' });
assert.equal(ok.status, 303);
assert.equal(ok.headers.get('location'), '/dashboard');

// a failure result re-renders the SAME page at 422 with the result on actionData
const bad = await submitForm(app.handle, '/signup', { email: 'not-an-email' });
assert.equal(bad.status, 422);
assert.match(await bad.text(), /Enter a valid email/);
```

Options: `cookies` (submit as a logged-in user, paired with `loginAndGetCookies`), `match` (a string or RegExp the form's markup must contain, for a page with several forms), `index` (pick by position instead), `submitPath` (render one page, submit to another), and `headers`.

Do not hand-roll the identity scrape. When it is wrong the symptom is a 405, an assertion fails, and a surrounding `catch` reports it as a database that was never migrated, so the test goes quiet rather than red.

### `invokeActionForTest`: round-trip an action through the REAL endpoint

```js
// modules/posts/actions/create.server.ts exports createPost
const out = await invokeActionForTest(app, 'modules/posts/actions/create.server.ts', 'createPost', [input]);
```

It serializes the args with the WebJs serializer exactly as the generated client stub does, POSTs them same-origin to `/__webjs/action/<hash>/<fn>`, and parses the response. Prefer this over a direct import of the action. A direct import bypasses three production concerns the endpoint enforces (the wire serializer, CSRF, and prod error sanitization), so `invokeActionForTest` catches a regression a direct import cannot see. For negative cases, `rawActionRequest(app, file, fn, args, { crossOrigin: true })` returns the raw `Response` and never throws on a non-2xx (pass `{ omitCsrf: true }` to drop the CSRF pair).

## When a browser or e2e test is REQUIRED

A unit test is necessary but NOT sufficient for any change to hydration, the client router, slots, or custom-element upgrade. The headline behaviour of these is a browser or e2e assertion, so ship one:

- Hydration and the SSR-then-hydrate agreement.
- Client-router navigation, form submissions through the router, prefetch.
- Slots and light / shadow DOM projection.
- Custom-element upgrade of the SSR'd tag.
- Progressive soft-nav streaming (assert the fallback is live at the moment the URL advances) belongs in e2e (`WEBJS_E2E=1`).

Component mount helpers (`fixture`, `ssrFixture`, `waitForUpdate`) come from `@webjsdev/core/testing`; see `components.md`.

## Rendering the app and looking for UI defects

A layout bug (a board that collapses, cells of unequal size, a grid that resizes as it fills) is invisible to `webjs check`, `webjs typecheck`, and a glance at the empty first paint. Static tools give no signal for a visual defect, so render the app in a real browser and look.

- A browser test can measure real geometry with `getBoundingClientRect()` and FAIL on the defect. There is no framework helper (it is a few lines); write it against your component and assert its children stay the same size and do not resize as the grid fills. Ship one for any grid, board, or gallery layout.
- Test both light AND dark mode. Light mode passing proves nothing about dark mode. Emulate dark (a `newContext({ colorScheme: 'dark' })` or the theme toggle) and inspect a component's COMPUTED `background-color` and `color`, not just the page chrome.
- Read the screenshot. Capture `page.screenshot({ fullPage: true })` and open the PNG. White-on-white or a stray light box is obvious visually and invisible in the markup.

## Bun cross-runtime parity

WebJs runs on Node 24+ or Bun. The Node suite is the source of truth; an additive Bun matrix re-runs the runtime-sensitive suite under Bun to catch the long tail of cross-runtime incompatibilities (a `node:*` API Bun implements differently, a crypto or stream edge case, an error-message-format quirk).

If your app targets Bun, Bun parity is part of the definition of done. A change to a runtime-sensitive surface (the serializer, the `node:http` vs `Bun.serve` listener and request path, SSR / action / CSRF dispatch, streams, `node:crypto`, the TS stripper, auth / session / cors) is NOT done until you also run your suite under the Bun runtime (needs `bun` installed) and add a cross-runtime assertion for the touched surface.

### Writing a plain proof script that boots a server

A cross-runtime proof is often a plain assert script rather than a test file, so the SAME file runs under `node script.mjs` and `bun script.mjs`. If it boots a real server through `startServer`, know what carries its verdict: the process EXIT CODE, since nothing is collecting results for you. WebJs makes that code trustworthy: a fatal shutdown, which is where a failed top-level assertion lands on both runtimes, exits 1, and so does a drain that rejects or is still hanging at the 10s deadline. The process exits 0 in one case only, an operator-requested stop that drained cleanly with no crash on the way out, so a proof script that finishes green really did finish green. Two habits keep it that way:

- **Assert the exit code, never the logs.** These scripts conventionally pass a `quiet` logger, so anything that only logs is invisible. If your script catches its own failure, report it with an explicit `process.exit(1)` rather than a `console.error` alone, guarded as `if (import.meta.main) process.exit(1); else throw failure;`. The guard matters when a `.test.mjs` wrapper imports the script under `node --test`: an unguarded exit kills the whole single-process run and hides every other file's results, while the throw lets the harness report one failed test.
- **Prove the script can FAIL before you trust it passing.** Break one assertion on purpose and confirm the run exits non-zero. A proof that cannot go red is worse than no proof: it reports success forever.

## Proving display-only elision did not break anything

WebJs strips the JavaScript of every component that does no client work, so a wrong verdict costs an app real interactivity and does it silently. Two commands cover the two halves, and you need both.

```sh
webjs elision --verify
```

renders every static page route with elision on and off and diffs the served bytes. It is the framework's own differential guard pointed at your route table, and it exits non-zero on a divergence AND on a corpus where nothing could be compared, so it belongs in CI. Dynamic routes are skipped by name; add real paths with `--routes /,/blog/hello`.

That proves the bytes you SERVE did not change. It cannot prove post-hydration behaviour, because a wrongly dropped module shows up as a dead click, not as different bytes. Run your own browser or e2e suite twice for that half:

```sh
WEBJS_ELIDE=1 npm run test:e2e
WEBJS_ELIDE=0 npm run test:e2e
```

A test that passes under one and fails under the other is a wrong verdict, and `webjs elision` tells you which module and on what evidence. If the component's interactivity is genuinely invisible to static analysis, the fix is `static interactive = true` on it; see `components.md` for what that override does and does not rescue.

## Convention validation (`webjs check`)

`npm run check` is the correctness validator. Every rule catches code that is wrong to ship, a crash, a security leak, a reactive prop that silently stops re-rendering, or a type-strip failure. Run it and fix every violation before considering the change done (`npm run check -- --json` for an agent loop, `npm run check -- --rules` to list the rules). It is separate from `CONVENTIONS.md`, which carries the customizable project conventions you follow by judgment.

## What NOT to do

- Do not recreate a top-level `test/{unit,browser,e2e}/` shape. Kind is a child of feature, never the reverse.
- Do not create empty kind folders.
- Do not import from another package's `test/` directory. Test code is not a public surface.
- Do not add `.unit` / `.integration` filename suffixes. The folder tells you the kind.
- Do not run WTR or Playwright inside a headless sandbox that lacks the transform plugins or native browser libraries. Instead, extract the reconciliation or optimistic-update logic into a pure browser-safe utility and cover it with a Node unit test.
