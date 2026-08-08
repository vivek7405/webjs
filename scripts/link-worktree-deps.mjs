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
 * consumer to exercise YOUR copy, run a real `npm install` in the worktree, or
 * point the individual `@webjsdev/<pkg>` entries at this worktree instead. CI
 * always builds from the branch, so it is unaffected either way.
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
