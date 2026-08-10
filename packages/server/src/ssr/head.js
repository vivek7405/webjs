import { basePath, buildImportMap, importMapTag, vendorPreconnectOrigins } from '../importmap.js';
import { withBasePath } from '../base-path.js';
import { withAssetHash } from '../asset-hash.js';
import { jsonForScriptTag } from '../script-tag-json.js';
import { vendorIntegrityFor } from '../importmap.js';
import { publicEnvShim } from './document.js';
import { clientRouterEnabled } from './render.js';

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

export function preloadCrossOriginAttr(url) {
  return /^https?:\/\//i.test(url) ? ' crossorigin="anonymous"' : '';
}

export function integrityAttr(url) {
  const hash = vendorIntegrityFor(url);
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

export function collectHoistedHeadTags(bodyHtml) {
  const tags = [];
  const re =
    /^\s*(<!--(?!\/?wj:)[\s\S]*?-->|<script[\s>][\s\S]*?<\/script>|<style[\s>][\s\S]*?<\/style>|<link\b(?:[^>"']|"[^"]*"|'[^']*')*>|<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>)/i;
  let remaining = bodyHtml;
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

export function serializeViewport(v) {
  const parts = [];
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
    `${opts.nonce ? `<meta name="csp-nonce" content="${escapeAttr(opts.nonce)}">` : ''}\n` +
    (metaTags.length ? metaTags.join('\n') + '\n' : '') +
    `${title}\n` +
    `${envShim}${clientRouterEnabled() ? '' : `\n<script${n}>window.__WEBJS_CLIENT_ROUTER__=false;</script>`}\n` +
    `${importMapTag({ nonce: opts.nonce })}\n` +
    (linkTags.length ? linkTags.join('\n') + '\n' : '') +
    (scriptTags.length ? scriptTags.join('\n') + '\n' : '') +
    `${boot}\n` +
    `${reload}\n` +
    `${suspenseBoot}\n` +
    `</head>\n<body>\n`
  );
}
