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

test('the pitch page argues the defaults arrive unasked, and that quality holds across models', async () => {
  // The page used to argue model-agnosticism only from the model side (any
  // model CAN read the source). These are the reader-side half. The first claim
  // is deliberately NOT "you need not know the framework's vocabulary", which
  // is a non-claim: an agent resolves internals for a technical and a
  // non-technical prompter alike. It is that the things nobody thinks to ask
  // for arrive anyway, which is a property of the defaults rather than of the
  // wording of the prompt.
  const out = await renderToString(Why());
  assert.ok(out.includes('You should not have to know what to ask for'), 'includes the unasked-for section heading');
  assert.ok(out.includes('no reason to know exists'), 'names the gap as not knowing a thing exists, not as not knowing its name');
  assert.ok(out.includes('quality of what comes back'), 'ties model-agnosticism to output quality, not just to whether a model works');
});

test('the section names defaults the prompt never asked for', async () => {
  // The prose carries the argument, but these four cards are what make it
  // concrete, and an unasserted card grid could be deleted with the rest of the
  // file still green. Each card must also stay a genuine DEFAULT: if one is
  // ever reworded into something the prompt has to request, the section's claim
  // is gone while every other assertion here still passes.
  const out = await renderToString(Why());
  const prompt = out.slice(out.indexOf('aria-label="A prompt written the way'), out.indexOf('Nothing in that sentence'));
  assert.ok(prompt.includes('Let customers book a table'), 'the prompt is a request written the way somebody would say it out loud');
  assert.ok(prompt.includes('staff see who is coming in'), 'the slice really is the whole prompt panel');

  for (const claim of ['The information is really kept', 'It works when the code does not load', 'It looks like one product', 'Strangers cannot walk in']) {
    assert.ok(out.includes(claim), `the section names ${claim} among what arrives unasked`);
  }
  assert.ok(out.includes('arrives anyway'), 'says outright that these arrive without being requested');

  // None of the four may appear in the prompt, or the section is demonstrating
  // the opposite of what it claims.
  for (const asked of ['database', 'design system', 'session', 'secure', 'production']) {
    assert.ok(!prompt.includes(asked), `the prompt never asks for ${asked}, which is the entire point of the four cards below it`);
  }
});

test('the /why-webjs description answers in the snippet window a SERP actually shows', async () => {
  // Mirrors the assertion on /what-is-webjs. The claim this page leads with is
  // only worth adding if it survives truncation, and nothing pinned that here.
  const { description } = generateMetadata({ url: 'https://webjs.dev/why-webjs' });
  const firstSentence = description.slice(0, description.indexOf('. ') + 1);
  assert.ok(firstSentence.length <= 160, `first sentence is ${firstSentence.length} chars, over the 160-char snippet window`);
  assert.ok(firstSentence.includes('nobody thinks to ask for'), 'the unasked-for claim is inside the snippet window, not past it');
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
