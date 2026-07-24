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

`createRequestHandler({ appDir }).handle(request)` drives the FULL request pipeline (middleware, routing, SSR, page actions, server-action RPC, auth, CSRF) and returns a native `Response`. It is the same entry the framework's own suite uses, so the most realistic way to test an app is to fire a `Request` through it and assert on the `Response`, with no spawned process and no network. `@webjsdev/server/testing` ships thin builders over that `handle()`, each a few lines over native `Request` / `Response` that reuse the REAL cookie names, header names, and wire serializer. For a browser test that needs to drive the app in a real DOM, `createBrowserTestHandler()` from `@webjsdev/server/testing` exposes the same `handle()` pipeline to the WTR Chromium session.

```js
import { createRequestHandler } from '@webjsdev/server';
import { testRequest, invokeActionForTest, rawActionRequest, loginAndGetCookies, withSessionCookie }
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

## Convention validation (`webjs check`)

`npm run check` is the correctness validator. Every rule catches code that is wrong to ship (a crash, a security leak, a type-strip failure), plus the `no-scaffold-placeholder` sentinel for unreplaced scaffold content. Run it and fix every violation before considering the change done (`npm run check -- --json` for an agent loop, `npm run check -- --rules` to list the rules). It is separate from `CONVENTIONS.md`, which carries the customizable project conventions you follow by judgment.

## What NOT to do

- Do not recreate a top-level `test/{unit,browser,e2e}/` shape. Kind is a child of feature, never the reverse.
- Do not create empty kind folders.
- Do not import from another package's `test/` directory. Test code is not a public surface.
- Do not add `.unit` / `.integration` filename suffixes. The folder tells you the kind.
- Do not run WTR or Playwright inside a headless sandbox that lacks the transform plugins or native browser libraries. Instead, extract the reconciliation or optimistic-update logic into a pure browser-safe utility and cover it with a Node unit test.
