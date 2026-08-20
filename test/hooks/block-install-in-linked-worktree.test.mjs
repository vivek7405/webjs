// The block-install-in-linked-worktree hook refuses a package-manager install
// aimed at a directory whose `node_modules` is a SYMLINK, because the write
// lands in the checkout that OWNS the tree rather than in this one (#1442).
// It must stay narrow: the commands an agent actually runs in a worktree
// (`npm test`, `npm run <script>`, `npx ...`) have to pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOOK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../.claude/hooks/block-install-in-linked-worktree.sh'
);

/**
 * Run the hook with `command` as the Bash tool input, from `cwd`.
 * The escape hatch is pinned OFF so an inherited value in the invoking
 * environment cannot silently flip a block assertion into a pass.
 */
function runHook(command, cwd, env = {}) {
  return spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_input: { command } }),
    cwd,
    env: { ...process.env, WEBJS_NO_WORKTREE_INSTALL_GATE: '0', ...env },
    encoding: 'utf8',
  });
}

/**
 * A primary checkout with a real `node_modules`, plus a sibling worktree whose
 * `node_modules` is a symlink at it. That is exactly what `npm run worktree:link`
 * produces and what an install must never be allowed to write through.
 */
function makeLinkedPair() {
  const root = mkdtempSync(join(tmpdir(), 'install-gate-'));
  const primary = join(root, 'primary');
  const worktree = join(root, 'worktree');
  mkdirSync(join(primary, 'node_modules'), { recursive: true });
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(primary, 'package.json'), '{"name":"primary"}\n');
  writeFileSync(join(worktree, 'package.json'), '{"name":"worktree"}\n');
  symlinkSync(join(primary, 'node_modules'), join(worktree, 'node_modules'));
  return { root, primary, worktree };
}

test('blocks `cd <worktree> && npm ci`, naming the owning checkout and the safe alternative', () => {
  const { root, primary, worktree } = makeLinkedPair();
  try {
    const r = runHook(`cd ${worktree} && npm ci`, root);
    assert.equal(r.status, 2, `expected block, got ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /node_modules is a SYMLINK/);
    assert.ok(r.stderr.includes(join(primary, 'node_modules')), 'names the owning tree');
    assert.match(r.stderr, /npm run worktree:link/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('blocks a bare `npm install` run from inside the linked worktree', () => {
  const { root, worktree } = makeLinkedPair();
  try {
    assert.equal(runHook('npm install', worktree).status, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('blocks `bun add`, which writes THROUGH the link rather than replacing it', () => {
  const { root, worktree } = makeLinkedPair();
  try {
    assert.equal(runHook('bun add nanoid', worktree).status, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('blocks the flags-before-verb form `npm --prefix <worktree> install`', () => {
  const { root, primary, worktree } = makeLinkedPair();
  try {
    // Run it from the PRIMARY, so the only thing naming the worktree is the flag.
    assert.equal(runHook(`npm --prefix ${worktree} install`, primary).status, 2);
    assert.equal(runHook(`npm install --prefix ${worktree}`, primary).status, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('blocks every manager\'s install ALIAS, not just the canonical spelling', () => {
  // A gate `bun i` walks past is worthless, and Bun is the manager that writes
  // THROUGH the symlink into the primary rather than replacing it, so its
  // aliases are the consequential ones. `yarn` bare is an install in yarn classic.
  const { root, worktree } = makeLinkedPair();
  try {
    for (const cmd of [
      'npm i', 'npm in', 'npm ic', 'npm it', 'npm clean-install', 'npm update',
      'bun i', 'bun a nanoid', 'pnpm i', 'yarn', 'yarn --frozen-lockfile', 'yarn add x',
    ]) {
      assert.equal(runHook(cmd, worktree).status, 2, `expected block for \`${cmd}\``);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the broadened alias table does not swallow non-install commands', () => {
  const { root, worktree } = makeLinkedPair();
  try {
    // `npm init` must not match `in` or `i`, and a bare `yarn test` must not
    // match the bare-yarn install branch.
    for (const cmd of ['npm init', 'npm init -y', 'yarn test', 'yarn run build', 'bun run dev', 'bun test', 'pnpm run build']) {
      assert.equal(runHook(cmd, worktree).status, 0, `expected allow for \`${cmd}\``);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('COUNTERFACTUAL: the identical command passes when node_modules is a real directory', () => {
  const { root, worktree } = makeLinkedPair();
  try {
    rmSync(join(worktree, 'node_modules'));
    mkdirSync(join(worktree, 'node_modules'));
    const r = runHook(`cd ${worktree} && npm ci`, root);
    assert.equal(r.status, 0, `expected allow, got ${r.status}: ${r.stderr}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('allows the commands an agent actually runs in a linked worktree', () => {
  const { root, worktree } = makeLinkedPair();
  try {
    for (const cmd of ['npm test', 'npm run test', 'npm run test:browser', 'npx webjs check', 'npm ls', 'npm exec webjs check', 'npm run install-deps']) {
      const r = runHook(cmd, worktree);
      assert.equal(r.status, 0, `expected allow for \`${cmd}\`, got ${r.status}: ${r.stderr}`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a `cd` out of the worktree supersedes the session cwd, so an install elsewhere passes', () => {
  const { root, worktree } = makeLinkedPair();
  const elsewhere = join(root, 'elsewhere');
  mkdirSync(elsewhere);
  try {
    const r = runHook(`cd ${elsewhere} && npm install`, worktree);
    assert.equal(r.status, 0, `expected allow, got ${r.status}: ${r.stderr}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('fails OPEN when the target directory has no node_modules at all', () => {
  const root = mkdtempSync(join(tmpdir(), 'install-gate-bare-'));
  try {
    assert.equal(runHook('npm install', root).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('honours WEBJS_NO_WORKTREE_INSTALL_GATE=1', () => {
  const { root, worktree } = makeLinkedPair();
  try {
    const r = runHook('npm ci', worktree, { WEBJS_NO_WORKTREE_INSTALL_GATE: '1' });
    assert.equal(r.status, 0, `expected allow, got ${r.status}: ${r.stderr}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
