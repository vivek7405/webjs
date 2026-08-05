/**
 * Unit tests for the changelog body renderer (modules/changelog/utils/render-entry.ts).
 *
 * renderEntryBody() turns one changelog file's markdown into the HTML the
 * /changelog cards embed. The contract these pin is structural: a changelog
 * entry is one bullet, and everything indented under it is that bullet's
 * body. The renderer used to close the item on a blank line, so a
 * multi-paragraph entry came out as a stack of sibling bullets with no way
 * to tell which prose belonged to which change.
 *
 * The whole corpus is the fixture. changelog/ carries both shapes the repo
 * produces (hand-written multi-paragraph release notes, and generator output
 * that dumps a squashed commit body as indented `*` lines), so asserting
 * across every file is what stops one shape being fixed at the other's cost.
 * No entry body renders a second level of bullets: the page is one bullet
 * per released change, and everything under it is prose.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderEntryBody } from '#modules/changelog/utils/render-entry.ts';

const CHANGELOG_DIR = fileURLToPath(new URL('../../../changelog/', import.meta.url));

/** Strip frontmatter the same way the /changelog query does, and trim. */
function bodyOf(path: string): string {
  const raw = readFileSync(path, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  return (m ? raw.slice(m[0].length) : raw).trim();
}

/** Every `changelog/<pkg>/<version>.md` on disk, as [label, body] pairs. */
function everyEntryFile(): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const pkg of readdirSync(CHANGELOG_DIR, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    for (const f of readdirSync(CHANGELOG_DIR + pkg.name)) {
      if (!f.endsWith('.md')) continue;
      pairs.push([`${pkg.name}/${f}`, bodyOf(`${CHANGELOG_DIR}${pkg.name}/${f}`)]);
    }
  }
  return pairs;
}

/**
 * Entry items carry the entry class. Nothing else in an entry body is an
 * `<li>` at all, which is the property the corpus guard below pins.
 */
const entryItems = (html: string) => html.split('<li class="text-fg-muted').slice(1);
const countEntryItems = (html: string) => entryItems(html).length;
/** Column-0 `- ` lines: the markdown's own count of entries. */
const countMarkdownEntries = (md: string) =>
  md.split('\n').filter((l) => /^- /.test(l)).length;

test('a multi-paragraph entry is ONE list item whose body is paragraphs', () => {
  const md = bodyOf(`${CHANGELOG_DIR}server/0.8.57.md`);
  const html = renderEntryBody(md);

  // The file has 3 entries. Before the fix this rendered 23 peer bullets,
  // because each blank line closed the item and the next indented paragraph
  // opened a fresh one.
  assert.equal(countMarkdownEntries(md), 3);
  assert.equal(countEntryItems(html), 3);

  // The continuation prose belongs to the item, as paragraphs.
  assert.match(html, /<li class="text-fg-muted[^"]*"><p class="my-2/);
  assert.ok(
    entryItems(html)[0].includes('Embedding note'),
    'the bolded closing note is body text of the entry it explains, not a sibling bullet',
  );
});

test('an indented sub-list renders as paragraphs, not a second level of bullets', () => {
  // The changelog is one bullet per released change. A second level of glyphs
  // under half the entries is noise, so an indented bullet keeps its grouping
  // and loses its marker.
  const md = bodyOf(`${CHANGELOG_DIR}server/0.8.57.md`);
  const html = renderEntryBody(md);

  assert.equal(html.match(/<ul/g)?.length, 1, 'only the entry list itself');
  const first = entryItems(html)[0];
  // The four attack vectors are four paragraphs of the entry they explain.
  for (const vector of ['A request target beginning with', 'was honored for any scheme', 'threw', 'supplied the origin outright']) {
    assert.ok(first.includes(vector), `kept: ${vector}`);
  }
  assert.ok(!/<li>/.test(first.slice(0, first.indexOf('</li>') + 5)), 'no bullet inside the entry');
});

test('a top-level entry after an indented block is not absorbed into it', () => {
  const html = renderEntryBody([
    '- **first**',
    '',
    '  Body prose for the first entry.',
    '',
    '  - a nested point',
    '  - another nested point',
    '',
    '- **second**',
    '',
    '  Body prose for the second entry.',
  ].join('\n'));

  assert.equal(countEntryItems(html), 2);
  assert.match(html, /<strong[^>]*>first<\/strong>/);
  assert.match(html, /<strong[^>]*>second<\/strong>/);
  // The indented points stayed inside the first entry, as its body prose,
  // rather than becoming entries of their own.
  assert.ok(entryItems(html)[0].includes('a nested point'));
  assert.ok(entryItems(html)[0].includes('another nested point'));
});

test('a single-line entry still renders as bare text in its item', () => {
  const html = renderEntryBody('- **fix a thing** ([#1](https://x/1))');
  assert.equal(countEntryItems(html), 1);
  assert.ok(!html.includes('<p class="my-2'), 'no paragraph wrapper for a body-less entry');
});

test('blank-separated indented bullets become paragraphs of ONE entry', () => {
  // The dominant generated shape: the generator writes each squashed commit
  // subject as its own `  * ` line separated by a whitespace-only line. Each
  // becomes a paragraph, and the entry stays a single bullet.
  const md = bodyOf(`${CHANGELOG_DIR}cli/0.10.11.md`);
  const html = renderEntryBody(md);

  const first = entryItems(html)[0];
  assert.ok(first.includes('feat: enforce scaffold-content removal'));
  assert.ok(first.includes('docs: document the no-scaffold-placeholder'));
  assert.equal(html.match(/<ul/g)?.length, 2, 'one entry list per section heading, and nothing nested');
});

test('no changelog file renders a nested list', () => {
  // Whole-corpus form of the two tests above, and the property the page is
  // meant to have: the only lists are the per-section entry lists, so an
  // entry body is always prose.
  for (const [label, md] of everyEntryFile()) {
    const html = renderEntryBody(md);
    const sections = (md.match(/^## /gm) || []).length || 1;
    const lists = (html.match(/<ul/g) || []).length;
    assert.ok(lists <= sections, `${label}: ${lists} lists for ${sections} sections, so an entry body rendered one`);
    for (const item of entryItems(html)) {
      const body = item.slice(0, item.indexOf('</li>') + 5);
      assert.ok(!body.includes('<li>'), `${label}: an entry body rendered a bullet`);
    }
  }
});

test('a generated entry keeps its commit-body content', () => {
  const md = bodyOf(`${CHANGELOG_DIR}server/0.8.56.md`);
  const html = renderEntryBody(md);

  assert.equal(countEntryItems(html), countMarkdownEntries(md));
  // The `  * ` commit-subject line becomes body prose with its marker
  // dropped, not literal text carrying a stray asterisk, and the wrapped
  // prose under it survives.
  assert.match(html, /<p class="my-2[^"]*">feat: ship @webjsdev\/ui class-helper primitives/);
  assert.ok(!html.includes('* feat: ship'), 'the marker is not left in the text');
  assert.match(html, /Add components\/ui\//);
});

test('every changelog file renders exactly one list item per entry', () => {
  const files = everyEntryFile();
  assert.ok(files.length > 100, `read the changelog corpus, got ${files.length} files`);

  for (const [label, md] of files) {
    const expected = countMarkdownEntries(md);
    const actual = countEntryItems(renderEntryBody(md));
    assert.equal(actual, expected, `${label}: ${expected} entries rendered as ${actual} items`);
  }
});

test('no entry body text is dropped on the way to HTML', () => {
  // A structural fix must not silently swallow lines, and a whole-corpus item
  // count would not notice if it did. Word containment survives every inline
  // transform the renderer applies (bold, italic, code and link text all keep
  // their inner words), so a missing word means a missing line.
  for (const [label, md] of everyEntryFile()) {
    const rendered = renderEntryBody(md);
    // Search the VISIBLE text plus the link targets, never the raw markup.
    // The emitted class names carry words of their own (`leading-relaxed`,
    // `font-semibold`, `noopener`), so matching against the markup would
    // exempt any source word colliding with one. No corpus word collides
    // today, so this is about what the assertion PROVES rather than about a
    // failure it currently catches.
    const hrefs = [...rendered.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).join(' ');
    const visible = `${rendered.replace(/<[^>]+>/g, ' ')} ${hrefs}`;
    for (const word of new Set(md.match(/[A-Za-z]{7,}/g) || [])) {
      assert.ok(visible.includes(word), `${label}: "${word}" did not survive rendering`);
    }
  }
});
