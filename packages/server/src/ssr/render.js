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

let _clientRouterEnabled = true;

export function setClientRouterEnabled(enabled) {
  _clientRouterEnabled = enabled !== false;
}

export function clientRouterEnabled() {
  return _clientRouterEnabled;
}

export function privateFragment(res) {
  const cc = res.headers.get('cache-control') || '';
  if (!cc) {
    res.headers.set('cache-control', 'private');
    return;
  }
  const directives = [];
  let buf = '';
  let inQuotes = false;
  for (const ch of cc) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === ',' && !inQuotes) { directives.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  directives.push(buf.trim());

  const nameOf = (d) => d.split('=')[0].trim().toLowerCase();
  const isBare = (d) => !d.includes('=');
  if (directives.some((d) => nameOf(d) === 'no-store' || (nameOf(d) === 'private' && isBare(d)))) return;

  const SHARED_ONLY = new Set(['public', 's-maxage', 'proxy-revalidate', 'private']);
  const kept = directives.filter((d) => d && !SHARED_ONLY.has(nameOf(d)));
  kept.unshift('private');
  res.headers.set('cache-control', kept.join(', '));
}

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

function componentPreloads(usedTags, appDir, elidable) {
  const eager = [];
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

function deduplicatedPreloads(componentUrls, moduleUrls, graph, entryFiles, appDir, serverFiles, elidableComponents) {
  const seen = new Set(moduleUrls);
  const result = [];

  const byName = (url) => /\.server\.m?[jt]s$/.test(url);
  const byIndex = serverFiles
    ? (abs) => (serverFiles.has ? serverFiles.has(abs) : false)
    : () => false;

  for (const url of componentUrls) {
    if (seen.has(url) || byName(url)) continue;
    seen.add(url);
    result.push(url);
  }

  if (graph) {
    const allEntries = [...entryFiles];
    for (const url of componentUrls) {
      const abs = resolve(appDir, url.startsWith('/') ? url.slice(1) : url);
      allEntries.push(abs);
    }
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

function reachedVendorSpecifiers(graph, entryFiles, componentUrls, appDir, elidableComponents, serverFiles) {
  const specs = new Set();
  if (!graph) return specs;
  const bare = bareImports(graph);
  if (!bare.size) return specs;

  const allEntries = [...entryFiles];
  for (const url of componentUrls) {
    allEntries.push(resolve(appDir, url.startsWith('/') ? url.slice(1) : url));
  }
  const files = new Set(allEntries);
  for (const dep of transitiveDeps(graph, allEntries, appDir, elidableComponents)) files.add(dep);
  for (const file of files) {
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

function cachedHtmlResponse(body, req, url) {
  return htmlResponse(body, 200, req, url);
}

function htmlResponse(body, status, req, url) {
  const headers = { 'content-type': 'text/html; charset=utf-8', [BUFFERED_MARKER]: '1' };
  return new Response(body, { status, headers });
}

function streamingHtmlResponse(prefix, body, closer, suspenseCtx, status, req, url, metadata, nonce, dev) {
  const headers = { 'content-type': 'text/html; charset=utf-8', [STREAM_MARKER]: '1' };
  if (suspenseCtx.pending.length === 0) {
    return new Response(prefix + body + closer, { status, headers });
  }
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(prefix + body));
      for (const p of suspenseCtx.pending) {
        try {
          const resolved = await p.promise;
          const html = await renderToString(resolved, { ssr: true, dev });
          const tmpl = `<template data-webjs-resolve="${p.id}">${html}</template><script>window.__webjsResolve&&window.__webjsResolve(${p.id});</script>`;
          controller.enqueue(enc.encode(tmpl));
        } catch (e) {
          const tmpl = `<template data-webjs-resolve="${p.id}"><div>Error rendering component</div></template><script>window.__webjsResolve&&window.__webjsResolve(${p.id});</script>`;
          controller.enqueue(enc.encode(tmpl));
        }
      }
      controller.enqueue(enc.encode(closer));
      controller.close();
    },
  });
  return new Response(stream, { status, headers });
}

async function collectMetadata(route, ctx, dev) {
  let meta = {};
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
      let vp = null;
      if (typeof mod.generateViewport === 'function') {
        vp = await mod.generateViewport(ctx);
      } else if (mod.viewport) {
        vp = mod.viewport;
      }
      if (vp && typeof vp === 'object') {
        m = { ...(m || {}), _viewport: { ...(m && m._viewport), ...vp } };
        if (typeof vp.themeColor === 'string' && !(m && m.themeColor)) {
          m.themeColor = vp.themeColor;
        }
        if (typeof vp.colorScheme === 'string') m.colorScheme = vp.colorScheme;
      }
      if (!m || typeof m !== 'object') continue;
      const resolved = { ...m };
      if (m.title !== undefined) {
        const t = m.title;
        if (typeof t === 'string') {
          resolved.title = titleTemplate ? titleTemplate.replace('%s', t) : t;
        } else if (t && typeof t === 'object') {
          if (typeof t.template === 'string') titleTemplate = t.template;
          if (typeof t.absolute === 'string') {
            resolved.title = t.absolute;
          } else if (typeof t.default === 'string') {
            resolved.title = t.default;
          } else {
            delete resolved.title;
          }
        }
      }
      meta = { ...meta, ...resolved };
    } catch {
      // ignore
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

async function renderChain(route, ctx, dev, suspenseCtx, have, pageModule) {
  let curr = null;

  try {
    const pageMod = pageModule || (await loadModule(route.file, dev));
    if (!pageMod.default) throw new Error(`Page ${route.file} has no default export`);
    const pageTree = await pageMod.default(ctx);

    const pageSeg = pageSegmentPath(route.file);
    curr = wrapWithChildrenMarker(pageTree, pageSeg, ctx.params);

    for (let i = route.layouts.length - 1; i >= 0; i--) {
      const layoutFile = route.layouts[i];
      const seg = layoutSegmentPath(layoutFile);

      if (have) {
        const heldKey = have.get(seg);
        if (heldKey) {
          const currentKey = regionRouteKey(seg, ctx.params);
          if (heldKey === currentKey) {
            const html = await renderToString(curr, { ssr: true, dev, suspense: suspenseCtx });
            return { html, reduced: true };
          }
        }
      }

      const mod = await loadModule(layoutFile, dev);
      if (mod.default) {
        const layoutTree = await mod.default({ ...ctx, children: curr });
        curr = wrapWithChildrenMarker(layoutTree, seg, ctx.params);
      }
    }
  } catch (err) {
    throw err;
  }

  const html = await renderToString(curr, { ssr: true, dev, suspense: suspenseCtx });
  return { html, reduced: false };
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
    } catch {
      // ignore
    }
  }
  return wrapInDocument(`<h1>${escapeHtml(defaultTitle)}</h1>`, { metadata: { title: defaultTitle }, moduleUrls: [], dev: opts.dev, nonce: opts.req ? getNonce(opts.req) : undefined });
}

async function ssrNotFoundHtml(notFoundFile, opts) {
  return ssrBoundaryHtml(notFoundFile, '404: Not Found', opts);
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
      return htmlResponse(html, 404, opts.req, url);
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
        return htmlResponse(html, 500, opts.req, url);
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

export async function ssrNotFound(notFoundFile, opts) {
  const html = await ssrNotFoundHtml(notFoundFile, opts);
  return htmlResponse(html, 404, opts.req, opts.url);
}

export async function ssrForbidden(route, opts) {
  const html = await ssrBoundaryHtml(nearest(route.forbiddens), '403: Forbidden', opts);
  return htmlResponse(html, 403, opts.req, opts.url);
}

export async function ssrUnauthorized(route, opts) {
  const html = await ssrBoundaryHtml(nearest(route.unauthorizeds), '401: Unauthorized', opts);
  return htmlResponse(html, 401, opts.req, opts.url);
}
