/**
 * Unit + integration tests for SSR helpers introduced on the
 * light-dom-tailwind-v2 branch:
 *   - hoistHeadTags: leading <script>/<style> are lifted to <head>
 *   - data-layout wrapping: layout output is wrapped with a marker
 *   - cache-control default: no-store unless the page opts in
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_MODULE_URL = pathToFileURL(
  resolve(__dirname, '../../packages/core/src/html.js')
).toString();
const WEBJS_MODULE_URL = pathToFileURL(
  resolve(__dirname, '../../packages/core/index.js')
).toString();

let _hoistHeadTags, _extractUserShell, _buildDocumentParts, ssrPage, ssrNotFound, setMetadataIconRoutes;
let withRequest;
let tmpDir;

before(async () => {
  ({
    _hoistHeadTags,
    _extractUserShell,
    _buildDocumentParts,
    ssrPage,
    ssrNotFound,
    setMetadataIconRoutes,
  } = await import('../../packages/server/src/ssr.js'));
  // The CSP nonce now flows through the per-request AsyncLocalStorage store
  // (issue #233): `cspNonce()` reads the minted nonce there, or falls back
  // to an inbound Content-Security-Policy request header. The legacy
  // inbound-header tests below exercise that fallback, so they must call
  // ssrPage inside a request scope, exactly as the real handler does.
  ({ withRequest } = await import('../../packages/server/src/context.js'));
  tmpDir = mkdtempSync(join(tmpdir(), 'webjs-ssr-test-'));
});

after(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

/* ------------ hoistHeadTags (pure function) ------------ */

test('hoistHeadTags: no hoisting when body has no leading script/style', () => {
  const { head, body } = _hoistHeadTags(
    '<head><title>x</title></head>',
    '<div>hello</div>'
  );
  assert.equal(head, '<head><title>x</title></head>');
  assert.equal(body, '<div>hello</div>');
});

test('hoistHeadTags: lifts leading <script> to head', () => {
  const bodyHtml = '<script>window.x = 1;</script><main>page</main>';
  const { head, body } = _hoistHeadTags('<head></head>', bodyHtml);
  assert.ok(head.includes('<script>window.x = 1;</script>'));
  assert.equal(body, '<main>page</main>');
});

test('hoistHeadTags: lifts leading <style> to head', () => {
  const bodyHtml = '<style>.a{color:red}</style><main>page</main>';
  const { head, body } = _hoistHeadTags('<head></head>', bodyHtml);
  assert.ok(head.includes('<style>.a{color:red}</style>'));
  assert.equal(body, '<main>page</main>');
});

test('hoistHeadTags: lifts multiple consecutive leading script/style tags', () => {
  const bodyHtml =
    '<script src="/a.js"></script>' +
    '<style>.x{}</style>' +
    '<script>window.y = 2;</script>' +
    '<main>rest</main>';
  const { head, body } = _hoistHeadTags('<head></head>', bodyHtml);
  assert.ok(head.includes('<script src="/a.js"></script>'));
  assert.ok(head.includes('<style>.x{}</style>'));
  assert.ok(head.includes('<script>window.y = 2;</script>'));
  assert.equal(body, '<main>rest</main>');
});

test('hoistHeadTags: does NOT lift script/style that appear after normal content', () => {
  const bodyHtml = '<main>page</main><script>alert(1)</script>';
  const { head, body } = _hoistHeadTags('<head></head>', bodyHtml);
  // The script isn't leading: stays in the body.
  assert.equal(head, '<head></head>');
  assert.equal(body, bodyHtml);
});

test('hoistHeadTags: tolerates whitespace before leading tags', () => {
  const bodyHtml = '  \n  <script>a=1</script><main>ok</main>';
  const { head, body } = _hoistHeadTags('<head></head>', bodyHtml);
  assert.ok(head.includes('<script>a=1</script>'));
  assert.equal(body, '<main>ok</main>');
});

test('hoistHeadTags: is case-insensitive for script/style tags', () => {
  const bodyHtml = '<SCRIPT>upper = 1;</SCRIPT><main>ok</main>';
  const { head, body } = _hoistHeadTags('<head></head>', bodyHtml);
  assert.ok(head.includes('<SCRIPT>upper = 1;</SCRIPT>'));
  assert.equal(body, '<main>ok</main>');
});

test('hoistHeadTags: lifts leading <link rel="icon"> to head', () => {
  // Browsers only honour favicons declared in <head>; layouts that emit
  // them in their template body must be hoisted, otherwise the tab icon
  // never appears.
  const bodyHtml =
    '<link rel="icon" href="/public/favicon.svg" type="image/svg+xml">' +
    '<link rel="apple-touch-icon" href="/public/favicon.png">' +
    '<main>page</main>';
  const { head, body } = _hoistHeadTags('<head></head>', bodyHtml);
  assert.ok(head.includes('<link rel="icon" href="/public/favicon.svg" type="image/svg+xml">'));
  assert.ok(head.includes('<link rel="apple-touch-icon" href="/public/favicon.png">'));
  assert.equal(body, '<main>page</main>');
});

test('hoistHeadTags: lifts a mixed run of leading link/script/style', () => {
  const bodyHtml =
    '<link rel="icon" href="/f.svg">' +
    '<script>var t = "dark";</script>' +
    '<link rel="stylesheet" href="/x.css">' +
    '<style>.a{}</style>' +
    '<main>rest</main>';
  const { head, body } = _hoistHeadTags('<head></head>', bodyHtml);
  assert.ok(head.includes('<link rel="icon" href="/f.svg">'));
  assert.ok(head.includes('<script>var t = "dark";</script>'));
  assert.ok(head.includes('<link rel="stylesheet" href="/x.css">'));
  assert.ok(head.includes('<style>.a{}</style>'));
  assert.equal(body, '<main>rest</main>');
});

test('hoistHeadTags: does NOT lift <link> after normal content', () => {
  const bodyHtml = '<main>page</main><link rel="icon" href="/late.svg">';
  const { head, body } = _hoistHeadTags('<head></head>', bodyHtml);
  assert.equal(head, '<head></head>');
  assert.equal(body, bodyHtml);
});

test('hoistHeadTags: lifts head-bound tags at the top of body (no wrapper now)', () => {
  // The SSR pipeline no longer wraps layout output in a wrapping div -
  // partial-nav uses inline comment markers instead. Head-bound tags
  // emitted at the top of a layout template lift directly into <head>.
  const bodyHtml =
    '<link rel="icon" href="/public/favicon.svg" type="image/svg+xml">' +
    '<script>var t=1;</script>' +
    '<main>page</main>';
  const { head, body } = _hoistHeadTags('<head></head>', bodyHtml);
  assert.ok(head.includes('<link rel="icon" href="/public/favicon.svg" type="image/svg+xml">'));
  assert.ok(head.includes('<script>var t=1;</script>'));
  assert.ok(body.startsWith('<main>page</main>'),
    `body starts with the first non-head content, got: ${body.slice(0, 80)}`);
  assert.ok(!body.includes('rel="icon"'), 'icon link removed from body');
});

/* ------------ extractUserShell (pure function) ------------ */

test('extractUserShell: returns null when body has no <html> shell', () => {
  assert.equal(_extractUserShell('<main>hello</main>'), null);
  assert.equal(_extractUserShell('<div>x</div><span>y</span>'), null);
});

test('extractUserShell: parses minimal <!doctype><html><head><body> shell', () => {
  const shell = _extractUserShell(
    '<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body class="dark"><main>x</main></body></html>'
  );
  assert.ok(shell, 'shell must be detected');
  assert.equal(shell.htmlAttrs.trim(), 'lang="es"');
  assert.equal(shell.bodyAttrs.trim(), 'class="dark"');
  assert.match(shell.userHead, /<meta charset="utf-8">/);
  assert.match(shell.userBody, /<main>x<\/main>/);
});

test('extractUserShell: tolerates leading whitespace + multi-attr <html>', () => {
  const shell = _extractUserShell(
    '\n  <!doctype html>\n  <html lang="en" dir="rtl" data-theme="dark">\n  <head></head><body><p>p</p></body></html>'
  );
  assert.ok(shell);
  assert.match(shell.htmlAttrs, /lang="en"/);
  assert.match(shell.htmlAttrs, /dir="rtl"/);
  assert.match(shell.htmlAttrs, /data-theme="dark"/);
});

test('extractUserShell: works with <html> but no explicit <head>', () => {
  const shell = _extractUserShell('<html lang="en"><body><main>x</main></body></html>');
  assert.ok(shell);
  assert.equal(shell.htmlAttrs.trim(), 'lang="en"');
  assert.equal(shell.userHead, '');
  assert.match(shell.userBody, /<main>x<\/main>/);
});

test('extractUserShell: rejects body that only contains <html> as a literal text', () => {
  // Text containing the string "<html>" but not at the start shouldn't match.
  assert.equal(_extractUserShell('<div>some <html> in text</div>'), null);
});

/* ------------ buildDocumentParts: user-shell + framework-shell paths ---- */

test('buildDocumentParts: framework shell when no user shell present', () => {
  const { prefix, streamBody, closer } = _buildDocumentParts(
    '<main>page</main>',
    { metadata: { title: 'X' }, moduleUrls: [], dev: false, streaming: false }
  );
  assert.match(prefix, /^<!doctype html>/);
  assert.match(prefix, /<html lang="en">/);
  assert.match(prefix, /<title>X<\/title>/);
  assert.equal(streamBody, '<main>page</main>');
  assert.equal(closer, '\n</body>\n</html>');
});

test('buildDocumentParts: keeps user shell attrs; splices framework tags into user <head>', () => {
  const userShell =
    '<!doctype html><html lang="es" data-theme="dark"><head><link rel="preconnect" href="https://cdn.test"></head><body class="bg-dark"><main>page</main></body></html>';
  const { prefix, streamBody, closer } = _buildDocumentParts(userShell, {
    metadata: { title: 'X', description: 'd' },
    moduleUrls: [],
    dev: false,
    streaming: false,
  });
  // Open tag attributes from user.
  assert.match(prefix, /<html lang="es" data-theme="dark">/);
  assert.match(prefix, /<body class="bg-dark">/);
  // Framework tags injected into <head>.
  assert.match(prefix, /<title>X<\/title>/);
  assert.match(prefix, /<meta name="description" content="d">/);
  // User's own head tag preserved.
  assert.match(prefix, /<link rel="preconnect" href="https:\/\/cdn\.test">/);
  // No duplicate <html> or <head> wrapper.
  assert.equal(prefix.match(/<html\b/g)?.length, 1, 'exactly one <html> tag');
  assert.equal(prefix.match(/<head\b/g)?.length, 1, 'exactly one <head> tag');
  assert.equal(streamBody.trim(), '<main>page</main>');
  assert.equal(closer, '\n</body>\n</html>');
});

test('buildDocumentParts: auto-hoist of body-positioned <link> still works with user shell', () => {
  const userShell =
    '<!doctype html><html lang="en"><head></head><body><link rel="icon" href="/x.svg"><main>p</main></body></html>';
  const { prefix, streamBody } = _buildDocumentParts(userShell, {
    metadata: { title: 'X' },
    moduleUrls: [],
    dev: false,
    streaming: false,
  });
  // The body-positioned <link rel="icon"> should have been lifted into <head>.
  assert.match(prefix, /<link rel="icon" href="\/x\.svg">/);
  // …and removed from the body.
  assert.equal(streamBody.includes('rel="icon"'), false, 'icon link removed from body');
});

test('buildDocumentParts: passes through user shell with no <head> at all', () => {
  const { prefix } = _buildDocumentParts(
    '<html lang="en"><body><main>p</main></body></html>',
    { metadata: { title: 'X' }, moduleUrls: [], dev: false, streaming: false }
  );
  // Framework still injects its tags (we just open a fresh <head>).
  assert.match(prefix, /<head\b/);
  assert.match(prefix, /<title>X<\/title>/);
});

test('buildDocumentParts: user shell is detected directly (no wrapper to peek past)', () => {
  // The renderChain output goes directly into the shell extractor: partial
  // -nav uses inline comment markers, not a wrapping div. extractUserShell
  // sees the user's <!doctype><html> shell at the top of body.
  const userShellBody =
    `<!doctype html><html lang="es" data-theme="dark"><head></head><body class="bg-test"><main>page</main></body></html>`;
  const { prefix, streamBody } = _buildDocumentParts(userShellBody, {
    metadata: { title: 'X' },
    moduleUrls: [],
    dev: false,
    streaming: false,
  });
  // User shell attributes preserved.
  assert.match(prefix, /<html lang="es" data-theme="dark">/);
  assert.match(prefix, /<body class="bg-test">/);
  // User body content preserved.
  assert.match(streamBody, /<main>page<\/main>/);
});

/* ------------ Metadata parity: i18n + SEO essentials ------------ */

// Small helper that bypasses the full SSR boot and just exercises wrapHead
// indirectly via _buildDocumentParts (whose framework branch ends up calling
// wrapHead).
function render(metadata) {
  const { prefix } = _buildDocumentParts(
    '<main>p</main>',
    { metadata, moduleUrls: [], dev: false, streaming: false },
  );
  return prefix;
}

test('metadata.robots: object form maps to noindex/nofollow tokens', () => {
  const html = render({ robots: { index: false, follow: true, noarchive: true } });
  assert.match(html, /<meta name="robots" content="noindex, follow, noarchive">/);
});

test('metadata.robots: string form passes through unchanged', () => {
  const html = render({ robots: 'noindex, nofollow' });
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
});

test('metadata.robots.googleBot emits a separate <meta name="googlebot">', () => {
  const html = render({ robots: { googleBot: 'index, max-snippet:-1' } });
  assert.match(html, /<meta name="googlebot" content="index, max-snippet:-1">/);
});

test('metadata.keywords: array joins with comma-space; string passes through', () => {
  const html = render({ keywords: ['ai', 'web components', 'no-build'] });
  assert.match(html, /<meta name="keywords" content="ai, web components, no-build">/);
  const html2 = render({ keywords: 'a, b' });
  assert.match(html2, /<meta name="keywords" content="a, b">/);
});

test('metadata.authors: single + array forms emit <meta name="author"> + optional <link rel="author">', () => {
  const html = render({
    authors: [
      { name: 'Vivek', url: 'https://vivek.dev' },
      { name: 'Alice' },
      'Bob (string form)',
    ],
  });
  assert.match(html, /<meta name="author" content="Vivek">/);
  assert.match(html, /<link rel="author" href="https:\/\/vivek\.dev">/);
  assert.match(html, /<meta name="author" content="Alice">/);
  assert.match(html, /<meta name="author" content="Bob \(string form\)">/);
});

test('metadata: creator / publisher / applicationName / generator / referrer', () => {
  const html = render({
    creator: 'C',
    publisher: 'P',
    applicationName: 'webjs',
    generator: 'webjs 0.5',
    referrer: 'origin-when-cross-origin',
  });
  assert.match(html, /<meta name="creator" content="C">/);
  assert.match(html, /<meta name="publisher" content="P">/);
  assert.match(html, /<meta name="application-name" content="webjs">/);
  assert.match(html, /<meta name="generator" content="webjs 0\.5">/);
  assert.match(html, /<meta name="referrer" content="origin-when-cross-origin">/);
});

test('metadata.alternates.canonical emits <link rel="canonical">', () => {
  const html = render({ alternates: { canonical: 'https://example.com/post' } });
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.com\/post">/);
});

test('metadata.alternates.languages emits hreflang <link>s', () => {
  const html = render({
    alternates: {
      languages: { 'es-ES': 'https://example.com/es', 'fr-FR': 'https://example.com/fr' },
    },
  });
  assert.match(html, /<link rel="alternate" hreflang="es-ES" href="https:\/\/example\.com\/es">/);
  assert.match(html, /<link rel="alternate" hreflang="fr-FR" href="https:\/\/example\.com\/fr">/);
});

test('metadata.alternates.media + alternates.types emit media + type alternates', () => {
  const html = render({
    alternates: {
      media: { 'only screen and (max-width: 600px)': '/mobile' },
      types: { 'application/rss+xml': '/rss.xml' },
    },
  });
  assert.match(html, /<link rel="alternate" media="only screen and \(max-width: 600px\)" href="\/mobile">/);
  assert.match(html, /<link rel="alternate" type="application\/rss\+xml" href="\/rss\.xml">/);
});

test('metadata.metadataBase: relative og:image becomes absolute', () => {
  const html = render({
    metadataBase: 'https://example.com',
    openGraph: { image: '/og.png' },
  });
  assert.match(html, /<meta property="og:image" content="https:\/\/example\.com\/og\.png">/);
});

test('metadata.metadataBase: relative canonical + hreflang become absolute', () => {
  const html = render({
    metadataBase: 'https://example.com/',
    alternates: {
      canonical: '/post',
      languages: { 'es-ES': '/es' },
    },
  });
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.com\/post">/);
  assert.match(html, /<link rel="alternate" hreflang="es-ES" href="https:\/\/example\.com\/es">/);
});

test('metadata.metadataBase: absolute URLs pass through untouched', () => {
  const html = render({
    metadataBase: 'https://example.com',
    openGraph: { image: 'https://cdn.test/og.png' },
    alternates: { canonical: 'https://other.test/post' },
  });
  assert.match(html, /<meta property="og:image" content="https:\/\/cdn\.test\/og\.png">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/other\.test\/post">/);
});

/* ------------ title template propagation across nested metadata layers ------------ */

async function makeLayeredRoute(...metadataSources) {
  const sub = mkdtempSync(join(tmpDir, 'meta-route-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });
  const pageFile = join(appDir, 'page.js');
  writeFileSync(
    pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function P() { return html\`<main>p</main>\`; }\n`,
  );
  const metadataFiles = metadataSources.map((src, i) => {
    const f = join(appDir, `meta-${i}.js`);
    writeFileSync(f, src);
    return f;
  });
  return {
    route: { file: pageFile, layouts: [], errors: [], metadataFiles },
    appDir,
  };
}

test('title template: page string title is wrapped by root template', async () => {
  const { route, appDir } = await makeLayeredRoute(
    // Root (outer): template + default
    `export const metadata = { title: { template: '%s: webjs', default: 'webjs' } };`,
    // Page (inner): plain string title
    `export const metadata = { title: 'Hello' };`,
  );
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
  const html = await resp.text();
  assert.match(html, /<title>Hello: webjs<\/title>/);
});

test('title template: page omits title; root default is used', async () => {
  const { route, appDir } = await makeLayeredRoute(
    `export const metadata = { title: { template: '%s: webjs', default: 'webjs' } };`,
  );
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
  const html = await resp.text();
  assert.match(html, /<title>webjs<\/title>/);
});

test('title template: page absolute title escapes the template', async () => {
  const { route, appDir } = await makeLayeredRoute(
    `export const metadata = { title: { template: '%s: webjs', default: 'webjs' } };`,
    `export const metadata = { title: { absolute: 'A standalone title' } };`,
  );
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
  const html = await resp.text();
  assert.match(html, /<title>A standalone title<\/title>/);
  assert.doesNotMatch(html, /: webjs/);
});

test('title template: deeper layout can override the inherited template', async () => {
  const { route, appDir } = await makeLayeredRoute(
    `export const metadata = { title: { template: '%s: Site', default: 'Site' } };`,
    `export const metadata = { title: { template: '%s: Blog' } };`, // intermediate layout overrides
    `export const metadata = { title: 'Post' };`,                    // page supplies plain string
  );
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
  const html = await resp.text();
  assert.match(html, /<title>Post: Blog<\/title>/);
});

/* ------------ JSON-LD structured data (#260) ------------ */

test('metadata.jsonLd: single object emits one <script type="application/ld+json">', () => {
  const html = render({
    jsonLd: { '@context': 'https://schema.org', '@type': 'Article', headline: 'Hi' },
  });
  const matches = html.match(/<script type="application\/ld\+json">/g) || [];
  assert.equal(matches.length, 1, 'exactly one ld+json script');
  assert.match(
    html,
    /<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"Article","headline":"Hi"\}<\/script>/,
  );
});

test('metadata.jsonLd: HTML-safe escaping prevents a </script> breakout AND stays valid JSON', () => {
  const obj = {
    '@type': 'Thing',
    name: '</script><img src=x onerror=alert(1)>',
    // A malicious payload in KEY position is escaped too (escapeJsonLd runs
    // over the whole stringified blob, keys included), so a key cannot close
    // the tag any more than a value can. A bare HTML comment opener is covered.
    '</script><script>alert(2)</script>': 'k',
    '<!-- c -->': 'c',
    desc: 'a & b',
    sep: 'x y z',
  };
  const html = render({ jsonLd: obj });

  // Pull the exact bytes between the opening and closing ld+json script tags.
  const m = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  );
  assert.ok(m, 'ld+json script present');
  const inner = m[1];

  // SECURITY: the literal `</script>` must NOT appear inside the body, so a
  // value carrying `</script><img ...>` can never close the tag and inject
  // markup. The `<` is emitted as the JSON unicode escape <.
  assert.ok(
    !inner.includes('</script>'),
    `escaped body must not contain a literal </script>: ${inner}`,
  );
  // The strongest invariant: NO raw `<` survives anywhere in the body (value,
  // key, or structural position), so `</script>`, `<script`, `<!--`, and any
  // other tag/comment opener are all impossible to form.
  assert.ok(!inner.includes('<'), `no raw < may survive in the body: ${inner}`);
  assert.ok(inner.includes('\\u003c'), '< is escaped to \\u003c');
  assert.ok(inner.includes('\\u003e'), '> is escaped to \\u003e');
  assert.ok(inner.includes('\\u0026'), '& is escaped to \\u0026');
  assert.ok(inner.includes('\\u2028'), 'U+2028 is escaped');
  assert.ok(inner.includes('\\u2029'), 'U+2029 is escaped');

  // VALIDITY: the escaped body still parses back to the author's exact object
  // (the unicode escapes decode to the original characters).
  assert.deepEqual(JSON.parse(inner), obj);

  // COUNTERFACTUAL: the raw, unescaped JSON.stringify output WOULD have broken
  // out of the script tag (it contains a literal </script>). This is the gap
  // the escaper closes.
  assert.ok(
    JSON.stringify(obj).includes('</script>'),
    'raw stringify contains a literal </script> (the breakout the escaper prevents)',
  );
});

test('metadata.jsonLd: array emits one script per element', () => {
  const article = { '@type': 'Article', headline: 'Post' };
  const crumbs = { '@type': 'BreadcrumbList', itemListElement: [] };
  const html = render({ jsonLd: [article, crumbs] });
  const matches = html.match(/<script type="application\/ld\+json">/g) || [];
  assert.equal(matches.length, 2, 'two ld+json scripts for a two-element array');
  assert.match(html, /"@type":"Article"/);
  assert.match(html, /"@type":"BreadcrumbList"/);
});

test('metadata.jsonLd: a non-object array element is skipped, valid ones still emit', () => {
  const html = render({ jsonLd: [{ '@type': 'Article' }, null, 'not-an-object', 42] });
  const matches = html.match(/<script type="application\/ld\+json">/g) || [];
  assert.equal(matches.length, 1, 'only the one plain object emits a script');
});

test('metadata.jsonLd: a circular reference fails safe (no script, no throw)', () => {
  const obj = { '@type': 'Thing' };
  obj.self = obj; // circular: JSON.stringify throws
  // Must not throw; the whole render still succeeds.
  const html = render({ jsonLd: obj });
  assert.doesNotMatch(html, /application\/ld\+json/);
  assert.match(html, /<title>/, 'the rest of the head still renders');
});

test('metadata.jsonLd via generateMetadata round-trips through the merge', async () => {
  const { route, appDir } = await makeLayeredRoute(
    `export async function generateMetadata(ctx) {\n` +
      `  return { jsonLd: { '@context': 'https://schema.org', '@type': 'Article', headline: 'From-' + ctx.params.slug } };\n` +
      `}`,
  );
  const resp = await ssrPage(
    route,
    { slug: 'gen' },
    new URL('http://localhost/'),
    { dev: false, appDir },
  );
  const html = await resp.text();
  assert.match(html, /<script type="application\/ld\+json">/);
  assert.match(html, /"headline":"From-gen"/);
});

test('metadata.jsonLd: absent emits NO ld+json script (additive no-op)', () => {
  const withLd = render({ title: 'X', jsonLd: { '@type': 'Article' } });
  const withoutLd = render({ title: 'X' });
  assert.match(withLd, /application\/ld\+json/);
  assert.doesNotMatch(withoutLd, /application\/ld\+json/);
  // The head sans the script line is otherwise unchanged by the feature.
  assert.equal(
    withLd.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\n?/g, ''),
    withoutLd,
    'head is byte-identical once the ld+json script is removed',
  );
});

test('metadata.jsonLd: renders fine under CSP and carries NO nonce (data block, not script)', async () => {
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export const metadata = { jsonLd: { '@type': 'Article', headline: 'csp' } };\n` +
      `export default function Page() { return html\`<p>ok</p>\`; }\n`,
    metadata:
      `export const metadata = { jsonLd: { '@type': 'Article', headline: 'csp' } };\n`,
  });
  const req = new Request('http://localhost/', {
    headers: { 'content-security-policy': "script-src 'nonce-cspLdNonce1' 'self'" },
  });
  const resp = await withRequest(req, () =>
    ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir, req }));
  const body = await resp.text();
  // The ld+json block is present and NOT broken by CSP.
  assert.match(body, /<script type="application\/ld\+json">\{"@type":"Article","headline":"csp"\}<\/script>/);
  // It is a non-executable data island, so it must NOT carry the nonce.
  assert.doesNotMatch(
    body,
    /<script type="application\/ld\+json" nonce=/,
    'ld+json data block must not carry a CSP nonce',
  );
});

/* ------------ Metadata parity: icons + manifest ------------ */

test('metadata.icons: string shorthand sets <link rel="icon">', () => {
  const html = render({ icons: '/favicon.svg' });
  assert.match(html, /<link rel="icon" href="\/favicon\.svg">/);
});

test('metadata.icons: object form with icon/apple/shortcut', () => {
  const html = render({
    icons: {
      icon: '/favicon.svg',
      apple: '/apple-touch-icon.png',
      shortcut: '/favicon.ico',
    },
  });
  assert.match(html, /<link rel="icon" href="\/favicon\.svg">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/);
  assert.match(html, /<link rel="shortcut icon" href="\/favicon\.ico">/);
});

test('metadata.icons: array form with {url, sizes, type}', () => {
  const html = render({
    icons: {
      icon: [
        { url: '/icon-16.png', sizes: '16x16', type: 'image/png' },
        { url: '/icon-32.png', sizes: '32x32', type: 'image/png' },
      ],
    },
  });
  assert.match(html, /<link rel="icon" href="\/icon-16\.png" sizes="16x16" type="image\/png">/);
  assert.match(html, /<link rel="icon" href="\/icon-32\.png" sizes="32x32" type="image\/png">/);
});

test('metadata.icons.other: arbitrary rel allowed', () => {
  const html = render({
    icons: {
      other: [
        { rel: 'mask-icon', url: '/mask.svg', type: 'image/svg+xml' },
      ],
    },
  });
  assert.match(html, /<link rel="mask-icon" href="\/mask\.svg" type="image\/svg\+xml">/);
});

/* ------------ Auto-linked icon metadata routes ------------ */

// `app/icon.*` served its bytes and nothing linked them, so the file every
// other framework treats as "this is my favicon" produced a blank tab with no
// diagnostic. Next links its static icon files; these pin the parity, and the
// precedence rule that comes with it.
//
// setMetadataIconRoutes is module state (the setClientRouterEnabled shape), so
// each test clears it rather than leaking a link into every later assertion.
const withIconRoutes = (t, stems) => {
  setMetadataIconRoutes(stems.map((stem) => ({ stem })));
  t.after(() => setMetadataIconRoutes(null));
};

test('icon metadata route: linked automatically when no icons are declared', (t) => {
  withIconRoutes(t, ['icon']);
  assert.match(render({}), /<link rel="icon" href="\/icon">/);
});

test('apple-icon metadata route: linked as apple-touch-icon', (t) => {
  withIconRoutes(t, ['icon', 'apple-icon']);
  const html = render({});
  assert.match(html, /<link rel="icon" href="\/icon">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/apple-icon">/);
});

test('icon metadata route: no type or sizes is asserted for it', (t) => {
  // The route picks its content type at request time, which is the reason to
  // use one, so a declared type could contradict the bytes it serves.
  withIconRoutes(t, ['icon']);
  assert.match(render({}), /<link rel="icon" href="\/icon">/);
  assert.doesNotMatch(render({}), /href="\/icon"[^>]*(type|sizes)=/);
});

test('a declared metadata.icons suppresses the icon route (Next precedence)', (t) => {
  // Next merges its static icon files only when the resolved metadata has no
  // `icons`. An author who names their icons has said which ones they want,
  // and the route is often a placeholder the app has outgrown, which is
  // exactly the gallery's case.
  withIconRoutes(t, ['icon', 'apple-icon']);
  const html = render({ icons: '/public/favicon.svg' });
  assert.match(html, /<link rel="icon" href="\/public\/favicon\.svg">/);
  assert.doesNotMatch(html, /href="\/icon"/);
  assert.doesNotMatch(html, /href="\/apple-icon"/);
});

test('non-icon metadata routes never emit an icon link', (t) => {
  // sitemap / robots / manifest / og-image share the metadata-route mechanism
  // and are not favicons.
  withIconRoutes(t, ['sitemap', 'robots', 'manifest', 'opengraph-image', 'twitter-image']);
  assert.doesNotMatch(render({}), /<link rel="[^"]*icon/);
});

test('no icon route and no declared icons: no icon link at all', (t) => {
  // The counterfactual for the whole feature. An app with neither must render
  // byte-identically to before.
  withIconRoutes(t, []);
  assert.doesNotMatch(render({}), /<link rel="[^"]*icon/);
});

test('metadata.icons + metadataBase: relative URLs are absolutified', () => {
  const html = render({
    metadataBase: 'https://example.com',
    icons: { icon: '/favicon.svg', apple: '/apple.png' },
  });
  assert.match(html, /<link rel="icon" href="https:\/\/example\.com\/favicon\.svg">/);
  assert.match(html, /<link rel="apple-touch-icon" href="https:\/\/example\.com\/apple\.png">/);
});

test('metadata.manifest: emits <link rel="manifest">', () => {
  const html = render({ manifest: '/manifest.webmanifest' });
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
});

/* ------------ Metadata parity: verification ------------ */

test('metadata.verification: google/yandex/yahoo/me emit canonical meta names', () => {
  const html = render({
    verification: {
      google: 'g-token',
      yandex: 'y-token',
      yahoo: 'yahoo-token',
      me: 'https://me.example',
    },
  });
  assert.match(html, /<meta name="google-site-verification" content="g-token">/);
  assert.match(html, /<meta name="yandex-verification" content="y-token">/);
  assert.match(html, /<meta name="y_key" content="yahoo-token">/);
  assert.match(html, /<meta name="me" content="https:\/\/me\.example">/);
});

test('metadata.verification: array form emits multiple <meta>s with the same name', () => {
  const html = render({ verification: { google: ['token-a', 'token-b'] } });
  assert.match(html, /<meta name="google-site-verification" content="token-a">/);
  assert.match(html, /<meta name="google-site-verification" content="token-b">/);
});

test('metadata.verification.other: arbitrary <meta name="…"> entries', () => {
  const html = render({
    verification: { other: { 'facebook-domain-verification': 'fb-token' } },
  });
  assert.match(html, /<meta name="facebook-domain-verification" content="fb-token">/);
});

/* ------------ Metadata parity: viewport object + split-export ------------ */

test('metadata.viewport: object form serializes to comma-separated content', () => {
  const html = render({
    viewport: { width: 'device-width', initialScale: 1, maximumScale: 5, userScalable: true },
  });
  assert.match(
    html,
    /<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5,user-scalable=yes">/,
  );
});

test('metadata.viewport: user-scalable=false emits user-scalable=no', () => {
  const html = render({ viewport: { width: 'device-width', userScalable: false } });
  assert.match(html, /user-scalable=no/);
});

test('metadata.viewport: string form still works (legacy)', () => {
  const html = render({ viewport: 'width=device-width,initial-scale=1.0' });
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1\.0">/);
});

test('metadata.colorScheme: emits <meta name="color-scheme">', () => {
  const html = render({ colorScheme: 'light dark' });
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
});

test('split `viewport` export: collectMetadata picks it up alongside metadata', async () => {
  const { route, appDir } = await makeLayeredRoute(
    `export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#000' };
     export const metadata = { title: 'X' };`,
  );
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
  const html = await resp.text();
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
  // themeColor on the viewport export bubbles up.
  assert.match(html, /<meta name="theme-color" content="#000">/);
});

/* ------------ Metadata parity: long-tail + `other` passthrough ------------ */

test('metadata.appleWebApp: object form emits apple-mobile-web-app meta tags', () => {
  const html = render({
    appleWebApp: {
      capable: true,
      title: 'My App',
      statusBarStyle: 'black-translucent',
    },
  });
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="My App">/);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">/);
});

test('metadata.appleWebApp.startupImage: emits <link rel="apple-touch-startup-image">', () => {
  const html = render({
    appleWebApp: {
      startupImage: [
        { url: '/splash-1.png', media: '(device-width: 320px)' },
        '/splash-2.png',
      ],
    },
  });
  assert.match(html, /<link rel="apple-touch-startup-image" href="\/splash-1\.png" media="\(device-width: 320px\)">/);
  assert.match(html, /<link rel="apple-touch-startup-image" href="\/splash-2\.png">/);
});

test('metadata.appleWebApp: true shorthand emits just the `capable` tag', () => {
  const html = render({ appleWebApp: true });
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
});

test('metadata.formatDetection: combines bool fields into a content string', () => {
  const html = render({
    formatDetection: { telephone: false, address: false, email: true },
  });
  assert.match(
    html,
    /<meta name="format-detection" content="telephone=no, address=no, email=yes">/,
  );
});

test('metadata.itunes: appId + appArgument emit apple-itunes-app meta', () => {
  const html = render({ itunes: { appId: '12345', appArgument: 'myapp://open' } });
  assert.match(html, /<meta name="apple-itunes-app" content="app-id=12345, app-argument=myapp:\/\/open">/);
});

test('metadata: category / classification / abstract emit <meta name="…">', () => {
  const html = render({
    category: 'tech',
    classification: 'documentation',
    abstract: 'A short summary',
  });
  assert.match(html, /<meta name="category" content="tech">/);
  assert.match(html, /<meta name="classification" content="documentation">/);
  assert.match(html, /<meta name="abstract" content="A short summary">/);
});

test('metadata: archives / assets / bookmarks emit <link rel="…">', () => {
  const html = render({
    archives: ['/archive-2024', '/archive-2023'],
    assets: '/assets-cdn',
    bookmarks: ['/bm-1', '/bm-2'],
  });
  assert.match(html, /<link rel="archives" href="\/archive-2024">/);
  assert.match(html, /<link rel="archives" href="\/archive-2023">/);
  assert.match(html, /<link rel="assets" href="\/assets-cdn">/);
  assert.match(html, /<link rel="bookmark" href="\/bm-1">/);
  assert.match(html, /<link rel="bookmark" href="\/bm-2">/);
});

test('metadata.other: arbitrary meta key passthrough; supports string + array values', () => {
  const html = render({
    other: {
      'facebook-domain-verification': 'fb-token',
      'msvalidate.01': ['bing-token-a', 'bing-token-b'],
      'custom-key': 'custom-value',
    },
  });
  assert.match(html, /<meta name="facebook-domain-verification" content="fb-token">/);
  assert.match(html, /<meta name="msvalidate\.01" content="bing-token-a">/);
  assert.match(html, /<meta name="msvalidate\.01" content="bing-token-b">/);
  assert.match(html, /<meta name="custom-key" content="custom-value">/);
});

/* ------------ ssrPage integration: cache-control + data-layout wrapping ------------ */

async function makeRoute({ pageSrc, layoutSrc, metadata = null }) {
  const sub = mkdtempSync(join(tmpDir, 'route-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });
  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile, pageSrc);
  const files = { file: pageFile, layouts: [] };
  if (layoutSrc) {
    const layoutFile = join(appDir, 'layout.js');
    writeFileSync(layoutFile, layoutSrc);
    files.layouts = [layoutFile];
  }
  if (metadata) {
    const metaFile = join(appDir, 'metadata.js');
    writeFileSync(metaFile, metadata);
    files.metadataFiles = [metaFile];
  }
  return {
    route: {
      file: files.file,
      layouts: files.layouts,
      errors: [],
      metadataFiles: files.metadataFiles || [],
    },
    appDir,
  };
}

test('ssrPage: default cache-control is no-store (opt-in caching)', async () => {
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Page() { return html\`<p>plain page</p>\`; }\n`,
  });
  const url = new URL('http://localhost/');
  const resp = await ssrPage(route, {}, url, { dev: false, appDir });
  assert.equal(resp.headers.get('cache-control'), 'no-store');
});

test('ssrPage: page metadata.cacheControl is honoured', async () => {
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export const metadata = { cacheControl: 'public, max-age=60' };\n` +
      `export default function Page() { return html\`<p>cached</p>\`; }\n`,
    metadata:
      `export const metadata = { cacheControl: 'public, max-age=60' };\n`,
  });
  const url = new URL('http://localhost/');
  const resp = await ssrPage(route, {}, url, { dev: false, appDir });
  assert.equal(resp.headers.get('cache-control'), 'public, max-age=60');
});

test('ssrPage: emits the KEYED boundary pair around the page slot for each layout (#1015)', async () => {
  // Each layout's ${children} interpolation is wrapped in a keyed comment
  // boundary pair: open <!--wj:children:<segment>:<route-key>-->, close
  // <!--/wj:children:<segment>-->. The keyed close makes client pairing
  // deterministic id-matching (no LIFO), and the route-key drives the
  // two-tier REPLACE/MORPH decision. A static segment's key equals it.
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Page() { return html\`<p>page content</p>\`; }\n`,
    layoutSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Layout({ children }) {\n` +
      `  return html\`<div class="shell">\${children}</div>\`;\n` +
      `}\n`,
  });
  const url = new URL('http://localhost/');
  const resp = await ssrPage(route, {}, url, { dev: false, appDir });
  const body = await resp.text();
  // Boundary for the root layout: segment '/', route-key '/'.
  assert.ok(body.includes('<!--wj:children:/:/-->'),
    `expected keyed open boundary for root layout, got: ${body.slice(0, 600)}`);
  assert.ok(body.includes('<!--/wj:children:/-->'),
    `expected keyed close boundary, got: ${body.slice(0, 600)}`);
  // The shell wraps the boundary, not the other way around: the layout
  // markup is OUTSIDE its own children-slot boundary.
  const idxShell = body.indexOf('class="shell"');
  const idxOpen = body.indexOf('<!--wj:children:/:/-->');
  const idxPage = body.indexOf('page content');
  const idxClose = body.indexOf('<!--/wj:children:/-->');
  assert.ok(idxShell < idxOpen, 'layout markup precedes the boundary');
  assert.ok(idxOpen < idxPage, 'open boundary precedes page content');
  assert.ok(idxPage < idxClose, 'close boundary follows page content');
});

test('ssrPage: a dynamic page gets its own boundary with the RESOLVED route-key (#1015)', async () => {
  // A page whose segment differs from the innermost layout (here: page
  // '/blog/[slug]' under root layout '/') gets its OWN keyed boundary whose
  // route-key is the resolved path, so a param change (/blog/a -> /blog/b)
  // REPLACES (remounts) the page while the root layout boundary (key '/')
  // is preserved. The dynamic [slug] is substituted from resolved params.
  const sub = mkdtempSync(join(tmpDir, 'boundary-dyn-'));
  const appDir = join(sub, 'app');
  const pageDir = join(appDir, 'blog', '[slug]');
  mkdirSync(pageDir, { recursive: true });
  const layoutFile = join(appDir, 'layout.js');
  const pageFile = join(pageDir, 'page.js');
  writeFileSync(layoutFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function Layout({ children }) { return html\`<div class="shell">\${children}</div>\`; }\n`);
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function Page() { return html\`<article>post</article>\`; }\n`);
  const route = { file: pageFile, layouts: [layoutFile], errors: [], metadataFiles: [] };
  const url = new URL('http://localhost/blog/a');
  const resp = await ssrPage(route, { slug: 'a' }, url, { dev: false, appDir });
  const body = await resp.text();
  assert.ok(body.includes('<!--wj:children:/:/-->'), 'root layout boundary present');
  assert.ok(body.includes('<!--wj:children:/blog/[slug]:/blog/a-->'),
    `expected page boundary with resolved route-key, got: ${body.slice(0, 900)}`);
  assert.ok(body.includes('<!--/wj:children:/blog/[slug]-->'), 'page boundary closed with its segment');
  // The page boundary nests INSIDE the root layout boundary.
  assert.ok(
    body.indexOf('<!--wj:children:/:/-->') < body.indexOf('<!--wj:children:/blog/[slug]:'),
    'page boundary nests inside the layout boundary',
  );
});

test('ssrPage: X-Webjs-Have skips rendering layouts above the deepest match', async () => {
  // The client tells the server "I already have layouts at / and /docs"
  // via the X-Webjs-Have header. Server must short-circuit at /docs -
  // emit only the page content wrapped in the /docs marker pair, never
  // re-render the docs layout's outer markup (header/sidenav/etc.).
  const { route, appDir, tmpDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Page() { return html\`<p>page body</p>\`; }\n`,
    layoutSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Layout({ children }) {\n` +
      `  return html\`<div class="HEAVY-OUTER-LAYOUT">\${children}</div>\`;\n` +
      `}\n`,
  });

  const url = new URL('http://localhost/');
  const req = new Request(url.toString(), {
    headers: { 'x-webjs-have': '/:/' },
  });
  const resp = await ssrPage(route, {}, url, { dev: false, appDir, req });
  const body = await resp.text();

  // The outer layout's distinctive markup must NOT appear: it was skipped.
  assert.ok(!body.includes('HEAVY-OUTER-LAYOUT'),
    `outer layout should be skipped, but body contains it. got: ${body.slice(0, 500)}`);
  // The page content is still present, wrapped in the matched keyed boundary.
  assert.ok(body.includes('<!--wj:children:/:/-->'), 'matched keyed boundary present');
  assert.ok(body.includes('page body'), 'page content present');
});

test('ssrPage: a REDUCED response is never shared-cacheable, whatever the page declared (#1140)', async () => {
  // Vary is not a guarantee in practice. Cloudflare honours only
  // Accept-Encoding, so on a page that opted into public caching the reduced
  // fragment was handed to CDNs under the full page's URL, to be served to
  // whoever navigated there next. The fragment must therefore be
  // non-shared-cacheable at the source, not merely Vary-scoped.
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export const metadata = { cacheControl: 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400' };\n` +
      `export default function Page() { return html\`<p>page body</p>\`; }\n`,
    layoutSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Layout({ children }) { return html\`<div class="OUTER">\${children}</div>\`; }\n`,
    metadata:
      `export const metadata = { cacheControl: 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400' };\n`,
  });
  const url = new URL('http://localhost/');

  const haveReq = new Request(url.toString(), { headers: { 'x-webjs-have': '/:/' } });
  const reduced = await ssrPage(route, {}, url, { dev: false, appDir, req: haveReq });
  const reducedBody = await reduced.text();
  assert.ok(!reducedBody.includes('OUTER'), 'sanity: the response really was reduced');

  const cc = reduced.headers.get('cache-control') || '';
  assert.match(cc, /(^|,)\s*private\s*(,|$)/, `a reduced body must be private, got: ${cc}`);
  assert.doesNotMatch(cc, /(^|,)\s*public\s*(,|$)/, `a reduced body must not be public, got: ${cc}`);
  assert.doesNotMatch(cc, /s-maxage/i, `a reduced body must carry no shared-cache TTL, got: ${cc}`);
  // The client-facing freshness the page declared survives: this is about
  // SHARED caches, not about forbidding the requesting browser to reuse it.
  assert.match(cc, /max-age=60/, `the client-facing freshness is preserved, got: ${cc}`);
  // Belt-and-braces for caches that DO honour Vary.
  assert.ok((reduced.headers.get('vary') || '').includes('X-Webjs-Have'), 'Vary is still sent');

  // The full document is untouched: edge-cacheability is the whole point of
  // metadata.cacheControl and a blanket downgrade would silently undo #1127.
  const fullResp = await ssrPage(route, {}, url, { dev: false, appDir });
  assert.equal(fullResp.headers.get('cache-control'),
    'public, max-age=60, s-maxage=600, stale-while-revalidate=86400',
    'a full document keeps the page-declared Cache-Control byte for byte');
});

test('ssrPage: a QUALIFIED private is still downgraded on a fragment (#1140)', async () => {
  // `private="x-user"` marks only the NAMED header fields private per RFC 9111
  // and leaves the response itself storable by a shared cache, so it must not
  // be mistaken for an already-unshareable value and passed through.
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export const metadata = { cacheControl: 'private="x-user", public, max-age=60, s-maxage=600' };\n` +
      `export default function Page() { return html\`<p>page body</p>\`; }\n`,
    layoutSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Layout({ children }) { return html\`<div class="OUTER">\${children}</div>\`; }\n`,
    metadata:
      `export const metadata = { cacheControl: 'private="x-user", public, max-age=60, s-maxage=600' };\n`,
  });
  const url = new URL('http://localhost/');
  const req = new Request(url.toString(), { headers: { 'x-webjs-have': '/:/' } });
  const resp = await ssrPage(route, {}, url, { dev: false, appDir, req });
  const body = await resp.text();
  assert.ok(!body.includes('OUTER'), 'sanity: the response really was reduced');

  const cc = resp.headers.get('cache-control') || '';
  assert.doesNotMatch(cc, /(^|,)\s*public\s*(,|$)/, `public must be stripped, got: ${cc}`);
  assert.doesNotMatch(cc, /s-maxage/i, `the shared TTL must be stripped, got: ${cc}`);
  assert.match(cc, /(^|,)\s*private\s*(,|$)/, `a bare private must be added, got: ${cc}`);
  // The qualified form must be REPLACED, not joined by a bare one. A header
  // carrying `private` twice is ambiguous: a cache resolving the repeat by
  // last-occurrence reads the qualified form, which leaves the response
  // shared-storable, which is the hazard this whole change removes.
  assert.equal((cc.match(/(^|,)\s*private/g) || []).length, 1,
    `private must appear exactly once, got: ${cc}`);
  assert.doesNotMatch(cc, /private\s*=/, `the qualified form must not survive, got: ${cc}`);
});

test('ssrPage: a quoted directive argument survives the downgrade intact (#1140)', async () => {
  // A quoted argument carries a comma INSIDE it. A splitter that is not
  // quote-aware tears it in two, and re-joining reassembles it with DIFFERENT
  // inner spacing, so the argument no longer round-trips byte for byte. The
  // no-space form is what discriminates: with a space after the comma the
  // naive split happens to rebuild the original and proves nothing.
  const declared = 'public, max-age=60, s-maxage=600, no-cache="Set-Cookie,X-Foo"';
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export const metadata = { cacheControl: '${declared}' };\n` +
      `export default function Page() { return html\`<p>page body</p>\`; }\n`,
    layoutSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Layout({ children }) { return html\`<div class="OUTER">\${children}</div>\`; }\n`,
    metadata:
      `export const metadata = { cacheControl: '${declared}' };\n`,
  });
  const url = new URL('http://localhost/');
  const req = new Request(url.toString(), { headers: { 'x-webjs-have': '/:/' } });
  const resp = await ssrPage(route, {}, url, { dev: false, appDir, req });
  await resp.text();

  const cc = resp.headers.get('cache-control') || '';
  assert.ok(cc.includes('no-cache="Set-Cookie,X-Foo"'),
    `the quoted argument must survive byte for byte, got: ${cc}`);
  assert.match(cc, /(^|,)\s*private\s*(,|$)/, `still downgraded, got: ${cc}`);
  assert.doesNotMatch(cc, /s-maxage/i, `shared TTL stripped, got: ${cc}`);
});

test('ssrPage: a non-200 never inherits the page cacheControl (#1140)', async () => {
  // The page-action re-render is a 422 carrying the submitter's own field
  // values and errors. It must not go out shared-cacheable just because the
  // page opted into public caching.
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export const metadata = { cacheControl: 'public, max-age=60, s-maxage=600' };\n` +
      `export default function Page() { return html\`<p>page body</p>\`; }\n`,
    metadata:
      `export const metadata = { cacheControl: 'public, max-age=60, s-maxage=600' };\n`,
  });
  const url = new URL('http://localhost/');
  const ok = await ssrPage(route, {}, url, { dev: false, appDir });
  assert.equal(ok.headers.get('cache-control'), 'public, max-age=60, s-maxage=600',
    'a 200 still honours the page cacheControl');
  const errored = await ssrPage(route, {}, url, { dev: false, appDir, status: 422 });
  assert.equal(errored.headers.get('cache-control'), 'no-store',
    'a 422 re-render is never cacheable');
});

test('ssrPage: a REDUCED have-response carries Vary: X-Webjs-Have; a full one does not (#1009)', async () => {
  // A reduced response (outer chrome omitted) under a URL-only cache key is
  // latent cache poisoning: a shared cache could serve the fragment to a
  // fresh full-page navigation. Vary scopes the key. A normal full response
  // must NOT grow the header (its cache key stays URL-only).
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Page() { return html\`<p>page body</p>\`; }\n`,
    layoutSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Layout({ children }) { return html\`<div class="OUTER">\${children}</div>\`; }\n`,
  });
  const url = new URL('http://localhost/');

  // Reduced: the client already has '/'.
  const haveReq = new Request(url.toString(), { headers: { 'x-webjs-have': '/:/' } });
  const reducedResp = await ssrPage(route, {}, url, { dev: false, appDir, req: haveReq });
  assert.ok((reducedResp.headers.get('vary') || '').includes('X-Webjs-Have'),
    `a reduced response varies on X-Webjs-Have, got: ${reducedResp.headers.get('vary')}`);
  const reducedBody = await reducedResp.text();
  assert.ok(!reducedBody.includes('OUTER'), 'sanity: the response really was reduced');

  // A have header that matches NOTHING renders the full page: no Vary.
  const missReq = new Request(url.toString(), { headers: { 'x-webjs-have': '/nomatch:/nomatch' } });
  const missResp = await ssrPage(route, {}, url, { dev: false, appDir, req: missReq });
  assert.ok(!(missResp.headers.get('vary') || '').includes('X-Webjs-Have'),
    'a non-matching have renders full and must NOT vary');

  // No have header at all: full page, no Vary.
  const fullResp = await ssrPage(route, {}, url, { dev: false, appDir });
  assert.ok(!(fullResp.headers.get('vary') || '').includes('X-Webjs-Have'),
    'a plain full-page response must NOT vary on X-Webjs-Have');
  const fullBody = await fullResp.text();
  assert.ok(fullBody.includes('OUTER'), 'sanity: the full response has the chrome');
});

test('ssrPage: a DYNAMIC layout the client has for OTHER params is re-rendered, not short-circuited (#1015)', async () => {
  // The have entry carries the route-key: '/[org]:/a' means "I hold the [org]
  // layout rendered for org-a". Navigating to org-b, the server must NOT
  // short-circuit at [org] (the client's copy shows the wrong org chrome);
  // it re-renders the layout so the client's parent-anchored REPLACE has the
  // fresh markup. The static root ('/:/') still short-circuits.
  const sub = mkdtempSync(join(tmpDir, 'have-dynkey-'));
  const appDir = join(sub, 'app');
  mkdirSync(join(appDir, '[org]', 'settings'), { recursive: true });
  const rootLayout = join(appDir, 'layout.js');
  const orgLayout = join(appDir, '[org]', 'layout.js');
  const pageFile = join(appDir, '[org]', 'settings', 'page.js');
  writeFileSync(rootLayout,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function Root({ children }) { return html\`<div class="ROOT-CHROME">\${children}</div>\`; }\n`);
  writeFileSync(orgLayout,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function Org({ children, params }) { return html\`<h1 class="ORG-CHROME">\${params.org}</h1>\${children}\`; }\n`);
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function Page() { return html\`<p>settings</p>\`; }\n`);
  const route = { file: pageFile, layouts: [rootLayout, orgLayout], errors: [], metadataFiles: [] };
  const url = new URL('http://localhost/b/settings');
  const req = new Request(url.toString(), {
    // The client holds the root (static, key matches) and the [org] layout
    // rendered for org-a (key MISMATCH for this org-b navigation).
    headers: { 'x-webjs-have': '/:/,/[org]:/a' },
  });
  const resp = await ssrPage(route, { org: 'b' }, url, { dev: false, appDir, req });
  const body = await resp.text();
  assert.ok(!body.includes('ROOT-CHROME'),
    `the static root layout still short-circuits, got: ${body.slice(0, 500)}`);
  assert.ok(body.includes('ORG-CHROME'),
    `the [org] layout was RE-RENDERED for org-b (key mismatch), got: ${body.slice(0, 500)}`);
  assert.ok(body.includes('>b</h1>'), 'the re-rendered layout carries the NEW param');
  assert.ok(body.includes('<!--wj:children:/[org]:/b-->'),
    'the re-rendered layout children boundary carries the new route-key');
});

test('ssrPage: a frame-subtree response varies on X-Webjs-Frame (shared-cache safety)', async () => {
  // The subtree is sliced by the x-webjs-frame REQUEST header, so a shared
  // cache must key on it or a full-page navigation could be served the lone
  // frame subtree (the #1009 poisoning shape).
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Page() { return html\`<webjs-frame id="panel"><p>frame body</p></webjs-frame>\`; }\n`,
  });
  const url = new URL('http://localhost/');
  const req = new Request(url.toString(), { headers: { 'x-webjs-frame': 'panel' } });
  const resp = await ssrPage(route, {}, url, { dev: false, appDir, req });
  assert.ok((resp.headers.get('vary') || '').includes('X-Webjs-Frame'),
    `a frame subtree varies on X-Webjs-Frame, got: ${resp.headers.get('vary')}`);
  const body = await resp.text();
  assert.ok(body.includes('frame body'), 'sanity: the frame subtree was returned');
});

test('ssrPage: a frame subtree is never shared-cacheable either (#1140)', async () => {
  // Same reasoning as the reduced-have case: the subtree is sliced by a
  // request header, so a CDN that ignores Vary could serve the lone frame to
  // a full-page navigation.
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export const metadata = { cacheControl: 'public, max-age=60, s-maxage=600' };\n` +
      `export default function Page() { return html\`<webjs-frame id="panel"><p>frame body</p></webjs-frame>\`; }\n`,
    metadata:
      `export const metadata = { cacheControl: 'public, max-age=60, s-maxage=600' };\n`,
  });
  const url = new URL('http://localhost/');
  const req = new Request(url.toString(), { headers: { 'x-webjs-frame': 'panel' } });
  const resp = await ssrPage(route, {}, url, { dev: false, appDir, req });
  const body = await resp.text();
  assert.ok(body.includes('frame body'), 'sanity: the frame subtree was returned');

  // The contract is "no shared cache may store this", which today the frame
  // path already satisfies by not inheriting the page's cacheControl at all
  // (it builds its response without metadata, so the default no-store applies).
  // Asserted as the CONTRACT rather than as one spelling of it, so the test
  // keeps holding if that response ever starts carrying page metadata.
  const cc = resp.headers.get('cache-control') || '';
  assert.match(cc, /(^|,)\s*(?:no-store|private)\s*(,|$)/,
    `a frame subtree must not be shared-cacheable, got: ${cc}`);
  assert.doesNotMatch(cc, /s-maxage/i, `a frame subtree must carry no shared-cache TTL, got: ${cc}`);
  assert.doesNotMatch(cc, /(^|,)\s*public\s*(,|$)/, `a frame subtree must not be public, got: ${cc}`);
  assert.ok((resp.headers.get('vary') || '').includes('X-Webjs-Frame'), 'Vary is still sent');
});

test('ssrPage: X-Webjs-Have picks deepest match (not just any match)', async () => {
  // Two-level layout chain: root and docs. Client has both.
  // Server should match at /docs (deepest), not / (shallower).
  const sub = mkdtempSync(join(tmpDir, 'have-deepest-'));
  const appDir = join(sub, 'app');
  mkdirSync(join(appDir, 'docs'), { recursive: true });
  const rootLayout = join(appDir, 'layout.js');
  const docsLayout = join(appDir, 'docs', 'layout.js');
  const pageFile = join(appDir, 'docs', 'page.js');
  writeFileSync(rootLayout,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function Root({ children }) { return html\`<div class="ROOT">\${children}</div>\`; }\n`);
  writeFileSync(docsLayout,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function Docs({ children }) { return html\`<div class="DOCS">\${children}</div>\`; }\n`);
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function Page() { return html\`<p>sub page</p>\`; }\n`);

  const route = {
    file: pageFile,
    // layouts[0] = outermost (root), layouts[N-1] = innermost
    layouts: [rootLayout, docsLayout],
    errors: [],
    metadataFiles: [],
  };

  const url = new URL('http://localhost/docs');
  const req = new Request(url.toString(), {
    headers: { 'x-webjs-have': '/:/,/docs:/docs' },
  });
  const resp = await ssrPage(route, {}, url, { dev: false, appDir, req });
  const body = await resp.text();

  // Both outer layouts must be skipped: body has neither's distinctive markup.
  assert.ok(!body.includes('ROOT'), `root layout skipped; got: ${body.slice(0, 600)}`);
  assert.ok(!body.includes('DOCS'), `docs layout skipped; got: ${body.slice(0, 600)}`);
  // Keyed boundary for /docs is present (deepest match).
  assert.ok(body.includes('<!--wj:children:/docs:/docs-->'),
    `deepest matched boundary /docs present, got: ${body.slice(0, 600)}`);
  // Page content is there.
  assert.ok(body.includes('sub page'), 'page content present');
});

test('ssrPage: emits <template id="wj-loading:<path>"> for each loading.ts in the chain', async () => {
  // Two-level loading chain: app/loading.ts and app/docs/loading.ts.
  // Both should emit hidden <template> elements at the end of body
  // keyed by their segment path. The client router clones the
  // deepest matching template on nav-start for an instant per-segment
  // skeleton.
  const sub = mkdtempSync(join(tmpDir, 'loading-templates-'));
  const appDir = join(sub, 'app');
  mkdirSync(join(appDir, 'docs'), { recursive: true });
  const rootLayout = join(appDir, 'layout.js');
  const docsLayout = join(appDir, 'docs', 'layout.js');
  const rootLoading = join(appDir, 'loading.js');
  const docsLoading = join(appDir, 'docs', 'loading.js');
  const pageFile = join(appDir, 'docs', 'page.js');
  writeFileSync(rootLayout,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function R({ children }) { return html\`<div>\${children}</div>\`; }\n`);
  writeFileSync(docsLayout,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function D({ children }) { return html\`<div>\${children}</div>\`; }\n`);
  writeFileSync(rootLoading,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function L() { return html\`<div class="ROOT-SKELETON">root skeleton</div>\`; }\n`);
  writeFileSync(docsLoading,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function L() { return html\`<div class="DOCS-SKELETON">docs skeleton</div>\`; }\n`);
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function P() { return html\`<p>page</p>\`; }\n`);

  const route = {
    file: pageFile,
    layouts: [rootLayout, docsLayout],
    loadings: [rootLoading, docsLoading],
    errors: [],
    metadataFiles: [],
  };

  const url = new URL('http://localhost/docs');
  const resp = await ssrPage(route, {}, url, { dev: false, appDir });
  const body = await resp.text();

  assert.ok(body.includes('<template id="wj-loading:/"'),
    `expected root loading template, got: ${body.slice(-500)}`);
  assert.ok(body.includes('<template id="wj-loading:/docs"'),
    `expected docs loading template, got: ${body.slice(-500)}`);
  assert.ok(body.includes('ROOT-SKELETON'), 'root loading content present');
  assert.ok(body.includes('DOCS-SKELETON'), 'docs loading content present');
});

test('ssrPage: a layoutless route still gets the PAGE boundary (#1015)', async () => {
  // Pre-#1015 a layoutless route emitted no markers at all, leaving the
  // client with only the destructive full-body path. The page-level keyed
  // boundary now always exists, so even a layoutless app gets the two-tier
  // swap (and the integrity gate) on soft navs.
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Page() { return html\`<p>no layout</p>\`; }\n`,
  });
  const url = new URL('http://localhost/');
  const resp = await ssrPage(route, {}, url, { dev: false, appDir });
  const body = await resp.text();
  assert.ok(body.includes('<!--wj:children:/:/-->') && body.includes('<!--/wj:children:/-->'),
    `layoutless route carries the page boundary, got: ${body.slice(0, 400)}`);
});

test('ssrPage: modulepreload never points at server-only files', async () => {
  // Set up a page that imports a .server.ts AND a 'use server' plain .ts.
  // Both files should be excluded from the <link rel="modulepreload"> set:
  // they're server-imports, and the client only ever sees a safe RPC stub
  // served lazily on first import, never a preload.
  const sub = mkdtempSync(join(tmpDir, 'route-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const serverSuffix = join(appDir, 'query.server.ts');
  writeFileSync(serverSuffix,
    `export async function list() { return []; }\n`);

  const useServerPlain = join(appDir, 'db.ts');
  writeFileSync(useServerPlain,
    `'use server';\nexport async function q() { return null; }\n`);

  const pageFile = join(appDir, 'page.ts');
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `import { list } from './query.server.ts';\n` +
    `import { q } from './db.ts';\n` +
    `export default async function Page() {\n` +
    `  await list(); await q();\n` +
    `  return html\`<p>hi</p>\`;\n` +
    `}\n`);

  // Build a minimal module graph mirroring the imports above.
  const moduleGraph = new Map([
    [pageFile, new Set([serverSuffix, useServerPlain])],
    [serverSuffix, new Set()],
    [useServerPlain, new Set()],
  ]);

  // serverFiles mimics the action index (abs-path keyed).
  const serverFiles = new Map([
    [serverSuffix, 'hashA'],
    [useServerPlain, 'hashB'],
  ]);

  const route = { file: pageFile, layouts: [], errors: [], metadataFiles: [] };
  const url = new URL('http://localhost/');
  const resp = await ssrPage(route, {}, url, {
    dev: false,
    appDir,
    moduleGraph,
    serverFiles,
  });
  const body = await resp.text();

  const preloads = (body.match(/modulepreload[^>]*href="[^"]*"/g) || []).join('\n');
  assert.ok(!/\.server\.ts"/.test(preloads),
    `.server.ts should not be preloaded; got preloads:\n${preloads}`);
  assert.ok(!/\bdb\.ts"/.test(preloads),
    `'use server' plain file should not be preloaded; got preloads:\n${preloads}`);
});

test('ssrPage: modulepreload never points at a server-only dep reached THROUGH a .server file', async () => {
  // Regression for #158: a page imports a server action, and the action
  // imports a plain server-only util (the slugify.ts / types.ts shape on the
  // blog). The util is reachable ONLY through the .server file, so the client
  // never fetches it (the action becomes an RPC stub). The preload walk must
  // stop at the .server boundary, exactly like the auth gate; otherwise it
  // emits a <link rel="modulepreload"> for the util, which then 404s.
  // Before the fix, `formatPost.ts` below leaks into the preload set.
  const sub = mkdtempSync(join(tmpDir, 'route-serverdep-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const action = join(appDir, 'list.server.ts');
  const serverOnlyUtil = join(appDir, 'formatPost.ts');   // reached only via the action
  const clientComp = join(appDir, 'card.ts');             // a real client edge, kept

  writeFileSync(serverOnlyUtil, `export const fmt = (p) => p;\n`);
  writeFileSync(action,
    `import { fmt } from './formatPost.ts';\n` +
    `export async function list() { return [fmt(1)]; }\n`);
  writeFileSync(clientComp, `export const card = 1;\n`);

  const pageFile = join(appDir, 'page.ts');
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `import { list } from './list.server.ts';\n` +
    `import './card.ts';\n` +
    `export default async function Page() { await list(); return html\`<my-card></my-card>\`; }\n`);

  // Graph mirrors the imports: page -> {action, card}; action -> {serverOnlyUtil}.
  const moduleGraph = new Map([
    [pageFile, new Set([action, clientComp])],
    [action, new Set([serverOnlyUtil])],
    [serverOnlyUtil, new Set()],
    [clientComp, new Set()],
  ]);
  const serverFiles = new Map([[action, 'hashA']]);

  const route = { file: pageFile, layouts: [], errors: [], metadataFiles: [] };
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), {
    dev: false, appDir, moduleGraph, serverFiles,
  });
  const preloads = ((await resp.text()).match(/modulepreload[^>]*href="[^"]*"/g) || []).join('\n');

  assert.ok(!/formatPost\.ts"/.test(preloads),
    `server-only dep reached through a .server file must not be preloaded; got:\n${preloads}`);
  assert.ok(!/list\.server\.ts"/.test(preloads),
    `the .server file itself is not preloaded; got:\n${preloads}`);
  // The real client edge is still preloaded (the boundary only prunes the
  // server path, it does not drop legitimate client modules).
  assert.ok(/card\.ts"/.test(preloads),
    `a real client dep must still be preloaded; got:\n${preloads}`);
});

test('preloadCrossOriginAttr: adds crossorigin=anonymous for cross-origin URLs only', async () => {
  // Browsers require crossorigin on cross-origin modulepreload, else
  // the preload is ignored or double-fetched (defeating the
  // optimization). Same-origin preloads must NOT have crossorigin
  // (browser would double-fetch in the reverse direction).
  const { preloadCrossOriginAttr } = await import(
    new URL('../../packages/server/src/ssr.js', import.meta.url).href
  );

  // Cross-origin (vendor packages from jspm.io etc.)
  assert.equal(
    preloadCrossOriginAttr('https://ga.jspm.io/npm:dayjs@1.11.20/dayjs.min.js'),
    ' crossorigin="anonymous"',
  );
  assert.equal(
    preloadCrossOriginAttr('http://cdn.example.com/x.js'),
    ' crossorigin="anonymous"',
  );

  // Same-origin (framework + user code)
  assert.equal(preloadCrossOriginAttr('/__webjs/core/index.js'), '');
  assert.equal(preloadCrossOriginAttr('/components/foo.ts'), '');
  assert.equal(preloadCrossOriginAttr('/__webjs/vendor/dayjs@1.11.20.js'), '');
});

/* ------------ ssrNotFound + not-found.js rendering ------------ */

test('ssrNotFound: no notFound file → plain 404 fallback', async () => {
  const resp = await ssrNotFound(null, { dev: false, appDir: tmpDir });
  assert.equal(resp.status, 404);
  const body = await resp.text();
  assert.ok(body.includes('404: Not found'));
});

test('ssrNotFound: renders the user-supplied not-found.js module', async () => {
  const sub = mkdtempSync(join(tmpDir, 'nf-'));
  const notFoundFile = join(sub, 'not-found.js');
  writeFileSync(notFoundFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function NotFound() { return html\`<p>custom missing</p>\`; }\n`);
  const resp = await ssrNotFound(notFoundFile, { dev: false, appDir: sub });
  assert.equal(resp.status, 404);
  const body = await resp.text();
  assert.ok(body.includes('<p>custom missing</p>'));
});

test('ssrNotFound: not-found.js that throws falls back to an inline error body', async () => {
  // The fallback body is DEV-only as of #1298. This used to render the thrown
  // message in production too, which leaks a value the author does not control
  // (a driver message, a path, a DSN) to the client. The 500 path has always
  // drawn that line; these pages now do as well.
  const sub = mkdtempSync(join(tmpDir, 'nf-err-'));
  const notFoundFile = join(sub, 'not-found.js');
  writeFileSync(notFoundFile,
    `export default function NotFound() { throw new Error('boom'); }\n`);

  const dev = await ssrNotFound(notFoundFile, { dev: true, appDir: sub });
  assert.equal(dev.status, 404);
  const devBody = await dev.text();
  assert.ok(devBody.includes('404: Not found'));
  assert.ok(devBody.includes('boom'), 'dev still shows the failure');

  const prod = await ssrNotFound(notFoundFile, { dev: false, appDir: sub });
  assert.equal(prod.status, 404);
  const prodBody = await prod.text();
  assert.ok(prodBody.includes('404: Not found'), 'prod still identifies the status');
  assert.ok(!prodBody.includes('boom'), 'but never renders the thrown message');
});

/* ------------ ssrPage: redirect / notFound / error boundaries ------------ */

test('ssrPage: redirect() thrown during a GET render → 302 Found by default', async () => {
  // A gating redirect during a GET render (auth bounce) is GET-to-GET, so the
  // default is 302, the conventional code there (not the method-preserving 307
  // an action gets). #452.
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { redirect } from ${JSON.stringify(WEBJS_MODULE_URL)};\n` +
      `export default function Page() { redirect('/login'); }\n`,
  });
  const url = new URL('http://localhost/old');
  const resp = await ssrPage(route, {}, url, { dev: false, appDir });
  assert.equal(resp.status, 302, `got status ${resp.status}`);
  assert.equal(resp.headers.get('location'), '/login');
});

test('ssrPage: an explicit redirect() status overrides the 302 GET default', async () => {
  // `redirect(url, 308)` (and the `{ status }` options form) must win over the
  // GET-gate convention.
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { redirect } from ${JSON.stringify(WEBJS_MODULE_URL)};\n` +
      `export default function Page() { redirect('/perm', 308); }\n`,
  });
  const resp = await ssrPage(route, {}, new URL('http://localhost/old'), { dev: false, appDir });
  assert.equal(resp.status, 308);
  assert.equal(resp.headers.get('location'), '/perm');
});

test('ssrPage: the redirect() { status } options form overrides the 302 GET default', async () => {
  // The end-to-end override path for the options form through the GET catch
  // site, not just the sentinel unit test. #452.
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { redirect } from ${JSON.stringify(WEBJS_MODULE_URL)};\n` +
      `export default function Page() { redirect('/perm', { status: 301 }); }\n`,
  });
  const resp = await ssrPage(route, {}, new URL('http://localhost/old'), { dev: false, appDir });
  assert.equal(resp.status, 301);
  assert.equal(resp.headers.get('location'), '/perm');
});

test('ssrPage: notFound() thrown during render → 404 Response', async () => {
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { notFound } from ${JSON.stringify(WEBJS_MODULE_URL)};\n` +
      `export default function Page() { notFound(); }\n`,
  });
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
  assert.equal(resp.status, 404);
});

test('ssrPage: error.js boundary catches a render throw and returns 500', async () => {
  const sub = mkdtempSync(join(tmpDir, 'err-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile,
    `export default function Page() { throw new Error('kaboom'); }\n`);

  const errorFile = join(appDir, 'error.js');
  writeFileSync(errorFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function Err({ error }) {\n` +
    `  return html\`<p>Handled: \${error.message}</p>\`;\n` +
    `}\n`);

  const route = { file: pageFile, layouts: [], errors: [errorFile], metadataFiles: [] };
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
  assert.equal(resp.status, 500);
  const body = await resp.text();
  assert.ok(body.includes('Handled: kaboom'));
});

test('ssrPage: error.js that itself throws falls through to the default 500', async () => {
  const sub = mkdtempSync(join(tmpDir, 'errfb-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile,
    `export default function Page() { throw new Error('outer'); }\n`);

  const errorFile = join(appDir, 'error.js');
  writeFileSync(errorFile,
    `export default function Err() { throw new Error('boundary-broke'); }\n`);

  const route = { file: pageFile, layouts: [], errors: [errorFile], metadataFiles: [] };
  // Silence the intentional console.error from the unhandled-render path
  const prev = console.error;
  console.error = () => {};
  try {
    const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
    assert.equal(resp.status, 500);
    const body = await resp.text();
    // Prod default: terse message, no stack.
    assert.ok(body.includes('Something went wrong'));
    assert.ok(!body.includes('boundary-broke'));
  } finally { console.error = prev; }
});

test('ssrPage: page throws + NO error.js boundary → default 500', async () => {
  // The user-incident scenario: a route has no error.js at all
  // (route.errors is empty) and the page throws. Framework should
  // produce its terse built-in 500 page rather than crashing the
  // whole request. Verifies the for-loop at ssr.js:98 is safe over
  // an empty errors[] array and falls through to the default body.
  const { route, appDir } = await makeRoute({
    pageSrc: `export default function Page() { throw new Error('no-boundary'); }\n`,
  });
  const prev = console.error;
  console.error = () => {};
  try {
    const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
    assert.equal(resp.status, 500);
    const body = await resp.text();
    assert.ok(body.includes('Something went wrong'));
    // The thrown error.message is NOT leaked in prod when no boundary
    // handles it: only the framework's terse default body shows.
    assert.ok(!body.includes('no-boundary'));
  } finally { console.error = prev; }
});

test('ssrPage: error.js fails to LOAD (syntax error) → falls through to default 500', async () => {
  // Distinct from "error.js renders then throws" (already covered
  // above). This exercises the loadModule() throw path inside the
  // for-loop at ssr.js:98: when the boundary file itself can't be
  // imported (bad syntax, missing dep, broken template literal,
  // etc.), the inner catch should swallow the load failure and
  // continue to the next boundary, eventually reaching the default
  // 500 body. This is the exact failure mode that bit the
  // ui.webjs.dev deploy when a stray backtick closed the html
  // tagged template literal at parse time.
  const sub = mkdtempSync(join(tmpDir, 'errload-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile,
    `export default function Page() { throw new Error('SENTINEL_PAGE_ERR_zq7'); }\n`);

  // Intentionally malformed module: JS parse failure on import.
  const errorFile = join(appDir, 'error.js');
  writeFileSync(errorFile, `export default function Err({ error } { return; }\n`);

  const route = { file: pageFile, layouts: [], errors: [errorFile], metadataFiles: [] };
  const prev = console.error;
  console.error = () => {};
  try {
    const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
    assert.equal(resp.status, 500);
    const body = await resp.text();
    assert.ok(body.includes('Something went wrong'));
    // Prod default body shouldn't leak the original error message.
    // The sentinel string is unique to the thrown error so a substring
    // match would never come from incidental shell content.
    assert.ok(!body.includes('SENTINEL_PAGE_ERR_zq7'));
  } finally { console.error = prev; }
});

test('ssrPage: dev=true exposes the error stack, prod hides it', async () => {
  const { route, appDir } = await makeRoute({
    pageSrc:
      `export default function Page() { throw new Error('stacky'); }\n`,
  });
  const prev = console.error;
  console.error = () => {};
  try {
    const dev = await ssrPage(route, {}, new URL('http://localhost/'), { dev: true, appDir });
    const devBody = await dev.text();
    assert.ok(devBody.includes('stacky'));

    const prod = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
    const prodBody = await prod.text();
    assert.ok(!prodBody.includes('stacky'));
    assert.ok(prodBody.includes('Something went wrong'));
  } finally { console.error = prev; }
});

/* ------------ boundaries render inside their layout chain (#1298) ------------ */

/**
 * Build a nested app on disk and return a route object for its page.
 *
 * `files` maps an app-relative path to source. `layouts` and `errors` are
 * app-relative paths listed OUTERMOST first, matching what the router builds.
 */
function makeBoundaryApp({ files, page, layouts = [], errors = [], notFounds = [], forbiddens = [] }) {
  const sub = mkdtempSync(join(tmpDir, 'boundary-'));
  const appDir = join(sub, 'app');
  for (const [rel, src] of Object.entries(files)) {
    const abs = join(appDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, src);
  }
  const abs = (rel) => join(appDir, rel);
  return {
    appDir,
    route: {
      file: abs(page),
      layouts: layouts.map(abs),
      errors: errors.map(abs),
      notFounds: notFounds.map(abs),
      forbiddens: forbiddens.map(abs),
      metadataFiles: [],
    },
  };
}

/** Every `wj:children` marker in DOM order. */
const markersOf = (html) => [...html.matchAll(/<!--(\/?)wj:children:([^:>]+)(?::([^>]*))?-->/g)]
  .map((m) => ({ close: m[1] === '/', segment: m[2], key: m[3] }));

/** The set of segment ids opened, sorted, for set-equality assertions. */
const openSegments = (html) => markersOf(html).filter((m) => !m.close).map((m) => m.segment).sort();

/** Assert every open has exactly one matching close, and no id repeats (#1015). */
function assertPaired(html) {
  const ms = markersOf(html);
  const opens = ms.filter((m) => !m.close).map((m) => m.segment);
  const closes = ms.filter((m) => m.close).map((m) => m.segment);
  assert.deepEqual([...opens].sort(), [...closes].sort(), 'every open has a matching close');
  assert.equal(new Set(opens).size, opens.length, 'no segment id is duplicated');
  // Properly nested: walking the list as a stack must never mispair.
  const stack = [];
  for (const m of ms) {
    if (!m.close) stack.push(m.segment);
    else assert.equal(stack.pop(), m.segment, 'markers are properly nested');
  }
  assert.equal(stack.length, 0, 'no marker left open');
}

const SILENT = async (fn) => {
  const prev = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = prev; }
};

const HTML_IMPORT = `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n`;

/** Root layout + /docs layout + a throwing /docs/crash page + /docs/error.js. */
function crashApp(extra = {}) {
  return makeBoundaryApp({
    files: {
      'layout.js': HTML_IMPORT + `export default function Root({ children }) { return html\`<div id="root-chrome">\${children}</div>\`; }\n`,
      'docs/layout.js': HTML_IMPORT + `export default function Docs({ children }) { return html\`<div id="docs-chrome">\${children}</div>\`; }\n`,
      'docs/crash/page.js': `export default function Page() { throw new Error('kaboom'); }\n`,
      'docs/error.js': HTML_IMPORT + `export default function Err({ error }) { return html\`<p id="boundary">\${error.message}</p>\`; }\n`,
      ...(extra.files || {}),
    },
    page: 'docs/crash/page.js',
    layouts: ['layout.js', 'docs/layout.js'],
    errors: ['docs/error.js'],
    ...(extra.route || {}),
  });
}

test('boundary: a 500 renders inside the layouts at and above the boundary segment (#1298)', async () => {
  // The headline. Before this the catch rendered the boundary standalone and
  // handed it to wrapInDocument, so the response carried NO keyed markers, the
  // client router's scan found no shared boundary, and every navigation into a
  // throwing page degraded to a full document load.
  const { route, appDir } = crashApp();
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/docs/crash'), { dev: false, appDir }));
  assert.equal(resp.status, 500);
  const body = await resp.text();

  assert.ok(body.includes('id="boundary"'), 'the boundary rendered');
  assert.ok(body.includes('id="root-chrome"'), 'the root layout wraps it');
  assert.ok(body.includes('id="docs-chrome"'), 'the /docs layout wraps it');
  const segs = openSegments(body);
  assert.deepEqual(segs, ['/', '/docs', '/docs/crash']);
  assertPaired(body);
});

test('boundary: the 500 emits the SAME segment-id set a 200 at that depth does', async () => {
  // The strongest available assertion: it catches every mistake in the
  // page-region skip rule at once, which is the part most likely to be got
  // subtly wrong (a mismatched pair degrades the swap, so it would look fixed
  // in a diff and still hard-load).
  const crash = crashApp();
  const fine = makeBoundaryApp({
    files: {
      'layout.js': HTML_IMPORT + `export default function Root({ children }) { return html\`<div>\${children}</div>\`; }\n`,
      'docs/layout.js': HTML_IMPORT + `export default function Docs({ children }) { return html\`<div>\${children}</div>\`; }\n`,
      'docs/fine/page.js': HTML_IMPORT + `export default function Page() { return html\`<p>fine</p>\`; }\n`,
    },
    page: 'docs/fine/page.js',
    layouts: ['layout.js', 'docs/layout.js'],
  });

  const bad = await SILENT(() => ssrPage(crash.route, {}, new URL('http://localhost/docs/crash'), { dev: false, appDir: crash.appDir }));
  const ok = await ssrPage(fine.route, {}, new URL('http://localhost/docs/fine'), { dev: false, appDir: fine.appDir });
  assert.equal(bad.status, 500);
  assert.equal(ok.status, 200);

  const shape = (segs) => segs.map((s) => s.split('/').length);
  const badSegs = openSegments(await bad.text());
  const okSegs = openSegments(await ok.text());
  assert.deepEqual(shape(badSegs), shape(okSegs));
  assert.deepEqual(badSegs.slice(0, 2), okSegs.slice(0, 2), 'the shared layout regions are identical');
});

test('boundary: a layout DEEPER than the boundary is not rendered and not booted', async () => {
  // The boundary sits at /docs, so the /docs/deep layout never ran on the
  // happy path either. Wrapping it would render markup the failing page never
  // produced, and shipping its module would boot a layout that is not on screen.
  const { route, appDir } = makeBoundaryApp({
    files: {
      'layout.js': HTML_IMPORT + `export default function Root({ children }) { return html\`<div id="root-chrome">\${children}</div>\`; }\n`,
      'docs/error.js': HTML_IMPORT + `export default function Err() { return html\`<p id="boundary">b</p>\`; }\n`,
      'docs/deep/layout.js': HTML_IMPORT + `export default function Deep({ children }) { return html\`<div id="deep-chrome">\${children}</div>\`; }\n`,
      'docs/deep/page.js': `export default function Page() { throw new Error('kaboom'); }\n`,
    },
    page: 'docs/deep/page.js',
    layouts: ['layout.js', 'docs/deep/layout.js'],
    errors: ['docs/error.js'],
  });
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/docs/deep'), { dev: false, appDir }));
  const body = await resp.text();
  assert.ok(!body.includes('id="deep-chrome"'), 'the deeper layout did not render');
  assert.ok(!body.includes('"/docs/deep/layout.js"'), 'the deeper layout is not in the boot script');
  // And its segment id must not be emitted either. The page sits at
  // /docs/deep, which is the EXCLUDED layout's own segment, so emitting the
  // page region under that id would advertise a region the excluded layout's
  // markup was never in. The client would send that id in X-Webjs-Have and the
  // next navigation into /docs/deep would short-circuit on it, returning a
  // fragment that assumes chrome this page never had.
  assert.deepEqual(openSegments(body), ['/']);
  assertPaired(body);
});

test('boundary: an excluded layout id is never advertised, so the NEXT nav keeps its chrome', async () => {
  // The end-to-end consequence of the rule above, asserted through the header
  // the client would really send. This is the shape that made the defect
  // expensive: the boundary response looks fine on its own and corrupts the
  // navigation AFTER it.
  const { route, appDir } = makeBoundaryApp({
    files: {
      'layout.js': HTML_IMPORT + `export default function Root({ children }) { return html\`<div id="root-chrome">\${children}</div>\`; }\n`,
      'docs/layout.js': HTML_IMPORT + `export default function Docs({ children }) { return html\`<div id="docs-chrome">\${children}</div>\`; }\n`,
      'docs/page.js': `export default function Page() { throw new Error('boom'); }\n`,
      'error.js': HTML_IMPORT + `export default function Err() { return html\`<p id="root-boundary">err</p>\`; }\n`,
    },
    page: 'docs/page.js',
    layouts: ['layout.js', 'docs/layout.js'],
    errors: ['error.js'],
  });
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/docs'), { dev: false, appDir }));
  const body = await resp.text();
  assert.ok(!body.includes('id="docs-chrome"'), 'the /docs layout is above the boundary, so it did not render');
  assert.ok(
    !openSegments(body).includes('/docs'),
    'and its id is absent, so the client cannot claim to hold a layout it never received',
  );
  assert.deepEqual(openSegments(body), ['/']);
  assertPaired(body);
});

test('boundary: the boot script ships the boundary module, not the page module (#1298)', async () => {
  // The boundary is what rendered, so it is what has to upgrade its custom
  // elements. The page module never ran, so booting it was always wrong.
  const { route, appDir } = crashApp();
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/docs/crash'), { dev: false, appDir }));
  const body = await resp.text();
  assert.ok(body.includes('"/docs/error.js"'), 'the boundary module is booted');
  assert.ok(!body.includes('"/docs/crash/page.js"'), 'the page module is not booted');
});

test('boundary: the #963 inert / import-only substitution still applies to the boot set', async () => {
  // An import-only layout is replaced by the component URLs it would have
  // emitted, exactly as on the happy path. Without this an import-only module
  // with a bare `.server.*` import loads whole and crashes the boundary's boot
  // on the throw-at-load stub, killing every sibling registration with it.
  const { route, appDir } = crashApp();
  const importOnly = new Map([[join(appDir, 'docs/layout.js'), [join(appDir, 'components/thing.js')]]]);
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/docs/crash'), {
    dev: false, appDir, importOnlyRouteModules: importOnly,
  }));
  const body = await resp.text();
  assert.ok(body.includes('"/components/thing.js"'), 'the substitute component URL is booted');
  assert.ok(!body.includes('"/docs/layout.js"'), 'the import-only layout module itself is not');

  const inert = new Set([join(appDir, 'docs/layout.js')]);
  const resp2 = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/docs/crash'), {
    dev: false, appDir, inertRouteModules: inert,
  }));
  const body2 = await resp2.text();
  assert.ok(!body2.includes('"/docs/layout.js"'), 'an inert layout is dropped from the boot set');
});

test('boundary: a throwing LAYOUT renders the boundary OUTSIDE it, not the one at its own segment', async () => {
  // Next's hierarchy is layout -> error -> page, so error.js sits INSIDE its
  // segment's layout and therefore cannot catch it. Here /docs/layout.js
  // throws, so /docs/error.js is unusable and the root error.js must handle it.
  // The walk terminates because each step outward wraps a strictly smaller set.
  const { route, appDir } = makeBoundaryApp({
    files: {
      'layout.js': HTML_IMPORT + `export default function Root({ children }) { return html\`<div id="root-chrome">\${children}</div>\`; }\n`,
      'error.js': HTML_IMPORT + `export default function Err() { return html\`<p id="root-boundary">outer</p>\`; }\n`,
      'docs/layout.js': `export default function Docs() { throw new Error('layout boom'); }\n`,
      'docs/error.js': HTML_IMPORT + `export default function Err() { return html\`<p id="docs-boundary">inner</p>\`; }\n`,
      'docs/page.js': HTML_IMPORT + `export default function Page() { return html\`<p>ok</p>\`; }\n`,
    },
    page: 'docs/page.js',
    layouts: ['layout.js', 'docs/layout.js'],
    errors: ['error.js', 'docs/error.js'],
  });
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/docs'), { dev: false, appDir }));
  assert.equal(resp.status, 500);
  const body = await resp.text();
  assert.ok(body.includes('id="root-boundary"'), 'the next boundary OUT handled it');
  assert.ok(!body.includes('id="docs-boundary"'), 'the boundary inside the throwing layout was not used');
  assert.ok(body.includes('id="root-chrome"'), 'the root layout still wraps it');
  assertPaired(body);
});

test('boundary: a throwing ROOT layout still reaches global-error, returned verbatim', async () => {
  // global-error is the one boundary that stays unwrapped: it writes its own
  // shell (invariant 8), wrapping it would re-run the code that just threw,
  // and it ships no boot script by design.
  const { route, appDir } = makeBoundaryApp({
    files: {
      'layout.js': `export default function Root() { throw new Error('root boom'); }\n`,
      'error.js': HTML_IMPORT + `export default function Err() { return html\`<p>never</p>\`; }\n`,
      'global-error.js': HTML_IMPORT + `export default function GE() { return html\`<html><body><p id="ge">global</p></body></html>\`; }\n`,
      'page.js': HTML_IMPORT + `export default function Page() { return html\`<p>ok</p>\`; }\n`,
    },
    page: 'page.js',
    layouts: ['layout.js'],
    errors: ['error.js'],
  });
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/'), {
    dev: false, appDir, globalError: join(appDir, 'global-error.js'),
  }));
  assert.equal(resp.status, 500);
  const body = await resp.text();
  assert.ok(body.includes('id="ge"'), 'global-error rendered');
  assert.equal(markersOf(body).length, 0, 'no boundary markers');
  assert.ok(!body.includes('<script type="module">'), 'no boot script');
});

test('boundary: a thrown notFound() renders the nearest not-found inside its layouts', async () => {
  const { route, appDir } = makeBoundaryApp({
    files: {
      'layout.js': HTML_IMPORT + `export default function Root({ children }) { return html\`<div id="root-chrome">\${children}</div>\`; }\n`,
      'docs/layout.js': HTML_IMPORT + `export default function Docs({ children }) { return html\`<div id="docs-chrome">\${children}</div>\`; }\n`,
      'docs/not-found.js': HTML_IMPORT + `export default function NF() { return html\`<p id="nf">missing</p>\`; }\n`,
      'docs/[slug]/page.js': `import { notFound } from ${JSON.stringify(WEBJS_MODULE_URL)};\nexport default function Page() { notFound(); }\n`,
    },
    page: 'docs/[slug]/page.js',
    layouts: ['layout.js', 'docs/layout.js'],
    notFounds: ['docs/not-found.js'],
  });
  const resp = await ssrPage(route, { slug: 'gone' }, new URL('http://localhost/docs/gone'), { dev: false, appDir });
  assert.equal(resp.status, 404);
  const body = await resp.text();
  assert.ok(body.includes('id="nf"'));
  assert.ok(body.includes('id="root-chrome"') && body.includes('id="docs-chrome"'));
  assert.deepEqual(openSegments(body), ['/', '/docs', '/docs/[slug]']);
  assertPaired(body);
  // The page region's key carries the RESOLVED param, so a param change
  // remounts it the same way a 200 would.
  const pageRegion = markersOf(body).find((m) => !m.close && m.segment === '/docs/[slug]');
  assert.equal(pageRegion.key, '/docs/gone');
});

test('boundary: a thrown forbidden() renders inside its layouts and receives a real ctx', async () => {
  // The boundary modules used to be called with an empty object, so a wrapped
  // layout had no params to build its own links from.
  const { route, appDir } = makeBoundaryApp({
    files: {
      'layout.js': HTML_IMPORT + `export default function Root({ children }) { return html\`<div id="root-chrome">\${children}</div>\`; }\n`,
      'admin/[org]/forbidden.js': HTML_IMPORT + `export default function F({ params }) { return html\`<p id="fb">\${params.org}</p>\`; }\n`,
      'admin/[org]/page.js': `import { forbidden } from ${JSON.stringify(WEBJS_MODULE_URL)};\nexport default function Page() { forbidden(); }\n`,
    },
    page: 'admin/[org]/page.js',
    layouts: ['layout.js'],
    forbiddens: ['admin/[org]/forbidden.js'],
  });
  const resp = await ssrPage(route, { org: 'acme' }, new URL('http://localhost/admin/acme'), { dev: false, appDir });
  assert.equal(resp.status, 403);
  const body = await resp.text();
  assert.ok(body.includes('id="fb"'));
  assert.ok(body.includes('acme'), 'the boundary received params');
  assert.ok(body.includes('id="root-chrome"'), 'the root layout wraps it');
  assert.deepEqual(openSegments(body), ['/', '/admin/[org]']);
  assertPaired(body);
  // The chain rendered, so its modules must boot. Chrome that paints and never
  // hydrates is worse than no chrome: its controls look live and are not.
  assert.ok(body.includes('"/layout.js"'), 'the wrapping layout module boots');
  assert.ok(body.includes('"/admin/[org]/forbidden.js"'), 'and so does the boundary that rendered');
});

test('boundary: a 404 for a URL that matched no route stays a bare document', async () => {
  // ssrNotFound with no route has no chain to wrap in, so there is no shared
  // shell to swap into and a hard load is the correct outcome.
  const sub = mkdtempSync(join(tmpDir, 'unrouted-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });
  const nf = join(appDir, 'not-found.js');
  writeFileSync(nf, HTML_IMPORT + `export default function NF() { return html\`<p id="nf">nope</p>\`; }\n`);
  const resp = await ssrNotFound(nf, { dev: false, appDir, url: new URL('http://localhost/nothing') });
  assert.equal(resp.status, 404);
  const body = await resp.text();
  assert.ok(body.includes('id="nf"'));
  assert.equal(markersOf(body).length, 0, 'no markers, since there is no chain');
  assert.ok(!body.includes('<script type="module">'), 'and no boot script, since no chain rendered');
});

test('boundary: instrumentation-client boots FIRST on a boundary page too (#848)', async () => {
  // The boundary page is where the app's client error reporting matters most,
  // so it must not be the one page that runs app modules without it.
  const { route, appDir } = crashApp({
    files: { 'instrumentation-client.js': `console.log('boot');\n` },
  });
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/docs/crash'), {
    dev: false, appDir, instrumentationClient: join(appDir, 'instrumentation-client.js'),
  }));
  const body = await resp.text();
  const boot = body.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(boot, 'the boundary page has a boot script');
  const imports = [...boot[1].matchAll(/import\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(imports[0], '/instrumentation-client.js', 'and instrumentation is its FIRST import');
  assert.ok(imports.includes('/docs/error.js'), 'the boundary module still boots');
});

test('boundary: a layout that throws while wrapping a 403 is REPORTED, not swallowed', async () => {
  // These paths execute layout modules for the first time since #1298, so a
  // genuine layout crash would otherwise vanish: a chrome-less boundary page
  // with nothing saying why, and an APM sink that never heard about it.
  const { route, appDir } = makeBoundaryApp({
    files: {
      'layout.js': `export default function Root() { throw new Error('layout-boom-403'); }\n`,
      'admin/forbidden.js': HTML_IMPORT + `export default function F() { return html\`<p id="fb">no</p>\`; }\n`,
      'admin/page.js': `import { forbidden } from ${JSON.stringify(WEBJS_MODULE_URL)};\nexport default function Page() { forbidden(); }\n`,
    },
    page: 'admin/page.js',
    layouts: ['layout.js'],
    forbiddens: ['admin/forbidden.js'],
  });
  const seen = [];
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/admin'), {
    dev: false, appDir, onError: (e) => seen.push(e),
  }));
  assert.equal(resp.status, 403, 'it still degrades to the standalone 403 rather than failing');
  const body = await resp.text();
  assert.ok(body.includes('id="fb"'), 'the boundary itself still rendered');
  assert.equal(markersOf(body).length, 0, 'with no markers, since the chain could not render');
  assert.ok(!body.includes('<script type="module">'), 'and no boot set for a chain that did not render');
  assert.equal(seen.length, 1, 'the layout throw reached the onError sink');
  assert.match(String(seen[0].message), /layout-boom-403/);
});

test('boundary: a layout control-flow throw is NOT reported as an error', async () => {
  // A redirect() from a layout is a routing decision, not a crash. Reporting it
  // would fire the app's APM sink and paint a false dev error overlay OVER the
  // 403 the user is looking at. It is not honoured either: the status is
  // already decided and the boundary page IS the answer to this request.
  const { route, appDir } = makeBoundaryApp({
    files: {
      'layout.js': `import { redirect } from ${JSON.stringify(WEBJS_MODULE_URL)};\nexport default function Root() { redirect('/login'); }\n`,
      'admin/forbidden.js': HTML_IMPORT + `export default function F() { return html\`<p id="fb">no</p>\`; }\n`,
      'admin/page.js': `import { forbidden } from ${JSON.stringify(WEBJS_MODULE_URL)};\nexport default function Page() { forbidden(); }\n`,
    },
    page: 'admin/page.js',
    layouts: ['layout.js'],
    forbiddens: ['admin/forbidden.js'],
  });
  const seen = [];
  const devSeen = [];
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/admin'), {
    dev: true, appDir, onError: (e) => seen.push(e), onDevError: (e) => devSeen.push(e),
  }));
  assert.equal(resp.status, 403, 'the boundary still answers, and its status is preserved');
  const body = await resp.text();
  assert.ok(body.includes('id="fb"'), 'the boundary rendered');
  assert.deepEqual(seen, [], 'a control-flow sentinel never reaches the APM sink');
  assert.deepEqual(devSeen, [], 'nor the dev error overlay');
});

test('boundary: a layout that throws on the 500 path is reported, not lost', async () => {
  // The fallthrough to the next boundary out is the right behaviour, but the
  // sinks otherwise only ever hear the ORIGINAL page error, so a boundary or
  // layout that crashed while handling it would vanish completely.
  const { route, appDir } = makeBoundaryApp({
    files: {
      'layout.js': HTML_IMPORT + `export default function Root({ children }) { return html\`<div id="root-chrome">\${children}</div>\`; }\n`,
      'error.js': HTML_IMPORT + `export default function Err() { return html\`<p id="root-boundary">outer</p>\`; }\n`,
      'docs/layout.js': `export default function Docs() { throw new Error('layout-boom-500'); }\n`,
      'docs/error.js': HTML_IMPORT + `export default function Err() { return html\`<p id="docs-boundary">inner</p>\`; }\n`,
      'docs/page.js': `export default function Page() { throw new Error('page-boom'); }\n`,
    },
    page: 'docs/page.js',
    layouts: ['layout.js', 'docs/layout.js'],
    errors: ['error.js', 'docs/error.js'],
  });
  const seen = [];
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/docs'), {
    dev: false, appDir, onError: (e) => seen.push(e),
  }));
  assert.equal(resp.status, 500);
  const body = await resp.text();
  assert.ok(body.includes('id="root-boundary"'), 'it still falls through to the boundary outside the throwing layout');
  const messages = seen.map((e) => String(e && e.message));
  assert.ok(messages.includes('page-boom'), 'the original page error is still reported');
  assert.ok(messages.includes('layout-boom-500'), 'and so is the layout crash that used to vanish');
});

test('boundary: one throwing layout is reported ONCE, not once per boundary', async () => {
  // The walk tries each boundary in the chain, and layoutsForBoundary selects
  // by segment ancestry rather than boundary depth, so a root layout that
  // throws fails EVERY attempt. Identity dedup would not help: a layout that
  // constructs its error yields a fresh object per attempt, so the key is the
  // STAGE plus its name, message and construction site.
  const { route, appDir } = makeBoundaryApp({
    files: {
      'layout.js': `export default function Root() { throw new Error('root-layout-boom'); }\n`,
      'error.js': HTML_IMPORT + `export default function Err() { return html\`<p>outer</p>\`; }\n`,
      'docs/error.js': HTML_IMPORT + `export default function Err() { return html\`<p>inner</p>\`; }\n`,
      'docs/page.js': `export default function Page() { throw new Error('page-boom'); }\n`,
    },
    page: 'docs/page.js',
    layouts: ['layout.js'],
    // Both boundaries resolve to the SAME wrapped set (the root layout), which
    // is the shape that produced the duplicate report.
    errors: ['error.js', 'docs/error.js'],
  });
  const seen = [];
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/docs'), {
    dev: false, appDir, onError: (e) => seen.push(e),
  }));
  assert.equal(resp.status, 500);
  const layoutHits = seen.filter((e) => /root-layout-boom/.test(String(e && e.message)));
  assert.equal(layoutHits.length, 1, 'the layout crash is reported exactly once for the request');
  assert.equal(
    seen.filter((e) => /page-boom/.test(String(e && e.message))).length, 1,
    'and the original page error is still reported exactly once',
  );
});

test('boundary: a secondary failure never steals the dev overlay from the root cause', async () => {
  // The overlay holds ONE retained frame per URL and the dev handler's slot is
  // last-write-wins, so pushing the secondary failure after the page error
  // would replace the root cause with a symptom, and it would survive a
  // reconnect (#1047 scopes that slot per URL).
  const { route, appDir } = makeBoundaryApp({
    files: {
      'layout.js': `export default function Root() { throw new Error('layout-boom'); }\n`,
      'error.js': HTML_IMPORT + `export default function Err() { return html\`<p>outer</p>\`; }\n`,
      'page.js': `export default function Page() { throw new Error('page-boom'); }\n`,
    },
    page: 'page.js',
    layouts: ['layout.js'],
    errors: ['error.js'],
  });
  const devSeen = [];
  await SILENT(() => ssrPage(route, {}, new URL('http://localhost/'), {
    dev: true, appDir, onDevError: (e) => devSeen.push(e),
  }));
  assert.equal(devSeen.length, 1, 'exactly one frame reached the overlay');
  assert.match(String(devSeen[0].message), /page-boom/, 'and it is the ROOT CAUSE, not the secondary failure');
});

test('boundary: a broken global-error is reported, not silently swallowed', async () => {
  // The app's last-resort boundary failing used to reach no sink, no overlay
  // and no console line, leaving only the generic default 500 page.
  const { route, appDir } = makeBoundaryApp({
    files: {
      'global-error.js': `export default function GE() { throw new Error('global-error-boom'); }\n`,
      // A REAL error boundary in the chain, which is the shape that matters:
      // control only reaches global-error because this one threw first, so a
      // dedup keyed on "any secondary failure already reported" would swallow
      // global-error's own crash on every route that has an error.ts at all.
      'error.js': `export default function Err() { throw new Error('boundary-boom'); }\n`,
      'page.js': `export default function Page() { throw new Error('page-boom'); }\n`,
    },
    page: 'page.js',
    layouts: [],
    errors: ['error.js'],
  });
  const seen = [];
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/'), {
    dev: false, appDir, globalError: join(appDir, 'global-error.js'), onError: (e) => seen.push(e),
  }));
  assert.equal(resp.status, 500);
  const body = await resp.text();
  assert.ok(body.includes('Something went wrong'), 'it still degrades to the default 500 page');
  const messages = seen.map((e) => String(e && e.message));
  assert.ok(messages.includes('global-error-boom'), 'the global-error crash reached the sink');
  assert.ok(messages.includes('boundary-boom'), 'and so did the boundary that failed before it');
  assert.ok(messages.includes('page-boom'), 'alongside the original page error');
});

test('boundary: dedup collapses REPEATS of one cause, not distinct failures', async () => {
  // The dedup exists for one layout that fails every attempt. It must not
  // silence a genuinely different secondary failure: an inner boundary that
  // throws its own error, then an outer attempt whose layout crashes, are two
  // causes and both belong in the sink.
  const { route, appDir } = makeBoundaryApp({
    files: {
      'layout.js': `export default function Root() { throw new Error('shared-layout-boom'); }\n`,
      'error.js': HTML_IMPORT + `export default function Err() { return html\`<p>outer</p>\`; }\n`,
      'docs/error.js': `export default function Err() { throw new TypeError('inner-boundary-boom'); }\n`,
      'docs/page.js': `export default function Page() { throw new Error('page-boom'); }\n`,
    },
    page: 'docs/page.js',
    layouts: ['layout.js'],
    errors: ['error.js', 'docs/error.js'],
  });
  const seen = [];
  await SILENT(() => ssrPage(route, {}, new URL('http://localhost/docs'), {
    dev: false, appDir, onError: (e) => seen.push(e),
  }));
  const messages = seen.map((e) => String(e && e.message));
  assert.ok(messages.includes('inner-boundary-boom'), 'the inner boundary crash is reported');
  assert.ok(messages.includes('shared-layout-boom'), 'and the LATER, unrelated layout crash is not swallowed by it');
});

test('boundary: a LAYOUT crash that produced the 500 is reported once, not twice', async () => {
  // The commonest shape of all, and the one the dedup set has to be SEEDED for.
  // When the layout is what threw, it becomes the original error AND is re-run
  // around every boundary it wraps, so the same cause arrives twice.
  const { route, appDir } = makeBoundaryApp({
    files: {
      'layout.js': `export default function Root() { throw new Error('only-layout-boom'); }\n`,
      'error.js': HTML_IMPORT + `export default function Err() { return html\`<p id="b">boundary</p>\`; }\n`,
      // The page renders fine: the LAYOUT is the sole failure.
      'page.js': HTML_IMPORT + `export default function Page() { return html\`<p>ok</p>\`; }\n`,
    },
    page: 'page.js',
    layouts: ['layout.js'],
    errors: ['error.js'],
  });
  const seen = [];
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/'), {
    dev: false, appDir, onError: (e) => seen.push(e),
  }));
  assert.equal(resp.status, 500);
  const hits = seen.filter((e) => /only-layout-boom/.test(String(e && e.message)));
  assert.equal(hits.length, 1, 'reported once, not once as the original and again as a secondary');
});

test('boundary: a throw whose value cannot be stringified still degrades, never escapes', async () => {
  // The dedup key runs INSIDE the catch that keeps the response alive, so it
  // must be total. `String(Object.create(null))` throws, and a key computation
  // that throws would take ssrPage's 500 page down with it.
  const { route, appDir } = makeBoundaryApp({
    files: {
      'error.js': `export default function Err() { throw Object.create(null); }\n`,
      'page.js': `export default function Page() { throw Object.create(null); }\n`,
    },
    page: 'page.js',
    layouts: [],
    errors: ['error.js'],
  });
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir }));
  assert.equal(resp.status, 500, 'it degraded to the default 500 rather than throwing out of ssrPage');
  assert.ok((await resp.text()).includes('Something went wrong'));
});

test('boundary: two boundaries failing through ONE shared helper are both reported', async () => {
  // These two share a construction site, so the error alone cannot separate
  // them: it is the STAGE in the key (the boundary walk versus the
  // global-error attempt) that keeps global-error's own crash from being
  // swallowed by the earlier boundary's.
  const { route, appDir } = makeBoundaryApp({
    files: {
      'boom.js': `export function boom() { throw new Error('shared-helper-boom'); }\n`,
      'error.js': `import { boom } from './boom.js';\nexport default function Err() { boom(); }\n`,
      'global-error.js': `import { boom } from './boom.js';\nexport default function GE() { boom(); }\n`,
      'page.js': `export default function Page() { throw new Error('page-boom'); }\n`,
    },
    page: 'page.js',
    layouts: [],
    errors: ['error.js'],
  });
  const seen = [];
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/'), {
    dev: false, appDir, globalError: join(appDir, 'global-error.js'), onError: (e) => seen.push(e),
  }));
  assert.equal(resp.status, 500);
  const hits = seen.filter((e) => /shared-helper-boom/.test(String(e && e.message)));
  assert.equal(hits.length, 2, 'the boundary and global-error each report, despite one construction site');
});

test('boundary: an unprintable throw degrades in DEV too, and never escapes', async () => {
  // The prod path was covered; dev formats the error into the page, and that
  // formatting is itself inside the catch that keeps the response alive.
  const { route, appDir } = makeBoundaryApp({
    files: {
      'page.js': `export default function Page() { throw Object.create(null); }\n`,
    },
    page: 'page.js',
    layouts: [],
    errors: [],
  });
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/'), { dev: true, appDir }));
  assert.equal(resp.status, 500, 'dev degrades to the 500 page rather than throwing out of ssrPage');
  assert.match(await resp.text(), /unprintable value/, 'and says so instead of crashing while formatting');
});

test('boundary: a crashing 403 boundary does not leak its error to the client in prod', async () => {
  // The 500 path has always drawn this line; these pages were rendering the
  // thrown message into the response body in production.
  const { route, appDir } = makeBoundaryApp({
    files: {
      'admin/forbidden.js': `export default function F() { throw new Error('SECRET_DB_DSN_LEAK'); }\n`,
      'admin/page.js': `import { forbidden } from ${JSON.stringify(WEBJS_MODULE_URL)};\nexport default function Page() { forbidden(); }\n`,
    },
    page: 'admin/page.js',
    layouts: [],
    forbiddens: ['admin/forbidden.js'],
  });
  const prod = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/admin'), { dev: false, appDir }));
  assert.equal(prod.status, 403);
  const prodBody = await prod.text();
  assert.ok(!prodBody.includes('SECRET_DB_DSN_LEAK'), 'prod never renders the thrown message');
  assert.ok(prodBody.includes('403'), 'but still identifies the status');

  const dev = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/admin'), { dev: true, appDir }));
  assert.match(await dev.text(), /SECRET_DB_DSN_LEAK/, 'dev still shows it, which is the point of dev');
});

test('boundary: an unprintable throw from a 403 boundary degrades, never escapes', async () => {
  const { route, appDir } = makeBoundaryApp({
    files: {
      'admin/forbidden.js': `export default function F() { throw Object.create(null); }\n`,
      'admin/page.js': `import { forbidden } from ${JSON.stringify(WEBJS_MODULE_URL)};\nexport default function Page() { forbidden(); }\n`,
    },
    page: 'admin/page.js',
    layouts: [],
    forbiddens: ['admin/forbidden.js'],
  });
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/admin'), { dev: true, appDir }));
  assert.equal(resp.status, 403, 'it degrades rather than escaping ssrBoundaryHtml and ssrPage');
  assert.match(await resp.text(), /unprintable value/);
});

test('boundary: a crashing boundary module is REPORTED, so prod is not silent', async () => {
  // Sanitizing the body removed the only production-visible trace of this
  // failure. Sanitizing without reporting moves a failure out of sight rather
  // than out of the response, on a request that already returned a 4xx to a
  // real user.
  const { route, appDir } = makeBoundaryApp({
    files: {
      'admin/forbidden.js': `export default function F() { throw new Error('BOUNDARY_MODULE_BOOM'); }\n`,
      'admin/page.js': `import { forbidden } from ${JSON.stringify(WEBJS_MODULE_URL)};\nexport default function Page() { forbidden(); }\n`,
    },
    page: 'admin/page.js',
    layouts: [],
    forbiddens: ['admin/forbidden.js'],
  });
  const seen = [];
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/admin'), {
    dev: false, appDir, onError: (e) => seen.push(e),
  }));
  assert.equal(resp.status, 403);
  assert.ok(!(await resp.text()).includes('BOUNDARY_MODULE_BOOM'), 'the body stays sanitized');
  assert.equal(seen.length, 1, 'but the failure reached the sink');
  assert.match(String(seen[0].message), /BOUNDARY_MODULE_BOOM/);
});

test('boundary: a 404 boundary that fails to LOAD is reported too', async () => {
  // The load failure path, not the render one: a syntax error in not-found.ts.
  const sub = mkdtempSync(join(tmpDir, 'nf-load-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });
  const nf = join(appDir, 'not-found.js');
  writeFileSync(nf, `export default function NF({ x { return; }\n`);
  const seen = [];
  const resp = await SILENT(() => ssrNotFound(nf, {
    dev: false, appDir, url: new URL('http://localhost/gone'), onError: (e) => seen.push(e),
  }));
  assert.equal(resp.status, 404);
  assert.equal(seen.length, 1, 'a boundary that cannot even be imported is not silent either');
});

test('boundary: a boundary response is never storable and never reduced', async () => {
  // Two independent guarantees. The HTML cache refuses a non-200 outright, and
  // the reduced X-Webjs-Have path is structurally unreachable: the boundary
  // render passes `have` as null, so there is no short-circuit branch to take.
  const { route, appDir } = crashApp();
  const req = new Request('http://localhost/docs/crash', { headers: { 'x-webjs-have': '/:/' } });
  const resp = await SILENT(() => ssrPage(route, {}, new URL('http://localhost/docs/crash'), { dev: false, appDir, req }));
  assert.equal(resp.status, 500);
  const body = await resp.text();
  assert.ok(body.includes('id="root-chrome"'), 'the root layout is rendered, not short-circuited away');
  assert.ok(body.includes('<!doctype') || body.includes('<!DOCTYPE'), 'a full document, not a fragment');
  assert.equal(resp.headers.get('vary'), null, 'not marked Vary: X-Webjs-Have');
});

/* ------------ metadata: generateMetadata fn, openGraph, preload links ------------ */

test('ssrPage: metadata.generateMetadata(ctx) is called and merged', async () => {
  const sub = mkdtempSync(join(tmpDir, 'metagen-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export async function generateMetadata(ctx) {\n` +
    `  return { title: 'Dyn ' + (ctx.params.id || 'x') };\n` +
    `}\n` +
    `export default function Page() { return html\`<p>ok</p>\`; }\n`);

  const route = { file: pageFile, layouts: [], errors: [], metadataFiles: [pageFile] };
  const resp = await ssrPage(route, { id: '42' }, new URL('http://localhost/'), { dev: false, appDir });
  const body = await resp.text();
  assert.ok(body.includes('<title>Dyn 42</title>'));
});

test('ssrPage: metadata.openGraph emits og:* meta tags', async () => {
  const sub = mkdtempSync(join(tmpDir, 'og-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export const metadata = {\n` +
    `  title: 'Blog',\n` +
    `  description: 'A blog',\n` +
    `  themeColor: '#ff0000',\n` +
    `  viewport: 'width=device-width, initial-scale=2',\n` +
    `  openGraph: { title: 'OG Blog', image: '/cover.png' },\n` +
    `  preload: [ { href: '/font.woff2', as: 'font', type: 'font/woff2', crossorigin: 'anonymous' } ],\n` +
    `};\n` +
    `export default function Page() { return html\`<p>ok</p>\`; }\n`);

  const route = { file: pageFile, layouts: [], errors: [], metadataFiles: [pageFile] };
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
  const body = await resp.text();
  assert.ok(body.includes('<meta name="description" content="A blog">'));
  assert.ok(body.includes('<meta name="theme-color" content="#ff0000">'));
  assert.ok(body.includes('<meta property="og:title" content="OG Blog">'));
  assert.ok(body.includes('<meta property="og:image" content="/cover.png">'));
  assert.ok(/<meta name="viewport"[^>]*initial-scale=2/.test(body));
  assert.ok(/<link rel="preload"[^>]*href="\/font\.woff2"/.test(body));
  assert.ok(/<link rel="preload"[^>]*as="font"/.test(body));
});

test('ssrPage: metadata.twitter emits twitter:* meta tags', async () => {
  const sub = mkdtempSync(join(tmpDir, 'tw-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export const metadata = {\n` +
    `  twitter: { card: 'summary_large_image', title: 'Tw', image: '/og.png' },\n` +
    `};\n` +
    `export default function Page() { return html\`<p>ok</p>\`; }\n`);

  const route = { file: pageFile, layouts: [], errors: [], metadataFiles: [pageFile] };
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
  const body = await resp.text();
  assert.ok(body.includes('<meta name="twitter:card" content="summary_large_image">'));
  assert.ok(body.includes('<meta name="twitter:title" content="Tw">'));
  assert.ok(body.includes('<meta name="twitter:image" content="/og.png">'));
});

test('ssrPage: a metadata file that throws is silently skipped', async () => {
  const sub = mkdtempSync(join(tmpDir, 'metaerr-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function Page() { return html\`<p>ok</p>\`; }\n`);

  const brokenMeta = join(appDir, 'broken.js');
  writeFileSync(brokenMeta,
    `export function generateMetadata() { throw new Error('meta boom'); }\n`);

  const route = { file: pageFile, layouts: [], errors: [], metadataFiles: [brokenMeta, pageFile] };
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
  assert.equal(resp.status, 200);
  const body = await resp.text();
  assert.ok(body.includes('<p>ok</p>'));
});

/* ------------ loading.ts → automatic Suspense wrap ------------ */

test('ssrPage: loading.js wraps the page in Suspense (fallback in initial HTML)', async () => {
  const sub = mkdtempSync(join(tmpDir, 'loading-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default async function Page() {\n` +
    `  await new Promise(r => setTimeout(r, 10));\n` +
    `  return html\`<p>ready</p>\`;\n` +
    `}\n`);

  const loadingFile = join(appDir, 'loading.js');
  writeFileSync(loadingFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function Loading() { return html\`<p>loading…</p>\`; }\n`);

  const route = { file: pageFile, layouts: [], errors: [], metadataFiles: [], loadings: [loadingFile] };
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
  assert.equal(resp.status, 200);
  const body = await resp.text();
  assert.ok(body.includes('loading…'), 'fallback should appear in initial HTML');
  assert.ok(body.includes('ready'), 'resolved content streamed in');
  // Streaming flush inserts a <template data-webjs-resolve="..."> chunk.
  assert.ok(/data-webjs-resolve/.test(body));
});

test('ssrPage: Suspense resolution fallback <script> carries the CSP nonce', async () => {
  // The fallback script `<script>window.__webjsResolve&&...</script>`
  // streams inline for each settled Suspense boundary. Under strict
  // CSP it was being blocked by the browser because the nonce wasn't
  // threaded into the streaming response. Regression test.
  const sub = mkdtempSync(join(tmpDir, 'suspense-csp-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });
  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default async function Page() {\n` +
    `  await new Promise(r => setTimeout(r, 10));\n` +
    `  return html\`<p>ready</p>\`;\n` +
    `}\n`);
  const loadingFile = join(appDir, 'loading.js');
  writeFileSync(loadingFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function Loading() { return html\`<p>loading…</p>\`; }\n`);

  const route = { file: pageFile, layouts: [], errors: [], metadataFiles: [], loadings: [loadingFile] };
  const req = new Request('http://localhost/', {
    headers: { 'content-security-policy': "script-src 'nonce-suspNonce99' 'self'" },
  });
  const resp = await withRequest(req, () =>
    ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir, req }));
  const body = await resp.text();
  // Locate every script that contains __webjsResolve and assert each one
  // carries nonce="suspNonce99".
  const resolveScripts = body.match(/<script[^>]*>[^<]*__webjsResolve[^<]*<\/script>/g) || [];
  assert.ok(resolveScripts.length >= 1, 'expected at least one Suspense resolve script');
  for (const s of resolveScripts) {
    assert.match(s, /nonce="suspNonce99"/,
      `Suspense resolve script missing nonce: ${s}`);
  }
});

test('ssrPage: loading.js that fails to load → page renders without Suspense', async () => {
  const sub = mkdtempSync(join(tmpDir, 'loading-err-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function Page() { return html\`<p>ok</p>\`; }\n`);

  const loadingFile = join(appDir, 'loading.js');
  writeFileSync(loadingFile, `throw new Error('cannot load');\n`);

  const route = { file: pageFile, layouts: [], errors: [], metadataFiles: [], loadings: [loadingFile] };
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
  assert.equal(resp.status, 200);
  const body = await resp.text();
  assert.ok(body.includes('<p>ok</p>'));
});

/* ------------ CSP nonce + cookieless SSR ------------ */

test('ssrPage: CSP nonce on request → nonce attribute on injected scripts', async () => {
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Page() { return html\`<p>ok</p>\`; }\n`,
  });
  const req = new Request('http://localhost/', {
    headers: { 'content-security-policy': "script-src 'nonce-abc123XYZ' 'self'" },
  });
  const resp = await withRequest(req, () =>
    ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir, req }));
  const body = await resp.text();
  assert.ok(body.includes('nonce="abc123XYZ"'));
});

test('ssrPage: CSP nonce → meta csp-nonce tag emitted for client-router pickup', async () => {
  // Turbo's convention: server emits <meta name="csp-nonce" content="..."> so
  // the client router (router-client.js) can apply the original page-load
  // nonce to dynamically-created scripts (head merge, script reactivation).
  // Without this, strict-CSP apps break on every client-side nav.
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Page() { return html\`<p>ok</p>\`; }\n`,
  });
  const req = new Request('http://localhost/', {
    headers: { 'content-security-policy': "script-src 'nonce-xyz789' 'self'" },
  });
  const resp = await withRequest(req, () =>
    ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir, req }));
  const body = await resp.text();
  assert.match(body, /<meta name="csp-nonce" content="xyz789">/);
});

test('ssrPage: no nonce in CSP → no meta csp-nonce tag', async () => {
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Page() { return html\`<p>ok</p>\`; }\n`,
  });
  const req = new Request('http://localhost/');
  const resp = await withRequest(req, () =>
    ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir, req }));
  const body = await resp.text();
  assert.ok(!body.includes('csp-nonce'), 'no meta tag when no nonce in request CSP');
});

test('ssrPage: CSP nonce propagates to error-page response (boot scripts on error page need it)', async () => {
  // When the page render throws, the error response goes through a
  // different path (wrapInDocument with route.errors / fallback) but
  // still emits inline scripts because moduleUrls includes the
  // page + layouts. Strict-CSP would block those scripts if the
  // nonce isn't threaded through the error path.
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Page() { throw new Error('boom'); }\n`,
  });
  const req = new Request('http://localhost/', {
    headers: { 'content-security-policy': "script-src 'nonce-errnonceXYZ' 'self'" },
  });
  const resp = await withRequest(req, () =>
    ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir, req }));
  assert.equal(resp.status, 500);
  const body = await resp.text();
  assert.match(body, /<meta name="csp-nonce" content="errnonceXYZ">/,
    'error response must carry the meta csp-nonce tag');
});

test('ssrPage: response sets no cookie (action CSRF is an Origin / Sec-Fetch-Site check, #659)', async () => {
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Page() { return html\`<p>ok</p>\`; }\n`,
  });
  const req = new Request('http://localhost/');
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir, req });
  // No CSRF token cookie is issued, so the SSR response is cookieless (CDN-cacheable).
  assert.equal(resp.headers.get('set-cookie'), null, 'SSR response must set no cookie');
});

test('ssrPage: WEBJS_PUBLIC_* env vars are injected into window.process.env', async () => {
  const prevApi = process.env.WEBJS_PUBLIC_API_URL;
  const prevSecret = process.env.NOT_PUBLIC_SECRET;
  process.env.WEBJS_PUBLIC_API_URL = 'https://api.example.test';
  process.env.NOT_PUBLIC_SECRET = 'must-not-leak';
  try {
    const { route, appDir } = await makeRoute({
      pageSrc:
        `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
        `export default function Page() { return html\`<p>ok</p>\`; }\n`,
    });
    const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
    const body = await resp.text();
    assert.ok(body.includes('window.process.env'), 'shim assignment should appear in head');
    assert.ok(body.includes('"WEBJS_PUBLIC_API_URL":"https://api.example.test"'));
    assert.ok(body.includes('"NODE_ENV":"production"'), 'NODE_ENV must reflect dev:false');
    assert.equal(
      body.includes('must-not-leak'), false,
      'unprefixed env values must not appear in the SSR output',
    );
  } finally {
    if (prevApi === undefined) delete process.env.WEBJS_PUBLIC_API_URL;
    else process.env.WEBJS_PUBLIC_API_URL = prevApi;
    if (prevSecret === undefined) delete process.env.NOT_PUBLIC_SECRET;
    else process.env.NOT_PUBLIC_SECRET = prevSecret;
  }
});

/* ------------ bundle mode skips per-file preloads ------------ */


test('vendor: pin file changes update served importmap (fs.watch drives clearVendorCache)', async () => {
  // The pin file is at .webjs/vendor/importmap.json under the app
  // directory. When the dev-server file watcher fires for that path
  // it calls clearVendorCache so the next SSR rereads the new
  // bindings. This integration test verifies the seam: changing
  // the in-memory vendor entries (the same hook clearVendorCache
  // resets to) and re-rendering produces an importmap reflecting
  // the new state.
  const { setVendorEntries, buildImportMap } = await import(
    new URL('../../packages/server/src/importmap.js', import.meta.url).href
  );
  await setVendorEntries({ 'a': 'https://cdn.example/a.js' });
  let map = buildImportMap();
  assert.equal(map.imports.a, 'https://cdn.example/a.js');
  // Hand-edit equivalent: a new pin file would update the in-memory
  // entries on the next fs.watch fire. Simulate by re-setting.
  await setVendorEntries({ 'a': 'https://cdn.example/a-v2.js', 'b': 'https://cdn.example/b.js' });
  map = buildImportMap();
  assert.equal(map.imports.a, 'https://cdn.example/a-v2.js', 'updated URL replaces old');
  assert.equal(map.imports.b, 'https://cdn.example/b.js', 'new entry appears');
  await setVendorEntries({});
});

test('integrityAttr: emits integrity attribute for vendor URLs with known SRI hash', async () => {
  // Companion to preloadCrossOriginAttr coverage. Tests that the
  // integrityAttr helper used by the modulepreload emission loop
  // returns the matching integrity attribute when the URL has a
  // pinned hash, and nothing when it doesn't.
  const { setVendorEntries } = await import(
    new URL('../../packages/server/src/importmap.js', import.meta.url).href
  );
  const { integrityAttr } = await import(
    new URL('../../packages/server/src/ssr.js', import.meta.url).href
  );
  await setVendorEntries(
    { 'fake-vendor': '/__webjs/vendor/fake-vendor@1.0.0.js' },
    { '/__webjs/vendor/fake-vendor@1.0.0.js': 'sha384-validHashValueHere==' },
  );
  try {
    assert.equal(
      integrityAttr('/__webjs/vendor/fake-vendor@1.0.0.js'),
      ' integrity="sha384-validHashValueHere=="',
    );
    // URL not in the integrity map: no attribute.
    assert.equal(integrityAttr('/__webjs/vendor/unpinned.js'), '');
    // Non-vendor URLs always return empty.
    assert.equal(integrityAttr('/components/foo.ts'), '');
    assert.equal(integrityAttr('/__webjs/core/index.js'), '');
  } finally {
    await setVendorEntries({});
  }
});
