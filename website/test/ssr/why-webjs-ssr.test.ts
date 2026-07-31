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

test('the pitch page makes the plain-language prompt and cross-model quality argument', async () => {
  // The page used to argue model-agnosticism only from the model side (any
  // model CAN read the source). These two claims are the reader-side half: a
  // non-technical prompt still lands on the right structure, and the quality
  // of the output does not swing with the size of the model.
  const out = await renderToString(Why());
  assert.ok(out.includes('Describe what you want in plain language'), 'includes the plain-language section heading');
  assert.ok(out.includes('architecture from a sentence'), 'says the conventions decide the shape, not the prompt');
  assert.ok(out.includes('quality of what comes back'), 'ties model-agnosticism to output quality, not just to whether a model works');
});

test('the plain-language section pairs a prompt against the files the conventions produce', async () => {
  // The prose above the demo carries the argument, but the two windows are what
  // SHOW it, and they were previously unasserted: the whole grid could be
  // deleted with every test in this file still green. These pin both panels,
  // their correspondence, and the accessible name each scrollable block needs.
  const out = await renderToString(Why());
  assert.ok(out.includes('Let customers book a table'), 'the prompt panel carries a request written in ordinary words');
  for (const file of ['app/book/page.ts', 'app/staff/bookings/page.ts', 'modules/bookings/actions/create.server.ts', 'db/schema.server.ts']) {
    assert.ok(out.includes(file), `the file panel answers the prompt with ${file}`);
  }
  assert.ok(out.includes('<span class="ml-2 font-mono font-medium text-xs leading-none text-fg-subtle">files</span>'), 'the file listing is labelled files, not terminal');

  // The section's whole claim is that the prompt needs no framework vocabulary,
  // so assert that property of the prompt panel itself rather than tripwiring
  // one historical phrasing, which any reworded regression would walk past.
  const prompt = out.slice(out.indexOf('aria-label="A plain-language prompt'), out.indexOf('Where the conventions put it'));
  assert.ok(prompt.includes('Let customers'), 'the slice really is the prompt panel');
  for (const jargon of ['page.ts', '.server.ts', 'route', 'component', 'schema', 'action']) {
    assert.ok(!prompt.includes(jargon), `the prompt says nothing about ${jargon}, so it reads as a request rather than a spec`);
  }
});

test('the /why-webjs description answers in the snippet window a SERP actually shows', async () => {
  // Mirrors the assertion on /what-is-webjs. The claim this page leads with is
  // only worth adding if it survives truncation, and nothing pinned that here.
  const { description } = generateMetadata({ url: 'https://webjs.dev/why-webjs' });
  const firstSentence = description.slice(0, description.indexOf('. ') + 1);
  assert.ok(firstSentence.length <= 160, `first sentence is ${firstSentence.length} chars, over the 160-char snippet window`);
  assert.ok(firstSentence.includes('plain language'), 'the plain-language claim is inside the snippet window, not past it');
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
