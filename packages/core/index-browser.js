/**
 * webjs/core BROWSER public surface.
 *
 * Mirror of `./index.js` but with strictly server-only exports
 * removed so the browser bundle never drags `src/render-server.js`
 * (~1100 lines) over the wire.
 *
 * Stripped:
 *   - `renderToString`, `renderToStream` (server SSR pipeline; reach
 *     for `@webjsdev/core/server` if you need them in a Node test).
 *   - `setCspNonceProvider`, `setAssetUrlProvider` and
 *     `setFormActionResolver` (server-side wiring called by
 *     `@webjsdev/server`; the reader halves stay, because a layout
 *     can call `cspNonce()` / `asset()`).
 *
 * The framework's own SSR pipeline runs on Node and resolves the
 * package via the package.json `"default"` condition, which still
 * lands on `./index.js` (or its bundled equivalent). Browser routing
 * is done by `packages/server/src/importmap.js`, which points
 * `@webjsdev/core` at THIS file (workspace dev) or its bundled
 * sibling `dist/webjs-core-browser.js` (post-`build:dist`).
 *
 * Keep this list in sync with `./index.js` for everything else.
 */

export { html, isTemplate, MARKER } from './src/html.js';
export { css, isCSS, adoptStyles, stylesToString } from './src/css.js';
export { WebComponent, prop } from './src/component.js';
export { register, lookup, lookupModuleUrl, isLazy, allTags, primeModuleUrl, tagOf } from './src/registry.js';
export { render } from './src/render-client.js';
export { escapeText, escapeAttr } from './src/escape.js';
export { notFound, redirect, forbidden, unauthorized, isNotFound, isRedirect, isForbidden, isUnauthorized } from './src/nav.js';
export { cspNonce } from './src/csp-nonce.js';
export { asset } from './src/asset-url.js';
// Form actions (#1155). The field name is shared with the server dispatcher;
// `setFormActionResolver` is server-only wiring and is stripped here, because
// a browser stub carries its own identity and needs no resolver.
export { FORM_ACTION_FIELD, FORM_ACTION_ID_KEY } from './src/form-action.js';
export { repeat, isRepeat } from './src/repeat.js';
export { Suspense, isSuspense } from './src/suspense.js';
export { connectWS } from './src/websocket-client.js';
export { richFetch } from './src/rich-fetch.js';
export {
  stringify, parse,
  serialize, deserialize,
} from './src/serialize.js';
// The client router auto-enables on bundle load: `router-client.js` calls
// `enableClientRouter()` at module end (idempotent). This is INTENTIONAL, so
// any page that loads `@webjsdev/core` (i.e. ships any component) gets client
// navigation with no per-app opt-in. A layout no longer needs to
// `import '@webjsdev/core/client-router'`. The bare side-effect import below
// pins that contract even if the named re-export is later refactored away;
// the re-export still also evaluates the module, so the two are belt-and-
// suspenders, not a double-enable (ESM evaluates once, enable is idempotent).
import './src/router-client.js';
// `loadFrame` is here (and in `./index.js`, keeping the two symmetric) because
// `@webjsdev/core/client-router`'s `default` condition points at THIS bundle, so
// in dist mode the subpath resolves here while its published `types`
// (`src/router-client.d.ts`) declare all five public router functions. Without
// it, `import { loadFrame } from '@webjsdev/core/client-router'` type-checks,
// works in dev (where the subpath maps to `src/router-client.js`) and is
// `undefined` in production.
export { enableClientRouter, disableClientRouter, navigate, revalidate, loadFrame } from './src/router-client.js';
export { WebjsFrame } from './src/webjs-frame.js';
export { WebjsStream, renderStream } from './src/webjs-stream.js';

// Signals (TC39 Stage-1 shape), also available via '@webjsdev/core/signals'
export { signal, computed, effect, batch, isSignal, Signal } from './src/signal.js';

// Optimistic-mutation helper (thin signal wrapper, rolls back on failure)
export { optimistic } from './src/optimistic.js';

// SSR action-seed consumer (#472): the generated RPC stub reads a seed on its
// first call so async-render hydration does not re-fetch the SSR'd data.
export { takeSeed, scanSeeds, seedStats, SEED_MISS } from './src/action-seed-client.js';
// Client tag-cache coordinator for HTTP-verb actions (#488): tag-based
// browser-cache eviction after a mutation. Inert server-side.
export { markStale, registerKeyTags, consumeStale, parseTagHeader, fetchMark } from './src/action-cache-client.js';
// Client action-abort plumbing (#492): a superseded async render aborts its
// in-flight action fetches. Inert server-side.
export { setActiveActionSignal, activeActionSignal } from './src/action-abort-client.js';
// Streaming RPC wire protocol (#489): the byte framing the client stub decodes.
export {
  STREAM_CONTENT_TYPE, FRAME_CHUNK, FRAME_END, FRAME_ERROR, encodeFrame, createFrameDecoder,
} from './src/action-stream.js';

// Directives, also available via '@webjsdev/core/directives'. The full
// lit-html-parity set is re-exported here so the dist browser bundle (which
// the `@webjsdev/core/directives` subpath collapses onto in dist mode) carries
// every directive, matching what src/directives.js exports in dev.
export {
  unsafeHTML, isUnsafeHTML, live, isLive, keyed, isKeyed, guard, isGuard,
  templateContent, isTemplateContent, ref, isRef, createRef, cache, isCache,
  until, isUntil, asyncAppend, isAsyncAppend, asyncReplace, isAsyncReplace,
  watch, isWatch,
} from './src/directives.js';

// Context Protocol, also available via '@webjsdev/core/context'
export { createContext, ContextProvider, ContextConsumer, ContextRequestEvent } from './src/context.js';

// Task controller, also available via '@webjsdev/core/task'
export { Task, TaskStatus } from './src/task.js';
