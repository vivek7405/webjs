import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { checkConventions, RULES } from '../../src/check.js';

/**
 * Tests for the `no-server-import-in-browser-module` rule. The rule flags a
 * page / layout / component module that SHIPS to the browser (the build does
 * not elide it) and transitively imports a server-only `.server.{ts,js}`
 * module. The critical correctness property is that it reuses the build's
 * elision verdict, so a display-only page the framework elides is NOT flagged
 * even though it imports the same server module: the difference between "this
 * page ships" and "this page elides" is the whole rule.
 */

const RULE = 'no-server-import-in-browser-module';

async function makeApp(files) {
  const dir = await mkdtemp(join(tmpdir(), 'webjs-server-import-'));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(abs.slice(0, abs.lastIndexOf('/')), { recursive: true });
    await writeFile(abs, contents);
  }
  return dir;
}

function find(violations, file) {
  return violations.filter((v) => v.rule === RULE && (!file || v.file.includes(file)));
}

// A minimal server-only auth module: the canonical motivating case. In the
// browser this resolves to a stub, so importing it from a shipping module is
// the runtime crash the rule catches.
const AUTH_SERVER = `export async function auth() {
  // server-only: reads a cookie/session on the request
  return { user: null };
}
`;

// A genuinely interactive component (reactive primitive import forces it to
// ship), so a page that imports it is NOT elided.
const INTERACTIVE_COMPONENT = `import { WebComponent } from '@webjsdev/core';
import { signal } from '@webjsdev/core';

class CrispWorkspace extends WebComponent {
  static properties = { open: { state: true } };
  declare open: boolean;
  constructor() { super(); this.open = false; }
  render() { return this.html\`<div>workspace</div>\`; }
}
CrispWorkspace.register('crisp-workspace');
`;

test('RULES enumerates no-server-import-in-browser-module', () => {
  const r = RULES.find((r) => r.name === RULE);
  assert.ok(r, 'rule must be listed in RULES');
  assert.ok(/elid/i.test(r.description), 'description should mention elision');
});

// (a) Display-only page that imports auth and IS elided -> NO violation.
// The page does no client work, so the framework elides it (its server import
// is stripped from the served source). This is the legitimate pattern and the
// single biggest false-positive risk; it must pass.
test('elided display-only page importing auth is NOT flagged', async () => {
  const appDir = await makeApp({
    'lib/auth.server.ts': AUTH_SERVER,
    'app/dashboard/page.ts': `import { auth } from '../../lib/auth.server.ts';
export default async function DashboardPage() {
  const session = await auth();
  return \`<h1>Hello \${session.user ?? 'guest'}</h1>\`;
}
`,
  });
  try {
    const violations = await checkConventions(appDir);
    assert.equal(find(violations).length, 0, 'an elided display-only page must not be flagged');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// An IMPORT-ONLY page (its only client relevance is importing a shipping
// component, #605/#963) is dropped from the boot in favour of its components,
// so its bare server import never loads in a browser and must NOT be flagged.
test('import-only page importing auth AND a component is NOT flagged (#963)', async () => {
  const appDir = await makeApp({
    'lib/auth.server.ts': AUTH_SERVER,
    'modules/workspace/components/crisp-workspace.ts': INTERACTIVE_COMPONENT,
    'app/project/page.ts': `import { auth } from '../../lib/auth.server.ts';
import '../../modules/workspace/components/crisp-workspace.ts';
export default async function ProjectPage() {
  const session = await auth();
  return \`<crisp-workspace></crisp-workspace>\`;
}
`,
  });
  try {
    const violations = await checkConventions(appDir);
    assert.equal(find(violations).length, 0, 'an import-only page must not be flagged');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// (b) Page that imports auth AND a component AND does its OWN client work (so
// it ships whole under the path-aware verdict, #963) -> violation. The page's
// own client signal forces it to load in the browser, which drags the
// server-only auth import along: a runtime crash.
test('non-elided page importing auth AND a component IS flagged', async () => {
  const appDir = await makeApp({
    'lib/auth.server.ts': AUTH_SERVER,
    'modules/workspace/components/crisp-workspace.ts': INTERACTIVE_COMPONENT,
    'app/project/page.ts': `import { auth } from '../../lib/auth.server.ts';
import '../../modules/workspace/components/crisp-workspace.ts';
import '@webjsdev/core/client-router'; // own client work: the page ships whole (#963)
export default async function ProjectPage() {
  const session = await auth();
  return \`<crisp-workspace></crisp-workspace>\`;
}
`,
  });
  try {
    const violations = await checkConventions(appDir);
    const hits = find(violations, 'project/page.ts');
    assert.equal(hits.length, 1, 'a non-elided page importing a server module must be flagged exactly once');
    const v = hits[0];
    assert.ok(v.file.includes('project/page.ts'), 'names the offending file');
    assert.ok(v.message.includes('auth.server.ts'), 'names the offending server import');
    assert.ok(/middleware|use server|layout/i.test(v.fix), 'fix names a concrete remedy');
    // A page/layout CAN become a dropped carrier again by moving its own
    // client work into a component (#963), so it additionally gets that
    // remedy (the boundary kinds do not).
    assert.ok(/elide/i.test(v.fix) && /own client work/.test(v.fix),
      'a page is offered the become-a-dropped-carrier remedy');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// A `'use server'` ACTION imported by a shipping page is NOT a crash and must
// NOT be flagged. The browser receives a working RPC stub (exports POST to the
// server), so calling it from a shipping module is the intended pattern. This
// is the single biggest false-positive class the rule must avoid (it fired on
// every dogfood app before the directive check): a `.server.ts` with
// `'use server'` is fundamentally different from a bare server-only utility
// whose stub throws at load.
test('a use-server action imported by a shipping page is NOT flagged', async () => {
  const appDir = await makeApp({
    'modules/posts/actions/create-post.server.ts': `'use server';
export async function createPost(input: { title: string }) {
  return { id: '1', title: input.title };
}
`,
    'modules/workspace/components/crisp-workspace.ts': INTERACTIVE_COMPONENT,
    'app/project/page.ts': `import { createPost } from '../../modules/posts/actions/create-post.server.ts';
import '../../modules/workspace/components/crisp-workspace.ts';
export default async function ProjectPage() {
  await createPost({ title: 'hi' });
  return \`<crisp-workspace></crisp-workspace>\`;
}
`,
  });
  try {
    const violations = await checkConventions(appDir);
    assert.equal(find(violations).length, 0,
      'a use-server action resolves to a working RPC stub, so it is not a crash and must not be flagged');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// A phantom edge from a code-example STRING (an `import` written inside a
// quoted string the module graph keeps verbatim) resolves to a non-existent
// file and must not be flagged: that import never runs. Mirrors the docs /
// website `<pre>` samples that tripped the rule before the on-disk check.
test('a server import that only appears inside a code-example string is NOT flagged', async () => {
  const appDir = await makeApp({
    'modules/workspace/components/crisp-workspace.ts': INTERACTIVE_COMPONENT,
    'app/docs/page.ts': `import '../../modules/workspace/components/crisp-workspace.ts';
// A code sample shown in the page body; the import below is a STRING, not a
// real import, and points at a file that does not exist on disk.
const SAMPLE = [
  "import { db } from '../lib/db.server.ts';",
  "export const x = 1;",
];
export default function DocsPage() {
  return \`<pre>\${SAMPLE.join('\\n')}</pre><crisp-workspace></crisp-workspace>\`;
}
`,
  });
  try {
    const violations = await checkConventions(appDir);
    assert.equal(find(violations).length, 0,
      'a server path that only appears in a code-example string must not be flagged (phantom edge, file does not exist)');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// (c) A `.server.ts` importing another `.server.ts` -> no violation.
// Server-to-server is fine; neither file is a component or a route module the
// browser loads, so neither is a candidate.
test('server-to-server import is NOT flagged', async () => {
  const appDir = await makeApp({
    'lib/db.server.ts': `export const db = { query() { return []; } };\n`,
    'lib/auth.server.ts': `import { db } from './db.server.ts';
export async function auth() { return db.query(); }
`,
    // An app/ dir so the rule actually runs, with a page that does not reach
    // either server file.
    'app/page.ts': `export default function Home() { return '<h1>home</h1>'; }\n`,
  });
  try {
    const violations = await checkConventions(appDir);
    assert.equal(find(violations).length, 0, 'a .server.ts importing a .server.ts must not be flagged');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// (d) middleware.ts / route.ts importing server code -> no violation.
// These are server-only entries the browser never loads, so they are not
// candidates even when they import a server module.
test('middleware and route importing server code are NOT flagged', async () => {
  const appDir = await makeApp({
    'lib/auth.server.ts': AUTH_SERVER,
    'app/middleware.ts': `import { auth } from '../lib/auth.server.ts';
export default async function middleware() { await auth(); }
`,
    'app/api/route.ts': `import { auth } from '../../lib/auth.server.ts';
export async function GET() { await auth(); return new Response('ok'); }
`,
    'app/page.ts': `export default function Home() { return '<h1>home</h1>'; }\n`,
  });
  try {
    const violations = await checkConventions(appDir);
    assert.equal(find(violations).length, 0, 'middleware/route importing server code must not be flagged');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// Transitive (indirect) server import through a non-server helper still fires,
// and the chain hint shows the indirection. The page imports a plain helper
// that imports the server module; eliding logic still has the page shipping
// because it also registers a component.
test('indirect server import through a non-server helper IS flagged', async () => {
  const appDir = await makeApp({
    'lib/auth.server.ts': AUTH_SERVER,
    'lib/session.ts': `import { auth } from './auth.server.ts';
export async function currentUser() { return (await auth()).user; }
`,
    'modules/workspace/components/crisp-workspace.ts': INTERACTIVE_COMPONENT,
    'app/project/page.ts': `import { currentUser } from '../../lib/session.ts';
import '../../modules/workspace/components/crisp-workspace.ts';
import '@webjsdev/core/client-router'; // own client work: the page ships whole (#963)
export default async function ProjectPage() {
  const u = await currentUser();
  return \`<crisp-workspace user="\${u}"></crisp-workspace>\`;
}
`,
  });
  try {
    const violations = await checkConventions(appDir);
    const hits = find(violations, 'project/page.ts');
    assert.equal(hits.length, 1, 'an indirect server import must still be flagged');
    assert.ok(hits[0].message.includes('auth.server.ts'), 'names the server module reached transitively');
    // #804: the full chain is printed now, every hop, no `… ->` truncation.
    assert.match(hits[0].message, /app\/project\/page\.ts -> lib\/session\.ts -> lib\/auth\.server\.ts/,
      'message shows the full indirection chain');
    assert.ok(!hits[0].message.includes('…'), 'no truncation glyph in the chain');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// An interactive component that ITSELF imports a server module ships and is
// flagged (the rule covers components, not just pages).
test('a shipping component importing a server module IS flagged', async () => {
  const appDir = await makeApp({
    'lib/auth.server.ts': AUTH_SERVER,
    'components/user-badge.ts': `import { WebComponent } from '@webjsdev/core';
import { signal } from '@webjsdev/core';
import { auth } from '../lib/auth.server.ts';

class UserBadge extends WebComponent {
  static properties = { name: { state: true } };
  declare name: string;
  constructor() { super(); this.name = ''; }
  async connectedCallback() { super.connectedCallback(); this.name = (await auth()).user; }
  render() { return this.html\`<span>\${this.name}</span>\`; }
}
UserBadge.register('user-badge');
`,
    'app/page.ts': `import '../components/user-badge.ts';
export default function Home() { return '<user-badge></user-badge>'; }
`,
  });
  try {
    const violations = await checkConventions(appDir);
    const hits = find(violations, 'user-badge.ts');
    assert.equal(hits.length, 1, 'a shipping component importing a server module must be flagged');
    assert.equal(hits[0].message.includes('component'), true, 'message identifies it as a component');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// error.ts / loading.ts / not-found.ts ALSO ship to the browser, and unlike
// pages + layouts they are never elided (the dev server's
// computeBrowserBoundFiles adds them as browser-bound entries unconditionally;
// only elidable-component imports are ever stripped). So a server-only import
// reaching one of them is a real throw-at-load browser crash the rule must
// catch. A page+layout-only candidate set would miss it (it did: 0 hits before
// this). The fixtures pair each boundary with a sibling page so the router
// attaches it (error/loading attach to a page in the same chain).
test('an error boundary importing a server module IS flagged', async () => {
  const appDir = await makeApp({
    'lib/auth.server.ts': AUTH_SERVER,
    'app/page.ts': `export default function Home() { return '<h1>home</h1>'; }\n`,
    'app/error.ts': `import { auth } from '../lib/auth.server.ts';
export default async function ErrorBoundary() {
  const session = await auth();
  return \`<p>Sorry \${session.user ?? 'guest'}, something broke</p>\`;
}
`,
  });
  try {
    const violations = await checkConventions(appDir);
    const hits = find(violations, 'error.ts');
    assert.equal(hits.length, 1, 'an error boundary that ships and imports a server module must be flagged');
    assert.ok(hits[0].message.includes('auth.server.ts'), 'names the offending server import');
    assert.ok(/error boundary/.test(hits[0].message), 'identifies it as an error boundary');
    // An error boundary always ships and is never elided, so the fix must NOT
    // offer the "register the component in a layout so it elides again" remedy
    // (that path is impossible for a boundary). It may still state the fact that
    // it is never elided; what it must not do is suggest making it elide.
    assert.ok(!/elides again/i.test(hits[0].fix) && !/register that component/i.test(hits[0].fix),
      'a never-elided boundary must not be offered the elide-via-layout remedy');
    assert.ok(/middleware/.test(hits[0].fix) && /use server/.test(hits[0].fix),
      'a boundary fix offers the middleware + use-server remedies');
    // Grammar: never "a error boundary" (wrong article before a vowel sound).
    assert.ok(!/\ba error boundary/.test(hits[0].fix) && !/\ba error boundary/.test(hits[0].message),
      'uses the correct article for "error boundary"');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('a not-found page importing a server module IS flagged', async () => {
  const appDir = await makeApp({
    'lib/auth.server.ts': AUTH_SERVER,
    'app/page.ts': `export default function Home() { return '<h1>home</h1>'; }\n`,
    'app/not-found.ts': `import { auth } from '../lib/auth.server.ts';
export default async function NotFound() {
  const session = await auth();
  return \`<h1>404 for \${session.user ?? 'guest'}</h1>\`;
}
`,
  });
  try {
    const violations = await checkConventions(appDir);
    const hits = find(violations, 'not-found.ts');
    assert.equal(hits.length, 1, 'a personalized not-found page that ships and imports a server module must be flagged');
    assert.ok(hits[0].message.includes('auth.server.ts'), 'names the offending server import');
    assert.ok(/not-found page/.test(hits[0].message), 'identifies it as a not-found page');
    // A not-found page always ships and is never elided, so no "elides again".
    assert.ok(!/elides again/i.test(hits[0].fix) && !/register that component/i.test(hits[0].fix),
      'a never-elided not-found page must not be offered the elide-via-layout remedy');
    assert.ok(/middleware/.test(hits[0].fix) && /use server/.test(hits[0].fix),
      'a not-found fix offers the middleware + use-server remedies');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// forbidden.ts / unauthorized.ts / global-not-found.ts joined the shipping set
// with #1298: they render inside their layout chain now, and ship with it. The
// rule has to see them, or the exact #963 crash it exists to catch (a
// throw-at-load stub taking every sibling registration with it) passes a green
// `webjs check`. A 403 that greets the signed-in user by name is the natural
// shape, so this is not a hypothetical import.
test('a forbidden boundary importing a server module IS flagged (#1298)', async () => {
  const appDir = await makeApp({
    'lib/auth.server.ts': AUTH_SERVER,
    'app/admin/page.ts': `export default function Admin() { return '<h1>admin</h1>'; }\n`,
    'app/admin/forbidden.ts': `import { auth } from '../../lib/auth.server.ts';
export default async function Forbidden() {
  const session = await auth();
  return \`<h1>No access for \${session.user ?? 'guest'}</h1>\`;
}
`,
  });
  try {
    const violations = await checkConventions(appDir);
    const hits = find(violations, 'forbidden.ts');
    assert.equal(hits.length, 1, 'a forbidden boundary that ships and imports a server module must be flagged');
    assert.ok(hits[0].message.includes('auth.server.ts'), 'names the offending server import');
    assert.ok(/forbidden boundary/.test(hits[0].message), 'identifies it as a forbidden boundary');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('an unauthorized boundary importing a server module IS flagged (#1298)', async () => {
  const appDir = await makeApp({
    'lib/auth.server.ts': AUTH_SERVER,
    'app/private/page.ts': `export default function P() { return '<h1>private</h1>'; }\n`,
    'app/private/unauthorized.ts': `import { auth } from '../../lib/auth.server.ts';
export default async function Unauthorized() {
  const session = await auth();
  return \`<h1>Sign in (\${session.user ?? 'guest'})</h1>\`;
}
`,
  });
  try {
    const violations = await checkConventions(appDir);
    const hits = find(violations, 'unauthorized.ts');
    assert.equal(hits.length, 1, 'an unauthorized boundary that ships and imports a server module must be flagged');
    assert.ok(/unauthorized boundary/.test(hits[0].message), 'identifies it as an unauthorized boundary');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('a global-not-found page importing a server module IS flagged (#1298)', async () => {
  const appDir = await makeApp({
    'lib/auth.server.ts': AUTH_SERVER,
    'app/page.ts': `export default function Home() { return '<h1>home</h1>'; }\n`,
    'app/global-not-found.ts': `import { auth } from '../lib/auth.server.ts';
export default async function GlobalNotFound() {
  const session = await auth();
  return \`<h1>404 for \${session.user ?? 'guest'}</h1>\`;
}
`,
  });
  try {
    const violations = await checkConventions(appDir);
    const hits = find(violations, 'global-not-found.ts');
    assert.equal(hits.length, 1, 'a global-not-found page that ships and imports a server module must be flagged');
    assert.ok(/global-not-found page/.test(hits[0].message), 'identifies it as a global-not-found page');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('a loading boundary importing a server module IS flagged', async () => {
  const appDir = await makeApp({
    'lib/auth.server.ts': AUTH_SERVER,
    'app/dashboard/page.ts': `export default function Dash() { return '<h1>dash</h1>'; }\n`,
    'app/dashboard/loading.ts': `import { auth } from '../../lib/auth.server.ts';
export default async function Loading() {
  const session = await auth();
  return \`<p>Loading for \${session.user ?? 'guest'}…</p>\`;
}
`,
  });
  try {
    const violations = await checkConventions(appDir);
    const hits = find(violations, 'loading.ts');
    assert.equal(hits.length, 1, 'a loading boundary that ships and imports a server module must be flagged');
    assert.ok(hits[0].message.includes('auth.server.ts'), 'names the offending server import');
    assert.ok(/loading boundary/.test(hits[0].message), 'identifies it as a loading boundary');
    assert.ok(!/elides again/i.test(hits[0].fix) && !/register that component/i.test(hits[0].fix),
      'a never-elided loading boundary must not be offered the elide-via-layout remedy');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// An error / loading / not-found module that imports only a 'use server' action
// is still exempt (working RPC stub, not a crash) and a phantom string edge from
// such a module is still ignored: the new candidates honor the same guards as
// pages and components.
test('an error boundary importing only a use-server action is NOT flagged', async () => {
  const appDir = await makeApp({
    'modules/log/actions/report.server.ts': `'use server';
export async function report(input: { msg: string }) { return { ok: true, msg: input.msg }; }
`,
    'app/page.ts': `export default function Home() { return '<h1>home</h1>'; }\n`,
    'app/error.ts': `import { report } from '../modules/log/actions/report.server.ts';
export default async function ErrorBoundary() {
  await report({ msg: 'boom' });
  return '<p>handled</p>';
}
`,
  });
  try {
    const violations = await checkConventions(appDir);
    assert.equal(find(violations).length, 0,
      'an error boundary calling a use-server action (working RPC stub) must not be flagged');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// A code-example `import` written as a plain quoted STRING whose path resolves
// to a REAL in-repo `.server.ts` must NOT create a graph edge and must NOT be
// flagged. This is the live false-positive webjs's own docs / website pages hit:
// a shipping page that shows `import { db } from '…lib/db.server.ts'` in
// a code sample, where that path is a real file. The module-graph scanner now
// masks string-embedded imports (blankStrings), so the string never becomes an
// edge; a REAL import statement to the same file still does.
test('a real-path server import inside a code-example string is NOT flagged', async () => {
  const appDir = await makeApp({
    // A REAL server file the example string names.
    'lib/db.server.ts': `export const db = { user: { findMany() { return []; } } };\n`,
    'modules/workspace/components/crisp-workspace.ts': INTERACTIVE_COMPONENT,
    // A shipping page (registers a component) that shows the import in a STRING.
    'app/docs/page.ts': `import '../../modules/workspace/components/crisp-workspace.ts';
const SAMPLE = "import { db } from '../../lib/db.server.ts';";
export default function DocsPage() {
  return \`<pre>\${SAMPLE}</pre><crisp-workspace></crisp-workspace>\`;
}
`,
  });
  try {
    const violations = await checkConventions(appDir);
    assert.equal(find(violations).length, 0,
      'a server path shown in a code-example string (even a real file) must not create an edge or be flagged');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// The counterpart to the case above: the SAME real server file, imported as a
// genuine top-level statement (not inside a string) on a shipping page, still
// flags. This proves the string mask did not over-blank real imports.
test('a real server import statement on a shipping page IS still flagged', async () => {
  const appDir = await makeApp({
    'lib/db.server.ts': `export const db = { user: { findMany() { return []; } } };\n`,
    'modules/workspace/components/crisp-workspace.ts': INTERACTIVE_COMPONENT,
    'app/docs/page.ts': `import { db } from '../../lib/db.server.ts';
import '../../modules/workspace/components/crisp-workspace.ts';
import '@webjsdev/core/client-router'; // own client work: the page ships whole (#963)
export default async function DocsPage() {
  const users = db.user.findMany();
  return \`<crisp-workspace count="\${users.length}"></crisp-workspace>\`;
}
`,
  });
  try {
    const violations = await checkConventions(appDir);
    const hits = find(violations, 'docs/page.ts');
    assert.equal(hits.length, 1, 'a real server import statement on a shipping page must still be flagged');
    assert.ok(hits[0].message.includes('db.server.ts'), 'names the real server import');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// With elision disabled (webjs.elide === false), EVERY module ships, so even a
// display-only page importing a server module is flagged: with elision off the
// page really does ship its server import. This guards the elide-flag wiring.
test('with elision disabled, a display-only page importing auth IS flagged', async () => {
  const appDir = await makeApp({
    'package.json': JSON.stringify({ name: 'app', webjs: { elide: false } }),
    'lib/auth.server.ts': AUTH_SERVER,
    'app/dashboard/page.ts': `import { auth } from '../../lib/auth.server.ts';
export default async function DashboardPage() {
  const session = await auth();
  return \`<h1>Hello \${session.user ?? 'guest'}</h1>\`;
}
`,
  });
  try {
    const violations = await checkConventions(appDir);
    assert.equal(find(violations, 'dashboard/page.ts').length, 1,
      'with elision off, a display-only page that imports a server module ships it and is flagged');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// A page with no app/-routable structure (no app/ dir) is not analysed: the
// rule degrades to a no-op rather than throwing or flagging a bare lib.
test('an app with no app/ directory is not analysed', async () => {
  const appDir = await makeApp({
    'lib/auth.server.ts': AUTH_SERVER,
    'lib/helper.ts': `import { auth } from './auth.server.ts';\nexport const x = auth;\n`,
  });
  try {
    const violations = await checkConventions(appDir);
    assert.equal(find(violations).length, 0, 'no app/ dir means nothing ships, so no finding');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// SECURITY COUNTERFACTUAL (#555): a server-only `.server.ts` imported via a
// `#` PATH ALIAS into a shipping module must STILL be flagged. The whole risk
// of an import alias is that it could launder a server import past the boundary
// (resolveImport historically skipped any non-`.`/`/` specifier). The alias is
// expanded to the real path inside resolveImport, so the rule sees through it.
test('a server import via a # alias into a shipping page IS flagged (alias does not launder the boundary)', async () => {
  const appDir = await makeApp({
    'package.json': JSON.stringify({ name: 'x', type: 'module', imports: { '#*': './*' } }),
    'lib/auth.server.ts': AUTH_SERVER,
    'modules/workspace/components/crisp-workspace.ts': INTERACTIVE_COMPONENT,
    'app/project/page.ts': `import { auth } from '#lib/auth.server.ts';
import '#modules/workspace/components/crisp-workspace.ts';
import '@webjsdev/core/client-router'; // own client work: the page ships whole (#963)
export default async function ProjectPage() {
  const session = await auth();
  return \`<crisp-workspace></crisp-workspace>\`;
}
`,
  });
  try {
    const violations = await checkConventions(appDir);
    const hits = find(violations, 'project/page.ts');
    assert.equal(hits.length, 1, 'a #-aliased server import into a shipping page must still be flagged');
    assert.ok(hits[0].message.includes('auth.server.ts'), 'names the real server file behind the alias');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// The complement: a #-aliased server import into an ELIDED display-only page is
// NOT flagged (the framework strips it), proving the alias resolves through to
// the SAME elision verdict a relative import gets, not a blanket pass/fail.
test('a # alias server import into an elided display-only page is NOT flagged', async () => {
  const appDir = await makeApp({
    'package.json': JSON.stringify({ name: 'x', type: 'module', imports: { '#*': './*' } }),
    'lib/auth.server.ts': AUTH_SERVER,
    'app/dashboard/page.ts': `import { auth } from '#lib/auth.server.ts';
export default async function DashboardPage() {
  const session = await auth();
  return \`<h1>Hello \${session.user ?? 'guest'}</h1>\`;
}
`,
  });
  try {
    const violations = await checkConventions(appDir);
    assert.equal(find(violations).length, 0, 'an elided display-only page is not flagged, alias or not');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// #805: a TYPE-ONLY import of a `.server.ts` from a SHIPPING module is fully
// erased by the TS stripper (module.stripTypeScriptTypes), so it never becomes a
// browser fetch or a runtime crash. It must NOT be flagged. Three independent
// agents hit this false positive writing `import type { Todo } from
// '#db/schema.server.ts'` in a shipping component: the greppable source confirms
// the import is safe, yet the check fired, sending them into a needless
// `types.ts`-duplication rewrite. The component ships (reactive `signal` import),
// so this is NOT an elision pass, it is the type-only edge being correctly
// dropped from the module graph.
test('a TYPE-ONLY import of a server module from a shipping component is NOT flagged (#805)', async () => {
  const appDir = await makeApp({
    'db/schema.server.ts': `export type Todo = { id: number; title: string; completed: boolean };
export const todos = { findMany() { return []; } };
`,
    'components/todo-list.ts': `import { WebComponent } from '@webjsdev/core';
import { signal } from '@webjsdev/core';
import type { Todo } from '../db/schema.server.ts';

class TodoList extends WebComponent {
  static properties = { items: { state: true } };
  declare items: Todo[];
  constructor() { super(); this.items = []; }
  render() { return this.html\`<ul>\${this.items.length}</ul>\`; }
}
TodoList.register('todo-list');
`,
    'app/page.ts': `import '../components/todo-list.ts';
export default function Home() { return '<todo-list></todo-list>'; }
`,
  });
  try {
    const violations = await checkConventions(appDir);
    assert.equal(find(violations).length, 0,
      'a type-only import is erased at strip time and must not be flagged as a server import');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// The counterpart proving the #805 fix did not OVER-skip: a MIXED
// `import { type Todo, todos }` pulls a real runtime binding (`todos`), so it is
// a genuine value edge to the server module and MUST still fire. The statement
// does not lead with `type`, so the graph keeps it.
test('a MIXED value+type import of a server module on a shipping component IS still flagged (#805)', async () => {
  const appDir = await makeApp({
    'db/schema.server.ts': `export type Todo = { id: number };
export const todos = { findMany() { return []; } };
`,
    'components/todo-list.ts': `import { WebComponent } from '@webjsdev/core';
import { signal } from '@webjsdev/core';
import { type Todo, todos } from '../db/schema.server.ts';

class TodoList extends WebComponent {
  static properties = { items: { state: true } };
  declare items: Todo[];
  constructor() { super(); this.items = todos.findMany(); }
  render() { return this.html\`<ul>\${this.items.length}</ul>\`; }
}
TodoList.register('todo-list');
`,
    'app/page.ts': `import '../components/todo-list.ts';
export default function Home() { return '<todo-list></todo-list>'; }
`,
  });
  try {
    const violations = await checkConventions(appDir);
    const hits = find(violations, 'todo-list.ts');
    assert.equal(hits.length, 1, 'a mixed value+type import is a real runtime edge and must still be flagged');
    assert.ok(hits[0].message.includes('schema.server.ts'), 'names the server import');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

// #804: the message must print the FULL transitive chain (every hop), not a
// `… ->` truncation, and name the types-module relocation fix when the edge
// enters via a types-shaped module.
test('message prints the full import chain and names the types-module fix (#804)', async () => {
  const dir = await makeApp({
    'app/layout.ts': `import { html } from '@webjsdev/core';\nexport default function L({ children }) { return html\`<div>\${children}</div>\`; }\n`,
    'app/page.ts': `import { html } from '@webjsdev/core';\nimport '@webjsdev/core/client-router';\nimport './widget.ts';\nimport { thing } from '../modules/todos/types.ts';\nexport default function P() { return html\`<my-widget></my-widget>\${thing}\`; }\n`,
    'app/widget.ts': INTERACTIVE_COMPONENT.replace('crisp-workspace', 'my-widget').replace('CrispWorkspace', 'MyWidget'),
    'modules/todos/types.ts': `export { thing } from '../../lib/data.server.ts';\n`,
    'lib/data.server.ts': `export const thing = 'x';\n`,
  });
  try {
    const violations = await checkConventions(dir);
    const v = find(violations, 'app/page.ts')[0];
    assert.ok(v, 'the shipping page importing a server value via types.ts is flagged');
    // full chain: every hop present, no truncation glyph
    assert.match(v.message, /app\/page\.ts -> modules\/todos\/types\.ts -> lib\/data\.server\.ts/, `full chain, got: ${v.message}`);
    assert.ok(!v.message.includes('…'), 'no `… ->` truncation in the chain');
    assert.match(v.fix, /types-shaped module/, 'the fix names the types-module relocation');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
