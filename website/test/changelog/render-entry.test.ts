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
 * that dumps a squashed commit body as indented `*` bullets), so asserting
 * across every file is what stops one shape being fixed at the other's cost.
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
 * Top-level items carry the entry class; a nested sub-list's items are bare
 * `<li>`, so the class is what separates the two levels.
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

test('a nested sub-list renders as a nested list inside its entry', () => {
  const md = bodyOf(`${CHANGELOG_DIR}server/0.8.57.md`);
  const html = renderEntryBody(md);

  const nested = html.match(/<ul class="list-disc pl-5 space-y-1[^"]*">[\s\S]*?<\/ul>/g) || [];
  assert.equal(nested.length, 1, 'the four indented bullets form one nested list');
  assert.equal((nested[0].match(/<li>/g) || []).length, 4);

  // It sits inside the entry it belongs to, not beside it.
  assert.ok(entryItems(html)[0].includes(nested[0]));
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
  // The nested points stayed nested rather than becoming entries of their own.
  assert.equal((html.match(/<li>a nested point<\/li>/g) || []).length, 1);
});

test('a single-line entry still renders as bare text in its item', () => {
  const html = renderEntryBody('- **fix a thing** ([#1](https://x/1))');
  assert.equal(countEntryItems(html), 1);
  assert.ok(!html.includes('<p class="my-2'), 'no paragraph wrapper for a body-less entry');
});

test('a generated entry keeps its commit-body content', () => {
  const md = bodyOf(`${CHANGELOG_DIR}server/0.8.56.md`);
  const html = renderEntryBody(md);

  assert.equal(countEntryItems(html), countMarkdownEntries(md));
  // The `  * ` commit-subject line becomes a nested bullet, not literal text
  // with a stray asterisk, and the wrapped prose under it survives.
  assert.match(html, /<li>feat: ship @webjsdev\/ui class-helper primitives/);
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
    for (const word of new Set(md.match(/[A-Za-z]{7,}/g) || [])) {
      assert.ok(rendered.includes(word), `${label}: "${word}" did not survive rendering`);
    }
  }
});
