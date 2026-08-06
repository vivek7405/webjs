import { isNotFound, isRedirect, isForbidden, isUnauthorized, FORM_ACTION_FIELD } from '@webjsdev/core';
import { ssrPage, ssrNotFound, ssrForbidden, ssrUnauthorized } from './ssr.js';
import { readBytesBounded, payloadTooLarge, DEFAULT_MAX_MULTIPART_BYTES } from './body-limit.js';
import { getBodyLimits } from './context.js';
import { propagateTrustedRemoteIp } from './rate-limit.js';
import { makeThenable } from './thenable-params.js';
import { lookupActionIdentity } from './form-action-identity.js';
import { verifyOrigin } from './csrf.js';
import { actionMethod, actionConfigFn, actionMiddleware, resolveTags, RESERVED_CONFIG } from './action-config.js';
import { runValidate } from './actions.js';
import { runActionChain } from './action-middleware.js';
import { runWithActionSignal } from './action-signal.js';
import { isStreamable } from './action-stream.js';
import { revalidateTags } from './cache-tags.js';
import { isControlFlowThrow, errorDigest, GENERIC_ERROR_MESSAGE } from './action-error.js';

/**
 * The form-submission dispatcher (#1155): a non-GET request to a PAGE's own url
 * carrying the `__webjs_action` hidden field runs the server action that field
 * names, and the response drives the page.
 *
 * This is the ONE write path. A `<form action=${importedAction}>` renders to a
 * plain HTML form that posts here with no JS, and the client router posts the
 * SAME body to the SAME url when JS is on, so the two paths are identical by
 * construction rather than by two implementations agreeing. It replaces the
 * page `action` export (#244), which forced every module action through a
 * hand-written per-page adapter.
 *
 * Behaviour:
 *   - Action throws `redirect(url)` or `notFound()` => honored exactly as a page
 *     render does (3xx / 404). A thrown `redirect()` may target an external URL
 *     (it is the explicit nav sentinel, author-controlled).
 *   - Action returns a SUCCESS result => 303 See Other to `result.redirect` if
 *     present, else to the page's own path (Post/Redirect/Get, so a reload does
 *     not resubmit). `result.redirect` MUST be a same-site local path (see
 *     `sameSiteRedirect`), a non-local value is ignored to avoid an
 *     open-redirect through a user-controlled action result.
 *   - Action returns a FAILURE result => re-SSR the SAME page (status 422) with
 *     the result on `ctx.actionData`, so the page template can read
 *     `actionData.fieldErrors` / `actionData.values` and repopulate inputs.
 *
 * The action's declared config exports run here too (`validate`, `middleware`,
 * `invalidates`), on the same seam `invokeAction` uses. Skipping them would
 * mean an action was protected over RPC and unprotected over a form, which is
 * a privilege gap and not a missing feature.
 *
 * @typedef {{
 *   success?: boolean,
 *   data?: unknown,
 *   error?: string,
 *   fieldErrors?: Record<string,string>,
 *   values?: Record<string,string>,
 *   status?: number,
 *   redirect?: string,
 * }} ActionResult
 */

/**
 * What a form submission whose identity no longer resolves is told.
 *
 * A form held open across a deploy submits a hash the new build has never
 * seen. The response re-renders the page at 422 with this on `actionData`,
 * because the alternatives are worse: a 404 loses everything the user typed,
 * and treating it as a no-op shows a success page for a write that did not
 * happen. Next surfaces the same case as an "older or newer deployment" error.
 */
export const ACTION_SKEW_MESSAGE =
  'This page was updated while the form was open. Please submit again.';

/**
 * Whether an action result is a FAILURE (re-render the page) rather than a
 * success (PRG redirect). A result is a failure when ANY of these hold:
 *   - `result.success === false` (explicit), OR
 *   - `result.fieldErrors` is present (per-field validation messages), OR
 *   - `result.error` is present AND `result.success !== true`.
 *
 * Success is the explicit `success: true`, or a bare value (or
 * undefined/null) carrying no error markers. This means an action that returns
 * `{ error, status }` or `{ fieldErrors }` WITHOUT a literal `success: false`
 * is still treated as a failure and its error is surfaced, not swallowed.
 *
 * @param {ActionResult | null | undefined} result
 * @returns {boolean}
 */
function isFailureResult(result) {
  if (!result || typeof result !== 'object') return false;
  if (result.success === false) return true;
  if (result.fieldErrors != null) return true;
  if (result.error != null && result.success !== true) return true;
  return false;
}

/**
 * Restrict a form action's `result.redirect` to a SAME-SITE local target.
 * Allowed: a path beginning with a single `/` (e.g. `/login`, `/a?b=1#c`).
 * Rejected: a protocol-relative `//host/...` and any absolute `scheme://...`
 * URL. A user-controlled redirect target is an open-redirect vector, so a
 * non-local value is dropped and the caller falls back to the page's own path.
 *
 * The check runs on the string the BROWSER will parse, not the one the action
 * returned, and those differ. The WHATWG URL parser REMOVES every ASCII tab,
 * LF, and CR from a URL before parsing, so `/<TAB>/evil.com` reaches the parser
 * as `//evil.com` and resolves cross-origin. `Headers` rejects a LF or CR in a
 * field value, but a tab is a legal HTTP field-value character and rides
 * through to the wire intact (measured: `new URL('/\t/evil.com', origin).href`
 * is `https://evil.com/`, and Chromium follows it to the attacker host). So
 * strip those three FIRST and validate what is left, which also makes the
 * returned value exactly what the browser sees. A raw tab in a Location is
 * malformed regardless; a legitimate path percent-encodes it.
 *
 * A thrown `redirect(absoluteUrl)` (the nav sentinel) is intentionally NOT
 * routed through here: that is the author-controlled escape hatch for a
 * legitimate external redirect.
 *
 * @param {unknown} target
 * @returns {string | null} the safe local path, or null when not same-site
 */
function sameSiteRedirect(target) {
  if (typeof target !== 'string') return null;
  // What the URL parser will actually see (tab / LF / CR are removed anywhere
  // in the string, not only at the front).
  const url = target.replace(/[\t\n\r]/g, '');
  // Must start with a single slash (a leading `//` is protocol-relative and
  // would navigate cross-origin).
  if (!url.startsWith('/') || url.startsWith('//')) return null;
  // A backslash after the leading slash (`/\evil.com`) is normalized by some
  // browsers into a protocol-relative URL, so reject it too.
  if (url.startsWith('/\\')) return null;
  return url;
}

/**
 * Read the submitted body ONCE, bounded by the form/multipart limit (issue
 * #237), and return both a `FormData` (handed to the action) and a rebuilt
 * `Request` carrying the already-read bytes (so a middleware or the action can
 * still call `request.json()` / `request.formData()`). The body is consumed off
 * the ORIGINAL request directly, NOT via `req.clone()`: a tee'd clone whose
 * reader is cancelled mid-stream (the over-limit case) deadlocks the untaken
 * branch, hanging the response.
 *
 * An over-limit body is reported as `tooLarge` (the caller returns 413) and is
 * never buffered whole. A form posts more than a JSON RPC call (textarea, small
 * upload), so it uses the higher `multipart` cap. A non-form content type yields
 * an empty FormData so the action signature stays stable; the rebuilt request
 * still carries the raw bytes for the action to parse however it likes.
 *
 * @param {Request} req
 * @returns {Promise<{ tooLarge: boolean, formData: FormData, request: Request }>}
 */
async function parseFormBody(req) {
  const ct = req.headers.get('content-type') || '';
  const limits = getBodyLimits();
  const limit = limits ? limits.multipart : DEFAULT_MAX_MULTIPART_BYTES;
  const { tooLarge, bytes } = await readBytesBounded(req, limit);
  if (tooLarge) return { tooLarge: true, formData: new FormData(), request: req };

  // Rebuild a fresh Request from the bytes so the action can re-read the body.
  // SECURITY (#756): strip any inbound `x-webjs-remote-ip` the copy carried so a
  // client cannot spoof it through the rebuild, and carry the FRAMEWORK-trusted
  // remote IP forward out of band (the rebuild is a new object, so the listener's
  // WeakMap stamp on `req` does not follow it). Without this, `clientIp` inside a
  // form action (the no-JS write path, e.g. login throttling) would read the
  // spoofable header on Bun.
  const headers = new Headers(req.headers);
  headers.delete('x-webjs-remote-ip');
  const rebuilt = new Request(req.url, {
    method: req.method,
    headers,
    body: bytes && bytes.byteLength ? bytes : undefined,
    // Carry the ORIGINAL abort signal. Without it the rebuild gets a fresh,
    // never-aborted one, and since this request is what drives
    // `runWithActionSignal`, `actionSignal()` (#492) inside a form-bound action
    // could never fire, no matter what the transport underneath did. The RPC
    // path gets this for free: it consumes the original request rather than
    // rebuilding it (`readTextBounded` in actions.js).
    //
    // How far it actually reaches is a property of the listener, not of this
    // line. On Bun, `Bun.serve` hands over a request whose signal fires on
    // disconnect (`listener-bun.js` forwards it), so this makes cancellation
    // work. On Node, `toWebRequest` (dev.js) builds its Request with no signal
    // at all, so nothing aborts on EITHER transport there; that is a listener
    // gap ahead of this one, and closing it here would be a fiction.
    signal: req.signal,
  });
  propagateTrustedRemoteIp(req, rebuilt);

  const isForm = /multipart\/form-data|application\/x-www-form-urlencoded/i.test(ct);
  let formData = new FormData();
  if (isForm) {
    // Parse a SECOND fresh Request (the rebuilt one is reserved for the action).
    const forParse = new Request(req.url, {
      method: 'POST',
      headers: ct ? { 'content-type': ct } : undefined,
      body: bytes && bytes.byteLength ? bytes : undefined,
    });
    formData = await forParse.formData();
  }
  return { tooLarge: false, formData, request: rebuilt };
}

/**
 * Does this request look like a form submission at all?
 *
 * Content-type only, and deliberately cheap: the authoritative test is the
 * hidden field, which needs the body read, and buffering the body of every
 * stray POST to a page path just to decide it is a 405 would be a free way to
 * make the server do work an attacker chose for it.
 *
 * @param {Request} req
 * @returns {boolean}
 */
function looksLikeFormSubmission(req) {
  const ct = req.headers.get('content-type') || '';
  return /multipart\/form-data|application\/x-www-form-urlencoded/i.test(ct);
}

/**
 * Fingerprints already reported this process, keyed `CODE METHOD <route>`.
 * Capped, and never cleared.
 *
 * Both signals below are reachable by anyone: an empty urlencoded POST to any
 * page path, or `?__webjs_action=x` appended to any url. Reporting every hit
 * would turn a public endpoint into a free amplifier into a paid APM sink, and
 * an app needs to learn the SHAPE exists rather than count it (a real bug
 * reproduces on the next boot).
 *
 * The key is the matched ROUTE PATTERN, not the request pathname, and that is
 * load-bearing rather than cosmetic. Keyed on the pathname, a dynamic route
 * yields unbounded distinct keys, so a few hundred crafted requests to
 * `/blog/1`, `/blog/2`, … would fill the cap and permanently silence the
 * diagnostics for the process, which is a worse failure than the amplification
 * the cap exists to stop. Keyed on the pattern, all of those collapse to one
 * entry and the key space is bounded by the app's own route count, which leaves
 * the cap as a backstop no real app reaches. The code is part of the key too, so
 * a flood of one signal can never silence the other.
 *
 * @type {Set<string>}
 */
const reportedFormFingerprints = new Set();
const FINGERPRINT_CAP = 256;

/**
 * @param {string} key
 * @returns {boolean} true the first time only, and false once the cap is hit
 */
function firstSighting(key) {
  if (reportedFormFingerprints.has(key)) return false;
  if (reportedFormFingerprints.size >= FINGERPRINT_CAP) return false;
  reportedFormFingerprints.add(key);
  return true;
}

/**
 * The matched route's identity for the dedupe key: its page FILE, which is one
 * per route and reads better in a report than a serialized RegExp (`pattern` is
 * a RegExp, not a printable path). Falls back to the request pathname only when
 * a caller has no route in hand.
 *
 * @param {{ file?: string } | null | undefined} route
 * @param {URL} url
 * @returns {string}
 */
function routeKeyOf(route, url) {
  return (route && route.file) || url.pathname;
}

/**
 * Reset the per-process report dedupe. Test seam only: the cap and the
 * never-cleared set are the point in production.
 */
export function resetFormReportDedupe() {
  reportedFormFingerprints.clear();
}

/**
 * A form posted to a page and carried no action identity, so nothing ran and
 * the answer is a 405. Route it to the APM sink with a code an app can group
 * on, instead of leaving an anonymous 405 in an access log.
 *
 * Carries the field NAMES, which are template constants and are what identify
 * WHICH form posted nowhere. Never the values, which are user data. The form's
 * own `action` attribute is not carried because a bound form has none (the
 * renderer strips it so the form posts to its own url), so the request url
 * already is that information.
 *
 * @param {URL} url
 * @param {Request} req
 * @param {FormData} formData
 * @param {((error: unknown) => void) | undefined} onError
 * @param {{ warn?: (msg: string, meta?: Record<string, unknown>) => void }} [logger]
 * @param {boolean} [dev]
 * @param {{ file?: string } | null} [route] the matched page route, for the dedupe key
 */
export function reportFormActionMissing(url, req, formData, onError, logger, dev, route) {
  const willLog = !!(dev && logger && logger.warn);
  const willReport = typeof onError === 'function';
  // Nothing to say: do not spend a dedupe slot, which would let a run with no
  // sink configured quietly consume the cap for one that does.
  if (!willLog && !willReport) return;
  if (!firstSighting(`WEBJS_FORM_ACTION_MISSING ${req.method} ${routeKeyOf(route, url)}`)) return;
  const fields = [...new Set([...formData.keys()])];
  if (willLog) {
    logger.warn(
      `[webjs] a form posted to ${url.pathname} carrying no action identity, so nothing ran (405). Bind the action: <form action=\${yourAction}>.`,
      { fields },
    );
  }
  if (!willReport) return;
  const err = new Error(
    `A form submission to ${url.pathname} carried no \`${FORM_ACTION_FIELD}\` identity, so no server action ran and the request was answered with a 405.`,
  );
  /** @type {any} */ (err).code = 'WEBJS_FORM_ACTION_MISSING';
  /** @type {any} */ (err).method = req.method;
  /** @type {any} */ (err).pathname = url.pathname;
  /** @type {any} */ (err).fields = fields;
  onError(err);
}

/**
 * A page GET carrying `__webjs_action` in the QUERY STRING (#1307). Nothing in
 * this framework ever puts the reserved field in a url, so this can only be a
 * bound submitter submitted through an UNBOUND form: the form defaulted to GET,
 * the browser (or `performSubmission`, which promotes a safe-method body to the
 * query string) put the identity in the url, and the page is about to render as
 * if nothing was submitted.
 *
 * DETECTS ONLY. The GET keeps rendering its 200 page, because answering
 * differently on a query parameter would hand any visitor a way to turn any
 * page into an error.
 *
 * @param {URL} url
 * @param {Request} req
 * @param {((error: unknown) => void) | undefined} onError
 * @param {{ warn?: (msg: string, meta?: Record<string, unknown>) => void }} [logger]
 * @param {boolean} [dev]
 * @param {{ file?: string } | null} [route] the matched page route, for the dedupe key
 */
export function reportFormSubmittedAsGet(url, req, onError, logger, dev, route) {
  // Cheapest possible guard first, and it runs on EVERY page GET: a substring
  // test on the already-parsed `search` string, so the common case never builds
  // a URLSearchParams at all.
  if (!url.search || !url.search.includes(FORM_ACTION_FIELD)) return;
  if (!url.searchParams.has(FORM_ACTION_FIELD)) return;
  const willLog = !!(dev && logger && logger.warn);
  const willReport = typeof onError === 'function';
  if (!willLog && !willReport) return;
  if (!firstSighting(`WEBJS_FORM_SUBMITTED_AS_GET ${req.method} ${routeKeyOf(route, url)}`)) return;
  if (willLog) {
    logger.warn(
      `[webjs] ${url.pathname} was requested with \`${FORM_ACTION_FIELD}\` in the query string, which only a bound submitter inside an UNBOUND <form> produces. The form had no method, so the browser submitted it as a GET, the action never ran, and this page is simply re-rendering. Bind the enclosing form: <form action=\${yourAction}>. The submitter-needs-bound-form rule finds these statically.`,
    );
  }
  if (!willReport) return;
  const err = new Error(
    `A form submission reached ${url.pathname} as a GET with the \`${FORM_ACTION_FIELD}\` identity in the query string, so no server action ran. The submitter's enclosing <form> binds no action.`,
  );
  /** @type {any} */ (err).code = 'WEBJS_FORM_SUBMITTED_AS_GET';
  /** @type {any} */ (err).method = req.method;
  /** @type {any} */ (err).pathname = url.pathname;
  onError(err);
}

/**
 * The submitted TEXT fields as a plain record, for repopulating a form the
 * dispatcher could not run.
 *
 * Files are skipped: a `File` is not a string, and no browser lets a page
 * refill a file input anyway, so carrying one here would only put an object
 * where the page expects text.
 *
 * @param {FormData} formData
 * @returns {Record<string, string>}
 */
function textValuesOf(formData) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of formData) if (typeof v === 'string') out[k] = v;
  return out;
}

/**
 * A page path exists but only renders: the method is the problem, not the url.
 * @returns {Response}
 */
function methodNotAllowed() {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { allow: 'GET, HEAD' },
  });
}

/**
 * Run a bound form action for a non-GET/HEAD request to a page's own url and
 * produce the HTTP response. The caller has already matched the path to a page
 * route and confirmed the request carries a form body; this runs inside the
 * page's segment middleware (the caller wraps it).
 *
 * @param {import('./router.js').PageRoute} route
 * @param {Record<string,string>} params
 * @param {URL} url
 * @param {Request} req
 * @param {object} ssrOpts the same opts object `ssrPage` receives in dev.js
 * @param {{
 *   actionIndex: import('./actions.js').ActionIndex,
 *   allowedOrigins?: string[],
 *   onError?: (error: unknown) => void,
 *   logger?: { warn?: (msg: string, meta?: Record<string, unknown>) => void },
 * }} deps
 * @returns {Promise<Response>}
 */
export async function runFormAction(route, params, url, req, ssrOpts, deps) {
  const { actionIndex, allowedOrigins = [], onError, logger } = deps;

  // Not a form body at all (a stray JSON POST, a probe): the page path exists
  // and only renders. Answered before the body is touched.
  if (!looksLikeFormSubmission(req)) return methodNotAllowed();

  // CSRF, before the body is read and before anything runs. Same Origin /
  // Sec-Fetch-Site check the RPC endpoint applies (`csrf.js`). The page `action`
  // export this replaces had none, and was shielded only by SameSite=Lax cookies.
  const origin = verifyOrigin(req, allowedOrigins);
  if (!origin.ok) return new Response('CSRF validation failed', { status: 403 });

  let formData = new FormData();
  let actionReq = req;
  try {
    const parsed = await parseFormBody(req);
    // Over the form/multipart limit (issue #237): 413 before anything runs.
    if (parsed.tooLarge) return payloadTooLarge();
    formData = parsed.formData;
    actionReq = parsed.request;
  } catch {
    formData = new FormData();
  }

  const actions = formData.getAll(FORM_ACTION_FIELD);
  const id = actions.length ? actions[actions.length - 1] : null;
  // A form body carrying no identity: a hand-written `<form method="post">`
  // that binds no action. Nothing to run, and the page only renders. Reported
  // before the 405 so the shape is not just an anonymous status in an access
  // log.
  //
  // NOT the unparseable-enctype variant of #1307. An `enctype="text/plain"`
  // submission arrives with that content type, so `looksLikeFormSubmission`
  // answers it above, before the body is read and before this point. That is
  // deliberate (buffering an attacker-chosen body to classify it is exactly what
  // the early return avoids), and it means the text/plain variant is visible
  // only as a bare 405. The dev-time client guard covers it instead.
  if (typeof id !== 'string' || !id) {
    reportFormActionMissing(url, req, formData, onError, logger, !!ssrOpts.dev, route);
    return methodNotAllowed();
  }
  // The field is framework wire, not app data. Removing it keeps an action
  // that iterates the FormData (building a record, echoing values back into a
  // 422 re-render) from seeing a key it did not put there.
  formData.delete(FORM_ACTION_FIELD);

  const found = await lookupActionIdentity(actionIndex, id);
  if (!found.ok) {
    // The action's module threw at import (a bad env var read at module scope,
    // a syntax error in dev). That is a server fault, not skew: telling the
    // user to resubmit would loop them forever against a module that cannot
    // load, and swallowing the error would leave nothing in the log or the APM
    // sink. Surface it the way any other action throw is surfaced.
    if (found.reason === 'load-failed') {
      if (typeof onError === 'function') onError(found.error);
      return await formActionErrorResponse(found.error, ssrOpts.dev);
    }
    if (found.reason === 'skew') {
      return ssrPage(route, params, url, {
        ...ssrOpts, req,
        // The submitted values ride along on the standard `actionData.values`
        // key, so the page's ordinary repopulation idiom refills the form and
        // "please submit again" is something a person can actually act on
        // rather than an instruction to retype everything.
        actionData: { success: false, error: ACTION_SKEW_MESSAGE, values: textValuesOf(formData) },
        status: 422,
      });
    }
    return new Response('Unknown action', { status: 404 });
  }

  const { fnName, module: mod } = found;
  const fn = fnName === 'default' ? mod.default : mod[fnName];
  // A reserved config export is never a callable action even though some are
  // functions (#488), so a forged `__webjs_action` naming one is a 404 rather
  // than a way to invoke `validate` directly.
  if (typeof fn !== 'function' || RESERVED_CONFIG.has(fnName)) {
    return new Response('Unknown action', { status: 404 });
  }
  // A GET-declared action cannot be a form target: it is CSRF-exempt and rides
  // its args in the url, so binding one to a POST form is a contradiction. A
  // `webjs check` rule catches it at edit time; this is the runtime backstop.
  if (actionMethod(mod) === 'GET') {
    return new Response(
      `The action ${fnName} declares method = 'GET', so it cannot be bound to a form.`,
      { status: 405, headers: { allow: 'GET' } },
    );
  }

  // A form-bound action always receives the `FormData` (#1155). `validate` is
  // the typing seam: it takes the FormData and its transform-return becomes the
  // action's typed input, the same `runValidate` contract the RPC path uses.
  let args = [formData];
  const validate = actionConfigFn(mod, 'validate');
  if (typeof validate === 'function') {
    const v = runValidate(validate, args[0]);
    if (!v.ok) {
      if (v.thrown !== undefined) {
        // A THROWN validator is answered here rather than rethrown. Letting it
        // escape reaches the handler's last-resort catch, which reports the
        // SAME error to `onError` a second time and answers a bare 500 with no
        // digest, so the one thing that makes a prod error diagnosable is lost.
        // The RPC path does exactly this (`actionErrorResponse` in actions.js).
        if (typeof onError === 'function') onError(v.thrown);
        return await formActionErrorResponse(v.thrown, ssrOpts.dev);
      }
      // A structured failure envelope is a NORMAL result the page renders, so
      // it takes the 422 re-render path exactly as a failing action would.
      return ssrPage(route, params, url, { ...ssrOpts, req, actionData: v.result, status: 422 });
    }
    args = [v.value];
  }

  const searchParams = Object.fromEntries(url.searchParams.entries());
  /** @type {ActionResult | undefined} */
  let result;
  let ranAction = false;
  try {
    const middleware = actionMiddleware(mod);
    result = await runWithActionSignal(actionReq.signal, () =>
      runActionChain(
        middleware,
        {
          request: actionReq,
          args,
          signal: actionReq.signal,
          // Route context a form middleware may want, absent on the RPC path
          // because an RPC call has no page. Params are awaitable AND
          // sync-readable, matching a page render (#848).
          params: makeThenable(params),
          searchParams: makeThenable(searchParams),
          url,
        },
        () => { ranAction = true; return fn(...args); },
      ));
  } catch (err) {
    if (isRedirect(err)) {
      const e = /** @type any */ (err);
      // A thrown redirect from an action (a POST) defaults to 307 Temporary
      // Redirect, which is method-preserving so the action's intent survives
      // the bounce; an explicit `redirect(url, status)` overrides it. This is
      // deliberately NOT the GET gate's 302 default (see ssr.js). PRG (303) is
      // the SUCCESS-result path below.
      return new Response(null, { status: e.status || 307, headers: { location: e.url } });
    }
    if (isNotFound(err)) {
      return ssrNotFound(ssrOpts.notFoundFile ?? null, { ...ssrOpts, req, url });
    }
    // forbidden()/unauthorized() from a form action render the same 403/401
    // boundary as the page-render path (#848), not a generic 500.
    if (isForbidden(err)) return ssrForbidden(route, { ...ssrOpts, req, url });
    if (isUnauthorized(err)) return ssrUnauthorized(route, { ...ssrOpts, req, url });
    if (typeof onError === 'function') onError(err);
    return await formActionErrorResponse(err, ssrOpts.dev);
  }

  // A streamed return (#489) has no consumer here. The RPC stub decodes frames;
  // a form submission is answered with a redirect or a page, and with JS off
  // there is nothing on the other end at all. Refusing loudly beats emitting a
  // frame stream a browser renders as garbage.
  if (ranAction && isStreamable(result)) {
    const err = new Error(
      `The action ${fnName} returned a stream, which a form submission cannot consume. `
      + 'Return an ActionResult from a form-bound action; stream from a programmatic call instead.',
    );
    if (typeof onError === 'function') onError(err);
    return await formActionErrorResponse(err, ssrOpts.dev);
  }

  // Only a COMPLETED action evicts its `invalidates` tags; a middleware
  // short-circuit (the action never ran) does not.
  //
  // The tags are also REPORTED, the way `invokeAction` reports them, so the
  // browser-side tag coordinator can bypass a stale cached GET. One reach
  // limit, stated because it looks like an oversight: `fetch` follows the 303
  // transparently, so JS cannot read the headers of a redirect response. The
  // header is on the wire and the 422 re-render path carries it to the router;
  // after a successful PRG the client learns nothing from it. The redirect's
  // own re-render is server-side and seeds fresh data, so what remains exposed
  // is only a later client refetch of a separately cached GET key.
  let invalidated = [];
  if (ranAction) {
    invalidated = resolveTags(actionConfigFn(mod, 'invalidates'), args);
    if (invalidated.length) await revalidateTags(invalidated);
  }
  const invalidateHeader = invalidated.length
    ? { 'x-webjs-invalidate': invalidated.join(',') }
    : null;

  // An action MAY return a `Response` directly (e.g. a content-negotiated
  // `streamResponse`, #248). Honor it verbatim, so the action owns the status +
  // content type and the router applies it (a stream body surgically). With JS
  // off the same action returns a normal ActionResult instead, so the PRG /
  // re-render paths below still drive the no-JS form.
  if (result instanceof Response) return result;

  if (!isFailureResult(result)) {
    // SUCCESS: Post/Redirect/Get. A user-controlled `result.redirect` is only
    // honored when it is a same-site local path; otherwise fall back to the
    // page's own path so a poisoned value cannot become an open redirect.
    const ownPath = (url.pathname + url.search) || '/';
    const safe = result ? sameSiteRedirect(result.redirect) : null;
    return new Response(null, {
      status: 303,
      headers: { location: safe || ownPath, ...invalidateHeader },
    });
  }

  // FAILURE: re-render the SAME page with the action result available on
  // ctx.actionData, status 422. Repopulation is the page author's job (native
  // `value=${actionData.values?.field}`).
  const status = typeof result.status === 'number' && result.status >= 400 ? result.status : 422;
  const page = await ssrPage(route, params, url, { ...ssrOpts, req, actionData: result, status });
  // A failure result can still have mutated (a partial write, then a rejected
  // second step), so the eviction above applies here too and this response, not
  // being a redirect, is one the router can actually read the header off.
  if (invalidateHeader && page instanceof Response) {
    for (const [k, v] of Object.entries(invalidateHeader)) page.headers.set(k, v);
  }
  return page;
}

/**
 * A thrown form action becomes a 500 whose body is sanitized the same way the
 * RPC path's is (#749): dev shows the real message, prod shows a generic one
 * plus a correlation digest and logs the full error. A raw driver message or an
 * fs path is not author-controlled, so it does not reach the browser, and here
 * the browser is showing it to a person rather than parsing it.
 *
 * @param {unknown} err
 * @param {boolean} [dev]
 * @returns {Promise<Response>}
 */
async function formActionErrorResponse(err, dev) {
  if (dev) {
    console.error('[webjs] form action threw:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(msg, { status: 500 });
  }
  if (isControlFlowThrow(err)) {
    console.error('[webjs] form action threw:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(msg, { status: 500 });
  }
  const digest = await errorDigest(err);
  console.error(`[webjs] form action threw [digest=${digest}]:`, err);
  return new Response(`${GENERIC_ERROR_MESSAGE} (digest ${digest})`, { status: 500 });
}
