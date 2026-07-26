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

/**
 * Every dynamic route family, as the parent path its instances hang off.
 * Derived, not listed: `app/blog/[slug]/page.ts` yields `/blog`. A hand-written
 * list would silently give a NEW family zero coverage, which is the same defect
 * the static list had.
 */
function dynamicFamilies(): string[] {
  return routeFiles()
    .filter((f) => /(^|\/)page\.(ts|js|mts|mjs)$/.test(f))
    .map((f) => f.replace(/(^|\/)page\.(ts|js|mts|mjs)$/, ''))
    .filter((p) => p.includes('['))
    .map((p) => '/' + p.split('/').slice(0, -1).join('/'))
    .filter((p, i, a) => a.indexOf(p) === i)
    .sort();
}

let handle: (path: string) => Promise<Response>;
/** Static routes plus one resolved instance of each dynamic route. */
let routes: string[];
/** Dynamic families the resolution could not reach, asserted empty below. */
const unresolvedFamilies: string[] = [];

before(async () => {
  const app = await createRequestHandler({ appDir: WEBSITE_ROOT, dev: false });
  await app.warmup?.();
  handle = (path) => app.handle(new Request('http://localhost' + path));

  const candidates = staticRoutes();
  // Resolve one concrete URL per dynamic family by taking the first child link
  // off its index page, so /blog/[slug] and friends are covered by a REAL
  // rendered post rather than skipped for being unaddressable. Recorded so the
  // test below can FAIL when a family stops resolving, instead of quietly
  // shrinking its own coverage.
  for (const family of dynamicFamilies()) {
    const res = await handle(family);
    if (!res.ok) { unresolvedFamilies.push(`${family} (index returned ${res.status})`); continue; }
    const html = await res.text();
    const depth = family.split('/').length + 1;
    const child = [...html.matchAll(/href="([^"]+)"/g)]
      .map((m) => m[1])
      .find((h) => h.startsWith(family + '/') && h.split('/').length === depth);
    if (child) candidates.push(child);
    else unresolvedFamilies.push(`${family} (no instance link found on the index)`);
  }

  // Keep only routes that render a document. A redirect-only route (/docs
  // 308s to /docs/getting-started) has no body to inspect, and treating its
  // empty response as "zero stylesheets" would make the byte-identical
  // assertion fail for the wrong reason.
  routes = [];
  for (const p of candidates) {
    if ((await handle(p)).status === 200) routes.push(p);
  }
});

test('every dynamic route family resolved to a real instance', () => {
  // The resolution above degrades silently by construction (a changed permalink
  // shape or a link moved into a template just finds nothing). Without this,
  // all three families could drop out and the suite would still pass, because
  // 51 static routes clear any count threshold.
  assert.deepEqual(
    unresolvedFamilies,
    [],
    'these dynamic routes are covered by nothing. Either the index page stopped linking to ' +
      'its children in a shape this can find, or the family is NESTED (app/x/[a]/[b]/page.ts ' +
      'yields the non-URL parent /x/[a]), in which case teach dynamicFamilies() to resolve the ' +
      'outer segment first rather than deleting the assertion'
  );
  assert.ok(dynamicFamilies().length > 0, 'the site does have dynamic routes, so this is not vacuous');
});

const bodyOf = async (path: string) => {
  const res = await handle(path);
  assert.ok(res.status < 400, `${path} should render, got ${res.status}`);
  return res.text();
};

/**
 * Drop the contents of every declarative-shadow-root template.
 *
 * A `<style>` inside `<template shadowrootmode="...">` belongs to a shadow
 * tree, not the document. Inserting or removing it does NOT invalidate document
 * style (and on the client the component adopts it via adoptedStyleSheets), so
 * it is not churn and a shadow component legitimately carries one via
 * `static styles`. Counting them made a page with three shadow previews look
 * like it churned three stylesheets against a page with none.
 *
 * Balanced scan rather than a non-greedy regex, because a template can nest.
 */
function stripShadowTemplates(html: string): string {
  const OPEN = /<template\b[^>]*\bshadowrootmode\b[^>]*>/gi;
  const TAG = /<template\b[^>]*>|<\/template\s*>/gi;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = OPEN.exec(html))) {
    if (m.index < last) continue;
    out += html.slice(last, m.index);
    let depth = 1;
    let end = html.length;
    TAG.lastIndex = OPEN.lastIndex;
    let t: RegExpExecArray | null;
    while (depth > 0 && (t = TAG.exec(html))) {
      depth += t[0][1] === '/' ? -1 : 1;
      end = TAG.lastIndex;
    }
    last = depth === 0 ? end : html.length;
    OPEN.lastIndex = last;
  }
  return out + html.slice(last);
}

/**
 * Every stylesheet the document carries, in order, as `TAG:content` entries.
 *
 * Covers `<link rel~="stylesheet">` as well as `<style>`. Both mutate the
 * document CSSOM when inserted or removed, so both churn identically; a link
 * additionally costs a network fetch. Scanning only for `<style>` let the
 * cheapest regression (rendering a `<link>` from a nested layout) pass all
 * three nets, and it disagreed with the e2e, which counts links as churn.
 *
 * Scripts and HTML comments are stripped FIRST. A `<script>` is raw text to the
 * HTML parser, so a literal opening style tag inside one is just characters,
 * but a naive regex pairs it with the next real closing tag and reports a
 * multi-KB phantom element. That is not hypothetical: it happened here, because
 * the root layout's inline script carries a comment about this very rule.
 */
function sheetsOf(html: string): string[] {
  const scrubbed = stripShadowTemplates(html)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const out: string[] = [];
  for (const m of scrubbed.matchAll(/<style[^>]*>([\s\S]*?)<\/style>|<link\b([^>]*)>/gi)) {
    if (m[1] !== undefined) { out.push('STYLE:' + m[1]); continue; }
    const attrs = m[2] || '';
    const rel = /\brel\s*=\s*["']?([^"'>]*)/i.exec(attrs)?.[1] || '';
    if (rel.toLowerCase().split(/\s+/).includes('stylesheet')) out.push('LINK:' + attrs.trim());
  }
  return out;
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
 * A raw `<style>` or `<link rel=stylesheet>` anywhere in a routing file's
 * source, comments included.
 *
 * Deliberately NOT comment-aware. An earlier version stripped comments so prose
 * about a style tag would not be flagged, and the block-comment rule paired the
 * first `/*` with the first `*\/`, which on docs pages full of unbalanced `/*`
 * inside CSS samples deleted up to 78% of the file before scanning. A net with
 * a silent hole that large is worse than no net.
 *
 * The convention instead is that prose spells the tag name out rather than
 * bracketing it, which these files already do (and which they need anyway,
 * since a bracketed tag inside a shipped comment confuses any scanner reading
 * the served HTML). This scan is what enforces that convention: writing a
 * bracketed tag in a comment fails it, which is the intended nudge.
 */
const SHEET_IN_SOURCE = /<style[\s>]|<link\b[^>]*rel\s*=\s*["']?[^"'>]*stylesheet/i;

test('the document scanner is not fooled by a tag name inside a script or comment', () => {
  // Guards the scrubbing in sheetsOf. Without it, the literal tag inside the
  // script pairs with the real closing tag below it and reports one giant
  // phantom element, which is exactly what happened here: it inflated the
  // measured style bytes by 1368 and would have masked a later regression.
  const html = [
    '<script>// mentions <style> in a comment</script>',
    '<!-- and <style> in an HTML comment -->',
    '<style>.real { color: red }</style>',
    '<link rel="icon" href="/favicon.png">',
    '<link rel="stylesheet" href="/public/tailwind.css">',
  ].join('\n');
  assert.deepEqual(sheetsOf(html), [
    'STYLE:.real { color: red }',
    'LINK:rel="stylesheet" href="/public/tailwind.css"',
  ]);
});

test('a shadow-DOM component style is not counted as churn', () => {
  // A <style> inside <template shadowrootmode> belongs to a shadow tree, not
  // the document, so inserting or removing it invalidates nothing document-wide
  // and a shadow component legitimately ships one via `static styles`. Counting
  // them made a ui-website page with three shadow previews look like it churned
  // three stylesheets against a page with none. Nesting is handled with a
  // balanced scan, which a non-greedy regex would get wrong.
  const html = [
    '<style>.doc { color: red }</style>',
    '<my-el><template shadowrootmode="open">',
    '  <style>:host { display: block }</style>',
    '  <template><style>.nested { color: blue }</style></template>',
    '</template></my-el>',
  ].join('\n');
  assert.deepEqual(sheetsOf(html), ['STYLE:.doc { color: red }']);
});

test('no page or layout SOURCE file renders a <style>, except the root layout', () => {
  const offenders = routeFiles()
    .filter((f) => f !== ROOT_LAYOUT)
    .filter((f) => SHEET_IN_SOURCE.test(readFileSync(join(APP_DIR, f), 'utf8')));
  assert.deepEqual(
    offenders,
    [],
    'these render a <style> inside the router swap boundary, so navigating in or out of ' +
      'them inserts and removes a stylesheet and invalidates style for the whole document. ' +
      'Move the rules to public/input.css.'
  );
});

test('the source scan fires for a style block AND for a stylesheet link', () => {
  // Both churn the CSSOM. Scanning only for a style block let the cheapest
  // regression through: a nested layout rendering its own <link>.
  assert.match('<style>.a{color:red}</style>', SHEET_IN_SOURCE);
  assert.match('<link rel="stylesheet" href="/public/app.css">', SHEET_IN_SOURCE);
  assert.match("<link href='/x.css' rel='preload stylesheet'>", SHEET_IN_SOURCE);
  // And it must not fire on the things a routing file legitimately carries.
  assert.doesNotMatch('<link rel="icon" href="/favicon.png">', SHEET_IN_SOURCE);
  assert.doesNotMatch('<link rel="modulepreload" href="/x.js">', SHEET_IN_SOURCE);
  assert.doesNotMatch('a style block belongs in public/input.css', SHEET_IN_SOURCE);
});

test('no route SERVES a <style> inside the router swap range', async () => {
  assert.ok(routes.length > 40, `expected the site's full route list, got ${routes.length}`);
  for (const path of routes) {
    const inRange = sheetsOf(swapRangeOf(await bodyOf(path), path));
    assert.deepEqual(
      inRange.map((s) => s.trim().slice(0, 80)),
      [],
      `${path} serves a <style> inside the swap boundary`
    );
  }
});

test('every route serves a byte-identical <style> set, so any crossing is churn-free', async () => {
  const baselinePath = routes[0];
  const baseline = sheetsOf(await bodyOf(baselinePath));
  assert.ok(baseline.length > 0, 'the site does carry inline style, so this is not vacuously true');
  assert.ok(
    baseline.reduce((n, s) => n + s.length, 0) > 0,
    'and it is not a set of empty <style> elements'
  );

  for (const path of routes) {
    // Element-for-element, not just totals: an equal byte count with different
    // content would still be a remove plus an insert.
    assert.deepEqual(
      sheetsOf(await bodyOf(path)),
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
    !sheetsOf(doc).some((s) => s.includes('.prose-docs')),
    'while no inline <style> redeclares the prose rules'
  );

  const css = readFileSync(resolve(WEBSITE_ROOT, 'public/input.css'), 'utf8');
  assert.ok(css.includes('.prose-docs h1'), 'the prose rules live in the compiled stylesheet source');
});
