/**
 * Tests for the `webjs check` invocation-target guard (#1301).
 *
 * `webjs check` is an APP-level tool, so running it at a workspace root walked
 * two apps plus every package's test suite at once and reported 67 cross-app
 * collisions no single runtime ever sees. The guard refuses instead, naming the
 * member apps to run it in.
 *
 * Two things these tests pin beyond the refusal itself. The guard must NOT
 * swallow a real finding inside an app (the fixture with a genuine duplicate
 * tag still exits 1 with the violation), and the app list the refusal derives
 * must stay equal to the one `.github/workflows/ci.yml` loops over, which is
 * what replaces a `--workspaces` flag.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findCheckTarget,
  notAnAppMessage,
  notAnAppJson,
} from '../../packages/cli/lib/check-target.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const CLI = resolve(REPO, 'packages', 'cli', 'bin', 'webjs.js');

/** Run `webjs check` in `cwd` with the given flags. */
function check(cwd, ...args) {
  return spawnSync(process.execPath, [CLI, 'check', ...args], { cwd, encoding: 'utf8' });
}

/** A fresh temp directory, removed when `t` finishes. */
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'webjs-check-target-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('a directory holding app/ is an app', async (t) => {
  const dir = await fixture(t);
  await mkdir(join(dir, 'app'));

  const target = await findCheckTarget(dir);
  assert.equal(target.isApp, true);
  assert.deepEqual(target.workspaceApps, []);
});

test('a workspace root lists only the members that are apps', async (t) => {
  const dir = await fixture(t);
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'root', private: true, workspaces: ['pkgs/*'] }),
  );
  await mkdir(join(dir, 'pkgs', 'withapp', 'app'), { recursive: true });
  await mkdir(join(dir, 'pkgs', 'noapp'), { recursive: true });

  const target = await findCheckTarget(dir);
  assert.equal(target.isApp, false);
  assert.deepEqual(target.workspaceApps, ['pkgs/withapp']);

  const message = notAnAppMessage(dir, target.workspaceApps);
  assert.match(message, /\( cd pkgs\/withapp && npx webjs check \)/);
  assert.doesNotMatch(message, /noapp/);
});

test('yarn\'s { packages: [...] } workspaces form is expanded too', async (t) => {
  const dir = await fixture(t);
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'root', private: true, workspaces: { packages: ['apps/*'] } }),
  );
  await mkdir(join(dir, 'apps', 'shop', 'app'), { recursive: true });

  const target = await findCheckTarget(dir);
  assert.deepEqual(target.workspaceApps, ['apps/shop']);
});

test('a plain directory with no app/ and no workspaces gets the generic advice', async (t) => {
  const dir = await fixture(t);

  const target = await findCheckTarget(dir);
  assert.equal(target.isApp, false);
  assert.deepEqual(target.workspaceApps, []);

  const message = notAnAppMessage(dir, target.workspaceApps);
  assert.match(message, /Change into your app directory/);
  assert.doesNotMatch(message, /Run the check inside each app/);
});

test('a file named app is not an app directory', async (t) => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'app'), 'not a directory');

  assert.equal((await findCheckTarget(dir)).isApp, false);
});

test('a missing or malformed package.json degrades the message, never the refusal', async (t) => {
  const missing = await fixture(t);
  const malformed = await fixture(t);
  await writeFile(join(malformed, 'package.json'), '{ not json');

  for (const dir of [missing, malformed]) {
    const target = await findCheckTarget(dir);
    assert.equal(target.isApp, false, dir);
    assert.deepEqual(target.workspaceApps, [], dir);
  }
});

test('the JSON refusal carries no violations key', () => {
  const json = notAnAppJson('/somewhere', ['examples/blog']);
  assert.equal(json.error.code, 'NOT_AN_APP');
  assert.equal(json.error.cwd, '/somewhere');
  assert.deepEqual(json.error.apps, ['examples/blog']);
  // A consumer that ignores the exit code and reads `report.violations.length`
  // must throw rather than be told the workspace is clean.
  assert.ok(!('violations' in json));
});

test('the guard does not swallow a real violation inside an app', async (t) => {
  const dir = await fixture(t);
  await mkdir(join(dir, 'app'), { recursive: true });
  await mkdir(join(dir, 'components'), { recursive: true });
  await writeFile(
    join(dir, 'app', 'page.ts'),
    "import { html } from '@webjsdev/core';\nexport default function Page() {\n  return html`<h1>Hi</h1>`;\n}\n",
  );
  for (const name of ['a', 'b']) {
    await writeFile(
      join(dir, 'components', `${name}.ts`),
      `import { WebComponent, html } from '@webjsdev/core';\n` +
        `class ${name.toUpperCase()} extends WebComponent({}) {\n` +
        '  render() { return html`<span></span>`; }\n' +
        '}\n' +
        `${name.toUpperCase()}.register('dup-tag');\n`,
    );
  }

  const r = check(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /no-duplicate-tag/);
  assert.match(r.stdout, /dup-tag/);
});

test('a directory that is not an app refuses with exit 1 and reports nothing', async (t) => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'stray.ts'), 'export const x = 1;\n');

  const r = check(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a WebJs app/);
  assert.doesNotMatch(r.stdout + r.stderr, /violation\(s\) found/);
});

test('--json refuses as parseable JSON', async (t) => {
  const dir = await fixture(t);

  const r = check(dir, '--json');
  assert.equal(r.status, 1);
  const json = JSON.parse(r.stdout);
  assert.equal(json.error.code, 'NOT_AN_APP');
  assert.ok(!('violations' in json));
});

test('--rules is exempt and still works outside an app', async (t) => {
  const dir = await fixture(t);

  const r = check(dir, '--rules');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /webjs check, correctness rules:/);
  assert.match(r.stdout, /no-duplicate-tag/);
});

test('the monorepo root itself refuses instead of reporting cross-app findings', () => {
  const r = check(REPO);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a WebJs app/);
  assert.match(r.stderr, /\( cd examples\/blog && npx webjs check \)/);
  assert.match(r.stderr, /\( cd website && npx webjs check \)/);
  // Asserted on the refusal rather than on a count, so the test stays stable
  // as the (false) finding count drifts. Reverting the guard reds this.
  assert.doesNotMatch(r.stdout, /no-duplicate-tag/);
  assert.doesNotMatch(r.stdout, /violation\(s\) found/);
});

test('the derived app list matches the app list ci.yml loops over', async () => {
  const workflow = await readFile(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
  // The `webjs check` step's loop, isolated from the sibling `webjs doctor`
  // loop over the same apps, by anchoring on the step name above it.
  const step = workflow.split('webjs check (')[1];
  assert.ok(step, 'ci.yml has a `webjs check` step');
  const loop = step.match(/for app in ([^;]+); do/);
  assert.ok(loop, 'that step loops over an app list');
  const fromCi = loop[1].trim().split(/\s+/).sort();

  const { workspaceApps } = await findCheckTarget(REPO);
  assert.deepEqual(
    workspaceApps,
    fromCi,
    'the apps the refusal names must be the apps CI checks',
  );
});
