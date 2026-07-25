/**
 * SSR smoke test for the /why-webjs pitch page (app/why-webjs/page.ts).
 *
 * The page is pure marketing markup (no components of its own), so this guards
 * the things that would only otherwise surface at dogfood boot: a render crash,
 * a malformed html`` template, a stray-backtick (invariant 9) regression, a
 * dropped install command, or the missing main landmark. It also pins the
 * page's own metadata as self-consistent across the title, og, and twitter tags
 * and pointed at the dedicated /why-webjs social card.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from '@webjsdev/core/server';
import Why, { generateMetadata } from '#app/why-webjs/page.ts';

test('the pitch page SSRs with its headline, terminals, reason cards, and a main landmark', async () => {
  const out = await renderToString(Why());
  assert.ok(out.length > 1000, 'renders substantial HTML');
  assert.ok(out.includes('already understands'), 'includes the hero headline');
  assert.ok(out.includes('full-stack JavaScript framework'), 'states the full-stack framework category');
  assert.ok(out.includes('npm create webjs@latest my-app'), 'includes the install command');
  assert.ok(out.includes('No training data required'), 'includes the core pitch reason');
  assert.ok(out.includes('node_modules/@webjsdev/core/src'), 'includes the read-the-source terminal proof');
  assert.ok(out.includes('<main id="main"'), 'wraps content in a main landmark');
});

test('why metadata is self-consistent and points at the dedicated /why-webjs social card', () => {
  const m = generateMetadata({ url: 'https://webjs.dev/why-webjs' });
  assert.equal(m.openGraph.title, m.title, 'og:title matches the <title>');
  assert.equal(m.twitter.title, m.title, 'twitter:title matches the <title>');
  assert.equal(m.openGraph.description, m.description, 'og:description matches the meta description');
  assert.equal(m.twitter.description, m.description, 'twitter:description matches the meta description');
  assert.equal(m.openGraph.url, 'https://webjs.dev/why-webjs', 'og:url is the canonical /why-webjs URL');
  assert.match(m.openGraph.image, /\/public\/og-why\.png$/, 'og:image is the dedicated /why card');
  assert.equal(m.twitter.image, m.openGraph.image, 'twitter image matches the og image');
});

test('the /why-webjs title uses a clean hyphen form, not a colon', () => {
  // Guards the regression that shipped the title as "Why WebJs: the framework
  // ...". This is a marketing page, so it takes the brand-first hyphen title
  // like the home page, not a colon-label form.
  const { title } = generateMetadata({ url: 'https://webjs.dev/why-webjs' });
  assert.ok(!title.includes(':'), 'title uses no colon-label form');
});
