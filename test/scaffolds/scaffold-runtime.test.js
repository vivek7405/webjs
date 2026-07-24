/**
 * Integration tests for the Bun-first scaffold mode (#541): `scaffoldApp` with
 * `{ runtime: 'bun' }` (and bun auto-detection from the invoking PM) produces a
 * Bun-flavored app across all three templates, while `runtime: 'node'` (the
 * default) is unchanged. Runs entirely offline (install: false).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scaffoldApp } from '../../packages/cli/lib/create.js';

async function tempCwd() {
  return mkdtemp(join(tmpdir(), 'webjs-scaffold-runtime-'));
}
function mute() {
  const log = console.log, err = console.error;
  console.log = () => {}; console.error = () => {};
  return () => { console.log = log; console.error = err; };
}
const read = (appDir, f) => readFileSync(join(appDir, f), 'utf8');
const pkg = (appDir) => JSON.parse(read(appDir, 'package.json'));

test('bun scaffold: package.json scripts, trustedDependencies, lockfile flavor', async () => {
  const cwd = await tempCwd();
  const restore = mute();
  try {
    await scaffoldApp('bunapp', cwd, { template: 'full-stack', runtime: 'bun' });
    const appDir = join(cwd, 'bunapp');
    const p = pkg(appDir);

    // The long-running server scripts force --bun (the shebang gotcha).
    assert.equal(p.scripts.dev, 'bun --bun webjs dev');
    assert.equal(p.scripts.start, 'bun --bun webjs start');
    // Runtime-neutral tooling stays plain webjs (runs on node via the shebang).
    assert.equal(p.scripts.test, 'webjs test');
    assert.equal(p.scripts['db:generate'], 'webjs db generate');
    // SQLite uses the built-in bun:sqlite (no native dependency), so there is
    // nothing to trust: trustedDependencies must be absent.
    assert.equal(p.trustedDependencies, undefined);
    // The native better-sqlite3 driver is gone entirely.
    assert.equal(p.dependencies['better-sqlite3'], undefined);
    // The Tailwind compile MUST run under Bun on a Bun app (#947): the oven/bun:1
    // image has no Node and no npm, so `npm run css:build` or a bare (node-shebang)
    // `tailwindcss` would abort the boot. It runs via `bun --bun tailwindcss` in
    // the css:build script AND the before / regenerate hooks (never `npm run`).
    const bunCompile = 'bun --bun tailwindcss -i ./public/input.css -o ./public/tailwind.css --minify';
    assert.equal(p.scripts['css:build'], bunCompile);
    assert.deepEqual(p.webjs.start.before, ['webjs db migrate', bunCompile]);
    // On-request regenerate (#967), runtime-aware, replaces the --watch parallel.
    assert.equal(p.webjs.dev.parallel, undefined, 'no --watch parallel task (#967)');
    assert.deepEqual(p.webjs.dev.regenerate, [{
      output: 'public/tailwind.css',
      command: bunCompile,
      inputs: ['app', 'components', 'modules', 'lib', 'public/input.css'],
    }]);
    const regenCmds = p.webjs.dev.regenerate.map((r) => r.command);
    for (const step of [...p.webjs.dev.before, ...p.webjs.start.before, ...regenCmds]) {
      assert.doesNotMatch(step, /npm run/, 'no npm in a Bun app before/regenerate step (the image has no npm)');
    }
  } finally {
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('bun scaffold: postgres dialect needs no trustedDependencies (pg is pure JS)', async () => {
  const cwd = await tempCwd();
  const restore = mute();
  try {
    await scaffoldApp('bunpg', cwd, { template: 'full-stack', runtime: 'bun', db: 'postgres' });
    const p = pkg(join(cwd, 'bunpg'));
    assert.equal(p.trustedDependencies, undefined);
  } finally {
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('bun scaffold: Dockerfile / compose / CI run on Bun', async () => {
  const cwd = await tempCwd();
  const restore = mute();
  try {
    await scaffoldApp('bunapp', cwd, { template: 'full-stack', runtime: 'bun' });
    const appDir = join(cwd, 'bunapp');

    // Pure oven/bun base (#595): safe now that cli@0.10.20 (#570) makes webjs db
    // migrate npx-free, so no Node base / bun-binary copy / apk line.
    const dockerfile = read(appDir, 'Dockerfile');
    assert.match(dockerfile, /FROM oven\/bun:1/);
    assert.doesNotMatch(dockerfile, /FROM node:24-alpine/);
    assert.doesNotMatch(dockerfile, /COPY --from=oven\/bun/);
    assert.doesNotMatch(dockerfile, /apk add/);
    assert.match(dockerfile, /RUN bun install/);
    assert.match(dockerfile, /COPY package\.json bun\.lock\* \.\//);
    assert.match(dockerfile, /CMD \["bun", "--bun", "run", "start"\]/);
    assert.match(dockerfile, /CMD \["bun", "-e"/); // healthcheck off node
    assert.doesNotMatch(dockerfile, /CMD \["npm", "start"\]/);

    // compose builds from that Dockerfile + inherits the bun CMD; its healthcheck
    // is switched off node (the pure Bun image has none).
    const compose = read(appDir, 'compose.yaml');
    assert.match(compose, /test: \["CMD", "bun", "-e"/);

    const ci = read(appDir, '.github/workflows/ci.yml');
    assert.match(ci, /oven-sh\/setup-bun@v2/);
    assert.match(ci, /actions\/setup-node/); // kept: webjs tooling runs on node
    assert.match(ci, /- run: bun install/);
    assert.match(ci, /- run: bun run check/);
    assert.doesNotMatch(ci, /bun --bun run/); // tooling stays on node
    assert.doesNotMatch(ci, /npm ci/);
  } finally {
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('bun scaffold: agent-config markdown shows bun commands, no npm commands', async () => {
  const cwd = await tempCwd();
  const restore = mute();
  try {
    await scaffoldApp('bunapp', cwd, { template: 'full-stack', runtime: 'bun' });
    const appDir = join(cwd, 'bunapp');
    for (const f of ['AGENTS.md', 'CLAUDE.md', '.agents/rules/workflow.md']) {
      const md = read(appDir, f);
      assert.doesNotMatch(md, /\bnpm run /, `${f} should not contain "npm run"`);
      assert.doesNotMatch(md, /\bnpx /, `${f} should not contain "npx "`);
    }
    const agents = read(appDir, 'AGENTS.md');
    assert.match(agents, /bun --bun run dev/);
    // The injected template playbook (#1076) is bunified too: the substitution
    // runs BEFORE bunifyProse, so the playbook's commands arrive in bun form.
    assert.match(agents, /bun run check/, 'playbook check command is bunified');
    assert.match(agents, /bunx webjsdev ui add/, 'playbook ui add is bunified');

    // The copied agent skill is bunified as well (#1076): its references carry
    // runnable commands, so a bun app's skill must not instruct npm. The one
    // exception is references/runtime.md, the deliberate node-vs-bun command
    // matrix, which keeps its npm column (the counterfactual that the
    // exclusion works).
    const skillTesting = read(appDir, '.agents/skills/webjs/references/testing.md');
    assert.doesNotMatch(skillTesting, /\bnpm run /, 'skill testing.md is bunified');
    assert.match(skillTesting, /bun run test/, 'skill testing.md shows bun commands');
    const skillRuntime = read(appDir, '.agents/skills/webjs/references/runtime.md');
    assert.match(skillRuntime, /npm install/, 'runtime.md keeps its npm column (matrix preserved)');

    // The starter test files' header comments are bun-ified too (no npm/npx).
    const browserTest = read(appDir, 'test/hello/browser/hello.test.js');
    assert.doesNotMatch(browserTest, /\bnpx /, 'hello browser test uses bunx');
    const e2eTest = read(appDir, 'test/hello/e2e/hello.test.ts');
    assert.doesNotMatch(e2eTest, /\bnpm i /, 'hello e2e test uses bun add');
  } finally {
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('bun scaffold works across both templates', async () => {
  for (const template of ['full-stack', 'api']) {
    const cwd = await tempCwd();
    const restore = mute();
    try {
      await scaffoldApp('app', cwd, { template, runtime: 'bun' });
      const appDir = join(cwd, 'app');
      const p = pkg(appDir);
      assert.equal(p.scripts.dev, 'bun --bun webjs dev', `${template}: dev script`);
      const df = read(appDir, 'Dockerfile');
      assert.match(df, /FROM oven\/bun:1/, `${template}: pure oven/bun base`);
      assert.match(df, /CMD \["bun", "--bun", "run", "start"\]/, `${template}: serves on bun`);
    } finally {
      restore();
      await rm(cwd, { recursive: true, force: true });
    }
  }
});

test('bun is auto-detected from npm_config_user_agent (no explicit flag)', async () => {
  const cwd = await tempCwd();
  const restore = mute();
  const prev = process.env.npm_config_user_agent;
  process.env.npm_config_user_agent = 'bun/1.3.14 npm/? node/? linux x64';
  try {
    // No runtime opt: detection picks bun because the invoking PM is bun.
    await scaffoldApp('detected', cwd, { template: 'full-stack' });
    assert.equal(pkg(join(cwd, 'detected')).scripts.dev, 'bun --bun webjs dev');
  } finally {
    if (prev === undefined) delete process.env.npm_config_user_agent;
    else process.env.npm_config_user_agent = prev;
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('node mode (default) is unchanged: no bun flavor leaks in', async () => {
  const cwd = await tempCwd();
  const restore = mute();
  const prev = process.env.npm_config_user_agent;
  // Force a non-bun UA so detection cannot pick bun.
  process.env.npm_config_user_agent = 'npm/10.0.0 node/v24.0.0 linux x64';
  try {
    await scaffoldApp('nodeapp', cwd, { template: 'full-stack', runtime: 'node' });
    const appDir = join(cwd, 'nodeapp');
    const p = pkg(appDir);
    assert.equal(p.scripts.dev, 'webjs dev');
    assert.equal(p.scripts.start, 'webjs start');
    assert.equal(p.trustedDependencies, undefined);
    assert.match(read(appDir, 'Dockerfile'), /FROM node:24-alpine/);
    assert.match(read(appDir, 'compose.yaml'), /test: \["CMD", "node", "-e"/);
    assert.match(read(appDir, '.github/workflows/ci.yml'), /actions\/setup-node/);
    assert.match(read(appDir, 'AGENTS.md'), /npm run dev/);
  } finally {
    if (prev === undefined) delete process.env.npm_config_user_agent;
    else process.env.npm_config_user_agent = prev;
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('explicit --runtime node overrides bun auto-detection', async () => {
  const cwd = await tempCwd();
  const restore = mute();
  const prev = process.env.npm_config_user_agent;
  process.env.npm_config_user_agent = 'bun/1.3.14';
  try {
    // Invoked through bun, but the explicit flag wins.
    await scaffoldApp('forced', cwd, { template: 'full-stack', runtime: 'node' });
    assert.equal(pkg(join(cwd, 'forced')).scripts.dev, 'webjs dev');
  } finally {
    if (prev === undefined) delete process.env.npm_config_user_agent;
    else process.env.npm_config_user_agent = prev;
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('an unknown --runtime is rejected', async () => {
  const cwd = await tempCwd();
  const restore = mute();
  try {
    await assert.rejects(
      () => scaffoldApp('x', cwd, { template: 'full-stack', runtime: 'deno' }),
      /Unknown --runtime 'deno'/,
    );
  } finally {
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});
