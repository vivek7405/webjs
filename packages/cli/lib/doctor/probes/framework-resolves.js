import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';

/**
 * @typedef {import('../codes.js').DoctorResult} DoctorResult
 */

/**
 * Probe whether `@webjsdev/core` resolves from `appDir`. Node resolution is
 * directory-relative, so this must probe FROM the app (not the CLI's own
 * location, which resolves the framework fine from a global install even when
 * the app cannot). A no-op-cheap resolve, no I/O beyond what Node's resolver
 * does, no network. Returns true when the framework resolves, false otherwise.
 * @param {string} appDir
 * @returns {boolean}
 */
export function frameworkResolves(appDir) {
  try {
    // The base file need not exist; createRequire only uses it to anchor the
    // node_modules lookup at appDir.
    const require = createRequire(join(appDir, '__webjs_resolve_probe__.js'));
    require.resolve('@webjsdev/core');
    return true;
  } catch {
    return false;
  }
}

/**
 * CHECK 8, framework resolvability (#954). WARN when `@webjsdev/core` cannot be
 * resolved FROM the app directory, which is the fresh-git-worktree trap: a
 * worktree does not copy `node_modules`, so a plain `webjs dev` there dies at
 * SSR with a raw `ERR_MODULE_NOT_FOUND: Cannot find package '@webjsdev/core'`
 * whose remedy is not obvious. Silent PASS when the framework resolves (the
 * common case), so this never slows a healthy app. WARN (not a hard fail): it
 * is a setup/environment concern, the same tier as the version-coherence check.
 * @param {string} appDir
 * @returns {DoctorResult}
 */
export function checkFrameworkResolves(appDir) {
  const name = 'framework-resolve';
  if (frameworkResolves(appDir)) {
    return { name, status: 'pass', message: '@webjsdev/core resolves from the app directory.' };
  }
  const hasNodeModules = existsSync(join(appDir, 'node_modules'));
  // A git worktree checks out `.git` as a FILE (a gitdir pointer), not a
  // directory. That, plus a missing node_modules, is the exact #954 cause.
  let isWorktree = false;
  try {
    isWorktree = statSync(join(appDir, '.git')).isFile();
  } catch {
    isWorktree = false;
  }
  if (isWorktree && !hasNodeModules) {
    return {
      name,
      status: 'warn',
      message:
        '@webjsdev/core cannot be resolved from this directory, and this is a git worktree with no ' +
        'node_modules. Git worktrees do not copy node_modules, so the framework is unresolvable here ' +
        'and `webjs dev` / `webjs start` would fail at SSR with a raw ERR_MODULE_NOT_FOUND.',
      fix: freshWorktreeFix(appDir),
    };
  }
  if (!hasNodeModules) {
    return {
      name,
      status: 'warn',
      message: '@webjsdev/core cannot be resolved from this directory (no node_modules present).',
      fix: 'Run `npm install` in the app directory so the framework resolves.',
    };
  }
  return {
    name,
    status: 'warn',
    message:
      '@webjsdev/core cannot be resolved from this directory even though node_modules exists ' +
      '(a partial or corrupted install).',
    fix: linkAwareReinstallFix(appDir),
  };
}

/**
 * Whether `dir`'s own `node_modules` is a SYMLINK, which in a linked worktree
 * means it points at the primary checkout's tree. The remedies below branch on
 * this, because `npm install` is the right advice when it is false and is the
 * exact command that corrupts the primary when it is true (#1442).
 * @param {string} dir
 * @returns {boolean}
 */
function modulesAreLinked(dir) {
  try { return lstatSync(join(dir, 'node_modules')).isSymbolicLink(); } catch { return false; }
}

/**
 * The `npm run worktree:link` sentence, but ONLY where that script exists.
 *
 * This module ships in the PUBLISHED CLI, and `bin/webjs.js` prints these
 * remedies verbatim as the `webjs dev` / `webjs start` preflight failure. A
 * scaffolded app has no `worktree:link` script, so naming it unconditionally
 * sends the exact audience this check exists for (#954, a fresh app worktree)
 * to run something that does not exist. Walk up for a package.json that really
 * declares it, and stay silent otherwise.
 *
 * @param {string} appDir
 * @returns {string} a leading-space sentence, or the empty string
 */
function linkScriptHint(appDir) {
  let dir = resolve(appDir);
  for (let i = 0; i < 8; i += 1) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (pkg?.scripts?.['worktree:link']) {
        return ' In this repo, `npm run worktree:link` does the whole setup and also repairs the shared tree.';
      }
    } catch { /* no package.json here, keep walking */ }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return '';
}

/**
 * Remedy for the #954 fresh-worktree case, which is a worktree with NO
 * `node_modules` at all. There is no symlink in the way yet, so a real install
 * is safe here, and this stays the app-generic advice it has always been.
 * @param {string} appDir
 * @returns {string}
 */
function freshWorktreeFix(appDir) {
  return (
    'Install dependencies in this worktree (`npm install`), or symlink node_modules from the ' +
    'primary checkout (`ln -s ../<primary-checkout>/node_modules node_modules`). If you symlink, ' +
    'never run an install through that link afterwards: it acts on the checkout that owns the ' +
    'tree, not this one (#1442).' + linkScriptHint(appDir)
  );
}

/**
 * Remedy for a `node_modules` that exists but does not resolve the framework.
 * When it is a SYMLINK, a bare `npm install` is the action that corrupts the
 * checkout that owns the tree, so the advice has to differ.
 * @param {string} appDir
 * @returns {string}
 */
function linkAwareReinstallFix(appDir) {
  if (modulesAreLinked(appDir)) {
    return (
      'node_modules here is a SYMLINK at another checkout, so do NOT run `npm install`: it would act ' +
      'on that checkout, not this one (#1442). Either reinstall in the checkout that owns the tree, ' +
      'or remove every node_modules symlink first, nested ones included ' +
      '(`find . -maxdepth 4 -type l -name node_modules -delete`), and install here.' + linkScriptHint(appDir)
    );
  }
  return 'Reinstall dependencies (`npm install`, or remove node_modules and reinstall).';
}

/**
 * Classify the `@webjsdev/core` entry that `appDir` would resolve through.
 *
 * Walks up for the first `node_modules` carrying the package, then judges the
 * link against the tree that PHYSICALLY owns that `node_modules`. That owner
 * rule is the only one correct in a linked worktree: there `node_modules` is
 * itself a symlink at the primary's, so the owning tree is the PRIMARY and a
 * target inside it is right rather than foreign. Judging against `appDir` would
 * report every correctly linked worktree as corrupted.
 *
 * @param {string} appDir
 * @param {string} [pkg]
 * @returns {{ state: 'absent'|'real'|'ok'|'dangling'|'foreign', entry?: string, target?: string, owner?: string }}
 */
export function inspectFrameworkLink(appDir, pkg = '@webjsdev/core') {
  const parts = pkg.split('/');
  let dir = resolve(appDir);
  for (;;) {
    const modules = join(dir, 'node_modules');
    const entry = join(modules, ...parts);
    let st = null;
    try { st = lstatSync(entry); } catch { st = null; }
    if (st) {
      if (!st.isSymbolicLink()) return { state: 'real', entry };
      let target = '';
      try { target = readlinkSync(entry); } catch { return { state: 'real', entry }; }
      // Resolve the target against the directory the link PHYSICALLY sits in,
      // which is what the OS does. In a linked worktree `node_modules` is itself
      // a symlink, so the lexical `dirname(entry)` is under the WORKTREE while
      // the link really lives in the primary. Resolving lexically turns every
      // correct `../../packages/core` into a worktree path and reports a healthy
      // linked worktree as `foreign`.
      let base = dirname(entry);
      try { base = realpathSync(base); } catch { /* fall back to the lexical path */ }
      const abs = resolve(base, target);
      let owner = dir;
      try { owner = dirname(realpathSync(modules)); } catch { /* use dir as given */ }
      if (!existsSync(abs)) return { state: 'dangling', entry, target, owner };
      let real = abs;
      try { real = realpathSync(abs); } catch { /* compare the unresolved path */ }
      let ownerReal = owner;
      try { ownerReal = realpathSync(owner); } catch { /* compare as given */ }
      if (real !== ownerReal && !real.startsWith(ownerReal + sep)) {
        return { state: 'foreign', entry, target, owner: ownerReal };
      }
      return { state: 'ok', entry, target, owner: ownerReal };
    }
    const up = dirname(dir);
    if (up === dir) return { state: 'absent' };
    dir = up;
  }
}

/**
 * CHECK: framework link integrity (#1442). WARN when the `@webjsdev/core` entry
 * in node_modules is a symlink that DANGLES or resolves OUTSIDE the tree that
 * owns it. That is what an install run inside a linked worktree leaves behind,
 * and it is invisible to the framework-resolve check above, which only asks
 * whether the package resolves at all: a link into a live FOREIGN checkout
 * resolves perfectly and silently runs another branch's framework source.
 *
 * Silent PASS for a real directory, a correct link, and no entry at all, so a
 * normally installed app pays one `lstat`. WARN rather than fail, the same
 * environment tier as the framework-resolve and version-coherence checks.
 * @param {string} appDir
 * @returns {DoctorResult}
 */
export function checkFrameworkLinks(appDir) {
  const name = 'framework-links';
  const r = inspectFrameworkLink(appDir);
  if (r.state === 'absent' || r.state === 'real' || r.state === 'ok') {
    return {
      name,
      status: 'pass',
      message: 'The @webjsdev framework links resolve inside the checkout that owns them.',
    };
  }
  const fix =
    'Repoint the entry at the package inside the checkout that owns this node_modules. Do NOT run ' +
    '`npm install` here while node_modules is a symlink: it acts on that owning checkout, not this ' +
    'one (#1442).' + linkScriptHint(appDir);
  if (r.state === 'dangling') {
    return {
      name,
      status: 'warn',
      message:
        `${r.entry} is a symlink to ${r.target}, which does not exist. An install run inside a linked ` +
        'worktree leaves these behind, and the worktree it named has since been removed.',
      fix,
    };
  }
  return {
    name,
    status: 'warn',
    message:
      `${r.entry} is a symlink to ${r.target}, which resolves OUTSIDE ${r.owner}, the checkout that ` +
      'owns this node_modules. It resolves fine, so nothing fails, and the framework source being run ' +
      "is another checkout's. A deliberate `npm link` produces the same shape.",
    fix,
  };
}
