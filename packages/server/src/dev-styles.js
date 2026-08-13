/**
 * Stylesheet re-request for the in-place dev refresh (#1398), the BROWSER half.
 * Kept as a standalone browser-safe module (no node imports) so the served
 * reload client inlines the EXACT source a browser test drives, with no drift,
 * the same pattern as `dev-overlay.js` (#264) and `dev-reload-worker.js` (#887).
 *
 * Why it has to exist at all. A swap never re-requests the page's stylesheets
 * on its own: `mergeHead` preserves every stylesheet unconditionally (#936),
 * `addNewHeadElements` is add-only, and the dev href carries no content hash
 * (`asset()` is prod-only), so the link node is kept by identity and the browser
 * never asks the server for it again. A full page reload used to do that
 * asking, which is how `webjs.dev.regenerate` (#967) ever ran, since it rebuilds
 * a stale build output like `public/tailwind.css` ON REQUEST. Without this, an
 * edit that adds a utility class morphs in and the class has no backing rule
 * until a manual reload. Every in-repo app is configured that way, and the plain
 * `tailwindcss --watch` shape has the same problem.
 */

/**
 * Re-request every same-origin stylesheet under `root`, cache-busted.
 *
 * The replacement is inserted BESIDE the old link, and which of the two
 * survives depends on how the request went. That asymmetry is the whole point
 * and must not be collapsed into one shared handler:
 *
 * - On `load` the OLD link is dropped, so the page is never briefly unstyled.
 * - On `error` the NEW link is dropped and the old one kept. A re-request can
 *   fail (the server is mid-restart, the file was renamed or deleted), and
 *   removing the last working sheet there would leave the page permanently
 *   unstyled, which is exactly the failure #936 and #1400 exist to prevent.
 *
 * Duplicates are collapsed to one link per IDENTITY, where the identity is
 * every attribute except the href's query. The duplicate being collapsed is the
 * one the head merge re-appends (the incoming bare-href link beside the busted
 * one), so the head would otherwise gain a link on every refresh. Keying on the
 * path alone would be wrong in the other direction: it would delete an author's
 * second, legitimately distinct link to the same file, such as a `media="print"`
 * sheet.
 *
 * @param {ParentNode} [root]  where to scan, defaulting to the whole document.
 *   Injectable so a browser test can scope itself to its own container.
 * @param {() => number} [now]  cache-buster source, injectable for tests.
 * @returns {Element[]} the replacement links, so a caller (a test) can await them.
 */
export function refreshStyles(root, now) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope) return [];
  const stamp = now || Date.now;
  /** @type {Record<string, { el: Element, url: URL }>} */
  const kept = Object.create(null);
  const links = [].slice.call(scope.querySelectorAll('link[rel~="stylesheet"][href]'));
  for (const el of links) {
    let url;
    try { url = new URL(el.getAttribute('href'), location.href); } catch (_) { continue; }
    if (url.origin !== location.origin) continue;
    const key = identityKey(el, url);
    if (kept[key]) { if (el.parentNode) el.parentNode.removeChild(el); continue; }
    kept[key] = { el, url };
  }
  const added = [];
  for (const key of Object.keys(kept)) {
    const old = kept[key].el;
    const url = kept[key].url;
    if (!old.parentNode) continue;
    url.searchParams.set('__webjs_dev', String(stamp()));
    const next = /** @type {Element} */ (old.cloneNode(false));
    next.setAttribute('href', url.pathname + url.search);
    next.addEventListener('load', function () {
      if (old.parentNode) old.parentNode.removeChild(old);
    });
    next.addEventListener('error', function () {
      // Keep the sheet that still works rather than the one that just failed.
      if (next.parentNode) next.parentNode.removeChild(next);
    });
    old.parentNode.insertBefore(next, old.nextSibling);
    added.push(next);
  }
  return added;
}

/**
 * A link's identity for de-duping: its path plus every attribute except `href`.
 * JSON-encoded over a sorted list so no separator can collide with an attribute
 * value.
 * @param {Element} el
 * @param {URL} url
 */
function identityKey(el, url) {
  const parts = [];
  const attrs = el.attributes;
  for (let a = 0; a < attrs.length; a++) {
    if (attrs[a].name === 'href') continue;
    parts.push([attrs[a].name, attrs[a].value]);
  }
  parts.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return JSON.stringify([url.pathname, parts]);
}
