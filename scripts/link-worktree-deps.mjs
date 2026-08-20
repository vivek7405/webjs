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
 * The `node_modules` set is discovered from the primary checkout rather than
 * hardcoded, because it changes whenever a package gains a nested tree. The
 * `packages/core/dist` entry is an explicit one-off, since it is the only built
 * output the suite imports.
 *
 * ## What this does NOT give you
 *
 * The worktree runs the PRIMARY checkout's framework source through every bare
 * `@webjsdev/*` specifier. `<primary>/node_modules/@webjsdev/core` is a relative
 * symlink into `<primary>/packages/core`, so resolving through the linked root
 * lands in the primary, not here. Relative imports (`../../../src/x.js`) and the
 * browser suite, which web-test-runner serves from this worktree, do use the
 * worktree's own files.
 *
 * So this makes the suite RUNNABLE, not self-testing. If you are editing
 * `packages/core/src` or `packages/server/src` and need a bare-specifier
 * consumer to exercise YOUR copy, delete the `node_modules` SYMLINK first
 * (`rm node_modules`, it is only a link and nothing else is lost) and then
 * install, or point the individual `@webjsdev/<pkg>` entries at this worktree
 * instead. CI always builds from the branch, so it is unaffected either way.
 *
 * NEVER install while the link is standing (#1442). Measured on npm 11.19.0 and
 * bun 1.3.14: `npm ci` DELETES the primary's whole `node_modules` through the
 * link before any lifecycle script runs, `bun install` writes packages into the
 * primary through it, and `npm install` silently replaces the link with a real
 * tree. All three land on a checkout you are not working in, so the failure
 * surfaces in someone else's session with nothing naming the cause.
 *
 * Safety rules, all of which exist because the naive version of this script
 * broke a worktree while it was being written:
 *
 * - Never delete or overwrite anything, with ONE exception: the repair pass over
 *   `<primary>/node_modules/@webjsdev/` replaces a link that is ALREADY wrong
 *   (dangling, or resolving outside the primary) and removes a DANGLING
 *   `.name-HASH` npm staging entry. It never touches a real directory, never
 *   touches a link that is already correct, and never removes a staging entry
 *   that still resolves. Outside that pass, a path that already exists is left
 *   alone, so a worktree with a real `npm install` is untouched and re-running
 *   is a no-op.
 * - Never create a dangling link. A source that does not exist is skipped,
 *   because a dangling `node_modules` resolves more confusingly than a missing
 *   one, and the repair pass declines to repoint when the corrected target is
 *   missing.
 * - Never treat `<primary>/node_modules` itself as a search root. Descending
 *   into it yields thousands of nested `node_modules` belonging to third-party
 *   packages, none of which should be linked.
 *
 * Usage, from inside the worktree:
 *
 *   node scripts/link-worktree-deps.mjs           # link from the default primary
 *   node scripts/link-worktree-deps.mjs <primary> # or name it explicitly
 *   node scripts/link-worktree-deps.mjs --check   # report repairs, change nothing
 *   npm run worktree:link
 *   npm run check:worktree-links
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

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

/**
 * Map every workspace package NAME to its directory, relative to `primary`.
 *
 * The mapping cannot be derived from the entry name. `@webjsdev/example-blog`
 * lives at `examples/blog`, `@webjsdev/ui-registry` at
 * `packages/ui/packages/registry`, and `@webjsdev/intellisense` at
 * `packages/editors/intellisense`, so a `packages/<name>` guess would repoint
 * half the tree at directories that do not exist.
 *
 * @param {string} primary
 * @returns {Map<string, string>} package name to directory relative to `primary`
 */
function workspacePackageDirs(primary) {
  /** @type {Map<string, string>} */
  const out = new Map();
  /** @type {string[]} */
  let patterns = [];
  try {
    patterns = JSON.parse(readFileSync(join(primary, 'package.json'), 'utf8')).workspaces || [];
  } catch { return out; }

  /** @type {string[]} */
  const dirs = [];
  for (const pattern of patterns) {
    if (!pattern.endsWith('/*')) { dirs.push(pattern); continue; }
    const parent = pattern.slice(0, -2);
    let entries;
    try { entries = readdirSync(join(primary, parent), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) if (e.isDirectory()) dirs.push(`${parent}/${e.name}`);
  }

  for (const rel of dirs) {
    try {
      const name = JSON.parse(readFileSync(join(primary, rel, 'package.json'), 'utf8')).name;
      if (typeof name === 'string' && name) out.set(name, rel);
    } catch { /* not a package, skip */ }
  }
  return out;
}

/** npm's staging name for a package it is mid-reify on, `.name-HASH`. */
const STAGING = /^\.(.+)-[A-Za-z0-9_-]{8}$/;

/**
 * Repair `<primary>/node_modules/@webjsdev/`, which an install run inside a
 * LINKED worktree corrupts (#1442).
 *
 * Three defect classes, all produced by the same accident and all repaired to
 * the same relative form the healthy tree uses:
 *
 * - a link that DANGLES, usually into a worktree that has since been removed;
 * - a link that resolves OUTSIDE the primary, into a live foreign checkout,
 *   which is the worst case because it resolves fine and silently runs another
 *   branch's framework source;
 * - a link that resolves inside the primary but is ABSOLUTE where every sibling
 *   is relative, which is the same corruption pattern pointing at the right
 *   place by accident.
 *
 * A LIVE `.name-HASH` staging entry is left strictly alone. Most of them resolve
 * to real in-repo directories, nothing imports `@webjsdev/.ui-tVBcnl39`, at least
 * one predates a package rename so its name maps to no current workspace, and
 * deleting a live entry risks racing an install that is mid-reify. Only an
 * UNUSABLE one, meaning staging-shaped AND dangling, is removed.
 *
 * Writes are atomic (symlink to a temp name, then rename over), because
 * `npm test` resolves `@webjsdev/*` from many processes at once and an entry
 * that briefly does not exist would fail one of them.
 *
 * @param {string} primary
 * @param {{ check?: boolean }} [opts] `check` reports without changing anything
 * @returns {{ repaired: string[], removed: string[], reported: string[] }}
 */
function repairPrimaryFrameworkLinks(primary, opts = {}) {
  const check = opts.check === true;
  const scope = join(primary, 'node_modules', '@webjsdev');
  /** @type {{ repaired: string[], removed: string[], reported: string[] }} */
  const out = { repaired: [], removed: [], reported: [] };

  let entries;
  try { entries = readdirSync(scope, { withFileTypes: true }); } catch { return out; }

  let primaryReal = primary;
  try { primaryReal = realpathSync(primary); } catch { /* use it as given */ }
  const workspaces = workspacePackageDirs(primary);
  const removeVerb = check ? 'would remove' : 'removed';
  const pointVerb = check ? 'would repoint' : 'repointed';

  for (const e of entries) {
    // A real directory here is somebody's deliberate install, never ours to touch.
    if (!e.isSymbolicLink()) continue;

    const entry = join(scope, e.name);
    let target;
    try { target = readlinkSync(entry); } catch { continue; }
    const absTarget = resolve(scope, target);
    const dangling = !existsSync(absTarget);

    if (STAGING.test(e.name)) {
      if (!dangling) continue;
      if (!check) { try { rmSync(entry, { force: true }); } catch { continue; } }
      out.removed.push(e.name);
      console.log(`[link-worktree-deps] ${removeVerb} dangling npm staging entry @webjsdev/${e.name}`);
      continue;
    }

    const rel = workspaces.get(`@webjsdev/${e.name}`);
    if (!rel) {
      if (!dangling) continue;
      out.reported.push(e.name);
      console.log(`[link-worktree-deps] @webjsdev/${e.name} dangles and matches no workspace package; left alone.`);
      continue;
    }

    const correct = join(primary, rel);
    const desired = relative(scope, correct);
    if (target === desired) continue;

    let outside = false;
    try { outside = !realpathSync(absTarget).startsWith(primaryReal + sep); } catch { outside = true; }
    if (!dangling && !outside && !isAbsolute(target)) continue;

    // A race guard, not a normal path: `workspacePackageDirs()` only maps a
    // package whose `package.json` it just read, so `correct` exists unless the
    // directory went away in between. Repointing at a missing path would trade
    // one dangling link for another, which the safety rules forbid outright.
    if (!existsSync(correct)) {
      out.reported.push(e.name);
      console.log(`[link-worktree-deps] @webjsdev/${e.name} points at ${target}, but ${rel} is missing here; left alone.`);
      continue;
    }

    if (!check) {
      const tmp = `${entry}.tmp-${process.pid}`;
      try {
        rmSync(tmp, { force: true });
        symlinkSync(desired, tmp);
        renameSync(tmp, entry);
      } catch {
        try { rmSync(tmp, { force: true }); } catch { /* nothing staged */ }
        out.reported.push(e.name);
        console.log(`[link-worktree-deps] could not repair @webjsdev/${e.name}; left alone.`);
        continue;
      }
    }
    out.repaired.push(e.name);
    const why = dangling ? 'dangling' : (outside ? 'foreign' : 'absolute');
    console.log(`[link-worktree-deps] ${pointVerb} ${why} @webjsdev/${e.name} -> ${desired}`);
  }

  return out;
}

/** @returns {string} absolute path of the primary checkout */
function defaultPrimary() {
  // `--git-common-dir` is `<primary>/.git` from ANY worktree, linked or not
  // (the per-worktree `.git/worktrees/<name>` path is what `--git-dir` gives),
  // so the primary checkout is its parent.
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
  }).trim();
  return resolve(dirname(common));
}

/**
 * Where the blog's SQLite file lives, resolved the way the blog itself resolves
 * it.
 *
 * `examples/blog/db/connection.server.ts` and `examples/blog/drizzle.config.ts`
 * both read `DATABASE_URL` and fall back to `db/dev.db`, and `db:migrate` /
 * `db:seed` inherit this process's env, so probing a hardcoded `db/dev.db`
 * would check a different file than the one those commands write whenever
 * `DATABASE_URL` is set. The probe would then always miss, and the
 * already-seeded fast path below could never fire.
 *
 * @param {string} blogDir absolute path to `examples/blog`
 * @returns {string} absolute path of the database file
 */
function blogDbPath(blogDir) {
  const fromEnv = process.env.DATABASE_URL?.replace(/^file:/, '');
  return resolve(blogDir, fromEnv || join('db', 'dev.db'));
}

/**
 * How many rows the blog's `posts` table has, or `null` when the table or the
 * database file is not there yet.
 *
 * Read-only and dependency-free. `node:sqlite` is built in on this repo's Node
 * 24+ floor, and `examples/blog/db/connection.server.ts` already opens the same
 * database through it, so this adds nothing to install and nothing to resolve.
 *
 * @param {string} dbPath
 * @returns {Promise<number|null>}
 */
async function countBlogPosts(dbPath) {
  if (!existsSync(dbPath)) return null;
  let db;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(dbPath, { readOnly: true });
    const row = /** @type {{ n: number }} */ (db.prepare('select count(*) as n from posts').get());
    return Number(row.n);
  } catch {
    // A missing `posts` table (a file created by `webjs db migrate` before the
    // migrations ran, or a half-written one) reads the same as no rows for our
    // purposes: the blog has nothing to serve.
    return null;
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

/**
 * Bring `examples/blog`'s SQLite database up to a state the blog tests can use.
 *
 * `examples/blog/db/dev.db` is gitignored, so a worktree starts with none and
 * three blog tests plus their enclosing suite fail on an empty `posts` table
 * with nothing in the output naming the database (#1323). CI never sees it,
 * because all four jobs that boot the blog run `db:migrate` + `db:seed` first.
 *
 * The guard is "the blog has no posts", NOT "the database file is missing".
 * `examples/blog/package.json` runs `webjs db migrate` as both a
 * `webjs.dev.before` and a `webjs.start.before` step, so booting the blog once
 * creates the file with an empty `posts` table and a file-existence guard would
 * skip forever. Rails' `db:prepare` has the same shape (seed only an
 * uninitialized database); only the probe differs, because there nothing but
 * `db:prepare` creates the file and here two other commands do.
 *
 * Never destructive. `webjs db migrate` only applies pending migrations, and
 * `db/seed.server.ts` is insert-or-skip on `users.email` / `posts.slug`, so a
 * database that already has rows is left exactly as it was.
 *
 * @param {string} blogDir absolute path to this worktree's `examples/blog`
 * @returns {Promise<void>}
 */
async function seedBlogDatabase(blogDir) {
  // The synthetic checkouts in the repo-health tests have no blog, and neither
  // would a future repo layout that moved it. Nothing to do either way.
  if (!existsSync(join(blogDir, 'package.json'))) return;

  const posts = await countBlogPosts(blogDbPath(blogDir));
  if (posts !== null && posts > 0) {
    console.log(`[link-worktree-deps] blog database already has ${posts} posts, leaving it alone.`);
    return;
  }

  console.log('[link-worktree-deps] seeding the blog database (examples/blog)...');
  for (const script of ['db:migrate', 'db:seed']) {
    // `shell` on Windows, where npm is `npm.cmd` and Node has refused to spawn
    // a `.cmd` without one since the CVE-2024-27980 fix. Both arguments are
    // literals from the array above, so there is nothing for a shell to expand.
    const r = spawnSync('npm', ['run', script], {
      cwd: blogDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (r.status === 0) continue;
    const why = r.error ? r.error.message : (r.status === null ? `signal ${r.signal}` : `exit ${r.status}`);
    console.error(`[link-worktree-deps] WARNING: npm run ${script} failed in examples/blog (${why}).`);
    console.error('[link-worktree-deps] Linking succeeded. Three blog tests and their enclosing suite will fail until you run, from examples/blog, npm run db:migrate then npm run db:seed.');
    return;
  }
  console.log('[link-worktree-deps] blog database seeded.');
}

const here = process.cwd();
const CHECK = process.argv.includes('--check');
// Filter the flag out of the positional argument, or `resolve('--check')` is
// read as the primary path and the script reports on a directory named `--check`.
const positional = process.argv.slice(2).filter((a) => a !== '--check');
const primary = resolve(positional[0] || defaultPrimary());

// The checkout check sits ABOVE the primary-is-here guard, because the repair
// below targets the PRIMARY and must run whether or not this checkout is it.
if (!existsSync(join(primary, 'package.json'))) {
  console.error(`[link-worktree-deps] not a checkout: ${primary}`);
  process.exit(1);
}

// FIRST, so `npm run worktree:link` heals the primary from a worktree AND a bare
// run or `--check` heals it from the primary itself. `WEBJS_NO_WORKTREE_REPAIR=1`
// is why the `defaultPrimary()` test can run this against the real checkout
// without mutating it, exactly as `WEBJS_NO_WORKTREE_SEED=1` does for seeding.
let touched = 0;
// The hatch suppresses the repair WRITE. `--check` never writes, so there is
// nothing for it to suppress there, and skipping the inspection too would make
// `check:worktree-links` exit 0 reporting a clean tree it never looked at.
if (process.env.WEBJS_NO_WORKTREE_REPAIR === '1' && !CHECK) {
  console.log('[link-worktree-deps] framework-link repair skipped (WEBJS_NO_WORKTREE_REPAIR=1).');
} else {
  const repair = repairPrimaryFrameworkLinks(primary, { check: CHECK });
  touched = repair.repaired.length + repair.removed.length;
  if (CHECK) {
    console.log(`[link-worktree-deps] --check: ${touched} entr${touched === 1 ? 'y' : 'ies'} to repair, ${repair.reported.length} reported.`);
  }
}

// `--check` is READ-ONLY and TERMINAL, unconditionally. This exit sits OUTSIDE
// the branch above on purpose: nested inside the `else`, a run with BOTH
// `--check` and `WEBJS_NO_WORKTREE_REPAIR=1` fell through to the linking loop
// and the seed step, so the one combination documented as changing nothing was
// the one that wrote. Linking is a mutation, so `--check` must never reach it.
if (CHECK) process.exit(touched > 0 ? 1 : 0);

if (primary === here) {
  console.log('[link-worktree-deps] this IS the primary checkout, nothing to link.');
  process.exit(0);
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

// LAST, after the links: `npm run db:migrate` resolves the `webjs` bin through
// the root `node_modules/.bin` the loops above just linked, so this cannot run
// earlier. Being below the `primary === here` guard keeps it out of the primary
// checkout, but that guard is NOT what keeps it out of the test suite: the
// `defaultPrimary()` test in `test/repo-health/link-worktree-deps.test.mjs`
// runs this script bare against its own cwd, and from a linked worktree (the
// mandated workflow) that cwd is a worktree, so the guard does not fire. That
// test sets `WEBJS_NO_WORKTREE_SEED=1` for exactly this reason. Without it,
// `npm test` would migrate and seed the blog database as a side effect, racing
// `test/integration/blog-http.test.mjs`, which reads the same file in parallel.
if (process.env.WEBJS_NO_WORKTREE_SEED === '1') {
  console.log('[link-worktree-deps] blog database seeding skipped (WEBJS_NO_WORKTREE_SEED=1).');
} else {
  await seedBlogDatabase(join(here, 'examples', 'blog'));
}
