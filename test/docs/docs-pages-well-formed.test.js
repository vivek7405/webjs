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
 */
const CONTAINERS = ['pre', 'div', 'ul', 'ol', 'table'];

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
  for await (const p of glob('docs/app/**/page.{js,ts}', { cwd: ROOT })) {
    entries.push(resolve(ROOT, p));
  }
  return entries;
}

describe('docs pages produce balanced container tags (router-safe HTML)', () => {
  test('every page.{js,ts} under docs/app has matching open/close counts for <pre>, <div>, <ul>, <ol>, <table>', async () => {
    const pages = await listDocsPages();
    assert.ok(pages.length > 0, 'no docs pages discovered: glob pattern wrong?');

    /** @type {string[]} */
    const failures = [];
    for (const page of pages) {
      const body = await extractHtmlTemplates(page);
      if (!body) continue;
      for (const tag of CONTAINERS) {
        const { open, close } = tagCounts(body, tag);
        if (open !== close) {
          failures.push(`${page.replace(ROOT + '/', '')}: <${tag}> open=${open} close=${close}`);
        }
      }
    }
    assert.deepEqual(
      failures,
      [],
      'Unbalanced container tags in doc pages will corrupt SSR HTML and ' +
      'break the client router on subsequent navigation. The HTML parser ' +
      'will nest the rest of the page (including layout markers like ' +
      '<!--/wj:children-->) inside the unclosed tag, after which ' +
      'router-client.js reconcileSiblings throws NotFoundError from ' +
      'insertBefore. Close the offending tag in the page source.\n' +
      failures.join('\n')
    );
  });
});
