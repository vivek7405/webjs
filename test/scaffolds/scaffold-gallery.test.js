/**
 * Verifies the always-on gallery the full-stack scaffold ships (#824 / #821 /
 * #817), organized by KIND so features and whole apps are not mixed:
 *   - app/features/<name>  single-feature demos (one WebJs concept each),
 *   - app/examples/<name>  whole example apps that compose several features.
 * Each has its logic in modules/<name> and is linked from the home page. The
 * placeholder-marker gate was retired: `npm run gallery:clear` sheds the gallery
 * in one step instead.
 *
 * Also guards the scoping decision: api has no UI, so the gallery ships in the
 * one UI template (full-stack). Auth is one of the gallery cards.
 *
 * The todo query assertion is a regression guard for the rc.3 relational-query
 * orderBy bug (`[desc(col)]` compiles to `no such column: d0.0`); the query must
 * use the object form `{ createdAt: 'desc' }`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scaffoldApp } from '../../packages/cli/lib/create.js';

// Single-feature demos under app/features/<name>.
const FEATURES = [
  'routing', 'boundaries', 'auth', 'components', 'server-actions', 'optimistic-ui',
  'async-render', 'streaming', 'stream', 'suspense', 'directives', 'route-handler', 'forms',
  'metadata', 'caching', 'env', 'client-router', 'view-transitions', 'frames',
  'service-worker', 'websockets', 'broadcast', 'rate-limit', 'file-storage', 'sessions',
];
// Whole example apps under app/examples/<name>. The dashboard and settings
// screens are the DESIGN exemplars (#1116): they teach what a screen should
// look like rather than one framework feature, and they are covered here for
// the same reason as todo. Leaving them out is how the clear-list drifted, so
// `gallery:clear` shipped leaving two modules it claims to strip.
const EXAMPLE_APPS = ['todo', 'dashboard', 'settings'];
// Demos whose logic lives in a modules/<name> folder, spot-checked here. The
// app-only demos (routing / metadata / env / boundaries / view-transitions,
// which have no modules/ dir) are excluded.
const MODULE_ROUTES = ['auth', 'components', 'server-actions', 'optimistic-ui', 'async-render', 'streaming', 'stream', 'suspense', 'directives', 'frames', 'todo', 'websockets', 'broadcast', 'rate-limit', 'file-storage', 'sessions', 'dashboard', 'settings'];

async function tempCwd() {
  return mkdtemp(join(tmpdir(), 'webjs-scaffold-gallery-'));
}
async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

test('full-stack scaffold ships feature demos and one example app', async () => {
  const cwd = await tempCwd();
  try {
    await scaffoldApp('demo', cwd, { template: 'full-stack' });
    const appDir = join(cwd, 'demo');

    for (const name of FEATURES) {
      assert.ok(await exists(join(appDir, 'app', 'features', name, 'page.ts')), `app/features/${name}/page.ts`);
    }
    // Shared layouts give every feature demo AND every example app a
    // back-to-gallery link so no card is a dead end (via the backLink('/') helper).
    for (const seg of ['features', 'examples']) {
      const layout = await readFile(join(appDir, 'app', seg, 'layout.ts'), 'utf8');
      assert.match(layout, /backLink\('\/'/, `${seg} layout links back to the gallery home`);
      assert.match(layout, /Gallery/, `${seg} layout renders a Gallery link`);
    }
    for (const name of EXAMPLE_APPS) {
      assert.ok(await exists(join(appDir, 'app', 'examples', name, 'page.ts')), `app/examples/${name}/page.ts`);
    }
    // Boundaries demo: a forbidden()/unauthorized() thrower next to its nearest boundary file.
    assert.ok(await exists(join(appDir, 'app', 'features', 'boundaries', 'gated', 'page.ts')));
    assert.ok(await exists(join(appDir, 'app', 'features', 'boundaries', 'gated', 'forbidden.ts')));
    assert.ok(await exists(join(appDir, 'app', 'features', 'boundaries', 'private', 'page.ts')));
    assert.ok(await exists(join(appDir, 'app', 'features', 'boundaries', 'private', 'unauthorized.ts')));
    // Dynamic route param example + the route.ts handler.
    assert.ok(await exists(join(appDir, 'app', 'features', 'routing', '[id]', 'page.ts')));
    assert.ok(await exists(join(appDir, 'app', 'features', 'route-handler', 'data', 'route.ts')));
    // Client-router soft-nav target subpage.
    assert.ok(await exists(join(appDir, 'app', 'features', 'client-router', 'second', 'page.ts')));
    // View-transitions soft-nav target subpage (the cross-fade + permanent-element demo).
    assert.ok(await exists(join(appDir, 'app', 'features', 'view-transitions', 'second', 'page.ts')));
    // Infra features ship their server endpoints alongside the page.
    assert.ok(await exists(join(appDir, 'app', 'features', 'websockets', 'echo', 'route.ts')));
    assert.ok(await exists(join(appDir, 'app', 'features', 'broadcast', 'feed', 'route.ts')));
    assert.ok(await exists(join(appDir, 'app', 'features', 'rate-limit', 'ping', 'route.ts')));
    assert.ok(await exists(join(appDir, 'app', 'features', 'rate-limit', 'ping', 'middleware.ts')));
    // The limiter must key on the FORWARDED client, not the socket peer, or the
    // demo counts proxies instead of visitors the moment the app is deployed
    // behind anything (#1387). This is an emitted file, so assert the generated
    // bytes rather than trusting the source it was copied from.
    const rateLimitMw = await readFile(join(appDir, 'app', 'features', 'rate-limit', 'ping', 'middleware.ts'), 'utf8');
    assert.match(rateLimitMw, /trustProxy:\s*true/, 'gallery rate-limit demo trusts the proxy');
    assert.ok(await exists(join(appDir, 'app', 'features', 'file-storage', 'file', '[key]', 'route.ts')));
    // Root-only boundaries + metadata image routes (the convention-file demos).
    for (const f of ['global-error.ts', 'global-not-found.ts', 'icon.ts', 'apple-icon.ts', 'opengraph-image.ts', 'twitter-image.ts']) {
      assert.ok(await exists(join(appDir, 'app', f)), `app/${f}`);
    }
    // Feature/app logic lives in modules/, not app/.
    for (const name of MODULE_ROUTES) {
      assert.ok(await exists(join(appDir, 'modules', name)), `modules/${name}`);
    }
    // tic-tac-toe was dropped.
    assert.equal(existsSync(join(appDir, 'app', 'examples', 'tic-tac-toe')), false);
    assert.equal(existsSync(join(appDir, 'modules', 'tic-tac-toe')), false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('the shared gallery nav lists every feature and the example app', async () => {
  // The feature index moved to modules/gallery/nav.ts (one source for the home
  // cards AND the sidebar). Assert every demo is listed there, and that the home
  // reads it rather than hard-coding its own list.
  const cwd = await tempCwd();
  try {
    await scaffoldApp('demo', cwd, { template: 'full-stack' });
    const nav = await readFile(join(cwd, 'demo', 'modules', 'gallery', 'nav.ts'), 'utf8');
    const home = await readFile(join(cwd, 'demo', 'app', 'page.ts'), 'utf8');

    assert.doesNotMatch(home, /webjs-scaffold-placeholder/, 'the placeholder gate was retired');
    assert.match(home, /from '#modules\/gallery\/nav\.ts'/, 'home reads the shared nav index');
    for (const name of FEATURES) {
      assert.match(nav, new RegExp(`/features/${name}`), `nav lists /features/${name}`);
    }
    for (const name of EXAMPLE_APPS) {
      assert.match(nav, new RegExp(`/examples/${name}`), `nav lists /examples/${name}`);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('no gallery route page carries a scaffold-placeholder marker (gate retired)', async () => {
  const cwd = await tempCwd();
  try {
    await scaffoldApp('demo', cwd, { template: 'full-stack' });
    const appDir = join(cwd, 'demo');
    for (const name of FEATURES) {
      const src = await readFile(join(appDir, 'app', 'features', name, 'page.ts'), 'utf8');
      assert.doesNotMatch(src, /webjs-scaffold-placeholder/, `app/features/${name} has no marker`);
    }
    for (const name of EXAMPLE_APPS) {
      const src = await readFile(join(appDir, 'app', 'examples', name, 'page.ts'), 'utf8');
      assert.doesNotMatch(src, /webjs-scaffold-placeholder/, `app/examples/${name} has no marker`);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('full-stack schema adds a todos table backing the todo example', async () => {
  const cwd = await tempCwd();
  try {
    await scaffoldApp('demo', cwd, { template: 'full-stack' });
    const schema = await readFile(join(cwd, 'demo', 'db', 'schema.server.ts'), 'utf8');
    assert.match(schema, /export const todos = table\('todos'/, 'todos table present');
    assert.match(schema, /defineRelations\(\{ users, todos \}/, 'todos wired into relations');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('todo query uses rc.3 object-form orderBy (regression guard)', async () => {
  const cwd = await tempCwd();
  try {
    await scaffoldApp('demo', cwd, { template: 'full-stack' });
    const q = await readFile(join(cwd, 'demo', 'modules', 'todo', 'queries', 'list-todos.server.ts'), 'utf8');
    assert.match(q, /orderBy:\s*\{\s*createdAt:\s*'desc'\s*\}/, 'uses object-form orderBy');
    // Match only real code (an `orderBy: [`), not the cautionary comment.
    assert.doesNotMatch(q, /orderBy:\s*\[/, 'must not use array-form orderBy which mis-compiles in rc.3');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('full-stack gallery:clear strips the app to a barebones blank slate', async () => {
  // gallery:clear must leave a minimal buildable base, not "the scaffold minus
  // the gallery". It removes the gallery, the example design system, the example
  // theme-toggle (+ its layout/home wiring), the example tests, and every empty
  // leftover dir; it keeps the durable skill, the layout, db wiring, and cn.ts.
  // The pre-clear existence asserts are the counterfactual (they prove each thing
  // was really there to remove).
  const cwd = await tempCwd();
  try {
    await scaffoldApp('demo', cwd, { template: 'full-stack', install: false });
    const appDir = join(cwd, 'demo');
    const has = (...p) => existsSync(join(appDir, ...p));

    // Counterfactual: everything gallery:clear should strip is present first.
    assert.ok(has('app', 'features'), 'pre: app/features exists');
    assert.ok(has('app', 'examples'), 'pre: app/examples exists');
    assert.ok(has('modules', 'todo'), 'pre: modules/todo exists');
    assert.ok(has('components', 'ui', 'button.ts'), 'pre: components/ui design system exists');
    assert.ok(has('components', 'theme-toggle.ts'), 'pre: example theme-toggle exists');
    assert.ok(has('test', 'hello'), 'pre: example test suite exists');
    assert.ok(has('lib', 'utils', 'ui.ts'), 'pre: gallery ui.ts fragment helpers exist');
    assert.ok(has('app', 'api', 'auth'), 'pre: gallery auth handler under app/api exists');
    assert.match(await readFile(join(appDir, 'app', 'layout.ts'), 'utf8'), /theme-toggle/, 'pre: layout imports theme-toggle');

    execFileSync(process.execPath, ['scripts/clear-gallery.mjs'], { cwd: appDir, stdio: 'ignore' });

    // Removed: the gallery + example design system + example artifacts.
    assert.equal(has('app', 'features'), false, 'app/features removed');
    assert.equal(has('app', 'examples'), false, 'app/examples removed');
    assert.equal(has('modules', 'todo'), false, 'demo module removed');
    assert.equal(has('modules', 'auth'), false, 'auth demo module removed');
    assert.equal(has('components', 'ui'), false, 'components/ui design system removed');
    assert.equal(has('components', 'theme-toggle.ts'), false, 'example theme-toggle removed');
    assert.equal(has('test', 'hello'), false, 'example test suite removed');
    // Empty leftover dirs pruned to a true blank slate.
    assert.equal(has('app', 'api'), false, 'empty app/api pruned');
    assert.equal(has('test', 'unit'), false, 'empty test/unit pruned');
    assert.equal(has('test', 'e2e'), false, 'empty test/e2e pruned');
    assert.equal(has('test'), false, 'empty test/ pruned');

    // Kept: the buildable base.
    assert.ok(has('.agents', 'skills', 'webjs', 'SKILL.md'), 'the durable agent skill is kept');
    assert.equal(has('lib', 'utils', 'ui.ts'), false, 'gallery ui.ts fragment helpers removed');
    assert.ok(has('lib', 'utils', 'cn.ts'), 'cn.ts kept (webjs ui add prerequisite)');
    assert.ok(has('db', 'connection.server.ts'), 'db wiring kept');
    assert.ok(has('components'), 'components/ kept as an (empty) build target');
    assert.ok(has('modules'), 'modules/ kept as an (empty) build target');
    // ENFORCEMENT (so a new gallery demo can't be added without updating
    // gallery:clear): after clear, modules/ and components/ MUST be a blank
    // slate. A gallery module or ui helper left behind fails here. If you added
    // gallery content, add its removal to templates/scripts/clear-gallery.mjs.
    const modulesLeft = readdirSync(join(appDir, 'modules'));
    assert.deepEqual(modulesLeft, [], `modules/ must be empty after clear, found: ${modulesLeft.join(', ')}`);
    const componentsLeft = readdirSync(join(appDir, 'components'));
    assert.deepEqual(componentsLeft, [], `components/ must be empty after clear, found: ${componentsLeft.join(', ')}`);
    assert.ok(has('app', 'layout.ts'), 'root layout kept');

    // The layout is reset to a blank-slate base: no theme-toggle, no design-token
    // palette, just the OS light/dark system colours (Canvas / CanvasText). The
    // design system is taught in the skill, not baked into the blank slate.
    const layout = await readFile(join(appDir, 'app', 'layout.ts'), 'utf8');
    assert.doesNotMatch(layout, /theme-toggle/, 'layout theme-toggle import stripped');
    assert.doesNotMatch(layout, /--(?:background|foreground|primary):/, 'reset layout ships no design-token palette');
    assert.match(layout, /background:\s*Canvas/, 'reset layout uses OS system colours');

    // The blank slate keeps the asset() marking (#1194). The clear script writes
    // its OWN layout, so it can silently drop what create.js emitted: an
    // un-marked /public/tailwind.css sits at a stable url, and a later deploy
    // then serves the PREVIOUS stylesheet from a CDN or service-worker cache.
    // This is the reset path an agent runs before building the real app, so a
    // regression here ships to every app that ever cleared the gallery.
    assert.match(layout, /href=\$\{asset\('\/public\/tailwind\.css'\)\}/,
      'reset layout still content-hashes the stylesheet via asset()');
    assert.match(layout, /import \{[^}]*\basset\b[^}]*\} from '@webjsdev\/core'/,
      'and imports asset so the reset layout type-checks');

    // The reset home is minimal: no <theme-toggle>, no gallery links.
    const home = await readFile(join(appDir, 'app', 'page.ts'), 'utf8');
    assert.doesNotMatch(home, /theme-toggle/, 'reset home drops theme-toggle');
    assert.doesNotMatch(home, /\/features\//, 'reset home has no gallery links');

    // The schema is reverted to the minimal base (no demo todos, no auth column).
    const schema = await readFile(join(appDir, 'db', 'schema.server.ts'), 'utf8');
    assert.doesNotMatch(schema, /export const todos = table/, 'todos table dropped');
    assert.doesNotMatch(schema, /passwordHash/, 'auth passwordHash column dropped');
    assert.match(schema, /defineRelations\(\{ users \}/, 'relations reverted to users only');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('gallery:clear keeps a hand-customised root layout (brand guard)', async () => {
  // The layout overwrite is guarded on the gallery's own navbar brand: a layout
  // the user already themed (brand gone) is the user's work, so clear KEEPS it
  // and strips only the dangling theme-toggle wiring (the component file is
  // removed either way).
  const cwd = await tempCwd();
  try {
    await scaffoldApp('demo', cwd, { template: 'full-stack', install: false });
    const appDir = join(cwd, 'demo');
    const layoutPath = join(appDir, 'app', 'layout.ts');
    const customised = (await readFile(layoutPath, 'utf8')).replace('WebJs Gallery', 'Acme Notes');
    await writeFile(layoutPath, customised);

    execFileSync(process.execPath, ['scripts/clear-gallery.mjs'], { cwd: appDir, stdio: 'ignore' });

    const kept = await readFile(layoutPath, 'utf8');
    assert.match(kept, /Acme Notes/, 'the customised layout survives the clear');
    assert.match(kept, /light-dark\(/, "the user's palette survives too");
    assert.doesNotMatch(kept, /theme-toggle/, 'the dangling theme-toggle wiring is stripped');
    assert.doesNotMatch(kept, /background:\s*Canvas/, 'the blank-slate layout was NOT applied');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('feature pages have no stale /examples/ links after the features refactor', async () => {
  // Regression guard: moving the demos from app/examples/ to app/features/ must
  // update the in-page hrefs too, not just the marker text. The ONLY valid
  // /examples/* link anywhere is the todo app (app/examples/todo).
  const cwd = await tempCwd();
  try {
    await scaffoldApp('demo', cwd, { template: 'full-stack' });
    const featuresDir = join(cwd, 'demo', 'app', 'features');
    const pages = [
      ...FEATURES.map((n) => join(featuresDir, n, 'page.ts')),
      join(featuresDir, 'routing', '[id]', 'page.ts'),
      join(featuresDir, 'route-handler', 'data', 'route.ts'),
    ];
    for (const p of pages) {
      const src = await readFile(p, 'utf8');
      for (const m of src.matchAll(/\/examples\/[a-z-]+/g)) {
        assert.equal(m[0], '/examples/todo', `${p}: stale link ${m[0]} (todo is the only /examples/ route)`);
      }
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('the api template ships the backend-features showcase, not the UI gallery', async () => {
  const cwd = await tempCwd();
  try {
    await scaffoldApp('demo', cwd, { template: 'api' });
    const appDir = join(cwd, 'demo');
    // No UI gallery (the api template has no pages/components).
    assert.equal(existsSync(join(appDir, 'app', 'features')), false, 'api must not ship the UI app/features');
    assert.equal(existsSync(join(appDir, 'app', 'examples')), false, 'api must not ship app/examples');
    assert.equal(existsSync(join(appDir, 'modules', 'todo')), false, 'api must not ship the todo module');
    // The BACKEND-features showcase (endpoints under app/api/features/).
    for (const name of ['validate', 'rate-limit', 'stream', 'files', 'ws']) {
      assert.ok(await exists(join(appDir, 'app', 'api', 'features', name, 'route.ts')), `api backend demo ${name}`);
    }
    assert.ok(await exists(join(appDir, 'app', 'api', 'features', 'rate-limit', 'middleware.ts')), 'rate-limit middleware');
    // Same requirement as the UI gallery's copy (#1387), and this one is emitted
    // from a string template, so a quoting slip only shows in generated bytes.
    const apiRateLimitMw = await readFile(join(appDir, 'app', 'api', 'features', 'rate-limit', 'middleware.ts'), 'utf8');
    assert.match(apiRateLimitMw, /trustProxy:\s*true/, 'api rate-limit demo trusts the proxy');
    assert.ok(await exists(join(appDir, 'app', 'api', 'features', 'files', '[key]', 'route.ts')), 'file serve route');
    assert.ok(await exists(join(appDir, 'modules', 'widgets', 'actions', 'create-widget.server.ts')), 'widgets action');
    assert.ok(await exists(join(appDir, 'env.ts')), 'env-validation demo at the app root');
    // The root index lists the showcase.
    const rootRoute = await readFile(join(appDir, 'app', 'route.ts'), 'utf8');
    assert.match(rootRoute, /features:/, 'root index lists the features');
    assert.match(rootRoute, /api\/features\/validate/, 'root index links the validate endpoint');
    // The api template ships its own gallery:clear (backed by clear-api-gallery.mjs).
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    assert.match(pkg.scripts['gallery:clear'], /clear-api-gallery\.mjs/, 'api gallery:clear runs the api showcase reset');
    assert.ok(await exists(join(appDir, 'scripts', 'clear-api-gallery.mjs')), 'the api clear script ships');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

/*
 * The full-stack gallery is asserted marker-free above, but nothing covered the
 * api showcase, which is how it kept shipping `webjs-scaffold-placeholder` (and
 * a comment claiming `webjs check` fails on it) for every generated api app long
 * after that rule was retired. The token names a check rule that does not exist,
 * so a developer grepping for it finds nothing to satisfy.
 */
test('no api showcase route carries a scaffold-placeholder marker (gate retired)', async () => {
  const cwd = await tempCwd();
  try {
    await scaffoldApp('demo', cwd, { template: 'api' });
    const appDir = join(cwd, 'demo');
    for (const name of ['validate', 'rate-limit', 'stream', 'files', 'ws']) {
      const src = await readFile(join(appDir, 'app', 'api', 'features', name, 'route.ts'), 'utf8');
      assert.doesNotMatch(src, /webjs-scaffold-placeholder/, `app/api/features/${name} has no marker`);
      assert.doesNotMatch(src, /webjs check fails/, `app/api/features/${name} claims no retired gate`);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('the api gallery:clear sheds the showcase to a health + users base', async () => {
  const cwd = await tempCwd();
  try {
    await scaffoldApp('demo', cwd, { template: 'api' });
    const appDir = join(cwd, 'demo');
    // Run the api showcase reset the same way `npm run gallery:clear` would.
    execFileSync(process.execPath, ['scripts/clear-api-gallery.mjs'], { cwd: appDir, stdio: 'ignore' });

    // The showcase is gone.
    assert.equal(existsSync(join(appDir, 'app', 'api', 'features')), false, 'app/api/features removed');
    assert.equal(existsSync(join(appDir, 'modules', 'widgets')), false, 'modules/widgets removed');
    assert.equal(existsSync(join(appDir, 'env.ts')), false, 'env.ts example removed');
    assert.equal(existsSync(join(appDir, 'test', 'unit', 'widgets.test.ts')), false, 'widgets test removed');
    // The root index no longer points at the removed showcase, but keeps the base.
    const rootRoute = await readFile(join(appDir, 'app', 'route.ts'), 'utf8');
    assert.doesNotMatch(rootRoute, /features:/, 'the stale features block is stripped from the index');
    assert.match(rootRoute, /api\/health/, 'health endpoint kept in the index');
    assert.match(rootRoute, /api\/users/, 'users endpoint kept in the index');
    // Counterfactual: without the app/route.ts reset the index would still list a
    // `features:` block pointing at routes that no longer exist (the assert above
    // fails if the reset is dropped).

    // The baseline is intact.
    assert.ok(await exists(join(appDir, 'middleware.ts')), 'CORS middleware kept');
    assert.ok(await exists(join(appDir, 'app', 'api', 'health', 'route.ts')), 'health endpoint kept');
    assert.ok(await exists(join(appDir, 'app', 'api', 'users', 'route.ts')), 'users endpoint kept');
    assert.ok(await exists(join(appDir, 'modules', 'users')), 'modules/users kept');
    // ENFORCEMENT (parity with the full-stack clear test): after clear, modules/
    // holds ONLY the users base. A new api demo module left behind fails here, so
    // clear-api-gallery.mjs must be updated whenever the api showcase gains one.
    assert.deepEqual(readdirSync(join(appDir, 'modules')).sort(), ['users'],
      'modules/ must hold only the users base after the api clear');

    // A rerun is a safe no-op (the showcase is already gone).
    execFileSync(process.execPath, ['scripts/clear-api-gallery.mjs'], { cwd: appDir, stdio: 'ignore' });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('the full-stack auth card wires a real, protected auth baseline', async () => {
  const cwd = await tempCwd();
  try {
    await scaffoldApp('demo', cwd, { template: 'full-stack' });
    const appDir = join(cwd, 'demo');
    // The auth card ships login, signup, and a protected dashboard subtree.
    assert.ok(await exists(join(appDir, 'app', 'features', 'auth', 'login', 'page.ts')), 'auth login page');
    assert.ok(await exists(join(appDir, 'app', 'features', 'auth', 'signup', 'page.ts')), 'auth signup page');
    assert.ok(await exists(join(appDir, 'app', 'features', 'auth', 'dashboard', 'page.ts')), 'protected dashboard page');
    assert.ok(await exists(join(appDir, 'app', 'features', 'auth', 'dashboard', 'middleware.ts')), 'the dashboard gate');
    // The createAuth handler stays at the app root (createAuth hardcodes /api/auth/*).
    assert.ok(await exists(join(appDir, 'app', 'api', 'auth', '[...path]', 'route.ts')), 'auth api handler at root');
    // The auth server modules: createAuth config, hashing, signup, current-user.
    assert.ok(await exists(join(appDir, 'modules', 'auth', 'auth.server.ts')), 'createAuth config module');
    assert.ok(await exists(join(appDir, 'modules', 'auth', 'password.server.ts')), 'password hashing module');
    // The users table carries the auth passwordHash column.
    const schema = await readFile(join(appDir, 'db', 'schema.server.ts'), 'utf8');
    assert.match(schema, /table\('users'/, 'the users table');
    assert.match(schema, /passwordHash/, 'users table carries the auth column');
    // The real auth-flow test ships with the card.
    assert.ok(await exists(join(appDir, 'test', 'auth', 'auth.test.ts')), 'the auth flow test ships');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('the server-actions card demonstrates every HTTP-verb config export', async () => {
  // The reserved sibling exports (#488) are config, not module exports, so the
  // gallery-coverage manifest cannot gate them. Assert the card ships a working
  // demo of each: without this, `method` / `cache` / `tags` / `invalidates` can
  // silently drop out of the scaffold the way they were missing before #1151.
  const cwd = await tempCwd();
  try {
    await scaffoldApp('demo', cwd, { template: 'full-stack' });
    const mod = join(cwd, 'demo', 'modules', 'server-actions');

    const read = await readFile(join(mod, 'queries', 'read-clock.server.ts'), 'utf8');
    assert.match(read, /^'use server';/, 'the cached read is an RPC action');
    assert.match(read, /export const method = 'GET'/, 'declares the GET verb');
    assert.match(read, /export const cache = \d+/, 'declares a cache window');
    assert.match(read, /export const tags = /, 'tags the cached entry');

    const mutation = await readFile(join(mod, 'actions', 'bump-clock.server.ts'), 'utf8');
    assert.match(mutation, /export const invalidates = /, 'the mutation evicts the tag');
    assert.doesNotMatch(mutation, /export const method/, 'a mutation is POST by default');

    // The GET and the mutation each own their file: a configured file with more
    // than one callable function is a `webjs check` error.
    for (const [label, src] of [['read', read], ['mutation', mutation]]) {
      assert.equal([...src.matchAll(/^export async function /gm)].length, 1, `${label} keeps one function per configured file`);
    }

    // Teaching surface: a copied `{ public: true }` on a per-user read is a real
    // cross-user leak, so the gallery names the flag in prose (comments and card
    // copy) but never in code an agent would paste.
    for (const [f, src] of [['queries/read-clock.server.ts', read], ['actions/bump-clock.server.ts', mutation]]) {
      const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      assert.doesNotMatch(code, /public:\s*true/, `${f} does not ship a shared-cache read`);
    }

    const card = await readFile(join(cwd, 'demo', 'app', 'features', 'server-actions', 'page.ts'), 'utf8');
    assert.match(card, /<clock-reader>/, 'the card mounts the demo');
    // The tag alone is not enough: without the module import the element never
    // registers and the demo renders as an empty tag with everything still green.
    assert.match(card, /import '#modules\/server-actions\/components\/clock-reader\.ts'/, 'the card imports the demo module');
    assert.match(card, /public: true/, 'the card states the shared-cache safety rule');

    // A mutation returns the ActionResult envelope, like every other gallery
    // mutation, so the card does not teach two contracts side by side.
    assert.match(mutation, /ActionResult</, 'the mutation returns the envelope');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
