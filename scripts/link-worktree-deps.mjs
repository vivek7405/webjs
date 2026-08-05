#!/usr/bin/env node
/**
 * Link a fresh git worktree's dependencies to the primary checkout's, so the
 * worktree can run the test suite without a full `npm install`.
 *
 * A git worktree does not copy `node_modules`, and this repo needs MORE than
 * the root one:
 *
 * - **Every nested `node_modules`**, not just the root. npm hoists what it can,
 *   but a workspace whose range conflicts with the hoisted copy keeps its own
 *   nested tree. `packages/server` is the live example: the root has `ws@7`
 *   (hoisted for another dependent) while `packages/server` declares `^8.20.0`
 *   and carries `ws@8` nested. Link only the root and `WebSocketServer`, a
 *   ws@8-only named export, resolves up to ws@7 and throws at module load,
 *   which surfaces as dozens of unrelated-looking failures across the server,
 *   integration, and smoke suites.
 * - **`packages/core/dist`**, which is gitignored and built rather than
 *   committed. Tests that import the built bundle cannot resolve it in a fresh
 *   worktree.
 *
 * Both sets are discovered from the primary checkout rather than hardcoded,
 * because the list changes whenever a package gains a nested tree.
 *
 * Safety rules, all of which exist because the naive version of this script
 * broke a worktree while it was being written:
 *
 * - Never delete or overwrite anything. A path that already exists is left
 *   alone, so a worktree with a real `npm install` is untouched and re-running
 *   is a no-op.
 * - Never create a dangling link. A source that does not exist is skipped,
 *   because a dangling `node_modules` resolves more confusingly than a missing
 *   one.
 * - Never treat `<primary>/node_modules` itself as a search root. Descending
 *   into it yields thousands of nested `node_modules` belonging to third-party
 *   packages, none of which should be linked.
 *
 * Usage, from inside the worktree:
 *
 *   node scripts/link-worktree-deps.mjs           # link from the default primary
 *   node scripts/link-worktree-deps.mjs <primary> # or name it explicitly
 *   npm run worktree:link
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

/** Directory names never worth descending into when hunting for nested trees. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.webjs', 'coverage']);

/**
 * Collect every directory under `root` that has its own `node_modules`,
 * returned as paths relative to `root`. Never descends INTO a `node_modules`.
 *
 * @param {string} root
 * @param {number} [maxDepth] how many directory levels below root to search
 * @returns {string[]} relative paths of the `node_modules` directories
 */
function findNodeModules(root, maxDepth = 4) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir @param {number} depth */
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      if (e.name === 'node_modules') { out.push(relative(root, join(dir, e.name))); continue; }
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walk(join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/**
 * Create one symlink, refusing every unsafe case.
 *
 * @param {string} src absolute path in the primary checkout
 * @param {string} dst absolute path in this worktree
 * @param {string} label what to print on success
 * @returns {'linked' | 'exists' | 'missing-source'}
 */
function link(src, dst, label) {
  if (!existsSync(src)) return 'missing-source';
  // lstat, not existsSync: a dangling symlink left by an earlier run must count
  // as present so we neither clobber it nor silently stack a second link.
  try { lstatSync(dst); return 'exists'; } catch { /* not there, good */ }
  mkdirSync(dirname(dst), { recursive: true });
  symlinkSync(src, dst, 'junction');
  console.log(`  linked ${label}`);
  return 'linked';
}

/** @returns {string} absolute path of the primary checkout */
function defaultPrimary() {
  // The common dir of a linked worktree is `<primary>/.git/worktrees/<name>`,
  // so the primary checkout is three levels up from it. In the primary itself
  // the common dir is just `<primary>/.git`.
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
  }).trim();
  return resolve(dirname(common));
}

const here = process.cwd();
const primary = resolve(process.argv[2] || defaultPrimary());

if (primary === here) {
  console.log('[link-worktree-deps] this IS the primary checkout, nothing to link.');
  process.exit(0);
}
if (!existsSync(join(primary, 'package.json'))) {
  console.error(`[link-worktree-deps] not a checkout: ${primary}`);
  process.exit(1);
}

console.log(`[link-worktree-deps] linking from ${primary}`);

let linked = 0;
let skipped = 0;
for (const rel of findNodeModules(primary)) {
  const r = link(join(primary, rel), join(here, rel), rel);
  if (r === 'linked') linked += 1; else skipped += 1;
}

// `packages/core/dist` is built, not committed, so a fresh worktree has none
// and any test importing the built bundle fails to resolve it.
for (const rel of ['packages/core/dist']) {
  const r = link(join(primary, rel), join(here, rel), rel);
  if (r === 'linked') linked += 1;
  else if (r === 'missing-source') console.log(`  skipped ${rel} (not built in the primary; run npm run build there)`);
  else skipped += 1;
}

console.log(`[link-worktree-deps] ${linked} linked, ${skipped} already present.`);
