import { pathToFileURL } from 'node:url';
import { renderToString, isNotFound, isRedirect } from 'webjs';
import { importMapTag } from './importmap.js';
import { readToken, newToken, cookieHeader } from './csrf.js';

/**
 * SSR a matched page route to a Response.
 *
 * Mirrors Next.js semantics:
 *   - Page + layout default exports can be async.
 *   - `metadata` named export on layouts/pages is merged (page > innermost layout > … > root).
 *   - `notFound()` and `redirect()` thrown anywhere in the chain are caught
 *     and converted to 404 or 3xx responses.
 *   - On a render error we walk up the chain looking for the nearest `error.js`
 *     and render that instead (falls back to a plain error page).
 *
 * @param {import('./router.js').PageRoute} route
 * @param {Record<string,string>} params
 * @param {URL} url
 * @param {{ dev: boolean, appDir: string, req?: Request }} opts
 * @returns {Promise<Response>}
 */
export async function ssrPage(route, params, url, opts) {
  const ctx = {
    params,
    searchParams: Object.fromEntries(url.searchParams.entries()),
    url: url.toString(),
  };

  // Collect metadata across layouts (outermost first) then page.
  const metadata = await collectMetadata(route, ctx, opts.dev);

  try {
    const suspenseCtx = { pending: [], nextId: 1 };
    const body = await renderChain(route, ctx, opts.dev, suspenseCtx);
    const moduleUrls = [route.file, ...route.layouts].map((f) => toUrlPath(f, opts.appDir));
    return streamingHtmlResponse(
      wrapHead({ metadata, moduleUrls, dev: opts.dev, streaming: suspenseCtx.pending.length > 0 }),
      body,
      suspenseCtx,
      200,
      opts.req,
      url
    );
  } catch (err) {
    if (isRedirect(err)) {
      const e = /** @type any */ (err);
      return new Response(null, { status: e.status || 307, headers: { location: e.url } });
    }
    if (isNotFound(err)) {
      const html = await ssrNotFoundHtml(null, opts);
      return htmlResponse(html, 404, opts.req, url);
    }
    // Try nearest error.js (innermost → outermost).
    for (let i = route.errors.length - 1; i >= 0; i--) {
      try {
        const mod = await loadModule(route.errors[i], opts.dev);
        if (!mod.default) continue;
        const tree = await mod.default({ ...ctx, error: err });
        const body = await renderToString(tree);
        const moduleUrls = [route.file, ...route.layouts].map((f) => toUrlPath(f, opts.appDir));
        const html = wrapInDocument(body, { metadata, moduleUrls, dev: opts.dev });
        return htmlResponse(html, 500, opts.req, url);
      } catch (nested) {
        // fall through to next error boundary
      }
    }
    // Default: dev shows stack, prod shows a terse message (no stack trace leaks).
    console.error('[webjs] unhandled render error:', err);
    const body = opts.dev
      ? `<h1>Server error</h1><pre style="white-space:pre-wrap">${escapeHtml(
          err instanceof Error ? err.stack || err.message : String(err)
        )}</pre>`
      : `<h1>Server error</h1><p>Something went wrong. Please try again.</p>`;
    return htmlResponse(
      wrapInDocument(body, { metadata, moduleUrls: [], dev: opts.dev }),
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
 * Build an HTML Response and, if missing, attach the CSRF cookie.
 * @param {string} html
 * @param {number} status
 * @param {Request | undefined} req
 * @param {URL | undefined} url
 */
function htmlResponse(html, status, req, url) {
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
  if (req && !readToken(req)) {
    const secure = url ? url.protocol === 'https:' : false;
    headers.append('set-cookie', cookieHeader(newToken(), { secure }));
  }
  return new Response(html, { status, headers });
}

/* ------------ internals ------------ */

async function ssrNotFoundHtml(notFoundFile, opts) {
  let body = '<h1>404 — Not found</h1>';
  if (notFoundFile) {
    try {
      const mod = await loadModule(notFoundFile, opts.dev);
      if (mod.default) body = await renderToString(await mod.default({}));
    } catch (e) {
      body = `<h1>404 — Not found</h1><pre>${escapeHtml(String(e))}</pre>`;
    }
  }
  return wrapInDocument(body, {
    metadata: { title: 'Not found' },
    moduleUrls: [],
    dev: opts.dev,
  });
}

async function renderChain(route, ctx, dev, suspenseCtx) {
  const page = await loadModule(route.file, dev);
  if (!page.default) throw new Error(`Page ${route.file} must have a default export`);
  let tree = await page.default(ctx);
  for (let i = route.layouts.length - 1; i >= 0; i--) {
    const mod = await loadModule(route.layouts[i], dev);
    if (!mod.default) continue;
    tree = await mod.default({ ...ctx, children: tree });
  }
  return renderToString(tree, { ssr: true, suspenseCtx });
}

/**
 * @param {import('./router.js').PageRoute} route
 * @param {Record<string,unknown>} ctx
 * @param {boolean} dev
 */
async function collectMetadata(route, ctx, dev) {
  /** @type {Record<string, any>} */
  let meta = {};
  for (const file of route.metadataFiles) {
    try {
      const mod = await loadModule(file, dev);
      let m = null;
      if (typeof mod.generateMetadata === 'function') {
        m = await mod.generateMetadata(ctx);
      } else if (mod.metadata) {
        m = mod.metadata;
      }
      if (m && typeof m === 'object') meta = { ...meta, ...m };
    } catch {
      // ignore: metadata collection never fails the request
    }
  }
  return meta;
}

/**
 * Buffered wrapper (error / not-found paths; no Suspense streaming).
 * @param {string} body
 * @param {{ metadata: Record<string,any>, moduleUrls: string[], dev: boolean }} opts
 */
function wrapInDocument(body, opts) {
  return wrapHead({ ...opts, streaming: false }) + body + `\n</body>\n</html>`;
}

/**
 * Produce the `<!doctype…><body>` prefix. If `streaming` is true, injects
 * the tiny client-side resolver that swaps Suspense fallback nodes for
 * streamed-in real content.
 *
 * @param {{ metadata: Record<string,any>, moduleUrls: string[], dev: boolean, streaming: boolean }} opts
 */
function wrapHead(opts) {
  const imports = opts.moduleUrls.map((u) => `import ${JSON.stringify(u)};`).join('\n');
  const boot = imports ? `<script type="module">\n${imports}\n</script>` : '';
  const reload = opts.dev ? `<script type="module" src="/__webjs/reload.js"></script>` : '';
  const suspenseBoot = opts.streaming
    ? `<script>window.__webjsResolve=function(id){var t=document.querySelector('template[data-webjs-resolve="'+id+'"]');var b=document.getElementById(id);if(t&&b){b.replaceWith(t.content.cloneNode(true));t.remove();}};</script>`
    : '';

  const m = opts.metadata || {};
  const metaTags = [];
  if (m.description) metaTags.push(`<meta name="description" content="${escapeAttr(m.description)}">`);
  if (m.viewport) metaTags.push(`<meta name="viewport" content="${escapeAttr(m.viewport)}">`);
  else metaTags.push(`<meta name="viewport" content="width=device-width,initial-scale=1">`);
  if (m.themeColor) metaTags.push(`<meta name="theme-color" content="${escapeAttr(m.themeColor)}">`);
  if (m.openGraph && typeof m.openGraph === 'object') {
    for (const [k, v] of Object.entries(m.openGraph)) {
      metaTags.push(`<meta property="og:${escapeAttr(k)}" content="${escapeAttr(String(v))}">`);
    }
  }
  const title = m.title || 'webjs app';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
${metaTags.join('\n')}
<title>${escapeHtml(title)}</title>
${importMapTag()}
${boot}
${reload}
${suspenseBoot}
</head>
<body>
`;
}

/**
 * Build a streaming Response. Degrades to a single-flush response when
 * there are no pending Suspense boundaries.
 *
 * @param {string} headHtml
 * @param {string} bodyHtml
 * @param {{ pending: {id: string, promise: Promise<unknown>}[], nextId: number }} ctx
 * @param {number} status
 * @param {Request | undefined} req
 * @param {URL | undefined} url
 */
function streamingHtmlResponse(headHtml, bodyHtml, ctx, status, req, url) {
  const encoder = new TextEncoder();
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
  if (req && !readToken(req)) {
    const secure = url ? url.protocol === 'https:' : false;
    headers.append('set-cookie', cookieHeader(newToken(), { secure }));
  }

  if (!ctx.pending.length) {
    return new Response(headHtml + bodyHtml + '\n</body>\n</html>', { status, headers });
  }

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(headHtml + bodyHtml));
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
                const sub = { pending: [], nextId: ctx.nextId };
                const html = await renderToString(resolved, { ssr: true, suspenseCtx: sub });
                ctx.nextId = sub.nextId;
                for (const n of sub.pending) ctx.pending.push(n);
                return { id: p.id, html };
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return { id: p.id, html: `<p>error: ${escapeHtml(msg)}</p>` };
              }
            })
          );
          for (const r of settled) {
            const chunk =
              `<template data-webjs-resolve="${r.id}">${r.html}</template>` +
              `<script>window.__webjsResolve&&__webjsResolve("${r.id}")</script>`;
            controller.enqueue(encoder.encode(chunk));
          }
        }
      } finally {
        controller.enqueue(encoder.encode('\n</body>\n</html>'));
        controller.close();
      }
    },
  });
  return new Response(stream, { status, headers });
}

/**
 * @param {string} file
 * @param {boolean} dev
 */
async function loadModule(file, dev) {
  const url = pathToFileURL(file).toString();
  const bust = dev ? `?t=${Date.now()}-${Math.random().toString(36).slice(2)}` : '';
  return import(url + bust);
}

/**
 * @param {string} file
 * @param {string} appDir
 */
function toUrlPath(file, appDir) {
  let rel = file.startsWith(appDir) ? file.slice(appDir.length) : file;
  rel = rel.split('\\').join('/');
  if (!rel.startsWith('/')) rel = '/' + rel;
  return rel;
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
/** @param {string} s */
function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
