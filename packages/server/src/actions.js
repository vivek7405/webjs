import { digestHex } from './crypto-utils.js';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { walk } from './fs-walk.js';
import { verifyOrigin } from './csrf.js';
import { getSerializer } from './serializer.js';
import { readTextBounded, payloadTooLarge, DEFAULT_MAX_BODY_BYTES } from './body-limit.js';
import {
  actionMethod, actionFunctionNames, actionCache, actionConfigFn, resolveTags,
  cacheControlFor, allowedRequestMethods, URL_ARG_VERBS, SAFE_VERBS, MAX_URL_ARGS,
  RESERVED_CONFIG, actionMiddleware,
} from './action-config.js';
import { revalidateTags } from './cache-tags.js';
import { runWithActionSignal } from './action-signal.js';
import { runActionChain } from './action-middleware.js';
import { isStreamable, streamActionResponse } from './action-stream.js';
import { isControlFlowThrow, errorDigest, GENERIC_ERROR_MESSAGE } from './action-error.js';
import { ifNoneMatchSatisfied } from './conditional-get.js';
import { getBodyLimits } from './context.js';
import { basePath } from './importmap.js';
import { withBasePath } from './base-path.js';
import { FORM_ACTION_ID_KEY } from '@webjsdev/core';

/**
 * The JSON / RPC body cap in effect for the current request: the per-request
 * limit the handler stamped, or the secure default outside a request scope (a
 * direct unit-test invocation). `0` disables the cap.
 * @returns {number}
 */
function jsonBodyLimit() {
  const limits = getBodyLimits();
  return limits ? limits.json : DEFAULT_MAX_BODY_BYTES;
}

/**
 * Internal RPC wire-format content type. Distinguishes WebJs action
 * responses from plain `application/json` so the stub can pick the right
 * parser and external JSON consumers aren't confused.
 *
 * Uses the content type from the active serializer (defaults to
 * `application/vnd.webjs+json` with the built-in WebJs serializer).
 */
export const RPC_CONTENT_TYPE = 'application/vnd.webjs+json';

/**
 * Run an attached input validator against an action's input, shared by the RPC
 * path (`invokeAction`) and the `route()` REST adapter so the contract is
 * identical across transports (#245). The framework only CALLS the validator and
 * shapes the result; it ships no validation library.
 *
 * @param {(input: any) => any} validate the attached validator
 * @param {any} input the value handed to the validator (the action's first arg
 *   on RPC, the merged query/params/body object on REST)
 * @returns {{ ok: true, value: any } | { ok: false, result: { success: false, fieldErrors?: Record<string,string>, error?: string, status: number }, thrown?: unknown }}
 *   `ok: true` carries the value to pass to the action (the validated `data`,
 *   the transformed return, or the original input). `ok: false` carries the
 *   structured failure result the caller serializes back; on a THROWN validator
 *   it also carries the original error on `thrown` so a caller can salvage a
 *   schema lib's structured `issues` (the REST path does, for back-compat).
 */
export function runValidate(validate, input) {
  let out;
  try {
    out = validate(input);
  } catch (e) {
    // Throw-to-reject (the classic `Schema.parse` contract). Map to a sanitized
    // failure result; a thrown validator is a 400 (bad input), not a 500.
    // Surface only the message; `thrown` lets the REST caller recover `issues`.
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, result: { success: false, error: msg, status: 400 }, thrown: e };
  }
  // Disambiguate an ActionResult envelope from a plain transformed value: a
  // return is an envelope ONLY when it is an object carrying a boolean
  // `success` OR a `fieldErrors`. Anything else is a transformed input.
  if (out && typeof out === 'object' && !Array.isArray(out) &&
      (typeof (/** @type any */ (out).success) === 'boolean' || 'fieldErrors' in out)) {
    const env = /** @type any */ (out);
    if (env.success === true) {
      // `{ success: true, data? }` → valid; use `data` when present, else input.
      return { ok: true, value: 'data' in env ? env.data : input };
    }
    // Failure: `{ success: false, ... }` or `{ fieldErrors }` (no literal
    // success). Shape the structured field-error result.
    return {
      ok: false,
      result: {
        success: false,
        ...(env.fieldErrors ? { fieldErrors: env.fieldErrors } : {}),
        ...(env.message || env.error ? { error: env.message || env.error } : {}),
        status: typeof env.status === 'number' ? env.status : 422,
      },
    };
  }
  // A non-envelope return transforms the input (back-compat with
  // `validate: Schema.parse`); `undefined` means "no transform", keep input.
  return { ok: true, value: out === undefined ? input : out };
}

/** Build a serialized Response with webjs content-type. */
async function rpcResponse(payload, init = {}) {
  const s = getSerializer();
  const headers = new Headers(init.headers || {});
  headers.set('content-type', s.contentType);
  return new Response(await s.serialize(payload), { ...init, headers });
}

/**
 * Server-actions subsystem.
 *
 * Two complementary markers describe server-side files:
 *
 *   - `.server.{js,ts,mts,mjs}` extension: file is **server-only**. The
 *     file router refuses to serve its source to the browser. This is
 *     the path-level boundary.
 *   - `'use server'` directive at the top: file's exports are
 *     **RPC-callable** from client code. This is the semantic opt-in.
 *
 * The two together (`.server.ts` AND `'use server'`) define a server
 * action: source-protected AND RPC-exposed. The extension alone marks
 * a server-only utility (source-protected, NOT RPC-exposed: browser
 * imports get an error stub that throws at load). The directive alone
 * (no extension) does nothing: a `webjs check` lint rule
 * (`use-server-needs-extension`) flags it because the file is served
 * to the browser as plain source and the directive is silently
 * ignored.
 *
 * The server:
 *   1. Scans the app tree lazily on the first request (in `ensureReady`),
 *      classifying server files into RPC-callable actions vs. server-only
 *      utilities. Hashing is eager-per-file; no module is loaded here.
 *   2. Serves a generated ES-module stub when the browser imports
 *      the file URL (an RPC stub for actions, a throw-at-load stub
 *      for server-only utilities).
 *   3. Exposes endpoints at /__webjs/action/:hash/:fn for
 *      RPC-callable actions only. A public REST endpoint is a `route.ts`
 *      that imports and calls the action (optionally via the `route()`
 *      adapter in `action-route.js`).
 *
 * @typedef {{
 *   hashToFile: Map<string,string>,
 *   fileToHash: Map<string,string>,
 *   appDir: string,
 *   dev: boolean,
 * }} ActionIndex
 */

/**
 * Build the action index by scanning the app directory. This is a pure
 * file -> hash mapping: it walks `app/`, classifies `.server.*` + `'use server'`
 * files as RPC-callable actions, and records the hash both ways. It loads NO
 * module (the hash index is all the analysis needs; a module is imported on
 * demand by `invokeAction` / `serveActionStub`), so it is safe for a read-only
 * introspection caller (the MCP `list_actions` tool, #262) with no top-level
 * side effects (DB driver init, DB connect).
 *
 * @param {string} appDir
 * @param {boolean} dev
 * @returns {Promise<ActionIndex>}
 */
export async function buildActionIndex(appDir, dev) {
  /** @type {Map<string,string>} */
  const hashToFile = new Map();
  /** @type {Map<string,string>} */
  const fileToHash = new Map();

  for await (const file of walk(appDir, (p) => /\.m?[jt]s$/.test(p))) {
    // Path-level: only `.server.{ts,js,mts,mjs}` files are server-only.
    // A bare `'use server'` directive without the extension is a lint
    // violation (use-server-needs-extension) and the file is treated as
    // plain browser code: no source protection, no RPC registration.
    if (!isServerFile(file)) continue;
    // Semantic-level: only files that ALSO have `'use server'` are
    // RPC-callable. `.server.ts` without the directive is server-only
    // (still source-protected by the file router) but its exports are
    // NOT registered as RPC endpoints. The browser-side import gets a
    // throw-at-load stub via `serveServerOnlyStub` instead.
    if (!(await hasUseServerDirective(file))) continue;

    const h = await hashFile(file);
    hashToFile.set(h, file);
    fileToHash.set(file, h);
    // Pure-RPC actions are NOT executed at boot: invokeAction and
    // serveActionStub import the module on demand (first RPC call / first stub
    // fetch), so the hash index above is all the analysis needs. Eagerly
    // running every server module (and its transitive DB driver init, DB
    // connects, etc.) would be wasted work.
  }

  return { hashToFile, fileToHash, appDir, dev };
}

/** @param {string} file @returns {Promise<string>} */
export async function hashFile(file) {
  return (await digestHex('SHA-256', file)).slice(0, 10);
}

/**
 * Predicate: file is server-only (source-protected, never served as
 * source to the browser). True for `.server.{js,ts,mts,mjs}` files.
 * Synchronous, name-only check, the path-level boundary.
 *
 * The `'use server'` directive without the extension does NOT make a
 * file server-only: a `webjs check` lint rule
 * (`use-server-needs-extension`) flags that pattern instead, and the
 * file is treated as plain browser code.
 *
 * @param {string} file
 * @returns {boolean}
 */
export function isServerFile(file) {
  return /\.server\.m?[jt]s$/.test(file);
}

/**
 * Predicate: file has the `'use server'` directive in its first 5 lines.
 * Semantic-level marker: when paired with `.server.ts`, registers the
 * file's exports as RPC-callable from client code.
 *
 * @param {string} file
 * @returns {Promise<boolean>}
 */
export async function hasUseServerDirective(file) {
  try {
    const text = await readFile(file, 'utf8');
    const head = text.split('\n').slice(0, 5).join('\n');
    return /^\s*(['"])use server\1\s*;?\s*$/m.test(head);
  } catch {
    return false;
  }
}

/**
 * Predicate: file is a server action (server-only + RPC-callable).
 * True when both markers are present: `.server.{js,ts}` extension AND
 * `'use server'` directive.
 *
 * @param {string} file
 * @returns {Promise<boolean>}
 */
export async function isServerAction(file) {
  if (!isServerFile(file)) return false;
  return await hasUseServerDirective(file);
}

/**
 * @param {ActionIndex} idx
 * @param {string} urlPath A browser-visible URL path like `/actions/foo.server.js`
 */
export function resolveServerModule(idx, urlPath) {
  const abs = join(idx.appDir, urlPath.split('/').join(sep));
  return idx.fileToHash.has(abs) ? abs : null;
}

/**
 * Generate a throw-at-load stub for a server-only file (a `.server.ts`
 * file WITHOUT a `'use server'` directive). When a browser-side module
 * imports this file, the stub throws synchronously at module load time
 * with a clear error pointing at the file, so the developer immediately
 * sees that server-only code can't be reached from the browser.
 *
 * @param {string} relPath path relative to appDir for the error message
 * @returns {string} JavaScript module source
 */
export function serveServerOnlyStub(relPath) {
  const msg =
    `Cannot import "${relPath}" from browser code. ` +
    `This file is server-only (a .server.{js,ts} file with no 'use server' directive). ` +
    `Either add 'use server' at the top of the file to expose its exports as RPC, ` +
    `or wrap the server-only logic in a separate *.server.{js,ts} action and import that instead. ` +
    `Docs: https://webjs.dev/docs/server-actions`;
  return `// webjs: server-only module stub for ${relPath} (no 'use server' directive)
throw new Error(${JSON.stringify(msg)});
`;
}

/**
 * Serve the generated client stub for a server module.
 * @param {ActionIndex} idx
 * @param {string} absFile
 */
export async function serveActionStub(idx, absFile) {
  const mod = await loadModule(absFile, idx.dev);
  const hash = idx.fileToHash.get(absFile) || await hashFile(absFile);
  // HTTP-verb actions (#488): the file declares its verb via `export const
  // method` (default POST). The function exports are the actions; the reserved
  // config exports (method/cache/tags/invalidates/validate/middleware) are excluded.
  const fnNames = actionFunctionNames(mod);
  const method = actionMethod(mod);
  // The RPC endpoint is a framework-emitted same-origin URL, so it must
  // carry the basePath prefix under a sub-path deploy (#256), exactly like
  // the importmap targets and the boot module specifiers. Without this the
  // stub would POST to a bare /__webjs/action/... that the ingress strip
  // 404s, breaking every server action when webjs.basePath is set.
  const actionUrl = withBasePath(`/__webjs/action/${hash}/`, basePath());
  const body = buildStubBody({ hash, method, fnNames, actionUrl });
  return body;
}

/**
 * Build the generated client stub source for a `'use server'` action file. The
 * transport depends on the file's declared `method`:
 *   - GET: args ride the URL (`?a=`), the SSR seed (#472) is read first, the
 *     browser HTTP cache is consulted, and a tag-invalidated key revalidates;
 *     CSRF-exempt (a safe read). Over-large args fall back to a POST.
 *   - DELETE: args ride the URL, CSRF-protected, over-large args fall back to a
 *     POST.
 *   - POST / PUT / PATCH: rich body, CSRF-protected.
 * Every path reads `X-Webjs-Invalidate` (mark tags stale) and a GET reads
 * `X-Webjs-Tags` (register the key's tags), so a later read sees a mutation.
 * @param {{ hash: string, method: string, fnNames: string[], actionUrl: string }} opts
 * @returns {string}
 */
function buildStubBody({ hash, method, fnNames, actionUrl }) {
  const URL_ARG = URL_ARG_VERBS.has(method);
  const J = JSON.stringify;
  const lines = [];
  lines.push(`// webjs: generated server-action stub (${method})`);
  // Every verb reads the SSR seed (#472) first: an async-render READ invoked
  // during SSR is seeded regardless of its declared verb (a read with no
  // `method` is a default POST), so the first client call resolves from the
  // seed with no hydration round-trip. The browser-cache staleness check is
  // GET-only (only a GET is browser-cached).
  const imports = ['stringify as __s', 'parse as __p', 'takeSeed as __seedTake', 'SEED_MISS as __MISS', 'markStale as __markStale', 'parseTagHeader as __tagHdr', 'activeActionSignal as __sig',
    // Streaming RPC (#489): an action returning a stream / async iterable sends
    // back a framed body; the stub decodes it into an async iterable the caller
    // `for await`s. The imports are small constants + one decoder factory.
    'STREAM_CONTENT_TYPE as __STREAM_CT', 'createFrameDecoder as __frameDec', 'FRAME_CHUNK as __F_CHUNK', 'FRAME_END as __F_END', 'FRAME_ERROR as __F_ERR'];
  if (method === 'GET') {
    imports.push('registerKeyTags as __regTags', 'consumeStale as __stale', 'fetchMark as __mark');
  }
  lines.push(`import { ${imports.join(', ')} } from '@webjsdev/core';`);
  lines.push(`const __URL = ${J(actionUrl)};`);
  lines.push(`const __HASH = ${J(hash)};`);
  lines.push(`const __METHOD = ${J(method)};`);
  lines.push(`const __MAX = ${MAX_URL_ARGS};`);
  lines.push(`const __CT = ${J(RPC_CONTENT_TYPE)};`);
  // CSRF is enforced server-side by an Origin-header check, so the stub sends
  // nothing extra: the browser attaches `Origin` to a same-origin POST itself.
  // Shared: parse a response, surface invalidation, register a GET's tags
  // (stamped with the clock SAMPLED BEFORE the fetch, so a mutation in flight is
  // caught on the next read).
  lines.push(`async function __handle(res, fn, key, since) {`);
  lines.push(`  const inv = __tagHdr(res.headers.get('x-webjs-invalidate')); if (inv.length) __markStale(inv);`);
  lines.push(`  if (key != null) { const t = __tagHdr(res.headers.get('x-webjs-tags')); if (t.length) __regTags(key, t, since); }`);
  lines.push(`  const ct = res.headers.get('content-type') || '';`);
  // A streamed result (#489): the action returned a stream / async iterable.
  // Return an async iterable that decodes the framed body and yields each
  // deserialized chunk. The response is 200 (the stream started), so errors
  // arrive as ERROR frames, not an HTTP status.
  lines.push(`  if (ct.includes(__STREAM_CT)) return __readStream(res, fn);`);
  lines.push(`  const text = await res.text();`);
  lines.push(`  const parsed = ct.includes(__CT) ? __p(text) : (ct.includes('application/json') ? JSON.parse(text) : text);`);
  lines.push(`  if (!res.ok) { const __e = new Error((parsed && parsed.error) || ('webjs action ' + fn + ' -> ' + res.status)); if (parsed && parsed.digest) __e.digest = parsed.digest; throw __e; }`);
  lines.push(`  return parsed;`);
  lines.push(`}`);
  // Decode a framed streamed body into an async generator of rich-deserialized
  // chunks. A CHUNK frame yields a value, END returns, ERROR throws the
  // (author-controlled) message. The reader is released on completion / abort.
  lines.push(`async function* __readStream(res, fn) {`);
  lines.push(`  if (!res.body) throw new Error('webjs stream ' + fn + ' has no body');`);
  lines.push(`  const reader = res.body.getReader();`);
  lines.push(`  const dec = __frameDec();`);
  lines.push(`  const td = new TextDecoder();`);
  lines.push(`  let ended = false;`);
  lines.push(`  try {`);
  lines.push(`    for (;;) {`);
  lines.push(`      const { value, done } = await reader.read();`);
  lines.push(`      if (done) break;`);
  lines.push(`      for (const f of dec.push(value)) {`);
  lines.push(`        if (f.type === __F_CHUNK) yield __p(td.decode(f.payload));`);
  lines.push(`        else if (f.type === __F_END) { ended = true; return; }`);
  lines.push(`        else if (f.type === __F_ERR) throw new Error(td.decode(f.payload) || ('webjs stream ' + fn));`);
  lines.push(`      }`);
  lines.push(`    }`);
  // The body ended without a terminal END/ERROR frame: the stream was truncated
  // (a server crash, a dropped connection, an upstream timeout). A healthy
  // stream always ends in END or ERROR, so surface this as an error rather than
  // a silent clean completion. (A consumer that breaks early goes through the
  // generator's return(), which skips this and runs only the finally.)
  lines.push(`    if (!ended) throw new Error('webjs stream ' + fn + ' truncated (no end frame)');`);
  lines.push(`  } finally { try { reader.cancel(); } catch {} try { reader.releaseLock(); } catch {} }`);
  lines.push(`}`);
  // Body sender (POST/PUT/PATCH, and the URL-arg too-large fallback). `sig` is
  // captured SYNCHRONOUSLY at __call entry (#492): the active render signal must
  // be read before the stub's first await (stringify), or the render's
  // synchronous window has already closed and cleared it.
  lines.push(`async function __body(fn, body, m, sig) {`);
  lines.push(`  const headers = { 'content-type': __CT };`);
  lines.push(`  const res = await fetch(__URL + fn, { method: m, headers, credentials: 'same-origin', body, signal: sig });`);
  lines.push(`  return __handle(res, fn, null);`);
  lines.push(`}`);
  if (URL_ARG) {
    // GET/DELETE: args in the URL, with a POST fallback when too large.
    lines.push(`async function __call(fn, args) {`);
    lines.push(`  const sig = __sig();`); // sync capture before any await
    lines.push(`  const key = await __s(args);`);
    lines.push(`  const seeded = __seedTake(__HASH, fn, key); if (seeded !== __MISS) return seeded;`);
    lines.push(`  if (key.length > __MAX) return __body(fn, key, 'POST', sig);`);
    if (method === 'GET') {
      lines.push(`  const bypass = __stale(key);`);
      lines.push(`  const since = __mark();`);
      lines.push(`  const res = await fetch(__URL + fn + '?a=' + encodeURIComponent(key), { method: 'GET', credentials: 'same-origin', cache: bypass ? 'no-cache' : 'default', signal: sig });`);
      lines.push(`  return __handle(res, fn, key, since);`);
    } else {
      lines.push(`  const res = await fetch(__URL + fn + '?a=' + encodeURIComponent(key), { method: __METHOD, credentials: 'same-origin', signal: sig });`);
      lines.push(`  return __handle(res, fn, null);`);
    }
    lines.push(`}`);
  } else {
    // POST/PUT/PATCH: rich body. The seed read makes a default-POST async-render
    // read resolve from the SSR seed on hydration (#472); a true mutation is
    // never SSR-invoked, so the seed simply misses.
    lines.push(`async function __call(fn, args) {`);
    lines.push(`  const sig = __sig();`); // sync capture before any await
    lines.push(`  const key = await __s(args);`);
    lines.push(`  const seeded = __seedTake(__HASH, fn, key); if (seeded !== __MISS) return seeded;`);
    lines.push(`  return __body(fn, key, __METHOD, sig);`);
    lines.push(`}`);
  }
  // Each stub carries its own `<hash>/<fn>` identity (#1155), so a client
  // re-render of `<form action=${action}>` can bind the live form
  // synchronously. The server resolves the REAL function's identity through the
  // load-hook registry instead; both produce the same string, which is what
  // makes the SSR'd form and the re-rendered one submit the same value.
  // Non-enumerable so `import * as actions` and a spread stay unchanged.
  lines.push(`const __id = (fn, name) => { try { Object.defineProperty(fn, ${J(FORM_ACTION_ID_KEY)}, { value: __HASH + '/' + name }); } catch {} return fn; };`);
  for (const name of fnNames) {
    lines.push(
      name === 'default'
        ? `export default __id((...args) => __call('default', args), 'default');`
        : `export const ${name} = __id((...args) => __call(${J(name)}, args), ${J(name)});`,
    );
  }
  return lines.join('\n') + '\n';
}

/**
 * Invoke a server action via the internal RPC wire format.
 * @param {ActionIndex} idx
 * @param {string} hash
 * @param {string} fnName
 * @param {Request} req
 * @param {(error: unknown) => void} [onError] best-effort sink (issue #239)
 *   invoked when the action throws unexpectedly, BEFORE the sanitized 500 is
 *   returned, so an APM integration sees the original error. The caller wraps
 *   it so a throwing sink can never affect the response.
 * @param {string[]} [allowedOrigins] cross-site origins the CSRF check allows
 *   (the app's `webjs.allowedOrigins`), for reverse-proxy / multi-domain setups.
 */
export async function invokeAction(idx, hash, fnName, req, onError, allowedOrigins = []) {
  const file = idx.hashToFile.get(hash);
  if (!file) return rpcResponse({ error: 'Unknown action' }, { status: 404 });
  const mod = await loadModule(file, idx.dev);
  const fn = fnName === 'default' ? mod.default : mod[fnName];
  // A reserved config export (method/cache/tags/invalidates/validate/middleware) is never
  // a callable action even though some are functions (#488).
  if (typeof fn !== 'function' || RESERVED_CONFIG.has(fnName)) {
    return rpcResponse({ error: `Unknown action ${fnName}` }, { status: 404 });
  }

  // HTTP-verb dispatch (#488). The action declares its method (default POST). A
  // URL-arg verb (GET/DELETE) also accepts a POST fallback for over-large args.
  const method = actionMethod(mod);
  const reqMethod = req.method.toUpperCase();
  const allowed = allowedRequestMethods(method);
  if (!allowed.has(reqMethod)) {
    return rpcResponse(
      { error: `expected ${method} for ${fnName}, got ${reqMethod}` },
      { status: 405, headers: { allow: [...allowed].join(', ') } },
    );
  }
  // CSRF: an Origin-header check on every state-changing verb (a safe GET is a
  // read with no state change). A browser sets `Origin` on a cross-site POST to
  // the ATTACKER's origin, so a forged request fails the host match. No token
  // or cookie is involved, which keeps SSR HTML free of `Set-Cookie` and so
  // CDN-cacheable. See csrf.js.
  if (!SAFE_VERBS.has(method)) {
    const v = verifyOrigin(req, allowedOrigins);
    if (!v.ok) return rpcResponse({ error: 'CSRF validation failed' }, { status: 403 });
  }

  // Args ride the URL for a URL-arg request (GET / DELETE), else the body.
  let args = [];
  const fromUrl = reqMethod === 'GET' || reqMethod === 'DELETE';
  try {
    if (fromUrl) {
      const a = new URL(req.url).searchParams.get('a');
      args = a ? getSerializer().deserialize(a) : [];
    } else {
      const { tooLarge, text: body } = await readTextBounded(req, jsonBodyLimit());
      if (tooLarge) return payloadTooLarge();
      args = body ? getSerializer().deserialize(body) : [];
    }
    if (!Array.isArray(args)) args = [args];
  } catch {
    return rpcResponse({ error: 'Invalid request body' }, { status: 400 });
  }
  // Input validation (#245): a validator declared via the `validate` config
  // export (#488) runs SERVER-SIDE before the body on this RPC path. The RPC
  // stub sends an args array; an action conventionally takes one input object,
  // so validate the FIRST arg. Validation is a BOUNDARY concern: it runs on
  // this RPC boundary (and the `route()` REST adapter), never on a direct
  // server-to-server call.
  const validate = actionConfigFn(mod, 'validate');
  if (typeof validate === 'function') {
    const v = runValidate(validate, args[0]);
    if (!v.ok) {
      if (v.thrown !== undefined) {
        // A THROWN validator behaves like a thrown action: a sanitized error
        // response (non-200, so the client stub throws), with prod stack
        // sanitization. The onError sink sees the original error too.
        if (typeof onError === 'function') onError(v.thrown);
        return actionErrorResponse(v.thrown, idx.dev);
      }
      // A structured `{ success: false, fieldErrors }` envelope is a NORMAL
      // result the action author renders (`result.fieldErrors`): serialized as
      // a 200 RPC payload so the client stub returns it as a real object rather
      // than throwing, the failure status riding inside the envelope.
      return rpcResponse(v.result);
    }
    args = [v.value, ...args.slice(1)];
  }
  try {
    // Run inside the request's AbortSignal scope (#492) and the per-action
    // middleware chain (#490): the chain wraps the action, can short-circuit
    // (an auth middleware returning an ActionResult), and accumulates context
    // the action reads via actionContext(). `ranAction` distinguishes a real
    // action completion from a middleware short-circuit (the action never ran).
    const middleware = actionMiddleware(mod);
    let ranAction = false;
    const result = await runWithActionSignal(req.signal, () =>
      runActionChain(middleware, { request: req, args, signal: req.signal }, () => { ranAction = true; return fn(...args); }));
    // Streaming result (#489): a COMPLETED action returning a ReadableStream /
    // async iterable streams its chunks over the RPC wire instead of buffering.
    // A streamed result is never cached, ETagged, or seeded (it is not a
    // serializer-safe value). A middleware short-circuit (the action never ran)
    // is a plain envelope and falls through to the normal verb handling below.
    if (ranAction && isStreamable(result)) {
      const headers = {};
      if (method !== 'GET') {
        const inv = resolveTags(actionConfigFn(mod, 'invalidates'), args);
        if (inv.length) { await revalidateTags(inv); headers['x-webjs-invalidate'] = inv.join(','); }
      }
      return streamActionResponse(result, { signal: req.signal, onError, headers, dev: idx.dev });
    }
    if (method === 'GET') {
      // A short-circuit (the action did not run, e.g. an auth denial) is NEVER
      // cached: serve the envelope no-store so a denial is not stored or shared.
      if (!ranAction) return rpcResponse(result ?? null, { headers: { 'cache-control': 'no-store' } });
      return await getActionResponse(result, mod, args, req);
    }
    // A mutation (POST/PUT/PATCH/DELETE): only a COMPLETED action evicts its
    // `invalidates` tags; a short-circuit (the action never ran) does not.
    const headers = {};
    if (ranAction) {
      const inv = resolveTags(actionConfigFn(mod, 'invalidates'), args);
      if (inv.length) {
        await revalidateTags(inv);
        headers['x-webjs-invalidate'] = inv.join(',');
      }
    }
    return rpcResponse(result ?? null, { headers });
  } catch (e) {
    if (typeof onError === 'function') onError(e);
    return actionErrorResponse(e, idx.dev);
  }
}

/**
 * Build a GET action's response (#488): the serialized body plus a weak ETag
 * (content hash), the `Cache-Control` from the `cache` config (else `no-store`),
 * and `X-Webjs-Tags`. Answers `If-None-Match` with a 304 itself rather than
 * deferring to the conditional-GET funnel: this branch already hashed the
 * serialized body, so it can answer without the funnel re-reading it. (The
 * funnel would now accept these too, since #1140 stopped excluding `private`,
 * but the short-circuit here still runs first and is cheaper.)
 * @param {unknown} result
 * @param {Record<string, unknown>} mod
 * @param {unknown[]} args
 * @param {Request} req
 * @returns {Promise<Response>}
 */
async function getActionResponse(result, mod, args, req) {
  const s = getSerializer();
  const bodyStr = await s.serialize(result ?? null);
  const cache = actionCache(mod);
  const etag = `W/"${(await digestHex('SHA-256', bodyStr)).slice(0, 16)}"`;
  const headers = new Headers({ 'content-type': s.contentType, etag });
  headers.set('cache-control', cacheControlFor('GET', cache) || 'no-store');
  if (cache) {
    const tags = resolveTags(actionConfigFn(mod, 'tags'), args);
    if (tags.length) headers.set('x-webjs-tags', tags.join(','));
  }
  if (ifNoneMatchSatisfied(req.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(bodyStr, { status: 200, headers });
}

/**
 * Return a JSON error response with dev-vs-prod sanitization (#749).
 *
 * Dev returns the real message + stack. PROD returns a GENERIC message plus a
 * short `digest`, and logs the full error server-side keyed by that digest, so
 * a raw error (a DB driver message with a constraint name, an `ECONNREFUSED`
 * with an internal IP, an fs path) never reaches the client while staying
 * diagnosable from the logs. `redirect()` / `notFound()` control-flow sentinels
 * pass through unchanged (not errors, message not sensitive). An author-facing
 * user-safe message belongs on the `ActionResult` `{ success: false, error }`
 * envelope, not on a throw.
 *
 * @param {unknown} err
 * @param {boolean} dev
 * @returns {Promise<Response>}
 */
async function actionErrorResponse(err, dev) {
  if (dev) {
    console.error('[webjs] action threw:', err);
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return rpcResponse({ error: msg, stack }, { status: 500 });
  }
  // Control-flow sentinels (redirect/notFound) are not errors to sanitize.
  if (isControlFlowThrow(err)) {
    console.error('[webjs] action threw:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return rpcResponse({ error: msg }, { status: 500 });
  }
  // Prod genuine error: generic message + correlation digest, full error logged.
  const digest = await errorDigest(err);
  console.error(`[webjs] action threw [digest=${digest}]:`, err);
  return rpcResponse({ error: GENERIC_ERROR_MESSAGE, digest }, { status: 500 });
}

/**
 * @param {string} file
 * @param {boolean} dev
 */
async function loadModule(file, dev) {
  const url = pathToFileURL(file).toString();
  const bust = dev ? `?t=${Date.now()}-${Math.random().toString(36).slice(2)}` : '';
  return import(url + bust);
}
