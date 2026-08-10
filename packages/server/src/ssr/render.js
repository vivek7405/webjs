import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { renderToString, isNotFound, isRedirect, isForbidden, isUnauthorized, lookupModuleUrl, isLazy, cspNonce } from '@webjsdev/core';
import { importMapTag, vendorIntegrityFor, publishedBuildId, appSourceId, basePath, vendorPreconnectOrigins, vendorPreloadTargets, buildImportMap } from '../importmap.js';
import { withBasePath } from '../base-path.js';
import { withAssetHash } from '../asset-hash.js';
import { jsonForScriptTag } from '../script-tag-json.js';
import { transitiveDeps, bareImports } from '../module-graph.js';
import { seedingEnabled, collectSeeds, buildSeedScript, SEED_DROP_BLOCK } from '../action-seed.js';
import { BUFFERED_MARKER, STREAM_MARKER } from '../conditional-get.js';
import {
  readRevalidate,
  readHtmlCache,
  HTML_CACHE_MARKER,
} from '../html-cache.js';
import { requestedFrameId, extractFrameSubtree } from '../frame-render.js';
import { makeThenable } from '../thenable-params.js';
import { hoistHeadTags, collectHoistedHeadTags, serializeViewport, jsonLdScript, escapeJsonLd, preloadCrossOriginAttr, integrityAttr } from './head.js';
import { extractUserShell, buildDocumentParts, wrapInDocument, layoutSegmentPath, pageSegmentPath, regionRouteKey, wrapWithChildrenMarker, publicEnvShim } from './document.js';

// Client-router opt-out (#629). Default ON (the framework's automatic-nav
// thesis): the router auto-enables in the browser when `@webjsdev/core` loads.
// `webjs.clientRouter: false` flips this off app-wide; `dev.js` reads the
// config at boot / each rebuild and calls `setClientRouterEnabled`, and
// `wrapHead` then emits a `window.__WEBJS_CLIENT_ROUTER__=false` flag BEFORE
// the deferred boot module so the bundle's module-end auto-enable skips. A
// module-level switch (mirrors setBasePath / setElisionFingerprint) so no opt
// has to thread through every render path; default true keeps every existing
// app and test byte-identical.
let _clientRouterEnabled = true;

export function setClientRouterEnabled(enabled) {
  _clientRouterEnabled = enabled !== false;
}

export function clientRouterEnabled() {
  return _clientRouterEnabled;
}

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

function nearest(arr) {
  return arr && arr.length ? arr[arr.length - 1] : null;
}

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toUrlPath(file, appDir) {
  let rel = file.startsWith(appDir) ? file.slice(appDir.length) : file;
  return rel.split('\\').join('/').replace(/^\/?/, '/');
}

/**
 * Translate a Set of custom element tag names used on the page into browser
 * URLs for modulepreload. Components that didn't pass a module URL to
 * `register()` are skipped silently (no harm, just no preload hint).
 *
 * Returns separate eager and lazy lists. Lazy components (static lazy = true)
 * are NOT preloaded: they're loaded by the IntersectionObserver-based
 * lazy-loader when the element enters the viewport.
 *
 * Elidable (display-only) components are skipped entirely: their imports
 * are stripped from the served source, so preloading their module would
 * fetch JS the browser never executes.
 *
 * @param {Set<string>} usedTags
 * @param {string} appDir
 * @param {Set<string>} [elidable]  absolute paths of elidable component files
 * @returns {{ eager: string[], lazy: Record<string, string> }}
 */
function componentPreloads(usedTags, appDir, elidable) {
  const eager = [];
  /** @type {Record<string, string>} */
  const lazy = {};
  for (const tag of usedTags) {
    const fileUrl = lookupModuleUrl(tag);
    if (!fileUrl) continue;
    try {
      const abs = fileURLToPath(fileUrl);
      if (!abs.startsWith(appDir)) continue;
      if (elidable && elidable.has(abs)) continue;
      const url = toUrlPath(abs, appDir);
      if (isLazy(tag)) {
        lazy[tag] = url;
      } else {
        eager.push(url);
      }
    } catch { /* ignore */ }
  }
  return { eager, lazy };
}

/**
 * Merge component preloads with transitive dependencies from the module
 * graph, then deduplicate against the already-imported module URLs.
 *
 * The walk ROOTS (`entryFiles`) are the boot's actually-SHIPPED page/layout
 * module set (the caller passes the absolute paths of `moduleUrls`, which
 * already drops an inert page/layout and substitutes an import-only page with
 * its components), NOT the raw `[route.file, ...route.layouts]` route entries.
 * This matches `reachedVendorSpecifiers`' roots so the two walks stay
 * consistent. Rooting at the shipped set means a module reached ONLY through a
 * dropped page/layout (its SSR-only direct app import OR its SSR-only relative
 * helper) is never a walk root's dep, so it gets no `modulepreload` hint (no
 * over-fetch, #780). A module that also ships some other way (a component shared
 * with a live route, or reached via an import-only page's substituted
 * components) is still reached through a real shipped root, so its hint stays
 * (no under-fetch). `seen = new Set(moduleUrls)` already excludes the shipped
 * modules' own URLs; the shipped-roots change closes the TRANSITIVE gap.
 *
 * @param {string[]} componentUrls  direct component module URLs
 * @param {string[]} moduleUrls     boot script imports (page + layouts)
 * @param {import('./module-graph.js').ModuleGraph | undefined} graph
 * @param {string[]} entryFiles     absolute paths of the SHIPPED page/layout modules (from `moduleUrls`)
 * @param {string} appDir
 * @param {Set<string>} [elidableComponents]  absolute paths to skip in the walk
 * @returns {string[]}
 */
function deduplicatedPreloads(componentUrls, moduleUrls, graph, entryFiles, appDir, serverFiles, elidableComponents) {
  const seen = new Set(moduleUrls);
  const result = [];

  // Server-only modules are never useful to preload: they're imported by
  // pages/layouts on the server, or surfaced to client components as
  // generated RPC stubs that load lazily on first call. Preloading them
  // wastes a roundtrip and pollutes the network tab with server-named files.
  //
  // Detection is belt-and-suspenders: filename suffix catches `.server.*`;
  // the `serverFiles` set (built from the action index) also catches files
  // that opted in via `'use server'` directive without the suffix.
  const byName = (url) => /\.server\.m?[jt]s$/.test(url);
  const byIndex = serverFiles
    ? (abs) => (serverFiles.has ? serverFiles.has(abs) : false)
    : () => false;

  // Add direct component URLs
  for (const url of componentUrls) {
    if (seen.has(url) || byName(url)) continue;
    seen.add(url);
    result.push(url);
  }

  // Add transitive deps from the module graph
  if (graph) {
    // Combine entry files + component files for graph lookup
    const allEntries = [...entryFiles];
    for (const url of componentUrls) {
      // Convert URL back to absolute path for graph lookup
      const abs = resolve(appDir, url.startsWith('/') ? url.slice(1) : url);
      allEntries.push(abs);
    }
    // Skip elidable components and any subtree reachable only through
    // them: their imports are stripped from served source, so the
    // browser never fetches these modules.
    const deps = transitiveDeps(graph, allEntries, appDir, elidableComponents);
    for (const dep of deps) {
      if (byIndex(dep)) continue;
      const url = toUrlPath(dep, appDir);
      if (seen.has(url) || byName(url)) continue;
      seen.add(url);
      result.push(url);
    }
  }

  return result;
}

/**
 * Collect the bare npm vendor specifiers the page's SHIPPED modules import
 * (#754). The walk ROOTS are the boot's actually-shipped module set: the caller
 * passes `entryFiles` = the absolute paths of `moduleUrls` (which already drops
 * inert page/layout modules and substitutes an import-only page with its
 * components), plus `componentUrls` = the rendered components. From those roots
 * it walks the transitive app-graph closure (elidable components and the subtree
 * reachable only through them excluded), and collects each reached file's bare
 * imports, excluding server files. The specifiers are resolved to `modulepreload`
 * targets via the vendor importmap; a specifier not in the map (unpinned /
 * unreached) drops out there.
 *
 * Because the roots are the SHIPPED set, a vendor reached ONLY through a module
 * dropped from the boot, whether a dropped page's SSR-only DIRECT vendor import
 * or its SSR-only RELATIVE HELPER's vendor, is never collected: the dropped
 * module is not a root, and nothing that ships imports it (pages/layouts are not
 * importable). So the canonical SSR-only-dependency pattern (which elision keeps
 * off the client) is never preloaded (no over-fetch).
 *
 * @param {import('./module-graph.js').ModuleGraph | undefined} graph
 * @param {string[]} entryFiles  absolute paths of the SHIPPED page/layout modules (from `moduleUrls`)
 * @param {string[]} componentUrls  rendered eager component URL paths
 * @param {string} appDir
 * @param {Set<string>} [elidableComponents]
 * @param {Set<string>} [serverFiles]  the action / server-file index (`'use server'`, incl. no-`.server.` files)
 * @returns {Set<string>}
 */
function reachedVendorSpecifiers(graph, entryFiles, componentUrls, appDir, elidableComponents, serverFiles) {
  /** @type {Set<string>} */
  const specs = new Set();
  if (!graph) return specs;
  const bare = bareImports(graph);
  if (!bare.size) return specs;
  // Roots = the SHIPPED page/layout modules (already inert-dropped + import-only
  // expanded by the caller) + the rendered components, keyed by the graph's own
  // absolute paths. Walk their non-elided transitive closure.
  const allEntries = [...entryFiles];
  for (const url of componentUrls) {
    allEntries.push(resolve(appDir, url.startsWith('/') ? url.slice(1) : url));
  }
  const files = new Set(allEntries);
  for (const dep of transitiveDeps(graph, allEntries, appDir, elidableComponents)) files.add(dep);
  for (const file of files) {
    // A server file is never served to the browser (its source is an RPC /
    // throw-at-load stub), so a vendor it imports never ships and must NOT be
    // preloaded. `transitiveDeps` stops AT a server-file boundary but still
    // returns the boundary file itself, so filter it: the `.server.*` suffix
    // AND the action index (a `'use server'` file without the suffix), matching
    // `deduplicatedPreloads`' `byIndex` filter.
    if (/\.server\.m?[jt]s$/.test(file)) continue;
    if (serverFiles && serverFiles.has && serverFiles.has(file)) continue;
    const fileBare = bare.get(file);
    if (fileBare) for (const spec of fileBare) specs.add(spec);
  }
  return specs;
}

function getNonce(req) {
  const n = cspNonce();
  if (n) return n;
  const h = req.headers.get('x-webjs-csp-nonce');
  if (h) return h;
  return undefined;
}

function cachedHtmlResponse(rec, req, url) {
  const headers = new Headers({ 'content-type': rec.contentType || 'text/html; charset=utf-8' });
  headers.set('cache-control', rec.cacheControl || 'no-store');
  headers.set('x-webjs-build', publishedBuildId());
  headers.set('x-webjs-src', appSourceId());
  headers.set(BUFFERED_MARKER, '1');
  return new Response(rec.body || rec, { status: rec.status || 200, headers });
}

/**
 * Build an HTML Response. Sets no cookie: action CSRF is an Origin /
 * Sec-Fetch-Site check, so the page response is cookieless (CDN-cacheable).
 * @param {string} html
 * @param {number} status
 * @param {Request | undefined} req
 * @param {URL | undefined} url
 * @param {Record<string, any>} [metadata]
 */
function htmlResponse(html, status, req, url, metadata) {
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
  // Default: no caching. Pages are dynamic by default: the developer opts in
  // explicitly via metadata.cacheControl. No non-200 guard here, unlike
  // streamingHtmlResponse: every caller of THIS builder passes no metadata, so
  // the value is already the no-store default and a guard would be dead code.
  headers.set('cache-control', metadata?.cacheControl || 'no-store');
  // X-Webjs-Build carries the published build id so the client
  // router can detect post-deploy importmap changes on EVERY
  // response, including the X-Webjs-Have partial responses that
  // omit the head entirely. Empty until the map is authoritatively
  // final, so a warming response is reload-safe. See router-client.js
  // applySwap and publishedBuildId() in importmap.js.
  headers.set('x-webjs-build', publishedBuildId());
  headers.set('x-webjs-src', appSourceId());
  // Buffered (string) body: opt into the conditional-GET funnel.
  // A cacheable page (metadata.cacheControl) gets a weak ETag + 304. The
  // funnel excludes only the no-store default; a `private` page IS validated,
  // which is what keeps the router's partial responses cheap (#1140).
  // See conditional-get.js.
  headers.set(BUFFERED_MARKER, '1');
  return new Response(html, { status, headers });
}

/**
 * Build a streaming Response. Degrades to a single-flush response when
 * there are no pending Suspense boundaries.
 *
 * @param {string} prefix
 * @param {string} bodyHtml
 * @param {string} closer
 * @param {{ pending: {id: string, promise: Promise<unknown>}[], nextId: number }} ctx
 * @param {number} status
 * @param {Request | undefined} req
 * @param {URL | undefined} url
 * @param {Record<string, any>} [metadata]
 * @param {string} [nonce]
 * @param {boolean} [dev]  dev surfaces a streamed-boundary error message; prod stays silent
 */
function streamingHtmlResponse(prefix, bodyHtml, closer, ctx, status, req, url, metadata, nonce, dev) {
  const encoder = new TextEncoder();
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
  // Default: no caching. Pages are dynamic by default: the developer
  // opts in to caching explicitly via metadata.cacheControl. A non-200 does
  // NOT inherit it (#1140): the form-action re-render is a 422 carrying the
  // submitter's own field values and errors, which must never be handed to a
  // shared cache just because the page opted into public caching.
  headers.set('cache-control', status === 200 ? (metadata?.cacheControl || 'no-store') : 'no-store');
  // See htmlResponse: published build id on every response for the
  // client router's importmap-mismatch detection on partial swaps.
  headers.set('x-webjs-build', publishedBuildId());
  headers.set('x-webjs-src', appSourceId());

  if (!ctx.pending.length) {
    // No pending boundaries: this degrades to a single buffered (string)
    // flush, so opt it into the conditional-GET funnel like htmlResponse.
    headers.set(BUFFERED_MARKER, '1');
    return new Response(prefix + bodyHtml + closer, { status, headers });
  }

  // Flag a genuinely streamed body so the conditional-GET funnel skips it
  // (an unflushed stream cannot be hashed without buffering, which would
  // defeat streaming). The marker is internal and stripped at the funnel
  // before the response reaches the client. See conditional-get.js.
  headers.set(STREAM_MARKER, '1');

  const stream = new ReadableStream({
    async start(controller) {
      // Flush the shell (prefix + body with fallbacks) immediately, followed by
      // a shell-ready sentinel comment IN THE SAME chunk. The resolved boundary
      // templates and the `</body></html>` closer are emitted LATER (after the
      // slow data settles), so without this sentinel a streaming soft-nav client
      // could not tell "shell complete, awaiting the slow boundary" from "shell
      // still arriving" and would block its progressive swap until the slow
      // boundary (#473). The comment is inert for the native initial-load parse.
      controller.enqueue(encoder.encode(prefix + bodyHtml + '<!--wj-stream-shell-->'));
      try {
        // Loop: resolve all currently-pending promises in parallel; nested
        // Suspense inside resolved content adds more pending entries.
        while (ctx.pending.length) {
          const batch = ctx.pending.slice();
          ctx.pending.length = 0;
          const settled = await Promise.all(
            batch.map(async (p) => {
              try {
                const resolved = await p.promise;
                const sub = { pending: [], nextId: ctx.nextId, dev: ctx.dev };
                // A fresh scan that cannot see the shell the boundary sits in.
                // That used to require carrying the boundary's form scope
                // (#1207), or a `<button formaction=${fn}>` inside a bound
                // form's boundary read as form-less, was refused, and the catch
                // below turned it into an empty boundary on a 200 in
                // production. #1307 made a bound submitter self-sufficient, so
                // there is nothing left to carry.
                const html = await renderToString(resolved, { ssr: true, suspenseCtx: sub });
                ctx.nextId = sub.nextId;
                for (const n of sub.pending) ctx.pending.push(n);
                return { id: p.id, html };
              } catch (e) {
                // Match the SSR error-isolation policy (render-server.js's
                // defaultSSRErrorTemplate): dev surfaces the message so the
                // failure is obvious, prod stays SILENT so no internal detail
                // (a DB error, a stack-derived path) leaks to the client (#478).
                const msg = e instanceof Error ? e.message : String(e);
                const html = dev ? `<p>error: ${escapeHtml(msg)}</p>` : '';
                return { id: p.id, html };
              }
            })
          );
          for (const r of settled) {
            // Emit just the <template>: the MutationObserver-based resolver
            // in the boot script detects it and swaps it into the placeholder.
            // Falls back to the __webjsResolve global for browsers without MO.
            // The fallback <script> carries the request's CSP nonce so
            // strict-CSP enforcement passes. Browsers that support
            // MutationObserver (all evergreen) handle the swap via the
            // boot script's observer and skip this fallback; the
            // <script> is here for legacy / extremely-restrictive
            // environments. Either way it must be nonce-signed.
            const scriptNonce = nonce ? ` nonce="${escapeAttr(nonce)}"` : '';
            const chunk =
              `<template data-webjs-resolve="${r.id}">${r.html}</template>` +
              `<script${scriptNonce}>window.__webjsResolve&&__webjsResolve("${r.id}")</script>`;
            controller.enqueue(encoder.encode(chunk));
          }
        }
      } finally {
        controller.enqueue(encoder.encode(closer));
        controller.close();
      }
    },
  });
  return new Response(stream, { status, headers });
}

/**
 * @param {import('./router.js').PageRoute} route
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

function wrapHead(opts) {
  const bp = basePath();
  const n = opts.nonce ? ` nonce="${escapeAttr(opts.nonce)}"` : '';
  const preconnects = vendorPreconnectOrigins()
    .map((o) => `<link rel="preconnect" href="${escapeAttr(o)}" crossorigin>`)
    .join('\n');
  const importMap = buildImportMap(bp);
  const importMapTagStr = importMap ? importMapTag(bp, opts.nonce) : '';

  const fp = (url) => withAssetHash(withBasePath(url, bp), bp);

  const preloads = (opts.preloads || [])
    .map((u) => `<link rel="modulepreload" href="${escapeAttr(fp(u))}">`)
    .join('\n');
  const vendorPreloads = (opts.vendorPreloads || [])
    .map((t) => `<link rel="modulepreload" href="${escapeAttr(t.href)}"${preloadCrossOriginAttr(t.href)}${integrityAttr(t.href)}>`)
    .join('\n');

  const moduleUrls = _clientRouterEnabled ? opts.moduleUrls || [] : [];
  const imports = moduleUrls
    .map((u) => `import '${escapeAttr(fp(u))}';`)
    .join('\n');

  const rawLazyEntries = opts.lazyComponents;
  const lazyEntries = rawLazyEntries
    ? Object.fromEntries(
        Object.entries(rawLazyEntries).map(([tag, u]) => [tag, fp(u)]),
      )
    : rawLazyEntries;
  const lazyBoot = lazyEntries
    ? `\nimport { observeLazy } from '@webjsdev/core/lazy-loader';\nobserveLazy(${jsonForScriptTag(lazyEntries)});`
    : '';
  const boot = (imports || lazyBoot) ? `<script type="module"${n}>\n${imports}${lazyBoot}\n</script>` : '';
  const reload = opts.dev
    ? `<script type="module"${n} src="${escapeAttr(withBasePath('/__webjs/reload.js', bp))}"></script>`
    : '';
  const suspenseBoot = opts.streaming
    ? `<script${n}>(function(){` +
      `function r(id){var t=document.querySelector('template[data-webjs-resolve="'+id+'"]');` +
      `var b=document.getElementById(id);if(t&&b){b.replaceWith(t.content.cloneNode(true));t.remove();}}` +
      `window.__webjsResolve=r;` +
      `if(typeof MutationObserver!=='undefined'){` +
      `new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){` +
      `if(n.nodeType===1&&n.tagName==='TEMPLATE'&&n.dataset.webjsResolve){r(n.dataset.webjsResolve);}` +
      `});});}).observe(document.documentElement,{childList:true,subtree:true});}` +
      `})()</script>`
    : '';

  const m = opts.metadata || {};
  const metaTags = [];
  const linkTags = [];
  const scriptTags = [];

  const base = typeof m.metadataBase === 'string' ? m.metadataBase : '';
  const absUrl = (v) => {
    const s = String(v);
    if (!base) return s;
    if (/^https?:\/\//i.test(s) || s.startsWith('//') || s.startsWith('data:')) return s;
    try {
      return new URL(s, base).toString();
    } catch {
      return s;
    }
  };

  if (m.description) metaTags.push(`<meta name="description" content="${escapeAttr(m.description)}">`);

  let viewportStr = '';
  if (typeof m.viewport === 'string') {
    viewportStr = m.viewport;
  } else if (m.viewport && typeof m.viewport === 'object') {
    viewportStr = serializeViewport(m.viewport);
  } else if (m._viewport && typeof m._viewport === 'object') {
    viewportStr = serializeViewport(m._viewport);
  }
  metaTags.push(`<meta name="viewport" content="${escapeAttr(viewportStr || 'width=device-width,initial-scale=1')}">`);

  if (m.themeColor) metaTags.push(`<meta name="theme-color" content="${escapeAttr(m.themeColor)}">`);
  if (m.colorScheme) metaTags.push(`<meta name="color-scheme" content="${escapeAttr(m.colorScheme)}">`);

  if (m.robots) {
    if (typeof m.robots === 'string') {
      metaTags.push(`<meta name="robots" content="${escapeAttr(m.robots)}">`);
    } else if (typeof m.robots === 'object') {
      const parts = [];
      if (m.robots.index === false) parts.push('noindex');
      else if (m.robots.index === true) parts.push('index');
      if (m.robots.follow === false) parts.push('nofollow');
      else if (m.robots.follow === true) parts.push('follow');
      if (m.robots.noarchive) parts.push('noarchive');
      if (m.robots.nosnippet) parts.push('nosnippet');
      if (m.robots.noimageindex) parts.push('noimageindex');
      if (parts.length) {
        metaTags.push(`<meta name="robots" content="${escapeAttr(parts.join(', '))}">`);
      }
      if (typeof m.robots.googleBot === 'string') {
        metaTags.push(`<meta name="googlebot" content="${escapeAttr(m.robots.googleBot)}">`);
      }
    }
  }

  if (m.keywords) {
    const kws = Array.isArray(m.keywords) ? m.keywords.join(', ') : String(m.keywords);
    if (kws) metaTags.push(`<meta name="keywords" content="${escapeAttr(kws)}">`);
  }

  if (m.authors) {
    const list = Array.isArray(m.authors) ? m.authors : [m.authors];
    for (const a of list) {
      if (!a) continue;
      const name = typeof a === 'string' ? a : a.name;
      if (!name) continue;
      metaTags.push(`<meta name="author" content="${escapeAttr(name)}">`);
      if (typeof a === 'object' && a.url) {
        linkTags.push(`<link rel="author" href="${escapeAttr(absUrl(a.url))}">`);
      }
    }
  }

  for (const [field, metaName] of [
    ['creator', 'creator'],
    ['publisher', 'publisher'],
    ['applicationName', 'application-name'],
    ['generator', 'generator'],
    ['referrer', 'referrer'],
  ]) {
    if (m[field]) {
      metaTags.push(`<meta name="${metaName}" content="${escapeAttr(String(m[field]))}">`);
    }
  }

  if (m.appleWebApp && typeof m.appleWebApp === 'object') {
    if (m.appleWebApp.capable !== undefined) {
      metaTags.push(
        `<meta name="apple-mobile-web-app-capable" content="${m.appleWebApp.capable ? 'yes' : 'no'}">`,
      );
    }
    if (m.appleWebApp.title) {
      metaTags.push(`<meta name="apple-mobile-web-app-title" content="${escapeAttr(m.appleWebApp.title)}">`);
    }
    if (m.appleWebApp.statusBarStyle) {
      metaTags.push(
        `<meta name="apple-mobile-web-app-status-bar-style" content="${escapeAttr(m.appleWebApp.statusBarStyle)}">`,
      );
    }
    if (m.appleWebApp.startupImage) {
      const list = Array.isArray(m.appleWebApp.startupImage)
        ? m.appleWebApp.startupImage
        : [m.appleWebApp.startupImage];
      for (const it of list) {
        if (typeof it === 'string') {
          linkTags.push(`<link rel="apple-touch-startup-image" href="${escapeAttr(absUrl(it))}">`);
        } else if (it && it.url) {
          const parts = [`rel="apple-touch-startup-image"`, `href="${escapeAttr(absUrl(it.url))}"`];
          if (it.media) parts.push(`media="${escapeAttr(it.media)}"`);
          linkTags.push(`<link ${parts.join(' ')}>`);
        }
      }
    }
  } else if (m.appleWebApp === true) {
    metaTags.push(`<meta name="apple-mobile-web-app-capable" content="yes">`);
  }

  if (m.formatDetection && typeof m.formatDetection === 'object') {
    const parts = [];
    for (const [k, v] of Object.entries(m.formatDetection)) {
      if (v === false) parts.push(`${k}=no`);
      else if (v === true) parts.push(`${k}=yes`);
    }
    if (parts.length) {
      metaTags.push(`<meta name="format-detection" content="${escapeAttr(parts.join(', '))}">`);
    }
  }

  if (m.itunes && typeof m.itunes === 'object' && m.itunes.appId) {
    let content = `app-id=${m.itunes.appId}`;
    if (m.itunes.appArgument) content += `, app-argument=${m.itunes.appArgument}`;
    metaTags.push(`<meta name="apple-itunes-app" content="${escapeAttr(content)}">`);
  }

  for (const [field, metaName] of [
    ['category', 'category'],
    ['classification', 'classification'],
    ['abstract', 'abstract'],
  ]) {
    if (m[field]) metaTags.push(`<meta name="${metaName}" content="${escapeAttr(String(m[field]))}">`);
  }

  const noncePreload = opts.nonce ? ` nonce="${escapeAttr(opts.nonce)}"` : '';
  for (const url of opts.moduleUrls || []) {
    linkTags.push(
      `<link rel="modulepreload" href="${escapeAttr(fp(url))}"` +
      `${preloadCrossOriginAttr(url)}${integrityAttr(url)}${noncePreload}>`,
    );
  }
  for (const url of opts.preloads || []) {
    linkTags.push(
      `<link rel="modulepreload" href="${escapeAttr(fp(url))}"` +
      `${preloadCrossOriginAttr(url)}${integrityAttr(url)}${noncePreload}>`,
    );
  }
  const emittedPreloadHrefs = new Set([
    ...(opts.moduleUrls || []).map((u) => fp(u)),
    ...(opts.preloads || []).map((u) => fp(u)),
  ]);
  for (const v of opts.vendorPreloads || []) {
    if (emittedPreloadHrefs.has(v.href)) continue;
    emittedPreloadHrefs.add(v.href);
    const integrity = v.integrity ? ` integrity="${escapeAttr(v.integrity)}"` : '';
    linkTags.push(
      `<link rel="modulepreload" href="${escapeAttr(v.href)}"` +
      `${preloadCrossOriginAttr(v.href)}${integrity}${noncePreload}>`,
    );
  }

  if (m.jsonLd) {
    const list = Array.isArray(m.jsonLd) ? m.jsonLd : [m.jsonLd];
    for (const item of list) {
      const tag = jsonLdScript(item);
      if (tag) scriptTags.push(tag);
    }
  }

  const title = m.title ? `<title>${escapeHtml(m.title)}</title>` : '<title>App</title>';

  const hostStyle = `<style${n}>@layer webjs-host{:where([data-wj-host]){display:block}:where([data-wj-host][hidden]:not([hidden='until-found'])){display:none}}</style>`;
  const envShim = publicEnvShim(opts);

  return (
    `<!doctype html>\n<html lang="en">\n<head>\n` +
    `<meta charset="utf-8">\n` +
    `${hostStyle}\n` +
    `${title}\n` +
    (metaTags.length ? metaTags.join('\n') + '\n' : '') +
    (linkTags.length ? linkTags.join('\n') + '\n' : '') +
    (preconnects ? preconnects + '\n' : '') +
    (vendorPreloads ? vendorPreloads + '\n' : '') +
    (preloads ? preloads + '\n' : '') +
    (importMapTagStr ? importMapTagStr + '\n' : '') +
    `${envShim}\n` +
    (boot ? boot + '\n' : '') +
    (reload ? reload + '\n' : '') +
    (suspenseBoot ? suspenseBoot + '\n' : '') +
    (scriptTags.length ? scriptTags.join('\n') + '\n' : '') +
    `</head>\n<body>\n`
  );
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

async function renderChain(route, ctx, dev, suspenseCtx, have, pageModule) {
  const page = pageModule || await loadModule(route.file, dev);
  if (!page.default) throw new Error(`Page ${route.file} must have a default export`);
  let tree = await page.default(ctx);

  if (route.loadings && route.loadings.length > 0) {
    const loadingFile = route.loadings[route.loadings.length - 1];
    try {
      const loadingMod = await loadModule(loadingFile, dev);
      if (loadingMod.default) {
        const { Suspense } = await import('@webjsdev/core');
        const fallback = await loadingMod.default(ctx);
        tree = Suspense({ fallback, children: Promise.resolve(tree) });
      }
    } catch { /* loading file failed: skip */ }
  }

  const params = { ...(/** @type {Record<string,string>} */ (ctx.params) || {}) };
  const pageSeg = pageSegmentPath(route.file);
  const innermostLayoutSeg = route.layouts && route.layouts.length
    ? layoutSegmentPath(route.layouts[route.layouts.length - 1])
    : null;
  if (pageSeg !== innermostLayoutSeg) {
    tree = wrapWithChildrenMarker(tree, pageSeg, params);
  }

  for (let i = route.layouts.length - 1; i >= 0; i--) {
    const segmentPath = layoutSegmentPath(route.layouts[i]);
    if (have && have.get(segmentPath) === regionRouteKey(segmentPath, params)) {
      tree = wrapWithChildrenMarker(tree, segmentPath, params);
      const body = await renderToString(tree, { ssr: true, suspenseCtx });
      return { html: body + (await loadingTemplates(route, ctx, dev)), reduced: true };
    }
    const mod = await loadModule(route.layouts[i], dev);
    if (!mod.default) continue;
    tree = await mod.default({
      ...ctx,
      children: wrapWithChildrenMarker(tree, segmentPath, params),
    });
  }
  const body = await renderToString(tree, { ssr: true, suspenseCtx });
  return { html: body + (await loadingTemplates(route, ctx, dev)), reduced: false };
}

async function ssrBoundaryHtml(file, defaultTitle, opts) {
  if (file) {
    try {
      const mod = await loadModule(file, opts.dev);
      if (mod.default) {
        const tree = await mod.default({});
        const body = await renderToString(tree, { ssr: true, dev: opts.dev });
        return wrapInDocument(body, { metadata: { title: defaultTitle }, moduleUrls: [], dev: opts.dev, nonce: opts.req ? getNonce(opts.req) : undefined });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.stack || err.message : String(err);
      const body = `<h1>${escapeHtml(defaultTitle)}</h1><pre style="white-space:pre-wrap">${escapeHtml(msg)}</pre>`;
      return wrapInDocument(body, { metadata: { title: defaultTitle }, moduleUrls: [], dev: opts?.dev, nonce: opts?.req ? getNonce(opts.req) : undefined });
    }
  }
  return wrapInDocument(`<h1>${escapeHtml(defaultTitle)}</h1>`, { metadata: { title: defaultTitle }, moduleUrls: [], dev: opts.dev, nonce: opts.req ? getNonce(opts.req) : undefined });
}

async function ssrNotFoundHtml(notFoundFile, opts) {
  return ssrBoundaryHtml(notFoundFile, '404: Not found', opts);
}

export async function ssrPage(route, params, url, opts) {
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
          if (opts.dev) cached.headers.set('X-Webjs-Seed', 'html-cache');
          return cached;
        }
      }
    } catch {
      // ignore
    }
  }

  const ctx = {
    params: makeThenable(params),
    searchParams: makeThenable(Object.fromEntries(url.searchParams.entries())),
    url: url.toString(),
    actionData: opts.actionData,
  };

  const metadata = await collectMetadata(route, ctx, opts.dev);

  try {
    const suspenseCtx = { pending: [], nextId: 1, usedComponents: new Set(), dev: opts.dev };
    const haveHeader = opts.req?.headers.get('x-webjs-have') || '';
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

    const frameId = requestedFrameId(opts.req);
    if (frameId && suspenseCtx.pending.length === 0) {
      const subtree = extractFrameSubtree(body, frameId);
      if (subtree !== null) {
        const frameRes = htmlResponse(subtree, opts.status || 200, opts.req, url);
        frameRes.headers.append('vary', 'X-Webjs-Frame');
        if (reduced) frameRes.headers.append('vary', 'X-Webjs-Have');
        return frameRes;
      }
    }

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

    if (opts.instrumentationClient) {
      const u = toUrlPath(opts.instrumentationClient, opts.appDir);
      const i = moduleUrls.indexOf(u);
      if (i !== -1) moduleUrls.splice(i, 1);
      moduleUrls.unshift(u);
    }

    const { eager: eagerComponents, lazy: lazyComponents } =
      componentPreloads(suspenseCtx.usedComponents, opts.appDir, opts.elidableComponents);
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
    const { prefix, streamBody, closer } = buildDocumentParts(body, wrapOpts);
    let outBody = streamBody;
    let seedHeader = 'off';
    const streamed = suspenseCtx.pending.length > 0;
    if (seedCollector && streamed) {
      seedHeader = `collected=${seedCollector.size}, emitted=0, streamed`;
      if (opts.dev) {
        const marker = await buildSeedScript(null, { dev: true, reason: 'streamed' });
        if (marker) outBody = streamBody + marker;
      }
    } else if (seedCollector) {
      const seedScript = await buildSeedScript(seedCollector, { dev: opts.dev });
      if (seedScript) outBody = streamBody + seedScript;
      const dropped = seedScript === SEED_DROP_BLOCK;
      seedHeader = `collected=${seedCollector.size}, emitted=${seedScript && !dropped ? seedCollector.size : 0}`;
    }
    const res = streamingHtmlResponse(
      prefix,
      outBody,
      closer,
      suspenseCtx,
      opts.status || 200,
      opts.req,
      url,
      metadata,
      nonce,
      opts.dev,
    );
    if (opts.dev) res.headers.set('X-Webjs-Seed', seedHeader);
    if (reduced) {
      res.headers.append('vary', 'X-Webjs-Have');
      privateFragment(res);
    }
    if (revalidateSeconds !== null && !opts.cspEnabled) {
      res.headers.set(HTML_CACHE_MARKER, String(revalidateSeconds));
    }
    return res;
  } catch (err) {
    if (isRedirect(err)) {
      const e = /** @type any */ (err);
      return new Response(null, { status: e.status || 302, headers: { location: e.url } });
    }
    if (isNotFound(err)) {
      const html = await ssrNotFoundHtml(nearest(route.notFounds) || opts.globalNotFound || null, opts);
      return htmlResponse(html, 404, opts.req, url, metadata);
    }
    if (isForbidden(err)) return ssrForbidden(route, { ...opts, url });
    if (isUnauthorized(err)) return ssrUnauthorized(route, { ...opts, url });
    if (typeof opts.onError === 'function') {
      try { opts.onError(err); } catch { /* ignore */ }
    }
    if (typeof opts.onDevError === 'function') {
      try { opts.onDevError(err); } catch { /* ignore */ }
    }
    const errNonce = opts.req ? getNonce(opts.req) : undefined;
    for (let i = route.errors.length - 1; i >= 0; i--) {
      try {
        const mod = await loadModule(route.errors[i], opts.dev);
        if (!mod.default) continue;
        const tree = await mod.default({ ...ctx, error: err });
        const body = await renderToString(tree, { ssr: true, dev: opts.dev });
        const errModuleUrls = [];
        {
          const seen = new Set();
          const push = (abs) => {
            const u = toUrlPath(abs, opts.appDir);
            if (!seen.has(u)) { seen.add(u); errModuleUrls.push(u); }
          };
          for (const f of [route.file, ...route.layouts]) {
            if (opts.inertRouteModules && opts.inertRouteModules.has(f)) continue;
            const emit = opts.importOnlyRouteModules && opts.importOnlyRouteModules.get(f);
            if (emit) emit.forEach(push);
            else push(f);
          }
        }
        const html = wrapInDocument(body, { metadata, moduleUrls: errModuleUrls, dev: opts.dev, nonce: errNonce });
        return htmlResponse(html, 500, opts.req, url, metadata);
      } catch (nested) {
        // fall through
      }
    }
    if (opts.globalError) {
      try {
        const mod = await loadModule(opts.globalError, opts.dev);
        if (mod.default) {
          const tree = await mod.default({ error: err });
          const body = await renderToString(tree, { ssr: true, dev: opts.dev });
          return htmlResponse(body, 500, opts.req, url);
        }
      } catch (nested) {
        // fall through
      }
    }
    console.error('[webjs] unhandled render error:', err);
    const body = opts.dev
      ? `<h1>Server error</h1><pre style="white-space:pre-wrap">${escapeHtml(
          err instanceof Error ? err.stack || err.message : String(err)
        )}</pre>`
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
 * @param {{ dev: boolean, appDir: string, req?: Request, url?: URL }} opts
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
 * @param {{ dev: boolean, appDir: string, req?: Request, url?: URL }} opts
 */
export async function ssrForbidden(route, opts) {
  const html = await ssrBoundaryHtml(nearest(route.forbiddens), '403: Forbidden', opts);
  return htmlResponse(html, 403, opts.req, opts.url);
}

/**
 * 401 response for a thrown unauthorized() (#848). Renders the nearest
 * unauthorized.{js,ts} in the page's chain, else a default 401 page.
 * @param {{ unauthorizeds?: string[] }} route
 * @param {{ dev: boolean, appDir: string, req?: Request, url?: URL }} opts
 */
export async function ssrUnauthorized(route, opts) {
  const html = await ssrBoundaryHtml(nearest(route.unauthorizeds), '401: Unauthorized', opts);
  return htmlResponse(html, 401, opts.req, opts.url);
}
