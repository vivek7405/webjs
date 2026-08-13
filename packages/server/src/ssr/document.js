import { collectHoistedHeadTags, hoistHeadTags, wrapHead } from './head.js';

/**
 * Derive a layout's segment path from its file path. The path identifies
 * the layout's slot in the layout chain for partial-nav marker matching.
 *
 *   app/layout.ts                          → '/'
 *   app/docs/layout.ts                     → '/docs'
 *   app/docs/components/layout.ts          → '/docs/components'
 *   app/(marketing)/about/layout.ts        → '/(marketing)/about'
 *
 * Route groups `(marketing)` are KEPT in the path. They don't appear in
 * URLs but DO scope distinct layouts: two routes at the same URL prefix
 * served by different `(group)` layouts must produce different markers
 * so the client doesn't falsely identify them as a shared layout.
 *
 * @param {string} layoutFile  Absolute path to the layout source file.
 * @returns {string}
 */
export function layoutSegmentPath(layoutFile) {
  const p = layoutFile
    .replace(/^.*\/app\//, '')
    .replace(/\/?layout\.[jt]sx?$/, '');
  return p === '' ? '/' : '/' + p;
}

/**
 * Like layoutSegmentPath but for the PAGE file. Strips the `page.ext`
 * filename, yielding the page's own segment path (the full route pattern,
 * dynamic tokens included):
 *
 *   app/page.ts                    -> '/'
 *   app/blog/[slug]/page.ts        -> '/blog/[slug]'
 *   app/files/[...rest]/page.ts    -> '/files/[...rest]'
 *
 * This is the segment for the PAGE-level region (Pillar 1 / #1013): the page
 * needs its own region keyed by the full resolved path so a dynamic-param
 * change remounts the page (Next parity) while a shared parent LAYOUT (a
 * shorter segment path whose route-key does not change) is preserved.
 *
 * @param {string} pageFile  Absolute path to the page source file.
 * @returns {string}
 */
export function pageSegmentPath(pageFile) {
  const p = pageFile
    .replace(/^.*\/app\//, '')
    .replace(/\/?page\.[jt]sx?$/, '');
  return p === '' ? '/' : '/' + p;
}

/**
 * Derive a region's ROUTE-KEY from its segment path pattern and the render's
 * resolved params. The route-key is the CONCRETE resolved URL path for the
 * region: dynamic `[param]` / catch-all `[...param]` / optional-catch-all
 * `[[...param]]` tokens are substituted with their param values, and `(group)`
 * segments are dropped (they scope layouts but never appear in the URL).
 * searchParams are excluded by construction (params carries route params only).
 *
 * The client router compares a region's OLD vs NEW route-key to pick the swap
 * tier: route-key CHANGED -> wholesale replace (Next page-remount parity),
 * route-key SAME -> bounded same-route morph (hydrated component state kept, the
 * searchParams-only-nav case). A static segment (`/`, `/docs`) has a constant
 * route-key, so that layout's region never remounts and its chrome always
 * survives.
 *
 * PARAM VALUES ARE ENCODED (`encodeURIComponent`, per path piece). The
 * route-key rides inside the boundary COMMENT, and param values are
 * user-controlled, so an unencoded value could carry `-->` and terminate the
 * comment mid-boundary. Encoding removes `<`, `>`, `:`, `/` from every
 * substituted piece, which makes all three HTML-forbidden comment sequences
 * (`<!--`, `-->`, `--!>`) impossible (each needs `<` or `>`) and keeps `:`
 * unambiguous as the boundary-format delimiter. A catch-all's value is encoded
 * per PIECE (split on `/`), so its literal separators stay readable. Static
 * segments come from folder names and are emitted as-is. A bare `--` can
 * survive encoding (`-` is unreserved) and is legal inside an HTML5 comment.
 * The key is only ever compared for equality, so encoding does not affect the
 * swap-tier decision.
 *
 *   regionRouteKey('/', {})                          -> '/'
 *   regionRouteKey('/docs', {})                      -> '/docs'
 *   regionRouteKey('/blog/[slug]', {slug:'a'})       -> '/blog/a'
 *   regionRouteKey('/(marketing)/about', {})         -> '/about'
 *   regionRouteKey('/files/[...rest]', {rest:'a/b'}) -> '/files/a/b'
 *   regionRouteKey('/shop/[[...slug]]', {})          -> '/shop'
 *   regionRouteKey('/blog/[slug]', {slug:'a-->b'})   -> '/blog/a--%3Eb'
 *
 * @param {string} segmentPath  Region segment pattern, e.g. '/blog/[slug]'.
 * @param {Record<string,string>} params  Resolved route params (values are
 *   strings; a catch-all value is already slash-joined, e.g. 'a/b/c').
 * @returns {string}
 */
export function regionRouteKey(segmentPath, params) {
  const p = params || {};
  /** Encode one substituted value, per slash-piece (catch-alls keep their
   *  literal separators; each piece is comment-safe + delimiter-safe). */
  const enc = (v) => String(v).split('/').map((s) => encodeURIComponent(s)).join('/');
  /** A STATIC piece is a folder name emitted as-is EXCEPT the boundary/header
   *  delimiter characters (':' would mis-split the `segment:route-key` parses,
   *  ',' the have-entry list, '%' the decode); percent-encode just those so
   *  the no-delimiter invariant holds for every emitted route-key while
   *  normal folder names stay byte-identical. */
  const encStatic = (v) => v.replace(/[%:,]/g, (c) => encodeURIComponent(c));
  const out = [];
  for (const seg of segmentPath.split('/')) {
    if (!seg) continue;
    // Route group `(marketing)`: scopes layouts, absent from the URL.
    if (seg.startsWith('(') && seg.endsWith(')')) continue;
    // Optional catch-all `[[...name]]` / catch-all `[...name]`: the value is
    // the already-slash-joined tail (may be '' for an empty optional one).
    if (seg.startsWith('[[...') && seg.endsWith(']]')) {
      const v = p[seg.slice(5, -2)];
      if (v) out.push(enc(v));
      continue;
    }
    if (seg.startsWith('[...') && seg.endsWith(']')) {
      const v = p[seg.slice(4, -1)];
      if (v) out.push(enc(v));
      continue;
    }
    // Dynamic `[name]`.
    if (seg.startsWith('[') && seg.endsWith(']')) {
      out.push(enc(p[seg.slice(1, -1)] ?? ''));
      continue;
    }
    out.push(encStatic(seg));
  }
  return '/' + out.join('/');
}

/**
 * Wrap a TemplateResult-or-renderable child in a KEYED partial-nav boundary
 * comment pair (#1015). Returns a synthetic TemplateResult: server
 * `renderToString` walks `.strings` and `.values` exactly the same way as for
 * the `html` tag.
 *
 * Format:
 *   open   <!--wj:children:<segment>:<route-key>-->
 *   close  <!--/wj:children:<segment>-->
 *
 * The close carries the SEGMENT, so client-side pairing is deterministic
 * id-matching instead of the LIFO reconstruction that produced the #994 class
 * of silent mispair. The open additionally carries the resolved ROUTE-KEY
 * (param values encoded, see `regionRouteKey`), which drives the client's
 * two-tier swap decision: key changed -> wholesale replace (Next remount
 * parity), key same -> bounded morph (hydrated state preserved). A comment is
 * invisible to structural CSS (`>`, `:nth-child`, flex/grid item enumeration),
 * so unlike a wrapper element this boundary is layout-free by construction.
 *
 * The marker text lives in `strings` (static template parts), NOT in
 * `values`: `values` get HTML-escaped on render, comments wouldn't survive.
 *
 * @param {unknown} tree  A TemplateResult, string, array, or Promise.
 * @param {string} segmentPath  The boundary's segment pattern (pairing id).
 * @param {Record<string,string>} params  Resolved route params for the key.
 * @returns {{ _$webjs: 'template', strings: string[], values: unknown[] }}
 */
export function wrapWithChildrenMarker(tree, segmentPath, params) {
  const routeKey = regionRouteKey(segmentPath, params);
  return {
    _$webjs: 'template',
    strings: [
      `<!--wj:children:${segmentPath}:${routeKey}-->`,
      `<!--/wj:children:${segmentPath}-->`,
    ],
    values: [tree],
  };
}

export const _layoutSegmentPath = layoutSegmentPath;
export const _pageSegmentPath = pageSegmentPath;
export const _regionRouteKey = regionRouteKey;
export const _wrapWithChildrenMarker = wrapWithChildrenMarker;

/**
 * Detect a user-supplied <!doctype><html>…</html> shell at the top of
 * `body`. Returns the parsed parts when present; otherwise null.
 *
 * The framework owns the shell by default: it auto-emits
 * `<!doctype><html lang="en"><head>…</head><body>` around every page.
 * But the *root layout* (only) may write its own shell to set
 * `<html lang>`, `<html dir>`, `<html data-*>`, `<body class>`, etc.
 * When that happens we keep the user's shell verbatim and splice the
 * framework's required `<head>` tags (importmap, modulepreload, title,
 * meta, og/twitter) into the user's `<head>`. Non-root layouts that
 * try this would produce nested-shell garbage; `webjs check` flags
 * them via the `shell-in-non-root-layout` rule.
 *
 * @param {string} body
 * @returns {{
 *   htmlAttrs: string,
 *   headAttrs: string,
 *   userHead: string,
 *   bodyAttrs: string,
 *   userBody: string,
 * } | null}
 */
export function extractUserShell(body) {
  // Tolerant: allow optional whitespace, optional <!doctype>, then <html ...>.
  // Capture html attributes (anything between <html and >).
  const htmlOpen = /^\s*(?:<!doctype[^>]*>\s*)?<html\b([^>]*)>\s*([\s\S]*)<\/html>\s*$/i;
  const m = body.match(htmlOpen);
  if (!m) return null;
  const htmlAttrs = m[1] || '';
  const shellInner = m[2];

  // <head> is optional inside the user's shell: if missing, the
  // framework's head content stands alone. Same for <body>.
  const headRe = /<head\b([^>]*)>([\s\S]*?)<\/head>/i;
  const bodyRe = /<body\b([^>]*)>([\s\S]*?)<\/body>/i;
  const headMatch = shellInner.match(headRe);
  const bodyMatch = shellInner.match(bodyRe);

  return {
    htmlAttrs,
    headAttrs: headMatch ? (headMatch[1] || '') : '',
    userHead: headMatch ? headMatch[2] : '',
    bodyAttrs: bodyMatch ? (bodyMatch[1] || '') : '',
    // If the user omitted <body>, treat everything outside <head>…</head>
    // as their body content.
    userBody: bodyMatch
      ? bodyMatch[2]
      : (headMatch ? shellInner.replace(headMatch[0], '') : shellInner).trim(),
  };
}

export const _extractUserShell = extractUserShell;

/**
 * Inner-only variant of wrapHead: returns just the meta/title/link/script
 * tags that should live INSIDE <head>, without the surrounding
 * <!doctype><html><head>…</head><body> shell. Used to splice into a
 * user-provided shell from `extractUserShell()`.
 *
 * @param {Parameters<typeof wrapHead>[0]} opts
 * @returns {string}
 */
function buildHeadInner(opts) {
  // Pull the full prefix and strip the <!doctype><html><head> opening + the
  // closing </head><body> so we're left with the inner tags only. Keeps a
  // single source of truth for what goes in <head>.
  const full = wrapHead({ ...opts, streaming: false });
  const start = full.indexOf('<head>');
  const end = full.indexOf('</head>');
  if (start === -1 || end === -1) return '';
  // +'<head>'.length to skip past the opening tag itself.
  return full.slice(start + '<head>'.length, end).trim();
}

/**
 * Build the prefix/body/closer triple for a rendered layout's body. Single
 * source of truth used by both the buffered (`wrapInDocument`) and
 * streaming (`streamingHtmlResponse`) paths.
 *
 * If `body` starts with a user-supplied <!doctype><html>…</html> shell:
 *   - `prefix` opens with the user's `<!doctype><html><head>` (with their
 *     attributes), splices the framework's required tags + the user's
 *     own head content + auto-hoisted body-positioned head-bound tags,
 *     then closes `</head>` and opens `<body>` (with user attributes).
 *   - `streamBody` is the user's body content (head-hoist already stripped).
 *   - `closer` is `</body></html>`.
 *
 * Otherwise (no user shell): use the framework's auto-emitted shell.
 *
 * @param {string} body
 * @param {Parameters<typeof wrapHead>[0]} wrapOpts
 * @returns {{ prefix: string, streamBody: string, closer: string }}
 */
export function buildDocumentParts(body, wrapOpts) {
  const shell = extractUserShell(body);
  if (shell) {
    const headInner = buildHeadInner(wrapOpts);
    const hoist = collectHoistedHeadTags(shell.userBody);
    const composedHead = [headInner, shell.userHead.trim(), hoist.tags.join('\n')]
      .filter(Boolean)
      .join('\n');
    const prefix =
      `<!doctype html>\n<html${shell.htmlAttrs}>\n<head${shell.headAttrs}>\n` +
      composedHead +
      `\n</head>\n<body${shell.bodyAttrs}>\n`;
    return { prefix, streamBody: hoist.body, closer: `\n</body>\n</html>` };
  }
  // No user shell: framework owns the wrapper.
  const headHtml = wrapHead(wrapOpts);
  const { head, body: bodyOut } = hoistHeadTags(headHtml, body);
  return { prefix: head, streamBody: bodyOut, closer: `\n</body>\n</html>` };
}

export const _buildDocumentParts = buildDocumentParts;

/**
 * Buffered wrapper (error / not-found paths; no Suspense streaming).
 *
 * @param {string} body
 * @param {{ metadata: Record<string,any>, moduleUrls: string[], dev: boolean }} opts
 */
export function wrapInDocument(body, opts) {
  const { prefix, streamBody, closer } = buildDocumentParts(body, { ...opts, streaming: false });
  return prefix + streamBody + closer;
}
