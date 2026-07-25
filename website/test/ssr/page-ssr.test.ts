/**
 * SSR smoke test for the landing page (app/page.ts), the redesign centerpiece.
 *
 * page.ts ties together the highlighter and copy-cmd. This guards a render
 * crash and the things that would only otherwise surface at dogfood boot: a
 * malformed html`` template, a stray-backtick (invariant 9) regression in a
 * code sample, a dropped command, or the missing main landmark.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from '@webjsdev/core/server';
import LandingPage, * as PageModule from '#app/page.ts';
import { generateMetadata } from '#app/layout.ts';

test('the landing page SSRs with its command, highlighted code, and a main landmark', async () => {
  const out = await renderToString(LandingPage());
  assert.ok(out.length > 1000, 'renders substantial HTML');
  assert.ok(out.includes('npm create webjs@latest my-app'), 'includes the install command');
  assert.match(out, /class="t-(kw|str|fn|type)"/, 'includes highlighted code tokens');
  assert.ok(out.includes('<main id="main"'), 'wraps content in a main landmark');
});

test('home metadata is single-source and consistent across title, og, and twitter', () => {
  // The home page must declare no diverging static metadata for the SHARE
  // target: the layout's generateMetadata is the one source, so the tab
  // <title> and the social-card title cannot split (a page title override
  // would win for <title> while the layout still supplied the whole og/twitter
  // objects, exactly the gap this guards). The home page IS the canonical
  // share target. It MAY contribute site-level JSON-LD, since metadata is
  // shallow-merged layout-then-page and a jsonLd-only object leaves the
  // layout's title/og untouched.
  const pm = PageModule.metadata;
  if (pm !== undefined) {
    assert.deepEqual(Object.keys(pm), ['jsonLd'], 'home page metadata is jsonLd-only (no title/description/og override)');
    assert.ok(Array.isArray(pm.jsonLd) && pm.jsonLd.length > 0, 'home jsonLd is a non-empty array');
  }
  const m = generateMetadata({ url: 'https://webjs.dev/' });
  assert.equal(m.openGraph.title, m.title, 'og:title matches the <title>');
  assert.equal(m.twitter.title, m.title, 'twitter:title matches the <title>');
  assert.equal(m.openGraph.description, m.description, 'og:description matches the meta description');
  assert.equal(m.twitter.description, m.description, 'twitter:description matches the meta description');
  // og:image:alt deliberately does NOT mirror the title. Alt text describes the
  // IMAGE, and the card (public/og.png) carries its own benefit-led headline
  // rather than the page title, so tying the two together would force one of
  // them to be wrong. What must hold is that it stays a real description
  // instead of silently going empty or falling back to the title.
  const alt = m.openGraph['image:alt'];
  assert.equal(typeof alt, 'string', 'og image alt is a string');
  assert.ok(alt.trim().length > 20, `og image alt is a real description, got ${JSON.stringify(alt)}`);
  assert.notEqual(alt, m.title, 'og image alt describes the card, not the page title');
});
