/**
 * Client router: head-merge.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */
import { META_KEY_CSP_NONCE } from './constants.js';

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
export function getCspNonce() {
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
export function cloneScriptWithCorrectNonce(source) {
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
export function outerHTMLForDiff(el) {
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

export function addNewHeadElements(newHead) {
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
export function mergeHead(newHead) {
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
