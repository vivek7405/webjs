import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { checkConventions, RULES } from '../../src/check.js';

/**
 * Tests for `submitter-needs-bound-form` (#1307): a `<button formaction=${fn}>`
 * whose enclosing `<form>` binds nothing posts nowhere. The form defaults to
 * GET, the reserved identity field rides the query string, and the page simply
 * re-renders with the action never having run.
 *
 * Neither renderer can catch the cross-module version of this: SSR reads one
 * template at a time and a component renders its own template in a separate
 * pass with no view of the host page, so it is a cannot-tell there and
 * cannot-tell has to bind. This rule reads every template in the app at once.
 *
 * The NON-firing cases matter more than the firing ones. The rule is
 * deliberately conservative: anything it cannot resolve conclusively stays
 * silent, because a false positive on an ordinary shape (a per-row button, a
 * button inside a component) would be worse than the bug it catches.
 */
const RULE = 'submitter-needs-bound-form';

async function makeApp(files) {
  const dir = await mkdtemp(join(tmpdir(), 'webjs-submitter-bound-'));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(abs.slice(0, abs.lastIndexOf('/')), { recursive: true });
    await writeFile(abs, contents);
  }
  return dir;
}
const hits = (v) => v.filter((x) => x.rule === RULE);

/** A one-tag, one-class component file holding the bound submitter. */
const rowBtn = (extra = '') => `import { html, WebComponent } from '@webjsdev/core';
import { publishDraft } from '#modules/feedback/actions/publish.server.ts';
class RowBtn extends WebComponent({}) {
  render() {
    return html\`<button formaction=\${publishDraft}>Publish</button>\`;
  }
}
RowBtn.register('row-btn');
${extra}`;

const TODO_LIST = `import { html, WebComponent } from '@webjsdev/core';
class TodoList extends WebComponent({}) {
  render() { return html\`<ul><todo-row></todo-row></ul>\`; }
}
TodoList.register('todo-list');
`;
const TODO_ROW = `import { html, WebComponent } from '@webjsdev/core';
import { publishDraft } from '#modules/feedback/actions/publish.server.ts';
class TodoRow extends WebComponent({}) {
  render() { return html\`<li><button formaction=\${publishDraft}>Publish</button></li>\`; }
}
TodoRow.register('todo-row');
`;

test('the rule is registered', () => {
  assert.ok(RULES.some((r) => r.name === RULE), 'RULES lists submitter-needs-bound-form');
});

test('flags a component submitter whose only call site is an unbound form', async () => {
  const dir = await makeApp({
    'components/row-btn.ts': rowBtn(),
    'app/page.ts': `import { html } from '@webjsdev/core';
import '#components/row-btn.ts';
export default () => html\`<form><row-btn></row-btn></form>\`;
`,
  });
  const v = hits(await checkConventions(dir));
  assert.equal(v.length, 1, 'exactly one violation');
  assert.match(v[0].file, /row-btn\.ts/);
  assert.match(v[0].message, /<row-btn> is rendered/);
  assert.match(v[0].fix, /<form action=/);
  await rm(dir, { recursive: true, force: true });
});

test('silent when the call site binds the form', async () => {
  const dir = await makeApp({
    'components/row-btn.ts': rowBtn(),
    'app/page.ts': `import { html } from '@webjsdev/core';
import { saveAll } from '#modules/feedback/actions/save.server.ts';
export default () => html\`<form action=\${saveAll}><row-btn></row-btn></form>\`;
`,
  });
  assert.deepEqual(hits(await checkConventions(dir)), []);
  await rm(dir, { recursive: true, force: true });
});

test('silent when one call site is bound and another is not', async () => {
  const dir = await makeApp({
    'components/row-btn.ts': rowBtn(),
    'app/a/page.ts': `import { html } from '@webjsdev/core';
import { saveAll } from '#modules/feedback/actions/save.server.ts';
export default () => html\`<form action=\${saveAll}><row-btn></row-btn></form>\`;
`,
    'app/b/page.ts': `import { html } from '@webjsdev/core';
export default () => html\`<form><row-btn></row-btn></form>\`;
`,
  });
  assert.deepEqual(hits(await checkConventions(dir)), [], 'a mixed tag is indefinite');
  await rm(dir, { recursive: true, force: true });
});

test('silent when the unbound host form still DELIVERS the identity (method=post)', async () => {
  // The distinction the rule turns on, and the one that is easy to get wrong.
  // An unbound `<form method="post">` WORKS across a module boundary: the
  // cannot-tell fallback binds the submitter, the submitter's own name/value
  // pair carries `__webjs_action` into the POST body, and the dispatcher takes
  // the last entry it finds. Flagging it would be a false positive on working
  // code, with a diagnosis (a GET, a query string) that never happens.
  const dir = await makeApp({
    'components/row-btn.ts': rowBtn(),
    'app/page.ts': `import { html } from '@webjsdev/core';
export default () => html\`<form method="post"><row-btn></row-btn></form>\`;
`,
  });
  assert.deepEqual(hits(await checkConventions(dir)), [], 'an unbound POST form delivers, so nothing is broken');
  await rm(dir, { recursive: true, force: true });
});

test('fires when the unbound host form cannot deliver (method=get, or a bad enctype)', async () => {
  // The other side of the same coin: these really do lose the identity.
  for (const form of ['<form method="get">', '<form method="post" enctype="text/plain">', '<form method=" post ">']) {
    const dir = await makeApp({
      'components/row-btn.ts': rowBtn(),
      'app/page.ts': `import { html } from '@webjsdev/core';
export default () => html\`${form}<row-btn></row-btn></form>\`;
`,
    });
    const v = hits(await checkConventions(dir));
    assert.equal(v.length, 1, `${form} cannot carry the identity`);
    assert.match(v[0].message, /cannot carry the identity to the server/);
    await rm(dir, { recursive: true, force: true });
  }
});

test('silent when the host form method is a dynamic hole', async () => {
  const dir = await makeApp({
    'components/row-btn.ts': rowBtn(),
    'app/page.ts': `import { html } from '@webjsdev/core';
export default ({ m }) => html\`<form method=\${m}><row-btn></row-btn></form>\`;
`,
  });
  assert.deepEqual(hits(await checkConventions(dir)), [], 'a dynamic method is unknowable');
  await rm(dir, { recursive: true, force: true });
});

test('silent when the component could splice a fragment into a form it opens itself', async () => {
  // A fragment built into a local and spliced into a form the SAME file opens
  // inherits the splice point's scope, not this component's call-site scope,
  // and the two templates are separate scans. Same reasoning the submitter half
  // already applies to a bare helper.
  const dir = await makeApp({
    'components/todo-list.ts': `import { html, WebComponent } from '@webjsdev/core';
class TodoList extends WebComponent({}) {
  render() {
    const rows = html\`<todo-row></todo-row>\`;
    return html\`<form action=\${save}>\${rows}</form>\`;
  }
}
TodoList.register('todo-list');
`,
    'components/todo-row.ts': TODO_ROW,
    'app/page.ts': `import { html } from '@webjsdev/core';
export default () => html\`<form><todo-list></todo-list></form>\`;
`,
  });
  assert.deepEqual(hits(await checkConventions(dir)), [], 'a file that opens its own form cannot attribute a none-scope use');
  await rm(dir, { recursive: true, force: true });
});

test('a regex literal in a component file does not silently disable the rule', async () => {
  // The class body is located in the MASK and sliced out of the raw source at
  // the same offsets, so the brace matcher never lexes raw source. Feeding it
  // raw source made `static re = /[{]/` yield zero class bodies, which dropped
  // the cross-module half for that file with no signal at all.
  const dir = await makeApp({
    'components/row-btn.ts': `import { html, WebComponent } from '@webjsdev/core';
import { publishDraft } from '#modules/feedback/actions/publish.server.ts';
class RowBtn extends WebComponent({}) {
  static re = /[{]/;
  render() { return html\`<button formaction=\${publishDraft}>Publish</button>\`; }
}
RowBtn.register('row-btn');
`,
    'app/page.ts': `import { html } from '@webjsdev/core';
export default () => html\`<form><row-btn></row-btn></form>\`;
`,
  });
  const v = hits(await checkConventions(dir));
  assert.equal(v.length, 1, 'the rule still sees the class body');
  await rm(dir, { recursive: true, force: true });
});

test('silent when a module-scope helper in the component file opens a form', async () => {
  // The guard is the WHOLE-FILE scan, not the class body: a helper outside the
  // class can open a form the body never sees, and splicing into that is the
  // same hole the class-body case has.
  const dir = await makeApp({
    'components/row-btn.ts': `import { html, WebComponent } from '@webjsdev/core';
import { publishDraft } from '#modules/feedback/actions/publish.server.ts';
const shell = (inner) => html\`<form action=\${save}>\${inner}</form>\`;
class RowBtn extends WebComponent({}) {
  render() { return shell(html\`<button formaction=\${publishDraft}>Publish</button>\`); }
}
RowBtn.register('row-btn');
`,
    'app/page.ts': `import { html } from '@webjsdev/core';
export default () => html\`<form><row-btn></row-btn></form>\`;
`,
  });
  assert.deepEqual(hits(await checkConventions(dir)), [], 'the submitter may be spliced into the helper form');
  await rm(dir, { recursive: true, force: true });
});

test('silent on an unrecognised enctype, which falls back to a parseable body', async () => {
  // `enctype` defaults to application/x-www-form-urlencoded for a missing AND an
  // invalid value, so this form really does deliver.
  const dir = await makeApp({
    'components/row-btn.ts': rowBtn(),
    'app/page.ts': `import { html } from '@webjsdev/core';
export default () => html\`<form method="post" enctype="nonsense"><row-btn></row-btn></form>\`;
`,
  });
  assert.deepEqual(hits(await checkConventions(dir)), []);
  await rm(dir, { recursive: true, force: true });
});

test('silent when the submitter template is passed as a component PROPERTY', async () => {
  // Lexically inside the form, but the scan cannot say where it lands. SSR
  // renders nothing for it at all: the binding carries a function, so it fails
  // to serialize and is dropped with a warning, and <my-thing> decides where the
  // button goes at hydration. A conclusive verdict here was never this scan's
  // to give.
  const dir = await makeApp({
    'app/page.ts': `import { html } from '@webjsdev/core';
import { publishDraft } from '#modules/feedback/actions/publish.server.ts';
export default () => html\`<form method="post"><my-thing .tpl=\${html\`<button formaction=\${publishDraft}>P</button>\`}></my-thing></form>\`;
`,
  });
  assert.deepEqual(hits(await checkConventions(dir)), []);
  await rm(dir, { recursive: true, force: true });
});

test('silent when a COMPONENT hands its submitter template to another element', async () => {
  // The variant that matters most, and the one a page-only test misses. Marking
  // the handed-off template 'none' silences it on a page and recreates the false
  // positive here, because 'none' is exactly the value the cross-module half
  // attributes to this file's own tag and resolves against ITS call sites.
  // <my-thing> is what decides where the button lands.
  const dir = await makeApp({
    'components/row-btn.ts': `import { html, WebComponent } from '@webjsdev/core';
import { publishDraft } from '#modules/feedback/actions/publish.server.ts';
class RowBtn extends WebComponent({}) {
  render() { return html\`<my-thing .tpl=\${html\`<button formaction=\${publishDraft}>P</button>\`}></my-thing>\`; }
}
RowBtn.register('row-btn');
`,
    'app/page.ts': `import { html } from '@webjsdev/core';
export default () => html\`<form><row-btn></row-btn></form>\`;
`,
  });
  assert.deepEqual(hits(await checkConventions(dir)), [], 'the receiving element places the button');
  await rm(dir, { recursive: true, force: true });
});

test('silent when a component hands a TAG to another element', async () => {
  // The same root cause on the tag half: <my-shell> places the row, so
  // <todo-list>'s call sites say nothing about where <todo-row> renders.
  const dir = await makeApp({
    'components/todo-list.ts': `import { html, WebComponent } from '@webjsdev/core';
class TodoList extends WebComponent({}) {
  render() { return html\`<my-shell .rows=\${html\`<todo-row></todo-row>\`}></my-shell>\`; }
}
TodoList.register('todo-list');
`,
    'components/todo-row.ts': TODO_ROW,
    'app/page.ts': `import { html } from '@webjsdev/core';
export default () => html\`<form><todo-list></todo-list></form>\`;
`,
  });
  assert.deepEqual(hits(await checkConventions(dir)), [], 'a handed-off tag has no attributable call site');
  await rm(dir, { recursive: true, force: true });
});

test('a tag inside a suspense FALLBACK is a real call site, unlike an ordinary prop', async () => {
  // The suspense carve-out changes the tag half too, and that half can create
  // violations rather than only silence them, so it needs its own coverage. The
  // fallback is rendered inline inside the enclosing form, so <todo-row> really
  // does land there and the verdict is truthful.
  const page = (host) => `import { html } from '@webjsdev/core';
export default () => html\`<form>${host}</form>\`;
`;
  const fallback = await makeApp({
    'components/todo-row.ts': TODO_ROW,
    'app/page.ts': page('<webjs-suspense .fallback=\${html\`<todo-row></todo-row>\`}></webjs-suspense>'),
  });
  assert.equal(hits(await checkConventions(fallback)).length, 1, 'the fallback renders inline, so it is a call site');
  await rm(fallback, { recursive: true, force: true });

  // The same shape through an ordinary property is handed off and stays silent.
  const handed = await makeApp({
    'components/todo-row.ts': TODO_ROW,
    'app/page.ts': page('<my-shell .rows=\${html\`<todo-row></todo-row>\`}></my-shell>'),
  });
  assert.deepEqual(hits(await checkConventions(handed)), [], 'my-shell decides where the row lands');
  await rm(handed, { recursive: true, force: true });
});

test('silent on a formaction hole that is a URL, not an action', async () => {
  // The scan is lexical; the RENDERER binds only when the hole's value is a
  // FUNCTION (`isBoundFormAction`). So an ordinary progressive-enhancement form
  // whose buttons post to different `route.ts` endpoints is not a binding at
  // all, and reporting it was a false positive on working code.
  for (const hole of ["\\${'/api/items/' + id + '/archive'}", "\\${'/api/x'}", '\\${localUrl}']) {
    const dir = await makeApp({
      'app/items/page.ts': `import { html } from '@webjsdev/core';
const localUrl = '/api/x';
export default ({ id }) => html\`<form method="post" action="/api/items"><button formaction=${hole}>Archive</button></form>\`;
`,
    });
    assert.deepEqual(hits(await checkConventions(dir)), [], `${hole} is a url, not an action`);
    await rm(dir, { recursive: true, force: true });
  }
});

test('still fires when the hole IS an imported server action', async () => {
  // The counterfactual for the filter above: narrowing to real bindings must not
  // silence the shape the rule exists for.
  const dir = await makeApp({
    'app/items/page.ts': `import { html } from '@webjsdev/core';
import { publishDraft } from '#modules/feedback/actions/publish.server.ts';
export default () => html\`<form><button formaction=\${publishDraft}>P</button></form>\`;
`,
  });
  assert.equal(hits(await checkConventions(dir)).length, 1);
  await rm(dir, { recursive: true, force: true });
});

test('silent when the tag has no call site anywhere in the app', async () => {
  const dir = await makeApp({
    'components/row-btn.ts': rowBtn(),
    'app/page.ts': `import { html } from '@webjsdev/core';
export default () => html\`<h1>hi</h1>\`;
`,
  });
  assert.deepEqual(hits(await checkConventions(dir)), []);
  await rm(dir, { recursive: true, force: true });
});

test('silent when the submitter lives in a bare html helper, not the class body', async () => {
  const dir = await makeApp({
    'components/row-btn.ts': `import { html, WebComponent } from '@webjsdev/core';
import { publishDraft } from '#modules/feedback/actions/publish.server.ts';
export const publishBtn = () => html\`<button formaction=\${publishDraft}>Publish</button>\`;
class RowBtn extends WebComponent({}) {
  render() { return html\`<span>row</span>\`; }
}
RowBtn.register('row-btn');
`,
    'app/page.ts': `import { html } from '@webjsdev/core';
export default () => html\`<form><row-btn></row-btn></form>\`;
`,
  });
  assert.deepEqual(hits(await checkConventions(dir)), [], 'a fragment inherits the caller scope');
  await rm(dir, { recursive: true, force: true });
});

test('silent when the file registers two tags (ambiguous attribution)', async () => {
  const dir = await makeApp({
    'components/pair.ts': `import { html, WebComponent } from '@webjsdev/core';
import { publishDraft } from '#modules/feedback/actions/publish.server.ts';
class RowBtn extends WebComponent({}) {
  render() { return html\`<button formaction=\${publishDraft}>Publish</button>\`; }
}
RowBtn.register('row-btn');
class RowLabel extends WebComponent({}) {
  render() { return html\`<span>label</span>\`; }
}
RowLabel.register('row-label');
`,
    'app/page.ts': `import { html } from '@webjsdev/core';
export default () => html\`<form><row-btn></row-btn></form>\`;
`,
  });
  assert.deepEqual(hits(await checkConventions(dir)), []);
  await rm(dir, { recursive: true, force: true });
});

test('flags the same-scan case with no cross-module step', async () => {
  const dir = await makeApp({
    'app/page.ts': `import { html } from '@webjsdev/core';
import { publishDraft } from '#modules/feedback/actions/publish.server.ts';
export default () => html\`<form><button formaction=\${publishDraft}>Publish</button></form>\`;
`,
  });
  const v = hits(await checkConventions(dir));
  assert.equal(v.length, 1);
  assert.match(v[0].file, /page\.ts/);
  // The same-scan case is a RENDER error, not the silent one, so it says so.
  assert.match(v[0].message, /SAME template/);
  assert.match(v[0].message, /refuses this shape outright/);
  await rm(dir, { recursive: true, force: true });
});

test('the same-scan case is flagged even with method="post", because the renderer refuses it', async () => {
  // Unlike the cross-module case, delivery is irrelevant here: the renderer
  // sees both halves in one scan and throws, whatever the method.
  const dir = await makeApp({
    'app/page.ts': `import { html } from '@webjsdev/core';
import { publishDraft } from '#modules/feedback/actions/publish.server.ts';
export default () => html\`<form method="post"><button formaction=\${publishDraft}>P</button></form>\`;
`,
  });
  const v = hits(await checkConventions(dir));
  assert.equal(v.length, 1);
  assert.match(v[0].message, /refuses this shape outright/);
  await rm(dir, { recursive: true, force: true });
});

test('transitive: silent when the outer page binds the form', async () => {
  const dir = await makeApp({
    'components/todo-list.ts': TODO_LIST,
    'components/todo-row.ts': TODO_ROW,
    'app/page.ts': `import { html } from '@webjsdev/core';
import { saveAll } from '#modules/feedback/actions/save.server.ts';
export default () => html\`<form action=\${saveAll}><todo-list></todo-list></form>\`;
`,
  });
  assert.deepEqual(hits(await checkConventions(dir)), []);
  await rm(dir, { recursive: true, force: true });
});

test('transitive: fires through an intermediate component when the outer form is unbound', async () => {
  const dir = await makeApp({
    'components/todo-list.ts': TODO_LIST,
    'components/todo-row.ts': TODO_ROW,
    'app/page.ts': `import { html } from '@webjsdev/core';
export default () => html\`<form><todo-list></todo-list></form>\`;
`,
  });
  const v = hits(await checkConventions(dir));
  assert.equal(v.length, 1, 'a one-level rule would go silent here');
  assert.match(v[0].file, /todo-row\.ts/);
  await rm(dir, { recursive: true, force: true });
});

test('a reference cycle is silent and does not hang', async () => {
  const dir = await makeApp({
    'components/a-one.ts': `import { html, WebComponent } from '@webjsdev/core';
import { publishDraft } from '#modules/feedback/actions/publish.server.ts';
class AOne extends WebComponent({}) {
  render() { return html\`<b-two></b-two><button formaction=\${publishDraft}>Publish</button>\`; }
}
AOne.register('a-one');
`,
    'components/b-two.ts': `import { html, WebComponent } from '@webjsdev/core';
class BTwo extends WebComponent({}) {
  render() { return html\`<a-one></a-one>\`; }
}
BTwo.register('b-two');
`,
    'app/page.ts': `import { html } from '@webjsdev/core';
export default () => html\`<form><a-one></a-one></form>\`;
`,
  });
  assert.deepEqual(hits(await checkConventions(dir)), [], 'a cycle can never be a verdict');
  await rm(dir, { recursive: true, force: true });
});

test('a docs page showing the shape as a code sample stays clean', async () => {
  const dir = await makeApp({
    'app/docs/page.ts': `import { html } from '@webjsdev/core';
const sample = '<form><button formaction=\${del}>x</button></form>';
export default () => html\`<pre><code>\${sample}</code></pre>
  <p>Write &lt;form action=\${'$'}{save}&gt; around it.</p>\`;
`,
  });
  assert.deepEqual(hits(await checkConventions(dir)), [], 'a string is never read as markup');
  await rm(dir, { recursive: true, force: true });
});
