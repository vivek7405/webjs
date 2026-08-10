import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
      fix:
        'Install dependencies in this worktree (`npm install`), or symlink node_modules from the ' +
        'primary checkout (`ln -s ../<primary-checkout>/node_modules node_modules`).',
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
    fix: 'Reinstall dependencies (`npm install`, or remove node_modules and reinstall).',
  };
}
