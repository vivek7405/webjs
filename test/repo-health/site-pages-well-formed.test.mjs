/**
 * Container-tag balance guard for every source file webjs.dev serves markup
 * from. Catches the failure class where an unclosed container tag (most
 * commonly `<pre>`) corrupts the parsed DOM by nesting siblings, and trailing
 * layout markers, inside the unclosed tag. The client router then sees its
 * `<!--/wj:children-->` reference comment living inside a `<pre>` and throws
 * `NotFoundError` from `insertBefore` on the next navigation.
 *
 * Pre-existing bug this regression test was written against: an unclosed
 * `<pre>` in website/app/docs/components/page.ts pulled the children marker
 * into a code-example `<pre>`, breaking every subsequent client-router
 * nav after visiting /docs/components.
 *
 * The corpus is the whole site minus a short exclusion list, not an
 * enumerated list of directories. That is the property the original
 * docs-only glob lacked: it was written once and never revisited while the
 * marketing pages grew eleven hand-authored `<pre>` blocks beside it, none
 * of them ever read by this guard. A broad glob covers a page, a component,
 * or a whole directory added tomorrow by default.
 *
 * The check is intentionally text-only (count opens vs closes for the
 * container tags whose HTML parsing is most sensitive to unbalance).
 * Running this on the source template rather than a render is the right
 * unit of work: the three in-repo apps have different dependency trees, and
 * a source-text check is what caught the original bug.
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
 * commonly authored by hand.
 *
 * `code-block` carries under /docs what `pre` carries on the marketing
 * pages: a docs sample is a `<code-block>` (the component renders the
 * `<pre>`), while a marketing page writes its own `<pre>` around
 * `highlight(SAMPLE)`. Both shapes are in this corpus and both are counted.
 *
 * The rule for extending this list. Safe to count are elements whose start
 * AND end tags are both REQUIRED and which are not void: `div`, `pre`,
 * `ul`, `ol`, `table`, and any custom element, which is why `code-block`
 * belongs. Never safe are void elements (`br`, `img`, `input`, `hr`,
 * `meta`, `link`), which have no end tag at all so `close` is structurally
 * zero. Never safe are the elements HTML5 gives an OPTIONAL end tag (`p`,
 * `li`, `tr`, `td`, `th`, `thead`, `tbody`, `tfoot`, `option`, `dt`, `dd`),
 * since an author may legitimately omit the close and the parser recovers,
 * so counting them flags correct markup. Beyond that the added coverage is
 * near zero, because a `<div>` already brackets essentially every region of
 * these pages, so an unclosed `<section>` inside one is caught by the
 * enclosing `<div>` count on the same file. The counter is textual, so
 * every tag added also widens the surface where a tag NAME written inside
 * an HTML comment counts as an open.
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
 * Report every container whose open and close counts disagree in `body`.
 * Exported so the fixtures below can assert a failure with no corpus.
 *
 * @returns {string[]} one entry per unbalanced container, empty when clean.
 */
export function unbalancedContainers(body) {
  /** @type {string[]} */
  const bad = [];
  for (const tag of CONTAINERS) {
    const { open, close } = tagCounts(body, tag);
    if (open !== close) bad.push(`<${tag}> open=${open} close=${close}`);
  }
  return bad;
}

/** Skip a `'...'` / `"..."` string. Returns the index just past the closer. */
function skipString(src, i) {
  const quote = src[i];
  i++;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === quote) return i + 1;
    i++;
  }
  return i;
}

/**
 * Scan template TEXT, starting just after an opening backtick. Keeps every
 * text character, recurses on `${`, and stops at its own closing backtick.
 *
 * @returns {{ text: string, end: number }}  `end` indexes the closing backtick.
 */
export function scanTemplate(src, i) {
  let text = '';
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') { text += src.slice(i, i + 2); i += 2; continue; }
    if (ch === '`') return { text, end: i };
    if (ch === '$' && src[i + 1] === '{') {
      const hole = scanExpression(src, i + 2);
      text += hole.text;
      i = hole.end + 1;
      continue;
    }
    text += ch;
    i++;
  }
  return { text, end: i };
}

/**
 * Scan a `${...}` HOLE, starting just after the `{`, at brace depth 1.
 * Skips strings and comments so their braces cannot move the depth, and
 * recurses into a nested backtick template, KEEPING that nested body (a
 * nested html`...` is real markup that reaches the response). The hole's
 * own JS is discarded: a `<div` inside a JS string renders as escaped
 * text, never as an element, so counting it was always wrong.
 *
 * A flat `${` / `}` counter over the whole file is what this replaces. It
 * desynchronized on any `{` that is not part of `${`: a block-bodied arrow
 * (`@click=${(e) => { ... }}`) or a bare object literal closes with a `}`
 * that decremented the depth without a matching increment, after which the
 * scan mistook an earlier backtick for the literal's end and silently
 * dropped the rest. Naive brace counting (treat every `{` as depth) fixes
 * that case and breaks the mirror one, since a literal `{` in template TEXT
 * (a CSS rule inside a `<style>`) desynchronizes it the other way and can
 * over-run past the literal's real end. Both are pinned by fixtures below.
 *
 * @returns {{ text: string, end: number }}  `end` indexes the closing `}`.
 */
function scanExpression(src, i) {
  let depth = 1;
  let text = '';
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === "'" || ch === '"') { i = skipString(src, i); continue; }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '`') {
      const nested = scanTemplate(src, i + 1);
      text += nested.text + '\n';
      i = nested.end + 1;
      continue;
    }
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') { depth--; if (depth === 0) return { text, end: i }; i++; continue; }
    i++;
  }
  return { text, end: i };
}

/**
 * Extract every `` html`...` `` template body from a module SOURCE and
 * return them concatenated. Conservative: anything outside `` html`` ``
 * (helper-fn fragments, doc strings) is ignored, since only the rendered
 * template lands in the response HTML. Exported so the fixtures below can
 * drive it without touching disk.
 */
export function extractHtmlTemplatesFrom(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const start = src.indexOf('html`', i);
    if (start < 0) break;
    // `html` must be a standalone tag. Reject the tail of an identifier
    // (`myHtml`), a member expression (`x.html`), and an occurrence inside
    // a string: lib/docs-llms.server.ts holds the literal 'html`' while
    // parsing page source, and reading that as a template start made the
    // whole rest of that file count as markup (<pre> 2/0).
    //
    // Known limitation, accepted deliberately. A string holding `html\`` after
    // a space (`'see html\`x\`'`) still reads as a template start. The
    // alternative, a stateful top-level scanner that skips strings, comments,
    // and regex literals, fails the other way: a regex holding an unbalanced
    // quote (`/[^']/`) flips it into string mode and it silently SWALLOWS a
    // later template, so the guard passes on nothing. For a guard, failing
    // loud beats failing silent.
    if (start > 0 && /[A-Za-z0-9_$.'"`]/.test(src[start - 1])) { i = start + 5; continue; }
    const tpl = scanTemplate(src, start + 'html`'.length);
    out.push(tpl.text);
    i = tpl.end + 1;
  }
  return out.join('\n');
}

async function extractHtmlTemplates(filePath) {
  return extractHtmlTemplatesFrom(await readFile(filePath, 'utf8'));
}

/**
 * Every in-repo app under this guard, one row each, mirroring APPS in
 * site-seo-tags.test.mjs so bringing another app under it later is a row
 * rather than a refactor.
 *
 * Metadata routes and route.{js,ts} handlers need no exclusion. They emit
 * XML, text, or JSON and hold no html template, so the extractor returns an
 * empty body and they are skipped.
 *
 * Floors sit a little under today's counts (116 files, 76 with a template)
 * so ordinary churn does not red the guard while a glob that collapses back
 * to the docs corpus (44) or to nothing does.
 */
const APPS = [
  {
    name: 'website (webjs.dev, incl. /docs and /ui)',
    pattern: 'website/**/*.{js,ts}',
    exclude: [
      /^website\/node_modules\//,      // dependency source, not ours to fix
      /^website\/test\//,              // fixtures may hold broken markup on purpose
      /^website\/scripts\//,           // build tooling, no served markup
      /^website\/modules\/ui\/components\//,   // gitignored @webjsdev/ui mirror (.gitignore L7).
                                              // components/ ONLY: modules/ui/queries and
                                              // modules/ui/utils are tracked and stay in.
      /^website\/lib\/utils\/(cn|dom)\.ts$/,  // same script's other outputs (.gitignore L8-9)
      /^website\/components\/ui\//,           // gitignored `webjs ui add` target (.gitignore L16)
      /^website\/\.webjs\//,           // generated route types / vendor state
    ],
    minFiles: 100,
    minWithBody: 65,
  },
];

async function listSources(app) {
  const entries = [];
  for await (const p of glob(app.pattern, { cwd: ROOT })) {
    if (app.exclude.some((re) => re.test(p))) continue;
    entries.push(resolve(ROOT, p));
  }
  return entries;
}

describe('site pages produce balanced container tags (router-safe HTML)', () => {
  for (const app of APPS) {
    // Named from CONTAINERS rather than spelled out, so the name cannot go on
    // advertising a list the check no longer uses. It said <pre> and omitted
    // code-block for exactly as long as the guard was inert.
    test(`${app.name}: every source file has matching open/close counts for ${CONTAINERS.map((t) => `<${t}>`).join(', ')}`, async () => {
      const files = await listSources(app);
      // A floor, not just "more than zero". When the docs moved to
      // website/app/docs this glob kept pointing at the old app and matched a
      // single redirect stub with no template in it, so every check below ran
      // on an empty string and passed. `> 0` did not catch that; a realistic
      // count does.
      assert.ok(
        files.length >= app.minFiles,
        `expected the full ${app.name} corpus, found ${files.length}: glob or exclusions wrong?`,
      );

      /** @type {string[]} */
      const failures = [];
      let withBody = 0;
      for (const file of files) {
        const body = await extractHtmlTemplates(file);
        if (!body) continue;   // metadata routes, route handlers, pure logic
        withBody++;
        for (const entry of unbalancedContainers(body)) {
          failures.push(`${file.replace(ROOT + '/', '')}: ${entry}`);
        }
      }
      // The file floor above only proves they were FOUND. This proves they
      // were READ: without it a regression in the extractor hands back empty
      // strings and every check passes on nothing, the same vacuous shape one
      // layer down.
      assert.ok(
        withBody >= app.minWithBody,
        `only ${withBody} of ${files.length} files yielded a template: extraction broken?`,
      );
      assert.deepEqual(
        failures,
        [],
        'Unbalanced container tags will corrupt SSR HTML and break the ' +
        'client router on subsequent navigation. The HTML parser will nest ' +
        'the rest of the page (including layout markers like ' +
        '<!--/wj:children-->) inside the unclosed tag, after which ' +
        'router-client.js reconcileSiblings throws NotFoundError from ' +
        'insertBefore. Close the offending tag in the page source. A docs ' +
        'sample is a <code-block> and a marketing sample is a hand-written ' +
        '<pre> around highlight(SAMPLE), so those two are the usual ' +
        'offenders.\n' +
        failures.join('\n')
      );
    });
  }
});

describe('the template extractor', () => {
  // Both truncation fixtures put the desynchronizing hole inside a NESTED
  // template, which is the shape components/doc-search.ts holds (L94-101) and
  // the shape that actually reproduces. A block-bodied arrow at the outer
  // level leaves the flat counter one short but with no later backtick to
  // stop at, so it survives by luck; a nested template supplies exactly that
  // backtick, and the old scan ends there with the outer </div> dropped.
  test('a hole holding a block-bodied arrow does not truncate the literal', () => {
    const src = [
      'const t = html`',
      '  <div>',
      '    ${rows.map((r) => html`',
      '      <a @click=${(e) => { e.preventDefault(); go(); }}>x</a>',
      '    `)}',
      '  </div>',
      '`;',
    ].join('\n');
    const body = extractHtmlTemplatesFrom(src);
    assert.match(body, /<\/div>/, 'the scan reached the real closing backtick');
    assert.deepEqual(unbalancedContainers(body), []);
  });

  test('a hole holding a bare object literal does not truncate the literal', () => {
    const src = [
      'const t = html`',
      '  <div>',
      '    ${rows.map((r) => html`',
      '      <ul class=${cls({ variant: "outline" })}><li>x</li></ul>',
      '    `)}',
      '  </div>',
      '`;',
    ].join('\n');
    const body = extractHtmlTemplatesFrom(src);
    assert.match(body, /<\/div>/, 'the scan reached the real closing backtick');
    assert.deepEqual(unbalancedContainers(body), []);
  });

  test('a nested html template inside a hole is kept as markup', () => {
    const src = 'const t = html`<div>${cond ? html`<ul></ul>` : ""}</div>`;';
    const body = extractHtmlTemplatesFrom(src);
    assert.match(body, /<ul><\/ul>/, 'the nested template body reaches the response');
    assert.deepEqual(unbalancedContainers(body), []);
  });

  test('markup-looking text inside a hole string is not counted', () => {
    // It renders as escaped text, never as an element, so counting the
    // unclosed <div> here would be a false positive.
    const body = extractHtmlTemplatesFrom('const t = html`<div>${label || "<div>"}</div>`;');
    assert.deepEqual(unbalancedContainers(body), []);
  });

  test("the literal string 'html`' is not read as a template start", () => {
    const src = "const marker = 'html`';\nconst re = /<pre[^>]*>/g;\n";
    assert.equal(extractHtmlTemplatesFrom(src), '');
  });

  test('a bare { in template text does not over-run the closing backtick', () => {
    const src = 'const t = html`<style>.x { color: red }</style><div></div>`;\nconst after = "<div>";\n';
    const body = extractHtmlTemplatesFrom(src);
    assert.ok(!body.includes('const after'), 'the scan stopped at the real closing backtick');
    assert.deepEqual(unbalancedContainers(body), []);
  });

  test('an unclosed container is reported', () => {
    const body = extractHtmlTemplatesFrom('const t = html`<div><span>x</span>`;');
    assert.deepEqual(unbalancedContainers(body), ['<div> open=1 close=0']);
  });
});
