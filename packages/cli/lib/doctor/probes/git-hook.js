import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {import('../codes.js').DoctorResult} DoctorResult
 */

/**
 * CHECK 6 (optional), git pre-commit hook installed + executable. WARN when the
 * repo is a git checkout but `.git/hooks/pre-commit` is absent or
 * non-executable, since the test-gate / changelog hook would not fire. PASS when
 * present + executable, or skip (PASS) when this is not a git checkout at all
 * (an exported tarball, a non-repo dir). Respects a configured `core.hooksPath`
 * is OUT of scope here: the common scaffold installs into `.git/hooks`, so this
 * checks the default location and a configured path is the user's own concern.
 * @param {string} appDir
 * @returns {DoctorResult}
 */
export function checkGitHook(appDir) {
  const gitDir = join(appDir, '.git');
  if (!existsSync(gitDir)) {
    return {
      name: 'git-hook',
      status: 'pass',
      message: 'Not a git checkout; no pre-commit hook expected.',
    };
  }
  const hook = join(gitDir, 'hooks', 'pre-commit');
  if (!existsSync(hook)) {
    return {
      name: 'git-hook',
      status: 'warn',
      message: 'No .git/hooks/pre-commit hook installed.',
      fix: 'Install the project hooks (e.g. `npm install` runs the prepare step that wires them).',
    };
  }
  let executable = false;
  try {
    // Owner-execute bit. On a checkout without exec bits (some Windows / CI
    // setups) the hook will not run, so flag it.
    executable = (statSync(hook).mode & 0o100) !== 0;
  } catch {
    executable = false;
  }
  if (!executable) {
    return {
      name: 'git-hook',
      status: 'warn',
      message: '.git/hooks/pre-commit exists but is not executable.',
      fix: 'chmod +x .git/hooks/pre-commit',
    };
  }
  return {
    name: 'git-hook',
    status: 'pass',
    message: '.git/hooks/pre-commit is installed and executable.',
  };
}
