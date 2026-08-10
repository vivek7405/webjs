import { basePath, buildImportMap, importMapTag, vendorPreconnectOrigins } from '../importmap.js';
import { withBasePath } from '../base-path.js';
import { withAssetHash } from '../asset-hash.js';
import { jsonForScriptTag } from '../script-tag-json.js';
import { vendorIntegrityFor } from '../importmap.js';
import { publicEnvShim } from './document.js';
import { clientRouterEnabled } from './render.js';

// Which icon metadata ROUTES the app has (`app/icon.*`, `app/apple-icon.*`).
// Set at boot and on each route rebuild from the route table, the same shape
// as setClientRouterEnabled, so no opt has to thread through every render
// path. Empty by default, which keeps an app that declares its icons (or has
// neither route) byte-identical.
//
// This sits in head.js rather than beside `_clientRouterEnabled` in render.js,
// where the pre-split file happened to put it: `wrapHead` is the only reader,
// and module state belongs with the code that uses and writes it.
/** @type {{ icon: boolean, apple: boolean }} */
let _metadataIconRoutes = { icon: false, apple: false };

/**
 * Record the icon metadata routes the app defines.
 *
 * @param {Iterable<{ stem: string }> | null | undefined} metadataRoutes
 *   The route table's `metadataRoutes`, or nullish to clear.
 */
export function setMetadataIconRoutes(metadataRoutes) {
  const stems = new Set();
  for (const r of metadataRoutes || []) if (r && r.stem) stems.add(r.stem);
  _metadataIconRoutes = { icon: stems.has('icon'), apple: stems.has('apple-icon') };
}

/**
 * The implicit `metadata.icons` an app's icon routes stand for, or null when
 * it has none. Base-path prefixed, because that is where the routes are
 * SERVED: the listener strips the base path before matching, so under
 * `webjs.basePath` the route answers at `<basePath>/icon`. A user-authored
 * `icons` URL is deliberately left alone (it may be cross-origin, and the
 * author writes the path they mean), so only these framework-emitted ones
 * are prefixed.
 *
 * No `type` or `sizes` is emitted. A metadata route picks its own content
 * type at request time, which is the reason to use one, so declaring a type
 * here could contradict the bytes; and `sizes` is unknowable without reading
 * the response. Both are optional in HTML, and a browser sniffs the served
 * content type.
 *
 * @returns {{ icon?: string, apple?: string } | null}
 */
function autoMetadataRouteIcons() {
  const { icon, apple } = _metadataIconRoutes;
  if (!icon && !apple) return null;
  const bp = basePath();
  /** @type {{ icon?: string, apple?: string }} */
  const out = {};
  if (icon) out.icon = withBasePath('/icon', bp);
  if (apple) out.apple = withBasePath('/apple-icon', bp);
  return out;
}

export function escapeJsonLd(str) {
  return String(str)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function jsonLdScript(obj) {
  if (!obj || typeof obj !== 'object') return '';
  try {
    const json = JSON.stringify(obj);
    if (typeof json !== 'string') return '';
    return `<script type="application/ld+json">${escapeJsonLd(json)}</script>`;
  } catch (err) {
    console.warn('[webjs] metadata.jsonLd: skipped an entry that could not be serialized:', err && err.message);
    return '';
  }
}

export const _escapeJsonLd = escapeJsonLd;
export const _jsonLdScript = jsonLdScript;

/**
 * Decide whether a `<link rel="modulepreload">` href needs a
 * `crossorigin="anonymous"` attribute. True for absolute URLs with
 * an http(s) scheme (vendor packages from jspm.io etc.); false for
 * same-origin paths like `/__webjs/core/index.js`. Browsers require
 * crossorigin on cross-origin module preload, else the preload is
 * wasted or double-fetched. Same-origin URLs must NOT have it for
 * the same reason in reverse.
 *
 * Exported for tests; production callers use it via documentParts.
 *
 * @param {string} url
 * @returns {string}  either ` crossorigin="anonymous"` or empty
 */
export function preloadCrossOriginAttr(url) {
  return /^https?:\/\//i.test(url) ? ' crossorigin="anonymous"' : '';
}

/**
 * Look up the SRI integrity hash for a vendor URL and format it as a
 * `integrity="sha384-..."` attribute. Empty string for URLs without a
 * known hash (framework files, user code, vendor URLs in live-API
 * mode without a pin file).
 *
 * @param {string} url
 * @returns {string}
 */
export function integrityAttr(url) {
  const hash = vendorIntegrityFor(url);
  // Belt and suspenders: readPinFile already validates the integrity
  // value end-to-end against /^sha(256|384|512)-[A-Za-z0-9+/=]+$/, so
  // a valid hash has no HTML-special chars and escapeAttr is a no-op.
  // But emission goes through the same attribute-injection-safe path
  // as everything else in the SSR pipeline so a future regression in
  // the validator doesn't bypass it.
  return hash ? ` integrity="${escapeAttr(hash)}"` : '';
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

/**
 * Strip leading head-bound tags (<script>, <style>, <link>) from a body
 * string. Returns the collected tags + the remaining body. Mirrors what
 * `hoistHeadTags` does but takes/returns plain strings (no head input)
 * so it can be used with a user-provided <head>.
 *
 * @param {string} bodyHtml
 * @returns {{ tags: string[], body: string }}
 */
export function collectHoistedHeadTags(bodyHtml) {
  const tags = [];
  // <script>…</script> and <style>…</style> are paired; <link …> and <meta …>
  // are void. A plain HTML comment (<!-- … -->) is consumed but NOT hoisted, so
  // a comment interleaved with head-bound tags (e.g. "<!-- Self-hosted fonts -->"
  // between a favicon <link> and the stylesheet <link>) does not terminate
  // the leading run and strand the stylesheet in <body>, which caused FOUC
  // because a <link rel="stylesheet"> in <body> is not reliably
  // render-blocking (#406). A <meta …> is treated the same way for the same
  // reason: a <meta name="color-scheme"> between the theme <script> and the
  // stylesheet <link> would otherwise terminate the run and strand the
  // stylesheet AND a <link rel="icon"> in <body> (a favicon in <body> is
  // ignored by browsers, so the icon silently never renders). The `(?!/?wj:)`
  // guard exempts client-router markers (<!--wj:children:…-->,
  // <!--/wj:children-->) so a layout that renders children directly after its
  // head tags still terminates the run there rather than swallowing the marker.
  // The void-tag matchers are QUOTE-AWARE ((?:[^>"']|"[^"]*"|'[^']*')*): a `>`
  // inside a quoted attribute value (a description meta like
  // content="Guides > API") must not terminate the tag early, which would hoist
  // a truncated tag, leak the remainder as visible body text, and strand the
  // stylesheet (the #406 FOUC this hoist exists to prevent).
  const re =
    /^\s*(<!--(?!\/?wj:)[\s\S]*?-->|<script[\s>][\s\S]*?<\/script>|<style[\s>][\s\S]*?<\/style>|<link\b(?:[^>"']|"[^"]*"|'[^']*')*>|<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>)/i;
  let remaining = bodyHtml;
  // `body` only advances to just-past the LAST hoisted head tag. Comments
  // are scanned through (so they don't terminate the run) but a comment that
  // trails the final head tag stays in the body rather than being dropped.
  let body = bodyHtml;
  let m;
  while ((m = re.exec(remaining)) !== null) {
    const token = m[1];
    remaining = remaining.slice(m[0].length);
    if (!token.startsWith('<!--')) {
      tags.push(token);
      body = remaining;
    }
  }
  return { tags, body };
}

export function hoistHeadTags(headHtml, bodyHtml) {
  const { tags: hoisted, body: remaining } = collectHoistedHeadTags(bodyHtml);
  if (!hoisted.length) return { head: headHtml, body: bodyHtml };
  const newHead = headHtml.replace('</head>', hoisted.join('\n') + '\n</head>');
  return { head: newHead, body: remaining };
}

export const _hoistHeadTags = hoistHeadTags;

/**
 * Serialize a Next.js-shaped viewport object into the comma-separated
 * `content` string the meta tag expects. Recognised fields:
 *   width, height, initialScale, minimumScale, maximumScale,
 *   userScalable, viewportFit, interactiveWidget.
 * Other fields (themeColor, colorScheme) live on their own meta tags
 * and are handled by the caller: skipped here.
 *
 * @param {Record<string, unknown>} v
 * @returns {string}
 */
export function serializeViewport(v) {
  const parts = [];
  /** @param {string} key @param {string} prop */
  const push = (key, prop) => {
    if (v[prop] !== undefined && v[prop] !== null && v[prop] !== '') {
      parts.push(`${key}=${v[prop]}`);
    }
  };
  push('width', 'width');
  push('height', 'height');
  push('initial-scale', 'initialScale');
  push('minimum-scale', 'minimumScale');
  push('maximum-scale', 'maximumScale');
  if (v.userScalable === false) parts.push('user-scalable=no');
  else if (v.userScalable === true) parts.push('user-scalable=yes');
  push('viewport-fit', 'viewportFit');
  push('interactive-widget', 'interactiveWidget');
  return parts.join(',');
}

export function wrapHead(opts) {
  const n = opts.nonce ? ` nonce="${escapeAttr(opts.nonce)}"` : '';
  const bp = basePath();
  const fp = (u) => withAssetHash(withBasePath(u, bp), bp);

  const moduleUrls = opts.moduleUrls || [];
  const imports = moduleUrls
    .map((u) => `import ${jsonForScriptTag(fp(u))};`)
    .join('\n');

  const rawLazyEntries = opts.lazyComponents && Object.keys(opts.lazyComponents).length
    ? opts.lazyComponents
    : null;
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

  for (const [field, rel] of [
    ['archives', 'archives'],
    ['assets', 'assets'],
    ['bookmarks', 'bookmark'],
  ]) {
    if (m[field]) {
      const list = Array.isArray(m[field]) ? m[field] : [m[field]];
      for (const href of list) {
        linkTags.push(`<link rel="${rel}" href="${escapeAttr(absUrl(href))}">`);
      }
    }
  }

  if (m.other && typeof m.other === 'object') {
    for (const [name, v] of Object.entries(m.other)) {
      const list = Array.isArray(v) ? v : [v];
      for (const item of list) {
        if (item == null) continue;
        metaTags.push(`<meta name="${escapeAttr(name)}" content="${escapeAttr(String(item))}">`);
      }
    }
  }

  if (m.verification && typeof m.verification === 'object') {
    const verifyKeys = {
      google: 'google-site-verification',
      yandex: 'yandex-verification',
      yahoo: 'y_key',
      me: 'me',
    };
    for (const [field, metaName] of Object.entries(verifyKeys)) {
      const v = m.verification[field];
      if (!v) continue;
      const list = Array.isArray(v) ? v : [v];
      for (const item of list) {
        metaTags.push(`<meta name="${metaName}" content="${escapeAttr(String(item))}">`);
      }
    }
    if (m.verification.other && typeof m.verification.other === 'object') {
      for (const [name, v] of Object.entries(m.verification.other)) {
        const list = Array.isArray(v) ? v : [v];
        for (const item of list) {
          metaTags.push(`<meta name="${escapeAttr(name)}" content="${escapeAttr(String(item))}">`);
        }
      }
    }
  }

  if (m.openGraph && typeof m.openGraph === 'object') {
    for (const [k, v] of Object.entries(m.openGraph)) {
      const out = k === 'image' || k === 'url' ? absUrl(v) : String(v);
      metaTags.push(`<meta property="og:${escapeAttr(k)}" content="${escapeAttr(out)}">`);
    }
  }

  if (m.twitter && typeof m.twitter === 'object') {
    for (const [k, v] of Object.entries(m.twitter)) {
      const out = k === 'image' ? absUrl(v) : String(v);
      metaTags.push(`<meta name="twitter:${escapeAttr(k)}" content="${escapeAttr(out)}">`);
    }
  }

  const declaredPreconnectOrigins = new Set();
  const normalizeHint = (h) => {
    if (!h) return null;
    if (typeof h === 'string') return { url: h };
    if (typeof h === 'object' && h.url) return h;
    return null;
  };
  const toHints = (value) => {
    if (value == null) return [];
    const list = Array.isArray(value) ? value : [value];
    const out = [];
    for (const h of list) {
      const n = normalizeHint(h);
      if (n) out.push(n);
    }
    return out;
  };
  const crossoriginAttr = (co) => {
    if (co === undefined || co === false) return '';
    if (co === true || co === '') return ' crossorigin';
    return ` crossorigin="${escapeAttr(String(co))}"`;
  };
  for (const h of toHints(m.preconnect)) {
    try { declaredPreconnectOrigins.add(new URL(h.url).origin); } catch { declaredPreconnectOrigins.add(h.url); }
    linkTags.push(`<link rel="preconnect" href="${escapeAttr(h.url)}"${crossoriginAttr(h.crossorigin)}>`);
  }
  for (const h of toHints(m.dnsPrefetch)) {
    linkTags.push(`<link rel="dns-prefetch" href="${escapeAttr(h.url)}">`);
  }
  for (const origin of vendorPreconnectOrigins()) {
    if (declaredPreconnectOrigins.has(origin)) continue;
    linkTags.push(`<link rel="preconnect" href="${escapeAttr(origin)}" crossorigin>`);
  }

  //
  // With no `icons` declared, an `app/icon.*` / `app/apple-icon.*` metadata
  // ROUTE is linked automatically (Next parity). Those routes served their
  // bytes and nothing referenced them before, so writing the file that every
  // other framework treats as "this is my favicon" produced a blank tab and no
  // diagnostic. A declared `icons` SUPPRESSES the routes rather than merging
  // with them, which is also what Next does: it merges static icon files only
  // when the resolved metadata has no `icons` of its own. Suppressing matters
  // here because the file is frequently a placeholder an app has outgrown, and
  // an author who names their icons has said which ones they want.
  const declaredOrRouteIcons = m.icons || autoMetadataRouteIcons();
  if (declaredOrRouteIcons) {
    const buckets = typeof declaredOrRouteIcons === 'string' || Array.isArray(declaredOrRouteIcons)
      ? { icon: declaredOrRouteIcons }
      : declaredOrRouteIcons;
    const pushIcon = (rel, entry) => {
      if (!entry) return;
      const items = Array.isArray(entry) ? entry : [entry];
      for (const it of items) {
        if (!it) continue;
        if (typeof it === 'string') {
          linkTags.push(`<link rel="${rel}" href="${escapeAttr(absUrl(it))}">`);
        } else if (typeof it === 'object' && it.url) {
          const parts = [`rel="${rel}"`, `href="${escapeAttr(absUrl(it.url))}"`];
          if (it.sizes) parts.push(`sizes="${escapeAttr(it.sizes)}"`);
          if (it.type) parts.push(`type="${escapeAttr(it.type)}"`);
          linkTags.push(`<link ${parts.join(' ')}>`);
        }
      }
    };
    pushIcon('icon', buckets.icon);
    pushIcon('apple-touch-icon', buckets.apple);
    pushIcon('shortcut icon', buckets.shortcut);
    if (buckets.other) {
      const others = Array.isArray(buckets.other) ? buckets.other : [buckets.other];
      for (const o of others) {
        if (!o || !o.rel || !o.url) continue;
        const parts = [`rel="${escapeAttr(o.rel)}"`, `href="${escapeAttr(absUrl(o.url))}"`];
        if (o.sizes) parts.push(`sizes="${escapeAttr(o.sizes)}"`);
        if (o.type) parts.push(`type="${escapeAttr(o.type)}"`);
        linkTags.push(`<link ${parts.join(' ')}>`);
      }
    }
  }

  if (typeof m.manifest === 'string') {
    linkTags.push(`<link rel="manifest" href="${escapeAttr(absUrl(m.manifest))}">`);
  }

  if (m.alternates && typeof m.alternates === 'object') {
    if (m.alternates.canonical) {
      linkTags.push(`<link rel="canonical" href="${escapeAttr(absUrl(m.alternates.canonical))}">`);
    }
    if (m.alternates.languages && typeof m.alternates.languages === 'object') {
      for (const [hreflang, href] of Object.entries(m.alternates.languages)) {
        linkTags.push(
          `<link rel="alternate" hreflang="${escapeAttr(hreflang)}" href="${escapeAttr(absUrl(href))}">`,
        );
      }
    }
    if (m.alternates.media && typeof m.alternates.media === 'object') {
      for (const [media, href] of Object.entries(m.alternates.media)) {
        linkTags.push(
          `<link rel="alternate" media="${escapeAttr(media)}" href="${escapeAttr(absUrl(href))}">`,
        );
      }
    }
    if (m.alternates.types && typeof m.alternates.types === 'object') {
      for (const [type, href] of Object.entries(m.alternates.types)) {
        linkTags.push(
          `<link rel="alternate" type="${escapeAttr(type)}" href="${escapeAttr(absUrl(href))}">`,
        );
      }
    }
  }

  if (m.jsonLd != null) {
    const list = Array.isArray(m.jsonLd) ? m.jsonLd : [m.jsonLd];
    for (const obj of list) {
      const tag = jsonLdScript(obj);
      if (tag) scriptTags.push(tag);
    }
  }

  const noncePreload = opts.nonce ? ` nonce="${escapeAttr(opts.nonce)}"` : '';
  if (opts.moduleUrls.length || lazyEntries) {
    const coreMap = buildImportMap();
    const coreHref = coreMap.imports['@webjsdev/core'];
    if (coreHref) {
      const raw = coreMap.integrity ? coreMap.integrity[coreHref] : undefined;
      const coreIntegrity = raw ? ` integrity="${escapeAttr(raw)}"` : '';
      linkTags.push(
        `<link rel="modulepreload" href="${escapeAttr(coreHref)}"` +
        `${preloadCrossOriginAttr(coreHref)}${coreIntegrity}${noncePreload}>`,
      );
    }
  }

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

  if (Array.isArray(m.preload)) {
    for (const p of m.preload) {
      if (!p || !p.href) continue;
      const attrs = Object.entries(p)
        .map(([k, v]) => `${k}="${escapeAttr(String(v))}"`)
        .join(' ');
      linkTags.push(`<link rel="preload" ${attrs}>`);
    }
  }

  // Byte-identical to the pre-split template. Every hole is unconditional
  // and carries its own newline, INCLUDING the csp-nonce meta, which renders
  // as an EMPTY line when there is no nonce. Collapsing that into a
  // conditional line makes the CSP-off document one newline shorter than the
  // CSP-on one, and the framework guarantees the two render identically
  // apart from the nonce itself.
  const title = m.title || 'webjs app';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style${n}>@layer webjs-host{:where([data-wj-host]){display:block}:where([data-wj-host][hidden]:not([hidden='until-found'])){display:none}}</style>
${opts.nonce ? `<meta name="csp-nonce" content="${escapeAttr(opts.nonce)}">` : ''}
${metaTags.join('\n')}
<title>${escapeHtml(title)}</title>
${publicEnvShim({ dev: opts.dev, nonce: opts.nonce })}${clientRouterEnabled() ? '' : `\n<script${n}>window.__WEBJS_CLIENT_ROUTER__=false;</script>`}
${importMapTag({ nonce: opts.nonce })}
${linkTags.join('\n')}
${scriptTags.length ? scriptTags.join('\n') + '\n' : ''}${boot}
${reload}
${suspenseBoot}
</head>
<body>
`;
}
