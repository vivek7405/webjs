/**
 * The accessibility rules every code block on the marketing pages follows.
 *
 * Three rules, each checkable from the rendered markup alone:
 *
 *  1. A named block carries `role="region"`. A <pre> maps to ARIA role
 *     `generic`, and ARIA prohibits an author-supplied name on `generic`, so a
 *     bare <pre aria-label="..."> hands a spec-following screen reader a name
 *     it will not announce.
 *  2. No two blocks on a page share a name. A named region is a landmark, and
 *     duplicates collapse into an ambiguous pair in the landmark list.
 *  3. A block that can scroll carries `tabindex="0"`. `overflow-x-auto` makes
 *     it a scroll container at some viewport width, and a scroll container no
 *     keyboard can reach is unusable without a pointer.
 *
 * This lives in its own file, and loops over every page that renders code
 * blocks, because the rules belong to the site rather than to any one page.
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

const nameOf = (tag: string) => tag.match(/aria-label="([^"]*)"/)?.[1];
/** Read attributes by name, never by position: order is not a defect. */
const has = (tag: string, attr: RegExp) => attr.test(tag);

const PAGES = [
  { name: '/', render: () => Home() },
  { name: '/what-is-webjs', render: () => WhatIsWebJs() },
  { name: '/why-webjs', render: () => Why() },
];

for (const page of PAGES) {
  test(`every named code block on ${page.name} carries a role that permits the name`, async () => {
    const tags = preTags(await renderToString(page.render()));
    const named = tags.filter(nameOf);
    assert.ok(named.length > 0, 'the page renders at least one named code block, so this test has something to check');
    for (const tag of named) {
      assert.ok(has(tag, /\brole="region"/), `a named pre is missing role=region, so its name is one ARIA prohibits: ${nameOf(tag)}`);
    }
  });

  test(`no two code blocks on ${page.name} share a landmark name`, async () => {
    const named = preTags(await renderToString(page.render())).map(nameOf).filter(Boolean);
    assert.deepEqual([...new Set(named)], named, `duplicate landmark names on ${page.name}: ${named.join(', ')}`);
  });

  test(`every scrollable code block on ${page.name} can be reached by keyboard`, async () => {
    const scrollable = preTags(await renderToString(page.render())).filter((t) => has(t, /\boverflow-x-auto\b/));
    assert.ok(scrollable.length > 0, 'the page renders at least one scrollable code block');
    for (const tag of scrollable) {
      assert.ok(has(tag, /\btabindex="0"/), `a scrollable pre has no focus stop, so only a pointer can scroll it: ${nameOf(tag) ?? tag.slice(0, 80)}`);
    }
  });
}
