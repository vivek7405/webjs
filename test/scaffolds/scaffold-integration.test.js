/**
 * Integration tests for `scaffoldApp`: invokes the full-stack and api scaffolds
 * programmatically in a temp dir and asserts the expected files / directory
 * structure are produced. Runs entirely offline.
 *
 * This is a coverage anchor for `packages/cli/lib/create.js` (including the auth
 * gallery card it wires into the UI template), otherwise only exercised by manual
 * `webjs create` runs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scaffoldApp } from '../../packages/cli/lib/create.js';

async function tempCwd() {
  return mkdtemp(join(tmpdir(), 'webjs-scaffold-integ-'));
}

// Root-cause guard for #845: the gitignore template MUST ship as `gitignore`
// (no dot). npm strips a `.gitignore` from a published tarball, so a dotfile
// name arrives missing in the installed CLI and the scaffold ships an app with
// no `.env` ignore. Renaming it back to `.gitignore` would silently reintroduce
// the bug (repo-local generation would still pass), so assert the file name.
test('gitignore template ships as a non-dotfile so npm cannot strip it', () => {
  const dir = join(import.meta.dirname, '..', '..', 'packages', 'cli', 'templates');
  assert.ok(existsSync(join(dir, 'gitignore')), 'templates/gitignore must exist');
  assert.ok(!existsSync(join(dir, '.gitignore')), 'templates/.gitignore must NOT exist (npm strips it)');
});

/**
 * Silence console.log during scaffold to keep test output clean.
 * Returns a restore function.
 */
function muteConsole() {
  const origLog = console.log;
  const origError = console.error;
  console.log = () => {};
  console.error = () => {};
  return () => {
    console.log = origLog;
    console.error = origError;
  };
}

/**
 * Like `muteConsole`, but keeps what was printed so a test can assert on the
 * post-scaffold guidance. A sibling rather than a flag on `muteConsole` so
 * every existing caller stays untouched.
 * @returns {{ restore: () => void, output: () => string }}
 */
function captureConsole() {
  const origLog = console.log;
  const origError = console.error;
  /** @type {string[]} */
  const lines = [];
  console.log = (...args) => { lines.push(args.join(' ')); };
  console.error = (...args) => { lines.push(args.join(' ')); };
  return {
    restore: () => {
      console.log = origLog;
      console.error = origError;
    },
    output: () => lines.join('\n'),
  };
}

test('scaffoldApp full-stack: writes the canonical full-stack app layout', async () => {
  const cwd = await tempCwd();
  const restore = muteConsole();
  try {
    await scaffoldApp('my-app', cwd, { template: 'full-stack' });
    const appDir = join(cwd, 'my-app');
    assert.ok(existsSync(appDir), 'app directory created');

    // Core directories
    for (const d of ['app', 'components', 'modules', 'lib', 'public', 'db', 'test/unit', 'test/e2e']) {
      assert.ok(existsSync(join(appDir, d)), `${d}/ should exist`);
    }

    // Root files
    assert.ok(existsSync(join(appDir, 'package.json')));
    assert.ok(existsSync(join(appDir, 'tsconfig.json')));

    // ONE agent surface: AGENTS.md (the open standard agents read natively)
    // pointing at .agents/, which carries the skill and the workflow rules.
    for (const f of ['AGENTS.md', '.agents/skills/webjs/SKILL.md', '.agents/rules/workflow.md', '.editorconfig']) {
      assert.ok(existsSync(join(appDir, f)), `${f} should exist`);
    }
    // NO per-agent rule files or vendor tool config. How a team runs its
    // tools is the team's call, and the rules that protect the app are
    // enforced agent-agnostically by `webjs check`, CI, and .hooks/pre-commit.
    for (const f of [
      'CLAUDE.md', 'CONVENTIONS.md', '.claude', '.claude.json', '.claude/settings.json',
      'GEMINI.md', '.github/copilot-instructions.md', '.cursorrules', '.gemini', '.opencode',
      'LAYOUT-REFERENCE.md',
    ]) {
      assert.ok(!existsSync(join(appDir, f)), `${f} should NOT exist in the scaffold`);
    }
    // AGENTS.md must actually route to the skill, since nothing else does.
    const agentsMd = readFileSync(join(appDir, 'AGENTS.md'), 'utf8');
    assert.match(agentsMd, /\.agents\/skills\/webjs/, 'AGENTS.md points at the skill');
    assert.match(agentsMd, /\.agents\/rules\/workflow\.md/, 'AGENTS.md points at the workflow rules');

    // #271: the opt-in progressive-enhancement service worker + its offline
    // fallback ship into the UI scaffold (full-stack; api has no UI),
    // dormant until the app registers it.
    assert.ok(existsSync(join(appDir, 'public', 'sw.js')), 'public/sw.js should exist');
    assert.ok(existsSync(join(appDir, 'public', 'offline.html')), 'public/offline.html should exist');

    // #259: the VS Code settings that associate the webjs-config JSON Schema
    // with package.json's `webjs` block must reach the scaffolded app. This
    // file is under a `.vscode/` dir that .gitignore would normally exclude, so
    // it is a regression guard against the template silently not shipping.
    const vscodePath = join(appDir, '.vscode', 'settings.json');
    assert.ok(existsSync(vscodePath), '.vscode/settings.json should exist');
    const vscode = JSON.parse(readFileSync(vscodePath, 'utf8'));
    const webjsSchema = vscode['json.schemas']?.[0]?.schema?.properties?.webjs;
    assert.ok(
      webjsSchema && String(webjsSchema.$ref || '').includes('webjs-config.schema.json'),
      '.vscode/settings.json should $ref the webjs-config schema for the webjs block'
    );

    // Full-stack template-specific
    assert.ok(existsSync(join(appDir, 'app', 'layout.ts')), 'layout.ts written');
    assert.ok(existsSync(join(appDir, 'app', 'page.ts')), 'page.ts written');
    assert.ok(existsSync(join(appDir, 'components', 'theme-toggle.ts')), 'theme-toggle written');

    // Dark-mode wiring: the head init script (in layout) AND the theme-toggle
    // must toggle the shadcn `.dark` class, not only the `data-theme`
    // attribute. Without `.dark`, the copied components/ui/* render light
    // tokens on the dark chrome (white buttons/cards, invisible text). Light
    // mode hides this, so guard it here. See .agents/skills/webjs/references/styling.md "Dark mode".
    const layoutSrc = readFileSync(join(appDir, 'app', 'layout.ts'), 'utf8');
    const toggleSrc = readFileSync(join(appDir, 'components', 'theme-toggle.ts'), 'utf8');
    assert.match(layoutSrc, /classList\.toggle\(['"]dark['"]/,
      'layout head script must toggle the .dark class (shadcn dark-mode signal)');
    assert.match(toggleSrc, /classList\.toggle\(['"]dark['"]/,
      'theme-toggle must toggle the .dark class (shadcn dark-mode signal)');

    // Re-skinned shell: a JetBrains Mono type system on a cool neutral-grey
    // surface palette (not the old orange brand), a floating top navbar, and a
    // main that fills the viewport minus the navbar.
    assert.match(layoutSrc, /<main class="min-h-\[calc\(100dvh-3\.5rem\)\][^"]*">/,
      'layout main fills the viewport minus the navbar');
    assert.match(layoutSrc, /<header\b/, 'the shell ships a floating top navbar');
    assert.match(layoutSrc, /JetBrains\+Mono/, 'layout loads the JetBrains Mono font');
    assert.match(layoutSrc, /--primary:\s*light-dark\(#1e2226, #dee2e6\)/,
      'layout ships the DRY light-dark() surface palette');
    assert.doesNotMatch(layoutSrc, /oklch\(0\.7 0\.16 52\)/,
      'no orange brand color survives in the neutral scaffold');

    // Favicon: declared via metadata.icons (the framework emits it into <head>).
    // A hand-written <link rel="icon"> in the layout body lands in <body>, where
    // browsers ignore it, the recurring "favicon never shows" bug this guards.
    assert.match(layoutSrc, /export const metadata = \{ icons: '\/public\/favicon\.svg' \}/,
      'layout declares the favicon via metadata.icons');
    assert.doesNotMatch(layoutSrc, /<link rel="icon"/,
      'layout must NOT hand-write a <link rel=icon> (it lands in <body>, ignored)');
    assert.ok(existsSync(join(appDir, 'public', 'favicon.svg')), 'ships public/favicon.svg');

    // The home page is a gallery index: an 'Explore the gallery' hero, a grid
    // linking every feature demo + the example app, and a footer with the docs +
    // source links.
    const pageSrc = readFileSync(join(appDir, 'app', 'page.ts'), 'utf8');
    assert.match(pageSrc, /Explore the gallery/, 'home hero indexes the gallery');
    assert.match(pageSrc, /from '#modules\/gallery\/nav\.ts'/, 'home reads the shared gallery nav (the feature + example index)');
    assert.match(pageSrc, /webjs\.dev\/docs/, 'footer links the docs');
    assert.match(pageSrc, /github\.com\/webjsdev\/webjs/, 'footer links the source');
    assert.doesNotMatch(pageSrc, /<prompt-button\b/, 'the AI-prompts card is gone');
    assert.doesNotMatch(pageSrc, /Coding with AI/, 'the coding-with-AI section is gone');

    // The gallery ships: single-feature demos under app/features/, the example
    // app under app/examples/, and their logic under modules/, all without the
    // dead scaffold-placeholder markers (that gate was retired).
    assert.ok(existsSync(join(appDir, 'app', 'features', 'routing', 'page.ts')),
      'gallery feature demos ship under app/features/');
    assert.ok(existsSync(join(appDir, 'app', 'examples', 'todo', 'page.ts')),
      'the example app ships under app/examples/');
    assert.ok(existsSync(join(appDir, 'modules', 'todo', 'components', 'todo-app.ts')),
      'gallery module logic ships under modules/');
    assert.doesNotMatch(
      readFileSync(join(appDir, 'app', 'features', 'routing', 'page.ts'), 'utf8'),
      /webjs-scaffold-placeholder/, 'gallery files ship without dead placeholder markers');

    // Drizzle db layer wired up
    assert.ok(existsSync(join(appDir, 'db', 'schema.server.ts')), 'db/schema.server.ts written');
    assert.ok(existsSync(join(appDir, 'db', 'columns.server.ts')), 'db/columns.server.ts written');
    assert.ok(existsSync(join(appDir, 'db', 'connection.server.ts')), 'db/connection.server.ts written');
    assert.ok(existsSync(join(appDir, 'drizzle.config.ts')), 'drizzle.config.ts written');
    // A JSON column helper ships so persisting structured data (a board, a tag
    // list, a settings blob) needs no outside Drizzle knowledge. SQLite path
    // uses text({ mode: 'json' }). The example schema demonstrates it once.
    const colsSrc = readFileSync(join(appDir, 'db', 'columns.server.ts'), 'utf8');
    assert.match(colsSrc, /export const json = <T>\(\) => text\(\{ mode: 'json' \}\)\.\$type<T>\(\)/,
      'sqlite columns.server.ts exports a generic json<T>() helper');
    const schemaSrc = readFileSync(join(appDir, 'db', 'schema.server.ts'), 'utf8');
    assert.match(schemaSrc, /\bjson\b/, 'schema imports json');
    assert.match(schemaSrc, /json<\{[^}]*\}>\(\)/, 'schema demonstrates json<T>() on a column (counterfactual: fails if the demo column is dropped)');
    assert.ok(!existsSync(join(appDir, 'prisma')), 'no prisma/ dir (counterfactual: fails if db files not written)');
    // The INITIAL migration is authored by `webjs create` only AFTER a successful
    // install (drizzle-kit is needed). This test scaffolds with install:false, so
    // no migration is authored here; the printed next-steps still show db:generate
    // for that path. (The install:true path that authors it is verified manually /
    // via a docker build, per the CLI AGENTS.md e2e note.)
    const migDir = join(appDir, 'db', 'migrations');
    const migrationSql = existsSync(migDir)
      ? readdirSync(migDir).some((d) => existsSync(join(migDir, d, 'migration.sql')))
      : false;
    assert.equal(migrationSql, false, 'install:false authors no migration (db:generate needs drizzle-kit)');
    assert.ok(!existsSync(join(appDir, 'lib', 'prisma.server.ts')), 'no lib/prisma.server.ts');

    // # path-alias imports (#555/#556): the scaffold ships the single #* catch-all
    // imports key and uses # aliases for app-internal imports, no within-app deep relatives.
    const aliasPkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
    assert.deepEqual(aliasPkg.imports, { '#*': './*' }, 'package.json ships the per-dir # imports aliases');
    // No app-internal deep relative (../../) survives the codemod in any .ts.
    const tsFiles = [];
    (function walk(d) {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const full = join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|js)$/.test(e.name)) tsFiles.push(full);
      }
    })(appDir);
    for (const f of tsFiles) {
      const src = readFileSync(f, 'utf8');
      assert.ok(!/from '(\.\.\/){2,}/.test(src), `${f.slice(appDir.length)} must not keep a deep relative import`);
    }

    // The scaffold ships NO agent-specific enforcement hooks. What used to be
    // a set of Claude PreToolUse/Stop hooks is now covered agent-agnostically,
    // which is the point: it binds every agent rather than one.
    //   - a server-only import in a browser module -> `webjs check`'s
    //     no-server-import-in-browser-module rule, run in CI
    //   - committing on main -> .hooks/pre-commit, a git-level block
    //   - tests with source, commit cadence -> .agents/rules/workflow.md
    for (const f of ['.claude', '.claude.json']) {
      assert.ok(!existsSync(join(appDir, f)), `${f} must not ship`);
    }

    // The local pre-commit hook is lightweight: it blocks commits to main
    // and nothing else. The test/convention gate runs in CI, not locally,
    // so `git commit` stays fast and the gate cannot be skipped with a
    // local --no-verify. Mirrors the webjs framework's own pre-commit.
    const preCommit = readFileSync(join(appDir, '.hooks/pre-commit'), 'utf8');
    assert.match(preCommit, /Cannot commit directly to/,
      'pre-commit blocks commits to main');
    assert.doesNotMatch(preCommit, /npx --no-install webjs/,
      'pre-commit no longer runs the test suite (moved to CI)');
    assert.doesNotMatch(preCommit, /no test is staged/,
      'pre-commit no longer carries the require-tests floor (moved to CI)');

    // CI carries the test gate: webjs check + the unit / browser / e2e
    // layers on every PR and push to main.
    const ciWorkflow = readFileSync(
      join(appDir, '.github/workflows/ci.yml'), 'utf8');
    assert.match(ciWorkflow, /npm run check/,
      'CI runs webjs check');
    assert.match(ciWorkflow, /npm run test:server/,
      'CI runs the unit + integration suite (server layer)');
    assert.match(ciWorkflow, /npm run test:browser/,
      'CI runs the browser suite');
    assert.match(ciWorkflow, /WEBJS_E2E/,
      'CI runs the e2e layer');

    // Production / deploy scaffolding ships with every app.
    assert.ok(existsSync(join(appDir, 'Dockerfile')), 'Dockerfile scaffolded');
    assert.ok(existsSync(join(appDir, 'compose.yaml')), 'compose.yaml scaffolded');
    assert.ok(existsSync(join(appDir, '.dockerignore')), '.dockerignore scaffolded');
    const dockerfile = readFileSync(join(appDir, 'Dockerfile'), 'utf8');
    assert.match(dockerfile, /FROM node:24-alpine/,
      'Dockerfile pins the same Node major as CI (24)');
    assert.match(dockerfile, /CMD \["npm", "start"\]/,
      'Dockerfile starts via npm start (a thin alias for webjs start; the ' +
      'migrate runs via webjs.start.before in-process, #550)');
    // Platform-neutral readiness gate: a HEALTHCHECK probing /__webjs/ready, so
    // the gate works on any Docker-based deploy without a per-platform file.
    assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/__webjs\/ready/,
      'Dockerfile HEALTHCHECK probes /__webjs/ready');
    const compose = readFileSync(join(appDir, 'compose.yaml'), 'utf8');
    assert.match(compose, /healthcheck:[\s\S]*\/__webjs\/ready/,
      'compose.yaml healthcheck probes /__webjs/ready');
    // .dockerignore must preserve the .webjs/vendor negation (parent
    // exclusion would silently drop the committed importmap).
    const dockerignore = readFileSync(join(appDir, '.dockerignore'), 'utf8');
    assert.match(dockerignore, /^!\*\*\/\.webjs\/vendor\/$/m,
      '.dockerignore keeps **/.webjs/vendor/ (committed importmap ships)');

    // package.json contents
    const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'my-app');
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.scripts.dev, 'webjs dev');
    assert.equal(pkg.scripts.start, 'webjs start');
    // Both dev and start apply pending migrations before serving (#725), then
    // compile the static Tailwind stylesheet (#947), so a fresh clone boots
    // migrated AND fully styled with no manual step.
    // The before-step calls the Tailwind CLI DIRECTLY (not `npm run css:build`),
    // so it works on the node-less / npm-less Bun image too (#947); node_modules/.bin
    // is on PATH for before/regenerate steps via envWithLocalBin.
    assert.deepEqual(pkg.webjs?.dev?.before, ['webjs db migrate', 'tailwindcss -i ./public/input.css -o ./public/tailwind.css --minify'],
      'webjs.dev.before runs db migrate then the Tailwind compile (#725, #947)');
    assert.deepEqual(pkg.webjs?.start?.before, ['webjs db migrate', 'tailwindcss -i ./public/input.css -o ./public/tailwind.css --minify'],
      'webjs.start.before runs db migrate then the Tailwind compile');
    // Dev keeps the static CSS fresh via on-request regenerate (#967), NOT a
    // background `tailwindcss --watch` (which could die mid-session and serve
    // stale CSS). So there is no dev.parallel watcher, and a regenerate rule
    // rebuilds public/tailwind.css on request when a source is newer.
    assert.equal(pkg.webjs?.dev?.parallel, undefined, 'no --watch parallel task (#967)');
    assert.deepEqual(pkg.webjs?.dev?.regenerate, [{
      output: 'public/tailwind.css',
      command: 'tailwindcss -i ./public/input.css -o ./public/tailwind.css --minify',
      inputs: ['app', 'components', 'modules', 'lib', 'public/input.css'],
    }], 'webjs.dev.regenerate recompiles the static CSS on request (#967)');
    assert.equal(pkg.scripts['css:build'], 'tailwindcss -i ./public/input.css -o ./public/tailwind.css --minify');
    assert.ok(pkg.devDependencies['@tailwindcss/cli'], 'the Tailwind CLI is a devDependency');
    assert.ok(pkg.dependencies['@webjsdev/core']);
    assert.ok(pkg.dependencies['@webjsdev/server']);
    assert.ok(pkg.dependencies['drizzle-orm'], 'drizzle-orm dep present');
    assert.ok(!pkg.dependencies['@prisma/client'], 'no prisma dep');
    // intellisense (@webjsdev/intellisense) stays: it gives editor INTELLIGENCE from node_modules via the
    // tsconfig plugin (any tsserver editor, no editor plugin needed).
    assert.ok(pkg.devDependencies['@webjsdev/intellisense']);
    assert.ok(pkg.devDependencies['@types/node'], 'scaffold installs Node builtin type declarations');
    // @webjsdev/ui is NOT pinned (#399): shadcn-style copy-in; `webjs ui add`
    // resolves the kit from the CLI, so the app needs no pin.
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    assert.ok(!allDeps['@webjsdev/ui'], 'no @webjsdev/ui in a scaffolded app');

    // tsconfig.json has the editor plugin, standalone (no ts-lit-plugin entry).
    const tsconfig = JSON.parse(readFileSync(join(appDir, 'tsconfig.json'), 'utf8'));
    const pluginNames = (tsconfig.compilerOptions.plugins || []).map((p) => p.name);
    assert.ok(pluginNames.includes('@webjsdev/intellisense'), 'editor plugin listed');
    assert.deepEqual(tsconfig.compilerOptions.types, ['node'], 'tsconfig enables node: builtin types for .server.ts files');
    assert.ok(!pluginNames.includes('ts-lit-plugin'), 'no separate ts-lit-plugin entry (standalone, #386)');
    assert.ok(!pkg.devDependencies['ts-lit-plugin'] && !pkg.dependencies['ts-lit-plugin'], 'scaffold pulls no ts-lit-plugin');
    assert.ok(tsconfig.include.includes('test/**/*'),
      'generated tsconfig type-checks the app test directory (#1299)');

    // {{APP_NAME}} placeholder substituted in template files
    const agents = readFileSync(join(appDir, 'AGENTS.md'), 'utf8');
    assert.ok(!agents.includes('{{APP_NAME}}'), 'placeholders substituted in AGENTS.md');

    // .gitignore mentions the SQLite dev DB
    const gitignore = readFileSync(join(appDir, '.gitignore'), 'utf8');
    assert.match(gitignore, /db\/dev\.db/, '.gitignore covers SQLite');

    // .gitignore ignores the real .env but keeps .env.example (#845). The
    // template ships as `gitignore` (no dot) and is renamed on copy, because
    // npm STRIPS a `.gitignore` from a published tarball; a regression to the
    // dotfile name makes the scaffold ship without a .env ignore, so a real
    // .env gets committed. Anchor to line starts so the active rules match,
    // not the comment prose.
    assert.match(gitignore, /^\.env$/m, '.gitignore ignores .env');
    assert.match(gitignore, /^!\.env\.example$/m, '.gitignore keeps .env.example tracked');

    // .gitignore ignores .webjs/ at ANY depth (#365): a scaffolded app
    // nested below its repo root must not leak its generated
    // .webjs/routes.d.ts. The depth-robust `**/.webjs/*` prefix is what
    // distinguishes the fix from the old root-anchored `.webjs/*`.
    // Anchor to a line start (multiline) so these match the ACTIVE rule
    // lines, not the surrounding comment prose that also names the
    // pattern. Without the anchor a revert of the real rule to `.webjs/*`
    // would still pass while a stale comment kept the `**/` text.
    assert.match(
      gitignore,
      /^\*\*\/\.webjs\/\*$/m,
      '.gitignore uses **/.webjs/* so a nested app does not leak routes.d.ts',
    );
    assert.match(
      gitignore,
      /^!\*\*\/\.webjs\/vendor\/$/m,
      '.gitignore keeps the **/ vendor negation so the committed pin ships',
    );

    // .env.example mentions DATABASE_URL
    const envExample = readFileSync(join(appDir, '.env.example'), 'utf8');
    assert.match(envExample, /DATABASE_URL/, '.env.example carries DATABASE_URL');
  } finally {
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('scaffoldApp api: writes API-only template (no layout, no components)', async () => {
  const cwd = await tempCwd();
  const restore = muteConsole();
  try {
    await scaffoldApp('my-api', cwd, { template: 'api' });
    const appDir = join(cwd, 'my-api');

    // Core skeleton still exists
    for (const d of ['app', 'modules', 'lib', 'db', 'test/unit']) {
      assert.ok(existsSync(join(appDir, d)), `${d}/ should exist`);
    }

    // API routes
    assert.ok(existsSync(join(appDir, 'app', 'api', 'health', 'route.ts')), 'health route');
    assert.ok(existsSync(join(appDir, 'app', 'api', 'users', 'route.ts')), 'users route');

    // Root CORS middleware demonstrating the cors() primitive
    const mwPath = join(appDir, 'middleware.ts');
    assert.ok(existsSync(mwPath), 'api template ships a root middleware.ts');
    const mw = readFileSync(mwPath, 'utf8');
    assert.match(mw, /import \{ cors \} from '@webjsdev\/server'/, 'imports cors()');
    assert.match(mw, /export default cors\(/, 'default-exports the cors() middleware');
    // Never demonstrate the invalid wildcard + credentials combination.
    assert.doesNotMatch(mw, /origin:\s*'\*'/, 'no wildcard origin with credentials');

    // #271: the api template has no UI, so it must NOT ship the service worker
    // (this locks the corrected UI-only scoping; the copy lives in create.js's
    // !isApi block).
    assert.ok(!existsSync(join(appDir, 'public', 'sw.js')), 'api ships no sw.js');
    assert.ok(!existsSync(join(appDir, 'public', 'offline.html')), 'api ships no offline.html');

    // Module skeleton
    assert.ok(existsSync(join(appDir, 'modules', 'users', 'queries', 'list-users.server.ts')));
    assert.ok(existsSync(join(appDir, 'modules', 'users', 'actions', 'create-user.server.ts')));
    assert.ok(existsSync(join(appDir, 'modules', 'users', 'types.ts')));

    // Unit tests included
    assert.ok(existsSync(join(appDir, 'test', 'unit', 'users.test.ts')));

    // No layout/page (API-only)
    assert.ok(!existsSync(join(appDir, 'app', 'layout.ts')), 'no layout for api');
    assert.ok(!existsSync(join(appDir, 'app', 'page.ts')), 'no page for api');
    assert.ok(!existsSync(join(appDir, 'components', 'theme-toggle.ts')),
      'no theme-toggle for api');
  } finally {
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});

// #1418: a fresh scaffold used to report 5 high-severity npm audit advisories,
// all of them GHSA-jmr9-qjv8-65gv in extract-zip, reached only through
// @web/test-runner -> @web/test-runner-chrome -> puppeteer-core@24 ->
// @puppeteer/browsers@2.13.2. extract-zip has no patched version, so the floor
// has to sit at puppeteer-core, whose 25 line moved to @puppeteer/browsers@3
// (no extract-zip at all). Both templates declare @web/test-runner, so both
// need the override; the assertion runs over both because the manifest is
// shared and an isApi branch added later could silently drop it from one.
//
// This proves the override is EMITTED, not that the audit is clean: a unit
// test cannot install from the network. The clean-audit half is verified by
// hand against a real scaffold and recorded on the PR.
test('scaffoldApp: both templates pin a puppeteer-core floor clearing the extract-zip advisory (#1418)', async () => {
  for (const template of ['full-stack', 'api']) {
    const cwd = await tempCwd();
    const restore = muteConsole();
    try {
      await scaffoldApp('audit-app', cwd, { template });
      const pkg = JSON.parse(readFileSync(join(cwd, 'audit-app', 'package.json'), 'utf8'));
      assert.equal(pkg.overrides?.['puppeteer-core'], '^25.7.0',
        `${template} overrides puppeteer-core past the @puppeteer/browsers@2 line`);
      assert.ok(pkg.devDependencies['@web/test-runner'],
        `${template} still declares the runner the override exists for`);
    } finally {
      restore();
      await rm(cwd, { recursive: true, force: true });
    }
  }
});

test('scaffoldApp full-stack: the auth card wires createAuth + dashboard + User model', async () => {
  const cwd = await tempCwd();
  const restore = muteConsole();
  try {
    await scaffoldApp('my-app', cwd, { template: 'full-stack' });
    const appDir = join(cwd, 'my-app');

    // Core scaffold in place
    assert.ok(existsSync(join(appDir, 'app', 'layout.ts')), 'layout.ts written');
    assert.ok(existsSync(join(appDir, 'app', 'page.ts')), 'page.ts written');

    // The UI template ships the opt-in service worker (#271).
    assert.ok(existsSync(join(appDir, 'public', 'sw.js')), 'ships public/sw.js');
    assert.ok(existsSync(join(appDir, 'public', 'offline.html')), 'ships public/offline.html');

    // Auth server modules (the auth gallery card). createAuth config + hashing
    // live under modules/auth/ so copyGallery ships them and gallery:clear prunes
    // them; the handler route stays at the app root (createAuth hardcodes /api/auth).
    assert.ok(existsSync(join(appDir, 'modules', 'auth', 'password.server.ts')), 'modules/auth/password.server.ts present');
    assert.ok(existsSync(join(appDir, 'modules', 'auth', 'auth.server.ts')), 'modules/auth/auth.server.ts present');
    assert.ok(existsSync(join(appDir, 'app', 'api', 'auth', '[...path]', 'route.ts')), 'auth api handler at the app root');

    // #877/#556: auth.server.ts must not assign `process.env.AUTH_SECRET`
    // (string | undefined) straight to the required `string` secret (TS2322).
    // It resolves through a typed const with a dev fallback + prod guard.
    const authSrc = readFileSync(join(appDir, 'modules', 'auth', 'auth.server.ts'), 'utf8');
    assert.doesNotMatch(authSrc, /secret:\s*process\.env\.AUTH_SECRET\b/, 'secret must not be the raw string | undefined env read');
    assert.match(authSrc, /const authSecret =/, 'auth secret resolved through a typed const');
    assert.match(authSrc, /secret:\s*authSecret\b/, 'createAuth uses the typed authSecret');
    assert.match(authSrc, /NODE_ENV === 'production'[\s\S]*AUTH_SECRET must be set/, 'production fails fast when AUTH_SECRET is unset');
    assert.match(authSrc, /createAuth, Credentials, GitHub, Google/, 'demonstrates the createAuth provider surface');

    // #878: each auth page carries EXACTLY one <h1> (axe page-has-heading-one
    // wants one, and a second h1 is its own violation). Counterfactual: an
    // <h3>-only page, or a double-h1 dashboard, fails this.
    const h1Count = (src) => (src.match(/<h1\b/g) || []).length;
    for (const p of [['login'], ['signup'], ['dashboard'], ['dashboard', 'settings']]) {
      const pageSrc = readFileSync(join(appDir, 'app', 'features', 'auth', ...p, 'page.ts'), 'utf8');
      assert.equal(h1Count(pageSrc), 1, `auth/${p.join('/')} page has exactly one <h1>`);
    }

    // The users table carries the auth passwordHash column (create.js adds it in
    // the UI template; gallery:clear strips it back out).
    const schema = readFileSync(join(appDir, 'db', 'schema.server.ts'), 'utf8');
    assert.match(schema, /export const users = table\('users'/, 'users table present');
    assert.match(schema, /passwordHash/, 'users table carries the auth passwordHash column');

    // Signup is the canonical no-JS form write-path (#1155): the page BINDS the
    // imported module action with `<form action=${signup}>` (no per-page
    // adapter), and the action returns fieldErrors + values on failure so the
    // re-render keeps the user's input.
    const signup = readFileSync(join(appDir, 'app', 'features', 'auth', 'signup', 'page.ts'), 'utf8');
    assert.match(signup, /<form action=\$\{signup\}/, 'signup form binds the imported action');
    assert.doesNotMatch(signup, /export async function action/,
      'and does NOT reintroduce a per-page action adapter');
    assert.match(signup, /actionData/, 'signup page reads actionData for re-render');
    const signupAction = readFileSync(
      join(appDir, 'modules', 'auth', 'actions', 'signup.server.ts'), 'utf8');
    assert.match(signupAction, /formData: FormData/, 'the action takes the FormData directly');
    assert.match(signupAction, /fieldErrors/, 'and returns field errors');

    // #904: a signed-in user must be able to log out. The dashboard subtree ships
    // a nested layout carrying a plain POST <form> to the createAuth signout route,
    // so logout works with JS off (progressive-enhancement default).
    const dashLayout = readFileSync(join(appDir, 'app', 'features', 'auth', 'dashboard', 'layout.ts'), 'utf8');
    assert.match(dashLayout, /<form method="POST" action="\/api\/auth\/signout"/, 'dashboard layout ships a POST signout form');
    assert.match(dashLayout, /Log out/, 'dashboard layout renders a Log out control');
    // signOut is server-only, so the logout control must reach it through the
    // route, never by importing the server-only auth module into a shipping page.
    assert.doesNotMatch(dashLayout, /import[^\n]*auth\.server/, 'logout control does not import the server-only auth module');

    // The protected route is gated by a per-segment middleware that bounces an
    // anonymous visitor to login.
    const gate = readFileSync(join(appDir, 'app', 'features', 'auth', 'dashboard', 'middleware.ts'), 'utf8');
    assert.match(gate, /auth\(req\)/, 'the gate reads the session off the request');
    assert.match(gate, /location: '\/features\/auth\/login'/, 'the gate redirects anonymous visitors to login');

    // #904: a failed login must surface a message, not silently bounce to the home
    // page. createAuth is configured with pages.error at the login route and the
    // login page reads searchParams.error to render it.
    assert.match(authSrc, /pages:\s*\{\s*error:\s*'\/features\/auth\/login'\s*\}/, 'createAuth points its error page at the login route');
    const login = readFileSync(join(appDir, 'app', 'features', 'auth', 'login', 'page.ts'), 'utf8');
    assert.match(login, /searchParams\.error/, 'login page reads the error query param');
    assert.match(login, /Invalid email or password/, 'login page shows a message for a failed sign-in');

    // The auth test is a REAL handle()-driven flow shipped with the card.
    assert.ok(existsSync(join(appDir, 'test', 'auth', 'auth.test.ts')), 'test/auth/auth.test.ts present');
    const authTest = readFileSync(join(appDir, 'test', 'auth', 'auth.test.ts'), 'utf8');
    assert.match(authTest, /@webjsdev\/server\/testing/, 'auth test uses the handle() test harness');
    assert.match(authTest, /redirects to login when unauthenticated/, 'auth test asserts the protected-route gate');
    assert.match(authTest, /loginAndGetCookies/, 'auth test drives the real login flow');
  } finally {
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('scaffoldApp: generated users module models HTTP-verb actions (#488)', async () => {
  // The api template emits the example users module: a GET read (cache + tags)
  // and a mutation that declares the tags it invalidates, so a new app sees the
  // HTTP-verb idiom out of the box. (create.js writes modules/users/ only inside
  // the `if (isApi)` branch.) Counterfactual: drop the verb config exports from
  // create.js's list-users / create-user strings and these assertions fail.
  const cwd = await tempCwd();
  const restore = muteConsole();
  try {
    await scaffoldApp('verb-app', cwd, { template: 'api' });
    const appDir = join(cwd, 'verb-app');

    const listUsers = readFileSync(
      join(appDir, 'modules', 'users', 'queries', 'list-users.server.ts'), 'utf8');
    assert.match(listUsers, /export const method = 'GET'/, 'list-users declares method GET');
    assert.match(listUsers, /export const cache =/, 'list-users declares a cache window');
    assert.match(listUsers, /export const tags =/, 'list-users declares cache tags');

    const createUser = readFileSync(
      join(appDir, 'modules', 'users', 'actions', 'create-user.server.ts'), 'utf8');
    assert.match(createUser, /export const invalidates =/, 'create-user declares invalidates');
    // The mutation must NOT also declare method GET (a write is POST by default).
    assert.doesNotMatch(createUser, /export const method = 'GET'/, 'create-user is not a GET');
  } finally {
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('scaffoldApp full-stack: per-session current-user stays POST-default (#488)', async () => {
  // The auth-card current-user read is per-user, so it deliberately is NOT a
  // cacheable GET server action: it ships as the documented counter-example.
  // Counterfactual: add `export const method = 'GET'` to the auth card's
  // current-user and this fails (the exact data-leak the comment warns against).
  const cwd = await tempCwd();
  const restore = muteConsole();
  try {
    await scaffoldApp('verb-app', cwd, { template: 'full-stack' });
    const appDir = join(cwd, 'verb-app');
    const currentUser = readFileSync(
      join(appDir, 'modules', 'auth', 'queries', 'current-user.server.ts'), 'utf8');
    assert.doesNotMatch(currentUser, /export const method =/, 'current-user is not a verb-configured GET');
    assert.match(currentUser, /per-session/, 'current-user explains why it stays POST-default');
  } finally {
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('scaffoldApp: exits / throws when the target dir already exists', async () => {
  const cwd = await tempCwd();
  const restore = muteConsole();
  // Stub process.exit so we can catch it.
  const origExit = process.exit;
  let exitCode = null;
  process.exit = (code) => {
    exitCode = code;
    // Throw to short-circuit: scaffoldApp would otherwise continue
    // executing after the existsSync branch.
    throw new Error('exit-stub');
  };
  try {
    await scaffoldApp('first', cwd, { template: 'full-stack' });
    // Second attempt at the same name → should exit(1).
    await assert.rejects(
      () => scaffoldApp('first', cwd, { template: 'full-stack' }),
      /exit-stub/,
    );
    assert.equal(exitCode, 1, 'process.exit(1) on duplicate dir');
  } finally {
    process.exit = origExit;
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('scaffoldApp: template placeholder substitution in copied files', async () => {
  const cwd = await tempCwd();
  const restore = muteConsole();
  try {
    // Deliberately mixed-case: this is the repo's only uppercase exercise of the
    // {{APP_NAME}} substitution path in create.js, and #1066 allows uppercase.
    await scaffoldApp('PlaceholderTest', cwd, { template: 'full-stack' });
    const appDir = join(cwd, 'PlaceholderTest');

    // Walk a few template-copied files and verify {{APP_NAME}} was replaced.
    const filesToCheck = ['AGENTS.md', '.agents/rules/workflow.md'];
    for (const f of filesToCheck) {
      const p = join(appDir, f);
      if (!existsSync(p)) continue;
      const content = readFileSync(p, 'utf8');
      assert.ok(!content.includes('{{APP_NAME}}'),
        `${f} should have {{APP_NAME}} substituted out`);
    }
  } finally {
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('scaffoldApp --db postgres: json<T>() helper maps to jsonb, one schema both dialects', async () => {
  const cwd = await tempCwd();
  const restore = muteConsole();
  try {
    await scaffoldApp('my-pg', cwd, { template: 'full-stack', db: 'postgres' });
    const appDir = join(cwd, 'my-pg');
    const cols = readFileSync(join(appDir, 'db', 'columns.server.ts'), 'utf8');
    // The Postgres seam uses jsonb; the schema (shared across dialects) is
    // unchanged, so the same json<T>() call compiles on both.
    assert.match(cols, /jsonb/, 'postgres columns.server.ts imports jsonb');
    assert.match(cols, /export const json = <T>\(\) => jsonb\(\)\.\$type<T>\(\)/,
      'postgres json<T>() maps to jsonb().$type<T>() (counterfactual: fails if the helper is sqlite-only)');
    const schema = readFileSync(join(appDir, 'db', 'schema.server.ts'), 'utf8');
    assert.match(schema, /json<\{[^}]*\}>\(\)/, 'the one shared schema demonstrates json<T>() on postgres too');
  } finally {
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('scaffoldApp --db postgres: the DATABASE_URL names a fold-stable database', async () => {
  const cwd = await tempCwd();
  const cap = captureConsole();
  try {
    // A mixed-case name used to keep its capitals in the emitted URL, while
    // `CREATE DATABASE MyPgApp;` folds to `mypgapp`, so the URL named a
    // database that did not exist. Anchored and exact: a loose /mypgapp/ would
    // still pass on a URL that carried the capitals somewhere else.
    await scaffoldApp('MyPgApp', cwd, { template: 'full-stack', db: 'postgres' });
    const envExample = readFileSync(join(cwd, 'MyPgApp', '.env.example'), 'utf8');
    assert.match(
      envExample,
      /^DATABASE_URL=postgres:\/\/user:password@localhost:5432\/mypgapp$/m,
      'the postgres DATABASE_URL names the lowercased database',
    );
    // The user has to create that database, so the guidance has to name it.
    assert.match(cap.output(), /mypgapp/, 'the post-scaffold guidance names the derived database');
  } finally {
    cap.restore();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('scaffoldApp --db postgres: an already-lowercase name is unchanged', async () => {
  const cwd = await tempCwd();
  const restore = muteConsole();
  try {
    // Byte-identical to the output before the fold landed: the no-regression
    // half of the counterfactual.
    await scaffoldApp('my-pg', cwd, { template: 'full-stack', db: 'postgres' });
    const envExample = readFileSync(join(cwd, 'my-pg', '.env.example'), 'utf8');
    assert.match(
      envExample,
      /^DATABASE_URL=postgres:\/\/user:password@localhost:5432\/my_pg$/m,
      'a lowercase name still emits the same URL it always did',
    );
  } finally {
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});

// AGENTS.md carries a template-SPECIFIC build playbook (#1076): the full-stack
// scaffold teaches the UI playbook (design tokens, the UI kit, an MPA), the api
// scaffold teaches the backend playbook (route handlers, endpoint security), and
// neither ships guidance that does not match what it generated. Both front-load
// the same required meta-rules and drop the opt-out phrasing that let smaller
// models under-gather context.
test('scaffoldApp: AGENTS.md build playbook is template-specific (#1076)', async () => {
  const cwd = await tempCwd();
  const restore = muteConsole();
  try {
    await scaffoldApp('fs-app', cwd, { template: 'full-stack' });
    await scaffoldApp('api-app', cwd, { template: 'api' });
    const fs = readFileSync(join(cwd, 'fs-app', 'AGENTS.md'), 'utf8');
    const api = readFileSync(join(cwd, 'api-app', 'AGENTS.md'), 'utf8');

    // The placeholder is always substituted (a leftover would ship a broken app).
    for (const [label, md] of [['full-stack', fs], ['api', api]]) {
      assert.doesNotMatch(md, /\{\{PLAYBOOK\}\}|\{\{APP_NAME\}\}/, `${label}: no leftover placeholder`);
    }

    // Shared, required meta-rules on BOTH templates.
    for (const [label, md] of [['full-stack', fs], ['api', api]]) {
      assert.match(md, /Gather context BEFORE you build \(required\)/, `${label}: required context-gathering`);
      assert.match(md, /Read the framework source for exact contracts/, `${label}: source-reading step`);
      assert.match(md, /Never reach for `any`/, `${label}: no-any strict typing`);
      assert.match(md, /npm run check/, `${label}: verification includes the check script`);
      // No opt-out / permission-to-skip phrasing (the #1076 regression to
      // prevent; "only when a task needs" is the historical wording).
      assert.doesNotMatch(md, /do not have to read|only exploring|only (if|when) a task needs/i,
        `${label}: no opt-out phrasing`);
    }

    // Full-stack teaches the UI playbook; the api template must NOT.
    assert.match(fs, /light-dark\(LIGHT, DARK\)/, 'full-stack: design-token mandate');
    assert.match(fs, /Tier 2, custom elements/, 'full-stack: UI kit tier-2 discovery');
    assert.match(fs, /multi-page app \(MPA\)/, 'full-stack: MPA structure');
    assert.match(fs, /position: fixed/, 'full-stack: fixed navbar');
    assert.match(fs, /npm run css:build/, 'full-stack: css:build in the pipeline');
    for (const uiOnly of [/light-dark/, /Tier 2/, /ui add/, /css:build/, /position: fixed/]) {
      assert.doesNotMatch(api, uiOnly, `api: no UI-only guidance (${uiOnly})`);
    }

    // The api template teaches the backend playbook the full-stack one does not.
    assert.match(api, /Build a backend API \(api template\)/, 'api: backend playbook heading');
    assert.match(api, /app\/api\/features\//, 'api: backend-features showcase path');
    assert.match(api, /`route\(\)` adapter/, 'api: route() adapter');
    assert.match(api, /Secure every endpoint/, 'api: endpoint security section');
    assert.doesNotMatch(fs, /Build a backend API/, 'full-stack: no backend-API heading');

    // The component guidance (WebComponent, reactive props) is UI-only, so it
    // lives in the full-stack playbook, never in the api AGENTS.md.
    assert.match(fs, /Build components for interactivity/, 'full-stack: component guidance');
    assert.doesNotMatch(api, /Build components for interactivity|WebComponent/,
      'api: no component/reactive-props guidance');

    // The workflow rules ship into BOTH apps, so they must be template-neutral:
    // no opt-out phrasing, and they must acknowledge the api showcase rather
    // than only the UI gallery.
    const apiFlow = readFileSync(join(cwd, 'api-app', '.agents/rules/workflow.md'), 'utf8');
    assert.doesNotMatch(apiFlow, /only while exploring|do not have to read|only (if|when) a task needs/i,
      'api workflow.md: no opt-out phrasing');
    assert.match(apiFlow, /app\/api\/features/, 'api workflow.md: acknowledges the api showcase');
  } finally {
    restore();
    await rm(cwd, { recursive: true, force: true });
  }
});
