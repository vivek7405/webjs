import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { checkConventions, RULES } from '../../src/check.js';

/**
 * Tests for `form-action-not-a-get-action` (#1155): binding a GET-declared
 * action to a form is a contradiction the dispatcher answers with a 405, so it
 * should be caught at edit time instead.
 *
 * The carve-outs matter as much as the flag here: the rule reads across files,
 * and a docs page that DEMONSTRATES the shape inside a code sample must stay
 * clean, or the framework's own website cannot pass its own checker.
 */
const RULE = 'form-action-not-a-get-action';

async function makeApp(files) {
  const dir = await mkdtemp(join(tmpdir(), 'webjs-form-get-action-'));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(abs.slice(0, abs.lastIndexOf('/')), { recursive: true });
    await writeFile(abs, contents);
  }
  return dir;
}
const hits = (v) => v.filter((x) => x.rule === RULE);

const GET_ACTION = `'use server';
export const method = 'GET';
export async function readIt(input) { return { success: true, input }; }
`;
const POST_ACTION = `'use server';
export async function saveIt(formData) { return { success: true, got: formData }; }
`;

test('the rule is registered', () => {
  assert.ok(RULES.some((r) => r.name === RULE), 'RULES lists form-action-not-a-get-action');
});

test('flags a form bound to a GET-declared action', async () => {
  const dir = await makeApp({
    'modules/read/actions/read.server.ts': GET_ACTION,
    'app/page.ts': `import { html } from '@webjsdev/core';
import { readIt } from '../modules/read/actions/read.server.ts';
export default () => html\`<form action=\${readIt}></form>\`;
`,
  });
  const v = hits(await checkConventions(dir));
  assert.equal(v.length, 1, 'exactly one violation');
  assert.match(v[0].file, /page\.ts/);
  assert.match(v[0].message, /method = 'GET'/);
  await rm(dir, { recursive: true, force: true });
});

test('does NOT flag a form bound to a plain action (counterfactual)', async () => {
  const dir = await makeApp({
    'modules/save/actions/save.server.ts': POST_ACTION,
    'app/page.ts': `import { html } from '@webjsdev/core';
import { saveIt } from '../modules/save/actions/save.server.ts';
export default () => html\`<form action=\${saveIt}></form>\`;
`,
  });
  assert.equal(hits(await checkConventions(dir)).length, 0);
  await rm(dir, { recursive: true, force: true });
});

test('does NOT flag an explicit method = POST', async () => {
  const dir = await makeApp({
    'modules/save/actions/save.server.ts': `'use server';\nexport const method = 'POST';\nexport async function saveIt(fd) { return fd; }\n`,
    'app/page.ts': `import { html } from '@webjsdev/core';
import { saveIt } from '../modules/save/actions/save.server.ts';
export default () => html\`<form action=\${saveIt}></form>\`;
`,
  });
  assert.equal(hits(await checkConventions(dir)).length, 0);
  await rm(dir, { recursive: true, force: true });
});

test('does NOT flag a PUT / PATCH / DELETE action, which the dispatcher runs fine', async () => {
  // A browser form always submits as a POST, and the dispatcher runs those
  // actions on it: the declared verb governs the RPC transport, not whether the
  // function can serve a form. Only a GET is contradictory (CSRF-exempt, args
  // in the url, no body), and it is the only one the dispatcher 405s. A rule
  // that flags more than the runtime rejects is a false positive telling
  // authors to change working code.
  for (const verb of ['PUT', 'PATCH', 'DELETE']) {
    const dir = await makeApp({
      'modules/w/actions/w.server.ts': `'use server';\nexport const method = '${verb}';\nexport async function writeIt(fd) { return fd; }\n`,
      'app/page.ts': `import { html } from '@webjsdev/core';
import { writeIt } from '../modules/w/actions/w.server.ts';
export default () => html\`<form action=\${writeIt}></form>\`;
`,
    });
    assert.equal(hits(await checkConventions(dir)).length, 0, `${verb} must not be flagged`);
    await rm(dir, { recursive: true, force: true });
  }
});

test('does NOT flag a GET action that is merely IMPORTED, not bound to a form', async () => {
  // Calling a GET action from a page is the normal way to read data. Only
  // binding one to a form is the contradiction.
  const dir = await makeApp({
    'modules/read/actions/read.server.ts': GET_ACTION,
    'app/page.ts': `import { html } from '@webjsdev/core';
import { readIt } from '../modules/read/actions/read.server.ts';
export default async () => html\`<p>\${(await readIt(1)).input}</p>\`;
`,
  });
  assert.equal(hits(await checkConventions(dir)).length, 0);
  await rm(dir, { recursive: true, force: true });
});

test('does NOT flag a code SAMPLE that shows the shape', async () => {
  // The docs site renders `<form action=${x}>` as text inside a template. The
  // rule reads a blanked view, so a sample cannot make the framework's own
  // website fail its own checker.
  const dir = await makeApp({
    'modules/read/actions/read.server.ts': GET_ACTION,
    'app/docs/page.ts': `import { html } from '@webjsdev/core';
import { readIt } from '../../modules/read/actions/read.server.ts';
const SAMPLE = '<form action=\${readIt}></form>';
export default async () => html\`<pre>\${SAMPLE}</pre><p>\${(await readIt(1)).input}</p>\`;
`,
  });
  assert.equal(hits(await checkConventions(dir)).length, 0);
  await rm(dir, { recursive: true, force: true });
});

test('does NOT flag a quoted action="${fn}", which is refused at render time anyway', async () => {
  // A quoted hole is a plain attribute the renderer refuses as a stringify, so
  // it never reaches the dispatcher and is not this rule's failure mode.
  const dir = await makeApp({
    'modules/read/actions/read.server.ts': GET_ACTION,
    'app/page.ts': `import { html } from '@webjsdev/core';
import { readIt } from '../modules/read/actions/read.server.ts';
export default () => html\`<form action="\${readIt}"></form>\`;
`,
  });
  assert.equal(hits(await checkConventions(dir)).length, 0);
  await rm(dir, { recursive: true, force: true });
});

test('flags through a # path alias and a renamed import', async () => {
  const dir = await makeApp({
    'package.json': JSON.stringify({ imports: { '#*': './*' } }),
    'modules/read/actions/read.server.ts': GET_ACTION,
    'app/page.ts': `import { html } from '@webjsdev/core';
import { readIt as reader } from '#modules/read/actions/read.server.ts';
export default () => html\`<form action=\${reader}></form>\`;
`,
  });
  const v = hits(await checkConventions(dir));
  assert.equal(v.length, 1, 'the alias resolves and the local name is what is matched');
  await rm(dir, { recursive: true, force: true });
});

test('flags inside a component, not only a page', async () => {
  const dir = await makeApp({
    'modules/read/actions/read.server.ts': GET_ACTION,
    'components/search-box.ts': `import { html, WebComponent } from '@webjsdev/core';
import { readIt } from '../modules/read/actions/read.server.ts';
class SearchBox extends WebComponent({}) {
  render() { return html\`<form action=\${readIt}></form>\`; }
}
SearchBox.register('search-box');
`,
  });
  assert.equal(hits(await checkConventions(dir)).length, 1);
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// #1207: the rule follows the binding down to a submitter. A GET-declared
// action is exactly as unrunnable bound to a `<button formaction=${fn}>` as to
// the form itself, since both submit the same POST body to the same url.
//
// The pairing tests below are the other half: the tag and the attribute have to
// match as a PAIR. Matching the tag set and the attribute set independently
// also fired on `<form formaction=${x}>` and `<button action=${x}>`, neither of
// which is a binding (the renderers refuse both), so the rule would have
// reported a 405 for markup that never reaches one.
// ---------------------------------------------------------------------------

test('flags a submitter bound to a GET-declared action (#1207)', async () => {
  const dir = await makeApp({
    'modules/read/actions/read.server.ts': GET_ACTION,
    'modules/save/actions/save.server.ts': POST_ACTION,
    'app/page.ts': `import { html } from '@webjsdev/core';
import { readIt } from '../modules/read/actions/read.server.ts';
import { saveIt } from '../modules/save/actions/save.server.ts';
export default () => html\`<form action=\${saveIt}><button formaction=\${readIt}>Go</button></form>\`;
`,
  });
  const v = hits(await checkConventions(dir));
  assert.equal(v.length, 1, 'exactly one violation');
  assert.match(v[0].file, /page\.ts/);
  assert.match(v[0].message, /method = 'GET'/);
  await rm(dir, { recursive: true, force: true });
});

test('does NOT flag a submitter bound to a POST action (counterfactual)', async () => {
  const dir = await makeApp({
    'modules/save/actions/save.server.ts': POST_ACTION,
    'app/page.ts': `import { html } from '@webjsdev/core';
import { saveIt } from '../modules/save/actions/save.server.ts';
export default () => html\`<form action=\${saveIt}><button formaction=\${saveIt}>Go</button></form>\`;
`,
  });
  assert.equal(hits(await checkConventions(dir)).length, 0);
  await rm(dir, { recursive: true, force: true });
});

test('does NOT flag formaction= on a <form>, which binds nothing', async () => {
  const dir = await makeApp({
    'modules/read/actions/read.server.ts': GET_ACTION,
    'app/page.ts': `import { html } from '@webjsdev/core';
import { readIt } from '../modules/read/actions/read.server.ts';
export default () => html\`<form formaction=\${readIt}></form>\`;
`,
  });
  assert.equal(hits(await checkConventions(dir)).length, 0, 'a form has no formaction binding');
  await rm(dir, { recursive: true, force: true });
});

test('does NOT flag action= on a <button>, which binds nothing', async () => {
  const dir = await makeApp({
    'modules/read/actions/read.server.ts': GET_ACTION,
    'app/page.ts': `import { html } from '@webjsdev/core';
import { readIt } from '../modules/read/actions/read.server.ts';
export default () => html\`<form action=\${readIt.name ? '/x' : '/y'}><button action=\${readIt}>Go</button></form>\`;
`,
  });
  assert.equal(hits(await checkConventions(dir)).length, 0, 'a button has no action binding');
  await rm(dir, { recursive: true, force: true });
});

test('flags a GET action bound to an <input type="submit"> submitter', async () => {
  const dir = await makeApp({
    'modules/read/actions/read.server.ts': GET_ACTION,
    'modules/save/actions/save.server.ts': POST_ACTION,
    'app/page.ts': `import { html } from '@webjsdev/core';
import { readIt } from '../modules/read/actions/read.server.ts';
import { saveIt } from '../modules/save/actions/save.server.ts';
export default () => html\`<form action=\${saveIt}><input type="submit" formaction=\${readIt}></form>\`;
`,
  });
  assert.equal(hits(await checkConventions(dir)).length, 1);
  await rm(dir, { recursive: true, force: true });
});
