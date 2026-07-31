/**
 * The accessible name on every code block the marketing pages render.
 *
 * A <pre> maps to ARIA role `generic`, and ARIA prohibits an author-supplied
 * name on `generic`, so a bare <pre aria-label="..."> gives a spec-following
 * screen reader a name it will not announce. Every block that carries a name
 * therefore carries an explicit `role="region"` to make that name one ARIA
 * permits, and because a named region is a landmark, the names have to be
 * unique per page or they collapse into an ambiguous pair in the landmark list.
 *
 * This lives in its own file rather than inside each page's test because the
 * rule is a property of the SITE, not of one page. The pages here were fixed
 * together, and pinning them together is what stops the next one from drifting
 * back: the sweep that fixed them originally covered one page, and the other
 * two went unobserved until a review caught it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from '@webjsdev/core/server';
import Home from '#app/page.ts';
import WhatIsWebJs from '#app/what-is-webjs/page.ts';
import Why from '#app/why-webjs/page.ts';

/** Every `<pre …>` open tag in the rendered HTML, attribute order as authored. */
function preTags(html: string) {
  return html.match(/<pre\b[^>]*>/g) ?? [];
}

function nameOf(tag: string) {
  return tag.match(/aria-label="([^"]*)"/)?.[1];
}

const PAGES = [
  { name: '/', render: () => Home() },
  { name: '/what-is-webjs', render: () => WhatIsWebJs() },
  { name: '/why-webjs', render: () => Why() },
];

for (const page of PAGES) {
  test(`every named code block on ${page.name} carries a role that permits the name`, async () => {
    const tags = preTags(await renderToString(page.render()));
    assert.ok(tags.length > 0, 'the page renders at least one code block');
    const named = tags.filter(nameOf);
    assert.ok(named.length > 0, 'the page renders at least one NAMED code block, so this test has something to check');
    for (const tag of named) {
      // Read the role by attribute, not by position: an order-sensitive regex
      // would red on correct markup that simply wrote the attributes the other
      // way round.
      assert.match(tag, /\brole="region"/, `a named pre is missing role=region, so its name is one ARIA prohibits: ${nameOf(tag)}`);
    }
  });

  test(`no two code blocks on ${page.name} share a landmark name`, async () => {
    const named = preTags(await renderToString(page.render())).map(nameOf).filter(Boolean);
    assert.deepEqual([...new Set(named)], named, `duplicate landmark names on ${page.name}: ${named.join(', ')}`);
  });
}

test('a code block with no name needs no role, so it adds no landmark', async () => {
  // The home page's toggled usage block holds one short line that never becomes
  // a scroll container at a real viewport width. It carries no name and no
  // focus stop on purpose, and promoting it would add an empty-ish landmark and
  // a permanent tab stop on content nothing can interact with.
  const tags = preTags(await renderToString(Home()));
  const unnamed = tags.filter((t) => !nameOf(t));
  assert.ok(unnamed.length > 0, 'the home page still renders an unnamed code block');
  for (const tag of unnamed) {
    assert.doesNotMatch(tag, /\brole="region"/, 'an unnamed block claims a landmark role it has no name for');
    assert.doesNotMatch(tag, /\btabindex=/, 'an unnamed, non-scrolling block takes a tab stop for nothing');
  }
});
