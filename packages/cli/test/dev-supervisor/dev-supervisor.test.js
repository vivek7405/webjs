/**
 * Unit tests for the `webjs dev` reload-supervisor planner (issue #514).
 *
 * The bug: on Bun, `webjs dev` re-exec'd under `node --watch` (a Node-only
 * flag) and relied on the dev re-import's `?t=` cache-bust query, which Bun
 * ignores (it keys its module cache by path), so an edit to a re-imported
 * module stayed STALE on Bun. The fix re-execs under `bun --hot` on Bun, whose
 * file-watching cache invalidation makes the dev re-import pick up the edit.
 *
 * These tests prove the planner's branch logic: Bun yields `bun --hot`, Node
 * yields `node --watch` with the existing watch-path set, `--no-hot` opts out
 * on either runtime, and the counterfactual that the Bun branch never emits the
 * Node-only `--watch` flags.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { planDevSupervisor } from '../../lib/dev-supervisor.js';

const ARGV = ['/path/to/webjs.js', 'dev', '--port', '8080'];
const allExist = () => true;
const noneExist = () => false;

test('Bun re-execs under `bun --hot`, forwarding argv verbatim', () => {
  const plan = planDevSupervisor({ isBun: true, argv: ARGV, noHot: false, exists: allExist });
  assert.deepEqual(plan, { mode: 'spawn', args: ['--hot', ...ARGV] });
});

test('Bun branch NEVER emits the Node-only watch flags (the #514 mismatch)', () => {
  // The counterfactual: the old code passed `--watch` / `--watch-path` to Bun,
  // which Bun does not understand. The fix must use ONLY `--hot`.
  const plan = planDevSupervisor({ isBun: true, argv: ARGV, noHot: false, exists: allExist });
  assert.ok(plan.mode === 'spawn');
  for (const flag of ['--watch', '--watch-preserve-output', '--watch-path']) {
    assert.ok(!plan.args.includes(flag), `Bun args must not include ${flag}`);
  }
});

test('Node re-execs under `node --watch` with the project watch paths', () => {
  const plan = planDevSupervisor({ isBun: false, argv: ARGV, noHot: false, exists: allExist });
  assert.deepEqual(plan, {
    mode: 'spawn',
    args: [
      '--watch',
      '--watch-preserve-output',
      '--watch-path', 'app',
      '--watch-path', 'components',
      '--watch-path', 'modules',
      '--watch-path', 'lib',
      '--watch-path', 'actions',
      '--watch-path', 'middleware.ts',
      '--watch-path', 'middleware.js',
      '--watch-path', 'middleware.mts',
      '--watch-path', 'middleware.mjs',
      ...ARGV,
    ],
  });
});

test('Node watch paths include only the dirs/files that exist', () => {
  // Only `app` exists in this project.
  const exists = (p) => p === 'app';
  const plan = planDevSupervisor({ isBun: false, argv: ARGV, noHot: false, exists });
  assert.deepEqual(plan, {
    mode: 'spawn',
    args: ['--watch', '--watch-preserve-output', '--watch-path', 'app', ...ARGV],
  });
});

test('Node with no project dirs still watches (no --watch-path entries)', () => {
  const plan = planDevSupervisor({ isBun: false, argv: ARGV, noHot: false, exists: noneExist });
  assert.deepEqual(plan, {
    mode: 'spawn',
    args: ['--watch', '--watch-preserve-output', ...ARGV],
  });
});

test('`--no-hot` opts out of the supervisor on Bun (run in-process)', () => {
  const plan = planDevSupervisor({ isBun: true, argv: ARGV, noHot: true, exists: allExist });
  assert.deepEqual(plan, { mode: 'inline' });
});

test('`--no-hot` opts out of the supervisor on Node (run in-process)', () => {
  const plan = planDevSupervisor({ isBun: false, argv: ARGV, noHot: true, exists: allExist });
  assert.deepEqual(plan, { mode: 'inline' });
});

test('the watched middleware extensions match the ones the server loads', () => {
  // The server resolves a root middleware from four extensions. If this list
  // is narrower, an app can have a middleware that LOADS but never restarts
  // the dev server when edited, which is the quiet half of the bug where a
  // root `middleware.ts` was loaded by neither. Read from the server source
  // rather than restated, so the two cannot drift apart silently.
  // `dev.js` is a barrel over `dev/` now, so read the barrel AND every module
  // beneath it. Reading only the barrel would leave this guard unable to find
  // the declaration at all, which is a silent pass into a vacuous assertion
  // rather than the drift check it is meant to be.
  const serverSrc = join(dirname(fileURLToPath(import.meta.url)), '../../../server/src');
  const devDir = join(serverSrc, 'dev');
  const files = [join(serverSrc, 'dev.js')];
  if (existsSync(devDir)) {
    for (const e of readdirSync(devDir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.js')) files.push(join(devDir, e.name));
    }
  }
  const src = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  const m = src.match(/const ROOT_MIDDLEWARE_FILES = \[([^\]]+)\]/);
  assert.ok(m, 'the server declares its root-middleware candidates in one place');
  const serverExts = m[1].match(/'([^']+)'/g).map((q) => q.slice(1, -1));

  const plan = planDevSupervisor({ isBun: false, argv: ARGV, noHot: false, exists: allExist });
  const watched = plan.args.filter((a) => a.startsWith('middleware.'));

  assert.deepEqual(
    [...watched].sort(),
    [...serverExts].sort(),
    'every extension the server loads must also be watched in dev',
  );
});
