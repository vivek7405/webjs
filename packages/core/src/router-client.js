// Importing this side-effect-registers <webjs-frame> so apps that
// `import '@webjsdev/core/client-router'` get the escape-hatch element
// available without a second import.
import './webjs-frame.js';
// Same for the <webjs-stream> element. Registering it here means the surgical
// stream-action applier (and `renderStream`) is available app-wide wherever
// the client router is active, for both the HTTP form path (below) and a
// live-channel `connectWS` handler.
import './webjs-stream.js';
import { renderStream } from './webjs-stream.js';
// Register <webjs-suspense> (the element-level streaming boundary, #471) so it
// is layout-neutral and available for the progressive soft-nav streaming apply.
import './webjs-suspense.js';
// Ingest SSR action seeds (#472) from an incoming soft-nav document before its
// components hydrate, so a navigated async component resolves from the seed.
import { scanSeeds } from './action-seed-client.js';
// Slot-runtime constants for re-projecting page-authored slotted content of a
// reused hydrated light-DOM component across a soft nav (#908).
import {
  SLOT_STATE, LIGHT_SLOT_ATTR, PROJECTION_ATTR, PROJECTION_ACTUAL,
  projectAuthored, keyOfName, isAuthoredContentSlot,
} from './slot.js';

/** The content type a content-negotiated stream-action response carries (#248). */
const STREAM_MIME = 'text/vnd.webjs-stream.html';

/**
 * Client router for webjs: nested-layout-aware partial swap.
 *
 * Intercepts same-origin link clicks and form submissions, fetches the
 * target page's HTML via `fetch()`, finds the deepest layout boundary
 * shared by both the current and incoming pages, and replaces ONLY the
 * children of that boundary. Outer layout DOM (header, sidenav, footer)
 * stays mounted: no re-render, no flicker, scroll positions preserved.
 *
 * Enablement is automatic: this module calls `enableClientRouter()` at its
 * end (idempotent), and the `@webjsdev/core` browser entry loads it, so any
 * page that ships a component gets the router with no import to add. Call
 * `disableClientRouter()` to opt out, or `enableClientRouter()` for
 * programmatic control.
 *
 * Mechanism: auto-derived from folder structure (#1015):
 *   1. SSR injects KEYED boundary comment pairs around each layout's
 *      `${children}` interpolation and around the page itself:
 *      `<!--wj:children:<segment>:<route-key>-->` ... `<!--/wj:children:<segment>-->`.
 *      The close carries the segment (deterministic id-matched pairing, no
 *      LIFO), the open carries the resolved route-key (param values
 *      percent-encoded).
 *   2. On link click, STRICTLY scan both the live DOM and the incoming HTML
 *      into segment → {routeKey, range} maps. Any pairing violation poisons
 *      the scan.
 *   3. Two-tier decision (Next.js remount parity): a CHANGED route-key
 *      REPLACES (fresh remount) at the PARENT of the shallowest changed
 *      boundary (whose range contains the changed layout's own markup),
 *      else MORPH (keyed reconcile preserving input values, scroll, popover
 *      state, and node identity) at the deepest shared boundary.
 *   4. A poisoned scan or no shared boundary degrades to a FULL PAGE LOAD:
 *      bounded and correct, never a guessed recovery.
 *   5. Merge head, re-run scripts, upgrade custom elements, pushState.
 *
 * Optimizations bundled into the same response cycle:
 *   - `X-Webjs-Have` request header lists `segment:route-key` entries for
 *     the boundaries the client already has. The server walks the target's
 *     layout chain and short-circuits at the deepest FULL match (segment AND
 *     key, so a dynamic layout held for other params is re-rendered), then
 *     returns only the divergent fragment (wrapped in the matched boundary).
 *     Real wire-byte savings: the layout chain is never re-serialized for
 *     same-shell navigations.
 *   - URL-keyed snapshot cache (Turbo SnapshotCache pattern). Back/
 *     forward via popstate restores from cache instantly, then
 *     revalidates in the background.
 *   - Per-segment loading templates: SSR emits each segment's
 *     loading.ts content as `<template id="wj-loading:<path>">`. On
 *     nav-start the client clones the deepest matching template into
 *     the swap slot so users see an instant skeleton instead of stale
 *     content.
 *
 * Escape hatch:
 *   `<webjs-frame id="...">`: declarative partial-swap region NOT
 *   tied to a folder layout. If a link's enclosing `closest('webjs-frame')`
 *   matches a frame in the incoming HTML, the frame swap takes
 *   precedence over the layout-marker mechanism. Use for ad-hoc
 *   widgets (tabs, lazy-loaded cards) where the swap region isn't a
 *   folder route segment.
 */

/**
 * Parse a navigation response into a Document, PRESERVING COMMENTS.
 *
 * Comments are load-bearing here, not incidental: the partial swap pairs on
 * `<!--wj:children:<path>-->` markers and hydration keys off `<!--webjs-hydrate-->`.
 * `Document.parseHTMLUnsafe` would be the natural choice (it is the only
 * single-pass API that also processes Declarative Shadow DOM) but it STRIPS
 * EVERY COMMENT in Chromium 150 (#1007), which deletes both. So it is used only
 * when a one-time probe proves it lossless on this engine, and otherwise we parse
 * with DOMParser (comments preserved; DSD is left unprocessed, see
 * `parseDocumentPreservingComments` for why that gap beats both ways of closing it).
 *
 * A partial-nav response (#936) is an INNER fragment that BEGINS with the
 * `<!--wj:children:<segment>:<route-key>-->` boundary open and carries no
 * `<!doctype>`/`<html>`. Parsing such a fragment as a DOCUMENT hoists that
 * leading comment OUT of `<body>` (the HTML parser's "before html" insertion
 * mode makes a leading comment a child of the document, before `<html>`), so
 * `collectBoundaries(doc.body)` never sees the opening boundary, finds no
 * shared segment, and `applySwap` degrades to a full load. So a fragment is
 * parsed in BODY (fragment) context instead, keeping the boundary with its
 * content.
 * `body.setHTMLUnsafe` also processes Declarative Shadow DOM, so a shadow
 * component inside the swapped content still re-attaches its root; the
 * `<template>` path is the fallback for browsers without it (markers preserved,
 * DSD not, which matches the pre-`setHTMLUnsafe` baseline).
 *
 * @param {string} html
 * @returns {Document | null}
 */
function parseHTML(html) {
  const isFragment = !/^\s*(?:<!doctype|<html)/i.test(html);
  if (isFragment && typeof document !== 'undefined' && document.implementation) {
    try {
      const doc = document.implementation.createHTMLDocument();
      if (typeof doc.body.setHTMLUnsafe === 'function') {
        doc.body.setHTMLUnsafe(html);
      } else {
        const t = doc.createElement('template');
        t.innerHTML = html;
        doc.body.appendChild(t.content);
      }
      return doc;
    } catch {
      // Fall through to a document parse (still functional, just the #936 path).
    }
  }
  if (
    typeof Document !== 'undefined' &&
    typeof Document.parseHTMLUnsafe === 'function' &&
    parseHTMLUnsafePreservesComments()
  ) {
    return Document.parseHTMLUnsafe(html);
  }
  return parseDocumentPreservingComments(html);
}

/**
 * Is `Document.parseHTMLUnsafe` lossless for comments?
 *
 * Chromium 150 strips EVERY comment from `Document.parseHTMLUnsafe` output
 * (#1007). No other parse API does: `DOMParser`, `setHTMLUnsafe`,
 * `template.innerHTML`, and plain `innerHTML` all preserve them, and the
 * document's own navigation parser preserves them (which is why a hard refresh
 * always looked fine and only soft nav broke). MDN documents parseHTMLUnsafe as
 * the parse-WITHOUT-sanitization entry point, so this reads as a browser defect
 * rather than intent, but the whole router rides on comments (`wj:children`
 * layout markers) and so does hydration (`webjs-hydrate`), so we cannot take
 * the risk either way.
 *
 * Probed once, lazily, rather than version-sniffed: when the browser is fixed
 * we silently return to the fast single-pass native path, and a future browser
 * that regresses the same way is caught with no code change.
 *
 * @returns {boolean}
 */
let _parseUnsafeLossless = null;
function parseHTMLUnsafePreservesComments() {
  if (_parseUnsafeLossless !== null) return _parseUnsafeLossless;
  try {
    const probe = Document.parseHTMLUnsafe('<!doctype html><body><!--c--><i></i>');
    _parseUnsafeLossless = probe?.body?.firstChild?.nodeType === 8;
  } catch {
    _parseUnsafeLossless = false;
  }
  return _parseUnsafeLossless;
}

/**
 * Clear the memoized losslessness probe. Test-only: a browser cannot change
 * mid-session, so nothing in the runtime needs this. Tests SIMULATE a stripping
 * parser (rather than depending on the runner's browser actually being an
 * affected version, which the Chromium web-test-runner currently resolves is not) and reset the
 * memo around that stub.
 */
function resetParseProbe() {
  _parseUnsafeLossless = null;
}

/**
 * Parse a FULL document while preserving comments.
 *
 * `DOMParser` keeps comments but does NOT process Declarative Shadow DOM, so a
 * `<template shadowrootmode>` stays an inert template here. That is a DELIBERATE
 * limitation on this path, and both obvious ways to "fix" it are worse than the
 * gap (measured on Chromium 150, not reasoned about):
 *
 *   - `body.setHTMLUnsafe(body.innerHTML)` re-serializes, and that round-trip is
 *     not idempotent: Chromium omits the spec's LF-compensation rule (append
 *     U+000A when a `pre` / `textarea` / `listing` element's first Text child
 *     starts with one), so `<textarea>\n\nfoo</textarea>` parses to `"\nfoo"`
 *     natively but `"foo"` after a round-trip. In a `<textarea>` that is silent
 *     form-data corruption: a soft nav would submit different bytes than a hard
 *     refresh.
 *   - Attaching each root by hand (`host.attachShadow()` + move the template's
 *     nodes) is USELESS on the common path and HARMFUL on the other. Useless
 *     because the marker swap imports with `document.importNode(n, true)`, which
 *     drops a shadow root unless it is `clonable`, and SSR emits a bare
 *     `<template shadowrootmode="open">`, so the root never survives the import
 *     and `component.js` re-attaches from scratch exactly as it always did.
 *     Harmful because the full-body-swap path ADOPTS instead, so a script-created
 *     root does survive, and a script-created root is not `declarative`: the spec
 *     only permits a second `attachShadow()` over an existing root when that root
 *     is declarative, so any element whose constructor unconditionally calls
 *     `attachShadow()` then throws `NotSupportedError` on upgrade, where the
 *     native parse it replaced worked fine.
 *
 * The gap this leaves is narrow and strictly better than the bug it replaces: on
 * a comment-stripping browser only, an element that depends on DSD content and
 * ships NO JavaScript loses that content on a full-body-swap navigation. Every
 * WebJs `static shadow = true` component is unaffected, because it attaches and
 * renders its own root on upgrade (`component.js`, guarded by `if
 * (!this.shadowRoot)`), and a soft nav runs JS by definition. Tracked separately.
 *
 * @param {string} html
 * @returns {Document | null}
 */
function parseDocumentPreservingComments(html) {
  if (typeof DOMParser === 'undefined') return null;
  return new DOMParser().parseFromString(html, 'text/html');
}

let enabled = false;

/**
 * AbortController for the currently in-flight fetch. A new navigation /
 * submission `abort()`s this and replaces it: Turbo Drive's
 * `navigator.stop()` pattern. Aborting in-flight requests on rapid
 * link clicks avoids late responses clobbering newer settled state.
 *
 * @type {AbortController | null}
 */
let activeAbortController = null;

/**
 * Monotonic counter incremented at the start of every navigation. Each
 * async path captures the value at its entry point and compares before
 * applying side effects (swap, restore-optimistic). A mismatch means a
 * newer nav superseded this one: bail out silently. Belt-and-suspenders
 * on top of AbortController: covers paths where a response has already
 * resolved past the await but a newer nav started before applySwap ran.
 */
let currentNavigationToken = 0;

/**
 * Global MutationObserver that upgrades any custom element inserted into
 * the document. Safety net: if our diff / replaceChildren / View
 * Transitions ever leave an un-upgraded element behind, this catches it.
 */
let upgradeObserver = null;
function ensureUpgradeObserver() {
  if (upgradeObserver || typeof MutationObserver === 'undefined' || typeof customElements === 'undefined') return;
  upgradeObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const el = /** @type {Element} */ (node);
        if (el.tagName?.includes('-')) customElements.upgrade(el);
        for (const child of el.querySelectorAll('*')) {
          if (child.tagName?.includes('-')) customElements.upgrade(child);
        }
      }
    }
  });
  upgradeObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * The URL the user is currently viewing: tracked separately from
 * `location.href` because on `popstate` the browser updates
 * `location.href` to the destination URL BEFORE firing the event,
 * which means snapshotting "the current page" naively keys against
 * the wrong URL (the page being arrived at, not the page being left).
 *
 * Updated after every successful navigation completes. Used by
 * `snapshotCurrent` to key the snapshot under the URL the user is
 * actually leaving.
 *
 * @type {string | null}
 */
let currentPageUrl = null;

/**
 * Previous value of `history.scrollRestoration` (so we can restore it
 * when the router is disabled). The browser's default behavior of
 * auto-restoring scroll on popstate races with the SPA's own scroll
 * restoration: disabled here so WebJs is the sole authority on scroll
 * during navigation. Same pattern as Turbo Drive's
 * `assumeControlOfScrollRestoration()` (turbo/src/core/drive/history.js).
 *
 * @type {ScrollRestoration | null}
 */
let prevScrollRestoration = null;

/** Enable the client router. Idempotent. */
export function enableClientRouter() {
  if (enabled || typeof document === 'undefined') return;
  enabled = true;
  // Both `click` and `submit` are BUBBLE phase, not capture. A component's
  // per-element `@click` / `@submit` handler (render-client.js) runs in the
  // at-target phase, BEFORE a document-level bubble listener. So onClick /
  // onSubmit run AFTER the component, and their `if (e.defaultPrevented) return`
  // guard sees the component's `preventDefault` and leaves the element alone.
  // A capture listener would run FIRST, before the component, so the guard
  // would always see `false` and the router would wrongly hijack a JS-handled
  // link or form: navigate a `<a @click=${e => e.preventDefault()}>` away, or
  // submit a `<form @submit=${e => e.preventDefault()}>` (the live chat /
  // comments forms, which preventDefault and send over WebSocket / fetch),
  // navigating the page out from under it. All the phase-independent filtering
  // (modifier / middle clicks, downloads, cross-origin, hash links, GET-vs-POST)
  // happens inside onClick / onSubmit regardless of phase. Mirrors
  // hotwired/turbo, which does its interception work in bubble listeners.
  document.addEventListener('click', onClick, false);
  document.addEventListener('submit', onSubmit, false);
  window.addEventListener('popstate', onPopState);
  // Intent prefetch: warm the next page on hover / focus / touch-start.
  // pointerover + focusin bubble, so one delegated listener each covers
  // the whole document, including links added by later navigations.
  document.addEventListener('pointerover', onPrefetchIntent, true);
  document.addEventListener('focusin', onPrefetchIntent, true);
  document.addEventListener('touchstart', onPrefetchIntent, { capture: true, passive: true });
  document.addEventListener('pointerout', onPrefetchOut, true);
  // After every client navigation the swapped-in DOM may carry new
  // anchors, so re-scan for render/viewport modes. webjs:navigate fires
  // at the end of fetchAndApply for both link and frame swaps.
  document.addEventListener('webjs:navigate', refreshPrefetchObservers);
  ensureUpgradeObserver();
  // Apply render/viewport prefetch modes to the initial document.
  refreshPrefetchObservers();
  // Take control of scroll restoration so the browser doesn't fight
  // the SPA's own snapshot-based restore on popstate.
  if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
    prevScrollRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
  }
  // Seed the "current page" tracker so the first navigation can
  // snapshot the page the user is leaving.
  if (typeof location !== 'undefined') currentPageUrl = location.href;
}

/** Disable the client router. */
export function disableClientRouter() {
  if (!enabled) return;
  enabled = false;
  document.removeEventListener('click', onClick, false);
  document.removeEventListener('submit', onSubmit, false);
  window.removeEventListener('popstate', onPopState);
  document.removeEventListener('pointerover', onPrefetchIntent, true);
  document.removeEventListener('focusin', onPrefetchIntent, true);
  document.removeEventListener('touchstart', onPrefetchIntent, /** @type any */ ({ capture: true }));
  document.removeEventListener('pointerout', onPrefetchOut, true);
  document.removeEventListener('webjs:navigate', refreshPrefetchObservers);
  clearPrefetchHover();
  clearPrefetchViewTimers();
  if (prefetchViewObserver) { prefetchViewObserver.disconnect(); prefetchViewObserver = null; }
  if (typeof history !== 'undefined' && prevScrollRestoration !== null) {
    history.scrollRestoration = prevScrollRestoration;
    prevScrollRestoration = null;
  }
  currentPageUrl = null;
}

/**
 * Programmatic navigation (replaces `location.href = url`).
 * @param {string} url
 * @param {{ replace?: boolean }} [opts]
 */
export async function navigate(url, opts) {
  const target = new URL(url, location.href);
  if (target.origin !== location.origin) {
    location.href = url;
    return;
  }
  await performNavigation(target.href, opts?.replace ?? false, null);
}

/**
 * Self-load a `<webjs-frame src>`: fetch `url` as a frame nav and apply the
 * matching `<webjs-frame id>` subtree into `frameEl` through the EXACT same
 * frame-swap path a click-driven frame nav uses (`fetchAndApply` with the
 * frame's id). So the #252 `aria-busy` lifecycle + `webjs:frame-busy` events,
 * the #249 `webjs:navigation-error` recovery, the keyed reconciler, and the
 * `webjs:frame-missing` fallback all apply for free; a `src` self-load and a
 * click that targets the same frame produce identical DOM.
 *
 * This is NOT a page navigation: it records no history entry, takes no page
 * snapshot, and shows no optimistic loading skeleton (it swaps one region, not
 * the page). It runs under a fresh nav token + AbortController so it interleaves
 * safely with real navigations and with a superseding `src` change on the same
 * frame (the later load's token wins; the earlier one's teardown never clears
 * the newer load's busy state, see `frameBusyTokens`).
 *
 * Called only by `<webjs-frame>` itself (`webjs-frame.js`), which owns the
 * no-double-load guard (eager connect vs lazy-viewport vs a `src` mutation).
 *
 * @param {Element} frameEl  The live `<webjs-frame>` element to fill.
 * @param {string} url  The `src` value, resolved against `location.href`.
 * @returns {Promise<{ ok: boolean, status: number | null, aborted: boolean }>}
 */
export async function loadFrame(frameEl, url) {
  if (typeof location === 'undefined') return { ok: false, status: null, aborted: false };
  const id = frameEl && /** @type any */ (frameEl).id;
  if (!id) return { ok: false, status: null, aborted: false };
  const target = new URL(url, location.href);
  // Cross-origin can't be a same-document frame swap (and a frame fetch must
  // send a same-origin credentialed request). Leave the frame unchanged.
  if (target.origin !== location.origin) return { ok: false, status: null, aborted: false };

  // A frame self-load shares the global abort + token machinery so a real
  // navigation that starts mid-load supersedes it (and vice versa), exactly
  // like a click-driven frame nav routed through performNavigation.
  if (activeAbortController) activeAbortController.abort();
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;
  const myToken = ++currentNavigationToken;

  return fetchAndApply(
    target.href,
    id,
    /* recordHistory */ false,
    /* optimisticState */ null,
    'GET',
    /* body */ null,
    signal,
    myToken,
  );
}

/**
 * Invalidate a cached snapshot. Call after a server action mutates data
 * that affects a cached page so the next visit refetches.
 *
 * Evicts BOTH the back/forward snapshot cache and the speculative
 * prefetch cache. A prefetched fragment captured before a mutation would
 * otherwise be served stale on the next forward click, the same staleness
 * the snapshot eviction prevents for back/forward.
 *
 * @param {string} [url]  Specific URL to invalidate, or omit to clear all.
 */
export function revalidate(url) {
  // Falsy `url` (undefined, null, empty string) clears everything.
  // Loose `== null` would have left `revalidate('')` to silently no-op,
  // because `new URL('', location.href)` is a valid relative URL and the
  // resulting cache key rarely matches anything.
  if (!url) { snapshotCache.clear(); prefetchCache.clear(); return; }
  const u = new URL(url, location.href);
  const key = u.pathname + u.search;
  snapshotCache.delete(key);
  prefetchCache.delete(key);
}

// Auto-enable on import: deferred to the END of this module (see the
// call after the test-only exports). enableClientRouter() transitively
// reads the prefetch state (prefetchViewObserver and the caches), which
// are `const`/`let` declared lower in the file and therefore in the
// temporal dead zone here. Calling enable at module-end, after every
// top-level binding is initialised, avoids a ReferenceError in the
// bundled browser build.

/* ====================================================================
 * Click + popstate handlers
 * ==================================================================== */

/**
 * Pathnames with these extensions are never HTML pages.
 */
const NON_HTML_EXTENSIONS = /\.(?:pdf|zip|tar|gz|7z|rar|dmg|exe|msi|deb|rpm|apk|ipa|xlsx?|docx?|pptx?|csv|odt|ods|odp|rtf|epub|mobi|xml|json|rss|atom|txt|md|wasm|mp3|mp4|mov|avi|webm|ogg|flac|wav|m4a|m4v|mkv|png|jpe?g|gif|webp|avif|bmp|ico|svg|tiff?|heic)$/i;

/** @param {MouseEvent} e */
function onClick(e) {
  if (!enabled) return;
  if (e.defaultPrevented || e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

  const anchor = findAnchorInPath(e);
  if (!anchor) return;
  if (anchor.hasAttribute('download')) return;
  if (anchor.hasAttribute('data-no-router')) return;
  if (anchor.target && anchor.target !== '_self') return;

  const href = anchor.href;
  if (!href) return;

  const url = new URL(href);
  if (url.origin !== location.origin) return;
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
  if (NON_HTML_EXTENSIONS.test(url.pathname)) return;

  e.preventDefault();
  // Resolve the target frame. An explicit `data-webjs-frame` on (or above)
  // the anchor drives a frame by id from anywhere in the document (an
  // external sidebar/nav link), `_top` breaks out to a full-page nav, and
  // absence falls back to the closest enclosing frame (today's default).
  const frameId = resolveTargetFrameId(anchor);
  performNavigation(href, false, frameId);
}

/** @param {PopStateEvent} _e */
function onPopState(_e) {
  // popstate has no DOM anchor, so no frame context: restore via cache or
  // refetch the whole document.
  performNavigation(location.href, true, null);
}

/**
 * Intercept form submissions. BUBBLE phase (see enableClientRouter) so we run
 * AFTER a component's per-element `@submit` handler, which is bound at-target.
 * That ordering is what makes the `if (e.defaultPrevented) return` guard below
 * work: a component that calls `e.preventDefault()` (the chat / comments forms,
 * or any JS-handled form) has already run, so we see the prevented default and
 * leave the form alone. A capture listener would fire us first, before the
 * component, defeating the guard and wrongly navigating the page out from under
 * a JS-handled form.
 *
 * Filtering mirrors Turbo's `form_submit_observer.js`:
 *   - `data-no-router` on form or submitter → full browser submit.
 *   - `formmethod="dialog"` → native <dialog> dismissal, never routed.
 *   - `target` / `formtarget` that isn't `_self` → iframe / popup target.
 *   - Cross-origin or non-HTML-extension action → let the browser handle.
 *
 * Submitter attributes (`formmethod`, `formaction`, `formenctype`) take
 * precedence over the form's own: HTML5 form-submission algorithm.
 *
 * @param {SubmitEvent} e
 */
function onSubmit(e) {
  if (!enabled) return;
  if (e.defaultPrevented) return;

  const form = /** @type {HTMLFormElement | null} */ (e.target);
  // Duck-type check rather than `instanceof HTMLFormElement`: linkedom
  // and other non-browser DOMs don't always mark form elements as
  // instances of the window's HTMLFormElement class.
  if (!form || form.nodeType !== 1 || form.tagName !== 'FORM') return;
  if (form.hasAttribute('data-no-router')) return;

  const submitter = /** @type {HTMLElement | null} */ (e.submitter ?? null);
  if (submitter && submitter.hasAttribute('data-no-router')) return;

  const target = (submitter && submitter.getAttribute('formtarget'))
    || form.getAttribute('target')
    || '';
  if (target && target !== '_self') return;

  const method = getSubmitMethod(form, submitter);
  if (method === 'dialog') return;

  const action = getSubmitAction(form, submitter);
  /** @type {URL} */ let url;
  try { url = new URL(action, location.href); }
  catch { return; }
  if (url.origin !== location.origin) return;
  if (NON_HTML_EXTENSIONS.test(url.pathname)) return;

  const body = buildSubmitFormData(form, submitter);

  e.preventDefault();
  // Resolve the target frame for the submit, same precedence as a link:
  // an explicit `data-webjs-frame` on (or above) the form or its submitter
  // wins, `_top` breaks out, absence falls back to the enclosing frame.
  const frameId = resolveTargetFrameId(submitter || form);
  performSubmission(url.href, method, body, frameId, form);
}

/**
 * Method resolution: submitter's `formmethod` wins over form's `method`.
 * Returns lowercase.
 *
 * @param {HTMLFormElement} form
 * @param {HTMLElement | null} submitter
 */
function getSubmitMethod(form, submitter) {
  const v = (submitter && submitter.getAttribute('formmethod'))
    || form.getAttribute('method')
    || 'get';
  return v.toLowerCase();
}

/**
 * Action resolution: submitter's `formaction` wins over form's `action`.
 * Empty string is valid (means submit-to-current-url).
 *
 * @param {HTMLFormElement} form
 * @param {HTMLElement | null} submitter
 */
function getSubmitAction(form, submitter) {
  if (submitter && submitter.hasAttribute('formaction')) {
    return submitter.getAttribute('formaction') || '';
  }
  return form.getAttribute('action') || form.action || location.href;
}

/**
 * Build FormData honoring the submitter's name=value (per HTML5 form
 * submission algorithm). Modern browsers + the `FormData(form, submitter)`
 * ctor handle this automatically; older Safari needs a manual append.
 *
 * @param {HTMLFormElement} form
 * @param {HTMLElement | null} submitter
 * @returns {FormData}
 */
function buildSubmitFormData(form, submitter) {
  try {
    return new FormData(form, /** @type any */ (submitter || undefined));
  } catch {
    const fd = new FormData(form);
    if (submitter && submitter.getAttribute('name')) {
      fd.append(
        /** @type {string} */ (submitter.getAttribute('name')),
        submitter.getAttribute('value') || '',
      );
    }
    return fd;
  }
}

/**
 * Find the nearest <a> in the event's composed path. composedPath() crosses
 * shadow DOM boundaries: essential because nav links typically live inside
 * the layout shell's shadow root.
 *
 * @param {MouseEvent} e
 * @returns {HTMLAnchorElement | null}
 */
function findAnchorInPath(e) {
  for (const el of e.composedPath()) {
    if (el instanceof HTMLAnchorElement) return el;
  }
  return null;
}

/**
 * Find the id of the innermost <webjs-frame> enclosing `el`, walking up
 * through normal DOM and any shadow boundaries it crosses. Returns null
 * if the element is not inside any frame.
 *
 * @param {Element | null} el
 * @returns {string | null}
 */
function activeFrameId(el) {
  /** @type {Element | null} */
  let cur = el;
  while (cur) {
    const frame = cur.closest('webjs-frame');
    if (frame && frame.id) return frame.id;
    // Cross shadow boundary upwards if necessary.
    const root = cur.getRootNode();
    if (root && /** @type any */ (root).host) {
      cur = /** @type any */ (root).host;
    } else {
      break;
    }
  }
  return null;
}

/**
 * The reserved `data-webjs-frame` token that forces a full-page navigation,
 * breaking OUT of any enclosing frame (Turbo's `data-turbo-frame="_top"`).
 * `resolveTargetFrameId` returns this sentinel; callers treat it exactly
 * like "no frame" (a normal layout-marker / full-body swap), so a trigger
 * physically nested in a frame escapes the frame swap. Distinct from `null`
 * only inside `resolveTargetFrameId` (where `null` would otherwise fall back
 * to the enclosing frame); both reach `performNavigation` as a frameless
 * nav, so they behave identically downstream.
 */
const FRAME_TOP = '_top';

/**
 * Resolve which `<webjs-frame>` (if any) a trigger drives, honoring an
 * explicit `data-webjs-frame` attribute before the closest-enclosing-frame
 * default. Models Turbo's `data-turbo-frame` external targeting:
 *
 *   - `data-webjs-frame="<id>"` on (or above) the trigger drives the frame
 *     with that id, resolved via `getElementById` in the CURRENT document.
 *     This lets an EXTERNAL link / form (a sidebar, a filter form) drive a
 *     content frame it is NOT DOM-nested in. If the id does not resolve to a
 *     live `<webjs-frame>`, we warn ONCE and fall back to a normal full nav
 *     (the fail-safe posture: never throw, never silently swap the wrong
 *     region).
 *   - `data-webjs-frame="_top"` forces a full-page navigation even when the
 *     trigger is inside a frame, returning `null` so the swap escapes to the
 *     layout-marker / full-body path.
 *   - No `data-webjs-frame` keeps today's behavior: the innermost enclosing
 *     frame via `activeFrameId`.
 *
 * Resolution precedence: explicit `data-webjs-frame` > closest enclosing
 * frame. The attribute is read with `closest('[data-webjs-frame]')` so it
 * may live on the trigger itself or any ancestor (e.g. a `<nav>` wrapping a
 * set of links that all target one frame).
 *
 * @param {Element | null} trigger
 * @returns {string | null}  A frame id to swap, or null for a full nav.
 */
function resolveTargetFrameId(trigger) {
  if (!trigger) return null;
  const carrier = trigger.closest && trigger.closest('[data-webjs-frame]');
  const explicit = carrier
    ? (/** @type {HTMLElement} */ (carrier).dataset
        ? /** @type {HTMLElement} */ (carrier).dataset.webjsFrame
        : carrier.getAttribute('data-webjs-frame'))
    : null;
  if (explicit != null && explicit !== '') {
    if (explicit === FRAME_TOP) {
      // Break out: a full-page nav, never a frame swap.
      return null;
    }
    // External targeting by id. Resolve in the current document.
    const el = typeof document !== 'undefined' ? document.getElementById(explicit) : null;
    if (el && el.tagName && el.tagName.toLowerCase() === 'webjs-frame') {
      return explicit;
    }
    // Unresolvable id: warn once, fall back to a normal full nav so the
    // click still works rather than swapping nothing or the wrong region.
    warnOnce(
      `webjs:frame-unresolved:${explicit}`,
      `[webjs] data-webjs-frame="${explicit}" did not match a live <webjs-frame id="${explicit}">; performing a normal navigation instead.`,
    );
    return null;
  }
  // No explicit target: today's closest-enclosing-frame default.
  return activeFrameId(trigger);
}

/**
 * Emit a `console.warn` at most once per `key` for the lifetime of the
 * page, so a repeated misconfiguration (a stale `data-webjs-frame` clicked
 * many times) does not spam the console.
 *
 * @type {Set<string>}
 */
const warnedKeys = new Set();
/** @param {string} key @param {string} message */
function warnOnce(key, message) {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  if (typeof console !== 'undefined' && console.warn) console.warn(message);
}

/**
 * True when a nav must degrade to a full page load because the document is
 * still parsing. A forward, main-document nav fired at `readyState: 'loading'`
 * races the DOM: the leaving page's closing layout markers may not be attached
 * yet, so a soft swap would snapshot an incomplete tree and corrupt the DOM
 * (#1008 / #936). Scoped to frameless forward navs (popstate is browser-driven,
 * a frame nav carries its own boundary element).
 *
 * @param {boolean} isPopState
 * @param {string | null | undefined} frameId
 * @returns {boolean}
 */
function shouldFullLoadDuringParse(isPopState, frameId) {
  return (
    !isPopState &&
    !frameId &&
    typeof document !== 'undefined' &&
    document.readyState === 'loading'
  );
}

/**
 * Dev-only diagnostic: the client router degraded a soft navigation to a full
 * page load. Records WHY (the `cause`) so the "why did my SPA nav do a full
 * reload?" question is answerable from the console instead of guessed at. Silent
 * in production and deduped per cause so a repeated trigger does not spam.
 *
 * @param {string} cause a short stable slug for the degradation reason
 * @param {string} href the destination the router fell back to loading
 */
function devWarnFallback(cause, href) {
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') return;
  warnOnce(
    `fallback:${cause}`,
    `[webjs] client router fell back to a full page load (${cause}) navigating to ${href}. This is correct (no DOM corruption), just not a soft nav.`
  );
}

/**
 * Dev-only, fire-once-per-id hint: a streamed Suspense resolution arrived but
 * its boundary placeholder was not in the DOM, so it was dropped (#1051). This
 * is benign when the navigation was superseded, degraded to a full load, or
 * discarded, but a stuck skeleton that is NONE of those has no other signal (it
 * is what made the #1048 view-transition race hard to diagnose). Never warns in
 * production, never throws.
 *
 * @param {string} id the streamed boundary id that could not be applied
 */
function warnDropped(id) {
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') return;
  warnOnce(
    `stream-drop:${id}`,
    `[webjs] dropped a streamed Suspense resolve for "${id}": no #${id} boundary in the DOM. Benign if this navigation was superseded or degraded. A stuck skeleton here means the shell swap did not place the boundary.`
  );
}

/**
 * Dev-only, fire-once hint: the router forces an INSTANT scroll-to-top on a
 * forward navigation (matching a native page load), so an app-level
 * `scroll-behavior: smooth` on <html> does not affect route transitions (it
 * still applies to in-page #anchor links via `scrollIntoView`). A developer
 * who set smooth expecting smooth nav scrolling would otherwise be puzzled.
 * Also flags the iOS sticky-`backdrop-filter` flash this combination can
 * cause (#610). Never warns in production, never throws.
 *
 * The `smoothScrollChecked` flag gates the `getComputedStyle` read (a forced
 * style flush) to AT MOST ONCE per page, so a dev session does not pay a
 * per-navigation reflow after the first forward nav.
 */
let smoothScrollChecked = false;
function warnIfSmoothScrollOnHtml() {
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') return;
  if (smoothScrollChecked) return;
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return;
  const root = document.documentElement;
  if (!root) return;
  smoothScrollChecked = true;
  let behavior;
  try { behavior = getComputedStyle(root).scrollBehavior; } catch { return; }
  if (behavior !== 'smooth') return;
  warnOnce(
    'scroll-behavior-smooth-html',
    '[webjs] Detected `scroll-behavior: smooth` on <html>. The client router scrolls ' +
    'to the top instantly on navigation (like a native page load), so route transitions ' +
    'are not affected by it. It still applies to in-page #anchor links. Pairing it with a ' +
    'sticky `backdrop-filter` header can also flash on iOS during navigation.'
  );
}

/**
 * Nav-in-flight signalling. The router can expose `data-navigating` on <html>
 * so an app may style a loading indicator with `html[data-navigating] { … }`.
 *
 * This is OPT-IN, set only when the app marks `<html data-webjs-nav-progress>`.
 * The reason it is not unconditional: toggling ANY attribute on the root
 * re-runs global style resolution, and on WebKit (so every iOS browser, since
 * they all use it) that re-resolves `oklch()` / `color-mix(in oklch, …)` token
 * values to an equivalent oklab representation and repaints them for one frame.
 * On a token-driven theme that is a visible background flash on navigation
 * (#610). The flash only shows on a nav slow enough to reach the deferred set
 * below, which a desktop nav rarely is but a mobile forward fetch routinely is,
 * so the symptom is iOS-and-forward-only. With no opt-in the attribute is never
 * written, so the re-resolution never happens and the flash cannot occur.
 */
function setNavigating(on) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root || !root.hasAttribute('data-webjs-nav-progress')) return;
  try {
    if (on) root.setAttribute('data-navigating', '');
    else root.removeAttribute('data-navigating');
  } catch { /* non-DOM environment */ }
}

/* ====================================================================
 * Boundary discovery (the heart of the partial-swap mechanism, #1015)
 * ==================================================================== */

/**
 * Walk a node tree collecting KEYED children-boundary pairs into a Map
 * keyed by segment path.
 *
 * Boundaries are HTML comments emitted by SSR around each layout's
 * children interpolation AND around the page itself:
 *   <!--wj:children:/docs:/docs-->            (open: segment + route-key)
 *     <page content>
 *   <!--/wj:children:/docs-->                 (close: segment)
 *
 * The close carries the SEGMENT, so pairing is deterministic id-matching:
 * a close must match the segment of the INNERMOST open boundary (proper
 * nesting), never a positional LIFO guess. The open additionally carries
 * the resolved ROUTE-KEY (param values percent-encoded at emit), which
 * `planBoundarySwap` compares between the live and incoming DOM to pick
 * the swap tier.
 *
 * STRICT INTEGRITY, by design (#1015): this scanner never guesses. ANY
 * violation poisons the whole scan and returns null:
 *   - an open with no route-key (the legacy anonymous format, or truncation)
 *   - a close whose segment does not match the innermost open boundary
 *   - a close with no open boundary at all
 *   - a duplicate segment (two boundaries claiming one id)
 *   - an open boundary never closed (truncated response)
 * The caller degrades a poisoned side to a FULL PAGE LOAD: bounded, correct,
 * and honest, where the deleted heuristic recovery (#994's orphan recovery +
 * trailing-count bounding) could guess wrong and corrupt silently. The main
 * PRODUCER of mispairing (our own comment-stripping parse, #1007, and
 * mid-parse soft navs, #1008) is already fixed upstream, so poisoning is a
 * rare backstop, not a common path.
 *
 * @param {ParentNode} root
 * @returns {Map<string, { routeKey: string, start: Comment, end: Comment }> | null}
 *   The boundary map, or null when the tree's boundaries are malformed.
 */
export function collectBoundaries(root) {
  /** @type {Map<string, { routeKey: string, start: Comment, end: Comment }>} */
  const out = new Map();
  /** @type {{ segment: string, routeKey: string, start: Comment }[]} */
  const stack = [];
  let poisoned = false;

  // Plain recursive comment walk: TreeWalker/NodeFilter aren't available
  // in every DOM polyfill (notably linkedom in tests). Iterative depth-
  // first traversal keeps us portable across linkedom + native + jsdom.
  /** @param {Node} node */
  function visit(node) {
    if (poisoned) return;
    if (node.nodeType === 8 /* COMMENT_NODE */) {
      const data = /** @type {Comment} */ (node).data.trim();
      if (data.startsWith('wj:children:')) {
        const rest = data.slice('wj:children:'.length);
        // The route-key is everything after the LAST ':'. Substituted param
        // values are percent-encoded at emit and static pieces have their
        // delimiter characters encoded too, so the last colon is unambiguous
        // for framework-emitted boundaries. A hand-authored folder name that
        // still smuggles a delimiter through can only MIS-SPLIT here, which
        // mismatches the close and poisons the scan: degrade-only, never a
        // wrong pairing.
        const cut = rest.lastIndexOf(':');
        if (cut <= 0 || cut === rest.length - 1) { poisoned = true; return; }
        const segment = rest.slice(0, cut);
        const routeKey = rest.slice(cut + 1);
        if (out.has(segment) || stack.some((f) => f.segment === segment)) {
          poisoned = true;
          return;
        }
        stack.push({ segment, routeKey, start: /** @type {Comment} */ (node) });
        return;
      }
      if (data.startsWith('/wj:children')) {
        const seg = data.slice('/wj:children'.length).replace(/^:/, '');
        const frame = stack.pop();
        if (!frame || frame.segment !== seg) { poisoned = true; return; }
        // Same-parent integrity: HTML parser reparenting (a <p> auto-closed
        // by block content) can split a pair across parents. The range
        // operations walk nextSibling from start and insert before end, so a
        // cross-parent pair would empty the region and then throw mid-swap.
        // Poison instead: degrade up front.
        if (frame.start.parentNode !== /** @type {Comment} */ (node).parentNode) {
          poisoned = true;
          return;
        }
        // Table-context integrity: foster-parenting moves CONTENT out of the
        // table while comment tokens stay put, so a boundary emitted in table
        // context shares a parent (passing the check above) while its actual
        // children were fostered OUTSIDE the range. Swapping that empty range
        // would silently leave stale visible content. A `${children}` slot
        // directly in table context cannot work as a swap boundary at all,
        // so poison it.
        {
          const pt = /** @type {Element} */ (frame.start.parentNode).tagName;
          if (pt === 'TABLE' || pt === 'TBODY' || pt === 'THEAD' || pt === 'TFOOT' || pt === 'TR') {
            poisoned = true;
            return;
          }
        }
        out.set(frame.segment, {
          routeKey: frame.routeKey,
          start: frame.start,
          end: /** @type {Comment} */ (node),
        });
        return;
      }
      return;
    }
    if (node.hasChildNodes && node.hasChildNodes()) {
      for (let child = node.firstChild; child && !poisoned; child = child.nextSibling) {
        visit(child);
      }
    }
  }
  visit(/** @type {Node} */ (root));

  if (poisoned || stack.length > 0) return null;
  return out;
}

/**
 * Plan the two-tier boundary swap from the live + incoming boundary maps
 * (#1015). Boundary segments are nested path prefixes, so the shared segments
 * form a chain from `/` down to the deepest shared boundary D.
 *
 * Rules (Next.js remount-vs-preserve parity):
 *  - A changed route-key REPLACES at the PARENT of the shallowest changed
 *    boundary. The parent, not the changed boundary itself: a LAYOUT's
 *    boundary wraps its CHILDREN slot, so the layout's OWN markup (an
 *    `[org]`-name header it renders around `${children}`) lives inside the
 *    PARENT's range. Anchoring at the parent remounts the changed layout's
 *    chrome AND its subtree, exactly like Next re-rendering the layout with
 *    new params. The page boundary composes the same way: its parent is the
 *    nearest layout's children slot, so `/blog/a` -> `/blog/b` under a
 *    `/blog` layout remounts just the page while the `/blog` layout chrome
 *    is preserved; with no intermediate layout the anchor is `/` and the
 *    root layout's chrome (outside its own children boundary) is still
 *    preserved. A changed boundary with NO shared parent degrades (null).
 *  - No route-key changed but the subtree below D diverges (D is a LAYOUT,
 *    not the deepest boundary, on either side, e.g. `/about` -> `/contact`
 *    under a shared static root layout): REPLACE D's contents wholesale.
 *  - No route-key changed and D is the deepest boundary on BOTH sides: MORPH
 *    D. The searchParams-only / refresh / revalidate nav, which must preserve
 *    hydrated component state while updating searchParam-driven DOM.
 *  - No shared segment at all: null (the caller degrades to a full load). In
 *    practice the page boundary exists on both sides of any same-app nav, so
 *    this is reached only for a divergent or malformed shell.
 *
 * @param {Map<string, { routeKey: string, start: Comment, end: Comment }>} here
 * @param {Map<string, { routeKey: string, start: Comment, end: Comment }>} there
 * @returns {{ mode: 'replace' | 'morph', segment: string,
 *   live: { routeKey: string, start: Comment, end: Comment },
 *   incoming: { routeKey: string, start: Comment, end: Comment } } | null}
 */
export function planBoundarySwap(here, there) {
  // Shared segments, shallowest first (a nested path prefix is shorter).
  const shared = [...here.keys()].filter((s) => there.has(s)).sort((a, b) => a.length - b.length);
  if (shared.length === 0) return null;
  // A changed route-key remounts at the PARENT of the shallowest change.
  for (const seg of shared) {
    if (here.get(seg).routeKey !== there.get(seg).routeKey) {
      let parent = null;
      for (const p of shared) {
        if (p === seg) break;
        if (seg.startsWith(p === '/' ? p : p + '/')) parent = p;
      }
      if (!parent) return null; // no anchored parent: degrade
      return { mode: 'replace', segment: parent, live: here.get(parent), incoming: there.get(parent) };
    }
  }
  // No route-key changed. D = deepest shared boundary.
  const D = shared[shared.length - 1];
  /** @param {Map<string, unknown>} m */
  const deepestOf = (m) => {
    let best = null;
    for (const s of m.keys()) if (best === null || s.length > best.length) best = s;
    return best;
  };
  const leafOnBoth = deepestOf(here) === D && deepestOf(there) === D;
  return {
    mode: leafOnBoth ? 'morph' : 'replace',
    segment: D,
    live: here.get(D),
    incoming: there.get(D),
  };
}

/* ====================================================================
 * Snapshot cache (Turbo SnapshotCache pattern)
 * ==================================================================== */

const SNAPSHOT_CAP = 16;
/** @typedef {{ html: string, scrollX: number, scrollY: number }} Snapshot */
/** @type {Map<string, Snapshot | string>} */
const snapshotCache = new Map();

/**
 * Cache the current document's HTML + window scroll position keyed by
 * URL. Used on back/forward navigation: the cached DOM restores
 * instantly, scroll position restores to whatever the user left it at.
 *
 * Turbo Drive captures `window.pageXOffset/pageYOffset` on every scroll
 * event into history state. Webjs captures lazily at snapshot time -
 * one read per nav rather than one per scroll event. Sufficient because
 * we only need the position at the moment of leaving.
 *
 * @param {string} url
 */
function snapshotCurrent(url) {
  const key = cacheKey(url);
  // Let components and app code strip transient state (open overlays, toasts,
  // in-progress wizard steps) from the page BEFORE it is serialized into the
  // back/forward cache, so a later popstate restore shows a clean page rather
  // than, say, a hover-card frozen open (#766, Turbo's `before-cache` contract).
  // Fires SYNCHRONOUSLY on the live DOM right before the outerHTML read, so a
  // handler's mutations are captured; the live edits are invisible because the
  // page is being navigated away from.
  document.dispatchEvent(new CustomEvent('webjs:before-cache', { detail: { url } }));
  // Move-to-front for LRU.
  if (snapshotCache.has(key)) snapshotCache.delete(key);
  /** @type {Snapshot} */
  const snap = {
    html: document.documentElement.outerHTML,
    scrollX: typeof window !== 'undefined' ? window.scrollX || 0 : 0,
    scrollY: typeof window !== 'undefined' ? window.scrollY || 0 : 0,
  };
  snapshotCache.set(key, snap);
  while (snapshotCache.size > SNAPSHOT_CAP) {
    const oldest = snapshotCache.keys().next().value;
    snapshotCache.delete(oldest);
  }
}

/**
 * Look up a cached snapshot by URL. Returns a normalized Snapshot or
 * null. Tolerates legacy string entries (e.g. from test fixtures that
 * `_snapshotCache.set('/x', 'snap')`).
 *
 * @param {string} url
 * @returns {Snapshot | null}
 */
function snapshotGet(url) {
  const key = cacheKey(url);
  const v = snapshotCache.get(key);
  if (v == null) return null;
  // Move-to-front.
  snapshotCache.delete(key);
  snapshotCache.set(key, v);
  if (typeof v === 'string') return { html: v, scrollX: 0, scrollY: 0 };
  return v;
}

/** @param {string} url */
function cacheKey(url) {
  const u = new URL(url, location.href);
  return u.pathname + u.search;
}

/* ====================================================================
 * Navigation
 * ==================================================================== */

/**
 * @param {string} href
 * @param {boolean} isPopState
 * @param {string | null} frameId  Active <webjs-frame> id, or null.
 */
async function performNavigation(href, isPopState, frameId) {
  // #1008 / #936: a forward, main-document nav fired while the document is
  // still parsing (`readyState === 'loading'`) races the DOM. The leaving
  // page's closing layout markers at the bottom of the body may not exist yet,
  // so `snapshotCurrent` plus region discovery would capture an incomplete tree
  // and drive a corrupt or over-wide swap (the suspected root cause of the
  // dropped-marker reports). The PREFETCH path already skips this window (see
  // the `buildHaveHeader` call site); the click / `navigate()` path did not.
  // Degrade to a correct full-page load, which is what an MPA would do anyway.
  // Scoped to frameless forward navs: popstate is browser-driven, and a frame
  // nav carries its own boundary element.
  if (shouldFullLoadDuringParse(isPopState, frameId) && typeof location !== 'undefined') {
    devWarnFallback('readyState-loading', href);
    location.href = href;
    return;
  }

  // Cancel any in-flight fetch: Turbo Drive's navigator.stop().
  if (activeAbortController) activeAbortController.abort();
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;
  // Bump nav generation. Captured below + by anything we await into.
  const myToken = ++currentNavigationToken;

  // Snapshot the page the user is LEAVING (with its scroll position)
  // so back/forward navigation can restore it. We key under
  // `currentPageUrl` rather than `location.href` because on popstate
  // the browser has already updated `location.href` to the destination
  // URL: using it as the key would clobber the cached snapshot we're
  // about to read in the popstate-restore branch below.
  if (currentPageUrl) snapshotCurrent(currentPageUrl);

  // Expose the opt-in `data-navigating` loading-indicator hook (see
  // setNavigating), but only if the nav takes long enough to be worth showing
  // one. Deferred so quick navs (sub-150ms) never set it at all.
  let navigatingFlagTimer = setTimeout(() => {
    setNavigating(true);
    navigatingFlagTimer = null;
  }, 150);

  // Optimistic loading: clone the per-segment loading.ts template (if
  // any) into the deepest current children-slot so the user sees an
  // instant skeleton instead of stale content. Saved so we can restore
  // it if the fetch fails.
  let optimisticState = null;
  if (!isPopState) optimisticState = applyOptimisticLoading();

  try {
    // popstate: try cache first, then refetch in background. Instant restore.
    if (isPopState) {
      const cached = snapshotGet(href);
      if (cached) {
        const cachedDoc = parseHTML(cached.html);
        if (cachedDoc) {
          applySwap(cachedDoc, frameId, /* revalidating */ true, /* href */ null);
          // Restore window scroll to where the user left it. Use
          // behavior:'instant' so an app-level `scroll-behavior: smooth`
          // stylesheet does not animate the restore (native nav jumps).
          if (typeof window !== 'undefined') {
            window.scrollTo({ left: cached.scrollX, top: cached.scrollY, behavior: 'instant' });
          }
          // Fire-and-forget revalidation. Uses a fresh AbortController
          // since this background fetch is allowed to overlap with the
          // next foreground nav (it'll get aborted if a new nav lands).
          fetchAndApply(href, frameId, /* recordHistory */ false, optimisticState, 'GET', null, signal, myToken, /* revalidating */ true)
            .catch(() => {});
          return;
        }
      }
      // Cache-miss popstate. Browser-native scroll restoration is
      // disabled (we set scrollRestoration='manual'): so without
      // explicit handling, scroll would just stay where the user was
      // on the page they popped FROM. Scroll to top as the reasonable
      // default; fetchAndApply skips its own scroll handling when
      // recordHistory=false (which is the case here).
      if (typeof window !== 'undefined') window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
    }

    await fetchAndApply(href, frameId, !isPopState, optimisticState, 'GET', null, signal, myToken);
  } finally {
    if (navigatingFlagTimer) clearTimeout(navigatingFlagTimer);
    // Only clear the navigating flag if WE are still the active nav.
    // A newer nav has its own flag lifecycle.
    if (myToken === currentNavigationToken) {
      setNavigating(false);
      // Record where the user is NOW so the next navigation can
      // snapshot under the right URL key.
      if (typeof location !== 'undefined') currentPageUrl = location.href;
    }
  }
}

/**
 * Submit a form via the partial-swap pipeline. Mirrors performNavigation
 * but routes the FormData body. GET submissions promote the body to a
 * query string (HTML form-submission algorithm); non-GET submissions
 * send the body as-is.
 *
 * Mutating methods (anything except GET/HEAD) clear the whole snapshot
 * cache after a successful response: Turbo's `clearSnapshotCache()` on
 * `!isSafe` (`navigator.js:71-88`). Other URLs in the cache may have
 * been server-side-mutated by this submission; refusing to clear would
 * serve stale content on subsequent back/forward.
 *
 * Submission-state events + aria-busy: while the enhanced submission fetch
 * is in flight the router sets `aria-busy="true"` on the FORM element and
 * dispatches `webjs:submit-start` (detail `{ form, url }`); on EVERY settle
 * path (success swap, validation re-render, navigation error, abort by a
 * superseding submit/nav) it clears `aria-busy` and dispatches
 * `webjs:submit-end` (detail `{ form, url, ok }`, `ok` = the submission was
 * not an error outcome). The toggle uses the same nav-token guard the
 * `<webjs-frame>` busy state uses (`formBusyTokens` / `markFormBusy` /
 * `clearFormBusy`): a superseded submit's teardown never clears the busy
 * state a NEWER submit already set, so a rapid re-submit stays busy until the
 * live submission settles. The native `aria-busy` attribute on the form is
 * the readable "is this form submitting" primitive (any component can read
 * it); the events are the push-notification counterpart. Progressive
 * enhancement: with JS off this whole code path is skipped and the form is a
 * plain POST.
 *
 * @param {string} href     Absolute target URL.
 * @param {string} method   Lowercased HTTP verb.
 * @param {FormData} body
 * @param {string | null} frameId
 * @param {HTMLFormElement | null} [form]  The submitted form, for busy + events.
 */
async function performSubmission(href, method, body, frameId, form) {
  if (activeAbortController) activeAbortController.abort();
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;
  const myToken = ++currentNavigationToken;

  const isSafe = method === 'get' || method === 'head';
  let url = new URL(href, location.href);
  if (isSafe) {
    // Promote body to query string per the HTML5 form-submission
    // algorithm. The form's own `action` query is replaced: same as
    // a native GET-form submission.
    url.search = '';
    for (const [k, v] of body) {
      url.searchParams.append(k, typeof v === 'string' ? v : v.name);
    }
  }

  // Snapshot the page being submitted from (form submissions are
  // always foreground / never popstate, so `currentPageUrl` already
  // matches `location.href`: but use the tracker for consistency
  // with performNavigation).
  if (currentPageUrl) snapshotCurrent(currentPageUrl);

  let navigatingFlagTimer = setTimeout(() => {
    setNavigating(true);
    navigatingFlagTimer = null;
  }, 150);

  const optimisticState = applyOptimisticLoading();

  // Submission-state lifecycle: mark the form busy + announce the start, then
  // clear + announce the settle in the finally so EVERY exit (success,
  // validation re-render, navigation error, abort by a superseding submit)
  // balances the pair. `ok` is filled from the fetch outcome; an abort or a
  // teardown that never reached the fetch settles ok:false. The token guard
  // (markFormBusy/clearFormBusy) keeps a superseded submit's teardown from
  // clearing the busy state a newer submit set.
  const busyForm = form ? markFormBusy(form, myToken, url.href) : null;
  let outcomeOk = false;
  try {
    const outcome = await fetchAndApply(
      url.href,
      frameId,
      /* recordHistory */ true,
      optimisticState,
      isSafe ? 'GET' : method.toUpperCase(),
      isSafe ? null : body,
      signal,
      myToken,
    );
    outcomeOk = !!(outcome && outcome.ok);
    // Mutating submissions invalidate cached versions of other URLs -
    // do this *after* the response applies so the new page itself is
    // snapshotted on the next nav, not pre-emptively wiped. Clear the
    // speculative prefetch cache too: a fragment prefetched before this
    // mutation would otherwise be served stale on a later forward click.
    if (!isSafe && myToken === currentNavigationToken) {
      snapshotCache.clear();
      prefetchCache.clear();
    }
  } finally {
    if (busyForm) clearFormBusy(busyForm, myToken, url.href, outcomeOk);
    if (navigatingFlagTimer) clearTimeout(navigatingFlagTimer);
    if (myToken === currentNavigationToken) {
      setNavigating(false);
      if (typeof location !== 'undefined') currentPageUrl = location.href;
    }
  }
}

/**
 * Build the X-Webjs-Have header value from the live DOM's boundaries.
 * Comma-separated `<segment>:<route-key>` entries in document order. The
 * ROUTE-KEY rides along so the server's short-circuit can distinguish "the
 * client has this layout" from "the client has this layout rendered for
 * DIFFERENT params": a dynamic `[org]` layout the client holds for org-a
 * must be re-rendered (and re-shipped) on an org-b navigation, or the
 * parent-anchored REPLACE would have no fresh layout markup to swap in.
 * The server ignores the page-boundary entry (never a layout segment).
 *
 * A poisoned live DOM (malformed boundaries) reports an EMPTY have, so the
 * server returns the full page. The subsequent applySwap re-scans, sees the
 * same poisoned live tree, and degrades to a full load: consistent with the
 * integrity-gate model, never a reduced fragment spliced against a tree we
 * cannot trust (#1015).
 *
 * @returns {string}
 */
function buildHaveHeader() {
  const boundaries = collectBoundaries(document.body);
  if (!boundaries) return '';
  return [...boundaries.entries()].map(([seg, b]) => `${seg}:${b.routeKey}`).join(',');
}

/* ====================================================================
 * Link prefetch (Remix-style strategies, fast-by-default)
 *
 * A link click already resolves through fetchAndApply, but the fetch
 * only STARTS on click, so the user waits a full round-trip. Prefetch
 * warms a dedicated cache speculatively so the click reads it instantly.
 *
 * Strategy per anchor via a `data-prefetch` attribute (valid-HTML data-*,
 * like SvelteKit / Astro). The default is DEVICE-ADAPTIVE so the common case
 * is fast on every device without per-link opt-in: `intent` on a hover-capable
 * pointer (a real head-start before the click), `viewport` on touch (no hover
 * exists, and `touchstart` fires too close to the tap to front-run it). Value
 * vocabulary borrows Next's true/false/auto aliases:
 *   - absent (default)       : intent on pointer, viewport on touch (adaptive)
 *   - intent                 : hover / focus / touch, after a short dwell
 *   - true / render          : eager, as soon as a document scan sees it
 *   - auto / viewport        : on viewport entry (IntersectionObserver, 0.5),
 *                              after a dwell so a fast scroll-through skips it
 *   - false / none           : never (also data-no-prefetch / rel="external")
 *
 * Why a separate cache, not snapshotCache: snapshotCache is keyed to the
 * back/forward restore path (popstate), which holds the FULL serialized
 * document of pages the user already visited. A prefetch holds the
 * SERVER FRAGMENT for a page not yet visited (the same X-Webjs-Have
 * partial body a real nav would receive). fetchAndApply consumes it via
 * prefetchTake() before falling back to the network.
 *
 * Only same-origin in-app links are prefetched (the same eligibility as
 * a click), and never under Save-Data / prefers-reduced-data / a 2g link,
 * never past a small concurrency cap, and never twice (deduped + cached). The
 * viewport path additionally waits a dwell and cancels on scroll-out, so a
 * fast scroll through a long list does not flood the network tab. There is no
 * logout-style heuristic: prefetch issues a real GET, so as everywhere in
 * the ecosystem (Next / Nuxt / Remix), a non-idempotent action must be a
 * POST or a `<form>`, and `data-no-prefetch` / `rel="external"` opt out.
 *
 * What we do NOT touch: a native `<link rel="prefetch">` in the document
 * head is the browser's own mechanism and warms the HTTP cache; we never
 * interfere with it.
 * ==================================================================== */

/** Max speculative responses held at once (LRU). */
const PREFETCH_CAP = 8;
/** Speculative entries expire after this long (ms): avoid serving stale. */
const PREFETCH_TTL = 30_000;
/** Max concurrent in-flight prefetch requests. */
const PREFETCH_CONCURRENCY = 3;
/** Max prefetches waiting for a free slot (bounds a huge link list). */
const PREFETCH_QUEUE_CAP = 24;
/** Hover dwell before a prefetch fires (ms): filter drive-by pointer moves. Matches Remix's intent timeout. */
const PREFETCH_HOVER_DELAY = 100;
/**
 * Viewport dwell before a prefetch fires (ms): a link must SETTLE on-screen,
 * not merely flash past during a scroll. A fast scroll-through clears the
 * timer on exit, so flicked-past links never fetch. Astro uses 300ms for the
 * same purpose; we sit a touch lower so a deliberate stop still feels instant.
 */
const PREFETCH_VIEWPORT_DELAY = 250;

/** @typedef {{ html: string, build: string | null, finalUrl: string, at: number }} PrefetchEntry */
/** @type {Map<string, PrefetchEntry>} */
const prefetchCache = new Map();
/** Keys with a fetch currently in flight (dedupe + concurrency gate). */
const prefetchInflight = new Set();
/** hrefs waiting for a free concurrency slot (FIFO), and their keys. */
const prefetchQueue = [];
const prefetchQueued = new Set();
/** Pending hover-dwell timer, cleared on pointerout / blur. */
let prefetchHoverTimer = null;
/** Last anchor a hover timer was armed for (so pointerout can match). */
let prefetchHoverAnchor = null;
/** IntersectionObserver for data-prefetch="viewport" anchors, or null. */
let prefetchViewObserver = null;
/** Per-anchor viewport-dwell timers, so a scroll-out can cancel before firing. */
let prefetchViewTimers = new WeakMap();
/** Live viewport-dwell timer ids, for bulk teardown on disable. */
const prefetchViewPending = new Set();

/**
 * True when the user or platform has asked us to conserve data, OR the
 * connection is too slow to spend bytes speculatively. The Save-Data client
 * hint, the prefers-reduced-data media query, and a 2g `effectiveType` all
 * disable speculative fetching, the same gate Astro / Nuxt apply. Guarded for
 * non-browser / partial DOM.
 *
 * @returns {boolean}
 */
function prefetchSaysSaveData() {
  try {
    const c = typeof navigator !== 'undefined' ? /** @type any */ (navigator).connection : null;
    if (c) {
      if (c.saveData === true) return true;
      // effectiveType is 'slow-2g' | '2g' | '3g' | '4g'; skip the 2g tiers.
      if (typeof c.effectiveType === 'string' && /2g$/.test(c.effectiveType)) return true;
    }
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-data: reduce)').matches) {
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Whether the device drives a hover-capable fine pointer (a mouse or
 * trackpad), as opposed to touch. This picks the ADAPTIVE prefetch default:
 * `intent` (hover / focus) on a pointer device, `viewport` on touch, since a
 * touch device has no hover and `touchstart` fires too close to the tap to
 * front-run it. Detected with `matchMedia('(hover: hover) and (pointer: fine)')`
 * rather than a user-agent sniff. When `matchMedia` is unavailable we assume a
 * pointer (the historical default), so a non-browser / partial-DOM environment
 * keeps the `intent` behaviour and never silently switches to viewport.
 *
 * @returns {boolean}
 */
function prefetchHasHoverPointer() {
  try {
    if (typeof matchMedia === 'function') {
      return matchMedia('(hover: hover) and (pointer: fine)').matches;
    }
  } catch { /* ignore */ }
  return true;
}

/**
 * Lowercased whitespace-separated rel tokens of an anchor.
 * @param {Element} anchor
 * @returns {string[]}
 */
function relTokens(anchor) {
  const rel = anchor.getAttribute('rel');
  return rel ? rel.toLowerCase().split(/\s+/).filter(Boolean) : [];
}

/**
 * Decide whether an anchor is a same-origin in-app target the router can
 * navigate, returning its absolute href or null. Shared by onClick and
 * the prefetch listeners so eligibility never drifts between them.
 *
 * @param {Element | null} anchor
 * @returns {string | null}
 */
function eligibleAnchorHref(anchor) {
  if (!anchor || !(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.hasAttribute('download')) return null;
  if (anchor.hasAttribute('data-no-router')) return null;
  if (anchor.target && anchor.target !== '_self') return null;
  const href = anchor.href;
  if (!href) return null;
  let url;
  try { url = new URL(href); } catch { return null; }
  if (url.origin !== location.origin) return null;
  // A pure same-page hash jump is not a navigation we fetch.
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return null;
  if (NON_HTML_EXTENSIONS.test(url.pathname)) return null;
  return href;
}

/**
 * Whether prefetching this anchor is suppressed by author intent. The
 * `external` rel marks a link leaving the app, `no-prefetch` and
 * `data-no-prefetch` are explicit opt-outs, and `data-no-router` already
 * disables routing entirely (so it is caught upstream too).
 *
 * @param {Element} anchor
 * @returns {boolean}
 */
function prefetchSuppressed(anchor) {
  if (anchor.hasAttribute('data-no-prefetch')) return true;
  const rel = relTokens(anchor);
  return rel.includes('external') || rel.includes('no-prefetch');
}

/**
 * Resolve the prefetch strategy for an anchor from a `data-prefetch`
 * attribute. WebJs has no Link component (links are plain `<a href>`), so
 * the knob is a valid-HTML `data-*` attribute, the same shape SvelteKit
 * (`data-sveltekit-preload-data`) and Astro (`data-astro-prefetch`) use.
 * Next.js / Nuxt / Remix express the same choice as a component PROP
 * (`<Link prefetch>`) that never reaches the DOM, so there is nothing to
 * mirror attribute-wise; we reuse their value vocabulary (true/false/auto)
 * as aliases. Default is `intent` (fast-by-default) when the attribute is
 * absent or unrecognised.
 *
 * Value mapping (case-insensitive):
 *   - absent / unknown   : the DEVICE-ADAPTIVE default (intent on a pointer,
 *                          viewport on touch); an explicit value always wins
 *   - `intent`           : hover / focus / touch, after a short dwell
 *   - `true` / `render`  : eager, as soon as a document scan sees the link
 *   - `auto` / `viewport`: on viewport entry (IntersectionObserver), after a dwell
 *   - `false` / `none`   : never (also via data-no-prefetch / rel="external")
 *
 * The default is adaptive (not a single `intent`) because `intent` does not
 * help on mobile: a touch device has no hover, and `touchstart` fires at tap
 * time, so the prefetch races the navigation. On touch we default to
 * `viewport` (warm links as they settle on-screen) and keep `touchstart` as an
 * extra warm for the tapped link; on a pointer device `intent` stays the
 * default (precise, cheap, a real head-start before the click). A per-link
 * `data-prefetch` always overrides the adaptive default.
 *
 * Returns `none` for suppressed anchors so callers have a single check.
 *
 * @param {Element} anchor
 * @returns {'intent' | 'render' | 'viewport' | 'none'}
 */
function prefetchMode(anchor) {
  if (prefetchSuppressed(anchor)) return 'none';
  const raw = (anchor.getAttribute('data-prefetch') || '').toLowerCase().trim();
  switch (raw) {
    case 'false':
    case 'none':
      return 'none';
    case 'true':
    case 'render':
      return 'render';
    case 'auto':
    case 'viewport':
      return 'viewport';
    case 'intent':
      return 'intent';
    default:
      // Unset or unrecognised value: the device-adaptive default.
      return prefetchHasHoverPointer() ? 'intent' : 'viewport';
  }
}

/**
 * Speculatively fetch `href` and stash the server fragment so a later
 * click resolves instantly. No-op when data-saving is on or the entry is
 * already cached or in flight. When the concurrency gate is full the
 * request is QUEUED (not dropped) and drains as in-flight slots free, so
 * a burst of `render` / `viewport` links all eventually prefetch rather
 * than silently losing everything past the cap.
 *
 * @param {string} href
 */
function prefetch(href) {
  // Never speculate once the router is torn down: a leftover hover / queue /
  // dwell timer that fires after disableClientRouter must not issue a fetch.
  if (!enabled) return;
  if (typeof fetch !== 'function') return;
  if (prefetchSaysSaveData()) return;
  const key = cacheKey(href);
  if (prefetchInflight.has(key)) return;
  if (prefetchQueued.has(key)) return;
  const existing = prefetchCache.get(key);
  if (existing && (nowMs() - existing.at) < PREFETCH_TTL) return;
  if (prefetchInflight.size >= PREFETCH_CONCURRENCY) {
    // Gate full: queue rather than drop, bounded so a huge link list
    // cannot grow the queue without limit (oldest queued entry is shed).
    prefetchQueued.add(key);
    prefetchQueue.push(href);
    while (prefetchQueue.length > PREFETCH_QUEUE_CAP) {
      const dropped = prefetchQueue.shift();
      prefetchQueued.delete(cacheKey(dropped));
    }
    return;
  }

  const have = buildHaveHeader();
  // #936: while the document is still parsing, the closing `<!--/wj:children-->`
  // marker at the bottom of the body may not exist yet, so `buildHaveHeader()`
  // returns '' meaning "markers not parsed yet", NOT "this page has no layout".
  // A touch-device viewport prefetch fires early enough (mid-parse) to hit this
  // window on real Android Chrome. Caching that empty-`have` response (a full
  // page) would later drive the destructive full-body swap fallback. Skip the
  // speculative fetch; the click path re-fetches with a correct `have` once the
  // document has parsed (and applySwap now falls back to a full load anyway).
  if (!have && typeof document !== 'undefined' && document.readyState === 'loading') return;

  prefetchInflight.add(key);
  const headers = { 'x-webjs-router': '1', 'x-webjs-prefetch': '1' };
  if (have) headers['x-webjs-have'] = have;

  fetch(href, { method: 'GET', headers, credentials: 'same-origin' })
    .then(async (resp) => {
      const ctype = resp.headers.get('content-type') || '';
      if (!/^text\/html\b/i.test(ctype)) return;
      if (resp.status >= 400) return;
      const build = resp.headers.get('x-webjs-build');
      const src = resp.headers.get('x-webjs-src');
      // Deploy detected at PREFETCH time (#899). A prefetch fetch carries the
      // server's current build id AND app-source id. If EITHER differs from what
      // the page booted with, a deploy landed, so every earlier snapshot/prefetch
      // is pre-deploy and stale. Evict them here, well before the click (a
      // hover/viewport prefetch fires early), so a click on a previously-
      // prefetched link re-fetches fresh (then applySwap hard-reloads on a build
      // change or soft-applies on a src-only change). This shrinks the window
      // where a pre-deploy prefetch, whose stored ids equal the still-old page
      // ids so applySwap alone cannot tell it is stale, is served. Both ids of a
      // pair must be present: an empty id is the warmup "version unknown", never
      // a deploy signal.
      const pageTag = typeof document !== 'undefined' ? document.querySelector('script[type="importmap"]') : null;
      const pageBuild = pageTag ? pageTag.getAttribute('data-webjs-build') : null;
      const pageSrc = pageTag ? pageTag.getAttribute('data-webjs-src') : null;
      if ((build && pageBuild && build !== pageBuild) || (src && pageSrc && src !== pageSrc)) {
        snapshotCache.clear();
        prefetchCache.clear();
        // Deliberately do NOT advance the page's data-webjs-src here (only the
        // foreground `applySwap` does). A prefetch is speculative; leaving the
        // reference id on the old deploy keeps applySwap the single authority
        // that settles the page on the first real navigation. The cost is small:
        // repeated prefetches in the pre-first-nav window each re-clear the
        // (already tiny) caches, which converges the instant the user navigates.
      }
      const finalUrl = resp.redirected && resp.url ? resp.url : href;
      const html = await resp.text();
      prefetchStore(key, { html, build, src, finalUrl, at: nowMs() });
    })
    .catch(() => { /* speculative: swallow */ })
    .finally(() => {
      prefetchInflight.delete(key);
      drainPrefetchQueue();
    });
}

/** Start the next queued prefetch if a concurrency slot is free. */
function drainPrefetchQueue() {
  while (prefetchQueue.length && prefetchInflight.size < PREFETCH_CONCURRENCY) {
    const href = prefetchQueue.shift();
    prefetchQueued.delete(cacheKey(href));
    prefetch(href);
  }
}

/**
 * Store a speculative entry under LRU + cap, then announce that the
 * fragment is cached and consumable.
 *
 * The `webjs:prefetch` event fires the instant a speculative fragment
 * becomes consumable (after the response body has been read), which is
 * strictly later than the prefetch request going out. App code can
 * listen to instrument prefetch hit rate, and tests can await it to know
 * a subsequent click will consume the cache rather than refetch. The
 * detail carries the cached URL and a `from: 'prefetch'` tag so a single
 * listener can disambiguate it from `webjs:navigate`.
 *
 * @param {string} key
 * @param {PrefetchEntry} entry
 */
function prefetchStore(key, entry) {
  if (prefetchCache.has(key)) prefetchCache.delete(key);
  prefetchCache.set(key, entry);
  while (prefetchCache.size > PREFETCH_CAP) {
    const oldest = prefetchCache.keys().next().value;
    prefetchCache.delete(oldest);
  }
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('webjs:prefetch', {
      detail: { url: entry.finalUrl, key, from: 'prefetch' },
    }));
  }
}

/**
 * Consume a fresh speculative entry for `href`, removing it (a fragment
 * is single-use: once applied it becomes a real snapshot). Returns null
 * on miss or when the entry has aged past the TTL.
 *
 * @param {string} href
 * @returns {PrefetchEntry | null}
 */
function prefetchTake(href) {
  const key = cacheKey(href);
  const entry = prefetchCache.get(key);
  if (!entry) return null;
  prefetchCache.delete(key);
  if ((nowMs() - entry.at) >= PREFETCH_TTL) return null;
  return entry;
}

/** Monotonic-ish clock guarded for environments without performance. */
function nowMs() {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch { /* ignore */ }
  return 0;
}

/** @param {Event} e */
function onPrefetchIntent(e) {
  if (!enabled) return;
  const anchor = closestAnchor(/** @type any */ (e.target));
  if (!anchor) return;
  const mode = prefetchMode(anchor);
  // `none` is suppressed; `render` already prefetched on the document scan.
  if (mode === 'none' || mode === 'render') return;
  const href = eligibleAnchorHref(anchor);
  if (!href) return;
  // touchstart IS the tap: warm the tapped link immediately, for both intent
  // and viewport modes (a single request for a link about to be navigated, the
  // small mobile win the viewport default cannot give for the link just tapped).
  // No dwell, since the tap is the intent.
  if (e.type === 'touchstart') { prefetch(href); return; }
  // hover / focus only warm `intent` links; `viewport` links are the
  // observer's job (warmed on a dwell, not on a stray hover).
  if (mode !== 'intent') return;
  // pointerover/focusin bubble, so re-entering a child of the same anchor
  // would re-arm; collapse to one timer per anchor.
  if (prefetchHoverAnchor === anchor && prefetchHoverTimer) return;
  clearPrefetchHover();
  prefetchHoverAnchor = anchor;
  prefetchHoverTimer = setTimeout(() => {
    prefetchHoverTimer = null;
    prefetchHoverAnchor = null;
    prefetch(href);
  }, PREFETCH_HOVER_DELAY);
}

/** @param {Event} e */
function onPrefetchOut(e) {
  const anchor = closestAnchor(/** @type any */ (e.target));
  if (anchor && anchor === prefetchHoverAnchor) clearPrefetchHover();
}

function clearPrefetchHover() {
  if (prefetchHoverTimer) { clearTimeout(prefetchHoverTimer); prefetchHoverTimer = null; }
  prefetchHoverAnchor = null;
}

/** Cancel every pending viewport-dwell timer and reset the per-anchor map. */
function clearPrefetchViewTimers() {
  for (const timer of prefetchViewPending) clearTimeout(timer);
  prefetchViewPending.clear();
  prefetchViewTimers = new WeakMap();
}

/**
 * Nearest enclosing <a>, crossing shadow boundaries, from an event
 * target. composedPath is click-only, so walk getRootNode().host here.
 *
 * @param {EventTarget | null} target
 * @returns {HTMLAnchorElement | null}
 */
function closestAnchor(target) {
  let node = /** @type {Node | null} */ (target);
  while (node) {
    if (node instanceof HTMLAnchorElement) return node;
    const el = node.nodeType === 1 ? /** @type {Element} */ (node) : null;
    if (el) {
      const a = el.closest && el.closest('a');
      if (a instanceof HTMLAnchorElement) return a;
    }
    const root = node.getRootNode ? node.getRootNode() : null;
    node = root && /** @type any */ (root).host ? /** @type any */ (root).host : null;
  }
  return null;
}

/**
 * (Re)scan the document and apply the non-hover prefetch modes:
 *   - `render`   anchors prefetch immediately (they are now in the DOM).
 *   - `viewport` anchors are observed and prefetch on intersection.
 * `intent` (the default) is handled by the hover/focus/touch listeners,
 * and `none` is skipped. Called on enable and after each navigation,
 * since the swapped-in DOM may carry new links.
 *
 * The viewport threshold (0.5) matches Remix's IntersectionObserver.
 */
function refreshPrefetchObservers() {
  if (typeof document === 'undefined') return;
  if (prefetchSaysSaveData()) return;
  const hasIO = typeof IntersectionObserver !== 'undefined';
  if (hasIO) {
    if (!prefetchViewObserver) {
      prefetchViewObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const anchor = /** @type {Element} */ (entry.target);
          if (entry.isIntersecting) {
            // Arm a dwell timer; the link must STAY on-screen to warm. One
            // timer per anchor, so re-entry while pending does not stack.
            if (prefetchViewTimers.has(anchor)) continue;
            const timer = setTimeout(() => {
              prefetchViewPending.delete(timer);
              prefetchViewTimers.delete(anchor);
              prefetchViewObserver.unobserve(anchor);
              const href = eligibleAnchorHref(anchor);
              if (href && prefetchMode(anchor) === 'viewport') prefetch(href);
            }, PREFETCH_VIEWPORT_DELAY);
            prefetchViewTimers.set(anchor, timer);
            prefetchViewPending.add(timer);
          } else {
            // Scrolled out before the dwell elapsed: cancel, so a fast
            // scroll-through never spends a request.
            const timer = prefetchViewTimers.get(anchor);
            if (timer) {
              clearTimeout(timer);
              prefetchViewPending.delete(timer);
              prefetchViewTimers.delete(anchor);
            }
          }
        }
      }, { threshold: 0.5 });
    } else {
      // Re-scan: drop the old observation set AND cancel any pending dwell
      // timers, so a timer armed for an anchor the soft-nav swap removed cannot
      // fire a prefetch for a stale URL (its exit callback never comes once it
      // is gone). Anchors still on-screen re-arm when observe() below redelivers
      // their current intersection state.
      prefetchViewObserver.disconnect();
      clearPrefetchViewTimers();
    }
  }
  for (const anchor of document.querySelectorAll('a[href]')) {
    const mode = prefetchMode(anchor);
    if (mode === 'render') {
      const href = eligibleAnchorHref(anchor);
      if (href) prefetch(href);
    } else if (mode === 'viewport' && hasIO) {
      prefetchViewObserver.observe(anchor);
    }
  }
}

/**
 * Render the minimal default in-place error surface into the deepest
 * shared layout children slot, so the SPA shell (outer chrome, nav,
 * scroll, focus, client state) survives a failed navigation instead of
 * being destroyed by a full reload. Returns true when it rendered into a
 * slot, false when no shared layout marker exists (a cross-document nav).
 * On a false return the caller may fall back to a hard load as a last
 * resort.
 *
 * @param {number | null} status  HTTP status of the failed response, or null for a transport/parse failure.
 * @returns {boolean}
 */
function renderInPlaceNavError(status) {
  if (typeof document === 'undefined' || !document.body) return false;
  const here = collectBoundaries(document.body);
  if (!here) return false; // poisoned live tree: let the caller hard-load
  // The deepest boundary is the same swap target a normal partial swap writes
  // to (longest path wins), so the outer chrome / nav are preserved.
  /** @type {{ start: Comment, end: Comment } | undefined} */
  let deepest;
  let deepestPathLen = -1;
  for (const [path, slot] of here) {
    if (path.length > deepestPathLen) { deepestPathLen = path.length; deepest = slot; }
  }
  if (!deepest) return false;
  const liveParent = deepest.start.parentNode;
  if (!liveParent || deepest.start.parentNode !== deepest.end.parentNode) return false;

  const alert = document.createElement('div');
  alert.setAttribute('role', 'alert');
  alert.setAttribute('data-webjs-nav-error', '');
  const msg = status
    ? `This page could not be loaded. (status ${status})`
    : 'This page could not be loaded.';
  alert.textContent = msg;

  // Replace the slot contents with the alert.
  const range = document.createRange();
  range.setStartAfter(deepest.start);
  range.setEndBefore(deepest.end);
  range.deleteContents();
  liveParent.insertBefore(alert, deepest.end);
  return true;
}

/**
 * Shared fallback for a non-HTML error response or a transport/parse
 * failure during a client navigation. Dispatches a cancelable
 * `webjs:navigation-error` event on `document` (matching the
 * `webjs:frame-missing` / `webjs:prefetch` dispatch convention) so the
 * app can recover in place. If the app calls `preventDefault()`, the
 * router does NOTHING further and leaves the current page exactly as it
 * is. Otherwise it renders a minimal in-place `role="alert"` surface into
 * the deepest layout children slot (the SPA shell survives), and only
 * hard-navigates as a last resort when no in-place target exists.
 *
 * Never call this for an AbortError: a superseding nav is a normal
 * supersede, not an error, and must not surface a navigation-error.
 *
 * @param {string} href  The URL that failed to navigate to.
 * @param {number | null} status  HTTP status when a response arrived, else null.
 * @param {Error | null} error  The Error for a transport/parse failure, else null.
 */
function handleNavigationError(href, status, error) {
  const evt = new CustomEvent('webjs:navigation-error', {
    bubbles: true,
    cancelable: true,
    detail: { url: href, status: status == null ? null : status, error: error || null },
  });
  // Guard the dispatch: a throwing app listener must not wedge the nav engine.
  if (typeof document !== 'undefined') {
    try { document.dispatchEvent(evt); } catch { /* a buggy listener cannot break recovery */ }
  }
  // The app owns recovery: leave the page untouched (shell, scroll, focus,
  // client state all preserved). No reload, no render.
  if (evt.defaultPrevented) return;
  // Default: render a minimal in-place error surface so the SPA is not
  // destroyed and the user is not sent to a second failing round-trip.
  if (renderInPlaceNavError(status)) return;
  // Last resort only: no shared layout marker to render into (a genuine
  // cross-document nav). Fall back to a hard load so an unrecoverable case
  // is not a silent dead-end. This is the exception, reached only after
  // the event was not cancelled AND no in-place target exists.
  if (typeof location !== 'undefined') location.href = href;
}

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
 * @returns {Promise<{ ok: boolean, status: number | null, aborted: boolean }>}
 *   The fetch outcome, so a caller (the form-submission busy/event lifecycle)
 *   can report whether the submission settled as a success, an error, or an
 *   abort. `ok` mirrors `response.ok` for an HTTP response (a 422 validation
 *   re-render is `ok:false`), `false` for a transport/parse error, and `false`
 *   for an abort (which also sets `aborted:true`). `status` is the HTTP status
 *   or `null` when the request never produced one.
 */
async function fetchAndApply(href, frameId, recordHistory, optimisticState, method, body, signal, token, revalidating) {
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
    // Warm-cache fast path: a hover/focus/viewport prefetch may have
    // already fetched this exact page (same X-Webjs-Have shell). Consume
    // it instead of going to the network, so the click resolves with no
    // round-trip. Only for plain GET navs without a frame target; form
    // submissions and frame swaps always hit the server. The entry is
    // single-use (prefetchTake removes it) and TTL-guarded inside take.
    const prefetched = (method === 'GET' && !body && !frameId) ? prefetchTake(href) : null;
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
    const have = buildHaveHeader();
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
    const init = { method, headers, credentials: 'same-origin' };
    if (signal) init.signal = signal;
    if (body != null && method !== 'GET' && method !== 'HEAD') init.body = body;

    const resp = await fetch(href, init);
    respStatus = resp.status;
    respOk = resp.ok;
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
      if (myToken === currentNavigationToken) {
        // Roll back any optimistic loading skeleton: a stream response patches
        // the page in place, it does not swap the region the skeleton covered.
        restoreOptimistic(optimisticState);
        renderStream(text);
      }
      return { ok: respOk, status: respStatus, aborted: false };
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
      return { ok: respOk, status: respStatus, aborted: false };
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
      return { ok: false, status: respStatus, aborted: false };
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
    if (err && /** @type any */ (err).name === 'AbortError') return { ok: false, status: null, aborted: true };
    // Stale (a newer nav started before we got the network error): the
    // newer nav owns the page now, so don't clobber it.
    if (myToken !== currentNavigationToken) return { ok: false, status: null, aborted: true };
    restoreOptimistic(optimisticState);
    // Transport/parse failure (fetch rejected, e.g. offline / DNS / TLS).
    // Surface a navigation-error so the app can recover in place instead
    // of a destructive full reload.
    handleNavigationError(href, null, err instanceof Error ? err : new Error(String(err)));
    return { ok: false, status: null, aborted: false };
  }

  // A newer navigation started while we awaited the response body -
  // bail before we overwrite its work.
  if (myToken !== currentNavigationToken) {
    if (streamCtx && streamCtx.reader) { try { streamCtx.reader.cancel(); } catch { /* ignore */ } }
    return { ok: false, status: respStatus, aborted: true };
  }

  const doc = parseHTML(html);
  // The body claimed text/html but didn't parse into a document (a
  // malformed/empty HTML body). Surface a navigation-error so the app can
  // recover in place rather than a destructive full reload.
  if (!doc) { restoreOptimistic(optimisticState); handleNavigationError(href, null, new Error('navigation response did not parse as HTML')); return { ok: false, status: respStatus, aborted: false }; }

  const disposition = applySwap(doc, frameId, !!revalidating, finalUrl, incomingBuild, incomingSrc);
  // A discarded revalidation must be discarded OUTRIGHT: a streamed response's
  // boundary templates must not splice into the restored snapshot afterward
  // (boundary ids are per-render sequential, so a reduced render's numbering
  // need not line up with the snapshot's). Cancel the reader and stop here.
  if (disposition === 'discard') {
    if (streamCtx && streamCtx.reader) { try { streamCtx.reader.cancel(); } catch { /* ignore */ } }
    return { ok: respOk, status: respStatus, aborted: false };
  }

  if (recordHistory) history.pushState(null, '', finalUrl);

  // Scroll only for foreground (history-recording) navigations. When
  // `recordHistory` is false we're either:
  //   (a) the background revalidation after a cached popstate restore
  //       - performNavigation already set scroll from the cached
  //       position; we must NOT clobber it here.
  //   (b) a cache-miss popstate: modern browsers fire scroll-
  //       restoration themselves before dispatching popstate, so
  //       leaving scroll alone preserves the browser-native UX.
  if (recordHistory) {
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
  return { ok: respOk, status: respStatus, aborted: false };
  } finally {
    // Clear the frame's busy state on every exit path (the early returns
    // above all unwind through here). No-op when this was not a frame nav.
    if (busyFrame) clearFrameBusy(busyFrame, myToken);
  }
}

/**
 * The nav token that currently OWNS each frame's busy state. Under two rapid
 * frame navs the router aborts the first; its `finally` would otherwise clear
 * `aria-busy` that the SECOND nav already re-set, leaving the frame falsely
 * idle while still loading (and an unbalanced busy-event stream). A clear only
 * fires when its token still owns the frame, so the superseding nav's busy
 * state survives the aborted nav's teardown.
 *
 * @type {WeakMap<Element, number>}
 */
const frameBusyTokens = new WeakMap();

/**
 * Set `aria-busy="true"` on the live `<webjs-frame id>` element and announce
 * the start of its load with a bubbling `webjs:frame-busy` event (detail
 * `{ frameId, busy: true }`), mirroring Turbo's `frame.markAsBusy`. Stamps the
 * nav `token` as the frame's busy owner (see `frameBusyTokens`). Returns the
 * resolved frame element so `clearFrameBusy` can target the SAME node even if
 * the swap later replaces the frame's id lookup (the element identity is stable
 * across a child-only frame swap). Returns null when the frame is not in the
 * live DOM (e.g. a stale external `data-webjs-frame` that slipped the
 * resolve-time check), so nothing to mark.
 *
 * @param {string} frameId
 * @param {number} token
 * @returns {Element | null}
 */
function markFrameBusy(frameId, token) {
  if (typeof document === 'undefined') return null;
  let frame = null;
  try {
    frame = document.querySelector(`webjs-frame#${CSS.escape(frameId)}`);
  } catch { frame = document.getElementById(frameId); }
  if (!frame) return null;
  // Dispatch the `true` edge only on a real idle -> busy transition, so a nav
  // that supersedes an in-flight one (frame already busy) does not emit a
  // redundant `true`. The token always advances to the newest owner.
  const wasBusy = frameBusyTokens.has(frame);
  frameBusyTokens.set(frame, token);
  frame.setAttribute('aria-busy', 'true');
  if (!wasBusy) {
    frame.dispatchEvent(new CustomEvent('webjs:frame-busy', {
      bubbles: true,
      detail: { frameId, busy: true },
    }));
  }
  return frame;
}

/**
 * Clear the busy state set by `markFrameBusy`: set `aria-busy="false"` and
 * dispatch the matching `webjs:frame-busy` (detail `{ frameId, busy: false }`)
 * so app code sees a symmetric start/finish pair. Mirrors Turbo's
 * `frame.clearBusyState`. Operates on the element captured at start, so an
 * abort / error clears the same node the start marked. A clear whose token no
 * longer owns the frame (a newer nav re-set busy) is a stale teardown from a
 * superseded nav and is skipped, so the live nav stays busy.
 *
 * @param {Element} frame
 * @param {number} token
 */
function clearFrameBusy(frame, token) {
  if (frameBusyTokens.get(frame) !== token) return;
  frameBusyTokens.delete(frame);
  frame.setAttribute('aria-busy', 'false');
  const frameId = frame.id || null;
  frame.dispatchEvent(new CustomEvent('webjs:frame-busy', {
    bubbles: true,
    detail: { frameId, busy: false },
  }));
}

/**
 * The nav token that currently OWNS each form's submission-busy state. Same
 * role as `frameBusyTokens` for frames: under two rapid submits the router
 * aborts the first, and its `finally` would otherwise clear `aria-busy` /
 * dispatch `webjs:submit-end` for a submission the SECOND submit already
 * re-set, leaving the form falsely idle while still submitting (and an
 * unbalanced start/end event stream). A clear only fires when its token still
 * owns the form, so the superseding submit's busy state survives the aborted
 * submit's teardown.
 *
 * @type {WeakMap<Element, number>}
 */
const formBusyTokens = new WeakMap();

/**
 * Mark a submitting `<form>` busy: set the native `aria-busy="true"` (the
 * readable "is this form submitting" primitive any component can poll) and
 * dispatch a bubbling `webjs:submit-start` event (detail `{ form, url }`).
 * Stamps `token` as the form's busy owner (see `formBusyTokens`). The `true`
 * edge fires only on a real idle -> busy transition, so a submit that
 * supersedes an in-flight one (form already busy) does not emit a redundant
 * start; the token always advances to the newest owner. Returns the form so
 * `clearFormBusy` targets the same node.
 *
 * @param {HTMLFormElement} form
 * @param {number} token
 * @param {string} url   Resolved action URL the submission targets.
 * @returns {HTMLFormElement}
 */
function markFormBusy(form, token, url) {
  const wasBusy = formBusyTokens.has(form);
  formBusyTokens.set(form, token);
  form.setAttribute('aria-busy', 'true');
  if (!wasBusy) {
    form.dispatchEvent(new CustomEvent('webjs:submit-start', {
      bubbles: true,
      detail: { form, url },
    }));
  }
  return form;
}

/**
 * Clear the busy state set by `markFormBusy`: set `aria-busy="false"` and
 * dispatch the matching `webjs:submit-end` (detail `{ form, url, ok }`, `ok` =
 * the submission settled as a success / not an error outcome) so app code sees
 * a symmetric start/finish pair. Operates on the element captured at start, so
 * an abort / error clears the same node the start marked. A clear whose token
 * no longer owns the form (a newer submit re-set busy) is a stale teardown
 * from a superseded submit and is skipped, so the live submit stays busy.
 *
 * @param {HTMLFormElement} form
 * @param {number} token
 * @param {string} url
 * @param {boolean} ok
 */
function clearFormBusy(form, token, url, ok) {
  if (formBusyTokens.get(form) !== token) return;
  formBusyTokens.delete(form);
  form.setAttribute('aria-busy', 'false');
  const evt = new CustomEvent('webjs:submit-end', {
    bubbles: true,
    detail: { form, url, ok: !!ok },
  });
  // A successful submission swaps the page in place, and a full-body swap
  // (or a swap whose region contained the form) detaches the form before
  // this teardown runs. A bubbling event dispatched on a DISCONNECTED node
  // never reaches a `document`-level listener, so a synchronous swap (the
  // no-view-transition default) would silently drop `submit-end`. Dispatch
  // on `document` when the form is no longer connected so the symmetric
  // start/end pair always lands, regardless of swap timing.
  if (form.isConnected) {
    form.dispatchEvent(evt);
  } else if (typeof document !== 'undefined') {
    document.dispatchEvent(evt);
  } else {
    form.dispatchEvent(evt);
  }
}

/**
 * Apply the swap from a parsed incoming Document onto the live document.
 * Picks the most-scoped match: explicit webjs-frame > deepest shared
 * layout marker > full body swap.
 *
 * If the incoming page carries a different importmap from the current
 * page (typical after a deploy that bumped a vendor pin), partial swap
 * is unsafe: importmaps are immutable once applied, so the new page
 * would resolve modules against the stale URLs. We fall back to a full
 * page load via `location.assign(href)`. Mirrors Turbo's
 * `tracked_element_mismatch` reload, applied specifically to
 * importmaps. Called with `href = null` for revalidation flows (which
 * never trigger a hard reload).
 *
 * Detection uses the `X-Webjs-Build` response header (read by the
 * fetch path and passed in as `incomingBuild`), compared against the
 * current page's `data-webjs-build`. The header is set on EVERY SSR
 * response, including X-Webjs-Have partial responses that omit the
 * head and importmap entirely, and it carries the PUBLISHED build id,
 * which the server advertises only once the importmap is final. A hard
 * reload fires only when both ids are present and differ (a real
 * cross-deploy). An empty / absent id on either side means "version
 * unknown" (a warming runtime-first-boot server, or a response that
 * predates the header) and never triggers a reload, so the warmup
 * window cannot wipe a half-filled form.
 *
 * @param {Document} doc
 * @param {string | null} frameId
 * @param {boolean} revalidating  Restore from cache; already-matched markers may stomp inflight state, signal helps loading templates skip.
 * @param {string | null} [href]  Target URL for hard-reload fallback on importmap mismatch.
 * @param {string | null} [incomingBuild]  X-Webjs-Build header from the response, or null.
 */
/**
 * Compute the signature of all `data-webjs-track="reload"` elements
 * in the head of `root`. Returns the concatenation of each element's
 * `outerHTML`, in document order. Two documents with identical
 * tracked-element sets produce identical signatures; any change in
 * attributes, content, or set membership produces a different one.
 *
 * Mirrors hotwired/turbo's `head_snapshot.js` `trackedElementSignature`
 * (the data-turbo-track="reload" mechanism). Used by applySwap as a
 * generic opt-in next to the importmap-specific build hash.
 *
 * Returns the empty string when `root` has no head (e.g. an
 * X-Webjs-Have partial response) or when no elements opt in.
 *
 * @param {Document | undefined} root
 * @returns {string}
 */
function trackedReloadSignature(root) {
  if (!root || !root.head) return '';
  const tracked = root.head.querySelectorAll('[data-webjs-track="reload"]');
  if (!tracked.length) return '';
  // Use outerHTMLForDiff so the CSP nonce (which rotates per
  // request) is stripped before signature comparison. Without this,
  // a nonced tracked script like `<script nonce="${cspNonce()}"
  // data-webjs-track="reload" src="/build.js?v=42">` would mismatch
  // every navigation and infinite-reload. Matches Turbo's
  // head_snapshot.js elementWithoutNonce posture.
  let sig = '';
  for (const el of tracked) sig += outerHTMLForDiff(el);
  return sig;
}

/* ====================================================================
 * View Transitions (opt-in) + permanent-element persistence
 * ==================================================================== */

/**
 * Whether the current page opts into the native View Transitions API for
 * client-router swaps. OFF by default (no animation surprise, no
 * regression for browsers without the API): a transition is purely
 * opt-in via a `<meta name="view-transition" content="same-origin">` in
 * the document head, mirroring Turbo's `<meta name="view-transition">`
 * convention. The accepted opt-in value is `same-origin` (every
 * client-router swap is same-origin by construction, so it reads as "yes,
 * animate these in-app navigations"). Any other value, or the meta being
 * absent, keeps transitions off.
 *
 * Re-read per navigation rather than cached: the meta can be added or
 * removed by a swap (the head merge brings in the new page's head), so a
 * page can turn transitions on or off as the user navigates.
 *
 * @returns {boolean}
 */
function viewTransitionsEnabled() {
  if (typeof document === 'undefined') return false;
  const meta = document.querySelector('meta[name="view-transition"]');
  if (!meta) return false;
  const content = (meta.getAttribute('content') || '').trim().toLowerCase();
  return content === 'same-origin';
}

/**
 * Run a synchronous DOM-mutation thunk, wrapping it in
 * `document.startViewTransition()` when the page has opted in AND the
 * browser supports the API. Otherwise the thunk runs synchronously,
 * byte-identical to the pre-View-Transitions behaviour (no flash, no
 * regression). The thunk is the SAME swap code in both branches; the
 * transition only captures the before/after around the mutation (the
 * fetch already happened, so it is never inside the callback).
 *
 * @param {() => void} thunk  The synchronous DOM swap to perform.
 * @param {() => void} [afterFinished]  Optional post-transition work
 *   (e.g. re-upgrade custom elements) run when the transition settles; for
 *   the synchronous fallback it runs immediately after the thunk.
 */
function runWithTransition(thunk, afterFinished) {
  const start = typeof document !== 'undefined'
    ? /** @type any */ (document).startViewTransition
    : undefined;
  if (viewTransitionsEnabled() && typeof start === 'function') {
    const t = start.call(document, thunk);
    if (t && t.finished && typeof t.finished.then === 'function') {
      t.finished.then(() => { if (afterFinished) afterFinished(); }).catch(() => {});
    } else if (afterFinished) {
      afterFinished();
    }
    // Resolve when the DOM MUTATION (the thunk) has actually committed, NOT when
    // the animation finishes. Under `startViewTransition` the thunk is deferred a
    // frame, so anything that reads the swapped-in DOM (a progressively-streamed
    // Suspense resolve, #1048) must await this, or it runs against the pre-swap
    // DOM and drops. `updateCallbackDone` is that signal; fall back to a resolved
    // promise if the browser does not expose it.
    return (t && t.updateCallbackDone && typeof t.updateCallbackDone.then === 'function')
      ? t.updateCallbackDone.catch(() => {})
      : Promise.resolve();
  }
  thunk();
  if (afterFinished) afterFinished();
  return Promise.resolve();
}

/**
 * Persist `data-webjs-permanent` elements across a swap by NODE IDENTITY.
 *
 * Mirrors Turbo's permanent-element behaviour: an element the author
 * marks `data-webjs-permanent` (and which carries an `id`) survives a
 * destructive swap as the SAME live DOM node, so a playing
 * `<audio>` / `<video>`, a live widget, an open menu, or any element with
 * accumulated JS state keeps running across the navigation instead of
 * being destroyed and re-created from the incoming HTML.
 *
 * The mechanism runs BEFORE the destructive `replaceChildren` / range
 * delete: for each `[data-webjs-permanent][id]` in the CURRENT subtree, if
 * the INCOMING tree has a matching `#id`, the live current node is MOVED
 * into the incoming tree's position (replacing the incoming placeholder).
 * The subsequent swap then ADOPTS the live node (it is already part of the
 * incoming tree) rather than destroying the current one. The keyed
 * reconciler matches it by id afterwards and leaves it in place.
 *
 * Guards (correctness):
 *   - both-exist: only regraft an id present in BOTH the current and
 *     incoming subtree. An id in the current but NOT the incoming is being
 *     removed; leave it (do not force it to persist).
 *   - current-is-permanent: only move when the CURRENT node actually
 *     carries `data-webjs-permanent` (an incoming `#id` that resolves to a
 *     non-permanent current element is left untouched).
 *   - boundary-respecting: the live node is placed exactly where the
 *     incoming document puts it, so it never escapes a frame/region.
 *
 * @param {ParentNode} currentRoot   The live subtree being swapped out.
 * @param {ParentNode} incomingRoot  The incoming subtree being swapped in.
 */
function regraftPermanentElements(currentRoot, incomingRoot) {
  if (!currentRoot || !incomingRoot) return;
  if (typeof currentRoot.querySelectorAll !== 'function') return;
  const permanents = currentRoot.querySelectorAll('[data-webjs-permanent][id]');
  for (const live of permanents) {
    const id = live.id;
    if (!id) continue;
    // both-exist guard: the incoming subtree must carry a matching #id.
    let placeholder = null;
    try {
      placeholder = incomingRoot.querySelector(`#${CSS.escape(id)}`);
    } catch { placeholder = null; }
    if (!placeholder) continue;
    // current-is-permanent guard is implicit in the selector above, but
    // re-assert defensively (the live node is the one we move).
    if (!live.hasAttribute || !live.hasAttribute('data-webjs-permanent')) continue;
    const parent = placeholder.parentNode;
    if (!parent) continue;
    // Move the LIVE node into the incoming tree's position, replacing the
    // incoming placeholder. The swap then adopts the live node.
    if (placeholder === live) continue;
    parent.replaceChild(live, placeholder);
  }
}

/**
 * Permanent-element regraft for the marker-range path, where the two
 * sides are ARRAYS of sibling nodes (the live slice between markers, and
 * the imported-but-detached incoming slice) rather than single roots.
 *
 * For each `[data-webjs-permanent][id]` reachable from the LIVE slice, if
 * a matching `#id` exists anywhere in the INCOMING slice, replace the
 * incoming (freshly-imported) copy with the LIVE node so the reconciler
 * adopts the live node by identity. Searches both top-level slice members
 * and their descendants. The same both-exist + current-is-permanent
 * guards as `regraftPermanentElements` apply.
 *
 * @param {Node[]} liveSlice
 * @param {Node[]} incomingSlice
 */
function regraftPermanentInSlice(liveSlice, incomingSlice) {
  /** @type {Element[]} */
  const livePermanents = [];
  for (const n of liveSlice) {
    if (n.nodeType !== 1) continue;
    const el = /** @type {Element} */ (n);
    if (el.hasAttribute && el.hasAttribute('data-webjs-permanent') && el.id) {
      livePermanents.push(el);
    }
    if (typeof el.querySelectorAll === 'function') {
      for (const d of el.querySelectorAll('[data-webjs-permanent][id]')) livePermanents.push(d);
    }
  }
  if (!livePermanents.length) return;

  for (const live of livePermanents) {
    const id = live.id;
    if (!id) continue;
    const placeholder = findInSlice(incomingSlice, id);
    if (!placeholder) continue; // both-exist guard
    if (placeholder === live) continue;
    const parent = placeholder.parentNode;
    if (parent) {
      parent.replaceChild(live, placeholder);
    } else {
      // Placeholder is a top-level slice member with no parent (detached):
      // replace it in the incomingSlice array so the reconciler inserts the
      // live node in that position.
      const idx = incomingSlice.indexOf(placeholder);
      if (idx !== -1) incomingSlice[idx] = live;
    }
  }
}

/**
 * Find an element with `#id` within an array of (possibly detached)
 * sibling nodes, searching each member and its descendants.
 *
 * @param {Node[]} slice
 * @param {string} id
 * @returns {Element | null}
 */
function findInSlice(slice, id) {
  for (const n of slice) {
    if (n.nodeType !== 1) continue;
    const el = /** @type {Element} */ (n);
    if (el.id === id) return el;
    if (typeof el.querySelector === 'function') {
      let match = null;
      try { match = el.querySelector(`#${CSS.escape(id)}`); } catch { match = null; }
      if (match) return match;
    }
  }
  return null;
}

/**
 * Re-upgrade custom elements between a marker pair after a transitioned
 * swap settles. The View Transitions API snapshots and replaces DOM, so
 * elements can need a re-upgrade once the animation finishes.
 *
 * @param {{ start: Comment, end: Comment | null } | undefined} range
 */
function upgradeCustomElementsInRange(range) {
  if (!range || !range.start) return;
  for (let n = range.start.nextSibling; n && n !== range.end; n = n.nextSibling) {
    if (n.nodeType === 1) upgradeCustomElements(/** @type {Element} */ (n));
  }
}

/**
 * Resolves when the most recent `applySwap` DOM mutation has committed. Under an
 * async view transition the swap is deferred a frame, so the progressive
 * Suspense streamer must await this before applying resolves, or it targets the
 * pre-swap DOM (no placeholder yet) and drops the boundary (#1048). A resolved
 * promise on the synchronous (no-transition) path.
 * @type {Promise<void>}
 */
let _swapCommit = Promise.resolve();

function applySwap(doc, frameId, revalidating, href, incomingBuild, incomingSrc) {
  // SSR action seeding (#472): ingest any seed payload the incoming page
  // carries BEFORE its components are grafted into the live DOM and upgrade, so
  // a soft-navigated async component resolves from the seed instead of
  // re-fetching. Scanning `doc` (the detached parse) also strips the seed
  // carriers, so the inert payload never lands in the live document.
  try { scanSeeds(doc); } catch { /* seeding is best-effort */ }

  // Every host in this parsed doc is FRAMEWORK-SERIALIZED markup (an SSR
  // fragment or a back/forward snapshot of post-hydration HTML), never
  // author-written children. Stamp them so connectedCallback's slot chooser
  // ADOPTS instead of capture-hoovering the rendered tree, which matters for
  // a restored host whose serialized shape carries no projected slot (a
  // conditionally closed slot at snapshot time) where the structural
  // slot-marker detector has nothing to see. The chooser consumes and removes
  // the attribute on upgrade.
  // (An ELIDED display-only host never upgrades, so its stamp is retained as
  // an inert attribute; diffElementInPlace never copies it onto a live host,
  // and the upgrade path consumes it, so it cannot mis-route anything.)
  try {
    for (const el of doc.querySelectorAll('[data-wj-host]')) {
      el.setAttribute('data-wj-serialized', '');
    }
  } catch { /* stamping is best-effort */ }

  // Any clean swap (no importmap mismatch, including cache restores
  // and frame swaps where we don't even run the mismatch check) is a
  // signal that the user successfully navigated, so clear the reload
  // flag. Otherwise a sequence "reload because of mismatch → Back to
  // a cache restore → Forward to a deploy-bumped URL" would find the
  // stale flag still set and suppress the second legitimate reload.
  try {
    if (typeof sessionStorage !== 'undefined' && (!href || frameId || revalidating)) {
      sessionStorage.removeItem('webjs:importmap-reload');
    }
  } catch { /* ignore */ }

  // Importmap-mismatch guard. Only fires for foreground navs (href
  // present); revalidation passes href=null to keep cache restores
  // soft. Skipped if a <webjs-frame> escape hatch is in play (frame
  // swaps are intra-page and don't change the importmap).
  if (href && !frameId && !revalidating) {
    const currentTag = document.querySelector('script[type="importmap"]');
    const currentBuild = currentTag ? currentTag.getAttribute('data-webjs-build') : null;
    let mismatch = false;
    if (incomingBuild && currentBuild) {
      // Preferred path: compare per-response build id. Works even
      // when the response body has no importmap (partial swap).
      mismatch = incomingBuild !== currentBuild;
    }
    // An empty / absent build id on EITHER side means "version unknown":
    // the server has not published an authoritative importmap yet (the
    // warmup window, where a runtime-first-boot app resolves its vendor
    // map over the first request), or the response predates the build
    // header. In that state a hard reload is unsafe and destructive: it
    // would fire repeatedly as the warming server's id flips from empty
    // to its final value, wiping any half-filled form on the page. So we
    // never hard-reload against an unknown id and leave `mismatch` false;
    // the soft swap proceeds and the page settles once the server is
    // warm. A real cross-deploy reload still fires, because both sides
    // then carry non-empty, differing ids. (No importmap-textContent
    // fallback: the published-id contract above supersedes it, and the
    // textContent of a warming map drifts for the same reason the id does.)
    // Generic `data-webjs-track="reload"` opt-in. ANY element in the
    // head that the user marks gets included in the tracked-element
    // signature. If the signature differs between current and incoming
    // documents, hard-reload. Mirrors hotwired/turbo's
    // data-turbo-track="reload" semantics (head_snapshot.js
    // trackedElementSignature). Lets app authors tag arbitrary
    // version-sensitive elements (CSS bundle <link>, deploy meta tag)
    // for cross-deploy reload, not just the importmap.
    //
    // Importmap-specific data-webjs-build / X-Webjs-Build remain the
    // primary mechanism because they ALSO work on partial responses
    // (no head in the body). data-webjs-track is for elements that
    // can't ride the build hash.
    //
    // Skip the check when the incoming response has no head content
    // (X-Webjs-Have partial-fragment response). Without this guard
    // a partial response would always mismatch any current tracked
    // signature and falsely reload. With the guard, a partial
    // response means "trust the build hash; don't decide based on
    // missing head info." Comparing on full responses also catches
    // added/removed track markers because empty `incomingSig`
    // would correctly differ from a non-empty `currentSig`.
    if (!mismatch && doc.head && doc.head.children.length > 0) {
      const currentSig = trackedReloadSignature(document);
      const incomingSig = trackedReloadSignature(doc);
      if (currentSig !== incomingSig) mismatch = true;
    }
    if (mismatch && typeof location !== 'undefined') {
      // A detected cross-deploy mismatch means every URL-keyed snapshot and
      // speculative prefetch was captured on the OLD deploy, so it is stale
      // pre-deploy HTML (#899). Evict both caches so no stale entry is applied
      // on a later soft nav, even when the infinite-reload guard below bails to
      // a partial swap instead of a full reload (that partial swap must not then
      // pull a pre-deploy fragment out of the cache).
      snapshotCache.clear();
      prefetchCache.clear();
      // Infinite-reload guard: if the importmap appears to genuinely
      // change EVERY navigation (e.g. a developer is live-editing the
      // pin file in dev, or a misbehaving CDN returns different
      // jspm.io URLs each request), the user would experience a hard
      // reload on every click. Use a one-shot sessionStorage flag:
      // set before the first reload, cleared by the next successful
      // swap. Two reloads BACK-TO-BACK (without an intervening clean
      // nav) trip the guard.
      try {
        const flag = 'webjs:importmap-reload';
        if (sessionStorage && sessionStorage.getItem(flag)) {
          // Already reloaded once for an importmap mismatch and the
          // next nav STILL mismatches: bail to the partial swap. The
          // user is on a stale importmap but at least the page
          // renders.
          sessionStorage.removeItem(flag);
        } else {
          if (sessionStorage) sessionStorage.setItem(flag, '1');
          location.href = href;
          return;
        }
      } catch {
        // sessionStorage unavailable (private mode w/ quota etc.):
        // fall through to a single reload like before.
        location.href = href;
        return;
      }
    } else if (!mismatch) {
      // No importmap/build mismatch, so no hard reload. But the app-source
      // signal (#899) is the SECOND tier: if `data-webjs-src` differs, an
      // app-source or server-framework deploy changed the SSR output while the
      // running page's browser code is unchanged. A hard reload would be an
      // over-correction; instead EVICT the URL-keyed snapshot + prefetch caches
      // (all captured on the OLD deploy) so a later soft nav re-fetches fresh.
      // The current nav's already-fetched `doc` still applies normally. Both ids
      // must be present (an empty id is the warmup "unknown", never a signal),
      // exactly like the build guard.
      const currentSrc = currentTag ? currentTag.getAttribute('data-webjs-src') : null;
      if (incomingSrc && currentSrc && incomingSrc !== currentSrc) {
        snapshotCache.clear();
        prefetchCache.clear();
        // Advance the page's reference id. The importmap <script> is preserved
        // across soft navs (an importmap cannot be re-registered), so without
        // this the tag would keep its OLD id and EVERY later nav in the new
        // deploy would re-detect the same mismatch and evict again, defeating
        // the caches. Updating the attribute (not the importmap body) settles
        // the page onto the new deploy: evict once, then cache normally.
        if (currentTag) currentTag.setAttribute('data-webjs-src', incomingSrc);
      }
      // A clean swap (no importmap mismatch) means we're back to
      // matching client/server importmaps. Clear the reload flag so
      // a future LEGITIMATE mismatch (e.g. a later deploy) gets a
      // fresh single-shot reload instead of being suppressed by a
      // stale flag from an unrelated earlier reload.
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem('webjs:importmap-reload');
        }
      } catch { /* ignore */ }
    }
  }

  // 1. webjs-frame escape hatch.
  if (frameId) {
    const target = document.querySelector(`webjs-frame#${CSS.escape(frameId)}`);
    const source = doc.querySelector(`webjs-frame#${CSS.escape(frameId)}`);
    if (target && source) {
      // ADD-ONLY head merge: preserve runtime-generated head content
      // (Tailwind CSS injection, etc.) that the outer layout's scripts
      // already produced.
      addNewHeadElements(doc.head);
      // `diffChildren` -> `reconcileChildren` regrafts permanent elements
      // by node identity (it imports the incoming children first, then
      // swaps the live permanent node into the imported tree), so the live
      // `<audio>`/widget keeps running across the frame swap.
      // Capture the swap commit like the other swap paths so a frame nav that
      // ALSO progressively streams a Suspense boundary gates its resolves on the
      // committed frame swap, not a stale prior _swapCommit (#1048).
      _swapCommit = runWithTransition(() => {
        diffChildren(target, source);
        reactivateScripts(target);
        upgradeCustomElements(target);
        // Inside the swap so the placeholder exists before we resolve (#1048).
        forwardSuspenseResolvers(doc.body);
        blurOutgoingFocus();
      }, () => upgradeCustomElements(target));
      return;
    }
    // The response did not carry the requested frame (source null), or the
    // target frame is gone from the live DOM (target null). Falling through
    // would wholesale-replace the document, a silent full-page swap that
    // destroys the page (e.g. an auth redirect returning a login page without
    // the frame). Surface the contract violation with a cancelable event
    // instead. Default: warn and leave the frame unchanged. A listener that
    // calls preventDefault owns the outcome.
    const evt = new CustomEvent('webjs:frame-missing', {
      bubbles: true,
      cancelable: true,
      detail: { frameId, url: href || (typeof location !== 'undefined' ? location.href : null), document: doc },
    });
    (target || document).dispatchEvent(evt);
    if (!evt.defaultPrevented) {
      console.warn(`[webjs] frame "${frameId}" was not in the navigation response, leaving it unchanged. Handle "webjs:frame-missing" (preventDefault) to override.`);
    }
    return;
  }

  // 2. Two-tier keyed boundary swap (#1015). Scan both trees STRICTLY: a
  // poisoned side (malformed, truncated, or mispaired boundaries) yields null
  // and falls through to the integrity degradation below. A valid pair of
  // scans picks the swap tier by route-key comparison: a CHANGED key REPLACES
  // (remount, Next param-change parity) at the PARENT of the shallowest
  // change, else MORPH (state-preserving keyed reconcile) at the deepest
  // shared boundary.
  const here = collectBoundaries(document.body);
  const there = collectBoundaries(doc.body);
  const plan = here && there ? planBoundarySwap(here, there) : null;

  if (plan) {
    const { mode, live, incoming } = plan;
    // ADD-ONLY head merge: the outer layout stays mounted, so its head-bound
    // runtime state (Tailwind injection, etc.) must not be invalidated.
    addNewHeadElements(doc.head);
    _swapCommit = runWithTransition(() => {
      if (mode === 'replace') replaceBoundaryRange(live, incoming);
      else swapMarkerRange(live, incoming, doc);
      // No key sync is needed on the anchor's own comments: the plan's anchor
      // carries EQUAL live/incoming route-keys in every tier (a changed-key
      // REPLACE anchors at a parent already compared equal; the other tiers
      // require no change at all), and the fresh deeper keys arrive via the
      // physically replaced boundary comments inside the range.
      //
      // When the swapped range lives INSIDE a light-DOM slot (a layout whose
      // ${children} render inside a slotted shell component), the raw swap
      // just rewrote nodes the slot runtime believes it owns, so its record is
      // now stale. Resync the owning host's record from the slot's real
      // children through the one public seam, or the host's next
      // applySlotAssignments would wipe the freshly swapped content and
      // restore the stale list.
      resyncEnclosingHostSlots(live.start, incoming.start);
      // Resolve buffered Suspense boundaries INSIDE the swap so the placeholder
      // exists first. Doing this after `runWithTransition` returned raced the
      // async view-transition swap and stuck the skeleton (#1048).
      forwardSuspenseResolvers(doc.body);
      blurOutgoingFocus();
    }, () => upgradeCustomElementsInRange(live));
    return;
  }

  // 3. Integrity degradation (#1015). No trustworthy shared boundary exists:
  // one side is poisoned, or the trees share no segment (a divergent shell).
  // For a FOREGROUND nav, degrade to a FULL PAGE LOAD: bounded, correct, and
  // exactly what an MPA would do, where the deleted heuristic recovery could
  // guess wrong and corrupt silently. Dev logs the cause so a systematic
  // producer of malformed boundaries is visible immediately. A REVALIDATION
  // (the background refresh after a snapshot restore) is excluded: the user
  // is already viewing a page, so a background op must never yank them
  // through a hard load; it takes the in-place path below.
  if (href && !revalidating && typeof location !== 'undefined') {
    devWarnFallback(!here ? 'live-boundaries-malformed'
      : !there ? 'incoming-boundaries-malformed'
      : 'no-shared-boundary', href);
    location.href = href;
    return;
  }

  // A BACKGROUND revalidation (revalidating + href) with no trustworthy plan
  // DISCARDS the response outright: the user is viewing a valid restored
  // snapshot, and the response may be a reduced (chrome-less) X-Webjs-Have
  // fragment, so the full-body swap below would wipe the shell from a
  // background op. Doing nothing is the only safe degradation here.
  if (href && revalidating) {
    devWarnFallback('revalidation-discarded', href);
    return 'discard';
  }

  // 4. In-place full-body swap: the background paths only (a snapshot
  // restore or its revalidation, where a full load is not an option
  // because the user is already viewing the page). Full head merge;
  // `mergeHead` PRESERVES stylesheets and `<style>` unconditionally
  // (#936) so the swap can never leave the page unstyled.
  mergeHead(doc.head);
  // Persist permanent elements by node identity across the full-body
  // swap: move each live [data-webjs-permanent][id] node into the matching
  // position in the incoming body BEFORE replaceChildren reads it, so the
  // live node is adopted rather than destroyed.
  regraftPermanentElements(document.body, doc.body);
  const newChildren = [...doc.body.childNodes];
  const doSwap = () => {
    document.body.replaceChildren(...newChildren);
    reactivateScripts(document.body);
    upgradeCustomElements(document.body);
    blurOutgoingFocus();
  };
  _swapCommit = runWithTransition(doSwap, () => upgradeCustomElements(document.body));
}

/**
 * After a swap, blur whatever element the user activated to trigger the
 * navigation (the clicked sidenav link, the submitted form button, etc.).
 *
 * Why: browsers paint `:focus-visible` rings when the window regains
 * focus on whatever has focus at that moment. A click leaves focus on
 * the clicked element, so without this blur the user sees a stuck focus
 * ring on the sidenav link every time they switch workspaces and come
 * back: even though they navigated minutes ago.
 *
 * We do NOT programmatically move focus to the new page's h1/h2.
 * That'd just relocate the same problem (focus ring on the heading
 * after a workspace switch) and steals focus from sighted users.
 * Screen-reader users navigate by heading via their own shortcuts
 * (`h` in NVDA/JAWS), so they don't need us to do it for them.
 *
 * No-op when focus is on `<body>` (browser default after `removeChild`
 * of a focused node) or when the active element survived the swap and
 * was inside the new content (means the swap was internal to a region
 * the user was already interacting with: don't fight them).
 */
function blurOutgoingFocus() {
  const a = document.activeElement;
  if (!a || a === document.body || a === document.documentElement) return;
  if (typeof (/** @type any */ (a).blur) !== 'function') return;
  /** @type any */ (a).blur();
}

/**
 * Wholesale-REPLACE the contents of a boundary range (#1015): remove every
 * live node between `target.start` and `target.end` (exclusive) and insert a
 * fresh import of the incoming range. This is the REMOUNT tier: the boundary's
 * route-key changed (a param change, or a different page under a shared static
 * layout), so Next.js parity demands fresh component instances, not a keyed
 * reuse of old-page DOM. The only nodes that survive by identity are
 * `data-webjs-permanent` elements, regrafted into the imported slice before
 * insertion so a playing `<audio>`/widget keeps running.
 *
 * @param {{ start: Comment, end: Comment }} target  The live boundary.
 * @param {{ start: Comment, end: Comment }} source  The incoming boundary.
 */
function replaceBoundaryRange(target, source) {
  const liveParent = target.start.parentNode;
  if (!liveParent) return;
  /** @type {Node[]} */
  const liveSlice = [];
  for (let n = target.start.nextSibling; n && n !== target.end; n = n.nextSibling) {
    liveSlice.push(n);
  }
  /** @type {Node[]} */
  const incomingSlice = [];
  for (let n = source.start.nextSibling; n && n !== source.end; n = n.nextSibling) {
    incomingSlice.push(document.importNode(n, true));
  }
  regraftPermanentInSlice(liveSlice, incomingSlice);
  for (const n of liveSlice) {
    if (n.parentNode === liveParent) liveParent.removeChild(n);
  }
  for (const n of incomingSlice) {
    liveParent.insertBefore(n, target.end);
  }
  for (let n = target.start.nextSibling; n && n !== target.end; n = n.nextSibling) {
    if (n.nodeType === 1) {
      reactivateScripts(/** @type {Element} */ (n));
      upgradeCustomElements(/** @type {Element} */ (n));
    }
  }
}

/**
 * MORPH the contents of a boundary range (#1015): reconcile the nodes between
 * `target.start` and `target.end` (exclusive) in the live document against the
 * nodes between `source.start` and `source.end` in the parsed Document, using
 * a keyed reconciler that preserves DOM identity for matched elements + their
 * live attributes (scroll, value, etc.). This is the state-preserving tier for
 * a searchParams-only / refresh nav, where the route-key is unchanged and
 * hydrated component state must survive.
 *
 * Boundaries are strictly paired by the scanner (#1015), so `end` is always a
 * real close comment here (the null-orphan tolerance of the deleted #994
 * recovery is gone with it).
 *
 * @param {{ start: Comment, end: Comment } | undefined} target
 * @param {{ start: Comment, end: Comment } | undefined} source
 * @param {Document} _doc
 */
function swapMarkerRange(target, source, _doc) {
  if (!target || !source) return;

  // Build a parent-with-matching-children pair for the keyed differ.
  // The differ wants two parents: synthesize a transient parent for
  // the slice of `source` so we can diff in-place against `target.start`
  // / `target.end` siblings on the live document.
  const liveParent = target.start.parentNode;
  if (!liveParent) return;

  // Collect current children (nodes between start and end, exclusive).
  /** @type {Node[]} */
  const liveSlice = [];
  for (let n = target.start.nextSibling; n && n !== target.end; n = n.nextSibling) {
    liveSlice.push(n);
  }

  // Collect incoming children, importing into the live document.
  /** @type {Node[]} */
  const incomingSlice = [];
  for (let n = source.start.nextSibling; n && n !== source.end; n = n.nextSibling) {
    incomingSlice.push(document.importNode(n, true));
  }

  // Persist permanent elements by node identity: regraft each live
  // [data-webjs-permanent][id] node into the matching position in the
  // imported incoming slice, replacing the freshly-imported copy, so the
  // keyed reconciler adopts the live node instead of destroying it.
  regraftPermanentInSlice(liveSlice, incomingSlice);

  // Run the keyed diff.
  reconcileSiblings(liveParent, target.start, target.end, liveSlice, incomingSlice);

  // Upgrade + activate scripts in the just-swapped range.
  for (let n = target.start.nextSibling; n && n !== target.end; n = n.nextSibling) {
    if (n.nodeType === 1) {
      reactivateScripts(/** @type {Element} */ (n));
      upgradeCustomElements(/** @type {Element} */ (n));
    }
  }
}

/**
 * Coarse keyed reconciliation between liveSlice and incomingSlice,
 * positioned in liveParent between `startMarker` and `endMarker`.
 *
 * Algorithm (Remix v3 inspired, pared down):
 *   - Match elements by (tagName + key) where key = data-key || id.
 *   - For each pair: diff attributes, recurse into children.
 *   - Unmatched live elements: remove.
 *   - Unmatched incoming elements: insert in the right slot.
 *   - Live attributes (value, checked, open, scroll-position) are
 *     preserved on matched elements regardless of server HTML.
 *
 * This is intentionally simple: when no keys are present, the diff
 * matches by position only and falls back to replaceChildren-like
 * semantics for the unkeyed range. Apps that want stronger
 * preservation add `data-key` to elements they care about.
 *
 * @param {Node} parent
 * @param {Comment} startMarker
 * @param {Comment | null} endMarker  Null (recovered orphan, #994) appends at the parent end.
 * @param {Node[]} live
 * @param {Node[]} incoming
 */
function reconcileSiblings(parent, startMarker, endMarker, live, incoming) {
  // Index live elements by (tag + key) for keyed match.
  /** @type {Map<string, Element>} */
  const keyedLive = new Map();
  for (const n of live) {
    if (n.nodeType !== 1) continue;
    const k = keyOf(/** @type {Element} */ (n));
    if (k) keyedLive.set(k, /** @type {Element} */ (n));
  }

  // Walk incoming, placing nodes in order between markers.
  /** @type {Node} */
  let insertBefore = endMarker;
  // First pass: build the final ordered list of nodes (reusing matched live).
  /** @type {Node[]} */
  const finalNodes = [];
  for (const inc of incoming) {
    if (inc.nodeType === 1) {
      const k = keyOf(/** @type {Element} */ (inc));
      if (k && keyedLive.has(k)) {
        const reused = keyedLive.get(k);
        diffElementInPlace(reused, /** @type {Element} */ (inc));
        finalNodes.push(reused);
        keyedLive.delete(k);
        continue;
      }
    }
    finalNodes.push(inc);
  }

  // Remove live nodes that weren't reused.
  for (const n of live) {
    if (n.parentNode === parent) {
      if (n.nodeType === 1 && finalNodes.includes(n)) continue;
      parent.removeChild(n);
    }
  }

  // Insert final nodes in order before the end marker.
  for (const n of finalNodes) {
    parent.insertBefore(n, insertBefore);
  }
}

/**
 * Diff one matched element in place: copy attributes from `src` to `dst`,
 * preserve live attributes, recurse into children.
 *
 * @param {Element} dst  The element to update (live DOM).
 * @param {Element} src  The element to copy from (incoming HTML).
 */
function diffElementInPlace(dst, src) {
  // A regrafted `data-webjs-permanent` node is the SAME node on both
  // sides (the live node was moved into the incoming tree). Diffing it
  // against itself would recurse into its own children and re-import
  // them; instead leave it exactly as the user left it (that is the whole
  // point of permanence).
  if (dst === src) return;
  if (dst.tagName !== src.tagName) {
    dst.replaceWith(src);
    return;
  }
  // Update attributes from src; remove ones not in src.
  const srcAttrs = new Set();
  for (const attr of src.attributes) {
    srcAttrs.add(attr.name);
    if (LIVE_ATTRS.has(attr.name)) continue;
    // The serialized-restore stamp is a message to a NOT-YET-UPGRADED
    // element's connectedCallback; copying it onto a live reused host would
    // leave a consume-once marker lingering in the live DOM forever. Note
    // the REMOVAL loop below never strips an existing stamp either (the
    // stamp is in srcAttrs, added before this skip) and that retention is
    // load-bearing: a not-yet-upgraded `static lazy` host must KEEP its
    // stamp across an intervening morph so its late upgrade still adopts.
    if (attr.name === 'data-wj-serialized') continue;
    if (dst.getAttribute(attr.name) !== attr.value) {
      dst.setAttribute(attr.name, attr.value);
    }
  }
  for (const attr of [...dst.attributes]) {
    if (LIVE_ATTRS.has(attr.name)) continue;
    if (!srcAttrs.has(attr.name)) dst.removeAttribute(attr.name);
  }
  // For form-control-like elements, preserve live IDL state.
  // (`value`, `checked`, `open`, etc.: see LIVE_ATTRS below for full list.)
  // The attribute version is skipped above; we deliberately do nothing
  // here so the user's typing / checking is never blown away.

  // A hydrated component OWNS its rendered subtree. The client renderer
  // stashes the live template instance (lit-html parts holding DIRECT
  // references to the rendered nodes) on the host under
  // `Symbol.for('webjs.instance')`. Recursing into those children would
  // import/remove/reorder the very nodes the parts still point at, so the
  // component's next reactive update would write into detached nodes and
  // silently do nothing (a dead click after a soft nav, #906). Treat the
  // component as opaque: the attribute sync above already drove any reactive
  // property change through `attributeChangedCallback`, so the component
  // re-renders ITSELF; the router must not touch its internals. This mirrors
  // Turbo/morphdom, which leave custom elements alone by default.
  //
  // One carve-out (#908): a light-DOM component's projected <slot> content is
  // page-authored (moved into the slot by the slot runtime), NOT render-owned,
  // so a reused component would otherwise keep showing STALE slotted content
  // when the nav supplies different content. Re-project ONLY those slot
  // children; the render-owned nodes stay untouched, so #906 does not regress.
  if (isHydratedComponent(dst)) {
    reprojectSlottedContent(dst, src);
    return;
  }

  // Recurse into children: collect both sides, run reconcileSiblings on
  // them with synthetic boundary markers. Cheap implementation: use
  // virtual ranges instead of inserting real comment markers.
  reconcileChildren(dst, src);
}

/**
 * True when `el` carries a live client-side render instance, i.e. a webjs
 * component whose `render()` produced the current children and owns them via
 * lit-html parts. The router must not reconcile INTO such an element (#906).
 *
 * Detected via the render-client instance symbol rather than a `customElements`
 * lookup so it fires only for elements that have actually rendered client-side:
 * a not-yet-upgraded or purely display-only custom element (no client render,
 * no parts to corrupt) stays fully reconcilable.
 *
 * @param {Element} el
 * @returns {boolean}
 */
function isHydratedComponent(el) {
  // Opaque to the router when it has rendered (INSTANCE) OR merely has slot
  // state installed but has not yet run its deferred first render (SLOT_STATE):
  // in that window a same-task morph would otherwise reconcile INTO the host
  // through the slot interception.
  const a = /** @type {any} */ (el);
  return a[Symbol.for('webjs.instance')] != null || a[SLOT_STATE] != null;
}

/**
 * True when `slot` belongs directly to `host`, i.e. no OTHER custom element
 * sits between them. A slot nested inside a child custom element belongs to
 * THAT component (its own slot state owns it), so the host must not touch it.
 *
 * @param {Element} slot
 * @param {Element} host
 * @returns {boolean}
 */
function isOwnLightSlot(slot, host) {
  for (let p = slot.parentElement; p && p !== host; p = p.parentElement) {
    if (p.tagName.includes('-')) return false;
  }
  return true;
}

/**
 * Group a component's own `data-projection="actual"` light slots by name,
 * first-wins (mirroring the slot runtime + SSR first-wins rule). Slots nested
 * inside a child custom element are excluded (they belong to that child).
 *
 * @param {Element} host
 * @returns {Map<string|null, HTMLSlotElement>}
 */
function ownActualLightSlots(host) {
  /** @type {Map<string|null, HTMLSlotElement>} */
  const byName = new Map();
  const sel = `slot[${LIGHT_SLOT_ATTR}][${PROJECTION_ATTR}="${PROJECTION_ACTUAL}"]`;
  for (const slot of host.querySelectorAll(sel)) {
    const s = /** @type {HTMLSlotElement} */ (slot);
    if (!isOwnLightSlot(s, host)) continue;
    // The runtime's invariant applies here too: a slot inside AUTHORED
    // content (an author-relocated rendered chunk, a spoofed stamp) is
    // inert content, never a reprojection target; collecting it would
    // project into (or evict from) a slot the apply refuses to place.
    if (isAuthoredContentSlot(host, s)) continue;
    // Src-side (parsed doc) hosts have no record, so the authored test is
    // inert there; the SERIALIZED shape of content is structural instead: a
    // slot nested inside an ACTUAL-mode light slot of the same host is
    // content (an SSR'd forwarded slot rides inside the inner host's own
    // actual slot), never a reprojection target. A slot inside a
    // FALLBACK-mode container stays collectable: fallback content is
    // template markup, and a slot there is legitimate.
    let nestedInActual = false;
    for (let a = s.parentElement; a && a !== host; a = a.parentElement) {
      if (
        a.tagName === 'SLOT' &&
        a.hasAttribute(LIGHT_SLOT_ATTR) &&
        a.getAttribute(PROJECTION_ATTR) === PROJECTION_ACTUAL
      ) {
        nestedInActual = true;
        break;
      }
    }
    if (nestedInActual) continue;
    const name = keyOfName(s.getAttribute('name'));
    if (!byName.has(name)) byName.set(name, s);
  }
  return byName;
}



/**
 * Re-project the page-authored slotted content of a REUSED hydrated light-DOM
 * component across a soft nav (#908), without touching its render-owned
 * subtree.
 *
 * The #906 guard treats a hydrated component as opaque so the router never
 * corrupts its lit-html-owned nodes. But the projected children inside a
 * light-DOM `<slot data-webjs-light data-projection="actual">` are
 * page-authored (moved there by the slot runtime), NOT held by lit-html parts,
 * so reconciling ONLY those children is safe and cannot reintroduce #906. Both
 * the live DOM and the incoming SSR HTML carry the same slot markers
 * (render-server emits them), so slots pair up by name + document order.
 *
 * Three cases, by how a slot's projection state changes across the nav:
 *   - actual->actual (content changed): identity-preserving `reconcileChildren`
 *     on the page-authored slot children, exactly as #908 shipped.
 *   - actual->fallback (content REMOVED) and fallback->actual (content ADDED):
 *     a slot's fallback is RENDER-OWNED (the compiled fallback template held by
 *     the slot-part), so these are NOT a raw reconcile. All three cases route
 *     through `projectAuthored`, the record seam, whose apply pass restores or
 *     swaps the render-owned fallback without reconciling any lit-html part
 *     (#912). The #906 one-level-down hazard (this component's assignment
 *     reaching a nested child's same-named slot) is answered by the apply
 *     pass's own-slot filtering (`isOwnSlot` + the authored-content
 *     exclusion), not by surgical single-slot application.
 *
 * @param {Element} dst  Live hydrated component host.
 * @param {Element} src  Incoming SSR copy of the same component.
 */
/**
 * After a boundary swap, if the swapped range's parent is a light-DOM slot,
 * resync the owning host's slot record from the slot's REAL children through
 * the one public seam (`projectAuthored`). The router's raw range write is the
 * one sanctioned write into a region the slot runtime also places (a layout's
 * `${children}` rendered inside a slotted shell puts the `wj:children` markers
 * INSIDE that shell's slot), so without this sync the record goes stale and
 * the host's next apply would wipe the swapped-in page content and restore the
 * pruned old list. Walking up from the slot, the owner is the nearest
 * `SLOT_STATE` host with no other custom element in between; anything else
 * (a nested stateless component, a shadow slot) bails.
 *
 * @param {Comment} startMarker
 */
function resyncEnclosingSlotRecord(startMarker) {
  const p = startMarker.parentNode;
  if (!p || p.nodeType !== 1) return;
  const slotEl = /** @type {Element} */ (p);
  if (slotEl.tagName !== 'SLOT' || !slotEl.hasAttribute(LIGHT_SLOT_ATTR)) return;
  let host = null;
  for (let a = slotEl.parentElement; a; a = a.parentElement) {
    if (/** @type {any} */ (a)[SLOT_STATE]) { host = a; break; }
    if (a.tagName.includes('-')) return; // belongs to a stateless nested element
  }
  if (!host) return;
  projectAuthored(host, keyOfName(slotEl.getAttribute('name')), [...slotEl.childNodes]);
}

/**
 * Resync the ENCLOSING HOST's slots after a boundary swap whose markers live
 * inside a light-DOM slot (a layout whose `${children}` render inside a
 * slotted shell). The boundary swap only rewrites the DEFAULT slice (the
 * `wj:children` markers always partition to the default slot), so a page that
 * emits top-level `slot=`-attributed children left the shell's NAMED slots
 * showing the previous page's content (#1024). This resyncs the enclosing
 * (default) slot from its just-swapped LIVE children, then reprojects the
 * sibling NAMED slots from the INCOMING parsed host.
 *
 * @param {Comment} liveStart
 * @param {Comment} incStart
 */
function resyncEnclosingHostSlots(liveStart, incStart) {
  const lp = liveStart.parentNode;
  if (!lp || lp.nodeType !== 1) return;
  const liveSlot = /** @type {Element} */ (lp);
  if (liveSlot.tagName !== 'SLOT' || !liveSlot.hasAttribute(LIGHT_SLOT_ATTR)) return;
  let liveHost = null;
  for (let a = liveSlot.parentElement; a; a = a.parentElement) {
    if (/** @type {any} */ (a)[SLOT_STATE]) { liveHost = a; break; }
    if (a.tagName.includes('-')) return; // enclosing slot belongs to a stateless nested element
  }
  if (!liveHost) return;
  const enclosingName = keyOfName(liveSlot.getAttribute('name'));
  // 1. The enclosing (boundary) slot, from its own just-swapped live children.
  projectAuthored(liveHost, enclosingName, [...liveSlot.childNodes]);

  // 2. The sibling NAMED slots, from the incoming parsed host. Find the
  //    incoming host structurally (the parsed copy is not upgraded, so no
  //    SLOT_STATE): the nearest custom-element ancestor of the incoming
  //    boundary marker's enclosing slot.
  const ip = incStart.parentNode;
  if (!ip || ip.nodeType !== 1) return;
  const incSlot = /** @type {Element} */ (ip);
  if (incSlot.tagName !== 'SLOT') return;
  let incHost = null;
  for (let a = incSlot.parentElement; a; a = a.parentElement) {
    if (a.tagName.includes('-')) { incHost = a; break; }
  }
  if (!incHost || incHost.tagName !== liveHost.tagName) return;

  const liveSlots = ownActualLightSlots(liveHost);
  const incSlots = ownActualLightSlots(incHost);
  for (const name of new Set([...liveSlots.keys(), ...incSlots.keys()])) {
    if (name === enclosingName) continue; // handled in (1); never re-reconcile the swapped range
    const inc = incSlots.get(name);
    if (inc) {
      projectAuthored(
        liveHost,
        name,
        [...inc.childNodes].map((n) => document.importNode(n, true)),
      );
    } else if (liveSlots.get(name)) {
      projectAuthored(liveHost, name, null); // dropped by the incoming page: revert to fallback
    }
  }
}

function reprojectSlottedContent(dst, src) {
  // Only a light-DOM component that tracks slot assignments has placed
  // page-authored content to update. No slot state (no <slot>, or a shadow-DOM
  // component whose slotted nodes are ordinary light children) means nothing
  // to update here.
  if (!(/** @type {any} */ (dst)[SLOT_STATE])) return;

  const liveSlots = ownActualLightSlots(dst);
  const incSlots = ownActualLightSlots(src);
  if (liveSlots.size === 0 && incSlots.size === 0) return;

  // #1015: slotted children are VALUES pushed through the ONE public seam,
  // projectAuthored (no cross-module state surgery; the slot runtime owns the
  // record, fires slotchange on a genuine set change, and re-applies). The
  // union walk covers boundary transitions (a name present on only one side).
  const names = new Set([...liveSlots.keys(), ...incSlots.keys()]);
  for (const name of names) {
    const liveSlot = liveSlots.get(name);
    const incSlot = incSlots.get(name);
    if (liveSlot && incSlot) {
      // actual->actual: reconcile IN PLACE first so page-authored slotted
      // nodes keep DOM identity where they match (#908: a nested live
      // component survives; an in-place text edit reuses the same node),
      // then push the resulting set through the public API. The runtime's
      // set-equality check makes slotchange fire exactly on an
      // add/remove/replace and stay silent on a pure text edit (#912).
      reconcileChildren(liveSlot, incSlot);
      projectAuthored(dst, name, [...liveSlot.childNodes]);
    } else if (incSlot) {
      // fallback->actual: incoming ADDED content. Import and push.
      projectAuthored(dst, name, [...incSlot.childNodes].map((n) => document.importNode(n, true)));
    } else {
      // actual->fallback: incoming DROPPED the content. Reset to fallback.
      projectAuthored(dst, name, null);
    }
  }
}

/**
 * Reconcile dst's children to match src's children, in-place.
 *
 * @param {Element} dst
 * @param {Element} src
 */
function reconcileChildren(dst, src) {
  const liveChildren = [...dst.childNodes];
  const incomingChildren = [...src.childNodes].map((n) => document.importNode(n, true));

  // Persist `data-webjs-permanent` elements by node identity: regraft each
  // live permanent node into the matching position in the freshly-imported
  // incoming children (replacing the imported copy), so the keyed match
  // below adopts the LIVE node and the reconciler never recreates it. This
  // is the in-region (frame + nested) counterpart of the full-body and
  // marker-range regrafts; running it here covers permanents nested below
  // the top keyed level too.
  regraftPermanentInSlice(liveChildren, incomingChildren);

  // Build keyed map of live children for reuse.
  /** @type {Map<string, Element>} */
  const keyedLive = new Map();
  for (const n of liveChildren) {
    if (n.nodeType !== 1) continue;
    const k = keyOf(/** @type {Element} */ (n));
    if (k) keyedLive.set(k, /** @type {Element} */ (n));
  }

  /** @type {Node[]} */
  const finalNodes = [];
  for (let i = 0; i < incomingChildren.length; i++) {
    const inc = incomingChildren[i];
    if (inc.nodeType === 1) {
      const k = keyOf(/** @type {Element} */ (inc));
      if (k && keyedLive.has(k)) {
        const reused = keyedLive.get(k);
        diffElementInPlace(reused, /** @type {Element} */ (inc));
        finalNodes.push(reused);
        keyedLive.delete(k);
        continue;
      }
      // Positional match: same tag, same index, neither has a key.
      const livePeer = liveChildren[i];
      if (livePeer && livePeer.nodeType === 1 &&
          !keyOf(/** @type {Element} */ (livePeer)) &&
          /** @type {Element} */ (livePeer).tagName === /** @type {Element} */ (inc).tagName) {
        diffElementInPlace(/** @type {Element} */ (livePeer), /** @type {Element} */ (inc));
        finalNodes.push(livePeer);
        continue;
      }
    } else if (inc.nodeType === 3) {
      // Text node: positional reuse for stable identity.
      const livePeer = liveChildren[i];
      if (livePeer && livePeer.nodeType === 3) {
        if (livePeer.nodeValue !== inc.nodeValue) livePeer.nodeValue = inc.nodeValue;
        finalNodes.push(livePeer);
        continue;
      }
    } else if (inc.nodeType === 8) {
      // Comment: positional reuse.
      const livePeer = liveChildren[i];
      if (livePeer && livePeer.nodeType === 8) {
        if (livePeer.nodeValue !== inc.nodeValue) livePeer.nodeValue = inc.nodeValue;
        finalNodes.push(livePeer);
        continue;
      }
    }
    finalNodes.push(inc);
  }

  // Mutate dst to contain finalNodes in order, preserving reused references.
  // Walk forward, inserting each node before the (potentially moved) next sibling.
  const finalSet = new Set(finalNodes);
  for (const n of liveChildren) {
    if (!finalSet.has(n) && n.parentNode === dst) dst.removeChild(n);
  }
  for (let i = 0; i < finalNodes.length; i++) {
    const n = finalNodes[i];
    if (n.parentNode !== dst || dst.childNodes[i] !== n) {
      dst.insertBefore(n, dst.childNodes[i] || null);
    }
  }
}

/**
 * Get the diff key for an element: `data-key` if present, else `id`.
 * Returns null for elements with no stable key.
 *
 * @param {Element} el
 * @returns {string | null}
 */
function keyOf(el) {
  const k = el.getAttribute('data-key');
  if (k) return `${el.tagName}:k:${k}`;
  if (el.id) return `${el.tagName}:i:${el.id}`;
  return null;
}

/**
 * Attribute names whose live DOM state must NEVER be overwritten by
 * incoming server HTML during a partial swap. The server emits these
 * with their initial-render value; the user may have typed/clicked
 * between renders. Preserving them keeps focus, typing, open state,
 * and popover state intact across navigation.
 */
const LIVE_ATTRS = new Set([
  // Form controls
  'value', 'checked', 'selected', 'indeterminate', 'disabled',
  // Disclosure / popover
  'open', 'popover',
]);

/* ====================================================================
 * Optimistic loading (per-segment loading.ts templates)
 * ==================================================================== */

/**
 * Look for `<template id="wj-loading:<deepest-current-path>">` in the
 * document; if present, clone its content into the deepest current
 * children-slot. Returns state needed to restore on fetch failure.
 *
 * The returned state carries the nav-token in effect at swap time;
 * `restoreOptimistic` verifies the token still matches before reverting,
 * so a slow nav A's late failure cannot revert a faster nav B's
 * already-settled state.
 *
 * @returns {{ slot: { start: Comment, end: Comment }, oldChildren: Node[], token: number } | null}
 */
function applyOptimisticLoading() {
  const slots = collectBoundaries(document.body);
  if (!slots || slots.size === 0) return null;
  // Walk boundaries deepest-first and use the first whose segment has a
  // loading template. Loading templates are keyed by LAYOUT segment
  // (loading.ts files live next to layouts), while the deepest boundary is
  // usually the PAGE's own (#1015), which has no template: skipping over it
  // finds the innermost layout skeleton, matching the pre-#1015 behaviour.
  const bySegment = [...slots.keys()].sort((a, b) => b.length - a.length);
  let deepest = null;
  let tpl = null;
  for (const p of bySegment) {
    const t = document.getElementById(`wj-loading:${p}`);
    if (t instanceof HTMLTemplateElement) { deepest = p; tpl = t; break; }
  }
  if (deepest === null || tpl === null) return null;

  const slot = slots.get(deepest);
  /** @type {Node[]} */
  const oldChildren = [];
  for (let n = slot.start.nextSibling; n && n !== slot.end; n = n.nextSibling) {
    oldChildren.push(n);
  }
  // Replace slot contents with the loading template.
  const range = document.createRange();
  range.setStartAfter(slot.start);
  range.setEndBefore(slot.end);
  range.deleteContents();
  slot.start.parentNode.insertBefore(tpl.content.cloneNode(true), slot.end);
  return { slot, oldChildren, token: currentNavigationToken };
}

/** @param {{ slot: { start: Comment, end: Comment }, oldChildren: Node[], token: number } | null} state */
function restoreOptimistic(state) {
  if (!state) return;
  // A newer nav superseded the one that captured this state: don't
  // revert; that newer nav owns the page now.
  if (state.token !== currentNavigationToken) return;
  const { slot, oldChildren } = state;
  if (slot.start.parentNode !== slot.end.parentNode) return;
  const range = document.createRange();
  range.setStartAfter(slot.start);
  range.setEndBefore(slot.end);
  range.deleteContents();
  for (const n of oldChildren) slot.start.parentNode.insertBefore(n, slot.end);
}

/* ====================================================================
 * Diff helper for the webjs-frame escape hatch
 * ==================================================================== */

/**
 * Diff children of two elements (used by the webjs-frame swap path).
 *
 * @param {Element} dst
 * @param {Element} src
 */
function diffChildren(dst, src) {
  reconcileChildren(dst, src);
}

/* ====================================================================
 * Head merge
 * ==================================================================== */

/**
 * Add-only head merge for partial (marker + frame) swaps. Updates the
 * title and adds new elements (modulepreloads, scripts) without
 * removing existing ones: runtime-generated content like Tailwind's
 * injected CSS must survive across navigations that keep the outer
 * layout mounted.
 *
 * @param {HTMLHeadElement} newHead
 */

/**
 * Read the CSP nonce that the original page load published via
 * `<meta name="csp-nonce" content="...">`. Returns empty string when
 * no meta tag is present (apps without strict CSP).
 *
 * The meta tag is the contract: server emits it once at SSR time,
 * client reads it for every dynamically-created script. The browser
 * enforces CSP against the nonce the original page declared, NOT the
 * per-request nonce on subsequent navigations. So we always apply
 * THIS nonce, not the source-page nonce that arrived with the new
 * head fragment.
 *
 * Mirrors hotwired/turbo's `getCspNonce` in src/util.js. Not cached:
 * a single querySelector on document.head is cheap, and caching
 * would break if the user (or a test) inserted the meta tag late.
 *
 * @returns {string}
 */
function getCspNonce() {
  if (typeof document === 'undefined') return '';
  const meta = document.querySelector('meta[name="csp-nonce"]');
  // Read the `content` attribute, not the `.nonce` IDL property.
  // Turbo's getCspNonce in src/util.js falls back to `.nonce` first
  // because it can be called against script/link elements (where
  // browsers DO expose `.nonce` and additionally clear the
  // `nonce` attribute on document load). The `<meta name="csp-nonce">`
  // element WebJs targets has no `.nonce` IDL (only script + link
  // elements do per HTML spec), so the only viable source is the
  // `content` attribute.
  return meta ? meta.getAttribute('content') || '' : '';
}

/**
 * Create a `<script>` clone of `source` that's safe to insert into the
 * live document under strict CSP. Copies every attribute EXCEPT
 * nonce (the source's nonce is from the new page's per-request token,
 * which the browser's CSP cache from the original page load will
 * reject), then applies the cached nonce from the meta tag. Re-emits
 * textContent so inline scripts execute as if first-loaded.
 *
 * @param {HTMLScriptElement} source
 * @returns {HTMLScriptElement}
 */
function cloneScriptWithCorrectNonce(source) {
  const script = document.createElement('script');
  for (const attr of source.attributes) {
    if (attr.name === 'nonce') continue;
    script.setAttribute(attr.name, attr.value);
  }
  const nonce = getCspNonce();
  if (nonce) {
    // Use setAttribute so the attribute is queryable
    // (`getAttribute('nonce')`, outerHTML serialization, etc.).
    // Per CSP3 the .nonce IDL property is the authoritative source
    // for the CSP check, but real browsers reflect setAttribute into
    // .nonce automatically. Test environments (linkedom) reflect only
    // one direction, so we set the attribute.
    script.setAttribute('nonce', nonce);
  }
  script.textContent = source.textContent;
  return script;
}

/**
 * Clone any head element while substituting the page-load CSP nonce
 * for the source's per-request nonce. Used for `<link rel="modulepreload"
 * nonce="...">` and any other nonce-carrying head element: browsers
 * gate cross-origin module preload by script-src nonce too, so the
 * per-request nonce from the new page's head would be blocked by the
 * browser's CSP cache from the original page load.
 *
 * Returns a cloneNode(true) for elements without a nonce attribute,
 * so non-CSP cases stay zero-cost.
 *
 * @param {Element} source
 * @returns {Element}
 */
function cloneElementWithCorrectNonce(source) {
  if (!source.hasAttribute('nonce')) return source.cloneNode(true);
  const clone = /** @type {Element} */ (source.cloneNode(true));
  const nonce = getCspNonce();
  if (nonce) {
    clone.setAttribute('nonce', nonce);
  } else {
    clone.removeAttribute('nonce');
  }
  return clone;
}

/**
 * Return an `outerHTML` string suitable for head-diff comparison: strip
 * any nonce attribute so per-request nonces don't cause every script in
 * the head to look "changed" on every navigation. The original element
 * is left untouched (we clone first).
 *
 * Mirrors hotwired/turbo's `elementWithoutNonce` pattern in
 * src/core/drive/head_snapshot.js.
 *
 * @param {Element} el
 * @returns {string}
 */
function outerHTMLForDiff(el) {
  // Strip nonce from ANY element type. SCRIPT obviously, but also LINK
  // (modulepreload tags carry nonce per the recent CSP fix). Without
  // this, per-request nonces on link tags would cause the diff to
  // treat every preload as "changed", duplicating preloads on every
  // navigation.
  if (!el.hasAttribute('nonce')) return el.outerHTML;
  const clone = /** @type {Element} */ (el.cloneNode(true));
  clone.removeAttribute('nonce');
  return clone.outerHTML;
}

/**
 * The one framework-owned keyed meta that must NEVER be reconciled: the CSP
 * nonce. A soft-nav response carries a FRESH per-request nonce, but the browser
 * enforces CSP against the nonce the ORIGINAL page load declared (see
 * `getCspNonce`), so overwriting the live `csp-nonce` meta with the incoming
 * one would make every later nonce-stamped script/preload violate the active
 * policy. Excluded from add/update/remove so the original meta survives verbatim.
 */
const META_KEY_CSP_NONCE = 'name=csp-nonce';

/**
 * Stable identity key for a `<meta>` that represents a single logical tag, so a
 * PAGE-SCOPED meta can be reconciled across a soft-nav head merge (#1046). A
 * meta with no identifying attribute returns null and is left to the add-only
 * path (added but never removed), since its identity is ambiguous.
 *
 * @param {Element} m
 * @returns {string | null}
 */
function metaIdentity(m) {
  const name = m.getAttribute('name');
  if (name) return 'name=' + name;
  const property = m.getAttribute('property');
  if (property) return 'property=' + property;
  const httpEquiv = m.getAttribute('http-equiv');
  if (httpEquiv) return 'http-equiv=' + httpEquiv;
  if (m.hasAttribute('charset')) return 'charset';
  return null;
}

/**
 * Reconcile keyed `<meta>` tags across a soft-nav head merge (#1046). The
 * add-only merge (`addNewHeadElements`) never removes a stale head element, so a
 * PAGE-SCOPED meta the previous page added (a `view-transition` opt-in, a
 * per-page `robots` / `theme-color` / `description`, an `og:*` property) leaked
 * onto every later page. This pass gives each keyed meta the full add / update /
 * remove treatment: a meta present in the incoming head is added or synced, and
 * a live keyed meta ABSENT from the incoming head is removed.
 *
 * Safe against the `X-Webjs-Have` reduced-head optimization (#936): that
 * optimization only omits the shared app STYLESHEET (already on the client), and
 * this pass touches ONLY `<meta>` tags, never a stylesheet / link / script. The
 * incoming head always carries the target page's complete meta set (charset,
 * viewport, and the app-wide metas from the root layout appear in both heads, so
 * they are preserved), so "absent from the incoming head" means "this page does
 * not declare it", not "optimized away".
 *
 * A key may repeat (multiple `og:image`), so both sides are grouped into a LIST
 * per key and reconciled as a set: an unchanged set is left alone, else the live
 * copies are removed and the incoming set re-appended.
 *
 * @param {HTMLHeadElement} newHead
 */
function reconcileHeadMetas(newHead) {
  // A HEADLESS fragment response (a `<webjs-frame>` subtree) has no `<head>`, so
  // `parseHTML` leaves `newHead` empty. A real full head ALWAYS emits charset +
  // viewport, so "no `<meta>` at all in the incoming head" means "this is a
  // fragment, not a head to reconcile against". Skipping it here is what keeps a
  // frame swap from stripping every live page-scoped meta (viewport, og:*, ...).
  if (!newHead.querySelector('meta')) return;

  /** @param {ParentNode} root @returns {Map<string, Element[]>} */
  const group = (root) => {
    const map = new Map();
    for (const el of root.querySelectorAll('meta')) {
      const key = metaIdentity(el);
      if (!key || key === META_KEY_CSP_NONCE) continue;
      const list = map.get(key);
      if (list) list.push(el); else map.set(key, [el]);
    }
    return map;
  };
  const incoming = group(newHead);
  const live = group(document.head);

  // Add or replace each incoming key whose SET differs from the live set.
  for (const [key, incEls] of incoming) {
    const liveEls = live.get(key) || [];
    const incKey = incEls.map(outerHTMLForDiff).join('\n');
    const liveKey = liveEls.map(outerHTMLForDiff).join('\n');
    if (incKey === liveKey) continue;
    if (incEls.length === 1 && liveEls.length === 1) {
      // The common case (one description / theme-color / robots per page):
      // sync attributes IN PLACE so the live element keeps its DOM identity.
      // An app script holding a reference (a theme manager caching
      // meta[name=theme-color]) still points at the live tag after the nav,
      // and there is no remove/append churn for a content-only change.
      const cur = liveEls[0];
      for (const a of [...cur.attributes]) cur.removeAttribute(a.name);
      for (const a of incEls[0].attributes) cur.setAttribute(a.name, a.value);
      continue;
    }
    // Multi-element sets (repeated og:image): no unambiguous element-to-element
    // mapping exists, so replace the set wholesale.
    for (const el of liveEls) el.remove();
    for (const el of incEls) document.head.appendChild(cloneElementWithCorrectNonce(el));
  }
  // Remove a stale page-scoped key the incoming page does not declare at all.
  for (const [key, liveEls] of live) {
    if (!incoming.has(key)) for (const el of liveEls) el.remove();
  }
}

function addNewHeadElements(newHead) {
  const newTitle = newHead.querySelector('title');
  if (newTitle) document.title = newTitle.textContent || '';

  const currentSet = new Set();
  for (const el of document.head.children) currentSet.add(outerHTMLForDiff(el));

  for (const el of newHead.children) {
    if (el.tagName === 'SCRIPT' && el.getAttribute('type') === 'importmap') {
      // Skip: partial swaps keep the outer layout mounted, so the
      // existing importmap stays authoritative. Importmaps are
      // immutable once a script has run (modern browsers ignore
      // subsequent `<script type=importmap>`). Importmap-mismatch
      // detection lives at the applySwap entry: a mismatch there
      // triggers a full reload before we ever reach this loop.
      continue;
    }
    if (el.tagName === 'BASE') continue;
    if (el.tagName === 'TITLE') continue;
    // A keyed <meta> is add/update/remove reconciled below (#1046), so skip it
    // here to avoid appending a duplicate when its content changed.
    if (el.tagName === 'META' && metaIdentity(el)) continue;
    if (!currentSet.has(outerHTMLForDiff(el))) {
      if (el.tagName === 'SCRIPT') {
        document.head.appendChild(
          cloneScriptWithCorrectNonce(/** @type {HTMLScriptElement} */ (el)),
        );
      } else {
        document.head.appendChild(cloneElementWithCorrectNonce(el));
      }
    }
  }

  // Reconcile keyed <meta> tags so a stale page-scoped meta is removed, not
  // leaked onto every later page (#1046).
  reconcileHeadMetas(newHead);
}

/**
 * Is `el` a stylesheet the head merge must never remove: a `<style>` or a
 * `<link rel~="stylesheet">`. WebJs ALWAYS keeps these on a soft nav, with no
 * opt-out, and that is a deliberate divergence from Turbo. Turbo removes a
 * stylesheet absent from the new head when it is tagged
 * `data-turbo-track="dynamic"`, which is sound in Turbo because a Turbo visit
 * always compares a COMPLETE old head to a COMPLETE new head, so "absent" means
 * "this page removed it". WebJs's `X-Webjs-Have` optimization returns a REDUCED
 * head (the shared app stylesheet is omitted because the client already has it),
 * so "absent from the incoming head" means "optimized away", NOT "removed". A
 * dynamic-removal opt-out would therefore re-introduce #936 (it would strip a
 * still-needed sheet on any partial response), and WebJs is Tailwind-first (one
 * global sheet, no page-specific sheets to drop), so the knob would be unsafe
 * and unused. Keeping every stylesheet is correct here; a genuinely changed one
 * is dropped by the deploy-level hard reload (build-id mismatch), not a soft swap.
 *
 * @param {Element} el
 * @returns {boolean}
 */
function isPersistentHeadStyle(el) {
  if (el.tagName === 'STYLE') return true;
  return el.tagName === 'LINK' &&
    (el.getAttribute('rel') || '').toLowerCase().split(/\s+/).includes('stylesheet');
}

/** @param {HTMLHeadElement} newHead */
function mergeHead(newHead) {
  const currentHead = document.head;

  const newTitle = newHead.querySelector('title');
  if (newTitle) document.title = newTitle.textContent || '';

  const currentSet = new Set();
  for (const el of currentHead.children) {
    if (el.tagName === 'SCRIPT' && el.getAttribute('type') === 'importmap') continue;
    if (el.tagName === 'BASE') continue;
    currentSet.add(outerHTMLForDiff(el));
  }

  const newSet = new Set();
  for (const el of newHead.children) {
    if (el.tagName === 'SCRIPT' && el.getAttribute('type') === 'importmap') continue;
    if (el.tagName === 'BASE') continue;
    newSet.add(outerHTMLForDiff(el));
  }

  for (const el of [...currentHead.children]) {
    if (el.tagName === 'SCRIPT' && el.getAttribute('type') === 'importmap') continue;
    if (el.tagName === 'BASE') continue;
    if (el.tagName === 'TITLE') continue;
    // #936: NEVER remove a stylesheet or a `<style>` on a soft nav (Turbo's
    // persistent-CSS model). The incoming head of a full-body-swap fallback can
    // legitimately lack the app's `<link rel=stylesheet>` (a partial or mangled
    // response, e.g. from a mid-parse empty-`have` prefetch): removing the live
    // one there leaves the whole page unstyled until a manual refresh, the
    // headline #936 symptom. Keeping it is safe: a genuinely stale sheet is
    // dropped by the deploy-level hard reload (build-id mismatch), not here.
    if (isPersistentHeadStyle(el)) continue;
    // Never remove the CSP nonce meta: the incoming full-body response carries a
    // FRESH per-request nonce, but the browser enforces CSP against the nonce the
    // ORIGINAL page load declared (see `getCspNonce`), so the live one must stay
    // (#1050). `outerHTMLForDiff` strips the nonce ATTRIBUTE but not the `content`
    // it lives in on this meta, so without this it looks "changed" and is dropped.
    if (el.tagName === 'META' && metaIdentity(el) === META_KEY_CSP_NONCE) continue;
    if (!newSet.has(outerHTMLForDiff(el))) el.remove();
  }

  for (const el of newHead.children) {
    if (el.tagName === 'SCRIPT' && el.getAttribute('type') === 'importmap') continue;
    if (el.tagName === 'BASE') continue;
    if (el.tagName === 'TITLE') continue;
    // Do not append the incoming per-request csp-nonce meta (the live original is
    // kept above), or the head would carry two and `getCspNonce` could read the
    // wrong one (#1050).
    if (el.tagName === 'META' && metaIdentity(el) === META_KEY_CSP_NONCE) continue;
    if (!currentSet.has(outerHTMLForDiff(el))) {
      if (el.tagName === 'SCRIPT') {
        currentHead.appendChild(
          cloneScriptWithCorrectNonce(/** @type {HTMLScriptElement} */ (el)),
        );
      } else {
        currentHead.appendChild(cloneElementWithCorrectNonce(el));
      }
    }
  }
}

/* ====================================================================
 * Custom-element upgrade + script reactivation
 * ==================================================================== */

/** @param {Element} container */
function upgradeCustomElements(container) {
  if (typeof customElements === 'undefined') return;
  upgradeTree(container);
}

/** @param {Element | DocumentFragment} root */
function upgradeTree(root) {
  const els = root instanceof Element
    ? [root, ...root.querySelectorAll('*')]
    : [...root.querySelectorAll('*')];
  for (const el of els) {
    if (el.tagName && el.tagName.includes('-')) {
      customElements.upgrade(el);
      if (el.shadowRoot) upgradeTree(el.shadowRoot);
    }
  }
}

/**
 * Forward streamed Suspense resolver templates from the fetched body to
 * the live body. Needed when the new page emits a Suspense boundary that
 * resolves later.
 *
 * @param {HTMLElement} fetchedBody
 */
function forwardSuspenseResolvers(fetchedBody) {
  for (const tpl of fetchedBody.querySelectorAll('template[data-webjs-resolve]')) {
    const clone = /** @type {HTMLTemplateElement} */ (tpl.cloneNode(true));
    document.body.appendChild(clone);
    // Resolve SYNCHRONOUSLY against the just-swapped DOM instead of relying on
    // the inline MutationObserver. The observer fires on a microtask, which
    // races an async `startViewTransition` swap: with view transitions on, the
    // swap that places the `#<id>` placeholder is deferred a frame, so the
    // observer ran first, found no placeholder, and the skeleton stuck (#1048).
    // Called from INSIDE the swap thunk (below), the placeholder is already in
    // the DOM here, so this replaces it within the same commit (and inside any
    // wrapping view transition, so the transition captures the resolved
    // content, not the fallback). Falls back to the observer if the page-level
    // resolver global is somehow absent.
    const id = clone.getAttribute('data-webjs-resolve');
    const resolve = /** @type {any} */ (window).__webjsResolve;
    if (id && typeof resolve === 'function') resolve(id);
  }
}

/**
 * Read a navigation response body progressively (#473). Returns the SHELL
 * (the HTML up to the first streamed Suspense boundary template) as soon as it
 * is available, so the router can swap it in immediately and the user sees the
 * fallbacks without waiting for the slow boundary. When the body carries
 * streamed boundaries it also returns the still-open `reader` + leftover buffer
 * so the caller applies each boundary progressively AFTER the shell swap. A body
 * with no boundaries reads to completion and returns the whole thing, so a
 * non-streaming navigation is behaviourally identical to `resp.text()`.
 *
 * @param {Response} resp
 * @returns {Promise<{ shell: string, streaming: boolean, reader?: ReadableStreamDefaultReader<Uint8Array>, dec?: TextDecoder, rest?: string }>}
 */
async function readStreamedShell(resp) {
  if (!resp.body || typeof resp.body.getReader !== 'function') {
    return { shell: await resp.text(), streaming: false };
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const MARK = '<template data-webjs-resolve';
  // The SSR stream flushes the whole shell (prefix + body with fallbacks)
  // followed by a `<!--wj-stream-shell-->` sentinel in the SAME chunk, then
  // PAUSES for the slow data before streaming each boundary template and the
  // `</body></html>` closer. The sentinel is what lets the shell swap in
  // immediately instead of blocking until the slow boundary arrives. Fallbacks
  // for robustness: an already-buffered boundary marker (a fast boundary), or
  // `</html>` (a fully-buffered response that happens to carry boundaries).
  const SHELL = '<!--wj-stream-shell-->';
  const HTML_CLOSE = /<\/html\s*>/i;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    if (done) buf += dec.decode();
    const si = buf.indexOf(SHELL);
    if (si !== -1) {
      return { shell: buf.slice(0, si), streaming: true, reader: done ? null : reader, dec, rest: buf.slice(si + SHELL.length) };
    }
    const mi = buf.indexOf(MARK);
    if (mi !== -1) {
      return { shell: buf.slice(0, mi), streaming: true, reader: done ? null : reader, dec, rest: buf.slice(mi) };
    }
    if (done) {
      // Stream ended with no streaming markers: the whole body is the shell.
      return { shell: buf, streaming: false };
    }
    const hm = HTML_CLOSE.exec(buf);
    if (hm) {
      const end = hm.index + hm[0].length;
      return { shell: buf.slice(0, end), streaming: true, reader, dec, rest: buf.slice(end) };
    }
  }
}

/**
 * Extract the next complete top-level
 * `<template data-webjs-resolve="ID">...</template>` unit from `buf`,
 * depth-tracking NESTED `<template>` tags (a streamed shadow component carries a
 * `<template shadowrootmode>` inside). Returns `{ id, content, rest }` for the
 * first complete unit, or null when the closing tag has not streamed in yet.
 *
 * @param {string} buf
 * @returns {{ id: string, content: string, rest: string } | null}
 */
function takeResolveUnit(buf) {
  const m = /<template\s+data-webjs-resolve="([^"]+)"\s*>/i.exec(buf);
  if (!m) return null;
  const id = m[1];
  const contentStart = m.index + m[0].length;
  const tagRe = /<(\/?)template\b[^>]*>/gi;
  tagRe.lastIndex = contentStart;
  let depth = 1;
  let mm;
  while ((mm = tagRe.exec(buf))) {
    if (mm[1] === '/') {
      depth--;
      if (depth === 0) {
        return { id, content: buf.slice(contentStart, mm.index), rest: buf.slice(mm.index + mm[0].length) };
      }
    } else {
      depth++;
    }
  }
  return null;
}

/**
 * Apply one streamed Suspense resolution to the live DOM (#473). REPLACES the
 * boundary element (its fallback) with the resolved content and upgrades any
 * custom elements inside. This mirrors the initial-load boot resolver
 * (`b.replaceWith(template.content)`) and the prefetched-buffered path exactly,
 * so a streamed boundary settles to the SAME DOM shape (the transient
 * `<webjs-boundary>` / `<webjs-suspense>` wrapper removed) however the page was
 * reached, in JS so a soft-nav apply does not depend on the inline swap script.
 *
 * @param {string} id
 * @param {string} content
 */
function applyStreamedResolve(id, content) {
  const boundary = document.getElementById(id);
  // A missing boundary is dropped (non-destructive), exactly as before. The
  // async-view-transition race that USED to drop a still-valid boundary (#1048)
  // is handled upstream: `streamBoundariesProgressively` is gated on the swap
  // COMMIT (`_swapCommit`), so the placeholder is already live by the time any
  // resolve is applied. A retry here would run OUTSIDE the streamer's
  // `isCurrent()` nav-token fence and could splice a superseded nav's content
  // into a recycled boundary id, so it is deliberately not attempted.
  if (!boundary) {
    // Dev-only diagnostic (#1051): the drop is benign for the normal reasons (a
    // superseded / degraded / discarded nav), but a stuck skeleton that ISN'T
    // one of those is otherwise silent, which is exactly what made #1048 hard to
    // find. Surface the dropped boundary so a future regression is one glance
    // away. Never in production, never throws, once per id.
    warnDropped(id);
    return;
  }
  const tpl = document.createElement('template');
  tpl.innerHTML = content;
  const inserted = [...tpl.content.childNodes];
  boundary.replaceWith(tpl.content);
  // Upgrade any custom elements now that they are connected (belt-and-braces:
  // a connected, defined element upgrades on insertion, but a fragment that was
  // built before its module loaded would not).
  for (const n of inserted) if (n.nodeType === 1) upgradeTree(/** @type {Element} */ (n));
}

/**
 * Progressively apply streamed Suspense boundaries from an open response reader
 * to the live DOM AFTER the shell has been swapped in (#473). Runs detached
 * (fire-and-forget); each apply is guarded by `isCurrent` so a newer navigation
 * stops it (and cancels the reader). A mid-stream transport failure leaves the
 * already-applied boundaries in place and the rest showing their fallback,
 * which is non-destructive.
 *
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @param {TextDecoder} dec
 * @param {string} initialBuf
 * @param {() => boolean} isCurrent
 */
async function streamBoundariesProgressively(reader, dec, initialBuf, isCurrent) {
  let buf = initialBuf;
  const flush = () => {
    let unit;
    while ((unit = takeResolveUnit(buf))) {
      if (!isCurrent()) return false;
      applyStreamedResolve(unit.id, unit.content);
      buf = unit.rest;
    }
    return true;
  };
  // The whole response was already buffered (the stream ended before the shell
  // delimiter): just apply whatever boundaries are in hand.
  if (!reader) { flush(); return; }
  try {
    for (;;) {
      if (!flush()) { try { await reader.cancel(); } catch { /* ignore */ } return; }
      const { value, done } = await reader.read();
      if (value) buf += dec.decode(value, { stream: true });
      if (done) {
        buf += dec.decode();
        flush();
        return;
      }
    }
  } catch {
    /* transport drop mid-stream: leave applied boundaries + remaining fallbacks */
  }
}

/** @param {Element} container */
function reactivateScripts(container) {
  for (const old of container.querySelectorAll('script')) {
    old.replaceWith(cloneScriptWithCorrectNonce(/** @type {HTMLScriptElement} */ (old)));
  }
}

/* ====================================================================
 * Internal exports for unit testing
 * ==================================================================== */

export {
  addNewHeadElements as _addNewHeadElements,
  mergeHead as _mergeHead,
  reactivateScripts as _reactivateScripts,
  findAnchorInPath as _findAnchorInPath,
  activeFrameId as _activeFrameId,
  resolveTargetFrameId as _resolveTargetFrameId,
  FRAME_TOP as _FRAME_TOP,
  markFrameBusy as _markFrameBusy,
  clearFrameBusy as _clearFrameBusy,
  markFormBusy as _markFormBusy,
  clearFormBusy as _clearFormBusy,
  collectBoundaries as _collectBoundaries,
  planBoundarySwap as _planBoundarySwap,
  parseHTML as _parseHTML,
  resetParseProbe as _resetParseProbe,
  keyOf as _keyOf,
  diffElementInPlace as _diffElementInPlace,
  reconcileChildren as _reconcileChildren,
  onPopState as _onPopState,
  applySwap as _applySwap,
  buildHaveHeader as _buildHaveHeader,
  snapshotCache as _snapshotCache,
  prefetchCache as _prefetchCache,
  LIVE_ATTRS as _LIVE_ATTRS,
  blurOutgoingFocus as _blurOutgoingFocus,
  onSubmit as _onSubmit,
  getSubmitMethod as _getSubmitMethod,
  getSubmitAction as _getSubmitAction,
  buildSubmitFormData as _buildSubmitFormData,
  restoreOptimistic as _restoreOptimistic,
  eligibleAnchorHref as _eligibleAnchorHref,
  viewTransitionsEnabled as _viewTransitionsEnabled,
  runWithTransition as _runWithTransition,
  regraftPermanentElements as _regraftPermanentElements,
  regraftPermanentInSlice as _regraftPermanentInSlice,
  prefetchSuppressed as _prefetchSuppressed,
  prefetchMode as _prefetchMode,
  prefetchHasHoverPointer as _prefetchHasHoverPointer,
  prefetch as _prefetch,
  prefetchTake as _prefetchTake,
  prefetchSaysSaveData as _prefetchSaysSaveData,
  readStreamedShell as _readStreamedShell,
  takeResolveUnit as _takeResolveUnit,
  applyStreamedResolve as _applyStreamedResolve,
  streamBoundariesProgressively as _streamBoundariesProgressively,
};

/** Test-only: peek the speculative cache for a href without consuming it. */
export function _prefetchPeek(href) { return prefetchCache.get(cacheKey(href)) || null; }
/** Test-only: number of prefetch requests currently in flight. */
export function _prefetchInflightSize() { return prefetchInflight.size; }
/** Test-only: clear all prefetch state between cases. */
export function _resetPrefetch() {
  prefetchCache.clear();
  prefetchInflight.clear();
  prefetchQueue.length = 0;
  prefetchQueued.clear();
  clearPrefetchHover();
  clearPrefetchViewTimers();
}

/** Test-only: read the monotonic navigation-token counter. */
export function _navToken() { return currentNavigationToken; }
/** Test-only: bump the navigation-token counter (simulates a fresh nav). */
export function _bumpNavToken() { return ++currentNavigationToken; }
/** Test-only: read the "current page URL" tracker (used for snapshot keying). */
export function _currentPageUrl() { return currentPageUrl; }
/** Test-only: set the tracker (simulates being on a specific page). */
export function _setCurrentPageUrl(u) { currentPageUrl = u; }
/** Test-only: clear the fire-once warning guards so a case can be re-exercised. */
export function _resetWarnOnce() { warnedKeys.clear(); smoothScrollChecked = false; }

/** Test-only: the readyState-loading full-load degradation predicate (#1008). */
export function _shouldFullLoadDuringParse(isPopState, frameId) {
  return shouldFullLoadDuringParse(isPopState, frameId);
}

/**
 * Predicate used by the onClick handler to decide whether a same-origin
 * href should bypass the router. Exposed for unit testing.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export function _isNonHtmlPath(pathname) {
  return NON_HTML_EXTENSIONS.test(pathname);
}

// Auto-enable on import (standard Turbo-Drive convention) UNLESS the app opted
// out with `webjs.clientRouter: false` (#629), which the server signals by
// setting `window.__WEBJS_CLIENT_ROUTER__ = false` in an inline script emitted
// BEFORE this (deferred) bundle runs. On the server `window` is undefined, so
// the call still runs and no-ops behind its own `typeof document` guard, as
// before. Placed last so every top-level binding the router touches (notably
// the prefetch state) is initialised before enableClientRouter() runs.
if (typeof window === 'undefined' || window.__WEBJS_CLIENT_ROUTER__ !== false) {
  enableClientRouter();
}
