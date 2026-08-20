#!/usr/bin/env node
/**
 * Root `preinstall` reporter: name what an install in a LINKED worktree just did
 * to the PRIMARY checkout's `node_modules` (#1442).
 *
 * ## This reports, it never blocks, and that is deliberate
 *
 * Measured on npm 11.19.0 and bun 1.3.14, a `preinstall` script cannot PREVENT
 * the damage, so trying to make it a guard would be a guard in name only:
 *
 * - Under `npm install`, `preinstall` runs with `node_modules` ALREADY a real
 *   directory. npm replaced the symlink before the script started, so a
 *   `lstatSync('node_modules').isSymbolicLink()` check can never be true here.
 * - Under `npm ci`, `preinstall` runs with the primary's `node_modules` ALREADY
 *   emptied. npm deletes the link's TARGET first, so the destruction precedes
 *   any chance to stop it.
 * - Under `bun install` / `bun add`, `preinstall` runs BEFORE the write and does
 *   see the symlink, but a non-zero exit does not stop Bun (measured: `bun
 *   install` exited 0 with a `preinstall` that exited 2).
 * - A non-zero `preinstall` DOES block `npm install` and `npm ci`, exit code
 *   propagated verbatim, so a buggy guard here would red every CI job. The same
 *   reasoning is already written into `scripts/git-worktree-safe.mjs`.
 *
 * Blocking `npm install` would also leave the worktree with no symlink and a
 * half-built tree, which is worse than what it prevented. So the prevention
 * lives in `.claude/hooks/block-install-in-linked-worktree.sh`, which is the only
 * layer that runs before the package manager, and this script turns a silent
 * detach or a silently emptied primary into a named diagnosis with the repair.
 *
 * Silent and exit 0 in a normal clone, which is what CI has, because the first
 * thing it checks is whether `.git` is a FILE (the linked-worktree marker).
 */
import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

/** @param {string} msg */
const say = (msg) => console.error(`[warn-worktree-install] ${msg}`);

/**
 * Whether `dir` exists and holds at least one entry.
 * @param {string} dir
 * @returns {boolean}
 */
function hasEntries(dir) {
  try { return readdirSync(dir).length > 0; } catch { return false; }
}

try {
  // A linked worktree checks out `.git` as a FILE (a gitdir pointer). A normal
  // clone and the primary checkout both have a DIRECTORY, so they return here
  // and CI is untouched by construction.
  if (!statSync('.git').isFile()) process.exit(0);

  // `--git-common-dir` is `<primary>/.git` from any worktree, so the primary is
  // its parent. Same derivation as `defaultPrimary()` in link-worktree-deps.mjs.
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
  }).trim();
  const primary = resolve(dirname(common));
  const primaryModules = join(primary, 'node_modules');

  let linkStillStanding = false;
  let haveOwnModules = false;
  try {
    const st = lstatSync('node_modules');
    linkStillStanding = st.isSymbolicLink();
    haveOwnModules = st.isDirectory();
  } catch { /* no node_modules yet, nothing to report */ }

  if (linkStillStanding) {
    // The Bun shape: the link is intact, so the write is still ahead of us.
    say('this worktree\'s node_modules is a SYMLINK at the primary checkout:');
    say(`  ${primaryModules}`);
    say('An install now writes THROUGH that link, into a checkout you are not working in.');
    say('Stop it if you can. Use `npm run worktree:link` to set this worktree up, or');
    say('`rm node_modules` first if a real, self-contained install is what you want.');
  } else if (haveOwnModules && !hasEntries(primaryModules)) {
    // The `npm ci` aftermath: npm deleted the link's target before we ran.
    say('the PRIMARY checkout\'s node_modules is now EMPTY or missing:');
    say(`  ${primaryModules}`);
    say('An `npm ci` here deleted it through this worktree\'s node_modules symlink.');
    say(`Repair it with:  cd ${primary} && npm install`);
    say('Every other checkout resolving through the primary is broken until you do.');
  } else if (haveOwnModules) {
    // The `npm install` aftermath: the symlink was replaced by a real tree.
    say('this worktree now has its OWN node_modules, so the symlink at the primary');
    say('checkout is gone and the worktree no longer runs the primary\'s framework source.');
    say('That is fine if you meant it. To go back to the shared tree:');
    say('  rm -rf node_modules && npm run worktree:link');
  }
} catch {
  // Never let a reporter break an install. Any failure here is silence.
}

process.exit(0);
