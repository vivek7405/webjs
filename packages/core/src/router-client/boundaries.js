/**
 * Client router: boundaries.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */
import { revalidate } from './navigator.js';

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
