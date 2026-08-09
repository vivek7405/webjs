/**
 * Smoke tests for the read-only `webjs mcp` server (#262).
 *
 * `runMcpServer({ stdin, stdout, stderr, cwd })` is driven IN-PROCESS with
 * PassThrough streams for determinism (no spawned process). We assert the MCP
 * stdio handshake + the four tools:
 *   - `initialize` returns serverInfo + capabilities + protocolVersion.
 *   - `notifications/initialized` (a notification, no id) gets NO reply.
 *   - `tools/list` returns the four tools, each with an inputSchema.
 *   - `tools/call` for `check` returns a content array whose text parses to
 *     `{ violations, summary }`; for `list_routes` returns the route projection.
 *   - the server MUTATES NOTHING (read-only).
 *   - a MALFORMED line is answered with a JSON-RPC parse error and does NOT
 *     crash the loop (a following valid request still works).
 *   - stdout carries ONLY JSON-RPC frames (protocol purity).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..', '..');
const { runMcpServer, extractExportNames, extractRouteMethods, extractActionConfig, loadUiDeps } = await import(
  resolve(REPO, 'packages', 'mcp', 'src', 'mcp.js')
);

const cleanup = [];
after(() => { for (const d of cleanup) rmSync(d, { recursive: true, force: true }); });

function tmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-'));
  cleanup.push(dir);
  return dir;
}
function write(dir, rel, content) {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** Recursively list every file path (relative) under a dir, sorted. */
function listFiles(dir, base = dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) listFiles(full, base, out);
    else out.push(resolve(full).slice(base.length));
  }
  return out.sort();
}

/**
 * Drive the MCP server with a list of request objects (one per line). Returns
 * the parsed response frames (in order) plus the raw stdout text.
 */
async function driveMcp(cwd, requests, { rawLines = [] } = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  let outBuf = '';
  stdout.on('data', (c) => { outBuf += c.toString(); });

  const done = runMcpServer({ stdin, stdout, stderr, cwd, version: '9.9.9' });

  // Write each request as one newline-delimited JSON line, plus any raw lines.
  for (const line of rawLines) stdin.write(line + '\n');
  for (const req of requests) stdin.write(JSON.stringify(req) + '\n');
  stdin.end();

  await done;

  const frames = outBuf
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  return { frames, raw: outBuf };
}

test('mcp: initialize handshake returns serverInfo + capabilities', async () => {
  const dir = tmpDir();
  write(dir, 'app/page.ts', `export default function P() {}\n`);
  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  ]);
  assert.equal(frames.length, 1);
  const r = frames[0];
  assert.equal(r.id, 1);
  assert.equal(r.result.protocolVersion, '2024-11-05');
  assert.deepEqual(r.result.capabilities, { tools: {}, resources: {}, prompts: {} });
  assert.deepEqual(r.result.serverInfo, { name: 'webjs', version: '9.9.9' });
});

test('mcp: notifications/initialized gets NO response', async () => {
  const dir = tmpDir();
  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]);
  // Only the tools/list reply, the notification produced nothing.
  assert.equal(frames.length, 1);
  assert.equal(frames[0].id, 2);
});

test('mcp: tools/list returns the introspection + knowledge tools with inputSchemas', async () => {
  const dir = tmpDir();
  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 3, method: 'tools/list' },
  ]);
  const tools = frames[0].result.tools;
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['check', 'docs', 'init', 'list_actions', 'list_components', 'list_elision', 'list_routes', 'source', 'ui']);
  for (const t of tools) {
    assert.equal(typeof t.description, 'string');
    assert.equal(t.inputSchema.type, 'object');
  }
  // The introspection tools take appDir; init takes nothing; docs takes topic/query.
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.ok(byName.list_routes.inputSchema.properties.appDir, 'introspection tool declares appDir');
  assert.deepEqual(byName.init.inputSchema.properties, {}, 'init takes no args');
  assert.ok(byName.docs.inputSchema.properties.topic && byName.docs.inputSchema.properties.query, 'docs takes topic/query');
  assert.ok(byName.source.inputSchema.properties.path && byName.source.inputSchema.properties.query, 'source takes path/query/package');
  assert.ok(byName.ui.inputSchema.properties.name, 'ui takes an optional component name');
});

test('mcp: tools/call check returns a content array parsing to { violations, summary }', async () => {
  const dir = tmpDir();
  // Trip a violation so the report is non-trivial.
  write(
    dir,
    'components/broken.ts',
    `import { WebComponent, html } from '@webjsdev/core';\n` +
    `export class Broken extends WebComponent { render() { return html\`<p>x</p>\`; } }\n`,
  );
  const before = listFiles(dir);
  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'check', arguments: {} } },
  ]);
  const content = frames[0].result.content;
  assert.ok(Array.isArray(content));
  assert.equal(content[0].type, 'text');
  const report = JSON.parse(content[0].text);
  assert.ok(Array.isArray(report.violations));
  assert.ok(report.violations.length > 0);
  assert.equal(typeof report.summary.count, 'number');
  assert.equal(report.summary.count, report.violations.length);
  // Read-only: the tool did not write / delete anything.
  assert.deepEqual(listFiles(dir), before, 'check mutated nothing');
});

test('mcp: tools/call list_routes returns the route projection', async () => {
  const dir = tmpDir();
  write(dir, 'app/page.ts', `export default function P() {}\n`);
  write(dir, 'app/blog/[slug]/page.ts', `export default function B() {}\n`);
  write(dir, 'app/api/users/route.ts', `export async function GET() {}\nexport async function POST() {}\n`);
  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_routes', arguments: {} } },
  ]);
  const out = JSON.parse(frames[0].result.content[0].text);
  const paths = out.pages.map((p) => p.path).sort();
  assert.ok(paths.includes('/'), 'root page present');
  assert.ok(paths.includes('/blog/[slug]'), 'dynamic page present');
  const dyn = out.pages.find((p) => p.path === '/blog/[slug]');
  assert.equal(dyn.dynamic, true);
  assert.deepEqual(dyn.params, ['slug']);
  // API route with its methods.
  const api = out.apis.find((a) => a.path === '/api/users');
  assert.ok(api, 'api route present');
  assert.deepEqual(api.methods.sort(), ['GET', 'POST']);
});

test('mcp: list_routes output equals the shared projectRoutes (no drift with the CLI)', async () => {
  // The MCP tool and `webjs routes --json` both project through
  // routes-report.js, so the tool output MUST equal projectRoutes over the same
  // app. This locks the shared-projector guarantee (#975): if the MCP tool ever
  // stops delegating to projectRoutes, this fails.
  const { projectRoutes } = await import(resolve(REPO, 'packages', 'mcp', 'src', 'routes-report.js'));
  const { buildRouteTable } = await import('@webjsdev/server');
  const { readFile } = await import('node:fs/promises');
  const dir = tmpDir();
  write(dir, 'app/page.ts', `export default function P() {}\n`);
  write(dir, 'app/blog/[slug]/page.ts', `export default function B() {}\n`);
  write(dir, 'app/api/users/route.ts', `export async function GET() {}\nexport async function POST() {}\n`);

  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'list_routes', arguments: {} } },
  ]);
  const toolOut = JSON.parse(frames[0].result.content[0].text);
  const expected = await projectRoutes(await buildRouteTable(dir), { appDir: dir, readFile, extractRouteMethods });
  assert.deepEqual(toolOut, expected);
});

test('mcp: tools/call list_actions reports file + fn + RPC endpoint', async () => {
  const dir = tmpDir();
  write(
    dir,
    'modules/posts/actions/create.server.ts',
    `'use server';\nexport async function createPost(input) { return { success: true }; }\n`,
  );
  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'list_actions', arguments: {} } },
  ]);
  const actions = JSON.parse(frames[0].result.content[0].text);
  const a = actions.find((x) => x.fn === 'createPost');
  assert.ok(a, 'createPost action listed');
  assert.match(a.file, /create\.server\.ts$/);
  assert.match(a.endpoint, /^\/__webjs\/action\/[0-9a-f]+\/createPost$/);
});

test('mcp: tools/call list_components reports tag + file + className', async () => {
  const dir = tmpDir();
  write(
    dir,
    'components/my-thing.ts',
    `import { WebComponent, html } from '@webjsdev/core';\n` +
    `export class MyThing extends WebComponent { render() { return html\`<p>x</p>\`; } }\n` +
    `MyThing.register('my-thing');\n`,
  );
  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'list_components', arguments: {} } },
  ]);
  const comps = JSON.parse(frames[0].result.content[0].text);
  const c = comps.find((x) => x.tag === 'my-thing');
  assert.ok(c, 'my-thing component listed');
  assert.equal(c.className, 'MyThing');
  assert.match(c.file, /my-thing\.ts$/);
});

test('mcp: list_elision output equals analyzeAppElision (no drift with the CLI)', async () => {
  // `list_elision` returns the report VERBATIM, and `webjs elision --json`
  // prints the same object, so the two surfaces cannot disagree about an app.
  // Unlike list_routes there is no projector leaf to delegate to, which makes
  // this equality the only thing holding the contract together.
  const { analyzeAppElision } = await import('@webjsdev/server');
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x', type: 'module' }));
  write(dir, 'components/badge.ts',
    `import { WebComponent, html } from '@webjsdev/core';\n` +
    `export class Badge extends WebComponent { render() { return html\`<span>x</span>\`; } }\n` +
    `Badge.register('my-badge');\n`);
  write(dir, 'app/page.ts',
    `import { html } from '@webjsdev/core';\nimport '../components/badge.ts';\nexport default () => html\`<my-badge></my-badge>\`;\n`);

  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'list_elision', arguments: {} } },
  ]);
  const toolOut = JSON.parse(frames[0].result.content[0].text);
  assert.deepEqual(toolOut, JSON.parse(JSON.stringify(await analyzeAppElision(dir))));
  const badge = toolOut.components.find((c) => c.file.includes('badge'));
  assert.equal(badge.verdict, 'elided', 'the display-only badge is never downloaded');
});

test('mcp: list_components stays a cheap lexical inventory (no elision fields)', async () => {
  // The guard for the rejected alternative: growing an `elided` flag onto
  // list_components would silently turn a scan that loads no module and builds
  // no graph into one that does both, and it still could not carry the route
  // verdicts or the orphans. The elision verdict lives in its own tool.
  const dir = tmpDir();
  write(dir, 'components/my-thing.ts',
    `import { WebComponent, html } from '@webjsdev/core';\n` +
    `export class MyThing extends WebComponent { render() { return html\`<p>x</p>\`; } }\n` +
    `MyThing.register('my-thing');\n`);
  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'list_components', arguments: {} } },
  ]);
  const comps = JSON.parse(frames[0].result.content[0].text);
  assert.deepEqual(Object.keys(comps[0]).sort(), ['className', 'file', 'tag']);
});

test('mcp: unknown method -> JSON-RPC -32601', async () => {
  const dir = tmpDir();
  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 8, method: 'no/such/method' },
  ]);
  assert.equal(frames[0].error.code, -32601);
});

test('mcp: unknown tool -> JSON-RPC error', async () => {
  const dir = tmpDir();
  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'nope', arguments: {} } },
  ]);
  assert.equal(frames[0].error.code, -32602);
});

test('mcp: a malformed line yields a parse error and does NOT crash the loop', async () => {
  const dir = tmpDir();
  write(dir, 'app/page.ts', `export default function P() {}\n`);
  // A junk line first, then a valid request: both must be answered.
  const { frames } = await driveMcp(
    dir,
    [{ jsonrpc: '2.0', id: 11, method: 'tools/list' }],
    { rawLines: ['this is not json {{{'] },
  );
  // First frame: parse error (id null). Second: the valid tools/list reply.
  const parseErr = frames.find((f) => f.error && f.error.code === -32700);
  assert.ok(parseErr, 'a -32700 parse error was emitted');
  const listReply = frames.find((f) => f.id === 11);
  assert.ok(listReply && listReply.result.tools, 'valid request still served after junk');
});

test('mcp: stdout carries only JSON-RPC frames (protocol purity)', async () => {
  const dir = tmpDir();
  write(dir, 'app/page.ts', `export default function P() {}\n`);
  const { raw } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 12, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 13, method: 'tools/list' },
  ]);
  for (const line of raw.split('\n').filter((l) => l.trim())) {
    const f = JSON.parse(line); // throws if any non-JSON leaked to stdout
    assert.equal(f.jsonrpc, '2.0');
  }
});

test('extractExportNames: recognises decl, default, and named exports', () => {
  const src = `
    export async function createPost() {}
    export const listPosts = async () => {};
    export function helper() {}
    export default function Page() {}
    const a = 1, b = 2;
    export { a, b as renamed };
  `;
  const names = extractExportNames(src);
  assert.ok(names.includes('createPost'));
  assert.ok(names.includes('listPosts'));
  assert.ok(names.includes('helper'));
  assert.ok(names.includes('default'));
  assert.ok(names.includes('a'));
  assert.ok(names.includes('renamed'), 'the EXPORTED name of an alias');
  assert.ok(!names.includes('b'), 'the local name of an alias is not the export');
});

test('extractRouteMethods: only exported HTTP method names', () => {
  const src = `export async function GET() {}\nexport async function POST() {}\nexport function helper() {}\n`;
  assert.deepEqual(extractRouteMethods(src).sort(), ['GET', 'POST']);
});

test('mcp: a falsy id (0) and a string id are echoed, not dropped', async () => {
  const dir = tmpDir();
  write(dir, 'app/page.ts', `export default function P() {}\n`);
  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 0, method: 'tools/list' },
    { jsonrpc: '2.0', id: 'abc', method: 'tools/list' },
  ]);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].id, 0, 'a 0 id must be echoed (no falsy drop)');
  assert.equal(frames[1].id, 'abc', 'a string id must be echoed');
});

/* ---------------- source tool (#378): read the framework's own source ---------------- */

test('mcp: tools/call source reads/greps/lists the framework source (driven against the monorepo)', async () => {
  // Drive with cwd = the repo so @webjsdev/* resolves to the workspace packages.
  // no-args -> the package listing
  let { frames } = await driveMcp(REPO, [
    { jsonrpc: '2.0', id: 40, method: 'tools/call', params: { name: 'source', arguments: {} } },
  ]);
  let text = frames[0].result.content[0].text;
  assert.match(text, /@webjsdev\/server\/src:/, 'lists the server source dir');
  assert.match(text, /buildless|authored source/i, 'frames it as the real authored source');

  // path -> read a real source file
  ({ frames } = await driveMcp(REPO, [
    { jsonrpc: '2.0', id: 41, method: 'tools/call', params: { name: 'source', arguments: { path: 'server/src/check.js' } } },
  ]));
  text = frames[0].result.content[0].text;
  assert.ok(text.length > 200 && /export/.test(text), 'returns the real check.js source');

  // query -> grep with pkg-qualified hits
  ({ frames } = await driveMcp(REPO, [
    { jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name: 'source', arguments: { query: 'renderToString' } } },
  ]));
  assert.match(frames[0].result.content[0].text, /\[@webjsdev\/[a-z-]+\/src\/[^\]]+:\d+\]/, 'grep hits carry pkg + file:line');

  // traversal is refused, not read
  ({ frames } = await driveMcp(REPO, [
    { jsonrpc: '2.0', id: 43, method: 'tools/call', params: { name: 'source', arguments: { path: 'server/../../../etc/passwd' } } },
  ]));
  assert.match(frames[0].result.content[0].text, /Refusing to read outside/, 'traversal guard holds end to end');

  // the built core browser bundle (dist/) is NOT readable; only authored src/
  ({ frames } = await driveMcp(REPO, [
    { jsonrpc: '2.0', id: 44, method: 'tools/call', params: { name: 'source', arguments: { path: 'core/dist/webjs-core-browser.js' } } },
  ]));
  assert.match(frames[0].result.content[0].text, /Refusing to read outside/, 'dist (built bundle) not exposed, only src');
});

/* ---------------- the ui tool (#983): kit inventory + drift-guard ---------------- */

test('mcp: tools/call ui returns the kit inventory and matches the shared extractor (drift-guard)', async () => {
  // The ui tool projects @webjsdev/ui/registry/extract, the SAME leaf webjsui
  // view renders. Assert the tool output IS that projection, so the CLI and MCP
  // cannot drift (the #979 shared-projector pattern applied to the kit).
  const { uiInventory, uiComponent } = await import('@webjsdev/ui/registry/extract');
  const dir = tmpDir();
  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 60, method: 'tools/call', params: { name: 'ui', arguments: {} } },
    { jsonrpc: '2.0', id: 61, method: 'tools/call', params: { name: 'ui', arguments: { name: 'accordion' } } },
    { jsonrpc: '2.0', id: 62, method: 'tools/call', params: { name: 'ui', arguments: { name: 'not-a-component' } } },
  ]);

  const inv = JSON.parse(frames.find((f) => f.id === 60).result.content[0].text);
  assert.deepEqual(inv.inventory, uiInventory(), 'inventory matches the shared extractor');
  assert.ok(inv.inventory.some((c) => c.name === 'button' && c.tier === 1));
  assert.ok(inv.inventory.some((c) => c.name === 'dialog' && c.tier === 2));

  const acc = JSON.parse(frames.find((f) => f.id === 61).result.content[0].text);
  assert.deepEqual(acc, uiComponent('accordion'), 'per-component payload matches the shared extractor');
  assert.ok(acc.helpers.length >= 4, 'accordion helper signatures are projected');

  const err = frames.find((f) => f.id === 62);
  assert.ok(err.result.isError, 'an unknown component is a tool error, not a crash');
});

test('loadUiDeps: a failing import (version skew / missing subpath) degrades to throwing stubs, does not reject', async () => {
  // This drives the REAL guard: the importer rejects (as it would when the
  // ./registry/extract subpath is missing), and loadUiDeps must resolve to a
  // stub whose functions throw a clear error, NOT reject (which would sink the
  // whole server at bootstrap).
  const deps = await loadUiDeps(async () => { throw new Error('Cannot find package @webjsdev/ui'); });
  assert.equal(typeof deps.uiInventory, 'function');
  assert.throws(() => deps.uiInventory(), /@webjsdev\/ui is not available/);
  assert.throws(() => deps.uiComponent('button'), /@webjsdev\/ui is not available/);
  // The happy path passes the module's exports through unchanged.
  const ok = await loadUiDeps(async () => ({ uiInventory: () => 'INV', uiComponent: () => 'C' }));
  assert.equal(ok.uiInventory(), 'INV');
});

test('mcp: throwing ui deps degrade only the ui tool, the server stays up', async () => {
  // With the ui deps unavailable (stubs that throw, as loadUiDeps returns on a
  // skew), the ui tool must report an error while the rest of the server (here
  // list_routes) still answers. Complements the loadUiDeps guard test above.
  const dir = tmpDir();
  write(dir, 'app/page.ts', 'export default function P() {}\n');
  const throwing = () => { throw new Error('@webjsdev/ui is not available'); };
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let outBuf = '';
  stdout.on('data', (c) => { outBuf += c.toString(); });
  const done = runMcpServer({
    stdin, stdout, stderr, cwd: dir, version: '9.9.9',
    uiDeps: { uiInventory: throwing, uiComponent: throwing },
  });
  stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 70, method: 'tools/call', params: { name: 'ui', arguments: {} } }) + '\n');
  stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 71, method: 'tools/call', params: { name: 'list_routes', arguments: {} } }) + '\n');
  stdin.end();
  await done;
  const frames = outBuf.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const uiFrame = frames.find((f) => f.id === 70);
  assert.ok(uiFrame.result.isError, 'the ui tool reports an error when the kit is unavailable');
  const routesFrame = frames.find((f) => f.id === 71);
  assert.ok(!routesFrame.result.isError, 'list_routes still works');
  assert.ok(Array.isArray(JSON.parse(routesFrame.result.content[0].text).pages), 'list_routes returns the route projection');
});

/* ---------------- knowledge layer (#376): init / docs / resources / prompts ---------------- */

test('mcp: tools/call init returns the read-first primer (NOT-React mental model + invariants)', async () => {
  const dir = tmpDir();
  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'init', arguments: {} } },
  ]);
  const text = frames[0].result.content[0].text;
  assert.equal(typeof text, 'string');
  assert.match(text, /read first/i);
  assert.match(text, /NO RSC/, 'steers away from the React/RSC mental model');
  assert.match(text, /Invariants/, 'includes the invariants section sourced from AGENTS.md');
  assert.match(text, /webjs-docs:\/\//, 'lists the doc resources');
});

test('mcp: tools/call docs returns a topic, a query search, and the index', async () => {
  const dir = tmpDir();
  // topic
  let { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'docs', arguments: { topic: 'recipes' } } },
  ]);
  assert.match(frames[0].result.content[0].text, /recipe|page|action|component/i, 'topic returns the recipes doc');
  // query
  ({ frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 22, method: 'tools/call', params: { name: 'docs', arguments: { query: 'signal' } } },
  ]));
  assert.match(frames[0].result.content[0].text, /webjs-docs:\/\//, 'query returns hits tagged with their source URI');
  // no args -> index
  ({ frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 23, method: 'tools/call', params: { name: 'docs', arguments: {} } },
  ]));
  assert.match(frames[0].result.content[0].text, /topics/i, 'no args returns the topic index');
  // unknown topic fails soft (no crash, a helpful message)
  ({ frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 24, method: 'tools/call', params: { name: 'docs', arguments: { topic: 'does-not-exist' } } },
  ]));
  assert.match(frames[0].result.content[0].text, /Unknown topic/, 'unknown topic returns a message, not an error frame');
});

test('mcp: resources/list + resources/read serve the framework docs; unknown uri errors cleanly', async () => {
  const dir = tmpDir();
  let { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 25, method: 'resources/list' },
  ]);
  const resources = frames[0].result.resources;
  assert.ok(Array.isArray(resources) && resources.length >= 5, 'a corpus of resources');
  assert.ok(resources.some((r) => r.uri === 'webjs-docs://AGENTS'), 'the AGENTS contract is a resource');
  assert.ok(resources.some((r) => r.uri === 'webjs-docs://components'), 'the skill references are resources');
  for (const r of resources) assert.equal(r.mimeType, 'text/markdown');

  // read one
  ({ frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 26, method: 'resources/read', params: { uri: 'webjs-docs://components' } },
  ]));
  const contents = frames[0].result.contents;
  assert.equal(contents[0].uri, 'webjs-docs://components');
  assert.equal(contents[0].mimeType, 'text/markdown');
  assert.ok(contents[0].text.length > 100, 'returns the doc text');

  // unknown uri -> JSON-RPC error, loop survives
  ({ frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 27, method: 'resources/read', params: { uri: 'webjs-docs://nope' } },
    { jsonrpc: '2.0', id: 28, method: 'resources/list' },
  ]));
  assert.equal(frames[0].error.code, -32602, 'unknown resource is a -32602');
  assert.ok(frames[1].result.resources, 'the loop kept serving after the error');
});

/** An app dir carrying its own installed @webjsdev/mcp corpus, stamped and seeded. */
function appWithCorpus(sentinel, version) {
  const dir = tmpDir();
  const res = join('node_modules', '@webjsdev', 'mcp', 'resources');
  write(dir, join(res, 'references', 'components.md'), `# Components\n\n${sentinel}\n`);
  write(dir, join(res, 'AGENTS.md'), `# AGENTS\n\n## Execution model\n\n${sentinel}\n\n## Invariants\n\n1. ${sentinel}\n`);
  write(dir, join(res, 'SKILL.md'), `# SKILL\n\n${sentinel}\n`);
  write(dir, join(res, 'corpus.json'), JSON.stringify({ package: '@webjsdev/mcp', version, sha: null, copiedAt: '2026-08-08T00:00:00.000Z' }));
  write(dir, join('node_modules', '@webjsdev', 'mcp', 'package.json'), JSON.stringify({ name: '@webjsdev/mcp', version }));
  return dir;
}

test("mcp: the docs corpus follows appDir, so an app's own installed copy wins over the server's", async () => {
  // The #1319 incident: a global server keeps serving the snapshot it was
  // published with, and contradicts the corpus sitting in the app's own
  // node_modules. The app's copy is version-matched to the framework the agent
  // is editing, so it is the one that can be right about that app.
  const other = appWithCorpus('SENTINEL_OTHER_APP', '9.9.9');
  const here = appWithCorpus('SENTINEL_CWD_APP', '9.9.9');

  let { frames } = await driveMcp(here, [
    { jsonrpc: '2.0', id: 80, method: 'tools/call', params: { name: 'docs', arguments: { topic: 'components', appDir: other } } },
    { jsonrpc: '2.0', id: 81, method: 'tools/call', params: { name: 'docs', arguments: { topic: 'components' } } },
  ]);
  assert.match(frames[0].result.content[0].text, /SENTINEL_OTHER_APP/, 'an explicit appDir reads that app');
  assert.match(frames[1].result.content[0].text, /SENTINEL_CWD_APP/, 'no appDir defaults to cwd');

  // resources/* carry no appDir in the MCP protocol, so they resolve from cwd,
  // which is exactly what a no-appDir tools/call defaults to. The two surfaces
  // therefore agree whenever appDir does.
  ({ frames } = await driveMcp(here, [
    { jsonrpc: '2.0', id: 82, method: 'resources/read', params: { uri: 'webjs-docs://components' } },
  ]));
  assert.match(frames[0].result.contents[0].text, /SENTINEL_CWD_APP/, 'resources/read reads the cwd corpus');

  // init reports which corpus it served, and its body comes from that same one.
  ({ frames } = await driveMcp(here, [
    { jsonrpc: '2.0', id: 83, method: 'tools/call', params: { name: 'init', arguments: {} } },
  ]));
  const primer = frames[0].result.content[0].text;
  assert.match(primer, /Docs corpus: @webjsdev\/mcp@9\.9\.9, copied on 2026-08-08\./, 'names the corpus it served');
  assert.match(primer, /SENTINEL_CWD_APP/, 'and the primer body came from that same corpus');
  // App and server are both 9.9.9 here, so there is nothing to warn about.
  assert.ok(!/Warning:/.test(primer), 'equal versions stay silent');
});

test('mcp: init warns when the app has a newer @webjsdev/mcp than the running server', async () => {
  // driveMcp pins the server at 9.9.9, so an app on 10.0.0 is the stale-server case.
  const newer = appWithCorpus('SENTINEL_NEWER', '10.0.0');
  const { frames } = await driveMcp(newer, [
    { jsonrpc: '2.0', id: 84, method: 'tools/call', params: { name: 'init', arguments: {} } },
  ]);
  const primer = frames[0].result.content[0].text;
  assert.match(primer, /Warning: this MCP server is @webjsdev\/mcp@9\.9\.9, but this app has @webjsdev\/mcp@10\.0\.0\./);
  assert.match(primer, /npm i -g @webjsdev\/mcp@latest/, 'says how to fix the stale install');
  // Advisory, never a refusal: the corpus rung already pointed at the app's docs.
  assert.match(primer, /SENTINEL_NEWER/, 'still answers, with the app corpus');
});

test('mcp: an injected docsDeps still wins for every appDir', async () => {
  // The seam every pre-existing knowledge-layer test relies on: injection must
  // short-circuit the per-appDir resolution entirely.
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '';
  stdout.on('data', (c) => { out += c.toString(); });
  const docsDeps = {
    docsDir: '/docs',
    agentsPath: '/AGENTS.md',
    skillPath: '/SKILL.md',
    corpusPath: null,
    listDir: (d) => (d === '/docs' ? ['components.md'] : []),
    exists: (p) => p === '/AGENTS.md' || p === '/docs',
    readFile: async () => '# injected\n\nSENTINEL_INJECTED\n',
  };
  const app = appWithCorpus('SENTINEL_ON_DISK', '10.0.0');
  const done = runMcpServer({ stdin, stdout, stderr, cwd: app, version: '9.9.9', docsDeps });
  stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 85, method: 'tools/call', params: { name: 'docs', arguments: { topic: 'components', appDir: app } } }) + '\n');
  stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 86, method: 'resources/read', params: { uri: 'webjs-docs://components' } }) + '\n');
  stdin.end();
  await done;

  const frames = out.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  assert.match(frames[0].result.content[0].text, /SENTINEL_INJECTED/, 'injection beats an explicit appDir');
  assert.match(frames[1].result.contents[0].text, /SENTINEL_INJECTED/, 'and beats the cwd resolution too');
  assert.ok(!/SENTINEL_ON_DISK/.test(out), 'the on-disk corpus was never consulted');
});

test('mcp: prompts/list + prompts/get serve the recipe workflows; unknown prompt errors cleanly', async () => {
  const dir = tmpDir();
  let { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 29, method: 'prompts/list' },
  ]);
  const prompts = frames[0].result.prompts;
  const names = prompts.map((p) => p.name).sort();
  assert.deepEqual(names, ['add_component', 'add_dynamic_route', 'add_module', 'add_page', 'add_server_action', 'fetch_data_in_component']);

  // get one, with an argument folded in
  ({ frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 30, method: 'prompts/get', params: { name: 'add_component', arguments: { tag: 'my-thing' } } },
  ]));
  const got = frames[0].result;
  assert.equal(typeof got.description, 'string');
  assert.equal(got.messages[0].role, 'user');
  assert.match(got.messages[0].content.text, /my-thing/, 'the provided arg is folded in');
  assert.match(got.messages[0].content.text, /register|signal|WebComponent/, 'carries the component recipe');

  // unknown prompt -> error, loop survives
  ({ frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 31, method: 'prompts/get', params: { name: 'nope' } },
    { jsonrpc: '2.0', id: 32, method: 'prompts/list' },
  ]));
  assert.equal(frames[0].error.code, -32602, 'unknown prompt is a -32602');
  assert.ok(frames[1].result.prompts, 'the loop kept serving after the error');
});

/* ---------- extractActionConfig unit tests (#488) ---------- */

test('extractActionConfig: GET action with cache + tags reports correct config', () => {
  const src = `
    'use server';
    export const method = 'GET';
    export const cache = 60;
    export const tags = (id) => [\`user:\${id}\`];
    export async function getUser(id) { return {}; }
  `;
  const cfg = extractActionConfig(src);
  assert.equal(cfg.method, 'GET');
  assert.equal(cfg.cache, '60');
  assert.equal(cfg.tags, true);
  assert.equal(cfg.invalidates, false);
  assert.equal(cfg.validate, false);
  assert.equal(cfg.middleware, false);
});

test('extractActionConfig: object cache value is captured across lines', () => {
  const src = `
    'use server';
    export const method = 'GET';
    export const cache = { maxAge: 300, swr: 60, public: true };
    export async function getPosts() { return []; }
  `;
  const cfg = extractActionConfig(src);
  assert.equal(cfg.method, 'GET');
  assert.ok(cfg.cache && cfg.cache.startsWith('{') && cfg.cache.endsWith('}'), 'object cache captured');
  assert.ok(cfg.cache.includes('maxAge'), 'object cache includes maxAge');
});

test('extractActionConfig: POST mutation with invalidates', () => {
  const src = `
    'use server';
    export const invalidates = (id) => [\`user:\${id}\`];
    export async function updateUser(input) { return { success: true }; }
  `;
  const cfg = extractActionConfig(src);
  assert.equal(cfg.method, 'POST');
  assert.equal(cfg.cache, null);
  assert.equal(cfg.tags, false);
  assert.equal(cfg.invalidates, true);
  assert.equal(cfg.validate, false);
  assert.equal(cfg.middleware, false);
});

test('extractActionConfig: plain legacy action has POST + all config flags false', () => {
  const src = `
    'use server';
    export async function createPost(input) { return { success: true }; }
  `;
  const cfg = extractActionConfig(src);
  assert.equal(cfg.method, 'POST');
  assert.equal(cfg.cache, null);
  assert.equal(cfg.tags, false);
  assert.equal(cfg.invalidates, false);
  assert.equal(cfg.validate, false);
  assert.equal(cfg.middleware, false);
});

test('extractActionConfig: validate + middleware flags', () => {
  const src = `
    'use server';
    export const validate = (input) => ({ success: true });
    export const middleware = [authMw, logMw];
    export async function doThing(input) { return { success: true }; }
  `;
  const cfg = extractActionConfig(src);
  assert.equal(cfg.validate, true);
  assert.equal(cfg.middleware, true);
});

test('extractActionConfig: unrecognized method falls back to POST', () => {
  const src = `
    'use server';
    export const method = 'OPTIONS';
    export async function doThing() {}
  `;
  const cfg = extractActionConfig(src);
  assert.equal(cfg.method, 'POST', 'unrecognized verb defaults to POST');
});

test('extractActionConfig: method with double-quote and uppercase matches', () => {
  const src = `
    'use server';
    export const method = "DELETE";
    export async function removeItem(id) {}
  `;
  const cfg = extractActionConfig(src);
  assert.equal(cfg.method, 'DELETE');
});

/* ---------- list_actions: config fields + config exports excluded (#488) ---------- */

test('mcp: list_actions GET action reports method/cache/tags and excludes config exports', async () => {
  const dir = tmpDir();
  write(
    dir,
    'modules/users/queries/get-user.server.ts',
    [
      `'use server';`,
      `export const method = 'GET';`,
      `export const cache = 60;`,
      `export const tags = (id) => [\`user:\${id}\`];`,
      `export async function getUser(id) { return {}; }`,
    ].join('\n') + '\n',
  );
  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 50, method: 'tools/call', params: { name: 'list_actions', arguments: {} } },
  ]);
  const actions = JSON.parse(frames[0].result.content[0].text);

  // Only the callable function is listed; config exports are NOT actions.
  const fns = actions.map((a) => a.fn);
  assert.ok(fns.includes('getUser'), 'getUser is listed');
  assert.ok(!fns.includes('method'), 'method config export is NOT listed as an action');
  assert.ok(!fns.includes('cache'), 'cache config export is NOT listed as an action');
  assert.ok(!fns.includes('tags'), 'tags config export is NOT listed as an action');

  const a = actions.find((x) => x.fn === 'getUser');
  assert.ok(a, 'getUser action found');
  assert.equal(a.method, 'GET');
  assert.equal(a.cache, '60');
  assert.equal(a.tags, true);
  assert.equal(a.invalidates, false);
  assert.equal(a.validate, false);
  assert.equal(a.middleware, false);
  assert.match(a.endpoint, /^\/__webjs\/action\/[0-9a-f]+\/getUser$/);
});

test('mcp: list_actions POST mutation with invalidates reports correct config', async () => {
  const dir = tmpDir();
  write(
    dir,
    'modules/users/actions/update-user.server.ts',
    [
      `'use server';`,
      `export const invalidates = (id) => [\`user:\${id}\`];`,
      `export async function updateUser(input) { return { success: true }; }`,
    ].join('\n') + '\n',
  );
  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 51, method: 'tools/call', params: { name: 'list_actions', arguments: {} } },
  ]);
  const actions = JSON.parse(frames[0].result.content[0].text);
  const a = actions.find((x) => x.fn === 'updateUser');
  assert.ok(a, 'updateUser action found');
  assert.equal(a.method, 'POST');
  assert.equal(a.cache, null);
  assert.equal(a.invalidates, true);

  // invalidates config export must NOT appear as a separate action.
  const fns = actions.map((x) => x.fn);
  assert.ok(!fns.includes('invalidates'), 'invalidates config export is NOT listed as an action');
});

test('mcp: list_actions legacy action (no config) reports POST and all config flags false/null', async () => {
  const dir = tmpDir();
  write(
    dir,
    'modules/posts/actions/create.server.ts',
    `'use server';\nexport async function createPost(input) { return { success: true }; }\n`,
  );
  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 52, method: 'tools/call', params: { name: 'list_actions', arguments: {} } },
  ]);
  const actions = JSON.parse(frames[0].result.content[0].text);
  const a = actions.find((x) => x.fn === 'createPost');
  assert.ok(a, 'createPost action found');
  assert.equal(a.method, 'POST');
  assert.equal(a.cache, null);
  assert.equal(a.tags, false);
  assert.equal(a.invalidates, false);
  assert.equal(a.validate, false);
  assert.equal(a.middleware, false);
});

/* ---------- drift guard: MCP local copies match action-config.js ---------- */

test('drift guard: MCP RESERVED_CONFIG and RPC_VERBS match action-config.js exports', async () => {
  const actionConfigPath = resolve(REPO, 'packages', 'server', 'src', 'action-config.js');
  const { RESERVED_CONFIG: srcReserved, RPC_VERBS: srcVerbs } = await import(actionConfigPath);

  // Re-read the MCP source to extract the local set literals lexically.
  // The simplest approach: import the module and introspect via extractActionConfig
  // coverage. But the sets are module-private constants. Test via behavior: verify
  // that every entry in the authoritative sets is handled the same way by
  // extractActionConfig (config names are not listed as actions, verbs are recognized).

  // Verify all RPC_VERBS from action-config.js are recognized by extractActionConfig.
  for (const verb of srcVerbs) {
    const src = `'use server';\nexport const method = '${verb}';\nexport async function fn() {}\n`;
    const cfg = extractActionConfig(src);
    assert.equal(cfg.method, verb, `RPC verb ${verb} must be recognized by extractActionConfig`);
  }

  // Verify EVERY RESERVED_CONFIG name from action-config.js is excluded from the
  // callable-action list by the REAL list_actions runner. A reserved name added
  // to action-config.js but missing from the MCP's local set would surface here
  // as a wrongly-listed action (each reserved name is declared as a function-
  // valued const, the shape that would otherwise count as a callable action).
  const reservedDecls = [...srcReserved].map((name) =>
    name === 'middleware' ? `export const ${name} = [];` : `export const ${name} = () => [];`,
  ).join('\n');
  // First confirm the lexical extractor SEES them all (so the filter is the gate,
  // not a parse miss), then confirm the runner excludes them.
  const probe = `'use server';\n${reservedDecls}\nexport async function myAction() {}\n`;
  const names = extractExportNames(probe);
  for (const name of srcReserved) {
    assert.ok(names.includes(name), `reserved name '${name}' must be visible to extractExportNames`);
  }
  const dir = tmpDir();
  write(dir, 'modules/x/cfg.server.ts', probe);
  const { frames } = await driveMcp(dir, [
    { jsonrpc: '2.0', id: 77, method: 'tools/call', params: { name: 'list_actions', arguments: {} } },
  ]);
  const listed = JSON.parse(frames[0].result.content[0].text).map((a) => a.fn);
  assert.deepEqual(listed, ['myAction'], 'only the callable action is listed; every reserved config name is excluded');
  for (const name of srcReserved) {
    assert.ok(!listed.includes(name), `reserved name '${name}' must be excluded from the action list (MCP RESERVED_CONFIG drift)`);
  }
});

test('mcp: a request split across stdin chunks (mid-line) still parses', async () => {
  const dir = tmpDir();
  write(dir, 'app/page.ts', `export default function P() {}\n`);
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '';
  stdout.on('data', (c) => { out += c.toString(); });
  const done = runMcpServer({ stdin, stdout, stderr, cwd: dir, version: '9.9.9' });
  // Write a single JSON-RPC request in TWO chunks split mid-line. A line-based
  // reader must buffer until the newline rather than parsing each chunk.
  stdin.write('{"jsonrpc":"2.0","id":7,"method":"too');
  await new Promise((r) => setTimeout(r, 10));
  stdin.write('ls/list"}\n');
  stdin.end();
  await done;
  const frames = out.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].id, 7, 'the chunk-split request parsed once the full line arrived');
  assert.ok(frames[0].result.tools, 'and dispatched correctly');
});
