/**
 * Client router: fetch-apply.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */
import { markStale, parseTagHeader } from '../action-cache-client.js';
import { renderStream } from '../webjs-stream.js';
import { buildHaveHeader } from './boundaries.js';
import { STREAM_MIME } from './constants.js';
import { warnIfSmoothScrollOnHtml } from './diagnostics.js';
import { restoreOptimistic } from './dom-differ.js';
import { parseHTML } from './dom-parse.js';
import { clearFrameBusy, markFrameBusy } from './frames.js';
import { handleNavigationError } from './nav-error.js';
import { navigate } from './navigator.js';
import { prefetchTake } from './prefetch.js';
import { currentNavigationToken } from './state.js';
import { readStreamedShell, streamBoundariesProgressively } from './stream.js';
import { _swapCommit, applySwap } from './swap.js';

/**
 * Fetch the target URL and apply the swap.
 *
 * @param {string} href
 * @param {string | null} frameId
 * @param {boolean} recordHistory
 * @param {{ slot: { start: Comment, end: Comment }, oldChildren: Node[], token: number } | null} optimisticState
 * @param {string} [method]  HTTP verb (uppercase). Default 'GET'.
 * @param {BodyInit | null} [body]  Request body for non-GET methods.
 * @param {AbortSignal | null} [signal]  Abort signal. A newer nav cancels this fetch.
 * @param {number} [token]  Nav-token captured at the caller's entry; stale → skip apply.
 * @param {boolean} [revalidating]  True for the BACKGROUND refresh after a
 *   snapshot restore: the user is already viewing a page, so a boundary
 *   mismatch must degrade in place (never a jarring `location.href` load).
 * @param {'page' | 'shell'} [refresh]  Same-URL in-place refresh (#1398). It
 *   suppresses the `X-Webjs-Have` header and picks the swap tier; see
 *   `refreshPage`.
 * @param {boolean} [noPrefetch]  Never consume a speculative entry, whatever the
 *   cache holds (#1407). Set by `loadFrame`: a `<webjs-frame src>` self-load or
 *   `src` mutation asks for THIS frame's content now, which is a freshness
 *   request rather than the click-follows-hover shape the warm cache serves.
 * @returns {Promise<{ ok: boolean, status: number | null, aborted: boolean, applied: boolean }>}
 *   The fetch outcome, so a caller (the form-submission busy/event lifecycle)
 *   can report whether the submission settled as a success, an error, or an
 *   abort. `ok` mirrors `response.ok` for an HTTP response (a 422 validation
 *   re-render is `ok:false`), `false` for a transport/parse error, and `false`
 *   for an abort (which also sets `aborted:true`). `status` is the HTTP status
 *   or `null` when the request never produced one.
 *
 *   `applied` is a DIFFERENT question from `ok` and the two must not be
 *   conflated (#1398). An HTML body of ANY status is parsed and swapped in
 *   place, which is the whole point of the 422-revalidation and error-boundary
 *   behaviour, so a page rendered through `notFound()`, `forbidden()`, or an
 *   `error.ts` boundary has `ok:false` and `applied:true`. It is `false`
 *   wherever no swap committed: a transport failure, a non-HTML body, an
 *   unparseable one, a 204/205, a discarded revalidation, an abort, and every
 *   `applySwap` path that returns without committing (a missing frame, or a
 *   degradation to a hard navigation from an importmap mismatch or a poisoned
 *   boundary scan). A caller deciding whether to fall back to a full page load
 *   wants `applied`; one reporting the submission's success wants `ok`.
 */
export async function fetchAndApply(href, frameId, recordHistory, optimisticState, method, body, signal, token, revalidating, refresh, noPrefetch) {
  method = method || 'GET';
  const myToken = typeof token === 'number' ? token : currentNavigationToken;
  let html;
  // Set when the response streams Suspense boundaries (#473): holds the open
  // reader + leftover buffer so the boundaries apply progressively after the
  // shell swap. Null for a buffered (non-streaming) or prefetched response.
  let streamCtx = null;
  let incomingBuild = null;
  let incomingSrc = null;
  /** @type {number | null} */
  let respStatus = null;
  /** @type {boolean} */
  let respOk = false;
  /** @type {string} */
  let finalUrl = href;
  // aria-busy lifecycle: when this nav targets a <webjs-frame>, mark the
  // live frame busy for the duration of its fetch+apply so assistive tech
  // can announce it and CSS can style `webjs-frame[aria-busy="true"]`. The
  // outer try/finally guarantees the busy state is cleared on EVERY exit
  // (success swap, frame-missing, an HTTP/transport error, an abort by a
  // newer nav), never leaving a frame stuck busy.
  const busyFrame = frameId ? markFrameBusy(frameId, myToken) : null;
  try {
  try {
    // Warm-cache fast path: a hover/focus/viewport prefetch may already hold
    // this page. Consume it instead of going to the network, so the click
    // resolves with no round-trip. Only for GET navs carrying no body. A
    // MUTATING form submission is a write and always hits the server; a SAFE
    // (GET) submission is a read like a link click, so it consumes like one,
    // including in a frame dimension. A FRAME nav consumes only an entry
    // fetched under the SAME frame id (#1407): the key carries that dimension,
    // so a page fragment can never be applied into a frame region, nor a frame
    // subtree into a page swap, and a `<webjs-frame src>` SELF-load opts out
    // entirely via `noPrefetch`, since it is asking for fresh content rather
    // than following a hover. The entry
    // is single-use (prefetchTake removes it) and TTL-guarded. A PAGE entry is
    // then validated by its ANCHOR rather than by an identical X-Webjs-Have
    // (#1114): a fragment applies wherever the boundary it starts at is still
    // live, so an unrelated navigation between the prefetch and this click does
    // not disqualify it. A FRAME entry is validated differently, by its
    // `<webjs-frame id>` still being in the document, since a subtree carries no
    // boundary comment to anchor on (#1407).
    // The optimistic skeleton has already deleted nested boundaries by now, so
    // pass the view captured before it ran.
    // A refresh must never consume a prefetch (#1398): every cached copy
    // predates the change that triggered it. `refreshPage` clears both caches
    // before it fetches, so this only closes the window where a prefetch lands
    // between that clear and this read.
    const prefetched = (method === 'GET' && !body && !refresh && !noPrefetch)
      ? prefetchTake(href, optimisticState ? optimisticState.haveKeys : undefined, frameId)
      : null;
    if (prefetched) {
      html = prefetched.html;
      incomingBuild = prefetched.build;
      incomingSrc = prefetched.src;
      finalUrl = prefetched.finalUrl;
      // A consumed prefetch is a successful 200 GET fragment.
      respStatus = 200;
      respOk = true;
    } else {
    const headers = { 'x-webjs-router': '1' };
    // A same-URL refresh sends NO have-header (#1398). This is required, not an
    // optimisation: the server short-circuits at the first layout whose segment
    // path AND route key the client already holds, and a same-URL request
    // matches every one of them, so the response would omit the layouts and a
    // layout edit would be invisible. Sending nothing forces the full chain to
    // render.
    const have = refresh ? '' : buildHaveHeader();
    if (have) headers['x-webjs-have'] = have;
    if (frameId) headers['x-webjs-frame'] = frameId;
    // Content-negotiate a stream-action response on a write submission (a
    // non-GET body). The server returns the stream MIME only when this Accept
    // is present, so with JS off (no router, no Accept) the same form gets a
    // normal render/redirect: the grammar is additive and PE-safe (#248).
    if (body != null && method !== 'GET' && method !== 'HEAD') {
      headers['accept'] = STREAM_MIME + ', text/html';
    }

    /** @type {RequestInit} */
    // `no-cache` for the same reason as the prefetch fetch (#1131): applySwap
    // hard-reloads on a build change it can only see if these headers are
    // live, not replayed from the HTTP cache.
    const init = { method, headers, credentials: 'same-origin', cache: 'no-cache' };
    if (signal) init.signal = signal;
    if (body != null && method !== 'GET' && method !== 'HEAD') init.body = body;

    const resp = await fetch(href, init);
    respStatus = resp.status;
    respOk = resp.ok;
    // `fetch` follows a 303 transparently and its headers are then unreadable,
    // so this lands on a non-redirect response: the 422 failure re-render, or
    // any form response that answers in place.
    const invalidated = parseTagHeader(resp.headers.get('x-webjs-invalidate'));
    if (invalidated.length) markStale(invalidated);
    const ctype = resp.headers.get('content-type') || '';
    const isHTML = /^text\/html\b/i.test(ctype);
    const isStream = ctype.toLowerCase().indexOf(STREAM_MIME) === 0;
    // Stream-action response (#248): the body is `<webjs-stream>` elements
    // applied surgically to the live DOM, NOT a region swap. Apply them and
    // return; do not parse the body as a page document (it has no shell). A
    // stream body of any status is fine. This runs BEFORE the !isHTML branch
    // so the non-text/html stream MIME is not treated as a navigation error.
    if (isStream) {
      const text = await resp.text();
      // A newer navigation owns the page, so nothing is applied and `applied`
      // has to say so: it reports whether this response reached the DOM, and a
      // superseded one did not.
      const fresh = myToken === currentNavigationToken;
      if (fresh) {
        // Roll back any optimistic loading skeleton: a stream response patches
        // the page in place, it does not swap the region the skeleton covered.
        restoreOptimistic(optimisticState);
        renderStream(text);
      }
      // `ok` is forced false alongside `aborted`, matching every other abort
      // return in this function. A caller reading `ok` as "this response was
      // not superseded" would otherwise be wrong here and nowhere else, and one
      // path disagreeing with the contract is worse than a slightly lossy
      // value: the HTTP status is still on `status` for anyone who wants it.
      return { ok: fresh && respOk, status: respStatus, aborted: !fresh, applied: fresh };
    }
    // Server-side redirect (PRG, auth-gate, etc.): fetch followed it
    // automatically. Record the FINAL URL in history, not the
    // originally-requested one, so back/forward + bookmarking work.
    if (resp.redirected && resp.url) finalUrl = resp.url;

    // Empty-body status codes (204 No Content, 205 Reset Content):
    // server-rendered "stay on current page" pattern. Don't try to
    // swap an empty document over the live one. We DO still record
    // history for the originating URL: same as a normal navigation
    // that decided to short-circuit.
    if (resp.status === 204 || resp.status === 205) {
      if (myToken === currentNavigationToken && recordHistory) {
        history.pushState(null, '', finalUrl);
      }
      return { ok: respOk, status: respStatus, aborted: false, applied: false };
    }

    // Non-HTML response (JSON error, file download, opaque): can't be
    // rendered as a page (a 500 returning `{"error": "..."}` is not an
    // HTML page). Instead of abandoning the SPA with a full reload (which
    // discards the partial-swap shell, scroll, and in-flight state, and
    // eats a second round-trip that may itself fail), dispatch a
    // cancelable `webjs:navigation-error` so the app can recover in place;
    // by default render a minimal in-place error surface. The adjacent
    // HTML-status branch below already renders 4xx/5xx HTML bodies in
    // place; this closes the same gap for a non-HTML error body.
    if (!isHTML) {
      if (myToken === currentNavigationToken) {
        // Roll back any optimistic loading skeleton FIRST, so a
        // preventDefault()-ing app sees the page exactly as it was (the catch
        // block below does the same for a transport failure).
        restoreOptimistic(optimisticState);
        handleNavigationError(href, resp.status, null);
      }
      return { ok: false, status: respStatus, aborted: false, applied: false };
    }

    // HTML body of ANY status: 2xx, 4xx validation errors, 5xx error
    // pages: is parsed and applied in place. Matches Turbo Drive's
    // `formSubmissionFailedWithResponse` behavior
    // (turbo/src/core/drive/navigator.js:92-107). Critical for the
    // standard server-rendered validation pattern: 422 + re-rendered
    // form with errors keeps the user's typed input and shows context.
    // Capture the server's build hash header BEFORE reading the body.
    // The header is set on every SSR response, including X-Webjs-Have
    // partial responses where the body has no head and no importmap
    // tag to compare. The applySwap importmap-mismatch guard reads
    // this to detect deploys that bumped the vendor pin.
    incomingBuild = resp.headers.get('x-webjs-build');
    incomingSrc = resp.headers.get('x-webjs-src');
    // Progressive streaming (#473): read only up to the first streamed Suspense
    // boundary so the shell (with fallbacks) swaps in immediately; the rest
    // streams in after the swap. A body with no boundaries reads to completion,
    // so a non-streaming nav is identical to the old `resp.text()`.
    const shellRead = await readStreamedShell(resp);
    html = shellRead.shell;
    if (shellRead.streaming) streamCtx = shellRead;
    }
  } catch (err) {
    // Aborted by a newer navigation: let it run, don't fall back. An
    // AbortError is a normal supersede, NOT a navigation error, so it must
    // NEVER dispatch webjs:navigation-error (the key no-false-positive
    // line).
    if (err && /** @type any */ (err).name === 'AbortError') return { ok: false, status: null, aborted: true, applied: false };
    // Stale (a newer nav started before we got the network error): the
    // newer nav owns the page now, so don't clobber it.
    if (myToken !== currentNavigationToken) return { ok: false, status: null, aborted: true, applied: false };
    restoreOptimistic(optimisticState);
    // Transport/parse failure (fetch rejected, e.g. offline / DNS / TLS).
    // Surface a navigation-error so the app can recover in place instead
    // of a destructive full reload.
    handleNavigationError(href, null, err instanceof Error ? err : new Error(String(err)));
    return { ok: false, status: null, aborted: false, applied: false };
  }

  // A newer navigation started while we awaited the response body -
  // bail before we overwrite its work.
  if (myToken !== currentNavigationToken) {
    if (streamCtx && streamCtx.reader) { try { streamCtx.reader.cancel(); } catch { /* ignore */ } }
    return { ok: false, status: respStatus, aborted: true, applied: false };
  }

  const doc = parseHTML(html);
  // The body claimed text/html but didn't parse into a document (a
  // malformed/empty HTML body). Surface a navigation-error so the app can
  // recover in place rather than a destructive full reload.
  if (!doc) { restoreOptimistic(optimisticState); handleNavigationError(href, null, new Error('navigation response did not parse as HTML')); return { ok: false, status: respStatus, aborted: false, applied: false }; }

  // #1406: recording the push after the swap finalizes the outgoing page's
  // entry against the DESTINATION document, at a scroll offset the browser has
  // already clamped to that document's height (measured on the gallery: 1600 to
  // 252). Ordering it ahead of the mutation keeps the entry tied to the page it
  // belongs to.
  //
  // #1406 also claimed this fixed the blank iOS back-swipe preview, via WebKit
  // binding the gesture snapshot at the moment the entry is recorded. That is
  // FALSE (#1428, on-device): Turbo Drive uses this same ordering and previews
  // blank too, and the cause was `history.scrollRestoration = 'manual'`
  // suppressing per-entry scroll recording. The ordering is kept on its own
  // merits. So the push rides into `applySwap` as a COMMIT-time callback
  // and fires ahead of the mutation, which is Turbo Drive's ordering
  // (`PageView.renderPage` calls `visit.changeHistory()` ahead of
  // `this.render(renderer)`).
  //
  // One route class gets less than the full benefit: where the innermost
  // boundary carrying a `loading.{js,ts}` template is in the live chain,
  // `applyOptimisticLoading` replaced that range with the skeleton before this
  // function ever ran, so the entry is recorded against the shell plus a
  // skeleton rather than the outgoing page. Better than the destination
  // document, still not the page the reader left. See the `recordHistoryNow`
  // JSDoc in `swap.js` for the full statement of what is and is not claimed.
  //
  // One-shot, exactly like Turbo's `historyChanged` guard, so calling it here
  // AND on the fall-through below is safe. The fall-through is required, not
  // belt-and-braces: `applySwap` can return `'none'` after hard-navigating or
  // after a `webjs:frame-missing` dispatch, and those paths record history today
  // (see the `applied` comment below). Keeping the tail call preserves them byte
  // for byte, so this commit changes the ORDER on committing swaps and nothing
  // else.
  let historyRecorded = false;
  const recordHistoryNow = recordHistory
    ? () => {
      if (historyRecorded) return;
      historyRecorded = true;
      history.pushState(null, '', finalUrl);
    }
    : null;

  const disposition = applySwap(doc, frameId, !!revalidating, finalUrl, incomingBuild, incomingSrc, refresh, recordHistoryNow);
  // `'none'` means applySwap returned WITHOUT committing anything: the frame the
  // response was for is missing, or it degraded to a hard navigation (an
  // importmap/build mismatch, a poisoned boundary scan). The page is not left
  // in a bad state either way, but nothing was applied IN PLACE, and `applied`
  // has to say so or it repeats the hole it exists to close.
  //
  // Recorded as a FLAG rather than returned early on purpose. These paths used
  // to fall through to the history push, the scroll block, and the streaming
  // tail, and an early return would silently change all three (a click-driven
  // frame nav records history, so a frame-missing response would stop advancing
  // the URL). This commit is about what the outcome REPORTS, not about what the
  // pipeline does, so the fall-through is left exactly as it was.
  const applied = disposition !== 'none';
  // A discarded revalidation must be discarded OUTRIGHT: a streamed response's
  // boundary templates must not splice into the restored snapshot afterward
  // (boundary ids are per-render sequential, so a reduced render's numbering
  // need not line up with the snapshot's). Cancel the reader and stop here.
  if (disposition === 'discard') {
    if (streamCtx && streamCtx.reader) { try { streamCtx.reader.cancel(); } catch { /* ignore */ } }
    return { ok: respOk, status: respStatus, aborted: false, applied: false };
  }

  if (recordHistoryNow) recordHistoryNow();

  // Scroll only for foreground (history-recording) navigations. When
  // `recordHistory` is false we're either:
  //   (a) the background revalidation after a cached popstate restore
  //       - performNavigation already set scroll from the cached
  //       position; we must NOT clobber it here.
  //   (b) a cache-miss popstate: modern browsers fire scroll-
  //       restoration themselves before dispatching popstate, so
  //       leaving scroll alone preserves the browser-native UX.
  //
  // And never for a FRAME-scoped response (#1427). `recordHistory` means "a
  // foreground navigation the reader initiated", which a frame click is (it
  // advances the URL, deliberately), so a frame swap used to fall into the
  // page-navigation scroll by omission rather than by decision. A frame swaps
  // ONE region and leaves the rest of the document standing, the scroll offset
  // included, so the router writes no scroll for it: on a page whose frame sits
  // below the fold, scrolling to top throws the region the reader just clicked
  // in off screen. Turbo, which `<webjs-frame>` is modelled on, likewise never
  // scrolls on a frame navigation (its `autoscroll` opt-in is a separate
  // feature WebJs does not have). This is the same rule `restoreGeneration` in
  // `scroll.js` already applies when deciding what ends a scroll-restore
  // window, so the two now agree on what a frame nav is.
  //
  // The hash branch is excluded too. A `#anchor` on a frame link is no more a
  // request to move the document viewport than the frame swap itself is, and
  // one rule ("a frame swap never moves the window") beats two. `_top` and an
  // unresolvable `data-webjs-frame` id both resolve to a null `frameId` in
  // `resolveTargetFrameId`, so they stay page navigations and still scroll.
  if (recordHistory && !frameId) {
    // Use the final URL (after any server-side redirect) so hash
    // anchors point at the document we actually rendered.
    const url = new URL(finalUrl);
    if (url.hash) {
      const t = document.getElementById(url.hash.slice(1));
      // A hash anchor is the one nav scroll we DON'T force instant: a
      // `#section` link is exactly where an app's `scroll-behavior: smooth`
      // is wanted, and native browsers animate it too.
      if (t) t.scrollIntoView();
      else { warnIfSmoothScrollOnHtml(); window.scrollTo({ left: 0, top: 0, behavior: 'instant' }); }
    } else {
      // Scroll-to-top on a forward nav. behavior:'instant' so an app-level
      // `scroll-behavior: smooth` does not animate it (match native nav).
      warnIfSmoothScrollOnHtml();
      window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
    }
  }

  // Progressive streaming (#473): the shell (with its Suspense fallbacks) is
  // now live, so stream the resolved boundaries in fast-before-slow. Detached
  // (fire-and-forget) so the URL advance + navigate event do not wait on the
  // slow boundary; each apply is guarded by the nav token so a newer navigation
  // stops it. Gated on the swap COMMIT (`_swapCommit`): under an async view
  // transition the shell swap is deferred a frame, so applying a resolve before
  // the placeholder is in the DOM dropped the boundary and stuck the skeleton
  // (#1048). On the synchronous path `_swapCommit` is already resolved, so this
  // is a same-microtask no-op there.
  if (streamCtx && (streamCtx.reader || streamCtx.rest)) {
    _swapCommit.then(() => streamBoundariesProgressively(
      streamCtx.reader,
      streamCtx.dec,
      streamCtx.rest,
      () => myToken === currentNavigationToken,
    ));
  }

  document.dispatchEvent(new CustomEvent('webjs:navigate', { detail: { url: finalUrl, frameId, from: 'navigate' } }));
  return { ok: respOk, status: respStatus, aborted: false, applied };
  } finally {
    // Clear the frame's busy state on every exit path (the early returns
    // above all unwind through here). No-op when this was not a frame nav.
    if (busyFrame) clearFrameBusy(busyFrame, myToken);
  }
}
