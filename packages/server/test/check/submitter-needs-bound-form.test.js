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
  assert.match(v[0].message, /in the same template/);
  await rm(dir, { recursive: true, force: true });
});

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
