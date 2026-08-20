/**
 * `scripts/link-worktree-deps.mjs` links a fresh worktree's dependencies to the
 * primary checkout's (#1287) and seeds the blog database in a fresh worktree (#1323).
 *
 * The behaviours asserted here are the ones whose absence produced real
 * breakage while the script was written: linking only the ROOT `node_modules`
 * leaves a ws version skew that fails hundreds of assertions elsewhere, a
 * naive implementation clobbered a git-tracked directory that happened to be
 * named `node_modules`, and an unseeded worktree leaves four blog tests failing
 * locally without naming the database.
 *
 * These drive the script as a subprocess against a synthetic "primary" and
 * "worktree" pair in a temp dir, so nothing touches the real checkout.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, lstatSync, readlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SCRIPT = fileURLToPath(new URL('../../scripts/link-worktree-deps.mjs', import.meta.url));

/** Build a fake primary checkout with the nested-tree shape this repo has. */
function makePrimary() {
  const root = mkdtempSync(join(tmpdir(), 'wjprimary-'));
  writeFileSync(join(root, 'package.json'), '{"name":"fake-primary"}');
  for (const d of [
    'node_modules/ws',
    'packages/server/node_modules/ws',
    'packages/ui/node_modules',
    'website/node_modules',
    'packages/core/dist',
  ]) mkdirSync(join(root, d), { recursive: true });
  // a third-party package with its OWN nested node_modules, which must never
  // be treated as a link target
  mkdirSync(join(root, 'node_modules/some-dep/node_modules/inner'), { recursive: true });
  return root;
}

function makeWorktree({ blog = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wjworktree-'));
  writeFileSync(join(root, 'package.json'), '{"name":"fake-worktree"}');
  mkdirSync(join(root, 'packages/server'), { recursive: true });
  if (blog) {
    mkdirSync(join(root, 'examples/blog/db'), { recursive: true });
    writeFileSync(
      join(root, 'examples/blog/package.json'),
      JSON.stringify({
        name: 'fake-blog',
        scripts: {
          'db:migrate': 'node -e "require(\'fs\').appendFileSync(\'db/ran.log\', \'migrate\\n\')"',
          'db:seed': 'node -e "require(\'fs\').appendFileSync(\'db/ran.log\', \'seed\\n\')"',
        },
      }),
    );
  }
  return root;
}

/**
 * The ambient env, minus the two variables that would make these tests report
 * on the developer's shell rather than on the script.
 *
 * `WEBJS_NO_WORKTREE_SEED=1` is documented in AGENTS.md and framework-dev.md as
 * the supported opt-out, so a developer or agent may well have it exported. The
 * seed tests below assert that seeding HAPPENS, and would silently invert into
 * failures for that person. Only the test that opts in passes it explicitly.
 *
 * `WEBJS_NO_WORKTREE_REPAIR=1` is stripped for the same reason: the repair tests
 * below assert that repair HAPPENS, and an exported opt-out would turn every one
 * of them into a vacuous pass.
 *
 * `DATABASE_URL` is stripped for the same reason: the script now resolves the
 * database path the way the blog does, so an exported value would point the
 * probe outside the synthetic worktree these tests build.
 *
 * @param {Record<string, string>} [env] overrides, applied after the strip
 * @returns {NodeJS.ProcessEnv}
 */
function cleanEnv(env = {}) {
  const { WEBJS_NO_WORKTREE_SEED: _seed, WEBJS_NO_WORKTREE_REPAIR: _repair, DATABASE_URL: _db, ...rest } = process.env;
  return { ...rest, ...env };
}

/** @returns {string} combined stdout of the script run inside `cwd` */
function run(cwd, primary) {
  return execFileSync(process.execPath, [SCRIPT, primary], { cwd, encoding: 'utf8', env: cleanEnv() });
}

/** @returns {{ status: number|null, stdout: string, stderr: string }} */
function runWithResult(cwd, primary, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, primary], {
    cwd,
    encoding: 'utf8',
    env: cleanEnv(env),
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

describe('link-worktree-deps (#1287)', () => {
  test('links the nested node_modules, not just the root', () => {
    const primary = makePrimary();
    const wt = makeWorktree();
    try {
      run(wt, primary);
      // The root alone is the trap this whole script exists to close.
      assert.ok(lstatSync(join(wt, 'node_modules')).isSymbolicLink(), 'root linked');
      assert.ok(
        lstatSync(join(wt, 'packages/server/node_modules')).isSymbolicLink(),
        'packages/server nested node_modules linked (the ws@7 vs ws@8 skew)',
      );
      assert.ok(lstatSync(join(wt, 'packages/ui/node_modules')).isSymbolicLink(), 'packages/ui linked');
      assert.ok(lstatSync(join(wt, 'website/node_modules')).isSymbolicLink(), 'website linked');
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('links packages/core/dist, which is built and not committed', () => {
    const primary = makePrimary();
    const wt = makeWorktree();
    try {
      run(wt, primary);
      assert.ok(lstatSync(join(wt, 'packages/core/dist')).isSymbolicLink(), 'core dist linked');
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('never descends into node_modules looking for more node_modules', () => {
    const primary = makePrimary();
    const wt = makeWorktree();
    try {
      const out = run(wt, primary);
      // Assert on what the script CLAIMS to have linked, not on the filesystem:
      // the worktree's `node_modules` is a symlink to the primary's, so a
      // third-party nested tree is visible THROUGH it either way, and an
      // existsSync check here passes for the wrong reason.
      const linkedPaths = out.split('\n').filter((l) => l.includes('linked ')).map((l) => l.trim());
      for (const l of linkedPaths) {
        assert.equal(
          (l.match(/node_modules/g) || []).length <= 1,
          true,
          `must not link a tree nested inside node_modules, got: ${l}`,
        );
      }
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('is idempotent and never clobbers a real install', () => {
    const primary = makePrimary();
    const wt = makeWorktree();
    try {
      // a REAL directory where a link would otherwise go, as if npm install ran
      mkdirSync(join(wt, 'node_modules/already-here'), { recursive: true });
      const out = run(wt, primary);
      assert.ok(!lstatSync(join(wt, 'node_modules')).isSymbolicLink(), 'real node_modules left as a directory');
      assert.ok(existsSync(join(wt, 'node_modules/already-here')), 'existing contents untouched');
      assert.match(out, /already present/, 'reports it skipped something');
      // second run changes nothing
      const out2 = run(wt, primary);
      assert.match(out2, /0 linked/, 're-running links nothing new');
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('skips a source that does not exist rather than creating a dangling link', () => {
    const primary = makePrimary();
    const wt = makeWorktree();
    try {
      rmSync(join(primary, 'packages/core/dist'), { recursive: true, force: true });
      const out = run(wt, primary);
      assert.ok(!existsSync(join(wt, 'packages/core/dist')), 'no dist link created');
      let dangling = false;
      try { dangling = lstatSync(join(wt, 'packages/core/dist')).isSymbolicLink(); } catch { /* absent, good */ }
      assert.equal(dangling, false, 'a dangling link resolves more confusingly than a missing one');
      assert.match(out, /not built in the primary/, 'says why it skipped');
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('defaultPrimary() resolves the real primary from this checkout', () => {
    // Every other test passes `primary` as argv[2], so without this the
    // git-derived default branch never executes at all.
    //
    // This is the ONE test that runs the script against a real checkout, so it
    // must neither seed nor repair. Run from the primary the `primary === here`
    // guard stops the seeding, but run from a linked worktree (the mandated
    // workflow) that guard does not fire, and the script would migrate and seed
    // that worktree's blog database as a side effect of `npm test`, concurrently
    // with `blog-http.test.mjs` reading the same file. The repair pass sits ABOVE
    // that guard by design, so it runs in BOTH positions and would rewrite the
    // real primary's `@webjsdev/*` links here. The two escape hatches are what
    // actually keep this test off the developer's checkout.
    const out = execFileSync(process.execPath, [SCRIPT], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, WEBJS_NO_WORKTREE_SEED: '1', WEBJS_NO_WORKTREE_REPAIR: '1' },
    });
    // Run from the repo itself, so it must recognise the primary and no-op
    // rather than linking anything.
    assert.match(out, /this IS the primary checkout|linking from \//);
  });

  test('refuses to link a checkout to itself', () => {
    const primary = makePrimary();
    try {
      const out = run(primary, primary);
      assert.match(out, /this IS the primary checkout/);
      assert.ok(!lstatSync(join(primary, 'node_modules')).isSymbolicLink(), 'root untouched');
    } finally { rmSync(primary, { recursive: true, force: true }); }
  });

  test('leaves an existing symlink alone instead of stacking a second one', () => {
    const primary = makePrimary();
    const wt = makeWorktree();
    try {
      symlinkSync(join(primary, 'node_modules'), join(wt, 'node_modules'));
      run(wt, primary);
      assert.equal(readlinkSync(join(wt, 'node_modules')), join(primary, 'node_modules'));
      assert.ok(!existsSync(join(wt, 'node_modules/node_modules')), 'no link nested inside the existing one');
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('seeds the blog database when the worktree has no posts (#1323)', () => {
    const primary = makePrimary();
    const wt = makeWorktree({ blog: true });
    try {
      const out = run(wt, primary);
      assert.match(out, /seeding the blog database/);
      assert.match(out, /blog database seeded/);
      assert.equal(
        readFileSync(join(wt, 'examples/blog/db/ran.log'), 'utf8'),
        'migrate\nseed\n',
      );
    } finally {
      rmSync(primary, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });

  test('seeds a migrated-but-empty database, not just a missing file (#1323)', () => {
    const primary = makePrimary();
    const wt = makeWorktree({ blog: true });
    try {
      const dbPath = join(wt, 'examples/blog/db/dev.db');
      const db = new DatabaseSync(dbPath);
      db.exec('create table posts (id integer primary key)');
      db.close();
      const out = run(wt, primary);
      assert.match(out, /seeding the blog database/);
      assert.equal(
        readFileSync(join(wt, 'examples/blog/db/ran.log'), 'utf8'),
        'migrate\nseed\n',
      );
    } finally {
      rmSync(primary, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });

  test('leaves a database that already has posts alone (#1323)', () => {
    const primary = makePrimary();
    const wt = makeWorktree({ blog: true });
    try {
      const dbPath = join(wt, 'examples/blog/db/dev.db');
      const db = new DatabaseSync(dbPath);
      db.exec('create table posts (id integer primary key, title text)');
      db.exec("insert into posts (title) values ('hello')");
      db.close();
      const out = run(wt, primary);
      assert.match(out, /already has 1 posts, leaving it alone/);
      assert.equal(existsSync(join(wt, 'examples/blog/db/ran.log')), false);
    } finally {
      rmSync(primary, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });

  test('warns and still exits 0 when seeding fails (#1323)', () => {
    const primary = makePrimary();
    const wt = makeWorktree({ blog: true });
    writeFileSync(
      join(wt, 'examples/blog/package.json'),
      JSON.stringify({
        name: 'fake-blog',
        scripts: {
          'db:migrate': 'node -e "process.exit(3)"',
          'db:seed': 'node -e "process.exit(0)"',
        },
      }),
    );
    try {
      const res = runWithResult(wt, primary);
      assert.equal(res.status, 0, 'link script exits 0 on seed warning');
      assert.match(res.stderr, /WARNING: npm run db:migrate failed in examples\/blog/);
      assert.match(res.stderr, /npm run db:migrate then npm run db:seed/);
    } finally {
      rmSync(primary, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });

  test('WEBJS_NO_WORKTREE_SEED=1 skips the seed step entirely (#1323)', () => {
    const primary = makePrimary();
    const wt = makeWorktree({ blog: true });
    try {
      const res = runWithResult(wt, primary, { WEBJS_NO_WORKTREE_SEED: '1' });
      assert.equal(res.status, 0);
      assert.match(res.stdout, /blog database seeding skipped \(WEBJS_NO_WORKTREE_SEED=1\)/);
      assert.equal(existsSync(join(wt, 'examples/blog/db/dev.db')), false);
      assert.equal(existsSync(join(wt, 'examples/blog/db/ran.log')), false);
    } finally {
      rmSync(primary, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });

  test('probes the DATABASE_URL path, not a hardcoded db/dev.db (#1323)', () => {
    // `db:migrate` and `db:seed` inherit this env var and the blog resolves it,
    // so a probe of a hardcoded `db/dev.db` would miss every time it is set and
    // the already-seeded fast path could never fire.
    const primary = makePrimary();
    const wt = makeWorktree({ blog: true });
    try {
      const dbPath = join(wt, 'examples/blog/db/custom.db');
      const db = new DatabaseSync(dbPath);
      db.exec('create table posts (id integer primary key, title text)');
      db.exec("insert into posts (title) values ('hello')");
      db.close();
      const res = runWithResult(wt, primary, { DATABASE_URL: 'file:./db/custom.db' });
      assert.equal(res.status, 0);
      assert.match(res.stdout, /already has 1 posts, leaving it alone/);
      assert.equal(existsSync(join(wt, 'examples/blog/db/ran.log')), false, 'no reseed');
    } finally {
      rmSync(primary, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });

  test('never seeds in the primary checkout (#1323)', () => {
    const primary = makePrimary();
    mkdirSync(join(primary, 'examples/blog/db'), { recursive: true });
    writeFileSync(
      join(primary, 'examples/blog/package.json'),
      JSON.stringify({
        name: 'fake-blog-primary',
        scripts: {
          'db:migrate': 'node -e "require(\'fs\').appendFileSync(\'db/ran.log\', \'migrate\\n\')"',
          'db:seed': 'node -e "require(\'fs\').appendFileSync(\'db/ran.log\', \'seed\\n\')"',
        },
      }),
    );
    try {
      const out = run(primary, primary);
      assert.match(out, /this IS the primary checkout/);
      assert.equal(existsSync(join(primary, 'examples/blog/db/ran.log')), false);
    } finally {
      rmSync(primary, { recursive: true, force: true });
    }
  });
});


/**
 * The repair pass over `<primary>/node_modules/@webjsdev/` (#1442).
 *
 * An install run inside a LINKED worktree acts on the PRIMARY, and leaves links
 * that dangle, resolve into a foreign checkout, or resolve inside the primary
 * but absolutely where every sibling is relative. All three are repaired to the
 * relative form. A LIVE `.name-HASH` npm staging entry is deliberately NOT
 * touched, because most of them resolve fine and deleting one risks racing an
 * install that is mid-reify.
 */
describe('framework-link repair (#1442)', () => {
  /**
   * A primary whose `packages/` holds real workspace packages, so
   * `workspacePackageDirs()` has something to map, plus a `@webjsdev` scope to
   * plant broken links in.
   */
  function makeRepairPrimary() {
    const root = mkdtempSync(join(tmpdir(), 'wjrepair-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'fake-primary',
      workspaces: ['packages/*', 'examples/*'],
    }));
    mkdirSync(join(root, 'node_modules/@webjsdev'), { recursive: true });
    for (const [dir, name] of [
      ['packages/core', '@webjsdev/core'],
      ['packages/server', '@webjsdev/server'],
      ['packages/cli', '@webjsdev/cli'],
      ['packages/ui', '@webjsdev/ui'],
      ['examples/blog', '@webjsdev/example-blog'],
    ]) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, 'package.json'), JSON.stringify({ name }));
    }
    return root;
  }

  const scopeOf = (primary) => join(primary, 'node_modules/@webjsdev');
  const plant = (primary, name, target) => symlinkSync(target, join(scopeOf(primary), name));

  test('repoints a DANGLING link to the relative in-primary path', () => {
    const primary = makeRepairPrimary();
    const wt = makeWorktree();
    try {
      plant(primary, 'core', '/nonexistent/gone-worktree/packages/core');
      run(wt, primary);
      // COUNTERFACTUAL: without the repair pass this still reads the dead
      // absolute path, so `existsSync` on the resolved entry is false.
      assert.equal(readlinkSync(join(scopeOf(primary), 'core')), '../../packages/core');
      assert.ok(existsSync(join(scopeOf(primary), 'core')), 'the repaired link resolves');
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('repoints a link that resolves OUTSIDE the primary, into a live foreign checkout', () => {
    const primary = makeRepairPrimary();
    const foreign = makeRepairPrimary();
    const wt = makeWorktree();
    try {
      plant(primary, 'server', join(foreign, 'packages/server'));
      run(wt, primary);
      assert.equal(readlinkSync(join(scopeOf(primary), 'server')), '../../packages/server');
    } finally {
      rmSync(primary, { recursive: true, force: true });
      rmSync(foreign, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });

  test('normalises an ABSOLUTE in-primary link to the relative form', () => {
    const primary = makeRepairPrimary();
    const wt = makeWorktree();
    try {
      plant(primary, 'cli', join(primary, 'packages/cli'));
      run(wt, primary);
      assert.equal(readlinkSync(join(scopeOf(primary), 'cli')), '../../packages/cli');
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('maps a package whose directory is NOT packages/<name>', () => {
    const primary = makeRepairPrimary();
    const wt = makeWorktree();
    try {
      plant(primary, 'example-blog', '/nonexistent/gone/examples/blog');
      run(wt, primary);
      assert.equal(readlinkSync(join(scopeOf(primary), 'example-blog')), '../../examples/blog');
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('removes a DANGLING .name-HASH npm staging entry', () => {
    const primary = makeRepairPrimary();
    const wt = makeWorktree();
    try {
      plant(primary, '.core-mTPzu12Q', '/nonexistent/gone-worktree/packages/core');
      run(wt, primary);
      assert.ok(!existsSync(join(scopeOf(primary), '.core-mTPzu12Q')), 'dangling staging entry removed');
      assert.throws(() => lstatSync(join(scopeOf(primary), '.core-mTPzu12Q')));
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('leaves a LIVE .name-HASH staging entry strictly alone', () => {
    const primary = makeRepairPrimary();
    const wt = makeWorktree();
    try {
      plant(primary, '.ui-tVBcnl39', '../../packages/ui');
      run(wt, primary);
      assert.equal(readlinkSync(join(scopeOf(primary), '.ui-tVBcnl39')), '../../packages/ui');
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('leaves a link that is already correct untouched, and reports nothing', () => {
    const primary = makeRepairPrimary();
    const wt = makeWorktree();
    try {
      plant(primary, 'core', '../../packages/core');
      const out = run(wt, primary);
      assert.equal(readlinkSync(join(scopeOf(primary), 'core')), '../../packages/core');
      assert.doesNotMatch(out, /repointed/);
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('never touches a REAL directory sitting in @webjsdev', () => {
    const primary = makeRepairPrimary();
    const wt = makeWorktree();
    try {
      mkdirSync(join(scopeOf(primary), 'core'), { recursive: true });
      writeFileSync(join(scopeOf(primary), 'core/package.json'), '{"name":"@webjsdev/core"}');
      run(wt, primary);
      assert.ok(lstatSync(join(scopeOf(primary), 'core')).isDirectory(), 'a deliberate install is left alone');
      assert.equal(readFileSync(join(scopeOf(primary), 'core/package.json'), 'utf8'), '{"name":"@webjsdev/core"}');
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('reports and LEAVES a dangling link whose package is in no workspace', () => {
    const primary = makeRepairPrimary();
    const wt = makeWorktree();
    try {
      plant(primary, 'ghost', '/nonexistent/gone/packages/ghost');
      const out = run(wt, primary);
      assert.equal(readlinkSync(join(scopeOf(primary), 'ghost')), '/nonexistent/gone/packages/ghost');
      assert.match(out, /matches no workspace package/);
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('a repair never trades one dangling link for another', () => {
    const primary = makeRepairPrimary();
    const wt = makeWorktree();
    try {
      // A package that no longer has a directory is unmappable, so it is left as
      // it is rather than repointed. This is the reachable half of the
      // never-create-a-dangling-link rule; the `existsSync(correct)` guard in the
      // script covers the TOCTOU race, which is not reproducible from a test.
      rmSync(join(primary, 'packages/ui'), { recursive: true, force: true });
      plant(primary, 'ui', '/nonexistent/gone/packages/ui');
      plant(primary, 'core', '/nonexistent/gone/packages/core');
      run(wt, primary);

      assert.equal(
        readlinkSync(join(scopeOf(primary), 'ui')),
        '/nonexistent/gone/packages/ui',
        'an unmappable entry is left exactly as it was',
      );
      // Every entry the pass DID rewrite must resolve.
      for (const name of readdirSync(scopeOf(primary))) {
        const entry = join(scopeOf(primary), name);
        if (name === 'ui') continue;
        assert.ok(existsSync(entry), `${name} resolves after the repair`);
      }
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('repairs from the PRIMARY too, above the primary-is-here guard', () => {
    const primary = makeRepairPrimary();
    try {
      plant(primary, 'core', '/nonexistent/gone-worktree/packages/core');
      const out = run(primary, primary);
      assert.equal(readlinkSync(join(scopeOf(primary), 'core')), '../../packages/core');
      assert.match(out, /this IS the primary checkout/);
    } finally { rmSync(primary, { recursive: true, force: true }); }
  });

  test('--check reports without changing anything, and exits 1 only when there is work', () => {
    const primary = makeRepairPrimary();
    try {
      plant(primary, 'core', '/nonexistent/gone-worktree/packages/core');
      const dirty = spawnSync(process.execPath, [SCRIPT, primary, '--check'], {
        cwd: primary, encoding: 'utf8', env: cleanEnv(),
      });
      assert.equal(dirty.status, 1);
      assert.match(dirty.stdout, /would repoint/);
      assert.equal(
        readlinkSync(join(scopeOf(primary), 'core')),
        '/nonexistent/gone-worktree/packages/core',
        '--check must not write',
      );

      // Repair for real, then a second --check must be clean and exit 0.
      run(primary, primary);
      const clean = spawnSync(process.execPath, [SCRIPT, primary, '--check'], {
        cwd: primary, encoding: 'utf8', env: cleanEnv(),
      });
      assert.equal(clean.status, 0);
    } finally { rmSync(primary, { recursive: true, force: true }); }
  });

  test('WEBJS_NO_WORKTREE_REPAIR=1 skips the pass entirely', () => {
    const primary = makeRepairPrimary();
    const wt = makeWorktree();
    try {
      plant(primary, 'core', '/nonexistent/gone-worktree/packages/core');
      const r = runWithResult(wt, primary, { WEBJS_NO_WORKTREE_REPAIR: '1' });
      assert.match(r.stdout, /repair skipped/);
      assert.equal(readlinkSync(join(scopeOf(primary), 'core')), '/nonexistent/gone-worktree/packages/core');
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });
});
