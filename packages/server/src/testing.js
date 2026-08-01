/**
 * Server-side test harness helpers (issue #267).
 *
 * `createRequestHandler(...).handle(request)` drives the FULL WebJs pipeline
 * (middleware, routing, SSR, page actions, server-action RPC, auth + CSRF), and
 * the framework's own suite already drives it. These helpers are THIN builders
 * over the native `Request` / `Response` around that `handle()`, so an app test
 * reads as a one-liner instead of hand-assembling a `Request`, minting a CSRF
 * pair, or serializing an action payload by hand.
 *
 * They are intentionally not a test framework: each is a few lines, returns
 * native objects, and reuses the REAL cookie / header names (`csrf.js`) and the
 * REAL wire serializer (`serializer.js` -> `@webjsdev/core`), never a parallel
 * fake. The most robust auth helper drives the REAL login through `handle()` and
 * captures the `Set-Cookie`, so it exercises the production cookie shape.
 *
 * Usage (a scaffolded app test):
 *
 * ```js
 * import { createRequestHandler } from '@webjsdev/server';
 * import { testRequest, invokeActionForTest } from '@webjsdev/server/testing';
 *
 * const app = await createRequestHandler({ appDir: process.cwd(), dev: true });
 *
 * // 1. fire a request through the real pipeline
 * const res = await testRequest(app.handle, '/about');
 *
 * // 2. round-trip an action through the real /__webjs/action/<hash>/<fn> path
 * const out = await invokeActionForTest(app, 'modules/m/act.server.js', 'echo', [new Date()]);
 * ```
 *
 * @module testing
 */

import { hashFile, RPC_CONTENT_TYPE } from './actions.js';
import { FORM_ACTION_FIELD } from '@webjsdev/core';
import { getSerializer } from './serializer.js';
import { join, sep } from 'node:path';

/**
 * A `handle` is whatever `createRequestHandler(...).handle` is: a function
 * taking a native `Request` and returning a `Promise<Response>`.
 * @typedef {(req: Request) => Promise<Response>} Handle
 */

/** Dummy origin used to turn a bare path (`/about`) into an absolute URL. */
const DUMMY_ORIGIN = 'http://webjs.test';

/**
 * Coerce a path-or-Request `input` into a native `Request`.
 *
 * A string starting with `/` is prefixed with a dummy origin (the pipeline only
 * reads `url.pathname` + `url.search`, so the origin is irrelevant); a full URL
 * string is used as-is; a `Request` is passed through (with `init` overrides
 * merged when provided).
 *
 * @param {string | Request} input
 * @param {RequestInit} [init]
 * @returns {Request}
 */
export function toRequest(input, init) {
  if (input instanceof Request) {
    return init ? new Request(input, init) : input;
  }
  const url = input.startsWith('/') ? DUMMY_ORIGIN + input : input;
  return new Request(url, init);
}

/**
 * Fire a request through the real `handle()` pipeline and return the `Response`.
 *
 * The documented one-liner: `const res = await testRequest(app.handle, '/about')`.
 * Accepts a bare path (prefixed with a dummy origin), a full URL string, or a
 * pre-built `Request`. `init` is the standard `RequestInit` (method, headers,
 * body, ...).
 *
 * @param {Handle} handle
 * @param {string | Request} input
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export function testRequest(handle, input, init) {
  return handle(toRequest(input, init));
}

/**
 * Collect every `Set-Cookie` value off a `Response`, preferring the
 * structured `getSetCookie()` (which keeps multiple cookies separate) and
 * falling back to the single combined header.
 *
 * @param {Response} res
 * @returns {string[]}
 */
export function getSetCookies(res) {
  const h = res.headers;
  if (typeof h.getSetCookie === 'function') {
    const list = h.getSetCookie();
    if (list && list.length) return list;
  }
  const single = h.get('set-cookie');
  return single ? [single] : [];
}

/**
 * Turn a list of `Set-Cookie` header values into a single `Cookie` request
 * header value (`name=value; name2=value2`). Strips the cookie attributes
 * (`Path`, `Max-Age`, ...), keeping only the `name=value` pair of each.
 *
 * @param {string[]} setCookies
 * @returns {string}
 */
export function cookiesToHeader(setCookies) {
  return setCookies
    .map((c) => c.split(';', 1)[0].trim())
    .filter(Boolean)
    .join('; ');
}

/**
 * Merge an extra cookie string into a `RequestInit`'s `Cookie` header,
 * preserving any cookie already on `init.headers`.
 *
 * @param {RequestInit} [init]
 * @param {string} cookieValue a `name=value; name2=value2` string
 * @returns {RequestInit}
 */
export function withCookies(init = {}, cookieValue) {
  const headers = new Headers(init.headers || {});
  const existing = headers.get('cookie');
  headers.set('cookie', existing ? `${existing}; ${cookieValue}` : cookieValue);
  return { ...init, headers };
}

/**
 * Attach an auth/session cookie (captured from a real login `Set-Cookie`) to a
 * `RequestInit` so a follow-up request hits a protected route as the logged-in
 * user. A thin convenience over `withCookies`; the cookie value comes from the
 * REAL session mechanism (see `loginAndGetCookies`), never a fabricated shape.
 *
 * @param {RequestInit} [init]
 * @param {string} sessionCookie a `Cookie` header value (e.g. from `loginAndGetCookies`)
 * @returns {RequestInit}
 */
export function withSessionCookie(init = {}, sessionCookie) {
  return withCookies(init, sessionCookie);
}

/**
 * Drive the REAL credentials login through `handle()` and return the resulting
 * cookies as a ready-to-reuse `Cookie` request-header value, so a test can hit a
 * protected route as a logged-in user. This exercises the production auth flow
 * (the `app/api/auth/[...path]/route.ts` handler + `createAuth`'s
 * `Set-Cookie`), so the captured cookie is the genuine signed session cookie,
 * not a fabricated one.
 *
 * Defaults target `createAuth`'s credentials sign-in route
 * (`POST /api/auth/signin/credentials`, the path its handler actually routes a
 * credentials login through), posting a urlencoded `email` + `password`.
 * Override `loginPath` / `body` / `method` for a different auth wiring.
 *
 * @param {Handle} handle
 * @param {{ email: string, password: string }} credentials
 * @param {{
 *   loginPath?: string,
 *   method?: string,
 *   body?: BodyInit,
 *   contentType?: string,
 *   expectStatuses?: number[],
 * }} [opts]
 * @returns {Promise<{ cookies: string, setCookies: string[], response: Response }>}
 *   `cookies` is the combined `Cookie` header value; `setCookies` is the raw
 *   `Set-Cookie` list; `response` is the login response (a 302 on success).
 */
export async function loginAndGetCookies(handle, credentials, opts = {}) {
  const loginPath = opts.loginPath || '/api/auth/signin/credentials';
  const method = opts.method || 'POST';
  const contentType = opts.contentType || 'application/x-www-form-urlencoded';
  const body =
    opts.body != null
      ? opts.body
      : new URLSearchParams({
          email: credentials.email,
          password: credentials.password,
        }).toString();

  const res = await testRequest(handle, loginPath, {
    method,
    headers: { 'content-type': contentType },
    body,
  });

  const setCookies = getSetCookies(res);
  const cookies = cookiesToHeader(setCookies);
  if (!cookies) {
    throw new Error(
      `loginAndGetCookies: POST ${loginPath} returned no Set-Cookie (status ` +
      `${res.status}). The credentials were likely rejected, or the login path ` +
      `is wrong for this app's auth wiring (override opts.loginPath / opts.body).`,
    );
  }
  return { cookies, setCookies, response: res };
}

/**
 * Submit a page's `<form action=${action}>` the way a browser with JS OFF does
 * (#1155): render the page, take the identity the server put in its hidden
 * `__webjs_action` field, and POST it back with the author's fields.
 *
 * A bound form carries that field because the identity is what tells the
 * dispatcher WHICH action to run, so a hand-written POST that omits it is not a
 * form submission at all and is answered `405`. Reproducing the scrape in every
 * app test is how that ends up looking like a database problem instead: the
 * status is wrong, an assertion fails, and a `catch` around it reports a skip.
 * Hence a helper, so the identity is never the test's business.
 *
 * The form is located by INDEX (`opts.index`, default the first on the page),
 * which is enough for the common one-form page. For a page with several, pass
 * `opts.match`: a string or RegExp that must appear in the form's markup, so
 * the test names the form by something an author recognizes (a heading, a field
 * name, an id) rather than by counting.
 *
 * @param {Handle} handle
 * @param {string} path the page to render AND, by default, to submit back to
 * @param {Record<string, string> | URLSearchParams | FormData} [fields]
 * @param {{
 *   index?: number,
 *   match?: string | RegExp,
 *   cookies?: string,
 *   submitPath?: string,
 *   headers?: Record<string, string>,
 * }} [opts]
 * @returns {Promise<Response>} the submission response (a `303` on success, a
 *   `422` re-render on a failure result)
 */
export async function submitForm(handle, path, fields = {}, opts = {}) {
  const getInit = opts.cookies ? withCookies({}, opts.cookies) : {};
  const page = await testRequest(handle, path, getInit);
  const html = await page.text();

  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) || [];
  const candidates = opts.match
    ? forms.filter((f) => (opts.match instanceof RegExp ? opts.match.test(f) : f.includes(opts.match)))
    : forms;
  const form = candidates[opts.index || 0];
  if (!form) {
    throw new Error(
      `submitForm: no ${opts.match ? 'matching ' : ''}<form> found on ${path} `
      + `(status ${page.status}, ${forms.length} form(s) on the page).`,
    );
  }
  const id = form.match(/name="__webjs_action"\s+value="([^"]*)"/);
  if (!id) {
    throw new Error(
      `submitForm: the <form> on ${path} carries no __webjs_action field, so it `
      + 'is not bound to a server action. Write it as `<form action=${myAction}>` '
      + 'with the action imported from a `use server` module.',
    );
  }

  const body = new URLSearchParams();
  body.set(FORM_ACTION_FIELD, id[1]);
  const entries = fields instanceof URLSearchParams || fields instanceof FormData
    ? fields.entries()
    : Object.entries(fields);
  for (const [k, v] of entries) body.append(k, String(v));

  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(opts.headers || {}) },
    body: body.toString(),
  };
  return await testRequest(
    handle,
    opts.submitPath || path,
    opts.cookies ? withCookies(init, opts.cookies) : init,
  );
}

/**
 * Compute the RPC endpoint path for an action, addressing it the same way the
 * generated client stub does: by the SHA-256 hash of the action's ABSOLUTE file
 * path (`hashFile` in `actions.js`, the single source of truth) plus the
 * exported function name.
 *
 * `serverFilePath` may be absolute, or relative to `appDir` (joined with the
 * OS separator, matching `resolveServerModule`).
 *
 * @param {string} appDir the app root passed to `createRequestHandler`
 * @param {string} serverFilePath the `.server.{js,ts}` file (absolute or appDir-relative)
 * @param {string} fnName the exported action function name
 * @returns {Promise<string>} the path, e.g. `/__webjs/action/<hash>/<fn>`
 */
export async function actionEndpoint(appDir, serverFilePath, fnName) {
  const abs = isAbsolutePath(serverFilePath)
    ? serverFilePath
    : join(appDir, serverFilePath.split('/').join(sep));
  const hash = await hashFile(abs);
  return `/__webjs/action/${hash}/${fnName}`;
}

/** @param {string} p */
function isAbsolutePath(p) {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * Round-trip a registered server action through the REAL
 * `/__webjs/action/<hash>/<fn>` endpoint: serialize `args` with the webjs
 * serializer (exactly as the client stub does), POST them with a valid CSRF
 * cookie + header, and parse the response with the serializer.
 *
 * Unlike a DIRECT import of the action (which calls the function in-process),
 * this exercises the production path: CSRF validation, the wire serializer
 * round-trip (so a `Date` / `Map` / `BigInt` arg or return is genuinely
 * encoded + decoded), and prod error sanitization (a thrown error surfaces as a
 * sanitized message, never the stack). That is why it catches a
 * serializer / CSRF / error-sanitization regression a direct import would miss.
 *
 * The action is addressed via `actionEndpoint` (the file-path hash + fn name),
 * the same scheme the generated stub uses.
 *
 * On a non-2xx response the parsed `error` is thrown as an `Error` whose
 * `status` property carries the HTTP status, mirroring the client stub's
 * behavior (so a CSRF 403 or a sanitized 500 surfaces as a throw a test can
 * assert on).
 *
 * @param {{ handle: Handle, appDir: string } | Handle} app
 *   the handler object (`{ handle, appDir }`, e.g. the `createRequestHandler`
 *   return) or, when you pass `opts.appDir` and `opts.endpoint`, just the
 *   `handle` function.
 * @param {string} serverFilePath the `.server.{js,ts}` action file (absolute or appDir-relative)
 * @param {string} fnName the exported action function name
 * @param {unknown[]} [args] positional args (serialized as the stub sends an arg array)
 * @param {{
 *   appDir?: string,
 *   extraCookies?: string,
 *   throwOnError?: boolean,
 * }} [opts]
 * @returns {Promise<any>} the parsed action return value
 */
export async function invokeActionForTest(app, serverFilePath, fnName, args = [], opts = {}) {
  const handle = typeof app === 'function' ? app : app.handle;
  const appDir = opts.appDir || (typeof app === 'object' ? app.appDir : undefined);
  if (!appDir) {
    throw new Error(
      'invokeActionForTest: appDir unknown. Pass the createRequestHandler ' +
      'return value (which carries appDir), or set opts.appDir.',
    );
  }
  const throwOnError = opts.throwOnError !== false;

  const endpoint = await actionEndpoint(appDir, serverFilePath, fnName);

  const serializer = getSerializer();
  const body = await serializer.serialize(args);

  // Model a same-origin browser POST (the action CSRF check reads
  // `Sec-Fetch-Site`, no token / cookie needed).
  /** @type {Record<string,string>} */
  const headers = { 'content-type': RPC_CONTENT_TYPE, 'sec-fetch-site': 'same-origin' };
  if (opts.extraCookies) headers.cookie = opts.extraCookies;

  const res = await testRequest(handle, endpoint, { method: 'POST', headers, body });

  const text = await res.text();
  const ct = res.headers.get('content-type') || '';
  let parsed;
  if (ct.includes(RPC_CONTENT_TYPE)) parsed = serializer.deserialize(text);
  else if (ct.includes('application/json')) parsed = text ? JSON.parse(text) : null;
  else parsed = text;

  if (!res.ok && throwOnError) {
    const msg = (parsed && parsed.error) || `webjs action ${fnName} -> ${res.status}`;
    const err = /** @type {Error & { status?: number, response?: Response, digest?: string }} */ (new Error(msg));
    err.status = res.status;
    err.response = res;
    // Prod sanitization (#749) returns a generic message + a correlation digest;
    // surface the digest on the thrown error so a test (or a caller) can map it
    // to the server log line, mirroring the generated client stub.
    if (parsed && parsed.digest) err.digest = parsed.digest;
    throw err;
  }
  return parsed;
}

/**
 * Lower-level variant of `invokeActionForTest` that returns the raw `Response`
 * (never throws on a non-2xx), so a test can assert on the status directly.
 * By default it models a same-origin browser POST (passes the CSRF check); set
 * `opts.crossOrigin` (true, or a specific origin string) to model a cross-site
 * request and assert the 403.
 *
 * @param {{ handle: Handle, appDir: string } | Handle} app
 * @param {string} serverFilePath
 * @param {string} fnName
 * @param {unknown[]} [args]
 * @param {{
 *   crossOrigin?: boolean | string,
 *   appDir?: string,
 *   extraCookies?: string,
 *   contentType?: string,
 * }} [opts]
 * @returns {Promise<Response>}
 */
export async function rawActionRequest(app, serverFilePath, fnName, args = [], opts = {}) {
  const handle = typeof app === 'function' ? app : app.handle;
  const appDir = opts.appDir || (typeof app === 'object' ? app.appDir : undefined);
  if (!appDir) {
    throw new Error('rawActionRequest: appDir unknown. Pass the handler object or set opts.appDir.');
  }
  const endpoint = await actionEndpoint(appDir, serverFilePath, fnName);
  const serializer = getSerializer();
  const body = await serializer.serialize(args);

  /** @type {Record<string,string>} */
  const headers = { 'content-type': opts.contentType || RPC_CONTENT_TYPE };
  if (opts.crossOrigin) {
    headers['sec-fetch-site'] = 'cross-site';
    headers.origin = typeof opts.crossOrigin === 'string' ? opts.crossOrigin : 'https://evil.example';
  } else {
    headers['sec-fetch-site'] = 'same-origin';
  }
  if (opts.extraCookies) headers.cookie = opts.extraCookies;

  return testRequest(handle, endpoint, { method: 'POST', headers, body });
}

/**
 * Browser-test harness (#806): build a WebJs handler that a `web-test-runner`
 * config can proxy module requests to, so a `test/**​/browser/*.test.js` file
 * can import a real `.ts` component that imports a `'use server'` action and it
 * loads + hydrates in a real browser. Plain WTR serves raw TS with no webjs
 * transform, so the component (and its `#`-alias / `.server.ts` imports) never
 * resolves; this handler runs the SAME dev pipeline (TS strip, `.server.ts` ->
 * RPC stub, `#` alias, `/__webjs/core/*`, the importmap) as `webjs dev`.
 *
 * Uses `testMode` so ANY app file under appDir is servable (a component a test
 * imports is not route-reachable, so it is absent from the browser-bound graph
 * the normal serve gate requires). The `.server.*` source guardrail is
 * unchanged, so no server source is exposed. `importmapHtml()` returns the
 * `<script type="importmap">` to inject into the test page (call after warmup,
 * so the map is final).
 *
 * The dev handler + importmap builder are LAZILY imported so importing the rest
 * of `@webjsdev/server/testing` stays light (they pull the full server + the
 * `ws` WebSocket subsystem).
 *
 * @param {string} appDir  the WebJs app root (usually `process.cwd()`)
 * @returns {Promise<{ handle: Handle, warmup: () => Promise<void>, importmapHtml: () => string }>}
 */
export async function createBrowserTestHandler(appDir) {
  const { createRequestHandler } = await import('./dev.js');
  const { importMapTag } = await import('./importmap.js');
  const app = await createRequestHandler({ appDir, dev: true, testMode: true });
  if (app.warmup) await app.warmup();
  return {
    handle: app.handle,
    warmup: app.warmup || (async () => {}),
    importmapHtml: () => importMapTag(),
  };
}
