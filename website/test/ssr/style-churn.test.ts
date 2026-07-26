/**
 * No page or layout may render a `<style>` inside the client router's swap
 * range (#1109).
 *
 * The router swaps the DOM between the keyed boundary comments each layout
 * emits around its children. A `<style>` a page or a sub-layout renders is
 * INSIDE that range, so crossing between two routes that own different ones
 * removes a stylesheet and inserts another on every hop. Adding or removing a
 * stylesheet mutates the document CSSOM, and that invalidates style for the
 * ENTIRE document, including the parts the router deliberately preserved. The
 * reported symptom was the fixed header flashing when clicking in and out of
 * /docs, even though the header element itself was never touched: its
 * backdrop-filter and its oklch() / color-mix() tokens had to re-resolve.
 *
 * This is a property of where CSS is authored, not of the router, so it is
 * asserted at SSR against the real request pipeline. Two complementary shapes:
 *
 *   1. Structural. No `<style>` appears between the boundary comments on any
 *      route. This is the actual invariant and it localizes a regression to
 *      the offending route.
 *   2. Byte-level. The full `<style>` set is IDENTICAL across a marketing page
 *      and a docs page, so a navigation between them adds and removes nothing.
 *      This is the acceptance criterion the issue names, and it also catches a
 *      head-level `<style>` that somehow differs per route.
 *
 * Both would have failed before #1109: the landing page carried 2076 bytes of
 * editor tokens and the docs sub-layout carried 9923 bytes of prose rules, so
 * the crossing swung the document's inline CSS from 9199 to 17046 bytes.
 *
 * A page that genuinely needs per-request CSS (a value computed from params)
 * is not covered by this rule, and there is none on this site. Static rules
 * belong in public/input.css, which the root layout loads once ABOVE every
 * boundary and the router never swaps.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@webjsdev/server';

const WEBSITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * One route per shape the site serves: the landing page (which owned the
 * editor-token `<style>`), a docs page (whose sub-layout owned the prose
 * `<style>`), and the other two long-form marketing surfaces.
 */
const ROUTES = ['/', '/docs/routing', '/docs/styling', '/what-is-webjs', '/why-webjs', '/blog'];

const MARKETING_PATH = '/';
const DOC_PATH = '/docs/routing';

let handle: (path: string) => Promise<Response>;

before(async () => {
  const app = await createRequestHandler({ appDir: WEBSITE_ROOT, dev: false });
  await app.warmup?.();
  handle = (path) => app.handle(new Request('http://localhost' + path));
});

const bodyOf = async (path: string) => {
  const res = await handle(path);
  assert.equal(res.status, 200, `${path} should render`);
  return res.text();
};

/** Every `<style>` element's full source text, in document order. */
function stylesOf(html: string): string[] {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
}

/**
 * The router's swap range: everything from the first children-boundary OPEN
 * comment to the last CLOSE comment. The root layout emits the outermost pair
 * around `${children}`, so this slice is precisely the markup a soft navigation
 * can replace. Anything the root layout renders outside `${children}` (its own
 * `<style>`, the header, the footer) falls outside it, which is the point.
 */
function swapRangeOf(html: string, path: string): string {
  const start = html.indexOf('<!--wj:children:');
  assert.ok(start >= 0, `${path} emits a children boundary (the router needs one to soft-navigate)`);
  const end = html.lastIndexOf('<!--/wj:children:');
  assert.ok(end > start, `${path} closes its children boundary`);
  return html.slice(start, end);
}

test('no route renders a <style> inside the router swap range', async () => {
  for (const path of ROUTES) {
    const range = swapRangeOf(await bodyOf(path), path);
    const inRange = stylesOf(range);
    assert.deepEqual(
      inRange.map((s) => s.trim().slice(0, 80)),
      [],
      `${path} renders a <style> inside the swap boundary, so navigating in or out of it ` +
        'inserts and removes a stylesheet and invalidates style for the whole document. ' +
        'Move the rules to public/input.css.'
    );
  }
});

test('the <style> set is byte-identical across a marketing page and a docs page', async () => {
  const [marketing, doc] = await Promise.all([bodyOf(MARKETING_PATH), bodyOf(DOC_PATH)]);
  const a = stylesOf(marketing);
  const b = stylesOf(doc);

  // Element-for-element, not just totals: an equal byte count with different
  // content would still be a remove plus an insert.
  assert.deepEqual(b, a, 'crossing between the two must add and remove no <style>');

  const bytes = (s: string[]) => s.reduce((n, x) => n + x.length, 0);
  assert.equal(bytes(b), bytes(a), 'total inline style bytes are unchanged across the crossing');
  assert.ok(bytes(a) > 0, 'the site does carry inline style, so this is not vacuously true');
});

test('every route serves the same inline style, so any crossing is churn-free', async () => {
  const seen = new Map<string, string[]>();
  for (const path of ROUTES) seen.set(path, stylesOf(await bodyOf(path)));

  const [firstPath, baseline] = [...seen][0];
  for (const [path, styles] of seen) {
    assert.deepEqual(styles, baseline, `${path} serves different inline style than ${firstPath}`);
  }
});

test('the docs prose rules ship in the compiled stylesheet, not the document', async () => {
  // The counterpart to the assertions above: proving nothing churns is only
  // half the property, the rules still have to reach the page. They arrive
  // through the root layout's one <link>, which is loaded above every boundary
  // and never swapped.
  const doc = await bodyOf(DOC_PATH);
  assert.ok(
    doc.includes('<link rel="stylesheet" href="/public/tailwind.css">'),
    'the docs load the shared compiled stylesheet'
  );
  assert.ok(doc.includes('class="prose-docs"'), 'and the content column carries the prose hook');
  assert.ok(
    !stylesOf(doc).some((s) => s.includes('.prose-docs')),
    'while no inline <style> redeclares the prose rules'
  );
});
