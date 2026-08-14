import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { renderToString, isNotFound, isRedirect, isForbidden, isUnauthorized } from '@webjsdev/core';
import { vendorPreloadTargets } from '../importmap.js';
import {
  componentPreloads, deduplicatedPreloads, reachedVendorSpecifiers, toUrlPath,
} from './preloads.js';
import { seedingEnabled, collectSeeds, buildSeedScript, SEED_DROP_BLOCK } from '../action-seed.js';
import {
  readRevalidate,
  readHtmlCache,
  HTML_CACHE_MARKER,
} from '../html-cache.js';
import { requestedFrameId, extractFrameSubtree } from '../frame-render.js';
import { makeThenable } from '../thenable-params.js';
import { buildDocumentParts, wrapInDocument, layoutSegmentPath, pageSegmentPath, boundarySegmentPath, layoutsForBoundary, regionRouteKey, wrapWithChildrenMarker } from './document.js';
import { escapeHtml } from './escape.js';
import {
  cachedHtmlResponse, getNonce, htmlResponse, streamingHtmlResponse,
} from './responses.js';


/**
 * Downgrade a PARTIAL response so no shared cache can store it (#1140).
 *
 * A reduced `X-Webjs-Have` body is sliced by a REQUEST header, so it is valid
 * only for a client that sent it. It is marked `Vary` for that header, but
 * `Vary` is not a guarantee in practice: Cloudflare honours only
 * `Accept-Encoding` and several other shared caches are just as selective.
 * Since a reduced body otherwise INHERITS the page's `Cache-Control`, a page
 * that opted into public caching was handing CDNs a chrome-less fragment under
 * the full page's URL, to be served to whoever navigated there next. Measured
 * on webjs.dev: 71,759 bytes for the document versus 47,375 for the fragment,
 * identical `Cache-Control` on both.
 *
 * The reduced path is the ONLY caller. A `<webjs-frame>` subtree is sliced by a
 * request header too, but its response is built without page metadata, so it is
 * already `no-store` and needs no downgrade; that property is locked by a test
 * rather than by a call here. A NEW partial-response shape does not get this
 * treatment for free: call this from its response site.
 *
 * `private` fixes that at the source instead of relying on `Vary` being
 * respected: no shared cache may store it, while the browser that asked for it
 * still may. The freshness directives are preserved, so a returning client
 * keeps whatever reuse the page declared. `Vary` stays too, as belt-and-braces
 * for caches that do honour it.
 *
 * The response KEEPS its validator. `private` forbids shared storage, not
 * validation, so the funnel still attaches an ETag (see conditional-get.js,
 * which stopped excluding `private` for exactly this reason). That matters:
 * the router fetches partials with `cache: 'no-cache'` (#1131), so without a
 * validator every prefetch and soft navigation would re-download the whole
 * fragment instead of being answered 304.
 *
 * @param {Response} res
 */
export function privateFragment(res) {
  const cc = res.headers.get('cache-control') || '';
  // No header at all is not "nothing to do": a response with no Cache-Control
  // is heuristically storable by a shared cache (RFC 9111), which is precisely
  // the hazard here. Fail CLOSED.
  if (!cc) {
    res.headers.set('cache-control', 'private');
    return;
  }
  // Split on commas that are NOT inside a quoted argument: a directive may
  // carry one (`no-cache="Set-Cookie, X-Foo"`, `private="x-user"`), and a naive
  // split tears those apart.
  const directives = [];
  let buf = '';
  let inQuotes = false;
  for (const ch of cc) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === ',' && !inQuotes) { directives.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  directives.push(buf.trim());

  // `name` is everything before the first `=`, trimmed, so `s-maxage = 600`
  // and `private="x-user"` are recognised as the directives they are.
  const nameOf = (d) => d.split('=')[0].trim().toLowerCase();
  // Already unshareable: leave it exactly as the author wrote it. Only a BARE
  // `private` counts. The qualified form (`private="x-user"`) marks just the
  // NAMED header fields private per RFC 9111, leaving the response itself
  // storable by a shared cache, so it must still be downgraded.
  const isBare = (d) => !d.includes('=');
  if (directives.some((d) => nameOf(d) === 'no-store' || (nameOf(d) === 'private' && isBare(d)))) return;

  // `private` joins the drop list because a bare one is prepended below: a
  // qualified `private="x-user"` left in place would emit the directive twice,
  // and a cache that resolves a repeat by taking the last occurrence would read
  // the qualified form, which per RFC 9111 leaves the response shared-storable.
  const SHARED_ONLY = new Set(['public', 's-maxage', 'proxy-revalidate', 'private']);
  const kept = directives.filter((d) => d && !SHARED_ONLY.has(nameOf(d)));
  kept.unshift('private');
  res.headers.set('cache-control', kept.join(', '));
}

/**
 * Import a route module. In prod the URL is stable so Node's module cache
 * serves a single evaluation; in dev a cache-bust query forces a fresh
 * evaluation so source edits take effect (which also re-runs the module's
 * top-level side effects, the reason pages/layouts must keep their top level
 * side-effect-free).
 *
 * @param {string} file
 * @param {boolean} dev
 */
async function loadModule(file, dev) {
  const url = pathToFileURL(file).toString();
  const bust = dev ? `?t=${Date.now()}-${Math.random().toString(36).slice(2)}` : '';
  return import(url + bust);
}

/**
 * Nearest-wins boundary file from a chain projected outermost -> innermost
 * (the router builds these arrays via chainOf). The innermost (last) wins, the
 * same "nearest boundary" rule error.js uses. Returns null for an empty chain.
 * @param {string[] | undefined} files
 * @returns {string | null}
 */
function nearest(arr) {
  return arr && arr.length ? arr[arr.length - 1] : null;
}

/**
 * @param {import('../router.js').PageRoute} route
 * @param {Record<string,unknown>} ctx
 * @param {boolean} dev
 */
async function collectMetadata(route, ctx, dev) {
  /** @type {Record<string, any>} */
  let meta = {};
  // Carry the title template forward across layers. Once an outer layout
  // sets `title: { template, default }`, every deeper layer that supplies
  // a plain string title gets it transformed via the template: matching
  // Next.js App Router semantics.
  /** @type {string | null} */
  let titleTemplate = null;
  for (const file of route.metadataFiles) {
    try {
      const mod = await loadModule(file, dev);
      let m = null;
      if (typeof mod.generateMetadata === 'function') {
        m = await mod.generateMetadata(ctx);
      } else if (mod.metadata) {
        m = mod.metadata;
      }
      // Next.js 14+ split `viewport` out of metadata into its own export
      // (with `themeColor`, `colorScheme`). We support both: the new
      // `export const viewport = {…}` shape merges into metadata.viewport
      // as a string at emit time, and existing `metadata.viewport` keeps
      // working. Likewise for `themeColor` and `colorScheme`.
      let vp = null;
      if (typeof mod.generateViewport === 'function') {
        vp = await mod.generateViewport(ctx);
      } else if (mod.viewport) {
        vp = mod.viewport;
      }
      if (vp && typeof vp === 'object') {
        m = { ...(m || {}), _viewport: { ...(m && m._viewport), ...vp } };
        // Allow `themeColor` / `colorScheme` to live on the viewport export.
        if (typeof vp.themeColor === 'string' && !(m && m.themeColor)) {
          m.themeColor = vp.themeColor;
        }
        if (typeof vp.colorScheme === 'string') m.colorScheme = vp.colorScheme;
      }
      if (!m || typeof m !== 'object') continue;
      // Pre-resolve the title for this layer using the inherited template.
      const resolved = { ...m };
      if (m.title !== undefined) {
        const t = m.title;
        if (typeof t === 'string') {
          resolved.title = titleTemplate ? titleTemplate.replace('%s', t) : t;
        } else if (t && typeof t === 'object') {
          // { template, default, absolute }: `absolute` overrides everything;
          // `template` is captured for deeper layers; `default` is the value
          // used when no deeper layer supplies a plain title string.
          if (typeof t.template === 'string') titleTemplate = t.template;
          if (typeof t.absolute === 'string') {
            resolved.title = t.absolute;
            // `absolute` does NOT clear the template: Next.js propagates
            // it for deeper segments below, but the *current* segment is
            // rendered absolute.
          } else if (typeof t.default === 'string') {
            resolved.title = t.default;
          } else {
            delete resolved.title;
          }
        }
      }
      meta = { ...meta, ...resolved };
    } catch {
      // ignore: metadata collection never fails the request
    }
  }
  return meta;
}

/**
 * Like layoutSegmentPath but for `loading.{js,ts}` files. Strips the
 * `loading.ext` filename from the URL path under app/.
 *
 * @param {string} loadingFile
 * @returns {string}
 */
function loadingSegmentPath(loadingFile) {
  const p = loadingFile
    .replace(/^.*\/app\//, '')
    .replace(/\/?loading\.[jt]sx?$/, '');
  return p === '' ? '/' : '/' + p;
}

/**
 * Render each `loading.{js,ts}` in the route's chain into a hidden
 * `<template id="wj-loading:<segment-path>">`. The client router clones
 * the deepest matching template into the swap slot on nav-start, giving
 * users an instant per-segment skeleton instead of stale content.
 *
 * Each loading file's segment path is the URL prefix it serves: same
 * derivation as layoutSegmentPath but stripping `loading.ext` instead.
 *
 * Errors loading a single file are swallowed so a broken loading.ts in
 * one segment doesn't break the whole response.
 *
 * @param {{ loadings?: string[] }} route
 * @param {Record<string,unknown>} ctx
 * @param {boolean} dev
 * @returns {Promise<string>}
 */
async function loadingTemplates(route, ctx, dev) {
  if (!route.loadings || route.loadings.length === 0) return '';
  /** @type {string[]} */
  const parts = [];
  for (const file of route.loadings) {
    try {
      const mod = await loadModule(file, dev);
      if (!mod.default) continue;
      const tree = await mod.default(ctx);
      const html = await renderToString(tree, { ssr: true, dev });
      const segmentPath = loadingSegmentPath(file);
      parts.push(`<template id="wj-loading:${segmentPath}">${html}</template>`);
    } catch { /* skip broken loading file */ }
  }
  return parts.join('');
}

/**
 * Wrap a tree in a layout chain, emitting the KEYED boundary comment pair
 * (#1015) around each layout's `${children}`.
 *
 * This is the ONE emitter: the happy path and every boundary render call it, so
 * the segment ids and route-keys they produce cannot drift apart (#1298). Drift
 * there is the worst available outcome, because the client router's scan then
 * finds a mismatched pair and hard-loads anyway, which looks fixed in a diff.
 *
 * `have` is the X-Webjs-Have short-circuit. It is null on every boundary path,
 * so a boundary response is structurally incapable of being reduced.
 *
 * @param {unknown} tree  The inner tree (the page, or a boundary in its place).
 * @param {string[]} layouts  Layout files, outermost first.
 * @param {Record<string, unknown>} ctx
 * @param {boolean} dev
 * @param {Record<string, string>} params  Resolved route params for the keys.
 * @param {Map<string, string> | null} have
 * @returns {Promise<{ tree: unknown, reduced: boolean }>}
 */
async function wrapLayoutChain(tree, layouts, ctx, dev, params, have) {
  for (let i = layouts.length - 1; i >= 0; i--) {
    const segmentPath = layoutSegmentPath(layouts[i]);
    // Short-circuit ONLY when the client's copy of this layout was rendered
    // for the SAME route-key: a param change at a dynamic layout must
    // re-render the layout's own markup (#1015).
    if (have && have.get(segmentPath) === regionRouteKey(segmentPath, params)) {
      // REDUCED response (#1009): the outer layouts were skipped, so these
      // bytes are only valid for a client that already HAS them. The caller
      // marks the response `private` so no shared cache can store it, and
      // additionally `Vary: X-Webjs-Have` for caches that honour it. The
      // `private` is the guarantee, not the Vary: Cloudflare and others honour
      // only `Accept-Encoding` (#1140).
      return { tree: wrapWithChildrenMarker(tree, segmentPath, params), reduced: true };
    }
    const mod = await loadModule(layouts[i], dev);
    if (!mod.default) continue;
    tree = await mod.default({
      ...ctx,
      children: wrapWithChildrenMarker(tree, segmentPath, params),
    });
  }
  return { tree, reduced: false };
}

/**
 * Render a boundary tree in the PAGE's position, wrapped in the layouts that
 * wrap that boundary, so the response carries the same keyed boundary comments
 * a successful render of this URL would and the client router can soft-swap it
 * (#1298). Before this, a boundary went straight to `wrapInDocument` with no
 * layouts, so it carried no markers at all, the router's scan found no shared
 * boundary, and every navigation into a failing page was a full document load.
 *
 * Buffered on purpose: no `suspenseCtx`, so a `<webjs-suspense>` inside a
 * wrapped layout emits its fallback and never resolves (render-server/stream.js).
 * That is the trade for a boundary response whose status and headers are final
 * before the first byte, which matters more on a 500 than streaming does.
 *
 * A throw from a wrapped layout propagates to the CALLER. That is what makes a
 * throwing layout fall through to the next boundary OUT instead of looping:
 * each step outward wraps a strictly smaller set, so the walk converges.
 *
 * @param {unknown} tree  The boundary module's rendered tree.
 * @param {{ file: string, layouts: string[] }} route
 * @param {string} boundaryFile
 * @param {Record<string, unknown>} ctx
 * @param {boolean} dev
 * @returns {Promise<string>}
 */
async function renderBoundaryInChain(tree, route, boundaryFile, ctx, dev) {
  const params = { ...(/** @type {Record<string,string>} */ (ctx.params) || {}) };
  const wrapLayouts = layoutsForBoundary(route.layouts, boundarySegmentPath(boundaryFile));
  // The boundary occupies the PAGE's region, so it gets the page's own keyed
  // pair, EXCEPT when the page's segment is also a LAYOUT's segment. Then the
  // id is that layout's and emitting it here would be a lie in one of two ways.
  //
  // If that layout is the innermost wrapped one, its children slot already
  // delimits this exact range and two boundaries under one id break keyed
  // pairing: the happy path skips for the same reason.
  //
  // If that layout was EXCLUDED (the boundary sits above it, so it never
  // rendered), the id is worse than redundant. The response would advertise a
  // region under the excluded layout's id with none of its markup inside, the
  // client would then send that id in `X-Webjs-Have`, and the next navigation
  // into that layout's subtree would short-circuit on it and return a fragment
  // that assumes chrome the page never had. The user lands on the next page
  // with that layout missing entirely.
  //
  // So the SET of emitted ids is a subset of the happy path's, never a
  // different set: an id only ever appears here if a layout at that segment
  // rendered, or no layout owns that segment at all.
  const pageSeg = pageSegmentPath(route.file);
  const layoutSegs = new Set((route.layouts || []).map(layoutSegmentPath));
  if (!layoutSegs.has(pageSeg)) tree = wrapWithChildrenMarker(tree, pageSeg, params);
  // MARK a layout-phase failure. The caller has to tell "a wrapped layout
  // threw" apart from "the boundary's own tree is broken", and it cannot infer
  // it by re-rendering: when BOTH are broken the standalone attempt throws too,
  // and an inference would report the layout error under the boundary's label
  // and lose the tree's entirely. The phase is known exactly here, so it is
  // recorded rather than guessed.
  let chain;
  try {
    chain = await wrapLayoutChain(tree, wrapLayouts, ctx, dev, params, null);
  } catch (e) {
    throw markLayoutPhase(e);
  }
  return renderToString(chain.tree, { ssr: true, dev });
}

async function renderChain(route, ctx, dev, suspenseCtx, have, pageModule) {
  // Reuse a caller-supplied page module when present. The only producer is the
  // HTML-cache path above, which loads the module to read `export const
  // revalidate` and threads it back so this does not load it a second time.
  // (The removed page `action` export used to be a second producer: it ran in
  // the page module, so the 422 re-render could share that evaluation. A form
  // action lives in a `.server.*` module instead, so the re-render loads the
  // page module itself, exactly as a plain render does.)
  const page = pageModule || await loadModule(route.file, dev);
  if (!page.default) throw new Error(`Page ${route.file} must have a default export`);
  let tree = await page.default(ctx);

  // If the route has a loading.ts file, wrap the page in a Suspense boundary
  // with the loading content as the fallback. This mirrors NextJs's automatic
  // Suspense wrapping when loading.tsx is present.
  if (route.loadings && route.loadings.length > 0) {
    // Use the innermost (closest) loading file
    const loadingFile = route.loadings[route.loadings.length - 1];
    try {
      const loadingMod = await loadModule(loadingFile, dev);
      if (loadingMod.default) {
        const { Suspense } = await import('@webjsdev/core');
        const fallback = await loadingMod.default(ctx);
        tree = Suspense({ fallback, children: Promise.resolve(tree) });
      }
    } catch { /* loading file failed: skip, render page directly */ }
  }

  // Resolved route params drive every boundary's route-key. ctx.params is
  // thenable (#848) but its `then` is non-enumerable, so a spread yields the
  // plain param map the route-key derivation expects.
  const params = { ...(/** @type {Record<string,string>} */ (ctx.params) || {}) };

  // Page-level boundary (#1015). The page gets its own keyed boundary pair
  // whose route-key is its full resolved path, so a dynamic-param change
  // (`/blog/a` -> `/blog/b`) REPLACES (remounts) the page on the client (Next
  // parity) while a shared parent layout (a shorter segment whose key did not
  // change) is preserved. Skipped when the page's segment equals the innermost
  // layout's: the layout's children-slot boundary already delimits that exact
  // range, and two boundaries with one segment id would break keyed pairing.
  const pageSeg = pageSegmentPath(route.file);
  const innermostLayoutSeg = route.layouts && route.layouts.length
    ? layoutSegmentPath(route.layouts[route.layouts.length - 1])
    : null;
  if (pageSeg !== innermostLayoutSeg) {
    tree = wrapWithChildrenMarker(tree, pageSeg, params);
  }

  // Wrap each layout's `${children}` interpolation in the KEYED boundary
  // comment pair (open `<!--wj:children:<segment>:<route-key>-->`, close
  // `<!--/wj:children:<segment>-->`, #1015). The client router scans both the
  // live and incoming DOM for these boundaries (strict id-matched pairing, no
  // LIFO guessing) and applies the two-tier swap: a changed route-key
  // REPLACES at the PARENT of the shallowest change, else the deepest shared
  // boundary MORPHS. Outer
  // layout DOM (and the scroll position of anything inside it: sidenavs,
  // fixed headers, inner scroll containers) is preserved. Auto-derived from
  // folder structure: no opt-in required from layout authors.
  // X-Webjs-Have optimization: iterate from innermost → outermost and
  // SHORT-CIRCUIT at the first layout whose segment path the client
  // already has rendered. Wrap the accumulated inner tree in that
  // layout's boundary pair (so the client can identify the splice
  // target) and return: outer layouts are not rendered at all,
  // saving CPU and wire bytes.
  // The loop itself lives in wrapLayoutChain, shared with the boundary render
  // path (#1298) so both emit identical segment ids and route-keys.
  const chain = await wrapLayoutChain(tree, route.layouts, ctx, dev, params, have);
  const body = await renderToString(chain.tree, { ssr: true, suspenseCtx });
  return { html: body + (await loadingTemplates(route, ctx, dev)), reduced: chain.reduced };
}

/**
 * Marker for a throw that came from the LAYOUT-wrapping phase of a boundary
 * render, as opposed to the boundary's own tree (#1298). Non-enumerable, so it
 * never shows up in a serialized error, and best-effort: a frozen or primitive
 * throw simply goes unmarked and is treated as a tree failure, which reports it
 * once under the boundary label rather than dropping it.
 */
const LAYOUT_PHASE = Symbol('webjs.boundaryLayoutPhase');

/** @param {unknown} err @returns {unknown} */
function markLayoutPhase(err) {
  if (err && typeof err === 'object') {
    try { Object.defineProperty(err, LAYOUT_PHASE, { value: true, enumerable: false }); } catch { /* frozen */ }
  }
  return err;
}

/** @param {unknown} err @returns {boolean} */
function isLayoutPhase(err) {
  return !!(err && typeof err === 'object' && /** @type {any} */ (err)[LAYOUT_PHASE]);
}

/**
 * Render a thrown value as text for a DEV error page, safely.
 *
 * `String(err)` is not total: `String(Object.create(null))` throws on both
 * runtimes, and a getter on a subclass can throw too. Every caller here is
 * already inside a catch whose job is to keep the response alive, so an
 * uncaught throw while FORMATTING the failure escapes the handler and takes
 * the error page down with it, turning a handled 500 into an unhandled one.
 *
 * @param {unknown} err
 * @returns {string}
 */
function safeErrorText(err) {
  try {
    if (err instanceof Error) return String(err.stack || err.message);
    return String(err);
  } catch {
    return '[unprintable value]';
  }
}

/**
 * A per-request dedup key for a secondary boundary failure: the STAGE it came
 * from plus the error's name, message and construction site. Identity cannot
 * be used, because a layout that
 * constructs its error yields a fresh object each time it is re-run, and the
 * whole point is to collapse exactly those repeats while letting a genuinely
 * different failure through.
 *
 * The CONSTRUCTION SITE (the first stack frame), not the whole stack. The
 * frames below it record how the throw was reached, and the same layout
 * re-rendered around a different boundary is reached differently every time,
 * so a full-stack key would never collapse the repeats it exists for.
 *
 * That leaves the construction site shared by two genuinely different
 * failures that go through one helper, which is why the caller's STAGE is part
 * of the key rather than the error alone: the boundary walk and the
 * `global-error` attempt are different stages, so a shared helper failing in
 * both is reported twice, while one layout failing repeatedly INSIDE the walk
 * is reported once. The stage is what distinguishes them; the stack cannot.
 *
 * Returns null when no safe key can be derived, which means DO NOT DEDUPE.
 * Failing open is the only acceptable direction here: a duplicate report is
 * noise, a dropped one is a crash nobody hears about. That covers a non-Error
 * throw (two unrelated plain objects would otherwise share `[object Object]`)
 * and anything whose property access or stringification throws, which is a
 * real shape: `String(Object.create(null))` throws, and this runs INSIDE the
 * catch that is supposed to keep the response alive, so a throw here would
 * escape `ssrPage` and take the 500 page with it.
 *
 * @param {unknown} err
 * @param {string} stage  Which attempt produced this throw. Part of the key.
 * @returns {string | null}
 */
function boundaryErrorKey(err, stage) {
  if (!(err instanceof Error)) return null;
  try {
    const site = String(err.stack || '').split('\n')[1] || '';
    return `${stage}\u0000${String(err.name)}:${String(err.message)}:${site.trim()}`;
  } catch {
    return null;
  }
}

/** Stage labels, which are part of the dedup key (see boundaryErrorKey). */
const STAGE_WALK = 'an error boundary or its layout threw while handling a render error';
const STAGE_GLOBAL_ERROR = 'global-error threw while handling a render error';
const STAGE_BOUNDARY = 'a boundary module threw or failed to load';

/**
 * Report a throw from a layout wrapped around a boundary page (#1298) to the
 * same sinks a page-render error reaches, then let the caller degrade to the
 * standalone render. Best-effort on both sinks: a throwing sink must never
 * affect the response.
 *
 * A CONTROL-FLOW sentinel is not an error and is never reported. This is the
 * same classification the page path makes before it calls `onError` (a
 * `redirect()` / `notFound()` / `forbidden()` / `unauthorized()` is a routing
 * decision, not a crash), and it matters more here: reporting one would fire
 * the app's APM sink and paint a false dev error overlay OVER the 403 the user
 * is looking at.
 *
 * The sentinel is not HONOURED either, and that is deliberate. The status is
 * already decided by the time a boundary renders, and the boundary page IS the
 * answer to this request; letting a layout redirect out of it would replace a
 * 403 the app asked for with a bounce the app did not, on a path where the
 * redirect target could itself be forbidden. So the render degrades to the
 * standalone boundary body, exactly as it does for a real layout crash, and
 * the status the boundary carries is preserved.
 *
 * Deduplicated per request by CAUSE, via the caller's `seen` set. The 500 path
 * tries each boundary in the chain, and a throwing layout that is an ancestor
 * of several of them fails EVERY attempt: `layoutsForBoundary` selects by
 * segment ancestry rather than by boundary depth, so two boundaries at
 * different segments can resolve to the same layout set. Without dedup a root
 * layout that throws is reported once per boundary in the chain.
 *
 * The key is the error's name, message and throw site rather than its identity,
 * because a layout that constructs its error (`throw new Error(...)`) yields a
 * fresh object per attempt. Deduplicating on "any secondary failure already
 * reported" instead would be wrong in the other direction: an inner boundary
 * throwing a TypeError would silence a LATER, unrelated root-layout crash, and
 * would make the `global-error` report below unreachable on every route whose
 * chain contains a real `error.{js,ts}`, since reaching that block at all means
 * an earlier attempt already threw. Distinct causes are each reported once.
 *
 * `overlay` says whether this failure may claim the DEV OVERLAY. The overlay
 * holds one retained frame per URL and the dev handler's slot is last-write
 * wins, so a secondary failure pushed after the original page error would
 * replace the root cause with a symptom, and the replacement would survive a
 * reconnect. So the 500 path passes false (the page error already claimed the
 * slot and is what the developer needs to see), while the 403 / 401 / 404
 * paths pass true, since nothing else claimed it there: their trigger is a
 * control-flow sentinel, which is never reported.
 *
 * @param {unknown} err
 * @param {{ onError?: (e: unknown) => void, onDevError?: (e: unknown) => void }} opts
 * @param {{ what?: string, seen?: Set<string>, overlay?: boolean }} [cfg]
 */
function reportBoundaryLayoutError(err, opts, cfg = {}) {
  if (isRedirect(err) || isNotFound(err) || isForbidden(err) || isUnauthorized(err)) return;
  if (cfg.seen) {
    const key = boundaryErrorKey(err, cfg.what || '');
    // A null key means no safe key could be derived, so report rather than
    // risk dropping. See boundaryErrorKey.
    if (key !== null) {
      if (cfg.seen.has(key)) return;
      cfg.seen.add(key);
    }
  }
  const what = cfg.what || 'a layout threw while wrapping a boundary page';
  if (typeof opts.onError === 'function') {
    try { opts.onError(err); } catch { /* a throwing sink must not affect the response */ }
  }
  if (cfg.overlay !== false && typeof opts.onDevError === 'function') {
    try { opts.onDevError(err); } catch { /* a throwing sink must not affect the response */ }
  }
  console.error(`[webjs] ${what}:`, err);
}

/**
 * The boot module set for a boundary response: what actually RENDERED, the
 * boundary module plus the layouts wrapping it (#1298).
 *
 * Applies the SAME inert / import-only substitution as the happy-path boot
 * (#963), so a boundary never ships a route module the normal render drops.
 * Pre-substitution, an import-only layout with a bare `.server.*` import
 * (legal, it never loads client-side) would load here whole and crash the
 * boundary page's boot on the throw-at-load stub, killing the sibling
 * component registrations in the same module script.
 *
 * The substitution applies to the boundary file harmlessly: only page and
 * layout files are fed to the elision analysis, so a boundary is never inert
 * and never import-only, gets no verdict, and is pushed as-is. Every boundary
 * kind is a `browserEntryFiles` entry (browser-entries.js), so each of these
 * URLs is servable through the auth gate.
 *
 * @param {string} boundaryFile
 * @param {string[]} wrapLayouts
 * @param {{ appDir: string, inertRouteModules?: Set<string>,
 *   importOnlyRouteModules?: Map<string, string[]>,
 *   instrumentationClient?: string }} opts
 * @returns {string[]}
 */
function boundaryModuleUrls(boundaryFile, wrapLayouts, opts) {
  /** @type {string[]} */
  const urls = [];
  const seen = new Set();
  const push = (abs) => {
    const u = toUrlPath(abs, opts.appDir);
    if (!seen.has(u)) { seen.add(u); urls.push(u); }
  };
  for (const f of [boundaryFile, ...wrapLayouts]) {
    if (opts.inertRouteModules && opts.inertRouteModules.has(f)) continue;
    const emit = opts.importOnlyRouteModules && opts.importOnlyRouteModules.get(f);
    if (emit) emit.forEach(push);
    else push(f);
  }
  // instrumentation-client.{js,ts} (#848) rides the SAME first-import contract
  // it has on the happy path: it runs before app modules so the app's client
  // error reporting is installed before anything can throw. A boundary page is
  // where that matters most, so it must not be the one place it is missing.
  // The set is never empty by the time we get here (the boundary file is
  // always pushed above, since only pages and layouts are fed to the elision
  // analysis, so a boundary is never inert and never import-only), which is
  // why this needs no non-empty guard.
  if (opts.instrumentationClient) {
    const u = toUrlPath(opts.instrumentationClient, opts.appDir);
    const i = urls.indexOf(u);
    if (i !== -1) urls.splice(i, 1);
    urls.unshift(u);
  }
  return urls;
}

/**
 * The ctx a boundary module and its wrapped layouts receive (#1298). Same shape
 * as the page render's, so a layout cannot tell a boundary render from a normal
 * one. Boundary modules used to be called with an empty object, which left a
 * wrapped layout with no `params` to build its own links from.
 * @param {Record<string, string> | undefined} params
 * @param {URL | undefined} url
 * @param {unknown} actionData
 */
function boundaryCtx(params, url, actionData) {
  return {
    params: makeThenable(params || {}),
    searchParams: makeThenable(url ? Object.fromEntries(url.searchParams.entries()) : {}),
    url: url ? url.toString() : '',
    actionData,
  };
}

/**
 * Render a simple boundary page (forbidden / unauthorized, #848) at the given
 * default heading. Loads the nearest boundary module when one exists, else
 * emits the default heading. Mirrors ssrNotFoundHtml.
 *
 * When the caller supplies the matched `route` (#1298), the boundary renders
 * inside the layouts wrapping it, so a 403 / 401 soft-swaps like any other
 * response. Two bounded attempts, never a loop: a throwing layout degrades to
 * the standalone render this has always produced.
 *
 * @param {string | null} file
 * @param {string} heading  e.g. '403: Forbidden'
 * @param {{ dev: boolean, appDir: string, req?: Request, url?: URL,
 *   route?: { file: string, layouts: string[] },
 *   ctx?: Record<string, unknown>, params?: Record<string, string> }} opts
 */
async function ssrBoundaryHtml(file, heading, opts) {
  let body = `<h1>${heading}</h1>`;
  /** @type {string[]} */
  let moduleUrls = [];
  if (file) {
    const ctx = opts.ctx || boundaryCtx(opts.params, opts.url, undefined);
    try {
      const mod = await loadModule(file, opts.dev);
      if (mod.default) {
        const tree = await mod.default(ctx);
        try {
          if (opts.route) {
            body = await renderBoundaryInChain(tree, opts.route, file, ctx, opts.dev);
            // The chain rendered, so its modules have to boot: chrome that
            // paints but never hydrates is worse than no chrome, because its
            // controls look live and are not (#1298).
            moduleUrls = boundaryModuleUrls(
              file,
              layoutsForBoundary(opts.route.layouts, boundarySegmentPath(file)),
              opts,
            );
          } else {
            body = await renderToString(tree, { ssr: true, dev: opts.dev });
          }
        } catch (layoutErr) {
          // A TREE failure is not this catch's business: the standalone
          // fallback would re-render the same tree and fail the same way, so
          // rethrow and let the outer catch report it ONCE under the boundary
          // label. Reporting here as well would double-report it and call it a
          // layout crash.
          if (!isLayoutPhase(layoutErr)) throw layoutErr;
          // A wrapped layout threw. Degrade to the standalone render this has
          // always produced, and to its empty boot set with it. Report it
          // either way: these paths execute layout modules for the first time
          // since #1298, so a genuine layout crash would otherwise vanish.
          reportBoundaryLayoutError(layoutErr, opts, { overlay: true });
          try {
            body = await renderToString(tree, { ssr: true, dev: opts.dev });
            moduleUrls = [];
          } catch (treeErr) {
            // BOTH are broken. The layout crash is already reported above, so
            // hand the outer catch the TREE error: it is a second, distinct
            // failure, and it is the one whose text the dev body should show.
            throw treeErr;
          }
        }
      }
    } catch (e) {
      // The boundary module itself threw or failed to load. REPORT it: with
      // the body sanitized below, this is otherwise completely silent in
      // production, on a request that already returned a 4xx to a real user.
      // Sanitizing without reporting moves a failure out of sight rather than
      // out of the response, which is the opposite of the intent.
      reportBoundaryLayoutError(e, opts, { what: STAGE_BOUNDARY, overlay: true });
      // Dev shows the failure; prod shows only the heading. The 500 path has
      // always drawn that line (a thrown error's message is not
      // author-controlled and must not reach the client), and these pages were
      // rendering it in production.
      body = opts.dev
        ? `<h1>${heading}</h1><pre>${escapeHtml(safeErrorText(e))}</pre>`
        : `<h1>${heading}</h1>`;
      moduleUrls = [];
    }
  }
  const nonce = opts.req ? getNonce(opts.req) : undefined;
  return wrapInDocument(body, {
    metadata: { title: heading.replace(/^\d+:\s*/, '') },
    moduleUrls,
    dev: opts.dev,
    nonce,
  });
}

/**
 * Render the 404 page. Same two-attempt wrapping contract as ssrBoundaryHtml
 * (#1298). `opts.route` is absent when no route matched at all (an unrouted
 * URL), and then there is no chain to wrap in, so the response stays the bare
 * document it has always been.
 * @param {string | null} notFoundFile
 * @param {{ dev: boolean, appDir: string, req?: Request, url?: URL,
 *   route?: { file: string, layouts: string[] },
 *   ctx?: Record<string, unknown>, params?: Record<string, string> }} opts
 */
async function ssrNotFoundHtml(notFoundFile, opts) {
  let body = '<h1>404: Not found</h1>';
  /** @type {string[]} */
  let moduleUrls = [];
  if (notFoundFile) {
    const ctx = opts.ctx || boundaryCtx(opts.params, opts.url, undefined);
    try {
      const mod = await loadModule(notFoundFile, opts.dev);
      if (mod.default) {
        const tree = await mod.default(ctx);
        try {
          if (opts.route) {
            body = await renderBoundaryInChain(tree, opts.route, notFoundFile, ctx, opts.dev);
            moduleUrls = boundaryModuleUrls(
              notFoundFile,
              layoutsForBoundary(opts.route.layouts, boundarySegmentPath(notFoundFile)),
              opts,
            );
          } else {
            body = await renderToString(tree, { ssr: true, dev: opts.dev });
          }
        } catch (layoutErr) {
          // Same phase rule as ssrBoundaryHtml above.
          if (!isLayoutPhase(layoutErr)) throw layoutErr;
          reportBoundaryLayoutError(layoutErr, opts, { overlay: true });
          try {
            body = await renderToString(tree, { ssr: true, dev: opts.dev });
            moduleUrls = [];
          } catch (treeErr) {
            throw treeErr;
          }
        }
      }
    } catch (e) {
      // Reported for the same reason as in ssrBoundaryHtml above.
      reportBoundaryLayoutError(e, opts, { what: STAGE_BOUNDARY, overlay: true });
      body = opts.dev
        ? `<h1>404: Not found</h1><pre>${escapeHtml(safeErrorText(e))}</pre>`
        : '<h1>404: Not found</h1>';
      moduleUrls = [];
    }
  }
  const nonce = opts.req ? getNonce(opts.req) : undefined;
  return wrapInDocument(body, {
    metadata: { title: 'Not found' },
    moduleUrls,
    dev: opts.dev,
    nonce,
  });
}

/**
 * SSR a matched page route to a Response.
 *
 * Mirrors NextJs semantics:
 *   - Page + layout default exports can be async.
 *   - `metadata` named export on layouts/pages is merged (page > innermost layout > … > root).
 *   - `notFound()` and `redirect()` thrown anywhere in the chain are caught
 *     and converted to 404 or 3xx responses.
 *   - On a render error we walk up the chain looking for the nearest `error.js`
 *     and render that instead (falls back to a plain error page).
 *
 * @param {import('../router.js').PageRoute} route
 * @param {Record<string,string>} params
 * @param {URL} url
 * @param {{ dev: boolean, appDir: string, req?: Request, moduleGraph?: import('../module-graph.js').ModuleGraph, serverFiles?: Map<string,string> | Set<string>, actionData?: unknown, status?: number, pageModule?: Record<string, unknown>, cspEnabled?: boolean }} opts
 * @returns {Promise<Response>}
 */
export async function ssrPage(route, params, url, opts) {
  // Server HTML response cache (ISR for no-build, #241). OPT-IN: only a page
  // that declares `export const revalidate = N` is ever cached (the page
  // module export is the single trigger). The page module is loaded ONCE up
  // front to read that window
  // and is threaded back through `opts.pageModule` so renderChain reuses the
  // same evaluation (no double-load). A cache HIT serves the stored HTML
  // without re-running the page function. Skipped entirely (no opt-in read,
  // no double behaviour) for the form-action re-render (actionData / a non-200
  // status) and for a partial-nav request (X-Webjs-Have), whose bytes depend
  // on the request and must not be shared under the full-URL key.
  const cacheEligible =
    !opts.actionData &&
    !opts.status &&
    !opts.pageModule &&
    !(opts.req && opts.req.headers.get('x-webjs-have'));
  let revalidateSeconds = null;
  if (cacheEligible) {
    try {
      const pageMod = await loadModule(route.file, opts.dev);
      opts = { ...opts, pageModule: pageMod };
      revalidateSeconds = readRevalidate(pageMod);
      if (revalidateSeconds !== null) {
        const hit = await readHtmlCache(url);
        if (hit) {
          const cached = cachedHtmlResponse(hit, opts.req, url);
          // A cache hit returns before any seed work runs, so it would otherwise
          // report nothing at all, which reads as "seeding is broken" when it is
          // really the cache answering (#1309). The seed block rides INSIDE the
          // cached bytes, so the seeds are exactly as fresh as the HTML.
          if (opts.dev) cached.headers.set('X-Webjs-Seed', 'html-cache');
          return cached;
        }
      }
    } catch {
      // A load / store failure falls through to a normal fresh render: the
      // cache is an optimization, never a correctness dependency. Leave
      // revalidateSeconds as read so the write path still applies when the
      // page loaded but only the store lookup failed.
    }
  }

  const ctx = {
    // params / searchParams are awaitable AND synchronously readable (#848):
    // `params.id` still works, `await params` also works (Next 15/16 parity).
    // The `then` is non-enumerable so spread / JSON / Object.keys are unchanged.
    params: makeThenable(params),
    searchParams: makeThenable(Object.fromEntries(url.searchParams.entries())),
    url: url.toString(),
    // Populated only when this render is the re-render after a failed page
    // `action` submission (#244). The page function and every layout receive
    // it so they can surface field errors and repopulate inputs from the
    // user's submitted values. Undefined on a normal GET render, so GET output
    // is byte-identical to before this feature.
    actionData: opts.actionData,
  };

  // Collect metadata across layouts (outermost first) then page.
  const metadata = await collectMetadata(route, ctx, opts.dev);

  try {
    const suspenseCtx = { pending: [], nextId: 1, usedComponents: new Set(), dev: opts.dev };
    // Parse the partial-nav "have" header from the client. The server walks
    // the target route's layout chain innermost → outermost and
    // SHORT-CIRCUITS at the first FULL match (segment AND route-key),
    // returning only the content below that layout, wrapped in the matched
    // layout's boundary pair. Real wire-byte savings: the outer layouts'
    // HTML is never re-serialized for same-shell navigations.
    const haveHeader = opts.req?.headers.get('x-webjs-have') || '';
    // Entries are `<segment>:<route-key>` (#1015). The route-key is required
    // for a correct short-circuit: a dynamic layout the client holds for
    // OTHER params ('/[org]' rendered for org-a on an org-b navigation) must
    // be re-rendered and re-shipped, or the client's parent-anchored REPLACE
    // has no fresh layout markup to swap in. Split at the LAST ':' (encoded
    // route-keys contain no ':'; a hand-authored folder name that smuggles a
    // delimiter through the SEGMENT half can only fail to match, which
    // degrades to a full render: always correct). An entry with no key (a
    // malformed or legacy client) is ignored, degrading the same way.
    /** @type {Map<string, string> | null} */
    let have = null;
    if (haveHeader) {
      have = new Map();
      for (const entry of haveHeader.split(',')) {
        const e = entry.trim();
        if (!e) continue;
        const cut = e.lastIndexOf(':');
        if (cut <= 0 || cut === e.length - 1) continue;
        have.set(e.slice(0, cut), e.slice(cut + 1));
      }
      if (have.size === 0) have = null;
    }
    // SSR action-result seeding (#472). When enabled, run the whole render
    // inside an ambient seed collector so every `'use server'` action a
    // component awaits in `async render()` records its (args -> result) for the
    // hydration payload. Disabled -> the plain render, byte-identical to before.
    let seedCollector = null;
    let body;
    let reduced = false;
    if (seedingEnabled()) {
      const seeded = await collectSeeds(() =>
        renderChain(route, ctx, opts.dev, suspenseCtx, have, opts.pageModule),
      );
      body = seeded.value.html;
      reduced = seeded.value.reduced;
      seedCollector = seeded.collector;
    } else {
      const chain = await renderChain(route, ctx, opts.dev, suspenseCtx, have, opts.pageModule);
      body = chain.html;
      reduced = chain.reduced;
    }

    // Frame subtree render (#253). A `<webjs-frame src>` self-load (or a
    // click-driven frame nav) sends `x-webjs-frame: <id>` and applies ONLY the
    // matching `<webjs-frame id>` subtree from the response, discarding the rest
    // of the page. So when that header is present AND the requested frame is in
    // the rendered output (the "isolable" case), return JUST that subtree: the
    // bytes are extracted verbatim from the same full render, so the result is
    // BYTE-EQUIVALENT to what the client would slice from a full-page response,
    // but the full document shell + all the other regions never go on the wire.
    // The frame swap path (applySwap in router-client.js) parses this body and
    // does `doc.querySelector('webjs-frame#<id>')`, which finds the lone
    // subtree exactly as it would in the full page. A streamed (Suspense)
    // render is skipped (its bytes are not yet final). When the frame id is NOT
    // found (an auth redirect to a login page, a route that dropped the frame),
    // we fall through to the normal full-page render, where the client's
    // existing `webjs:frame-missing` fallback handles the absence. A request
    // with NO `x-webjs-frame` header never reaches this branch, so a normal
    // page request is byte-identical to before this feature.
    const frameId = requestedFrameId(opts.req);
    if (frameId && suspenseCtx.pending.length === 0) {
      const subtree = extractFrameSubtree(body, frameId);
      if (subtree !== null) {
        const frameRes = htmlResponse(subtree, opts.status || 200, opts.req, url);
        // The subtree is sliced by the x-webjs-frame REQUEST header, so a
        // shared cache must never serve it to a request that did not send
        // one (the same #1009 poisoning shape as the reduced-have case).
        frameRes.headers.append('vary', 'X-Webjs-Frame');
        // #1009: a subtree sliced from a REDUCED render inherits its variance.
        if (reduced) frameRes.headers.append('vary', 'X-Webjs-Have');
        // No privateFragment call here on purpose: this response is built
        // WITHOUT page metadata, so it is already `no-store` and the call
        // would be dead code with nothing to assert against. The property is
        // locked by a test instead, which fails if the frame response ever
        // starts carrying the page's cacheControl.
        return frameRes;
      }
    }
    // Module URLs for the page + every layout in its chain. These ride
    // the importmap; the browser fetches each file as it walks the
    // import graph. Combined with the modulepreload hints below, this
    // is the Rails 7+ / Hotwire pattern: per-file ESM, no bundling,
    // HTTP/2 multiplex on the wire.
    //
    // Inert route modules (a page or layout that does no client work, even
    // transitively) are dropped from the boot script: the browser never
    // downloads them. The SSR'd HTML is the complete output, and
    // progressive enhancement is unaffected, so a fully-static route ships
    // zero application JS. The analysis is conservative (anything that
    // touches the client router, a signal, an event, an npm import, or a
    // shipping component keeps shipping).
    //
    // Import-only route modules (#605) go one step further: a page / layout
    // whose only client relevance is importing shipping components is itself
    // dead weight on the client (it never hydrates), so it is dropped and its
    // component modules are emitted directly in its place. The component set
    // is the FRONTIER of the analyser's path-aware walk (#963): the shipping
    // components the module reaches without passing through another shipping
    // component. A component imported but only conditionally rendered still
    // registers; one nested behind an emitted component is absent here and
    // loads via its importer's own imports. Dedup so a component shared
    // across the page and a layout (or two layouts) is emitted once.
    const inert = opts.inertRouteModules;
    const importOnly = opts.importOnlyRouteModules;
    const moduleUrls = [];
    {
      const seen = new Set();
      const push = (abs) => {
        const u = toUrlPath(abs, opts.appDir);
        if (!seen.has(u)) { seen.add(u); moduleUrls.push(u); }
      };
      for (const f of [route.file, ...route.layouts]) {
        if (inert && inert.has(f)) continue;
        const emit = importOnly && importOnly.get(f);
        if (emit) emit.forEach(push);
        else push(f);
      }
    }
    // instrumentation-client.{js,ts} (#848): import it FIRST in the client boot
    // so it runs before app modules (Next's instrumentation-client ordering).
    // It ships even on an otherwise-static page (the app opted into client work),
    // so it is prepended AFTER the component/page modules are collected.
    if (opts.instrumentationClient) {
      const u = toUrlPath(opts.instrumentationClient, opts.appDir);
      const i = moduleUrls.indexOf(u);
      if (i !== -1) moduleUrls.splice(i, 1);
      moduleUrls.unshift(u);
    }
    // Emit <link rel="modulepreload"> for every custom element that
    // actually rendered PLUS their transitive dependencies (from the
    // module graph). URLs are deduplicated so the browser never sees
    // the same preload twice. Lazy components are excluded from
    // preloads and instead loaded via IntersectionObserver when they
    // enter the viewport.
    const { eager: eagerComponents, lazy: lazyComponents } =
      componentPreloads(suspenseCtx.usedComponents, opts.appDir, opts.elidableComponents);
    // The walk roots for BOTH preload passes are the BOOT's actually-shipped
    // module set (`moduleUrls`, which already drops inert page/layout modules and
    // substitutes an import-only page with its components), NOT the raw route
    // entries `[route.file, ...route.layouts]`. Rooting at the raw entries would
    // walk a dropped page's SSR-only subtree (a direct import OR a relative
    // helper) and hint a `modulepreload` for a module nothing that ships imports,
    // an over-fetch (#780, the app-module analog of the #754 vendor over-fetch).
    const shippedRoots = moduleUrls.map((u) =>
      resolve(opts.appDir, u.startsWith('/') ? u.slice(1) : u));
    const preloads = deduplicatedPreloads(
      eagerComponents,
      moduleUrls,
      opts.moduleGraph,
      shippedRoots,
      opts.appDir,
      opts.serverFiles,
      opts.elidableComponents,
    );
    // Vendor modulepreload (#754): flatten the npm CDN waterfall by hinting the
    // vendor URLs the page's SHIPPED modules actually import, fetched in parallel
    // instead of discovered level by level. Same shipped-module roots as the
    // app-module walk above, so a vendor reached ONLY through a dropped module
    // (a page's SSR-only direct import OR its SSR-only relative helper) is never
    // preloaded (no over-fetch).
    const vendorPreloads = vendorPreloadTargets(
      reachedVendorSpecifiers(
        opts.moduleGraph,
        shippedRoots,
        eagerComponents,
        opts.appDir,
        opts.elidableComponents,
        opts.serverFiles,
      ),
    );
    // Extract CSP nonce from request headers (if present).
    const nonce = opts.req ? getNonce(opts.req) : undefined;
    const wrapOpts = {
      metadata,
      moduleUrls,
      dev: opts.dev,
      streaming: suspenseCtx.pending.length > 0,
      preloads,
      vendorPreloads,
      lazyComponents,
      nonce,
    };
    // buildDocumentParts picks up a user-supplied <!doctype><html>…</html>
    // shell from the body when present; otherwise auto-emits the framework
    // shell. Either way the returned `prefix` ends just past the open <body>
    // and `closer` is the matching `</body></html>`.
    const { prefix, streamBody, closer } = buildDocumentParts(body, wrapOpts);
    // Append the SSR action-seed payload (#472) to the non-streamed body so the
    // client's first render reads it instead of re-issuing the RPC. Only for a
    // fully-buffered (non-streaming) render: a streamed page's deferred
    // boundaries resolve AFTER the first flush, so their seeds cannot ride this
    // block (those slow regions keep the stale-while-revalidate refetch). An
    // empty collector yields '' so the output stays byte-identical.
    let outBody = streamBody;
    // Dev-only seeding diagnostics (#1309). `off` (seeding disabled) is kept
    // DISTINCT from `collected=0` on purpose: the counting lives with the
    // collector rather than behind the seed gate, so a seeding-DISABLED app
    // never looks like a seeding-BROKEN one.
    let seedHeader = 'off';
    const streamed = suspenseCtx.pending.length > 0;
    if (seedCollector && streamed) {
      // A streamed render's deferred boundaries resolve AFTER the first flush,
      // so their results cannot ride this block and none is emitted in prod. In
      // DEV emit the marker alone, so the client reports the CAUSE instead of
      // leaving the developer to guess why every action call went to the network.
      seedHeader = `collected=${seedCollector.size}, emitted=0, streamed`;
      if (opts.dev) {
        const marker = await buildSeedScript(null, { dev: true, reason: 'streamed' });
        if (marker) outBody = streamBody + marker;
      }
    } else if (seedCollector) {
      const seedScript = await buildSeedScript(seedCollector, { dev: opts.dev });
      if (seedScript) outBody = streamBody + seedScript;
      // `emitted` differs from `collected` exactly when the serializer threw and
      // dropped the whole block, which is otherwise a completely invisible
      // failure. In DEV that throw still emits a marker-only block, so the
      // browser can name the cause; it carries no seeds, so it must NOT count as
      // emitted or the header would report a total success on the very failure
      // it exists to expose.
      const dropped = seedScript === SEED_DROP_BLOCK;
      seedHeader = `collected=${seedCollector.size}, emitted=${seedScript && !dropped ? seedCollector.size : 0}`;
    }
    const res = streamingHtmlResponse(
      prefix,
      outBody,
      closer,
      suspenseCtx,
      // Normally 200. After a failed form-action submission the caller passes
      // 422 (or another 4xx) so the re-rendered page with field errors carries
      // the right status for both the no-JS reload and the enhanced swap (#244).
      opts.status || 200,
      opts.req,
      url,
      metadata,
      nonce,
      opts.dev,
    );
    // Dev-only seeding diagnostics (#1309). A miss is indistinguishable from a
    // hit from the outside, so an app whose seeding silently broke looks exactly
    // like one where it works. Dev only: a production header would publish how
    // many server calls a page made, for no benefit.
    if (opts.dev) res.headers.set('X-Webjs-Seed', seedHeader);
    // REDUCED response (#1009): the X-Webjs-Have short-circuit omitted the
    // outer-layout chrome, so these bytes are only valid for a request that
    // sent a matching `have`. Left shared-cacheable, a CDN edge could store the
    // reduced body under the URL and serve a chrome-less fragment to a fresh
    // full-page navigation (measured live: GET / was 73,534 bytes, GET / + have
    // was 57,035, byte-identical headers otherwise).
    //
    // TWO markings, and the order of trust matters (#1140). `privateFragment`
    // is the guarantee: it forbids SHARED storage outright, so no CDN can hold
    // this body at all. `Vary` is belt-and-braces for caches that honour it,
    // NOT the protection, because Cloudflare and others honour only
    // `Accept-Encoding`. Both are scoped to genuinely reduced responses, so a
    // normal page's headers and cache key are unchanged.
    //
    // The internal #241 revalidate cache is already safe by construction:
    // `cacheEligible` excludes any request that carries x-webjs-have, so a
    // reduced body is never stored under the URL-only key.
    if (reduced) {
      res.headers.append('vary', 'X-Webjs-Have');
      privateFragment(res);
    }
    // Server HTML cache write (#241). The page opted in via `revalidate`, so
    // FLAG this candidate for the response funnel rather than writing here: the
    // store decision must see the FINAL response (after segment middleware,
    // which may append a per-user Set-Cookie this code can't see yet). The
    // funnel re-checks every guard via isCacheableResponse, writes the cache,
    // and strips this internal marker. The CSP guard is decided here (the SSR
    // side knows whether a nonce was stamped into the body).
    if (revalidateSeconds !== null && !opts.cspEnabled) {
      res.headers.set(HTML_CACHE_MARKER, String(revalidateSeconds));
    }
    return res;
  } catch (err) {
    if (isRedirect(err)) {
      const e = /** @type any */ (err);
      // A redirect thrown during a GET page/layout render is a GET-to-GET
      // navigation (an auth bounce, a gate). 302 Found is the conventional
      // code there, so it is the default when the caller did not pick one. An
      // explicit `redirect(url, status)` overrides it. (Action redirects, a
      // POST, default to 307 in form-dispatch.js so the method is preserved.)
      return new Response(null, { status: e.status || 302, headers: { location: e.url } });
    }
    if (isNotFound(err)) {
      // Nearest not-found.{js,ts} in the page's chain wins (#848 fix: previously
      // this always rendered the bare default, ignoring even a root not-found);
      // fall back to a root global-not-found.{js,ts}, else the default page.
      // Pass the matched route and this render's ctx so the boundary renders
      // inside its layouts (#1298). A root-only global-not-found sits at '/',
      // so it wraps in the root layout only, which is right.
      const html = await ssrNotFoundHtml(
        nearest(route.notFounds) || opts.globalNotFound || null,
        { ...opts, url, route, ctx }
      );
      return htmlResponse(html, 404, opts.req, url);
    }
    // forbidden() / unauthorized() sentinels (#848, Next 15/16 parity): render
    // the nearest forbidden.{js,ts} / unauthorized.{js,ts} boundary (innermost
    // wins), else a default page, at 403 / 401.
    if (isForbidden(err)) return ssrForbidden(route, { ...opts, url, route, ctx });
    if (isUnauthorized(err)) return ssrUnauthorized(route, { ...opts, url, route, ctx });
    // APM / Sentry sink (issue #239): a page render error that becomes a 500
    // (an error.js boundary OR the default 500 page) is an unhandled error the
    // app should see in its error tracker. Report it best-effort BEFORE
    // rendering the boundary, so the sink gets the ORIGINAL error even if the
    // boundary itself swallows or transforms it. notFound / redirect are
    // sentinels (control flow), not errors, so they are excluded above.
    if (typeof opts.onError === 'function') {
      try { opts.onError(err); } catch { /* a throwing sink must not affect the response */ }
    }
    // Dev error overlay (#264): push a rich frame to the open tab so the
    // overlay appears live. Dev-only + best-effort; never affects the response.
    if (typeof opts.onDevError === 'function') {
      try { opts.onDevError(err); } catch { /* a throwing sink must not affect the response */ }
    }
    // Error paths still need to honor the request's CSP nonce so the
    // error page's boot scripts (when moduleUrls is non-empty) and
    // the meta csp-nonce tag both pass strict-CSP enforcement.
    const errNonce = opts.req ? getNonce(opts.req) : undefined;
    // One dedup set for the whole 500 path: the walk below and the
    // global-error attempt after it collapse REPEATS of the same cause (a
    // shared layout that fails every attempt) while still reporting a
    // genuinely different failure, including global-error's own.
    //
    // SEEDED with the original error, which was just reported above. When a
    // LAYOUT is what threw, the walk re-runs that same layout around each
    // boundary it wraps (the root layout wraps every boundary), so the cause
    // that produced this 500 is about to arrive again as a secondary failure.
    // Without the seed the commonest layout crash of all is reported twice.
    const secondary = new Set();
    {
      const originalKey = boundaryErrorKey(err, STAGE_WALK);
      if (originalKey !== null) secondary.add(originalKey);
    }
    // Try nearest error.js (innermost → outermost).
    for (let i = route.errors.length - 1; i >= 0; i--) {
      try {
        const mod = await loadModule(route.errors[i], opts.dev);
        if (!mod.default) continue;
        const tree = await mod.default({ ...ctx, error: err });
        // The layouts that wrap THIS boundary: its own segment and every
        // ancestor (#1298). A layout deeper than the boundary never rendered.
        const wrapLayouts = layoutsForBoundary(route.layouts, boundarySegmentPath(route.errors[i]));
        // Render inside them, so the response carries the keyed wj:children
        // pairs and a client-router navigation into this page stays SOFT.
        // Inside the existing try on purpose: a layout that throws here is
        // caught by the `catch (nested)` below and the loop moves one boundary
        // OUT, whose wrapped set is strictly smaller. That bounded walk is how
        // a throwing layout resolves, and why no failure-point tracking is
        // needed (a throw out of renderToString is not attributable to one
        // layout anyway, so tracking would be absent exactly when it mattered).
        const body = await renderBoundaryInChain(tree, route, route.errors[i], ctx, opts.dev);
        // Apply the SAME inert / import-only substitution as the happy-path
        // boot (#963): the error page must not ship a page/layout module the
        // normal render drops. Pre-substitution, an import-only page with a
        // bare `.server.*` import (legal, it never loads client-side) would
        // load here whole and crash the error page's boot on the throw-at-load
        // stub, killing the sibling component registrations in the same
        // module script.
        //
        // The set is what actually RENDERED (#1298): the boundary module and
        // the layouts wrapping it. It used to be the page module plus every
        // layout, so a boundary shipped the page (which never ran) and any
        // deeper layout (which never ran either), while omitting the boundary
        // itself, and a component the boundary rendered never upgraded. The
        // substitution applies to the boundary file harmlessly: only page and
        // layout files are fed to the elision analysis, so a boundary is never
        // inert and never import-only, gets no verdict, and is pushed as-is.
        const errModuleUrls = boundaryModuleUrls(route.errors[i], wrapLayouts, opts);
        const html = wrapInDocument(body, { metadata, moduleUrls: errModuleUrls, dev: opts.dev, nonce: errNonce });
        return htmlResponse(html, 500, opts.req, url);
      } catch (nested) {
        // Fall through to the next error boundary out. Since #1298 this also
        // absorbs a throw from a WRAPPED LAYOUT, which is the case that makes a
        // throwing layout render the boundary outside it (Next parity: a
        // boundary sits inside its own segment's layout, so it cannot catch it).
        //
        // Report it on the way past. The fallthrough is the right BEHAVIOUR,
        // but it is not a reason to lose the error: whatever this response ends
        // up being, the sinks only ever hear about the ORIGINAL page error
        // (reported above), so a boundary or a layout that crashed while
        // handling it would vanish completely. A control-flow sentinel is
        // filtered out by the reporter, since a boundary throwing notFound() is
        // a routing decision rather than a crash.
        reportBoundaryLayoutError(nested, opts, {
          what: STAGE_WALK,
          seen: secondary,
          overlay: false,
        });
      }
    }
    // Root global-error.{js,ts} (#848): the app-wide catch-all, tried after the
    // nested error boundaries are exhausted. It renders the FULL document (its
    // own <!doctype><html><body>, like the root layout), since a root-layout
    // failure is exactly when it fires, so its rendered output is returned
    // verbatim without wrapInDocument. Status 500.
    //
    // Deliberately the one boundary #1298 does NOT wrap in layouts: it writes
    // its own shell (invariant 8 allows only one), wrapping it in the root
    // layout would re-run the code that just threw, and it ships no importmap
    // or boot script by design, so it could not soft-swap even if wrapped.
    if (opts.globalError) {
      try {
        const mod = await loadModule(opts.globalError, opts.dev);
        if (mod.default) {
          const tree = await mod.default({ error: err });
          const body = await renderToString(tree, { ssr: true, dev: opts.dev });
          return htmlResponse(body, 500, opts.req, url);
        }
      } catch (nested) {
        // Fall through to the default 500 page, but do not lose this. A broken
        // global-error.{js,ts} is the app's LAST-RESORT boundary failing, and
        // the developer would otherwise see only the generic default page and
        // the original error, with nothing naming the boundary as the thing
        // that failed.
        reportBoundaryLayoutError(nested, opts, {
          what: STAGE_GLOBAL_ERROR,
          seen: secondary,
          overlay: false,
        });
      }
    }
    // Default: dev shows stack, prod shows a terse message (no stack trace leaks).
    console.error('[webjs] unhandled render error:', err);
    const body = opts.dev
      ? `<h1>Server error</h1><pre style="white-space:pre-wrap">${escapeHtml(safeErrorText(err))}</pre>`
      : `<h1>Server error</h1><p>Something went wrong. Please try again.</p>`;
    return htmlResponse(
      wrapInDocument(body, { metadata, moduleUrls: [], dev: opts.dev, nonce: errNonce }),
      500,
      opts.req,
      url
    );
  }
}

/**
 * 404 response for unmatched routes.
 * @param {string | null} notFoundFile
 * @param {{ dev: boolean, appDir: string, req?: Request, url?: URL,
 *   route?: import('../router.js').PageRoute,
 *   ctx?: Record<string, unknown>, params?: Record<string, string> }} opts
 */
export async function ssrNotFound(notFoundFile, opts) {
  const html = await ssrNotFoundHtml(notFoundFile, opts);
  return htmlResponse(html, 404, opts.req, opts.url);
}

/**
 * 403 response for a thrown forbidden() (#848). Renders the nearest
 * forbidden.{js,ts} in the page's chain, else a default 403 page. Shared by the
 * page-render catch (ssr.js) and the form-action write path (form-dispatch.js) so
 * both behave identically.
 * @param {{ forbiddens?: string[] }} route
 * @param {{ dev: boolean, appDir: string, req?: Request, url?: URL,
 *   route?: import('../router.js').PageRoute,
 *   ctx?: Record<string, unknown>, params?: Record<string, string> }} opts
 */
export async function ssrForbidden(route, opts) {
  const html = await ssrBoundaryHtml(nearest(route.forbiddens), '403: Forbidden', opts);
  return htmlResponse(html, 403, opts.req, opts.url);
}

/**
 * 401 response for a thrown unauthorized() (#848). Renders the nearest
 * unauthorized.{js,ts} in the page's chain, else a default 401 page.
 * @param {{ unauthorizeds?: string[] }} route
 * @param {{ dev: boolean, appDir: string, req?: Request, url?: URL,
 *   route?: import('../router.js').PageRoute,
 *   ctx?: Record<string, unknown>, params?: Record<string, string> }} opts
 */
export async function ssrUnauthorized(route, opts) {
  const html = await ssrBoundaryHtml(nearest(route.unauthorizeds), '401: Unauthorized', opts);
  return htmlResponse(html, 401, opts.req, opts.url);
}
