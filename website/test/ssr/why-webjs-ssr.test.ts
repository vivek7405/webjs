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
  assert.match(out, /full-stack JavaScript web\s+components\s+framework/, 'states the web-components framework category');
  assert.ok(out.includes('npm create webjs@latest my-app'), 'includes the install command');
  assert.ok(out.includes('No training data required'), 'includes the core pitch reason');
  assert.ok(out.includes('node_modules/@webjsdev/core/src'), 'includes the read-the-source terminal proof');
  assert.ok(out.includes('<main id="main"'), 'wraps content in a main landmark');
});

test('the pitch page argues the prompt carries no architecture, and that quality holds across models', async () => {
  // The page used to argue model-agnosticism only from the model side (any
  // model CAN read the source). This is the reader-side half, and the claim is
  // deliberately NOT "you need not know the framework's vocabulary", which is
  // a non-claim: an agent resolves internals for a technical and a
  // non-technical prompter alike, so nobody needed that vocabulary either way.
  // The claim is comparative and about WHO CLOSES THE OPEN DECISIONS. Where
  // they are open, the prompt closes them. Here the framework already did.
  const out = await renderToString(Why());
  assert.ok(out.includes('The prompt does not have to carry the architecture'), 'includes the section heading');
  assert.ok(out.includes('has to be closed by'), 'names the mechanism as an open decision someone must close');
  assert.ok(out.includes('quality of what comes back'), 'ties model-agnosticism to output quality, not just to whether a model works');
});

test('the two prompts differ only by the architecture one of them has to spell out', async () => {
  // The contrast IS the argument, so both panels are pinned, and so is the
  // property that makes the contrast real: the appended instructions appear in
  // one prompt and in neither the other prompt nor as something WebJs asks for.
  const out = await renderToString(Why());
  // Both slices are bounded by aria-labels rather than by the visible column
  // headings, which are editorial and have been renamed once. A missing
  // boundary returns -1, which silently widens the slice to the rest of the
  // document and makes every includes() below pass vacuously, so assert the
  // boundaries exist before slicing on them.
  for (const boundary of ['aria-label="A prompt that has to specify', 'aria-label="The same request on WebJs', 'Both prompts should produce']) {
    assert.ok(out.includes(boundary), `the slice boundary ${boundary} still exists`);
  }
  const open = out.slice(out.indexOf('aria-label="A prompt that has to specify'), out.indexOf('aria-label="The same request on WebJs'));
  const made = out.slice(out.indexOf('aria-label="The same request on WebJs'), out.indexOf('Both prompts should produce'));

  const ask = 'Build me a table booking app';
  assert.ok(open.includes(ask), 'both panels open on the same request');
  assert.ok(made.includes(ask), 'both panels open on the same request');
  assert.ok(made.includes('that is the whole prompt'), 'the WebJs panel says the request is the whole prompt');

  // Every instruction the other prompt has to append must be absent here, or
  // the two panels are not actually showing a difference.
  for (const appended of ['real database', 'design system', 'production ready code and architecture']) {
    assert.ok(open.includes(appended), `the open-decision prompt has to append ${appended}`);
    assert.ok(!made.includes(appended), `the WebJs prompt never appends ${appended}, which is the whole contrast`);
  }

  // And each appended instruction has to correspond to something the section
  // then claims arrives anyway, so the contrast resolves instead of dangling.
  for (const arrives of ['Architecture', 'Code', 'Database', 'Design system']) {
    assert.ok(out.includes(`>${arrives}</h3>`), `the section names ${arrives} among what arrives without being asked`);
  }
});

test('the /why-webjs description answers in the snippet window a SERP actually shows', async () => {
  // Mirrors the assertion on /what-is-webjs. The claim this page leads with is
  // only worth adding if it survives truncation, and nothing pinned that here.
  const { description } = generateMetadata({ url: 'https://webjs.dev/why-webjs' });
  const firstSentence = description.slice(0, description.indexOf('. ') + 1);
  assert.ok(firstSentence.length <= 160, `first sentence is ${firstSentence.length} chars, over the 160-char snippet window`);
  assert.ok(firstSentence.includes('the whole prompt'), 'the whole-prompt claim is inside the snippet window, not past it');
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
