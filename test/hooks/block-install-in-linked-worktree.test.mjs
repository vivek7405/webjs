// The block-install-in-linked-worktree hook refuses a package-manager install
// aimed at a directory whose `node_modules` is a SYMLINK, because the write
// lands in the checkout that OWNS the tree rather than in this one (#1442).
// It must stay narrow: the commands an agent actually runs in a worktree
// (`npm test`, `npm run <script>`, `npx ...`) have to pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
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

test('blocks the HYPHENATED npm verbs, which the short aliases do not cover', () => {
  // The trailing word boundary excludes `-`, so listing `install` does not reach
  // `install-test`. Each hyphenated command needs its own entry.
  const { root, worktree } = makeLinkedPair();
  try {
    for (const cmd of ['npm install-test', 'npm install-ci-test', 'npm clean-install-test', 'npm clean-install', 'npm install-clean']) {
      assert.equal(runHook(cmd, worktree).status, 2, `expected block for \`${cmd}\``);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('blocks the REMOVE verbs, which delete from the owning checkout', () => {
  const { root, worktree } = makeLinkedPair();
  try {
    for (const cmd of ['npm uninstall x', 'npm rm x', 'npm r x', 'bun rm x', 'pnpm rm x', 'yarn remove x', 'pnpm upgrade', 'pnpm dedupe', 'yarn dedupe']) {
      assert.equal(runHook(cmd, worktree).status, 2, `expected block for \`${cmd}\``);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('judges a COMMAND, never a token that merely appears in the line', () => {
  // This is the whole design of the matcher. An earlier version matched the
  // manager token anywhere, which blocked this PR's own commit subject. Every
  // worktree here is a linked worktree, so that fires on ordinary commands
  // constantly, and a gate that cries wolf is a gate someone turns off.
  const { root, worktree } = makeLinkedPair();
  try {
    for (const cmd of [
      'git commit -m "fix: npm install in a linked worktree corrupts node_modules"',
      'gh pr create --title "fix: npm install in a linked worktree" --body x',
      'grep -rn "npm ci" AGENTS.md',
      'git log --grep "npm install"',
      'echo "the hook blocks npm rm x too"',
      'rg "bun add" .',
      'cat README | grep yarn',
      // A shell metacharacter INSIDE the quoted text. Splitting the raw command
      // makes the tail look like its own command, so each of these read as an
      // install. Quoted spans are removed before the split for exactly this.
      'git commit -m "fix: guard the link; npm install now blocks"',
      'git commit -m "fix: cd wt && npm ci corrupts the primary"',
      'gh pr create --body "| npm install | replaces the symlink |"',
      'echo "run (npm ci) to reproduce"',
      "git log --grep 'npm install'",
    ]) {
      assert.equal(runHook(cmd, worktree).status, 0, `expected allow for \`${cmd}\``);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('never blocks a GLOBAL install, which writes to the npm prefix not the link', () => {
  // `npm update -g webjsdev` is this repo's documented post-release step, and a
  // linked worktree is the mandated working state, so blocking it would refuse a
  // workflow the repo requires over a corruption that cannot occur.
  const { root, worktree } = makeLinkedPair();
  try {
    for (const cmd of ['npm update -g webjsdev', 'npm uninstall -g webjsdev', 'bun add -g webjsdev', 'npm i --global webjsdev']) {
      assert.equal(runHook(cmd, worktree).status, 0, `expected allow for \`${cmd}\``);
    }
    // ...but the same verb WITHOUT -g still blocks, so the carve-out is narrow.
    assert.equal(runHook('npm update webjsdev', worktree).status, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('still sees the install through env assignments and benign wrappers', () => {
  const { root, worktree } = makeLinkedPair();
  try {
    for (const cmd of [
      'WEBJS_X=1 npm ci', 'sudo npm ci', 'time npm install', 'FOO=a BAR=b bun install',
      // A wrapper carrying its OWN flags, which the strip must walk past.
      'sudo -u foo npm ci', 'nice -n 10 npm install',
    ]) {
      assert.equal(runHook(cmd, worktree).status, 2, `expected block for \`${cmd}\``);
    }
    // `command`, `exec`, `bash` and `sh` are deliberately NOT wrappers. Walking
    // into a nested shell command re-creates the token-anywhere class one level
    // in, where `bash -c "echo yarn"` reaches the bare-yarn branch. So a lookup
    // stays allowed, and `bash -c "npm ci"` is a known accepted gap.
    assert.equal(runHook('command -v yarn', worktree).status, 0);
    assert.equal(runHook('bash -c "echo yarn"', worktree).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an `=` in a FLAG does not disable the gate (fail-open regression)', () => {
  // The env-assignment strip is anchored to the FIRST token. An unanchored
  // `[A-Za-z_]*=*` case glob matches the WHOLE segment whenever any LATER token
  // carries an `=`, so it ate the leading words and every one of these was
  // ALLOWED, which is the one direction that actually matters: the gate exists
  // to stop a write, and `npm install --workspace=packages/core` is an ordinary
  // command in this monorepo that corrupts the primary.
  const { root, worktree } = makeLinkedPair();
  try {
    for (const cmd of [
      'npm install --omit=dev',
      'npm ci --loglevel=error',
      'npm install --workspace=packages/core',
      'bun install --backend=hardlink',
      'yarn add x --registry=https://r',
      'pnpm add x --dir=/y',
      'npm i -D esbuild --foreground-scripts=true',
    ]) {
      assert.equal(runHook(cmd, worktree).status, 2, `expected block for \`${cmd}\``);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the --prefix= EQUALS form is reachable, not just the space form', () => {
  // The regexes carry `[[:space:]=]+` deliberately, and the pre-existing prefix
  // test used only the space form, so the equals branch was dead while green.
  const { root, primary, worktree } = makeLinkedPair();
  try {
    assert.equal(runHook(`npm --prefix=${worktree} install`, primary).status, 2);
    assert.equal(runHook(`npm install --prefix=${worktree}`, primary).status, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bare `yarn` blocks only in COMMAND position, never as a trailing word', () => {
  // The bare-yarn branch first lived inside the generic VERBS pattern, whose
  // prefix any space satisfies, so it matched the token ANYWHERE and blocked
  // `which yarn`, `rm -rf /tmp/yarn` and `git switch -c feat/yarn`. That fires
  // on ordinary commands in a linked worktree, which is the mandated state here,
  // and a gate that cries wolf gets turned off.
  const { root, worktree } = makeLinkedPair();
  try {
    for (const cmd of ['yarn', 'yarn --frozen-lockfile', 'cd . && yarn']) {
      assert.equal(runHook(cmd, worktree).status, 2, `expected block for \`${cmd}\``);
    }
    for (const cmd of [
      'which yarn', 'command -v yarn', 'ls -la ~/.yarn', 'rm -rf /tmp/yarn',
      'git switch -c feat/yarn', 'cat README | grep yarn', 'echo yarn',
      'npm run build --workspace yarn',
    ]) {
      assert.equal(runHook(cmd, worktree).status, 0, `expected allow for \`${cmd}\``);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the broadened alias table does not swallow non-install commands', () => {
  const { root, worktree } = makeLinkedPair();
  try {
    // `npm init` must not match `in` or `i`, and a bare `yarn test` must not
    // match the bare-yarn install branch.
    for (const cmd of ['npm init', 'npm init -y', 'yarn test', 'yarn run build', 'bun run dev', 'bun test', 'pnpm run build', 'git rm x', 'rm -rf node_modules', 'npm run rm']) {
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

test('sees the verb through flags that sit BEFORE it', () => {
  // `npm --silent install` and `npm -w packages/core install` are ordinary
  // spellings. Only `--prefix` / `-C` used to be admitted in the pre-verb
  // position, so every other flag hid the verb and the gate failed open.
  const { root, worktree } = makeLinkedPair();
  try {
    for (const cmd of [
      'npm --silent install', 'npm -s ci', 'npm --ignore-scripts ci',
      'npm -w packages/core install', 'npm --workspace packages/core install',
      'npm --no-audit install', 'npm --prefer-offline ci',
      'pnpm -r install', 'pnpm --filter core install', 'bun --cwd . install',
    ]) {
      assert.equal(runHook(cmd, worktree).status, 2, `expected block for \`${cmd}\``);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a flag VALUE never hides the verb, and a safe verb still stops the scan', () => {
  const { root, worktree } = makeLinkedPair();
  try {
    // `packages/core` is neither an install verb nor a safe one, so the scan
    // continues and finds `install`.
    assert.equal(runHook('npm -w packages/core install', worktree).status, 2);
    // ...but `run` IS a safe verb, so the scan stops there and never reaches
    // the `add` further along.
    assert.equal(runHook('npm run test -- --grep add', worktree).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('follows every `cd` spelling, including ~, --, and pushd', () => {
  const { root, worktree } = makeLinkedPair();
  try {
    for (const cmd of [`cd -- ${worktree} && npm ci`, `pushd ${worktree} && npm ci`, `cd -P ${worktree} && npm ci`]) {
      assert.equal(runHook(cmd, root).status, 2, `expected block for \`${cmd}\``);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('treats `yarnpkg` as yarn, since it is declared a manager token', () => {
  const { root, worktree } = makeLinkedPair();
  try {
    for (const cmd of ['yarnpkg install', 'yarnpkg add x', 'yarnpkg']) {
      assert.equal(runHook(cmd, worktree).status, 2, `expected block for \`${cmd}\``);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the manager carve-out in the strip loop is load-bearing', () => {
  // A BOOLEAN wrapper flag followed directly by the manager. Without the
  // `npm|bun|pnpm|yarn|yarnpkg)` case in the strip loop, `npm` is taken for the
  // value of `-E` and stripped, leaving `ci` as the head token and no block.
  const { root, worktree } = makeLinkedPair();
  try {
    assert.equal(runHook('sudo -E npm ci', worktree).status, 2);
    assert.equal(runHook('sudo -n npm install', worktree).status, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('escalates to the git toplevel, so an install from a SUBDIRECTORY blocks', () => {
  // The install lands at the package root. `makeLinkedPair` builds no git repo,
  // so the toplevel term was never exercised by any other test here.
  const { root, worktree } = makeLinkedPair();
  try {
    execSync('git init -q -b main', { cwd: worktree, stdio: 'pipe' });
    const sub = join(worktree, 'packages', 'core');
    mkdirSync(sub, { recursive: true });
    assert.equal(runHook('npm install', sub).status, 2, 'a subdirectory install still reaches the linked root');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
