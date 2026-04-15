import { pathToFileURL } from 'node:url';
import { renderToString, isNotFound, isRedirect } from 'webjs';
import { importMapTag } from './importmap.js';

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
 * @param {{ dev: boolean, appDir: string }} opts
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
    const body = await renderChain(route, ctx, opts.dev);
    const moduleUrls = [route.file, ...route.layouts].map((f) => toUrlPath(f, opts.appDir));
    const html = wrapInDocument(body, { metadata, moduleUrls, dev: opts.dev });
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  } catch (err) {
    if (isRedirect(err)) {
      const e = /** @type any */ (err);
      return new Response(null, { status: e.status || 307, headers: { location: e.url } });
    }
    if (isNotFound(err)) {
      const html = await ssrNotFoundHtml(null, opts);
      return new Response(html, {
        status: 404,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
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
        return new Response(html, {
          status: 500,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      } catch (nested) {
        // fall through to next error boundary
      }
    }
    // Default: dev shows stack, prod shows a terse message.
    const stack = err instanceof Error ? err.stack || err.message : String(err);
    const body = opts.dev
      ? `<h1>Server error</h1><pre style="white-space:pre-wrap">${escapeHtml(stack)}</pre>`
      : `<h1>Server error</h1>`;
    return new Response(wrapInDocument(body, { metadata, moduleUrls: [], dev: opts.dev }), {
      status: 500,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
}

/**
 * 404 response for unmatched routes.
 * @param {string | null} notFoundFile
 * @param {{ dev: boolean, appDir: string }} opts
 */
export async function ssrNotFound(notFoundFile, opts) {
  const html = await ssrNotFoundHtml(notFoundFile, opts);
  return new Response(html, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
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

async function renderChain(route, ctx, dev) {
  const page = await loadModule(route.file, dev);
  if (!page.default) throw new Error(`Page ${route.file} must have a default export`);
  let tree = await page.default(ctx);
  for (let i = route.layouts.length - 1; i >= 0; i--) {
    const mod = await loadModule(route.layouts[i], dev);
    if (!mod.default) continue;
    tree = await mod.default({ ...ctx, children: tree });
  }
  return renderToString(tree);
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
 * @param {string} body
 * @param {{ metadata: Record<string,any>, moduleUrls: string[], dev: boolean }} opts
 */
function wrapInDocument(body, opts) {
  const imports = opts.moduleUrls.map((u) => `import ${JSON.stringify(u)};`).join('\n');
  const boot = imports ? `<script type="module">\n${imports}\n</script>` : '';
  const reload = opts.dev ? `<script type="module" src="/__webjs/reload.js"></script>` : '';

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
</head>
<body>
${body}
</body>
</html>`;
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
