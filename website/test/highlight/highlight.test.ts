/**
 * Unit tests for the SSR code highlighter (lib/utils/highlight.ts).
 *
 * highlight() turns a plain code string into themed token spans at server
 * render time. These tests render the result with renderToString and assert
 * on the produced HTML: the token classes are correct, and code text is HTML
 * escaped (the whole reason samples live in plain strings rather than inside
 * an html`` body is that backticks, angle brackets, and ${...} pass through
 * untouched and escaped).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { html } from '@webjsdev/core';
import { renderToString } from '@webjsdev/core/server';
import { highlight, highlightToHtml, tokenize, tokenClass, trimBlock } from '#lib/utils/highlight.ts';
import { renderPostBody } from '#modules/blog/utils/render-post.ts';

const render = (code: string) => renderToString(html`<pre>${highlight(code)}</pre>`);

test('every token class highlight() emits is styled in public/input.css', () => {
  // highlight.ts emits t-* classes; they are styled globally in
  // public/input.css (so every surface, the home page code windows and the
  // blog code fences, shares one palette). A rename/drop on EITHER side passes
  // the whole suite while shipping plain (unstyled) code samples, so pin the
  // contract (mirrors the no-animations pin in layout-ssr.test.ts).
  const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
  const classes = [...read('../../lib/utils/highlight.ts').matchAll(/'(t-[a-z]+)'/g)].map((m) => m[1]);
  const css = read('../../public/input.css');
  assert.ok(classes.length >= 6, `extracted the emitted token classes, got ${classes.join(',')}`);
  for (const cls of new Set(classes)) {
    assert.ok(css.includes(`.${cls}`), `public/input.css must style the .${cls} token class`);
  }
});

test('keywords and strings get their token classes', async () => {
  const out = await render("import { html } from '@webjsdev/core';");
  assert.match(out, /<span class="t-kw">import<\/span>/);
  assert.match(out, /<span class="t-kw">from<\/span>/);
  assert.match(out, /<span class="t-str">'@webjsdev\/core'<\/span>/);
  assert.match(out, /<span class="t-id">html<\/span>/);
});

test('a call expression is classified as a function', async () => {
  const out = await render('renderToString(html)');
  assert.match(out, /<span class="t-fn">renderToString<\/span>/);
  // `html` here is not followed by `(`, so it stays a plain identifier.
  assert.match(out, /<span class="t-id">html<\/span>/);
});

test('.get( / .set( method calls are functions, not keywords', async () => {
  // The flagship component sample calls the signal API (this.likes.set(...)/
  // .get()); get/set must NOT be colored as language keywords.
  const out = await render('this.likes.set(this.likes.get() + 1)');
  assert.match(out, /<span class="t-fn">set<\/span>/, 'set( is a function call');
  assert.match(out, /<span class="t-fn">get<\/span>/, 'get( is a function call');
  assert.ok(!/<span class="t-kw">(get|set)<\/span>/.test(out), 'neither is a keyword');
});

test('capitalized identifiers are classified as types', async () => {
  const out = await render('class StudentCard extends WebComponent {');
  assert.match(out, /<span class="t-type">StudentCard<\/span>/);
  assert.match(out, /<span class="t-type">WebComponent<\/span>/);
  assert.match(out, /<span class="t-kw">class<\/span>/);
});

test('comments and numbers get their token classes', async () => {
  const out = await render('// hello world\nconst x = 1');
  assert.match(out, /<span class="t-com">\/\/ hello world<\/span>/);
  assert.match(out, /<span class="t-num">1<\/span>/);
});

test('code text is HTML escaped (no injection, backticks and ${} survive)', async () => {
  const out = await render('const t = html`<div>${x}</div> & <b>`;');
  // Angle brackets and ampersand are escaped inside the string token.
  assert.match(out, /&lt;div&gt;/);
  assert.match(out, /&amp;/);
  assert.match(out, /&lt;b&gt;/);
  // No raw element ever lands in the output, so a sample can never inject markup.
  assert.ok(!out.includes('<div>'), 'no raw <div> injected');
  assert.ok(!out.includes('<b>'), 'no raw <b> injected');
  // The ${...} interpolation is literal text, left intact.
  assert.ok(out.includes('${x}'), '${x} survives as literal text');
});

test('leading and trailing blank lines are trimmed', async () => {
  const out = await render('\n\nconst x\n\n');
  assert.equal(out, '<pre><span class="t-kw">const</span> <span class="t-id">x</span></pre>');
});

test('tokenizer edge cases: block comments, backtick strings, hex/underscore numbers, more keywords', async () => {
  assert.match(await render('/* block */ x'), /<span class="t-com">\/\* block \*\/<\/span>/);
  // a whole backtick string is one t-str token (the reason samples avoid html`` bodies)
  assert.match(await render('const s = `hi`;'), /<span class="t-str">`hi`<\/span>/);
  // an escaped quote inside a string does not end the token early (escape-skip)
  assert.match(await render("const s = 'a\\'b';"), /<span class="t-str">'a\\'b'<\/span>/);
  // hex and underscore-grouped numbers stay a single t-num
  assert.match(await render('0xFF'), /<span class="t-num">0xFF<\/span>/);
  assert.match(await render('1_000'), /<span class="t-num">1_000<\/span>/);
  // the extra keywords the sample surface uses
  assert.match(await render('x as Foo'), /<span class="t-kw">as<\/span>/);
  assert.match(await render('typeof y'), /<span class="t-kw">typeof<\/span>/);
});

test('highlightToHtml emits the same token spans as a string', () => {
  const out = highlightToHtml("const x = 1;");
  assert.match(out, /<span class="t-kw">const<\/span>/);
  assert.match(out, /<span class="t-num">1<\/span>/);
  assert.equal(typeof out, 'string');
});

test('highlightToHtml HTML-escapes token text (no injection)', () => {
  const out = highlightToHtml('const t = "<div> & `x`";');
  assert.match(out, /&lt;div&gt;/);
  assert.match(out, /&amp;/);
  assert.ok(!out.includes('<div>'), 'no raw <div> injected');
});

test('blog renderer highlights ts/js fences but leaves sh fences plain', () => {
  const out = renderPostBody('```ts\nconst x: number = 1;\n```\n\n```sh\nnpm run dev\n```');
  // the ts fence is tokenized
  assert.match(out, /<span class="t-kw">const<\/span>/);
  // the sh fence is escaped plain text, not tokenized
  assert.ok(out.includes('npm run dev'), 'sh fence content present');
  assert.ok(!/<span class="t-[a-z]+">npm<\/span>/.test(out), 'sh fence is not tokenized');
});

test('a bare no-language fence stays plain (shell output is not JS-tokenized)', () => {
  // A fence with no language often holds command output. Tokenizing it as JS
  // mis-colors words like `Forbidden` (as a type) or `403` (as a number).
  const out = renderPostBody('```\nnpm error code E403\nForbidden - PUT https://registry.npmjs.org\n```');
  assert.ok(out.includes('npm error code E403'), 'output content present');
  assert.ok(!/<span class="t-[a-z]+">/.test(out), 'no token spans in a bare fence');
});

test('fence language matching is case-insensitive', () => {
  const out = renderPostBody('```TS\nconst x = 1;\n```');
  assert.match(out, /<span class="t-kw">const<\/span>/);
});

test('blog renderer escapes angle brackets in a highlighted fence', () => {
  const out = renderPostBody('```ts\nconst el = html`<my-tag>`;\n```');
  assert.match(out, /&lt;my-tag&gt;/);
  assert.ok(!out.includes('<my-tag>'), 'no raw custom element injected');
});

/*
 * The grammar used to exist twice: here, and again in an ES5 copy served as a
 * static asset for the documentation. Each had learned something the other had
 * not, so the surviving one is the merge, and these cover the two rules that
 * arrived from the deleted copy. `<code-block>` runs this same tokenize() in
 * the browser now, so a divergence here is a divergence everywhere rather than
 * a difference between two surfaces.
 */
test('an unterminated quote is punctuation, not a string running to the end of the block', () => {
  // An apostrophe in a prose comment is the common case. Treated as a string
  // opener it swallows every line below it, which is how a whole sample loses
  // its colour from one word.
  const toks = tokenize("// it's fine\nconst x = 1;");
  assert.equal(toks.filter((t) => t.t === 'str').length, 0, 'no string token');
  assert.ok(toks.some((t) => t.t === 'kw' && t.v === 'const'), 'the code below still tokenizes');
});

test('a quote that does close on its own line is still a string', () => {
  const toks = tokenize("const greeting = 'hi';");
  assert.deepEqual(toks.filter((t) => t.t === 'str').map((t) => t.v), ["'hi'"]);
});

test('a backtick template spans lines, unlike a quote', () => {
  const toks = tokenize('const t = `line one\nline two`;');
  assert.deepEqual(toks.filter((t) => t.t === 'str').map((t) => t.v), ['`line one\nline two`']);
});

test('a line-leading "# " is a shell comment', () => {
  const toks = tokenize('# install it\nnpm create webjs@latest');
  assert.deepEqual(toks.filter((t) => t.t === 'com').map((t) => t.v), ['# install it']);
});

test('a hash that is not a comment marker is left alone', () => {
  // A CSS id selector, a private field, a path alias, and a hex colour all
  // start with '#', and swallowing the rest of their line would be a visible
  // regression on the docs pages that show them.
  for (const src of ['#app { color: #fff; }', 'this.#count = 1;', "import { db } from '#db/connection.server.ts';"]) {
    assert.equal(tokenize(src).filter((t) => t.t === 'com').length, 0, `not a comment: ${src}`);
  }
});

test('tokenClass maps every token type the tokenizer emits', () => {
  const src = "// c\nconst a = 'x' + 1;\nfunction f() {}\nclass K {}";
  for (const tok of tokenize(src)) {
    // 'ws' is deliberately unclassed: whitespace needs no span.
    if (tok.t === 'ws') continue;
    assert.ok(tokenClass(tok.t), `token type ${tok.t} has no class, so it would render unstyled`);
  }
});

test('trimBlock drops the blank lines an authored block picks up, and nothing else', () => {
  assert.equal(trimBlock('\n\nconst x = 1;\n\n'), 'const x = 1;');
  assert.equal(trimBlock('  indented\n  still'), '  indented\n  still');
});
