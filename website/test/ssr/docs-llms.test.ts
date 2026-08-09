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
 * (`app/api/search/route.ts`), so it inherits whatever this produces. Its
 * heading extraction now tracks fences (`lib/utils/doc-headings.ts`), using
 * the same fence predicate this module's normalisation pass uses, so a
 * line-leading `# ` shell comment inside a sample is not scored as a
 * heading. That behaviour is covered by `test/lib/doc-headings.test.ts` and
 * `test/ssr/docs-search.test.ts`, not here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bodyToMarkdown, getDocPage, getDocPages, plainText } from '#lib/docs-llms.server.ts';

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

test('every sample a page authors reaches the corpus', async () => {
  // Stronger than the fence test above, which only asks for one fence per
  // page: this asks for ALL of them. A regression that drops or merges blocks
  // changes this count. There is no exemption: /docs/metadata-routes used to
  // carry one, pinned at 9 authored and 4 fenced, because a decoded `<` in its
  // prose let the generic tag strip eat 5 of its sentinels. The extractor now
  // decodes exactly once, at the end, so every page reaches parity and an
  // exemption would only hide the next such loss.
  const off: string[] = [];
  let checked = 0;
  for (const page of await getDocPages()) {
    const src = await readFile(new URL(`../../app${page.path}/page.ts`, import.meta.url), 'utf8');
    const authored = (src.match(/<code-block(?=[\s>])/g) ?? []).length;
    if (!authored) continue;
    checked++;
    const fenced = fenceCount(page.markdown);
    if (fenced !== authored) off.push(`${page.path}: ${authored} authored, ${fenced} fenced`);
  }
  assert.ok(checked > 30, `only ${checked} pages compared, so this proves little`);
  assert.deepEqual(off, [], `pages losing samples on the way to the corpus: ${off.join(', ')}`);
});

test('a sample that reaches the corpus reaches it whole', async () => {
  // A different failure from the one above: the block arrives, with characters
  // missing from inside it. A `<code>` strip running AFTER entity decoding used
  // to delete the tags out of a sample TEACHING `&lt;code&gt;`, leaving the
  // block present and its lesson gone, which is the shape that survives review.
  //
  // No sample in the repo triggers that today, so this cannot be proven by
  // reverting the source alone; it guards the content someone writes next.
  // It is scoped per PAGE rather than per sample because anchoring on a
  // sample's own text cannot work: a mangling breaks the text you would
  // anchor on, so the check skips itself exactly when it should fire. The
  // per-sample `includes` below is what establishes intactness; the count
  // gate only picks pages where every block is present to be compared.
  const mangled: string[] = [];
  let compared = 0;
  for (const page of await getDocPages()) {
    const src = await readFile(new URL(`../../app${page.path}/page.ts`, import.meta.url), 'utf8');
    const authored = [...src.matchAll(/<code-block(?=[\s>])[^>]*>([\s\S]*?)<\/code-block>/g)];
    if (!authored.length || fenceCount(page.markdown) !== authored.length) continue;
    for (const m of authored) {
      // A sample carrying a template hole has no source text to compare:
      // what it says is only known at render time.
      if (m[1].includes('${')) continue;
      compared++;
      const text = decodeEntities(unescapeJs(m[1])).replace(/\n+$/, '');
      if (!page.markdown.includes(text)) mangled.push(`${page.path}: ${JSON.stringify(text.slice(0, 70))}`);
    }
  }
  assert.ok(compared > 300, `only ${compared} samples compared, so this proves little`);
  assert.deepEqual(mangled.slice(0, 5), [], `${mangled.length} samples arrived in the corpus with characters missing`);
});

/**
 * Mirrors the extractor's own source-escape fold, which is module-private. A
 * sample is copied out of page SOURCE, where it is a JS template literal, so
 * the corpus carries it cooked and a comparison against the raw source has to
 * cook it the same way.
 */
function unescapeJs(s: string): string {
  return s.replace(/\\(.)/g, '$1');
}

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

/*
 * The extractor driven directly on fixtures.
 *
 * The corpus walks above are forward guards: they compare what the repo's real
 * pages produce, so they can only fail once someone writes the content that
 * trips a bug. These are the counterfactual half. They pin the exact losses
 * this file was written about against fixed inputs, so reverting the source
 * fix reds a test without any docs page having to carry a sample that exists
 * only for the test.
 */
test('a sample teaching escaped markup keeps it', () => {
  // The `<code>` strip used to run AFTER entity decoding, so it deleted the
  // decoded tags out of a sample whose whole point was showing them.
  const md = bodyToMarkdown('html`<code-block>use &lt;code&gt;x&lt;/code&gt; inline</code-block>`');
  assert.match(md, /```\nuse <code>x<\/code> inline\n```/);
});

test('a paragraph teaching a lone escaped angle bracket does not eat the rest of the page', () => {
  // The exact shape of /docs/metadata-routes: a lone `&lt;` in one paragraph,
  // a sample, then a later paragraph whose own escaped tag supplies the `>`
  // that closed the runaway match. A PAIRED `&lt;code&gt;` does not reproduce
  // it, because that decodes into a complete tag the strip removes locally.
  const md = bodyToMarkdown(
    'html`<p>a value with <code>&lt;</code> cannot break the document</p>' +
      '<code-block>const x = 1;</code-block>' +
      '<p>injects <code>&lt;title&gt;</code> tags</p>`'
  );
  assert.match(md, /a value with < cannot break the document/);
  assert.match(md, /```\nconst x = 1;\n```/);
  assert.match(md, /injects <title> tags/);
});

test('an escaped tag in prose survives to the corpus', () => {
  // oneLine used to decode &lt;code&gt; to a real <code> tag mid-pipeline and
  // the generic strip deleted it, so the sentence lost the very thing it was
  // written to show. This is the site-wide half of the same bug.
  const md = bodyToMarkdown('html`<p>a value with &lt;code&gt; here</p>`');
  assert.equal(md, 'a value with <code> here');
});

test('a hole whose value is a string literal keeps the value', () => {
  // /docs/architecture authors this shape. The outer hole interpolates a
  // string literal, so a reader of the rendered page sees the inner text, and
  // the corpus has to show the same thing. Dropping it printed
  // `<form action=>`, a form-binding sentence with the binding deleted, in
  // the one surface whose reader is an LLM.
  const md = bodyToMarkdown('html`<p>a <code>&lt;form action=${"${createPost}"}&gt;</code> posts</p>`');
  assert.equal(md, 'a <form action=${createPost}> posts');
});

test('an escaped hole is literal text, not an interpolation to drop', () => {
  // `\${x}` in the source is NOT a hole: the escape means the page renders the
  // literal `${x}`. Dropping it as if it were dynamic deleted the binding and
  // stranded the escape backslash, which is what put `@submit=\` and
  // `<form action=\>` in the corpus.
  const md = bodyToMarkdown('html`<p>handlers (<code>@submit=\\${e =&gt; { e.preventDefault(); }}</code>) are untouched</p>`');
  assert.equal(md, 'handlers ( @submit=${e => { e.preventDefault(); }} ) are untouched');
});

test('a genuinely dynamic hole is still dropped', () => {
  // The counterpart to the two above: a hole referencing a variable renders
  // something known only at render time, so there is nothing to put in the
  // corpus and it must still go.
  assert.equal(bodyToMarkdown('html`<p>text ${children} here</p>`'), 'text here');
});

test('a dynamic hole containing braces is dropped whole', () => {
  // A naive `[^}]*` stops at the FIRST `}`, so the nested object literal
  // leaves `)}` behind as debris. The kept-hole shapes above no longer reach
  // this strip, so without this fixture nothing pins it at all.
  //
  // ONE level of nesting is all the regex handles, which is what the docs
  // actually author: `${fn({a:{b:1}})}` still leaves `)}`, and no page writes
  // that (checked across all 44). Arbitrary depth is not a regex's job, so the
  // limit is stated rather than papered over.
  assert.equal(bodyToMarkdown('html`<p>text ${fn({a: 1})} here</p>`'), 'text here');
  assert.equal(bodyToMarkdown('html`<p>a ${fn({a:{b:1}})} b</p>`'), 'a )} b');
});

test('a kept hole is unescaped, since the source is a template literal', () => {
  // The hole text is copied out of page SOURCE, where a backtick has to be
  // written `\\``. Keeping it verbatim moved the escape debris from in front
  // of the hole to inside it: /docs/components rendered `.fallback=${html\`…\`}`
  // where the page shows `.fallback=${html`…`}`.
  const md = bodyToMarkdown('html`<p>x <code>.fallback=\\${html\\`hi\\`}</code> y</p>`');
  assert.equal(md, 'x .fallback=${html`hi`} y');

  // The string-literal pass copies from source too, so it needs the same fold.
  // No docs page carries an escape inside one today, so only a fixture can
  // hold that half of the rule.
  assert.equal(bodyToMarkdown('html`<p>x ${"a\\`b"} y</p>`'), 'x a`b y');
});

test('a fenced sample is unescaped, since the source is a template literal', () => {
  // The prose half of this rule is pinned above. The fenced half was left out,
  // so the corpus taught `<form action=\${createPost}>` on 5 lines while the
  // rendered docs page showed `<form action=${createPost}>`, disagreeing with
  // itself about the one shape invariant 12 governs.
  const md = bodyToMarkdown('html`<code-block>html\\`&lt;form action=\\${createPost}&gt;&lt;/form&gt;\\`</code-block>`');
  assert.equal(md, '```\nhtml`<form action=${createPost}></form>`\n```');
});

test('a fenced sample folds its escapes before it decodes its entities', () => {
  // Order matters on exactly one shape, and the browser settles it: JS cooks
  // the template literal first, so `&am\p;` reaches the HTML parser as
  // `&amp;`, which it decodes to `&`. Decoding first would ship `&amp;`.
  // No docs page carries this shape, so only a fixture can hold the rule.
  assert.equal(bodyToMarkdown('html`<code-block>a &am\\p; b</code-block>`'), '```\na & b\n```');
});

test('prose is unescaped too, since it comes out of the same template literal', () => {
  // A hole and a sample were folded before prose was, so the corpus still
  // taught ``returning html\`...\` `` on 50 lines across 8 pages where the
  // rendered page shows a plain backtick.
  assert.equal(bodyToMarkdown('html`<p>returning <code>html\\`...\\`</code></p>`'), 'returning html`...`');

  // The fold runs AFTER the hole passes, never before. Folding first would
  // turn `\${x}` into `${x}`, which the dynamic-hole pass then drops, losing
  // the literal text a reader actually sees.
  assert.equal(bodyToMarkdown('html`<p>a \\${x} b ${y} c</p>`'), 'a ${x} b c');
});

test('no docs page escapes a letter, which the extractor would fold away', async () => {
  // A page body is a JS template literal, so `\s` cooks to a bare `s`: the
  // LIVE page rendered `replace(/s+/g, '-')` on /docs/backend-only and
  // `/;s*/` on /docs/websockets until those two were corrected to `\\s`.
  // The extractor is faithful, so it copies that damage into the corpus as a
  // teaching sample, and the corpus's only reader is an LLM.
  //
  // Escaping a letter or a digit is never meaningful here. `\``, `\$` and
  // `\\` are the escapes a template literal genuinely needs, and punctuation
  // escapes are at worst redundant. So a letter or digit after a backslash
  // is always the mistake above, and this is the only thing that would
  // notice the next one.
  const offenders: string[] = [];
  for (const page of await getDocPages()) {
    const src = await readFile(new URL(`../../app${page.path}/page.ts`, import.meta.url), 'utf8');
    // Pair-consuming, so the `\\` in a correctly authored `\\s` is eaten as
    // one escape and its `s` is never read as escaped.
    for (const m of src.matchAll(/\\([\s\S])/g)) {
      if (/[A-Za-z0-9]/.test(m[1])) offenders.push(`${page.path}: \\${m[1]} in ${JSON.stringify(src.slice(Math.max(0, m.index - 30), m.index + 30))}`);
    }
  }
  assert.deepEqual(offenders.slice(0, 5), [], `${offenders.length} docs-page escapes fold to a bare letter`);
});

test('a kept hole nested inside another leaves no sentinel in the output', () => {
  // The two keep passes run in sequence, so a string-literal hole can park
  // text that already contains an escaped hole's sentinel. Restoring once
  // emitted the inner sentinel verbatim, shipping a private-use codepoint into
  // a text/plain response and the search index.
  const md = bodyToMarkdown('html`<p>a ${"\\${x}"} b</p>`');
  assert.equal(md, 'a ${x} b');
  assert.ok(!/[\uE000-\uF8FF]/.test(md), 'no private-use sentinel survives into the output');
});

test('plainText strips tags before it decodes entities', () => {
  assert.equal(plainText('a value with &lt;code&gt; here'), 'a value with <code> here');
  assert.match(plainText('intercepts same-origin &lt;a&gt; clicks'), /same-origin <a> clicks/);
});

test('a page description keeps the escaped tags it teaches', async () => {
  // extractPage used to run oneLine(decodeEntities(...)), decoding first and
  // stripping second, so a description teaching a tag lost it. This is the
  // counterfactual for the plainText fixture above, which passes on its own.
  const page = await getDocPage('client-router');
  assert.ok(page, 'the client-router page is in the corpus');
  assert.match(page.description, /same-origin <a> clicks and <form> submissions/);
});

test('a sample is fenced whether it is authored as code-block or pre', () => {
  for (const tag of ['code-block', 'pre']) {
    const md = bodyToMarkdown(`html\`<${tag}>const x = 1;</${tag}>\``);
    assert.match(md, /```\nconst x = 1;\n```/, `${tag} was not fenced`);
  }
});

test('an unfenced sample would lose its holes and indentation, which is why fencing matters', () => {
  // Drives the claim the fence test rests on: this is what the prose pipeline
  // does to code it does not recognise as a sample.
  const md = bodyToMarkdown('html`<p>text ${children} here</p>`');
  assert.equal(md.includes('${children}'), false, 'a hole outside a fence is stripped');
});

test('a tag that merely starts with pre is not treated as a sample', () => {
  const md = bodyToMarkdown('html`<preview-tabs><p>not code</p></preview-tabs>`');
  assert.equal(md.includes('```'), false, 'preview-tabs is not a code block');
});
