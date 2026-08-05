/**
 * The accessibility rules every code block on the site follows.
 *
 * Three rules, each checkable from the rendered markup alone:
 *
 *  1. A named block carries `role="region"`. A <pre> maps to ARIA role
 *     `generic`, and ARIA prohibits an author-supplied name on `generic`, so a
 *     bare <pre aria-label="..."> hands a spec-following screen reader a name
 *     it will not announce.
 *  2. No two blocks on a page share a name. A named region is a landmark, and
 *     duplicates collapse into an ambiguous pair in the landmark list.
 *  3. A block that can scroll carries `tabindex="0"`. It is a scroll container
 *     at some viewport width, and a scroll container no keyboard can reach is
 *     unusable without a pointer.
 *
 * This lives in its own file, and loops over pages, because the rules belong
 * to the site rather than to any one page. Coverage is not a hand-kept list:
 * the documentation and gallery pages are discovered from the file system, and
 * every gallery detail page comes from the registry index the sidebar is built
 * from, so a page or a component added tomorrow is checked without anyone
 * remembering to add it here. Six entries ARE listed by hand, because they have
 * no directory to walk: the three marketing pages, the error boundary, the
 * gallery introduction at /ui, and the markdown post body that /blog/[slug],
 * /articles/[slug], and /compare/[slug] all share.
 *
 * Pages are rendered THROUGH their layout, not alone. That is what makes rule
 * 3 real rather than vacuous: a docs block scrolls because of the shell's
 * `.prose-docs pre { overflow-x: auto }` rule, not because of a utility class
 * on the tag, so a detector that only reads the class would pass every docs
 * page while every block on it was still unreachable by keyboard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { renderToString } from '@webjsdev/core/server';
import type { LayoutProps } from '@webjsdev/core';
import Home from '#app/page.ts';
import WhatIsWebJs from '#app/what-is-webjs/page.ts';
import Why from '#app/why-webjs/page.ts';
import ErrorBoundary from '#app/error.ts';
import DocsLayout from '#app/docs/layout.ts';
import UiLayout from '#app/ui/layout.ts';
import { renderPostBody } from '#modules/blog/utils/render-post.ts';

/** Every `<pre …>` open tag in the rendered HTML, attribute order as authored. */
function preTags(html: string) {
  return html.match(/<pre\b[^>]*>/g) ?? [];
}

const nameOf = (tag: string) => tag.match(/aria-label="([^"]*)"/)?.[1];
/** Read attributes by name, never by position: order is not a defect. */
const has = (tag: string, attr: RegExp) => attr.test(tag);

/**
 * The blocks on a page that can scroll.
 *
 * Two ways a block becomes a scroll container, and both have to count. The
 * marketing pages put `overflow-x-auto` on the tag. The docs and gallery
 * shell instead sets it on every prose <pre> from its stylesheet, which no
 * tag-level attribute records, so that rule is read out of the rendered
 * document itself. Reading only the utility class is the single easiest way
 * to close this issue without fixing anything.
 */
function scrollableTags(html: string) {
  const shellScrollsEveryBlock = /\.prose-docs pre\s*\{[^}]*overflow-x:\s*auto/.test(html);
  const tags = preTags(html);
  return shellScrollsEveryBlock ? tags : tags.filter((t) => has(t, /\boverflow-x-auto\b/));
}

type Page = { name: string; render: () => unknown };

/**
 * The HTML a page entry produces. Most render a TemplateResult; the markdown
 * renderer builds its markup as a string, which `renderToString` would escape
 * into text rather than pass through.
 */
async function htmlOf(page: Page) {
  const out = await page.render();
  return typeof out === 'string' ? out : await renderToString(out);
}

/** Discover a section's pages instead of listing them by hand. */
async function sectionPages(dir: string, base: string, layout: (p: LayoutProps) => unknown, expectSome = true): Promise<Page[]> {
  const entries = await readdir(new URL(`../../app/${dir}`, import.meta.url), { withFileTypes: true });
  const pages: Page[] = [];
  for (const entry of entries.filter((e) => e.isDirectory() && !e.name.startsWith('['))) {
    // A segment can be a route handler rather than a page (app/ui/registry
    // serves the JSON API the CLI fetches), and those render no markup.
    const file = new URL(`../../app/${dir}/${entry.name}/page.ts`, import.meta.url);
    if (!existsSync(file)) continue;
    const mod = await import(`#app/${dir}/${entry.name}/page.ts`);
    pages.push({
      name: `${base}/${entry.name}`,
      render: async () => layout({ children: await mod.default({}) } as unknown as LayoutProps),
    });
  }
  // app/docs is all static topic pages, so finding none there means discovery
  // broke. app/ui legitimately has none: its content is the index page plus
  // the [name] route, and the only other segment is a route handler. Walking
  // it anyway is what covers a static gallery page added later.
  if (expectSome) assert.ok(pages.length > 0, `no pages discovered under app/${dir}, so this section is silently uncovered`);
  return pages;
}

const uiDetail = await import('#app/ui/[name]/page.ts');
const uiIntro = await import('#app/ui/page.ts');
const { loadRegistryIndex } = await import('#modules/ui/queries/registry.server.ts');

/**
 * Every gallery detail page, from the same registry index the sidebar is built
 * from. Sampling one component here would leave the other thirty-one unchecked
 * while the file claimed to cover the gallery.
 */
const uiComponents = (await loadRegistryIndex()).filter((i) => i.type === 'registry:ui').map((i) => i.name);

const PAGES: Page[] = [
  { name: '/', render: () => Home() },
  { name: '/what-is-webjs', render: () => WhatIsWebJs() },
  { name: '/why-webjs', render: () => Why() },
  {
    name: 'the error boundary',
    render: () => ErrorBoundary({ error: new Error('a single unbroken line of detail long enough to overflow a narrow viewport') }),
  },
  ...await sectionPages('docs', '/docs', DocsLayout),
  ...await sectionPages('ui', '/ui', UiLayout, false),
  { name: '/ui', render: async () => UiLayout({ children: await uiIntro.default() } as unknown as LayoutProps) },
  ...uiComponents.map((name) => ({
    name: `/ui/${name}`,
    render: async () => UiLayout({ children: await uiDetail.default({ params: { name } }) } as unknown as LayoutProps),
  })),
  // The markdown renderer is one body shared by /blog/[slug], /articles/[slug],
  // and /compare/[slug], so covering it covers all three route families. A
  // fenced block is what it emits a <pre> for.
  { name: 'the markdown post body', render: () => renderPostBody('Text.\n\n```ts\nconst answer: number = 42;\n```\n') },
];

for (const page of PAGES) {
  test(`every named code block on ${page.name} carries a role that permits the name`, async () => {
    const named = preTags(await htmlOf(page)).filter(nameOf);
    for (const tag of named) {
      assert.ok(has(tag, /\brole="region"/), `a named pre is missing role=region, so its name is one ARIA prohibits: ${nameOf(tag)}`);
    }
  });

  test(`no two code blocks on ${page.name} share a landmark name`, async () => {
    const named = preTags(await htmlOf(page)).map(nameOf).filter(Boolean);
    assert.deepEqual([...new Set(named)], named, `duplicate landmark names on ${page.name}: ${named.join(', ')}`);
  });

  test(`every code block marked scrollable on ${page.name} can be reached by keyboard`, async () => {
    for (const tag of scrollableTags(await htmlOf(page))) {
      assert.ok(has(tag, /\btabindex="0"/), `a scrollable pre has no focus stop, so only a pointer can scroll it: ${nameOf(tag) ?? tag.slice(0, 80)}`);
    }
  });
}

/*
 * The per-page checks are all "every block that ...", so a page with no code
 * block passes them by having nothing to check, and two docs pages genuinely
 * have none. These two guards are what stop that from becoming true site-wide
 * without anyone noticing.
 */
test('the suite still has scrollable blocks to check rule 3 against', async () => {
  const counts = await Promise.all(PAGES.map(async (p) => [p.name, scrollableTags(await htmlOf(p)).length] as const));
  const total = counts.reduce((n, [, c]) => n + c, 0);
  const pagesWithBlocks = counts.filter(([, c]) => c > 0).map(([n]) => n);
  assert.ok(total > 400, `only ${total} scrollable blocks found across the site, so rule 3 is checking far less than it should`);
  assert.ok(pagesWithBlocks.length > PAGES.length - 5, `${PAGES.length - pagesWithBlocks.length} pages render no scrollable block at all: ${counts.filter(([, c]) => !c).map(([n]) => n).join(', ')}`);
});

test('the suite still has named blocks to check rules 1 and 2 against', async () => {
  const named = (await Promise.all(PAGES.map(async (p) => preTags(await htmlOf(p)).filter(nameOf)))).flat();
  assert.ok(named.length > 0, 'no page renders a named code block, so rules 1 and 2 pass vacuously site-wide');
});

test('the docs shell is what makes a documentation block scroll, so the detector must read it', async () => {
  // Ties the scrollability detector to the real stylesheet rather than to a
  // claim made here. If the shell stops setting overflow on prose blocks this
  // fails, and the detector above is revisited rather than quietly widening.
  const html = await renderToString(DocsLayout({ children: '' } as unknown as LayoutProps));
  assert.match(html, /\.prose-docs pre\s*\{[^}]*overflow-x:\s*auto/);
  assert.equal(preTags(html).length, 0, 'the shell renders no code block of its own, so every block found on a docs page came from the page');
});
