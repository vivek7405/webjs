/**
 * Regression guard for handwritten doc pages and any page authored as a
 * long literal `html\`...\`` template. Catches the failure class where an
 * unclosed container tag (most commonly `<pre>`) corrupts the parsed DOM
 * by nesting siblings, and trailing layout markers, inside the unclosed
 * tag. The client router then sees its `<!--/wj:children-->` reference
 * comment living inside a `<pre>` and throws `NotFoundError` from
 * `insertBefore` on the next navigation.
 *
 * Pre-existing bug this regression test was written against: an unclosed
 * `<pre>` in website/app/docs/components/page.ts pulled the children marker
 * into a code-example `<pre>`, breaking every subsequent client-router
 * nav after visiting /docs/components.
 *
 * The check is intentionally text-only (count opens vs closes for the
 * container tags whose HTML parsing is most sensitive to unbalance).
 * Running this on the rendered string output is the right unit of work:
 * it catches the exact pattern (HTML produced by the page module) that
 * the browser will parse and the router will walk.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

/**
 * Container tags whose unbalanced state in SSR HTML is known to nest
 * arbitrary downstream siblings inside them under permissive HTML
 * parsing. `<pre>` is the historical offender (long handwritten code
 * blocks); `<div>` matters because layout / page chrome relies on it;
 * `<ul>` / `<ol>` / `<table>` round out the structural containers most
 * commonly authored by hand in doc pages.
 *
 * `code-block` carries what `pre` used to: the website's docs pages author
 * their samples as `<code-block>` (the component renders the `<pre>`), so that
 * tag now holds every one of the long handwritten blocks this guard was
 * written against, and an unbalanced one reproduces the original bug exactly.
 * `pre` stays listed so a docs page that goes back to authoring one directly
 * is still counted; none does today, so that entry matches nothing. It is NOT
 * cover for the marketing pages, which do author `<pre>` and which this
 * guard's glob does not reach.
 */
const CONTAINERS = ['pre', 'code-block', 'div', 'ul', 'ol', 'table'];

/**
 * Count occurrences of `<tag` (open, attribute-tolerant) and `</tag>`
 * in `source`. Self-closing `<tag/>` is irrelevant here because the
 * containers we care about have no void variants in HTML5.
 *
 * Returns `{ open, close }`. Both should be equal for well-formed HTML.
 */
function tagCounts(source, tag) {
  const openRe = new RegExp(`<${tag}(?=[\\s>])`, 'g');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'g');
  return {
    open: (source.match(openRe) || []).length,
    close: (source.match(closeRe) || []).length,
  };
}

/**
 * Read a page module source and extract every top-level `` html`...` ``
 * template literal. Returns the concatenated body of those literals.
 * Conservative: anything outside `` html`` `` (e.g. helper-fn fragments,
 * doc strings) is ignored, since only the rendered template lands in
 * the response HTML.
 */
async function extractHtmlTemplates(filePath) {
  const src = await readFile(filePath, 'utf8');
  const out = [];
  let i = 0;
  while (i < src.length) {
    const start = src.indexOf('html`', i);
    if (start < 0) break;
    let j = start + 'html`'.length;
    let depth = 0;
    while (j < src.length) {
      const ch = src[j];
      if (ch === '\\') { j += 2; continue; }
      if (ch === '`' && depth === 0) break;
      if (ch === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
      if (ch === '}' && depth > 0) { depth--; j++; continue; }
      j++;
    }
    out.push(src.slice(start + 'html`'.length, j));
    i = j + 1;
  }
  return out.join('\n');
}

async function listDocsPages() {
  const entries = [];
  for await (const p of glob('website/app/docs/**/page.{js,ts}', { cwd: ROOT })) {
    entries.push(resolve(ROOT, p));
  }
  return entries;
}

describe('docs pages produce balanced container tags (router-safe HTML)', () => {
  // Named from CONTAINERS rather than spelled out, so the name cannot go on
  // advertising a list the check no longer uses. It said <pre> and omitted
  // code-block for exactly as long as the guard was inert.
  test(`every page.{js,ts} under website/app/docs has matching open/close counts for ${CONTAINERS.map((t) => `<${t}>`).join(', ')}`, async () => {
    const pages = await listDocsPages();
    // A floor, not just "more than zero". When the docs moved to
    // website/app/docs this glob kept pointing at the old app and matched a
    // single redirect stub with no template in it, so every check below ran
    // on an empty string and passed. `> 0` did not catch that; a realistic
    // count does.
    assert.ok(
      pages.length >= 40,
      `expected the full docs corpus, found ${pages.length}: glob pattern wrong?`,
    );

    /** @type {string[]} */
    const failures = [];
    let withBody = 0;
    for (const page of pages) {
      const body = await extractHtmlTemplates(page);
      if (!body) continue;
      withBody++;
      for (const tag of CONTAINERS) {
        const { open, close } = tagCounts(body, tag);
        if (open !== close) {
          failures.push(`${page.replace(ROOT + '/', '')}: <${tag}> open=${open} close=${close}`);
        }
      }
    }
    // The glob floor above only proves the pages were FOUND. This proves
    // they were READ: without it a regression in extractHtmlTemplates would
    // hand back empty strings and every check would pass on nothing, the
    // same vacuous shape one layer down. app/docs/page.ts is a redirect
    // with no template, so the floor is under the page count, not equal.
    assert.ok(
      withBody >= 40,
      `only ${withBody} of ${pages.length} pages yielded a template: extraction broken?`,
    );
    assert.deepEqual(
      failures,
      [],
      'Unbalanced container tags in doc pages will corrupt SSR HTML and ' +
      'break the client router on subsequent navigation. The HTML parser ' +
      'will nest the rest of the page (including layout markers like ' +
      '<!--/wj:children-->) inside the unclosed tag, after which ' +
      'router-client.js reconcileSiblings throws NotFoundError from ' +
      'insertBefore. Close the offending tag in the page source. A code ' +
      'sample is a <code-block>, so that is the usual offender.\n' +
      failures.join('\n')
    );
  });
});
