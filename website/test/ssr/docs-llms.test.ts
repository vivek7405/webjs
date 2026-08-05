/**
 * The llms.txt corpus keeps the docs' code samples fenced.
 *
 * `lib/docs-llms.server.ts` builds `/llms.txt`, `/llms-full.txt`, and every
 * `/docs/<topic>/llms.txt` by parsing each page's SOURCE, so it has to know
 * which tag the samples are written in. When they moved from `<pre>` to
 * `<code-block>` and this was not updated, nothing failed: a sample does not
 * disappear, it falls through to the prose pipeline, which strips the fence,
 * eats every `${...}` hole in the code, and collapses the indentation. The
 * output stayed plausible and every sample in it stopped being usable, which
 * is exactly the failure a test has to catch instead of a reader.
 *
 * The docs search index is built from this same markdown
 * (`app/api/search/route.ts`), so it inherits whatever this produces. Note
 * that its heading extraction is a plain `line.startsWith('#')` with no fence
 * tracking, so a line-leading `# ` shell comment inside a sample scores as a
 * heading whether or not the fence is there. That is a separate pre-existing
 * problem, not one these tests cover.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getDocPage, getDocPages } from '#lib/docs-llms.server.ts';

const fenceCount = (md: string) => (md.match(/^```/gm) ?? []).length / 2;

test('every docs page that authors a code sample emits it fenced', async () => {
  const pages = await getDocPages();
  assert.ok(pages.length > 30, `expected the docs corpus, found ${pages.length} pages`);

  const missing: string[] = [];
  let checked = 0;
  for (const page of pages) {
    const src = await readFile(new URL(`../../app${page.path}/page.ts`, import.meta.url), 'utf8');
    const authored = (src.match(/<code-block(?=[\s>])/g) ?? []).length;
    if (!authored) continue;
    checked++;
    if (fenceCount(page.markdown) < 1) missing.push(`${page.path} (${authored} authored, 0 fenced)`);
  }
  assert.ok(checked > 30, `only ${checked} pages author a code sample, so this proves little`);
  assert.deepEqual(missing, [], `pages whose samples never reached the llms corpus: ${missing.join(', ')}`);
});

test('a fenced sample keeps the interpolation holes and indentation the prose pipeline would eat', async () => {
  const page = await getDocPage('routing');
  assert.ok(page, 'the routing page is in the corpus');
  const fences = page.markdown.split('```').filter((_, i) => i % 2 === 1);
  assert.ok(fences.length > 5, `expected several fenced samples, found ${fences.length}`);

  const layout = fences.find((f) => f.includes('export default function RootLayout'));
  assert.ok(layout, 'the root-layout sample is fenced');
  // Outside a fence these two are destroyed: ${children} is stripped as a
  // template hole, and the leading spaces are collapsed to one.
  assert.ok(layout.includes('${children}'), 'the interpolation hole survives inside the fence');
  assert.match(layout, /\n {2,}\S/, 'indentation survives inside the fence');
});

test('a sample that reaches the corpus reaches it whole', () => {
  // The loss this catches is per-character: an extractor step that quietly
  // deletes something. A `<code>` strip running AFTER entity decoding used to
  // delete the tags out of a sample TEACHING `&lt;code&gt;`, leaving the block
  // present and its lesson gone, which is the shape that survives review.
  //
  // Anchored on the sample's first line so it asks only "did this arrive
  // intact", not "did it arrive". Whether a block reaches the corpus at all is
  // a different question, answered by the fence test above, and one page
  // (/docs/metadata-routes) already fails it on main for an unrelated reason:
  // the template-isolation heuristic truncates the page.
  return Promise.all([]).then(async () => {
    const pages = await getDocPages();
    const mangled: string[] = [];
    let compared = 0;
    for (const page of pages) {
      const src = await readFile(new URL(`../../app${page.path}/page.ts`, import.meta.url), 'utf8');
      for (const m of src.matchAll(/<code-block(?=[\s>])[^>]*>([\s\S]*?)<\/code-block>/g)) {
        // A sample carrying a template hole has no source text to compare:
        // what it says is only known at render time.
        if (m[1].includes('${')) continue;
        const authored = decodeEntities(m[1]).replace(/\n+$/, '');
        const firstLine = authored.split('\n')[0];
        if (!firstLine.trim() || !page.markdown.includes(firstLine)) continue;
        compared++;
        if (!page.markdown.includes(authored)) {
          mangled.push(`${page.path}: ${JSON.stringify(authored.slice(0, 70))}`);
        }
      }
    }
    assert.ok(compared > 300, `only ${compared} samples compared, so this proves little`);
    assert.deepEqual(mangled.slice(0, 5), [], `${mangled.length} samples arrived in the corpus with characters missing`);
  });
});

/** Mirrors the extractor's own entity decoding, which is module-private. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#123;/g, '{')
    .replace(/&#125;/g, '}')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&hellip;/g, '...')
    .replace(/&mdash;/g, '--')
    .replace(/&nbsp;/g, ' ');
}
