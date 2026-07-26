/**
 * No page or layout may render a `<style>` inside the client router's swap
 * range (#1109).
 *
 * The router swaps the DOM between the keyed boundary comments each layout
 * emits around its children (`<!--wj:children:<segmentPath>:<routeKey>-->`). A
 * `<style>` a page or a sub-layout renders is INSIDE that range, so crossing
 * between two routes that own different ones removes a stylesheet and inserts
 * another. Adding or removing a stylesheet mutates the document CSSOM, and that
 * invalidates style for the ENTIRE document, including the parts the router
 * deliberately preserved. The reported symptom was the fixed header flashing
 * when clicking in and out of /docs, even though the header element itself was
 * never touched: its backdrop-filter and its oklch() / color-mix() tokens had
 * to re-resolve.
 *
 * Three nets, deliberately overlapping, because each misses something:
 *
 *   1. SOURCE. No page or layout file under app/ contains a `<style>`, except
 *      the root layout (which renders outside every boundary). Covers 100% of
 *      routes with no request, and names the offending FILE.
 *   2. STRUCTURAL. For every route the app actually serves, no `<style>`
 *      appears between the boundary comments. Catches a `<style>` that arrives
 *      from somewhere the source scan does not look, such as a shared render
 *      helper or a light-DOM component's template.
 *   3. BYTE-LEVEL. The full `<style>` set is IDENTICAL across every route, so
 *      any crossing adds and removes nothing. This is the acceptance criterion
 *      the issue names, and it also catches a head-level `<style>` that
 *      differs per route.
 *
 * The route list is DERIVED from the filesystem, not hand-written. An earlier
 * draft listed six representative URLs, which meant a `<style>` reintroduced on
 * /changelog or /articles slipped past the whole file. A list someone has to
 * remember to extend is not a property.
 *
 * All three would have failed before #1109: the landing page carried 2076 bytes
 * of editor tokens and the docs sub-layout carried 9923 bytes of prose rules,
 * so the crossing swung the document's inline CSS from 9199 to 17046 bytes.
 *
 * A page that genuinely needs per-request CSS (a value computed from params) is
 * not covered by this rule, and there is none on this site. Static rules belong
 * in public/input.css, which the root layout loads once ABOVE every boundary
 * and the router never swaps.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@webjsdev/server';

const WEBSITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP_DIR = resolve(WEBSITE_ROOT, 'app');

/** The one layout allowed a `<style>`: it renders outside every boundary. */
const ROOT_LAYOUT = 'layout.ts';

/** Routing files whose output lands inside a swap boundary. */
const ROUTE_FILE = /^(page|layout|error|not-found|loading|forbidden|unauthorized)\.(ts|js|mts|mjs)$/;

/** Every routing file under app/, as a path relative to app/. */
function routeFiles(dir = APP_DIR): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...routeFiles(full));
    else if (ROUTE_FILE.test(e.name)) out.push(relative(APP_DIR, full));
  }
  return out.sort();
}

/**
 * Every STATIC route the app serves, derived from app/<segments>/page.ts.
 * Dynamic segments are excluded here and resolved against real content below,
 * since `[slug]` is not a URL.
 */
function staticRoutes(): string[] {
  return routeFiles()
    .filter((f) => /(^|\/)page\.(ts|js|mts|mjs)$/.test(f))
    .map((f) => '/' + f.replace(/(^|\/)page\.(ts|js|mts|mjs)$/, ''))
    .map((p) => (p.length > 1 ? p.replace(/\/$/, '') : '/'))
    .filter((p) => !p.includes('[') && !p.includes('('))
    .sort();
}

/** The index page each dynamic route hangs off, used to find a real instance. */
const DYNAMIC_INDEXES = ['/blog', '/articles', '/compare'];

let handle: (path: string) => Promise<Response>;
/** Static routes plus one resolved instance of each dynamic route. */
let routes: string[];

before(async () => {
  const app = await createRequestHandler({ appDir: WEBSITE_ROOT, dev: false });
  await app.warmup?.();
  handle = (path) => app.handle(new Request('http://localhost' + path));

  const candidates = staticRoutes();
  // Resolve one concrete URL per dynamic route by taking the first child link
  // off its index page, so /blog/[slug] and friends are covered by a REAL
  // rendered post rather than skipped for being unaddressable.
  for (const index of DYNAMIC_INDEXES) {
    const res = await handle(index);
    if (!res.ok) continue;
    const html = await res.text();
    const child = [...html.matchAll(/href="([^"]+)"/g)]
      .map((m) => m[1])
      .find((h) => h.startsWith(index + '/') && h.split('/').length === 3);
    if (child) candidates.push(child);
  }

  // Keep only routes that render a document. A redirect-only route (/docs
  // 308s to /docs/getting-started) has no body to inspect, and treating its
  // empty response as "zero styles" would make the byte-identical assertion
  // fail for the wrong reason.
  routes = [];
  for (const p of candidates) {
    if ((await handle(p)).status === 200) routes.push(p);
  }
});

const bodyOf = async (path: string) => {
  const res = await handle(path);
  assert.ok(res.status < 400, `${path} should render, got ${res.status}`);
  return res.text();
};

/**
 * Every `<style>` element's full source text, in document order.
 *
 * Scripts and HTML comments are stripped FIRST. A `<script>` is raw text to the
 * HTML parser, so a literal opening style tag inside one is just characters,
 * but a naive regex pairs it with the next real closing tag and reports a
 * multi-KB phantom element. That is not hypothetical: it happened here, because
 * the root layout's inline script carries a comment about this very rule. The
 * app-side fix is to spell the tag name out in shipped comments; this is the
 * belt to that braces, so the measurement cannot lie either way.
 */
function stylesOf(html: string): string[] {
  const scrubbed = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  return [...scrubbed.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
}

/**
 * The router's swap range: from the first children-boundary OPEN comment to the
 * last CLOSE. The root layout emits the outermost pair around `${children}`, so
 * this slice is precisely the markup a soft navigation can replace. Anything
 * the root layout renders outside `${children}` (its own `<style>`, the header,
 * the footer) falls outside it, which is the point.
 */
function swapRangeOf(html: string, path: string): string {
  const start = html.indexOf('<!--wj:children:');
  assert.ok(start >= 0, `${path} emits a children boundary (the router needs one to soft-navigate)`);
  const end = html.lastIndexOf('<!--/wj:children:');
  assert.ok(end > start, `${path} closes its children boundary`);
  return html.slice(start, end);
}

/**
 * Source with comments removed, so prose ABOUT a `<style>` is not mistaken for
 * one. Several of these files carry a comment saying why they render no
 * `<style>`, which a naive scan flags as the very thing it is describing.
 *
 * The `//` rule skips a match preceded by `:` so a `https://` URL does not eat
 * the rest of its line. A mis-strip here can only cost coverage, never produce
 * a false positive, and the served-HTML test below is the authoritative net.
 */
function withoutComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('the style scanner is not fooled by a tag name inside a script or comment', () => {
  // Guards the scrubbing in stylesOf. Without it, the literal tag inside the
  // script pairs with the real closing tag below it and reports one giant
  // phantom element, which is exactly the bug this scanner hit in review.
  const html = [
    '<script>// mentions <style> in a comment</script>',
    '<!-- and <style> in an HTML comment -->',
    '<style>.real { color: red }</style>',
  ].join('\n');
  assert.deepEqual(stylesOf(html), ['.real { color: red }']);
});

test('no page or layout SOURCE file renders a <style>, except the root layout', () => {
  const offenders = routeFiles()
    .filter((f) => f !== ROOT_LAYOUT)
    .filter((f) => /<style[\s>]/.test(withoutComments(readFileSync(join(APP_DIR, f), 'utf8'))));
  assert.deepEqual(
    offenders,
    [],
    'these render a <style> inside the router swap boundary, so navigating in or out of ' +
      'them inserts and removes a stylesheet and invalidates style for the whole document. ' +
      'Move the rules to public/input.css.'
  );
});

test('the source scan still fires when a <style> is reintroduced', () => {
  // The scan above strips comments, and getting that wrong in the other
  // direction (stripping too much) would silently disable it. Prove the
  // detector still sees a real one in a file shaped like the docs sub-layout.
  const realistic = `
    /* This comment mentions <style> and must not count. */
    export default function L({ children }) {
      return html\`
        <!-- Neither does this <style> mention. -->
        <style>.prose-docs ul { list-style: disc; }</style>
        <div>\${children}</div>
      \`;
    }`;
  assert.match(withoutComments(realistic), /<style[\s>]/, 'a real <style> survives comment stripping');
  const commentsOnly = realistic.replace('<style>.prose-docs ul { list-style: disc; }</style>', '');
  assert.doesNotMatch(withoutComments(commentsOnly), /<style[\s>]/, 'while prose about one does not');
});

test('no route SERVES a <style> inside the router swap range', async () => {
  assert.ok(routes.length > 40, `expected the site's full route list, got ${routes.length}`);
  for (const path of routes) {
    const inRange = stylesOf(swapRangeOf(await bodyOf(path), path));
    assert.deepEqual(
      inRange.map((s) => s.trim().slice(0, 80)),
      [],
      `${path} serves a <style> inside the swap boundary`
    );
  }
});

test('every route serves a byte-identical <style> set, so any crossing is churn-free', async () => {
  const baselinePath = routes[0];
  const baseline = stylesOf(await bodyOf(baselinePath));
  assert.ok(baseline.length > 0, 'the site does carry inline style, so this is not vacuously true');
  assert.ok(
    baseline.reduce((n, s) => n + s.length, 0) > 0,
    'and it is not a set of empty <style> elements'
  );

  for (const path of routes) {
    // Element-for-element, not just totals: an equal byte count with different
    // content would still be a remove plus an insert.
    assert.deepEqual(
      stylesOf(await bodyOf(path)),
      baseline,
      `${path} serves different inline style than ${baselinePath}, so crossing between them churns the CSSOM`
    );
  }
});

test('the docs prose rules ship in the compiled stylesheet, not the document', async () => {
  // The counterpart to the assertions above: proving nothing churns is only
  // half the property, the rules still have to reach the page. They arrive
  // through the root layout's one <link>, which is loaded above every boundary
  // and never swapped.
  const doc = await bodyOf('/docs/routing');
  assert.ok(
    doc.includes('<link rel="stylesheet" href="/public/tailwind.css">'),
    'the docs load the shared compiled stylesheet'
  );
  assert.ok(doc.includes('class="prose-docs"'), 'and the content column carries the prose hook');
  assert.ok(
    !stylesOf(doc).some((s) => s.includes('.prose-docs')),
    'while no inline <style> redeclares the prose rules'
  );

  const css = readFileSync(resolve(WEBSITE_ROOT, 'public/input.css'), 'utf8');
  assert.ok(css.includes('.prose-docs h1'), 'the prose rules live in the compiled stylesheet source');
});
