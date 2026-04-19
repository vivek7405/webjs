/**
 * Lazy component loader using IntersectionObserver.
 *
 * Components with `static lazy = true` are NOT loaded eagerly via
 * `<link rel="modulepreload">`. Instead, their `<script>` import is
 * deferred and the module is only fetched when the element enters the
 * viewport (or is within a generous margin of it).
 *
 * Usage (automatic — the SSR pipeline sets this up):
 *
 *   <script type="module">
 *     import { observeLazy } from '@webjs/core/lazy-loader';
 *     observeLazy({
 *       'my-lazy-widget': '/components/my-lazy-widget.ts',
 *     });
 *   </script>
 *
 * Or manually: mark a component and the framework handles the rest.
 *
 *   class MyWidget extends WebComponent {
 *     static tag = 'my-lazy-widget';
 *     static lazy = true;
 *     // ...
 *   }
 */

/** @type {Map<string, string>} tag → module URL */
const pending = new Map();

/** @type {IntersectionObserver | null} */
let observer = null;

/** @type {Map<string, Promise<unknown>>} in-flight module loads, keyed by URL */
const inflight = new Map();

/**
 * Load a module, deduplicating concurrent requests for the same URL.
 * @param {string} url
 * @returns {Promise<unknown>}
 */
function loadModule(url) {
  let p = inflight.get(url);
  if (p) return p;
  p = import(url).finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

/**
 * Register tag → URL pairs for lazy loading. When any element matching
 * a registered tag enters the viewport, its module is fetched via
 * dynamic import(). The custom element class registers itself on load,
 * upgrading the element.
 *
 * @param {Record<string, string>} entries  { tagName: moduleUrl }
 */
export function observeLazy(entries) {
  for (const [tag, url] of Object.entries(entries)) {
    pending.set(tag.toLowerCase(), url);
  }

  if (typeof IntersectionObserver === 'undefined') {
    // No IO support — load everything immediately (SSR-only / old browser).
    for (const url of pending.values()) loadModule(url);
    pending.clear();
    return;
  }

  if (!observer) {
    observer = new IntersectionObserver(onIntersect, {
      // Load when within 200px of the viewport — gives the module time
      // to fetch before the element is fully visible.
      rootMargin: '200px',
    });
  }

  // Observe all matching elements currently in the DOM.
  scan();

  // Also watch for dynamically added elements via MutationObserver.
  if (typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver(() => scan());
    mo.observe(document.body, { childList: true, subtree: true });
  }
}

function scan() {
  if (!observer || !pending.size) return;
  for (const tag of pending.keys()) {
    for (const el of document.querySelectorAll(tag)) {
      observer.observe(el);
    }
  }
}

/** @param {IntersectionObserverEntry[]} entries */
function onIntersect(entries) {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const tag = entry.target.tagName.toLowerCase();
    const url = pending.get(tag);
    if (!url) continue;
    loadModule(url);
    pending.delete(tag);
    observer?.unobserve(entry.target);
  }
}
