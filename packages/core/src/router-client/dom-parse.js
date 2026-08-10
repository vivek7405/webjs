/**
 * Client router: dom-parse.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */
import { collectBoundaries } from './boundaries.js';
import { applySwap } from './swap.js';

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
export function parseHTML(html) {
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
export function resetParseProbe() {
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
