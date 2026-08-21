/**
 * The docs share the marketing site's chrome (#1098).
 *
 * The docs used to live on docs.webjs.dev with their own root layout, nav,
 * footer, and design tokens. Moving them to webjs.dev/docs is only half the
 * point; the other half is that they now render inside the SAME shell every
 * other page uses, so a reader crossing from /what-is-webjs into /docs does
 * not leave one design system and enter another.
 *
 * Nothing about that is self-enforcing. Someone can reintroduce a docs-only
 * header, a second theme toggle, or a duplicate `@theme` block and the pages
 * will still render fine, just as two subtly different sites again. These
 * assertions are what make that regression fail instead of ship.
 *
 * Asserted against the REAL request pipeline rather than the layout function
 * in isolation, because "the docs page ends up wrapped in the root layout" is
 * exactly the property under test, and calling DocsLayout directly would
 * assume it.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@webjsdev/server';

const WEBSITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A doc page and a marketing page, to compare their chrome against each other. */
const DOC_PATH = '/docs/routing';
const MARKETING_PATH = '/what-is-webjs';

let handle: (path: string) => Promise<Response>;

before(async () => {
  const app = await createRequestHandler({ appDir: WEBSITE_ROOT, dev: false });
  await app.warmup?.();
  handle = async (path) => app.handle(new Request('http://localhost' + path));
});

const bodyOf = async (path: string) => {
  const res = await handle(path);
  assert.equal(res.status, 200, `${path} should render`);
  return res.text();
};

/**
 * The shared header markup, sliced out by the wrapper the root layout emits.
 *
 * Note what this does and does not prove. Byte equality across two pages
 * shows the header carries no page-dependent state, which is worth pinning,
 * but it cannot catch a docs-only header: `headerOf` returns the FIRST match,
 * which is always the root layout's, and a second header would render after
 * it. The count assertion further down is what covers that case.
 */
function headerOf(html: string): string {
  const start = html.indexOf('<div class="site-top');
  assert.ok(start >= 0, 'the shared fixed header wrapper is present');
  const end = html.indexOf('</header>', start);
  assert.ok(end > start, 'the header closes');
  return html.slice(start, end);
}

function footerOf(html: string): string {
  const start = html.indexOf('<footer');
  assert.ok(start >= 0, 'a footer is present');
  return html.slice(start, html.indexOf('</footer>', start));
}

test('a docs page renders the SAME header as a marketing page', async () => {
  const [doc, marketing] = await Promise.all([bodyOf(DOC_PATH), bodyOf(MARKETING_PATH)]);
  assert.equal(headerOf(doc), headerOf(marketing), 'the header markup must be identical, not merely similar');
});

test('the shared skip-link resolves on a docs page', async () => {
  // The root layout emits "Skip to content" pointing at #main, and every
  // marketing page supplies that id. A docs page that omits it leaves the
  // shared chrome's one keyboard affordance pointing at nothing, which is
  // invisible unless you tab into it.
  const doc = await bodyOf(DOC_PATH);
  assert.ok(doc.includes('href="#main"'), 'the skip link is present, from the shared layout');
  assert.ok(doc.includes('id="main"'), 'and the docs supply its target');
});

test('a docs page renders the SAME footer as a marketing page', async () => {
  const [doc, marketing] = await Promise.all([bodyOf(DOC_PATH), bodyOf(MARKETING_PATH)]);
  assert.equal(footerOf(doc), footerOf(marketing), 'the footer markup must be identical');
});

test('the shared header links back into the docs', async () => {
  // The docs are a first-class section of the site now, not an outbound link,
  // so the nav entry is a same-origin path with no new-tab treatment.
  const marketing = await bodyOf(MARKETING_PATH);
  const header = headerOf(marketing);
  assert.ok(header.includes('href="/docs/getting-started"'), 'the header nav points at the docs');
  assert.ok(
    !header.includes('docs.webjs.dev'),
    'the nav must not point at the old subdomain'
  );
});

test('the docs carry no second header of their own', async () => {
  const doc = await bodyOf(DOC_PATH);
  assert.equal(doc.split('<header').length - 1, 1, 'exactly one header on the page');
  assert.equal(
    doc.split('<theme-toggle').length - 1,
    1,
    'exactly one theme toggle, the shared one'
  );
});

test('the sidebar is the ONLY docs-specific chrome', async () => {
  const [doc, marketing] = await Promise.all([bodyOf(DOC_PATH), bodyOf(MARKETING_PATH)]);
  assert.ok(doc.includes('id="docs-sidebar"'), 'the docs render their page-tree sidebar');
  assert.ok(!marketing.includes('id="docs-sidebar"'), 'and a marketing page does not');
});

test('the docs use the marketing design tokens, with no duplicate theme block', () => {
  // A second @theme block is how the two sites drifted apart the first time,
  // so neither the docs layout nor the shared shell it renders may declare
  // one: they read the root layout's tokens. The shell moved to
  // lib/ui/docs-shell.ts when /ui started sharing it, so both files are guarded.
  const docsLayout = readFileSync(resolve(WEBSITE_ROOT, 'app/docs/layout.ts'), 'utf8');
  const shell = readFileSync(resolve(WEBSITE_ROOT, 'lib/ui/docs-shell.ts'), 'utf8');
  for (const [name, src] of [['app/docs/layout.ts', docsLayout], ['lib/ui/docs-shell.ts', shell]] as const) {
    assert.ok(!src.includes('@theme'), `${name} declares no design tokens`);
    assert.ok(
      !/--fg\s*:|--bg\s*:|--accent\s*:/.test(src),
      `${name} redefines none of the core color tokens either`
    );
  }
  // The shell should still READ them, which is what proves it is on the
  // shared scale.
  assert.ok(shell.includes('var(--accent)'), 'it consumes the shared tokens');
});

test('the docs prose restores list markers over the Tailwind preflight', () => {
  // Tailwind's preflight sets list-style: none on every ul/ol. The prose
  // rules used to re-add only the padding, so every docs list rendered as
  // indented plain text with NO bullets or numbers, and the indent then read
  // as an arbitrary layout inconsistency rather than a list. Deleting the
  // restatement brings that straight back, and nothing else would catch it:
  // the page renders fine, just wrong.
  const shell = readFileSync(resolve(WEBSITE_ROOT, 'lib/ui/docs-shell.ts'), 'utf8');
  assert.match(shell, /\.prose-docs ul \{[^}]*list-style: disc/, 'ul markers restored');
  assert.match(shell, /\.prose-docs ol \{[^}]*list-style: decimal/, 'ol markers restored');
});

test('docs pages describe the docs, not the marketing pitch', async () => {
  // Dropping the docs' own root layout took its title and description with
  // it, so without a docs-scoped generateMetadata every page here would ship
  // the landing page's blurb as its search snippet and social card, with only
  // the <title> differing. Pages set their own title; nothing else.
  const [doc, marketing] = await Promise.all([bodyOf(DOC_PATH), bodyOf(MARKETING_PATH)]);
  const descOf = (html: string) => /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '';
  const ogTitleOf = (html: string) => /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1] ?? '';

  assert.notEqual(descOf(doc), descOf(marketing), 'the docs carry their own description');
  assert.match(descOf(doc), /documentation/i, 'and it says what the section is');
  assert.match(ogTitleOf(doc), /documentation/i, 'the social card too');
  assert.match(doc, /<title>Routing \| WebJs<\/title>/, 'while the page still owns its title');
});

test('docs pages keep the full social card, not just the fields they override', async () => {
  // Metadata merges as a shallow spread per layer, so a sub-layout that names
  // `openGraph` REPLACES the root's object rather than merging into it. The
  // first version of the docs metadata did exactly that and silently dropped
  // og:image, its dimensions, og:url, and the large-image Twitter card,
  // leaving every doc URL to share as a bare text card. Assert the fields at
  // RISK, not only the ones the sub-layout means to set.
  const doc = await bodyOf(DOC_PATH);
  for (const tag of [
    '<meta property="og:image" content="http://localhost/public/og.png">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:image" content="http://localhost/public/og.png">',
  ]) {
    assert.ok(doc.includes(tag), `docs page is missing ${tag}`);
  }
  assert.match(doc, /<meta property="og:url" content="http:\/\/localhost\/docs\/routing">/, 'og:url is the page, not the origin');
});

test('/docs redirects to the introduction rather than serving a second landing page', async () => {
  const res = await handle('/docs');
  assert.equal(res.status, 308);
  assert.equal(res.headers.get('location'), '/docs/getting-started');
});
