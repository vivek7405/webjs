import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {import('../codes.js').DoctorResult} DoctorResult
 */

/**
 * CHECK: the `.gitignore` does not swallow the committed vendor pin. The pattern
 * for `.webjs/vendor/` is subtle: a bare `.webjs/` line excludes the directory
 * entirely and git cannot re-include children of an excluded parent, so a
 * `!.webjs/vendor/` exception silently does nothing and `webjs vendor pin`
 * output never gets committed. The correct pattern is the depth-robust
 * contents-glob form (see the fix text below / VENDOR_GITIGNORE_LINES in
 * vendor.js): a globstar-prefixed `.webjs/*` plus the matching vendor
 * negations, which ignores transient `.webjs` output at any depth while
 * keeping the committed vendor pin tracked.
 *
 * This was a `webjs check` rule, but inspecting `.gitignore` is a project-config
 * concern (like `tsconfig-erasable`), not source-code correctness, and vendoring
 * is optional, so a doctor WARN fits the domain and severity better than a CI
 * hard-fail (#461). It lives next to `vendor-pin` (same family).
 *
 * PASS/skip when the dir is not a git repo or has no `.gitignore` (the user has
 * not opted into version control yet). Probes two representative paths via
 * `git check-ignore` with the inherited GIT_* env stripped so `cwd` is the sole
 * authority on which repo + .gitignore stack is consulted (a pre-commit hook
 * from a linked worktree exports GIT_WORK_TREE, which would otherwise override
 * cwd-based discovery).
 *
 * @param {string} appDir
 * @returns {Promise<DoctorResult>}
 */
export async function checkVendorGitignore(appDir) {
  const hasGit = existsSync(join(appDir, '.git'));
  const hasGitignore = existsSync(join(appDir, '.gitignore'));
  if (!hasGit || !hasGitignore) {
    return {
      name: 'vendor-gitignore',
      status: 'pass',
      message: 'Not a git checkout with a .gitignore; nothing to verify.',
    };
  }
  const { spawnSync } = await import('node:child_process');
  const {
    GIT_DIR: _gd, GIT_WORK_TREE: _gwt, GIT_INDEX_FILE: _gif, GIT_PREFIX: _gp,
    ...gitEnv
  } = process.env;
  // Check two representative paths: the pin manifest AND a sample downloaded
  // bundle. A `.gitignore` that allows the manifest but blocks bundles (e.g.
  // `*.js` higher up) would still break `webjs vendor pin --download`.
  // `git check-ignore -q` exits 0 when the path is ignored, 1 when not.
  const probes = [
    '.webjs/vendor/importmap.json',
    '.webjs/vendor/sample-pkg@1.0.0.js',
  ];
  for (const probe of probes) {
    const result = spawnSync('git', ['check-ignore', '-q', probe], {
      cwd: appDir,
      stdio: 'pipe',
      env: gitEnv,
    });
    if (result.status === 0) {
      return {
        name: 'vendor-gitignore',
        status: 'warn',
        message:
          `${probe} is gitignored, but \`webjs vendor pin\` writes files under .webjs/vendor/ that MUST be committed for a production deploy to use the pin (instead of calling api.jspm.io on every cold start). The most common cause: a \`.webjs/\` line that excludes the parent directory before the \`!.webjs/vendor/\` exception can take effect (git semantics: a parent exclusion blocks child negations). A second cause is a broader rule (e.g. \`*.js\` at root) hiding bundle files added by \`webjs vendor pin --download\`.`,
        fix:
          'Replace `.webjs/` in your .gitignore with this three-line pattern:\n' +
          '  **/.webjs/*\n' +
          '  !**/.webjs/vendor/\n' +
          '  !**/.webjs/vendor/**\n' +
          'The `**/` prefix ignores `.webjs/` at any depth (so a nested / monorepo app does not leak its generated `.webjs/routes.d.ts`) while still re-including the committed vendor pin. ' +
          'Verify with `git check-ignore -q .webjs/vendor/importmap.json` (exit 1 means correctly un-ignored).',
      };
    }
  }
  return {
    name: 'vendor-gitignore',
    status: 'pass',
    message: 'The .gitignore keeps .webjs/vendor/ committable.',
  };
}
