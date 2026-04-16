/**
 * Turbo-Drive-style client router for webjs.
 *
 * Intercepts same-origin link clicks and form submissions, fetches the
 * target page's HTML via `fetch()`, swaps the `<body>` content + merges
 * `<head>`, and updates the URL via `history.pushState`. No white flash
 * between pages — the transition looks like an SPA while keeping the
 * full SSR model.
 *
 * To enable, import this module from a layout or boot script:
 *
 *   import 'webjs/client-router';
 *
 * Or call `enableClientRouter()` for programmatic control.
 *
 * What it does:
 *   1. Intercepts clicks on `<a>` tags (same origin, no target, no download,
 *      no modifier keys, no `data-no-router` attribute).
 *   2. `fetch()`es the target URL.
 *   3. Parses the response HTML.
 *   4. Merges `<head>` (adds new, removes stale, updates changed `<title>`).
 *   5. Replaces `<body>` innerHTML.
 *   6. Runs any new `<script>` tags (module and classic).
 *   7. Dispatches `webjs:navigate` event on `document`.
 *   8. Scrolls to top (or to `#hash` if present).
 *   9. Manages browser history via `pushState` / `popstate`.
 *
 * What it doesn't do:
 *   - Preserve component state across navigations (shadow DOM is rebuilt).
 *   - Handle file downloads, mailto:, tel:, or external links.
 *   - Intercept programmatic `location.href = ...` (those are full navigations).
 *     Use `navigate(url)` from this module instead.
 */

const PARSER = typeof DOMParser !== 'undefined' ? new DOMParser() : null;

let enabled = false;

/** Enable the client router. Idempotent. */
export function enableClientRouter() {
  if (enabled || typeof document === 'undefined') return;
  enabled = true;
  document.addEventListener('click', onClick, true);
  window.addEventListener('popstate', onPopState);
}

/** Disable the client router. */
export function disableClientRouter() {
  if (!enabled) return;
  enabled = false;
  document.removeEventListener('click', onClick, true);
  window.removeEventListener('popstate', onPopState);
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
  await performNavigation(target.href, opts?.replace ?? false);
}

// Auto-enable on import (standard Turbo-Drive convention).
enableClientRouter();

/* ====================================================================
 * Internal
 * ==================================================================== */

/** @param {MouseEvent} e */
function onClick(e) {
  if (!enabled) return;
  if (e.defaultPrevented || e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

  const anchor = findAnchor(e.target);
  if (!anchor) return;
  if (anchor.hasAttribute('download')) return;
  if (anchor.hasAttribute('data-no-router')) return;
  if (anchor.target && anchor.target !== '_self') return;

  const href = anchor.href;
  if (!href) return;

  const url = new URL(href);
  if (url.origin !== location.origin) return;
  // Skip hash-only changes on the same page.
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return;

  e.preventDefault();
  performNavigation(href, false);
}

/** @param {PopStateEvent} _e */
function onPopState(_e) {
  performNavigation(location.href, true);
}

/** @param {EventTarget | null} el */
function findAnchor(el) {
  while (el && el !== document.body) {
    // Walk through shadow DOM if needed.
    if (/** @type any */ (el).host) el = /** @type any */ (el).host;
    if (el instanceof HTMLAnchorElement) return el;
    el = /** @type any */ (el).parentElement || /** @type any */ (el).parentNode;
  }
  return null;
}

/**
 * @param {string} href
 * @param {boolean} isPopState
 */
async function performNavigation(href, isPopState) {
  const url = new URL(href);

  // Show a subtle loading indicator.
  document.documentElement.setAttribute('data-navigating', '');

  try {
    const resp = await fetch(href, {
      headers: { 'x-webjs-router': '1' },
      credentials: 'same-origin',
    });
    if (!resp.ok) {
      // Fall back to full navigation on error.
      location.href = href;
      return;
    }
    const html = await resp.text();
    if (!PARSER) {
      location.href = href;
      return;
    }
    const doc = PARSER.parseFromString(html, 'text/html');

    // Merge <head>.
    mergeHead(doc.head);

    // Swap body content intelligently: if both old and new body share the
    // same outermost custom element (the layout shell), swap only that
    // element's light-DOM children (the page content). This preserves the
    // layout chrome (header, sidebar, footer) so it doesn't flicker.
    // Falls back to full body swap if structures differ.
    swapBody(doc.body);

    // Re-run scripts (browser ignores scripts set via innerHTML).
    reactivateScripts(document.body);

    // Update URL.
    if (!isPopState) {
      history.pushState(null, '', href);
    }

    // Scroll.
    if (url.hash) {
      const target = document.getElementById(url.hash.slice(1));
      if (target) target.scrollIntoView();
      else window.scrollTo(0, 0);
    } else {
      window.scrollTo(0, 0);
    }

    // Dispatch event for app-level hooks.
    document.dispatchEvent(new CustomEvent('webjs:navigate', { detail: { url: href } }));
  } catch {
    // Network error — fall back to full navigation.
    location.href = href;
  } finally {
    document.documentElement.removeAttribute('data-navigating');
  }
}

/**
 * Swap body content, preserving shared layout elements to avoid flicker.
 *
 * Strategy: find the outermost custom element in both the current and new
 * body. If they're the same tag name (e.g. both <blog-shell> or <doc-shell>),
 * the layout is shared — swap only the light-DOM children of that element
 * (the page content projected through <slot>). The shadow root (header,
 * sidebar, footer) stays untouched.
 *
 * If the structure differs (different layout or no custom element), fall
 * back to replacing the entire body innerHTML.
 *
 * @param {HTMLElement} newBody
 */
function swapBody(newBody) {
  const currentShell = findLayoutShell(document.body);
  const newShell = findLayoutShell(newBody);

  if (
    currentShell &&
    newShell &&
    currentShell.tagName === newShell.tagName
  ) {
    // Same layout shell — swap only the light-DOM children (page content).
    // Keep the shell element itself (and its shadow root with chrome).
    //
    // Filter out <template shadowrootmode="open"> — that's the Declarative
    // Shadow DOM from SSR. On client navigation the shadow root already
    // exists; inserting the DSD template as light DOM would add a stale
    // invisible element that can confuse slot projection and cause a flash.
    const children = [...newShell.childNodes].filter(
      (n) => !(n instanceof HTMLTemplateElement && /** @type any */ (n).getAttribute('shadowrootmode'))
    );
    swapSlotContent(currentShell, children);
  } else {
    // Different structure — full swap.
    const doSwap = () => { document.body.innerHTML = newBody.innerHTML; };
    if (/** @type any */ (document).startViewTransition) {
      /** @type any */ (document).startViewTransition(doSwap);
    } else {
      doSwap();
    }
  }
}

/**
 * Swap the light-DOM children of the layout shell without ever leaving
 * the slot empty (which causes a one-frame layout collapse + header flash).
 *
 * Strategy: append new content first, THEN remove old content. The slot
 * always has at least one set of assigned nodes. Both mutations happen
 * synchronously (no await between), so the browser never paints the
 * doubled state either — JS runs to completion before the next paint.
 *
 * Uses View Transitions API when available for extra visual polish.
 *
 * @param {Element} shell
 * @param {ChildNode[]} children
 */
function swapSlotContent(shell, children) {
  const doSwap = () => {
    // Snapshot old children BEFORE appending new ones.
    const old = [...shell.childNodes];
    // Append new content into a fragment (single DOM mutation).
    const frag = document.createDocumentFragment();
    for (const c of children) frag.appendChild(c);
    shell.appendChild(frag);
    // Now remove old children. Slot transitions old→new without empty state.
    for (const n of old) n.remove();
  };

  if (/** @type any */ (document).startViewTransition) {
    /** @type any */ (document).startViewTransition(doSwap);
  } else {
    doSwap();
  }
}

/**
 * Walk body's direct children looking for the first custom element
 * (a tag with a hyphen in its name). In webjs apps this is typically
 * the layout shell: <blog-shell>, <doc-shell>, etc.
 *
 * Skips <script>, <style>, text nodes, and comments.
 *
 * @param {HTMLElement} body
 * @returns {Element | null}
 */
function findLayoutShell(body) {
  for (const child of body.children) {
    if (child.tagName.includes('-')) return child;
  }
  return null;
}

/** @param {HTMLHeadElement} newHead */
function mergeHead(newHead) {
  const currentHead = document.head;

  // Update <title>.
  const newTitle = newHead.querySelector('title');
  if (newTitle) document.title = newTitle.textContent || '';

  // Collect keyed elements (by outerHTML for stable identity).
  const currentSet = new Set();
  for (const el of currentHead.children) {
    // Keep import maps, base — don't touch them.
    if (el.tagName === 'SCRIPT' && el.getAttribute('type') === 'importmap') continue;
    if (el.tagName === 'BASE') continue;
    currentSet.add(el.outerHTML);
  }

  const newSet = new Set();
  for (const el of newHead.children) {
    if (el.tagName === 'SCRIPT' && el.getAttribute('type') === 'importmap') continue;
    if (el.tagName === 'BASE') continue;
    newSet.add(el.outerHTML);
  }

  // Remove elements no longer in the new head (except persistent ones).
  for (const el of [...currentHead.children]) {
    if (el.tagName === 'SCRIPT' && el.getAttribute('type') === 'importmap') continue;
    if (el.tagName === 'BASE') continue;
    if (el.tagName === 'TITLE') continue;
    if (!newSet.has(el.outerHTML)) el.remove();
  }

  // Add elements in the new head that aren't in current.
  for (const el of newHead.children) {
    if (el.tagName === 'SCRIPT' && el.getAttribute('type') === 'importmap') continue;
    if (el.tagName === 'BASE') continue;
    if (el.tagName === 'TITLE') continue;
    if (!currentSet.has(el.outerHTML)) {
      currentHead.appendChild(el.cloneNode(true));
    }
  }
}

/** Re-run `<script>` tags in a container (innerHTML doesn't execute them). */
function reactivateScripts(container) {
  for (const old of container.querySelectorAll('script')) {
    const script = document.createElement('script');
    for (const attr of old.attributes) {
      script.setAttribute(attr.name, attr.value);
    }
    script.textContent = old.textContent;
    old.replaceWith(script);
  }
}
