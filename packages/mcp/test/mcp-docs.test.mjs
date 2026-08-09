/**
 * Unit tests for the MCP knowledge layer's PURE functions (#376):
 * `mcp-docs.js`. Everything is driven with INJECTED deps (an in-memory corpus),
 * so these never touch the real filesystem and prove the logic independent of
 * the dispatch/transport tested in `mcp.test.mjs`.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..', '..');
const {
  catalogue,
  listResources,
  readResource,
  sectionByHeading,
  initText,
  searchDocs,
  getPrompt,
  PROMPTS,
  resolveDocsLocation,
  compareVersions,
  readAppMcpVersion,
} = await import(resolve(REPO, 'packages', 'mcp', 'src', 'mcp-docs.js'));
const { bundleDocs, readGitSha } = await import(resolve(REPO, 'packages', 'mcp', 'scripts', 'copy-mcp-resources.js'));
const { cleanBundle } = await import(resolve(REPO, 'packages', 'mcp', 'scripts', 'clean-mcp-resources.js'));

const _cleanup = [];
after(() => { for (const d of _cleanup) rmSync(d, { recursive: true, force: true }); });

/** An in-memory corpus: a fake docsDir + AGENTS.md, no real fs. */
function fixture() {
  const files = {
    '/docs/components.md': '# Components\n\nUse signals.\n',
    '/docs/recipes.md': '# Recipes\n\n## Add a page\n\nexport default fn.\n',
    '/AGENTS.md':
      '# AGENTS\n\n' +
      '## Execution model\n\nNo RSC. Components hydrate, pages do not.\n\n' +
      '## Public API\n\nhtml, css.\n\n' +
      '## Invariants\n\n1. Server-only code in .server files.\n2. Tags need a hyphen.\n\n' +
      '## Scaffolding\n\nuse webjs create.\n',
  };
  return {
    docsDir: '/docs',
    agentsPath: '/AGENTS.md',
    listDir: (d) => (d === '/docs' ? ['components.md', 'recipes.md'] : []),
    exists: (p) => p in files,
    readFile: async (p) => {
      if (!(p in files)) throw new Error('ENOENT ' + p);
      return files[p];
    },
  };
}

test('catalogue: AGENTS first, then SKILL, then the references, each with a webjs-docs:// uri', () => {
  const cat = catalogue(fixture());
  assert.deepEqual(cat.map((d) => d.name), ['AGENTS', 'components', 'recipes']);
  assert.equal(cat[0].uri, 'webjs-docs://AGENTS');
  assert.equal(cat[1].uri, 'webjs-docs://components');
});

test('listResources: descriptors carry uri, name, title, markdown mime', () => {
  const res = listResources(fixture());
  assert.ok(res.every((r) => r.uri.startsWith('webjs-docs://') && r.mimeType === 'text/markdown' && r.name && r.title));
});

test('readResource: returns the doc text; unknown uri throws', async () => {
  const deps = fixture();
  const r = await readResource(deps, 'webjs-docs://components');
  assert.match(r.text, /Use signals/);
  await assert.rejects(() => readResource(deps, 'webjs-docs://nope'), /Unknown resource/);
});

test('sectionByHeading: extracts a section up to the next same-level heading', () => {
  const md = fixture().readFile;
  // Use a literal to avoid awaiting; mirror the AGENTS fixture body.
  const agents =
    '## Execution model\n\nNo RSC here.\n\n## Invariants\n\n1. one\n2. two\n\n## Next\n\nx\n';
  const exec = sectionByHeading(agents, /^##\s+Execution model/im);
  assert.match(exec, /^## Execution model/);
  assert.match(exec, /No RSC here/);
  assert.ok(!exec.includes('Invariants'), 'stops at the next ## heading');
  const inv = sectionByHeading(agents, /^##\s+Invariants/im);
  assert.match(inv, /1\. one/);
  assert.ok(!inv.includes('Next'), 'stops at the following heading');
  // Counterfactual: a missing heading yields ''.
  assert.equal(sectionByHeading(agents, /^##\s+Nonexistent/im), '');
  void md;
});

test('initText: sources Execution model + Invariants from AGENTS, steers off React, lists resources', async () => {
  const text = await initText(fixture());
  assert.match(text, /No RSC/, 'pulls the execution-model section');
  assert.match(text, /Server-only code in \.server files/, 'pulls the invariants section');
  assert.match(text, /NOT React\/Next/, 'explicit anti-React steer in the router');
  assert.match(text, /webjs-docs:\/\/components/, 'lists the corpus');
});

test('searchDocs: topic returns the doc, query returns tagged hits, no-args returns the index', async () => {
  const deps = fixture();
  assert.match(await searchDocs(deps, { topic: 'components' }), /Use signals/);
  assert.match(await searchDocs(deps, { topic: 'AGENTS' }), /Execution model/);
  const hits = await searchDocs(deps, { query: 'signals' });
  assert.match(hits, /\[webjs-docs:\/\/components\]/, 'a hit is tagged with its source uri');
  assert.match(await searchDocs(deps, {}), /topics/i);
  assert.match(await searchDocs(deps, { topic: 'missing' }), /Unknown topic/);
  assert.match(await searchDocs(deps, { query: 'zzzznotfound' }), /No matches/);
});

function bigCorpus(matchCount) {
  const many = Array.from({ length: matchCount }, (_, i) => `signal line ${i}`).join('\n');
  return {
    docsDir: '/docs',
    agentsPath: '/AGENTS.md',
    listDir: () => ['big.md'],
    exists: () => false,
    readFile: async () => `# Big\n\n${many}\n`,
  };
}

test('searchDocs: > 40 matches caps AND discloses the truncation (no silent cap)', async () => {
  const out = await searchDocs(bigCorpus(60), { query: 'signal line' });
  const lines = out.split('\n');
  // 40 hits + the disclosure line.
  assert.equal(lines.length, 41, 'caps the hit list at 40 plus the disclosure');
  assert.match(out, /truncated at 40 matches/, 'discloses the cap rather than silently dropping');
});

test('searchDocs: EXACTLY 40 matches does NOT claim truncation (boundary)', async () => {
  const out = await searchDocs(bigCorpus(40), { query: 'signal line' });
  assert.equal(out.split('\n').length, 40, '40 hits, no disclosure line');
  assert.ok(!/truncated/.test(out), 'nothing was dropped, so no truncation notice');
});

test('resolveDocsLocation: prefers the bundled resources/, falls back to the repo-root skill', () => {
  // Build a fake package layout: <root>/packages/mcp/src (the module location),
  // <root>/.agents/skills/webjs (the dev fallback), <root>/packages/mcp/resources (bundled).
  const root = mkdtempSync(join(tmpdir(), 'mcp-resolve-'));
  _cleanup.push(root);
  const srcDir = join(root, 'packages', 'mcp', 'src');
  const bundled = join(root, 'packages', 'mcp', 'resources', 'references');
  const skill = join(root, '.agents', 'skills', 'webjs');
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(join(skill, 'references'), { recursive: true });
  writeFileSync(join(root, 'AGENTS.md'), '# root\n');
  const moduleUrl = pathToFileURL(join(srcDir, 'mcp-docs.js')).href;

  // No bundle yet -> dev fallback to the repo-root skill references + SKILL.md + AGENTS.md.
  let loc = resolveDocsLocation(moduleUrl);
  assert.equal(loc.docsDir, join(skill, 'references'), 'falls back to the repo-root skill references');
  assert.equal(loc.agentsPath, join(root, 'AGENTS.md'));
  assert.equal(loc.skillPath, join(skill, 'SKILL.md'), 'exposes the SKILL.md path');

  // Bundle present -> the published path wins.
  mkdirSync(bundled, { recursive: true });
  writeFileSync(join(root, 'packages', 'mcp', 'resources', 'AGENTS.md'), '# bundled\n');
  loc = resolveDocsLocation(moduleUrl);
  assert.equal(loc.docsDir, bundled, 'prefers the bundled resources/references');
  assert.equal(loc.agentsPath, join(root, 'packages', 'mcp', 'resources', 'AGENTS.md'));
  assert.equal(loc.skillPath, join(root, 'packages', 'mcp', 'resources', 'SKILL.md'));
});

test('bundleDocs + cleanBundle: copy bundles references + SKILL + AGENTS, clean removes it (temp dirs only)', () => {
  // Operate entirely in a throwaway layout, NEVER the real packages/mcp/resources
  // (which would race the integration tests reading the live corpus).
  const root = mkdtempSync(join(tmpdir(), 'mcp-bundle-'));
  _cleanup.push(root);
  const srcRefs = join(root, 'src', 'references');
  const srcAgents = join(root, 'src', 'AGENTS.md');
  const srcSkill = join(root, 'src', 'SKILL.md');
  const destRoot = join(root, 'pkg', 'resources');
  mkdirSync(srcRefs, { recursive: true });
  writeFileSync(join(srcRefs, 'components.md'), '# Components\n');
  writeFileSync(join(srcRefs, 'testing.md'), '# Testing\n');
  writeFileSync(srcAgents, '# AGENTS\n');
  writeFileSync(srcSkill, '# SKILL\n');

  bundleDocs({ srcRefs, srcAgents, srcSkill, destRoot });
  assert.ok(existsSync(join(destRoot, 'AGENTS.md')), 'AGENTS.md bundled');
  assert.ok(existsSync(join(destRoot, 'SKILL.md')), 'SKILL.md bundled');
  assert.deepEqual(readdirSync(join(destRoot, 'references')).sort(), ['components.md', 'testing.md'], 'references bundled');

  // A re-bundle with a removed source reference must not leave the old one behind.
  rmSync(join(srcRefs, 'testing.md'));
  bundleDocs({ srcRefs, srcAgents, srcSkill, destRoot });
  assert.deepEqual(readdirSync(join(destRoot, 'references')), ['components.md'], 'stale reference cleaned on re-bundle');

  cleanBundle(destRoot);
  assert.ok(!existsSync(destRoot), 'cleanBundle removed the transient bundle');
});

/** The throwaway source layout the stamp tests bundle from. Never the real package. */
function bundleFixture() {
  const root = mkdtempSync(join(tmpdir(), 'mcp-stamp-'));
  _cleanup.push(root);
  const srcRefs = join(root, 'src', 'references');
  mkdirSync(srcRefs, { recursive: true });
  writeFileSync(join(srcRefs, 'components.md'), '# Components\n');
  const srcAgents = join(root, 'src', 'AGENTS.md');
  const srcSkill = join(root, 'src', 'SKILL.md');
  writeFileSync(srcAgents, '# AGENTS\n');
  writeFileSync(srcSkill, '# SKILL\n');
  return { srcRefs, srcAgents, srcSkill, destRoot: join(root, 'pkg', 'resources') };
}

test('bundleDocs: a stamp is written as parseable JSON beside AGENTS.md, and omitted when none is passed', () => {
  const paths = bundleFixture();
  const stamp = {
    package: '@webjsdev/mcp',
    version: '9.9.9',
    sha: 'a'.repeat(40),
    copiedAt: '2026-08-08T00:00:00.000Z',
  };

  bundleDocs({ ...paths, stamp });
  const stampPath = join(paths.destRoot, 'corpus.json');
  assert.ok(existsSync(stampPath), 'corpus.json written');
  const parsed = JSON.parse(readFileSync(stampPath, 'utf8'));
  assert.deepEqual(parsed, stamp, 'round-trips through JSON unchanged');
  assert.equal(typeof parsed.package, 'string');
  assert.equal(typeof parsed.version, 'string');
  assert.equal(typeof parsed.sha, 'string');
  assert.equal(typeof parsed.copiedAt, 'string');
  // Build metadata, not a doc: it sits beside AGENTS.md so `catalogue()` (which
  // lists only *.md under references/) can never surface it as a readable doc.
  assert.ok(!existsSync(join(paths.destRoot, 'references', 'corpus.json')));

  // Every pre-existing caller passes no stamp, so that branch must stay a no-op.
  bundleDocs(paths);
  assert.ok(!existsSync(stampPath), 'no stamp written when none is passed');
});

test('cleanBundle: the stamp goes with the tree, no separate unlink owed', () => {
  const paths = bundleFixture();
  bundleDocs({ ...paths, stamp: { package: '@webjsdev/mcp', version: '9.9.9', sha: null, copiedAt: 'x' } });
  const stampPath = join(paths.destRoot, 'corpus.json');
  assert.ok(existsSync(stampPath));

  cleanBundle(paths.destRoot);
  assert.ok(!existsSync(stampPath), 'stamp removed');
  assert.ok(!existsSync(paths.destRoot), 'bundle removed');
});

test('readGitSha: answers for a checkout root only, against the real git binary', () => {
  // The repo root IS its own git toplevel, which is the shape prepack runs in.
  const sha = readGitSha(REPO);
  assert.match(sha, /^[0-9a-f]{40}$/, 'resolves HEAD at a checkout root');

  // A fresh temp dir is outside any checkout (git either errors, or on a machine
  // with no git at all spawnSync returns an error object). Either way: null.
  const outside = mkdtempSync(join(tmpdir(), 'mcp-nogit-'));
  _cleanup.push(outside);
  assert.equal(readGitSha(outside), null, 'no SHA outside a checkout, and no throw');

  // The guard that a temp dir cannot prove: `rev-parse` walks UP, so a directory
  // that merely SITS inside a checkout gets an answer from its ancestor. A
  // subdirectory of this repo stands in for an extracted tarball unpacked inside
  // an unrelated checkout, whose HEAD is not the commit these docs came from.
  assert.equal(readGitSha(join(REPO, 'packages')), null, 'a nested dir does not borrow its ancestor HEAD');
});

test('readGitSha: each guard is exercised on its own, through the injected spawn', () => {
  // The real binary reaches only some of these branches, so the rest would be
  // lines no test can red. `--show-toplevel HEAD` prints the root then the SHA.
  const spawnOf = (result) => () => {
    if (result instanceof Error) throw result;
    return result;
  };
  const ok = 'b'.repeat(40);
  const at = (top, sha) => ({ status: 0, stdout: `${top}\n${sha}\n` });
  const root = mkdtempSync(join(tmpdir(), 'mcp-top-'));
  _cleanup.push(root);

  assert.equal(readGitSha(root, spawnOf(at(root, ok))), ok, 'trims a clean SHA at a matching toplevel');
  assert.equal(readGitSha(root, spawnOf({ status: 128, stdout: `${root}\n${ok}\n` })), null, 'non-zero status wins over parseable output');
  assert.equal(readGitSha(root, spawnOf(at(root, 'fatal: not a git repository'))), null, 'exit 0 with prose is not a SHA');
  assert.equal(readGitSha(root, spawnOf(at(root, ok.slice(0, 7)))), null, 'an abbreviated SHA is rejected');
  assert.equal(readGitSha(root, spawnOf(at(root, 'B'.repeat(40)))), null, 'uppercase is not the git output shape');
  assert.equal(readGitSha(root, spawnOf(at(join(root, '..'), ok))), null, 'an ancestor toplevel is rejected, SHA shape notwithstanding');
  assert.equal(readGitSha(root, spawnOf({ status: 0, stdout: ok + '\n' })), null, 'a lone SHA with no toplevel line is rejected');
  assert.equal(readGitSha(root, spawnOf({ status: 0, stdout: undefined })), null, 'no stdout, e.g. a spawn error object');
  assert.equal(readGitSha(root, spawnOf(null)), null, 'a spawn that returns nothing');
  assert.equal(readGitSha(root, spawnOf(new Error('spawn EACCES'))), null, 'a throwing spawn is swallowed');
});

test('the stamp lands inside the published files allowlist', () => {
  // Asserted by inspection rather than by packing: `npm pack` would run prepack
  // against the REAL packages/mcp/resources in a repo several agents share, and
  // postpack does not run when a pack fails, so a failed run leaves a stale
  // bundle shadowing the live repo-root skill (clean-mcp-resources.js:4-8).
  const pkg = JSON.parse(readFileSync(join(REPO, 'packages', 'mcp', 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('resources'), 'resources/ is published');

  // The other half: the stamp is written INTO that directory. `main()` sets
  // destRoot to join(pkgRoot, 'resources'), and bundleDocs writes corpus.json at
  // destRoot's top level, which the two assertions below pin together.
  const paths = bundleFixture();
  bundleDocs({ ...paths, stamp: { package: '@webjsdev/mcp', version: '9.9.9', sha: null, copiedAt: 'x' } });
  assert.ok(existsSync(join(paths.destRoot, 'corpus.json')), 'written at the destRoot top level');
  const script = readFileSync(join(REPO, 'packages', 'mcp', 'scripts', 'copy-mcp-resources.js'), 'utf8');
  assert.match(script, /destRoot: join\(pkgRoot, 'resources'\)/, "main() bundles into the package's resources/");
});

/**
 * A fixture whose `init` output can be driven over the corpus stamp and the
 * version pair. `corpus` is the raw corpus.json TEXT (so a malformed stamp is
 * expressible), `undefined` meaning the file is absent and throws ENOENT.
 */
function stampFixture({ corpusPath = '/corpus.json', corpus, appMcp, serverVersion, appDir = '/app', corpusSource = 'app' } = {}) {
  const base = fixture();
  const files = {};
  if (corpus !== undefined) files[corpusPath] = corpus;
  const manifest = join(appDir, 'node_modules', '@webjsdev', 'mcp', 'package.json');
  if (appMcp !== undefined) files[manifest] = appMcp;
  return {
    ...base,
    corpusPath,
    corpusSource,
    appDir,
    serverVersion,
    exists: (p) => base.exists(p) || p in files,
    readFile: async (p) => {
      if (p in files) return files[p];
      return base.readFile(p, 'utf8');
    },
  };
}

const STAMP = (over = {}) =>
  JSON.stringify({
    package: '@webjsdev/mcp',
    version: '0.1.12',
    sha: 'e5806e24' + '0'.repeat(32),
    copiedAt: '2026-08-08T09:14:22.031Z',
    ...over,
  });

test('initText: a stamped corpus is reported with its version, short sha, and date', async () => {
  const out = await initText(stampFixture({ corpus: STAMP() }));
  assert.match(out, /Docs corpus: @webjsdev\/mcp@0\.1\.12, copied from webjsdev\/webjs e5806e2 on 2026-08-08\./);
  // Provenance sits above the orientation, so it is read before the docs are.
  assert.ok(out.indexOf('Docs corpus:') < out.indexOf('You are about to write'), 'corpus line precedes the router');
});

test('initText: a dev checkout says so rather than claiming a snapshot it does not have', async () => {
  const out = await initText(stampFixture({ corpusPath: null }));
  assert.match(out, /Docs corpus: not a bundled snapshot; this server resolved the repo-root docs locally\./);
  assert.ok(!/@webjsdev\/mcp@/.test(out), 'no version is claimed for an unstamped live checkout');
});

test('initText: an absent, malformed, or versionless stamp degrades and never throws', async () => {
  for (const corpus of [undefined, 'not json at all', '{"package":"@webjsdev/mcp"}']) {
    const out = await initText(stampFixture({ corpus }));
    assert.match(out, /Docs corpus: an unstamped @webjsdev\/mcp bundled snapshot\./, `degraded for ${String(corpus)}`);
    assert.match(out, /## Invariants/, 'the rest of the primer still renders');
  }
});

test('initText: a stamp with no sha keeps the version and date, and claims no commit', async () => {
  const out = await initText(stampFixture({ corpus: STAMP({ sha: null }) }));
  assert.match(out, /Docs corpus: @webjsdev\/mcp@0\.1\.12, copied on 2026-08-08\./);
  assert.ok(!/copied from/.test(out), 'no commit is claimed when none was captured');
});

test('initText: warns only when the app has a strictly newer @webjsdev/mcp than the server', async () => {
  const run = (appMcp, serverVersion) => initText(stampFixture({ corpus: STAMP(), appMcp, serverVersion }));
  const warned = /Warning: this MCP server is @webjsdev\/mcp@0\.1\.4, but this app has @webjsdev\/mcp@0\.1\.12, so the server may be stale\./;

  const out = await run('{"version":"0.1.12"}', '0.1.4');
  assert.match(out, warned, 'a newer app copy is the stale-server case this exists for');
  assert.ok(out.indexOf('Warning:') < out.indexOf('Docs corpus:'), 'the warning sits above the corpus line');

  // The remedy names every way this server can be started, because nothing here
  // can observe which one it was. A global-only remedy would be wrong for both
  // shipped configurations (an `npx` invocation and the CLI subcommand).
  assert.match(out, /npm i -g @webjsdev\/mcp@latest/, 'the global install');
  assert.match(out, /the package cache behind npx @webjsdev\/mcp/, 'the npx package cache');
  assert.match(out, /@webjsdev\/cli when the server is started/, 'the CLI dependency');

  for (const [appMcp, server, why] of [
    ['{"version":"0.1.4"}', '0.1.4', 'equal versions are not a defect'],
    ['{"version":"0.1.4"}', '0.1.12', 'a newer global server reading an older app is the normal dev shape'],
    [undefined, '0.1.4', 'no app install to compare'],
    ['{ not json', '0.1.4', 'an unparseable app manifest'],
    ['{"name":"@webjsdev/mcp"}', '0.1.4', 'an app manifest with no version'],
    ['{"version":"0.1.12"}', undefined, 'no server version to compare'],
    ['{"version":"0.1.12"}', '0.0.0', 'the unknown-version sentinel is not "older than everything"'],
  ]) {
    assert.ok(!/Warning:/.test(await run(appMcp, server)), why);
  }
});

test('initText: the warning says which corpus was actually served, never a claim the corpus line contradicts', async () => {
  // The warning's probe is the app's package.json; the corpus rung's probe is
  // that install's resources/references. They can disagree: a workspace-linked
  // install has a manifest but no bundled corpus, so the docs fall through to
  // the server's own older snapshot while the version compare still fires.
  const served = (corpusSource) =>
    initText(stampFixture({ corpus: STAMP({ version: '0.1.4' }), appMcp: '{"version":"0.1.12"}', serverVersion: '0.1.4', corpusSource }));

  const fellThrough = await served('bundled');
  assert.match(fellThrough, /Warning: this MCP server is @webjsdev\/mcp@0\.1\.4/);
  assert.match(fellThrough, /The docs below are the server's own older snapshot, not this app's copy\./);
  assert.ok(!/come from this app's own copy/.test(fellThrough), 'never claims the app corpus it did not serve');

  const fromApp = await served('app');
  assert.match(fromApp, /The docs below come from this app's own copy, so they match it/);
  assert.ok(!/older snapshot/.test(fromApp), 'and does not disown a corpus it did serve');

  // The dev rung is the third value, and it needs its own clause: a monorepo
  // server pointed at an app with a newer mcp is serving LIVE repo-root docs,
  // which the corpus line calls a checkout, so calling them a server snapshot
  // here would reintroduce the contradiction one rung over.
  const fromRepo = await initText(
    stampFixture({ corpusPath: null, appMcp: '{"version":"0.1.12"}', serverVersion: '0.1.4', corpusSource: 'repo' }),
  );
  assert.match(fromRepo, /The docs below are whatever this server resolved locally, not this app's copy\./);
  assert.match(fromRepo, /Docs corpus: not a bundled snapshot/, 'and the corpus line agrees with it');
  assert.ok(!/older snapshot/.test(fromRepo), 'an unbundled resolve is not the server\'s stale snapshot');
  // Rung 3 is a fallback, not a checkout probe, so neither line may assert that a
  // checkout IS what was served: a published install with no bundled resources/
  // lands here too, with no checkout and an empty corpus. Offering the checkout
  // as one of four places to update is fine, since that is a suggestion.
  assert.ok(!/this checkout's/.test(fromRepo), 'the served clause claims no checkout');
  assert.ok(!/in this checkout/.test(fromRepo), 'and neither does the corpus line');
  assert.match(fromRepo, /or the checkout it runs from\./, 'but the remedy still offers it');

  // An unexpected corpusSource must reach the fallback, INCLUDING one that
  // collides with an Object.prototype member. Keyed on an object literal those
  // resolve to a truthy function, so the fallback never fires and the warning
  // splices native-code source into its own text.
  // `null` rather than `undefined` for the absent case, since the fixture's own
  // destructuring default would swallow `undefined` and hand back 'app'.
  for (const bogus of [null, '', 'nonsense', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    const out = await initText(
      stampFixture({ corpus: STAMP(), appMcp: '{"version":"0.1.12"}', serverVersion: '0.1.4', corpusSource: bogus }),
    );
    assert.match(out, /The docs below may not be this app's copy\./, `fallback for ${String(bogus)}`);
    assert.ok(!/native code|function /.test(out), `no prototype member leaked for ${String(bogus)}`);
  }
});

test('compareVersions: coarse by design, and total over the shapes npm produces', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('0.1.12', '0.1.4'), 1, 'numeric, not lexicographic');
  assert.equal(compareVersions('0.1.4', '0.1.12'), -1);
  assert.equal(compareVersions('1.0.0', '0.9.9'), 1);
  assert.equal(compareVersions('1.2.3-beta.1', '1.2.3'), 0, 'a prerelease suffix is stripped, not ranked');
  assert.equal(compareVersions('1.2.3+build.5', '1.2.3'), 0, 'build metadata is stripped too');
  assert.equal(compareVersions('1.2', '1.2.0'), 0, 'a missing segment reads as 0');
  assert.equal(compareVersions('1.2.x', '1.2.0'), 0, 'a non-numeric segment reads as 0');
  assert.equal(compareVersions('', ''), 0);
  assert.equal(compareVersions(null, undefined), 0, 'never throws on a missing version');
});

test('readAppMcpVersion: reads the app copy, and answers null for every absence', async () => {
  const deps = (files) => ({
    exists: (p) => p in files,
    readFile: async (p) => {
      if (!(p in files)) throw new Error('ENOENT ' + p);
      return files[p];
    },
  });
  const manifest = join('/app', 'node_modules', '@webjsdev', 'mcp', 'package.json');
  assert.equal(await readAppMcpVersion('/app', deps({ [manifest]: '{"version":"0.1.12"}' })), '0.1.12');
  assert.equal(await readAppMcpVersion('/app', deps({})), null, 'no install');
  assert.equal(await readAppMcpVersion('', deps({})), null, 'no app dir');
  assert.equal(await readAppMcpVersion(undefined, deps({})), null, 'appDir omitted');
  assert.equal(await readAppMcpVersion('/app', deps({ [manifest]: '{' })), null, 'unparseable');
  assert.equal(await readAppMcpVersion('/app', deps({ [manifest]: '{"version":42}' })), null, 'a non-string version');
});

test('resolveDocsLocation: the app corpus outranks the bundled snapshot and the repo-root skill', () => {
  // Same fake package layout the two-rung test builds, plus a third: an app with
  // its own installed @webjsdev/mcp.
  const root = mkdtempSync(join(tmpdir(), 'mcp-appdir-'));
  _cleanup.push(root);
  const srcDir = join(root, 'packages', 'mcp', 'src');
  const bundled = join(root, 'packages', 'mcp', 'resources', 'references');
  const skill = join(root, '.agents', 'skills', 'webjs');
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(join(skill, 'references'), { recursive: true });
  writeFileSync(join(root, 'AGENTS.md'), '# root\n');
  const moduleUrl = pathToFileURL(join(srcDir, 'mcp-docs.js')).href;

  const appDir = join(root, 'app');
  const appRoot = join(appDir, 'node_modules', '@webjsdev', 'mcp', 'resources');

  // No app install and no bundle: the dev rung, which froze nothing and so has
  // no stamp to name.
  assert.equal(resolveDocsLocation(moduleUrl, appDir).docsDir, join(skill, 'references'));
  assert.equal(resolveDocsLocation(moduleUrl, appDir).corpusPath, null, 'a live checkout claims no provenance');
  assert.equal(resolveDocsLocation(moduleUrl, appDir).corpusSource, 'repo');

  // A bundle but still no app install: the server's own snapshot, which does.
  mkdirSync(bundled, { recursive: true });
  let loc = resolveDocsLocation(moduleUrl, appDir);
  assert.equal(loc.docsDir, bundled, 'falls back to the bundled snapshot');
  assert.equal(loc.corpusPath, join(root, 'packages', 'mcp', 'resources', 'corpus.json'));
  assert.equal(loc.corpusSource, 'bundled');

  // The app's own copy now exists and outranks both.
  mkdirSync(join(appRoot, 'references'), { recursive: true });
  loc = resolveDocsLocation(moduleUrl, appDir);
  assert.equal(loc.docsDir, join(appRoot, 'references'), 'the app corpus wins');
  assert.equal(loc.corpusSource, 'app');
  assert.equal(loc.agentsPath, join(appRoot, 'AGENTS.md'));
  assert.equal(loc.skillPath, join(appRoot, 'SKILL.md'));
  assert.equal(loc.corpusPath, join(appRoot, 'corpus.json'));

  // An omitted or nonexistent appDir does not throw and lands on the same rung.
  assert.equal(resolveDocsLocation(moduleUrl).docsDir, bundled, 'appDir omitted');
  assert.equal(resolveDocsLocation(moduleUrl, join(root, 'nope')).docsDir, bundled, 'appDir does not exist');
  assert.equal(resolveDocsLocation(moduleUrl, '').docsDir, bundled, 'empty appDir');
});

test('getPrompt: every listed prompt resolves to a user message; unknown throws', () => {
  for (const p of PROMPTS) {
    const got = getPrompt(p.name, {});
    assert.equal(got.messages[0].role, 'user');
    assert.ok(got.messages[0].content.text.length > 50);
    assert.match(got.messages[0].content.text, /webjs-docs:\/\/SKILL/, 'points at the skill for the full guide');
  }
  assert.throws(() => getPrompt('nope', {}), /Unknown prompt/);
});
