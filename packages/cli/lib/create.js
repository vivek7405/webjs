/**
 * `webjs create <name>`: scaffold a new WebJs app with opinionated defaults.
 *
 * Creates a directory with:
 *   - app/ with a root layout + page
 *   - modules/ skeleton
 *   - components/ with a theme toggle
 *   - test/unit/ and test/e2e/ with example tests
 *   - AGENTS.md plus .agents/ (the one cross-agent guidance surface)
 *   - package.json with WebJs deps + test scripts
 *   - tsconfig.json for editor support
 */

import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { bunifyProse, bunifyDockerfile, bunifyCompose, bunifyCi } from './runtime-rewrite.js';
import { assertValidAppName, toDatabaseName } from './app-name.js';
import { isGalleryAppShellFile } from './gallery-shell-files.js';

/**
 * Detect which package manager invoked us. Reads `npm_config_user_agent`,
 * which npm / pnpm / yarn / bun all set when running scripts or `npx`.
 * Falls back to `npm` when nothing is detected (matches what most users
 * actually have installed).
 *
 * @returns {'npm'|'pnpm'|'yarn'|'bun'}
 */
function detectPackageManager() {
  const ua = process.env.npm_config_user_agent || '';
  if (ua.startsWith('pnpm/')) return 'pnpm';
  if (ua.startsWith('yarn/')) return 'yarn';
  if (ua.startsWith('bun/')) return 'bun';
  return 'npm';
}

/**
 * Run `<pm> install` inside the scaffolded app. Returns true on success.
 * Inherits stdio so the user sees the install progress live. Caller decides
 * whether to call this (skipped when --no-install).
 *
 * @param {string} appDir absolute path to the new app
 * @param {'npm'|'pnpm'|'yarn'|'bun'} pm
 * @returns {boolean}
 */
function runInstall(appDir, pm) {
  const r = spawnSync(pm, ['install'], { cwd: appDir, stdio: 'inherit' });
  return r.status === 0;
}

/**
 * Author the INITIAL Drizzle migration for the shipped schema, so the app boots
 * with its tables and the very first `run dev` works with no manual step. The
 * scaffold's schema is TypeScript (`db/schema.server.ts`); `db migrate` (run in
 * `webjs.dev.before` / `webjs.start.before`) only applies migration SQL FILES, so
 * with no file the shipped example hits "no such table". `db generate` turns the
 * schema into that first `db/migrations/*.sql`. It runs OFFLINE (a schema-to-SQL
 * diff, no database connection), so it is safe for sqlite AND postgres here, well
 * before any `DATABASE_URL` exists. Needs `drizzle-kit`, so it only runs after a
 * successful install; on `--no-install` the printed next-steps still show
 * `db:generate`. Returns whether a migration was authored.
 *
 * @param {string} appDir
 * @param {string} pm
 * @returns {boolean}
 */
function runDbGenerate(appDir, pm) {
  const r = spawnSync(pm, ['run', 'db:generate'], { cwd: appDir, stdio: 'inherit' });
  return r.status === 0;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = resolve(__dirname, '..', 'templates');

// Root of the @webjsdev/ui registry workspace. We read component sources
// directly from disk at create time so the scaffolded app boots ready for
// `webjs ui add` without an HTTP round-trip during scaffolding.
//
//   <ui-pkg-root>/packages/registry/components/*.ts
//   <ui-pkg-root>/packages/registry/lib/utils.ts
//   <ui-pkg-root>/packages/registry/themes/index.css
//
// Locate <ui-pkg-root> via Node's module resolver rather than path
// arithmetic off __dirname. The old `__dirname/../../ui/packages/registry`
// form assumed @webjsdev/ui was a hoisted sibling of @webjsdev/cli under
// node_modules/@webjsdev/. That holds for npm/yarn's default hoisting, but
// breaks on nested layouts (pnpm's isolated linker, `npm install
// --install-strategy=nested`, some CI setups), where @webjsdev/ui lives at
// node_modules/@webjsdev/cli/node_modules/@webjsdev/ui and the arithmetic
// resolves to a path that doesn't exist, failing `webjs create`.
//
// @webjsdev/ui's package.json isn't reachable via require.resolve (its
// `exports` map doesn't expose `./package.json`), so resolve the package
// entry and walk up to the directory that owns its package.json.
function resolveUiRegistryRoot() {
  const require = createRequire(import.meta.url);
  let dir = dirname(require.resolve('@webjsdev/ui'));
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root; give up
    dir = parent;
  }
  return resolve(dir, 'packages', 'registry');
}
const UI_REGISTRY_ROOT = resolveUiRegistryRoot();

/**
 * Copy the example gallery (idiomatic, densely-commented working examples) into
 * the scaffolded app. Merges `templates/gallery/{app,modules}` over the app so
 * single-feature demos land under `app/features/<name>/`, whole example apps
 * under `app/examples/<name>/`, and their logic under `modules/<name>/`, the
 * app-thin + modules-logic split WebJs prescribes.
 *
 * Ships verbatim (no `{{APP_NAME}}` substitution): the examples are self-
 * contained and reference only `@webjsdev/*`, drizzle, `#db/*`, and each other.
 * The scaffold's own `app/page.ts` / `app/layout.ts` are written AFTER this and
 * are filtered out of the copy here (see GALLERY_APP_SHELL_FILES), so there is
 * no clobber. `cp` merges into existing `app/` and `modules/` dirs rather than
 * replacing them.
 *
 * The source is the canonical repo-root `gallery/` app in monorepo dev, and the
 * `templates/gallery/` copy `prepack` bundles into the tarball when installed
 * from npm. Both are filtered identically, so the two modes emit the same app.
 *
 * @param {string} appDir
 */
async function copyGallery(appDir) {
  const bundledGallery = join(TEMPLATES, 'gallery');
  const repoRootGallery = resolve(__dirname, '..', '..', '..', 'gallery');
  const galleryDir = existsSync(bundledGallery) ? bundledGallery : repoRootGallery;
  // `test` carries the auth card's real request-pipeline test (test/auth); it
  // ships with the gallery and is pruned by gallery:clear alongside the card.
  // `components` carries the gallery's EXAMPLE design system (components/ui/ class
  // helpers) the demos import. It ships here so a fresh app's demos work, but it
  // is an example to learn from, so gallery:clear REMOVES it (the agent then runs
  // `webjs ui add` and themes its own components/ui/); only cn.ts is kept as the
  // `webjs ui add` prerequisite. It merges into the app's components/ alongside
  // the separately-written theme toggle (also removed by gallery:clear).
  // `lib` merges the gallery's markup-chunk helpers (lib/utils/ui.ts) alongside
  // the ui bootstrap's cn.ts/dom.ts (written earlier); gallery:clear removes just
  // ui.ts. cp is recursive-merge, so the pre-written lib/utils/ files are kept.
  for (const sub of ['app', 'modules', 'test', 'components', 'lib']) {
    const srcSub = join(galleryDir, sub);
    if (!existsSync(srcSub)) continue;
    await cp(srcSub, join(appDir, sub), {
      recursive: true,
      // Skip the gallery's own app shell (root layout, home page, theme toggle,
      // cn.ts). Those exist because gallery/ is a live app; the scaffold writes
      // its own, with the app's displayName and the ui-registry cn.ts.
      filter: (src) => !isGalleryAppShellFile(relative(galleryDir, src)),
    });
  }
}

/**
 * Write `lib/utils/cn.ts` (the `cn()` helper) and `components.json` so the
 * scaffolded app is pre-initialised for `webjs ui add`. Reads the registry's
 * `lib/utils.ts` verbatim and writes it under `lib/utils/cn.ts` in the
 * scaffolded app so cn() sits in the same folder as the other browser-safe
 * helpers (ui.ts, format.ts).
 *
 * @param {string} appDir
 */
async function writeUiBootstrap(appDir) {
  // Caller (scaffoldApp) has already invoked assertUiRegistryAvailable(),
  // so the source files below are guaranteed to exist.

  // 1) lib/utils/cn.ts: the cn() helper (pure; safe to import into a page).
  const utilsContent = await readFile(
    join(UI_REGISTRY_ROOT, 'lib', 'utils.ts'), 'utf8',
  );
  await mkdir(join(appDir, 'lib', 'utils'), { recursive: true });
  await writeFile(join(appDir, 'lib', 'utils', 'cn.ts'), utilsContent);

  // 1b) lib/utils/dom.ts: the client-only DOM helper (onBeforeCache). Split out
  // of cn.ts so importing cn() does not pin a page to the browser (#819). Any
  // `webjs ui add` component that uses onBeforeCache imports it from here.
  const domContent = await readFile(
    join(UI_REGISTRY_ROOT, 'lib', 'dom.ts'), 'utf8',
  );
  await writeFile(join(appDir, 'lib', 'utils', 'dom.ts'), domContent);

  // 2) components.json: byte for byte what `webjsui init` writes (see the
  // DEFAULT_ALIASES / DEFAULT_TAILWIND_CSS constants in
  // packages/ui/src/commands/init.js, which #1129 made the single source of
  // these values). Keep the two in step: an app that scaffolds and one that
  // runs `webjs ui init` must end up with the same config. The utils alias
  // is lib/utils/cn so get-config.js's `+ '.ts'` resolves to lib/utils/cn.ts.
  // The theme CSS lives at styles/globals.css, NOT app/globals.css: app/ is
  // routing-only, so a non-routing stylesheet does not belong there.
  const componentsJson = {
    $schema: 'https://ui.webjs.dev/schema.json',
    style: 'default',
    tailwind: {
      css: 'styles/globals.css',
      baseColor: 'neutral',
      cssVariables: true,
    },
    aliases: {
      components: 'components',
      utils: 'lib/utils/cn',
      ui: 'components/ui',
      lib: 'lib',
    },
    iconLibrary: 'lucide',
  };
  await writeFile(
    join(appDir, 'components.json'),
    JSON.stringify(componentsJson, null, 2) + '\n',
  );

  // 3) styles/globals.css: copy the neutral theme verbatim. components.json
  // references this path, and future `webjs ui add` calls append to it. It
  // lives OUTSIDE app/ because app/ is routing-only. The same @theme maps are
  // written to public/input.css and compiled to the static public/tailwind.css
  // the layout links (so the app is styled with JavaScript off).
  const css = await readFile(
    join(UI_REGISTRY_ROOT, 'themes', 'index.css'), 'utf8',
  );
  await mkdir(join(appDir, 'styles'), { recursive: true });
  await writeFile(join(appDir, 'styles', 'globals.css'), css);
}

/**
 * Read the @webjsdev/ui theme CSS so we can write it into public/input.css,
 * which css:build compiles into the static public/tailwind.css the layout
 * links. The theme tokens (`--color-primary`, `--color-card`, …) the registry
 * components consume become real utility classes in the compiled stylesheet,
 * so the app is styled with JavaScript off.
 *
 * @returns {Promise<string>} theme CSS source
 */
async function readThemeCss() {
  const src = join(UI_REGISTRY_ROOT, 'themes', 'index.css');
  return await readFile(src, 'utf8');
}

/**
 * Fail loudly when the @webjsdev/ui registry is not on disk. The scaffold
 * reads component sources, the cn() helper, and the @webjsdev/ui theme from
 * UI_REGISTRY_ROOT and weaves them into a generated app/page.ts that
 * imports `components/ui/button.ts`. If the registry is missing, the
 * generated app boots to ERR_MODULE_NOT_FOUND on first request, which is
 * a confusing failure for end-users to debug.
 *
 * The check guards against an @webjsdev/ui published tarball that forgets
 * to ship `packages/registry/` in its `files` array (the bug fixed in
 * the same commit), and against a corrupted node_modules install.
 */
function assertUiRegistryAvailable() {
  const required = [
    join(UI_REGISTRY_ROOT, 'components'),
    join(UI_REGISTRY_ROOT, 'lib', 'utils.ts'),
    join(UI_REGISTRY_ROOT, 'themes', 'index.css'),
  ];
  const missing = required.filter((p) => !existsSync(p));
  if (missing.length === 0) return;
  throw new Error(
    `@webjsdev/ui registry sources not found at ${UI_REGISTRY_ROOT}.\n` +
    `Missing:\n${missing.map((p) => `  - ${p}`).join('\n')}\n\n` +
    `The scaffold reads component sources from the installed @webjsdev/ui ` +
    `package. If you see this from a fresh \`npm create webjs\`, the ` +
    `published @webjsdev/ui tarball is missing \`packages/registry/\` ` +
    `(check its package.json \`files\` array). Please file an issue at ` +
    `https://github.com/webjsdev/webjs/issues with your @webjsdev/ui ` +
    `version (\`npm ls @webjsdev/ui\`).`,
  );
}

/**
 * @param {string} name  App directory name
 * @param {string} cwd   Current working directory
 */
export async function scaffoldApp(name, cwd, opts = {}) {
  // Defence in depth, same as the template check below. `webjs create` already
  // validates the name, but a programmatic caller can pass anything, and the
  // name is interpolated into generated source as a template-literal value
  // (#1066), so an unvalidated quote / backtick / `${` would emit a file that
  // fails to parse. Throwing here happens before any directory is created.
  assertValidAppName(name);
  const template = opts.template || 'full-stack';
  // A human-friendly display title for the example home page. The package
  // `name` stays the raw slug as typed, but showing a hyphenated slug as
  // a hero title looks unpolished, so title-case it for display ("my-app" ->
  // "My App"). Replace this with your real brand anyway.
  const displayName = name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  // `install` is opt-in at the library level (so tests + programmatic
  // callers get a side-effect-free scaffold by default). The CLI entry
  // points (`webjs create` and `npx create-webjs-app`) explicitly set
  // `install: true` unless the user passes `--no-install`.
  const shouldInstall = opts.install === true;
  // Defence in depth. The CLI already validates this, but library
  // callers (tests, programmatic use) might pass anything.
  const VALID_TEMPLATES = ['full-stack', 'api'];
  if (!VALID_TEMPLATES.includes(template)) {
    throw new Error(
      `Unknown template '${template}'. Only ${VALID_TEMPLATES.join(' / ')} exist.`,
    );
  }
  const isApi = template === 'api';
  // The example gallery ships in the one UI template (not api, which has no UI),
  // so the copyGallery gate below is !isApi. Auth is one of the gallery cards
  // (app/features/auth + modules/auth), so a UI app ships a real, prunable auth
  // baseline. `isFullStack` names the UI template for the parts that differ from
  // api (the todos table + the passwordHash column the auth card needs).
  const isFullStack = !isApi;

  // Database dialect (#563): sqlite (default) or postgres. Drizzle is the ORM;
  // the schema/queries/actions are identical across dialects, only db/columns
  // + db/connection + the driver dep differ.
  const dialect = opts.db || 'sqlite';
  const VALID_DIALECTS = ['sqlite', 'postgres'];
  if (!VALID_DIALECTS.includes(dialect)) {
    throw new Error(`Unknown --db '${dialect}'. Only ${VALID_DIALECTS.join(' / ')} are supported.`);
  }

  // Runtime axis (#541), ORTHOGONAL to --template (the exactly-3-templates
  // invariant is untouched). Default node; bun opt-in via `--runtime bun` OR
  // auto-detected when the scaffold is invoked through bun (`bun create webjs`),
  // with the explicit flag winning over detection. A bun-flavored app SERVES on
  // Bun (its dev/start scripts force `--bun`), commits `bun.lock`, sets
  // `trustedDependencies`, and ships a bun Dockerfile / CI / agent docs.
  const runtime = opts.runtime || (detectPackageManager() === 'bun' ? 'bun' : 'node');
  const VALID_RUNTIMES = ['node', 'bun'];
  if (!VALID_RUNTIMES.includes(runtime)) {
    throw new Error(`Unknown --runtime '${runtime}'. Only ${VALID_RUNTIMES.join(' / ')} are supported.`);
  }
  const isBun = runtime === 'bun';
  // Tailwind compile commands (#947). A UI scaffold compiles a STATIC stylesheet
  // (not the browser runtime), so it renders styled with JavaScript off. The
  // compiler is a node-shebang CLI, so a Bun app (whose Dockerfile is a node-less
  // `oven/bun:1` image, #595) must run it under Bun via `bun --bun`; a Node app
  // runs it directly (the before / regenerate steps get node_modules/.bin on PATH
  // via envWithLocalBin). Deliberately NOT `npm run css:build` in the hooks: the
  // Bun image has no npm, so that step would exit 127 and abort the boot.
  const twBin = isBun ? 'bun --bun tailwindcss' : 'tailwindcss';
  const cssBuildCmd = `${twBin} -i ./public/input.css -o ./public/tailwind.css --minify`;
  const appDir = join(cwd, name);
  if (existsSync(appDir)) {
    console.error(`Error: directory '${name}' already exists.`);
    process.exit(1);
  }

  console.log(`\nwebjs create: scaffolding '${name}' (${template})...\n`);

  // Create directory structure
  const dirs = [
    'app',
    'components',
    'modules',
    'lib',
    'public',
    'db',
    'test/unit',
    'test/e2e',
  ];
  for (const d of dirs) await mkdir(join(appDir, d), { recursive: true });

  // --- Root files ---

  await writeFile(join(appDir, 'package.json'), JSON.stringify({
    name,
    version: '0.1.0',
    type: 'module',
    private: true,
    // Native package.json subpath aliases (#555): write app-internal imports as
    // `#lib/...`, `#components/...`, `#db/...`, `#<any-dir>/...` instead of deep
    // `../../../` relatives. ONE catch-all key, so a new top-level folder is
    // aliased with no config change. Node 24+ and Bun both resolve `#*` natively
    // (a `#/`-prefixed key is rejected by Bun, so this slash-free form is the
    // cross-runtime-safe shape; no build step, no tsconfig paths). The webjs
    // server expands the same map for the import graph + browser importmap. Opt
    // out by using a plain relative import.
    imports: {
      '#*': './*',
    },
    scripts: {
      // No `predev` / `prestart` hooks (#550): the `webjs` block below holds
      // the dev + start orchestration (`webjs db migrate`), run INSIDE `webjs
      // dev` / `webjs start`, so `npm run dev` / `start` (thin aliases) behave
      // identically. Both apply pending migrations before serving (#725).
      //
      // Bun runtime (#541): the long-running server scripts (`dev` / `start`)
      // are prefixed `bun --bun` so the app SERVES on Bun. The `--bun` overrides
      // the `webjs` bin's `#!/usr/bin/env node` shebang (without it `bun run dev`
      // would exec WebJs under Node, silently running the "bun" app on Node).
      // Baking it into the script body means a plain `bun run dev` (or even
      // `npm run dev`) starts on Bun, so a user never has to remember the flag.
      // The runtime-neutral tooling scripts below (test / db / check / typecheck
      // / doctor) stay plain `webjs ...`: they spawn node tooling (`node --test`,
      // drizzle-kit, tsc) and forcing `--bun` there buys nothing (and `webjs
      // test` shells `node --test`, which a `bun --test` would not be).
      // Compile Tailwind from public/input.css to a STATIC public/tailwind.css
      // that app/layout.ts links, so the app is fully styled with JavaScript
      // DISABLED (a real stylesheet, not an in-browser compile). Runs inside the
      // dev and start tasks via the `before` hooks below. Runtime-aware: a Bun
      // app runs the compiler under Bun (its image has no Node), a Node app runs
      // it directly.
      ...(isApi ? {} : { 'css:build': cssBuildCmd }),
      // Shed the demo gallery / backend-features showcase to a clean, buildable
      // base. The UI template runs clear-gallery.mjs; the api template runs
      // clear-api-gallery.mjs (its showcase is app/api/features, not app/features).
      'gallery:clear': (() => {
        const script = isApi ? 'clear-api-gallery.mjs' : 'clear-gallery.mjs';
        return isBun ? `bun scripts/${script}` : `node scripts/${script}`;
      })(),
      dev: isBun ? 'bun --bun webjs dev' : 'webjs dev',
      start: isBun ? 'bun --bun webjs start' : 'webjs start',
      test: 'webjs test',
      'test:server': 'webjs test --server',
      'test:browser': 'webjs test --browser',
      check: 'webjs check',
      typecheck: 'webjs typecheck',
      // Project health: a contributor runs `npm run doctor` after cloning to
      // assert the toolchain (Node floor, tsconfig flag, env drift, vendor
      // pins, @webjsdev versions, git hook), and CI runs the same script. Which
      // findings are FATAL comes from the `webjs.doctor.gate` block below, so
      // the environment-shaped checks (env drift, pin freshness over the
      // network, the git hook) stay warns and cannot make CI flaky.
      doctor: 'webjs doctor',
      'db:generate': 'webjs db generate',
      'db:migrate': 'webjs db migrate',
      'db:push': 'webjs db push',
      'db:studio': 'webjs db studio',
      'db:seed': 'webjs db seed',
    },
    dependencies: {
      // Drizzle ORM (no codegen, no engine binary). Pinned to the 1.0 line
      // for relations v2. SQLite needs NO driver dependency: the connection
      // uses the built-in node:sqlite (Node) / bun:sqlite (Bun) via Drizzle's
      // node-sqlite / bun-sqlite adapters. Postgres still needs the pg driver.
      // Pinned EXACTLY (no caret): a caret on a prerelease still admits later
      // rc.N of 1.0.0, and the relations-v2 query API the scaffold is written and
      // tested against is rc.3 (#562). An exact pin keeps generated apps
      // deterministic instead of silently drifting to a newer rc.
      'drizzle-orm': '1.0.0-rc.3',
      ...(dialect === 'postgres' ? { pg: '^8.13.0' } : {}),
      '@webjsdev/cli': 'latest',
      '@webjsdev/core': 'latest',
      '@webjsdev/server': 'latest',
    },
    devDependencies: {
      'drizzle-kit': '1.0.0-rc.3',
      ...(dialect === 'postgres' ? { '@types/pg': '^8.11.0' } : {}),
      // The TypeScript compiler, for `npm run typecheck` (webjs typecheck runs
      // tsc --noEmit). Not needed at runtime (Node strips types in place), only
      // to type-check the app.
      // Must not resolve below the floor the tsconfig this same generator
      // writes requires: `erasableSyntaxOnly` landed in TypeScript 5.8, and a
      // 5.6 or 5.7 resolution refuses the whole config with
      // `TS5023: Unknown compiler option`. Kept on the major the repo's own
      // apps use, so an app and the framework that generated it type-check
      // under the same compiler. Guarded by
      // test/scaffolds/scaffold-typescript-floor.test.js.
      typescript: '^6.0.3',
      '@types/node': '^24.0.0',
      '@web/test-runner': '^0.20.0',
      '@web/test-runner-playwright': '^0.11.0',
      'playwright': '^1.59.0',
      // The standard accessibility engine, used opt-in by the
      // assertNoA11yViolations() test helper from @webjsdev/core/testing.
      // Test-only: dynamically imported, never shipped to the app runtime.
      'axe-core': '^4.10.0',
      // The Tailwind v4 CLI that css:build runs to compile public/input.css into
      // the static public/tailwind.css the layout links. UI templates only (the
      // api template has no CSS). Build tooling, never shipped to the runtime.
      ...(isApi ? {} : { '@tailwindcss/cli': '^4.1.0' }),
      // tsserver plugin, wired into tsconfig below. Gives the language
      // INTELLIGENCE (go-to-def, completions, diagnostics, hover inside html``
      // templates) in any tsserver editor with NO editor plugin installed,
      // because editors load tsconfig plugins from node_modules. The `webjs`
      // VS Code extension and webjs.nvim ALSO bundle this plugin (so it works
      // before `npm install` too, and adds template HIGHLIGHTING, which a
      // tsserver plugin can't provide); tsserver dedupes by name, so loading
      // it both ways is a no-op. Standalone, no Lit dependency. Editor-only.
      '@webjsdev/intellisense': 'latest',
      // NOTE: @webjsdev/ui is intentionally NOT pinned. The UI kit uses a
      // copy-in model (shadcn-compatible conventions): `webjs ui add <name>`
      // copies component source into components/ui/ (they import
      // @webjsdev/core, not the kit), and the
      // CLI resolves @webjsdev/ui from its own install.
    },
    // Transitive-version floor for the browser test runner (#1418). Without
    // this, `npm audit` in a freshly created app reports 5 high-severity
    // advisories the moment scaffolding finishes, all of them one advisory
    // (GHSA-jmr9-qjv8-65gv, an unvalidated symlink path traversal in
    // extract-zip) reached through one chain:
    //
    //   @web/test-runner -> @web/test-runner-chrome -> puppeteer-core@24
    //     -> @puppeteer/browsers@2.13.2 -> extract-zip@2.0.1
    //
    // extract-zip has NO patched version (the advisory covers `*`, and 2.0.1
    // is the newest release), so an override on extract-zip itself cannot fix
    // anything. The fix sits one level up: @puppeteer/browsers@3 dropped
    // extract-zip entirely (it unpacks with modern-tar), and puppeteer-core@25
    // depends on that 3 line. puppeteer-core@24.43.1 pins @puppeteer/browsers
    // EXACTLY ("2.13.2", no caret), so npm cannot dedupe its way out and an
    // explicit override is the only lever.
    //
    // Nothing in a scaffolded app executes this code. The runner is a
    // devDependency, and web-test-runner.config.js launches browsers through
    // playwrightLauncher, so the puppeteer chrome launcher is dead weight that
    // @web/test-runner pulls in unconditionally via its own hard dependency on
    // @web/test-runner-chrome (there is no supported install without it).
    //
    // Caret, not an exact pin: this is a security FLOOR, so a generated app
    // should pick up later 25.x patches. That is the opposite of the
    // drizzle-orm reasoning above, where the exact pin is deliberate because
    // the scaffold source is written against one rc API.
    //
    // Do NOT "fix" this by taking @web/test-runner@1, which is what
    // `npm audit fix --force` proposes: its @web/test-runner-chrome@1 still
    // declares puppeteer-core ^24, so the same vulnerable chain resolves and
    // the audit stays red after a breaking major.
    overrides: {
      'puppeteer-core': '^25.7.0',
    },
    // Dev + start task orchestration (#550). `webjs dev` / `webjs start` read
    // `before` and run it in-process, so `npm run dev` / `start` (thin aliases
    // above) behave identically. Both apply pending migrations via `webjs db
    // migrate` (idempotent, a no-op when the db is current), so a freshly
    // generated migration is applied without a manual step (#725). For a UI
    // template it ALSO compiles Tailwind in `before` so a freshly cloned app is
    // styled on the very first boot with no manual step. The compile command is
    // the runtime-aware `cssBuildCmd` (a Bun app runs it under Bun, since its
    // image has no npm or Node), NOT `npm run css:build`. The api template has no
    // CSS, so it gets neither.
    //
    // In dev the static public/tailwind.css is kept fresh by `dev.regenerate`
    // (#967), NOT a background `tailwindcss --watch`. A watch that dies mid-
    // session or never starts serves stale/missing CSS with no error (a newly
    // added utility class has no backing rule, so the app renders unstyled
    // locally while prod is fine). `regenerate` instead recompiles ON REQUEST
    // when the output is older than a source (or missing): the framework rebuilds
    // it before serving `/public/tailwind.css`, so there is no watch process to
    // die and no staleness window. Same `cssBuildCmd` as prod, so dev and prod
    // resolve classes identically (nothing to diverge). `inputs` mirrors the
    // input.css @source globs (the dirs Tailwind scans for classes).
    webjs: {
      dev: {
        before: isApi ? ['webjs db migrate'] : ['webjs db migrate', cssBuildCmd],
        ...(isApi ? {} : {
          regenerate: [{
            output: 'public/tailwind.css',
            command: cssBuildCmd,
            inputs: ['app', 'components', 'modules', 'lib', 'public/input.css'],
          }],
        }),
      },
      start: { before: isApi ? ['webjs db migrate'] : ['webjs db migrate', cssBuildCmd] },
      // Which doctor findings are FATAL is the app's own call (#1257), declared
      // here rather than in the CI workflow so `npm run doctor` locally and the
      // workflow step agree about what fails. UNMARKED_ASSET_LINKS starts at
      // error because an un-versioned /public url is a real deploy-staleness
      // bug (it shipped a visible regression on webjs.dev) and the generated
      // layout already writes asset(), so a fresh app is green on day one.
      // Two checks are fatal with no entry here at all, NODE_VERSION and
      // TSCONFIG_ERASABLE, because either would 500 the app at runtime;
      // everything else keeps its default warn. Add a code with "off" to
      // silence it, or "error" to make it fatal too.
      doctor: { gate: { UNMARKED_ASSET_LINKS: 'error' } },
    },
  }, null, 2) + '\n');

  await writeFile(join(appDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      types: ['node'],
      strict: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      skipLibCheck: true,
      // WebJs uses Node's built-in type-stripping (`process.features.
      // typescript === 'strip'`) which preserves source positions
      // byte-exactly. The constraint is that TypeScript must be
      // "erasable": no `enum`, no `namespace` with values, no
      // constructor parameter properties, no legacy decorators with
      // `emitDecoratorMetadata`. erasableSyntaxOnly makes the
      // compiler reject those at edit time so violations surface as
      // red squiggles instead of runtime ERR_UNSUPPORTED_TYPESCRIPT_
      // SYNTAX errors. Use a `const` object + union for enum-shaped
      // values; write fields + constructor assignments explicitly.
      erasableSyntaxOnly: true,
      // @webjsdev/intellisense (standalone, no Lit dependency) gives the editor,
      // inside html`` templates:
      //   • go-to-definition on custom-element tags, attributes, and CSS classes
      //   • binding-aware completions (tag names, .prop / ?bool / plain attrs)
      //   • diagnostics (value type-checks, unquoted-binding, expressionless .prop)
      //   • hover showing the component class / declared member type
      // Editor-only. The framework runs without it. For VS Code / Cursor /
      // Windsurf, the `webjs` extension bundles this automatically.
      plugins: [
        { name: '@webjsdev/intellisense' },
      ],
    },
    // `test/**/*` is in so `webjs typecheck` reads the tests you write, the
    // same way Next / Remix / Astro's generated configs do (#1299). A type
    // error in a test is then a gate failure rather than something a reviewer
    // has to catch by eye, and it needs no second config to remember to run.
    //
    // `.webjs/routes.d.ts` is the OPT-IN generated route-types overlay (#258):
    // run `webjs types` (or `webjs dev`, which emits it) to narrow the
    // @webjsdev/core `Route` href union + per-route `params`. Listed in
    // `include` so tsserver picks it up; it is gitignored (regenerated per
    // machine), so a fresh clone runs `webjs dev` / `webjs types` to recreate
    // it, and the static @webjsdev/core types work even when it is absent.
    include: [
      'app/**/*',
      'components/**/*',
      'modules/**/*',
      'lib/**/*',
      'test/**/*',
      'middleware.js',
      'middleware.ts',
      '.webjs/routes.d.ts',
    ],
    exclude: ['node_modules', '.webjs/vendor', 'db/migrations'],
  }, null, 2) + '\n');

  // --- Templates (AGENTS.md, .agents/, test files, git hook) ---

  const templateFiles = [
    // ONE agent surface, no per-agent rule files. AGENTS.md is the open
    // standard agents read natively, and it points at .agents/skills/webjs/
    // (the guidance) and .agents/rules/workflow.md (the workflow). A generated
    // app gets no CLAUDE.md, no .cursorrules, no vendor hook config: how a team
    // runs its tools is theirs to decide, and the rules that actually protect
    // the app are enforced agent-agnostically by `webjs check` and CI.
    'AGENTS.md',
    '.agents/rules/workflow.md',
    // Git pre-commit hook (blocks commits directly to main).
    '.hooks/pre-commit',
    // Starter tests under the feature-folder layout.
    'test/hello/hello.test.ts',
    'test/hello/browser/hello.test.js',
    'test/hello/e2e/hello.test.ts',
    'web-test-runner.config.js',
    // Optional boot-time APM hook (setOnError). Delete if unused.
    'instrumentation.ts',
    '.env.example',
    // Shipped without a dot (npm strips a published .gitignore) and renamed on copy.
    'gitignore',
    '.github/pull_request_template.md',
    // CI runs webjs check + the test layers on every PR and push to main.
    '.github/workflows/ci.yml',
    '.editorconfig',
    '.vscode/settings.json',
    // Production / deploy scaffolding.
    'Dockerfile',
    'compose.yaml',
    '.dockerignore',
  ];
  // Bun runtime (#541): the agent-config markdown shows bun commands, and the
  // deploy files (Dockerfile / compose / CI) run on Bun. Each is DERIVED from
  // the canonical node template by a pure transform (see runtime-rewrite.js), so
  // there is no parallel bun template to drift. Prose files get the command
  // rewrites; the three infra files get their file-specific transform. On Node,
  // every file is copied byte-identical (the map is empty).
  const PROSE_REWRITE = new Set([
    'AGENTS.md',
    '.agents/rules/workflow.md',
    'test/hello/browser/hello.test.js', 'test/hello/e2e/hello.test.ts',
  ]);
  // compose.yaml builds from the (pure oven/bun) Dockerfile and inherits its
  // `bun --bun run start` CMD; only its healthcheck needs switching off node
  // (the pure Bun image has no node), which bunifyCompose does.
  const FILE_REWRITE = {
    'Dockerfile': bunifyDockerfile,
    'compose.yaml': bunifyCompose,
    '.github/workflows/ci.yml': bunifyCi,
  };
  for (const f of templateFiles) {
    const src = join(TEMPLATES, f);
    if (existsSync(src)) {
      // `gitignore` ships without a dot (npm strips a published `.gitignore`)
      // and is written to `.gitignore` in the generated app.
      const dest = f === 'gitignore' ? '.gitignore' : f;
      await mkdir(dirname(join(appDir, dest)), { recursive: true });
      let content = await readFile(src, 'utf8');
      content = content.replace(/\{\{APP_NAME\}\}/g, name);
      // AGENTS.md carries a template-specific build playbook: the full-stack
      // (UI) playbook or the api (backend) one. The shared meta-rules (required
      // context-gathering, strict typing, data) live in AGENTS.md itself; only
      // the `{{PLAYBOOK}}` section swaps, so the two stay single-sourced. The
      // partials live under templates/partials/ and are NOT copied as app files.
      if (f === 'AGENTS.md') {
        const playbookFile = isApi ? 'agents-playbook-api.md' : 'agents-playbook-fullstack.md';
        const playbook = await readFile(join(TEMPLATES, 'partials', playbookFile), 'utf8');
        content = content.replace('{{PLAYBOOK}}', () => playbook.trimEnd());
      }
      if (isBun) {
        if (PROSE_REWRITE.has(f)) content = bunifyProse(content);
        else if (FILE_REWRITE[f]) content = FILE_REWRITE[f](content);
      }
      await writeFile(join(appDir, dest), content);
    }
  }

  // The agent skill is the one cross-agent source (AGENTS.md points to it). It
  // lives ONCE, canonically, at the repo-root `.agents/skills/webjs/`. A
  // published CLI bundles it under `templates/` at prepack (see
  // scripts/sync-scaffold-skill.mjs, wired into this package's prepack), so copy
  // that bundle when present; in the monorepo the bundle is gitignored, so fall
  // back to the repo-root canonical.
  const bundledSkill = join(TEMPLATES, '.agents', 'skills', 'webjs');
  const repoRootSkill = resolve(__dirname, '..', '..', '..', '.agents', 'skills', 'webjs');
  const skillSrc = existsSync(bundledSkill) ? bundledSkill : repoRootSkill;
  if (existsSync(skillSrc)) {
    const skillDest = join(appDir, '.agents', 'skills', 'webjs');
    await cp(skillSrc, skillDest, { recursive: true });
    // Bun runtime (#541): the skill's runnable commands are authored in the
    // canonical npm forms, so derive the bun flavor on copy, the same way the
    // agent-config markdown above goes through bunifyProse. references/runtime.md
    // is EXCLUDED on purpose: it is the deliberate node-vs-bun command matrix,
    // and rewriting its npm column would destroy the comparison it exists to
    // make.
    if (isBun) {
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(skillDest, { recursive: true, withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.md') || e.name === 'runtime.md') continue;
        const p = join(e.parentPath, e.name);
        await writeFile(p, bunifyProse(await readFile(p, 'utf8')));
      }
    }
  }

  // Make the git pre-commit hook executable. It is the one piece of
  // enforcement the scaffold ships, and it is git-level rather than
  // agent-level, so it binds every agent, editor, and human equally.
  const { chmod } = await import('node:fs/promises');
  const preCommitPath = join(appDir, '.hooks', 'pre-commit');
  if (existsSync(preCommitPath)) await chmod(preCommitPath, 0o755);

  // --- Drizzle db layer (all templates), dialect-selected (#563) ---
  //
  // The schema, queries, and actions are identical across dialects; only
  // db/columns.server.ts + db/connection.server.ts + drizzle.config.ts + the
  // driver dep differ. Switching dialect (e.g. SQLite in dev, Postgres in
  // prod) is a config + module swap, not a code rewrite. Pinned to drizzle-orm
  // 1.0.0-rc.3 (relations v2). See research #562.

  const columnsSqlite = `import { sqliteTableCreator, integer, text, real, blob, index as _index } from 'drizzle-orm/sqlite-core';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { getTableName, type Table } from 'drizzle-orm';

// Raw drizzle builders, re-exported so the schema reads like drizzle.
export { text, integer, real, blob };

// Casing factory: column keys map to snake_case SQL names.
export const table = sqliteTableCreator((name) => name, 'snake_case');

export const pk = () => integer().primaryKey({ autoIncrement: true });
export const uuidPk = () => text().primaryKey().$defaultFn(() => crypto.randomUUID());
export const uuid = () => text();
// Structured value (array / object) stored as JSON. Type it with json<T>() so
// the column is narrowed on read/write instead of \`unknown\`.
export const json = <T>() => text({ mode: 'json' }).$type<T>();
export const bool = () => integer({ mode: 'boolean' });
export const timestamp = () => integer({ mode: 'timestamp_ms' });
export const createdAt = () => timestamp().notNull().defaultNow();
export const updatedAt = () => timestamp().notNull().defaultNow().$onUpdate(() => new Date());

// Anonymous-style index helper (rc.3 requires a name; this derives a
// table-qualified one, matching drizzle-kit's own convention).
export const index = (...cols: SQLiteColumn[]) =>
  _index(getTableName((cols[0] as unknown as { table: Table }).table) + '_' + cols.map((c) => c.name).join('_') + '_idx').on(...(cols as [SQLiteColumn, ...SQLiteColumn[]]));
`;

  const columnsPg = `import { pgTableCreator, serial, uuid as pgUuid, integer, text, real, boolean, jsonb, timestamp as pgTimestamp, index as _index } from 'drizzle-orm/pg-core';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { getTableName, type Table } from 'drizzle-orm';

export { text, integer, real };

export const table = pgTableCreator((name) => name, 'snake_case');

export const pk = () => serial().primaryKey();
export const uuidPk = () => pgUuid().primaryKey().defaultRandom();
export const uuid = () => pgUuid();
// Structured value (array / object) stored as JSON. Type it with json<T>() so
// the column is narrowed on read/write instead of \`unknown\`.
export const json = <T>() => jsonb().$type<T>();
export const bool = () => boolean();
export const timestamp = () => pgTimestamp({ withTimezone: true });
export const createdAt = () => timestamp().notNull().defaultNow();
export const updatedAt = () => timestamp().notNull().defaultNow().$onUpdate(() => new Date());

export const index = (...cols: PgColumn[]) =>
  _index(getTableName((cols[0] as unknown as { table: Table }).table) + '_' + cols.map((c) => c.name).join('_') + '_idx').on(...(cols as [PgColumn, ...PgColumn[]]));
`;

  await writeFile(join(appDir, 'db', 'columns.server.ts'), dialect === 'postgres' ? columnsPg : columnsSqlite);

  // Example schema (dialect-agnostic). Replace the User model with your own.
  await writeFile(join(appDir, 'db', 'schema.server.ts'), `import { defineRelations } from 'drizzle-orm';
import { table, pk, ${isFullStack ? 'uuidPk, ' : ''}text, ${isFullStack ? 'bool, ' : ''}json, createdAt } from './columns.server.ts';

// Example model. Feel free to delete or extend.
export const users = table('users', {
  id: pk(),
  email: text().notNull().unique(),
  name: text(),
  // JSON column: a structured value persisted as JSON, typed via json<T>().
  // Same helper works on SQLite and Postgres. Delete if you do not need it.
  settings: json<{ theme?: string }>(),${isFullStack ? `
  // The auth gallery card (app/features/auth) signs credentials against this.
  // gallery:clear removes this column with the rest of the auth surface.
  passwordHash: text(),` : ''}
  createdAt: createdAt(),
});
${isFullStack ? `
// Backs the example-gallery /examples/todo route (modules/todo). Delete it with
// the gallery when you prune the examples you do not use.
export const todos = table('todos', {
  id: uuidPk(),
  title: text().notNull(),
  completed: bool().notNull().default(false),
  createdAt: createdAt(),
});
` : ''}
// Relations live here (one defineRelations for the whole schema). Empty
// for now; add per-model relations as your schema grows.
export const relations = defineRelations({ users${isFullStack ? ', todos' : ''} }, () => ({}));

// Derived types, never hand-written.
export type User = typeof users.$inferSelect;
`);

  const connSqlite = `import { isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.server.ts';

// The only file that opens the driver. Runtime-neutral and ZERO native deps:
// built-in bun:sqlite on Bun, built-in node:sqlite on Node. Cached on
// globalThis across dev reloads.
// A relative SQLite path resolves against the app root (the parent of db/), not
// process.cwd(), so the connection works under \`webjs dev\` AND when the app is
// embedded via createRequestHandler from a different working directory.
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const raw = process.env.DATABASE_URL?.replace(/^file:/, '') ?? 'db/dev.db';
const url = raw === ':memory:' || isAbsolute(raw) ? raw : resolve(appRoot, raw);
const g = globalThis as unknown as { __webjs_db?: unknown };

// Both node:sqlite and bun:sqlite default \`busy_timeout\` to 0, so a concurrent
// writer throws \`database is locked\` immediately. Restore a 5s wait (the old
// better-sqlite3 default) so contended access waits, and WAL so readers proceed
// alongside one writer.
function tune<T extends { exec(sql: string): unknown }>(client: T): T {
  client.exec('PRAGMA busy_timeout = 5000');
  client.exec('PRAGMA journal_mode = WAL');
  return client;
}

async function open() {
  if ((globalThis as { Bun?: unknown }).Bun) {
    // @ts-expect-error bun:sqlite is a Bun builtin with no Node typings
    const { Database } = await import('bun:sqlite');
    const { drizzle } = await import('drizzle-orm/bun-sqlite');
    return drizzle({ client: tune(new Database(url)), relations: schema.relations });
  }
  const { DatabaseSync } = await import('node:sqlite');
  const { drizzle } = await import('drizzle-orm/node-sqlite');
  return drizzle({ client: tune(new DatabaseSync(url)), relations: schema.relations });
}

export const db = (g.__webjs_db ??= await open()) as Awaited<ReturnType<typeof open>>;
`;

  const connPg = `import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.server.ts';

// The only file that opens the driver. Cached on globalThis across dev reloads.
const g = globalThis as unknown as { __webjs_db?: unknown };
function open() {
  return drizzle({ client: new Pool({ connectionString: process.env.DATABASE_URL }), relations: schema.relations });
}
export const db = (g.__webjs_db ??= open()) as ReturnType<typeof open>;
`;

  await writeFile(join(appDir, 'db', 'connection.server.ts'), dialect === 'postgres' ? connPg : connSqlite);

  // drizzle-kit config (root, must be this exact filename). DB url from env.
  await writeFile(join(appDir, 'drizzle.config.ts'), dialect === 'postgres'
    ? `import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.server.ts',
  out: './db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
`
    : `import { defineConfig } from 'drizzle-kit';

// No 'driver' is set: drizzle-kit auto-selects the SQLite driver for
// migrate/push/studio from the runtime, picking the built-in node:sqlite on
// Node and bun:sqlite on Bun (it only reaches for better-sqlite3 when that
// package is present, which this app does not install). That auto-selection is
// what keeps \`webjs db migrate\` free of a native driver, matching the runtime
// connection in db/connection.server.ts.
export default defineConfig({
  dialect: 'sqlite',
  schema: './db/schema.server.ts',
  out: './db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL?.replace(/^file:/, '') ?? 'db/dev.db' },
});
`);

  // Env vars: append DATABASE_URL to the .env.example the template already
  // copied (if present), idempotently. The database segment is the app name
  // normalized to a fold-stable PostgreSQL identifier, so the emitted URL
  // names the same database whether the user runs `createdb` or types
  // `CREATE DATABASE`. Hoisted because the post-scaffold guidance below names
  // the same value, and the two must not be able to drift.
  const dbName = toDatabaseName(name);
  const dbUrlLine = dialect === 'postgres'
    ? 'DATABASE_URL=postgres://user:password@localhost:5432/' + dbName
    : 'DATABASE_URL=file:./db/dev.db';
  const envExample = join(appDir, '.env.example');
  if (existsSync(envExample)) {
    let cur = await readFile(envExample, 'utf8');
    // Replace any existing DATABASE_URL line so it is dialect-correct; else append.
    if (/^DATABASE_URL=.*$/m.test(cur)) {
      cur = cur.replace(/^DATABASE_URL=.*$/m, dbUrlLine);
    } else {
      cur = cur.replace(/\n?$/, '\n') + '\n' + dbUrlLine + '\n';
    }
    await writeFile(envExample, cur);
  } else {
    await writeFile(envExample, dbUrlLine + '\n');
  }

  // .gitignore the generated SQLite file (sqlite only; postgres has no local file).
  if (dialect !== 'postgres') {
    const gitignore = join(appDir, '.gitignore');
    const gitignoreExtra = '\n# SQLite dev database\ndb/dev.db\ndb/dev.db-journal\ndb/dev.db-*\n';
    if (existsSync(gitignore)) {
      const cur = await readFile(gitignore, 'utf8');
      if (!cur.includes('db/dev.db')) await writeFile(gitignore, cur + gitignoreExtra);
    } else {
      // Defense in depth: if the template gitignore is ever absent, still
      // never leave a real `.env` trackable (dogfood #845).
      await writeFile(gitignore, 'node_modules\n.webjs\n.env\n.env.*\n!.env.example\n' + gitignoreExtra);
    }
  }

  // --- App files (template-specific) ---

  if (isApi) {
    // API-only template: no layout, no page, no components.
    // Just a health route and an example module with route wrapper.

    // Root middleware applying CORS to every route. An API consumed by a
    // browser from another origin needs this; the `cors()` primitive
    // handles origin reflection, the OPTIONS preflight, Vary: Origin, and
    // the credentials rule, so route handlers stay focused on data.
    await writeFile(join(appDir, 'middleware.ts'), `import { cors } from '@webjsdev/server';

/**
 * App-wide CORS policy. Replace the allow-list with your real frontend
 * origins. With \`credentials: true\` a wildcard origin is invalid per the
 * CORS spec, so list explicit origins (never \`'*'\` + credentials).
 */
export default cors({
  origin: ['http://localhost:3000', 'https://app.example.com'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['content-type', 'authorization'],
  maxAge: 86400,
});
`);

    await mkdir(join(appDir, 'app', 'api', 'health'), { recursive: true });
    await mkdir(join(appDir, 'app', 'api', 'users'), { recursive: true });
    await writeFile(join(appDir, 'app', 'api', 'health', 'route.ts'), `export async function GET() {
  return Response.json({ status: 'ok', timestamp: Date.now() });
}
`);
    // Root API index. The api template has no UI, so \`/\` is a route handler,
    // not a page: it lists the available endpoints instead of returning a bare
    // 404 (friendlier than an empty root for an API-only app).
    await writeFile(join(appDir, 'app', 'route.ts'), `export async function GET(request: Request) {
  const base = new URL(request.url).origin;
  return Response.json({
    name: '${name}',
    endpoints: {
      health: \`\${base}/api/health\`,
      users: \`\${base}/api/users\`,
    },
    // The backend-features showcase (delete app/api/features + its modules to prune).
    features: {
      validate: \`\${base}/api/features/validate\`,
      'rate-limit': \`\${base}/api/features/rate-limit\`,
      stream: \`\${base}/api/features/stream\`,
      files: \`\${base}/api/features/files\`,
      ws: \`\${base.replace(/^http/, 'ws')}/api/features/ws\`,
    },
  });
}
`);
    await mkdir(join(appDir, 'modules', 'users', 'actions'), { recursive: true });
    await mkdir(join(appDir, 'modules', 'users', 'queries'), { recursive: true });

    await writeFile(join(appDir, 'modules', 'users', 'queries', 'list-users.server.ts'), `'use server';

// A GET server action (#488): a read declares its HTTP semantics via reserved
// sibling exports the framework reads statically. 'method' makes the call ride
// the URL and be ETag/304-aware; 'cache' is what makes the response cacheable at
// all (the max-age in seconds, private by default, do NOT add { public: true }
// unless the data is identical for EVERY visitor); 'tags' label the cached entry so a
// mutation can evict it. All three shape the RPC endpoint a browser import hits,
// so they do nothing for the in-process call in app/api/users/route.ts; they are
// here as the idiom to carry into a client that imports the action. One function
// per file.
export const method = 'GET';
export const cache = 30;
export const tags = () => ['users'];
export async function listUsers() {
  // TODO: replace with real data source
  return [
    { id: '1', name: 'Alice', email: 'alice@example.com' },
    { id: '2', name: 'Bob', email: 'bob@example.com' },
  ];
}
`);
    await writeFile(join(appDir, 'modules', 'users', 'actions', 'create-user.server.ts'), `'use server';

// A mutation server action (#488). With no 'method' export it defaults to POST
// (CSRF-protected, rich request body). 'invalidates' lists the cache tags to
// evict once the action completes without throwing, so a client that read
// listUsers() refetches fresh instead of serving a stale browser-cached value.
// (A returned { success: false } envelope still evicts, since the action ran.)
// It applies on the RPC endpoint a browser import hits. The route.ts in this
// template calls the function directly, which is in-process, so the config
// exports do not fire there. One function per file.
export const invalidates = () => ['users'];
export async function createUser(input: { name: string; email: string }) {
  // TODO: validate input, persist to database
  return { success: true, data: { id: Date.now().toString(), ...input } };
}
`);
    await writeFile(join(appDir, 'app', 'api', 'users', 'route.ts'), `/**
 * /api/users: thin route wrapper over typed server actions.
 * Business logic lives in modules/users/, not here.
 *
 * These calls are in-process, so the actions' config exports do NOT apply here.
 * method / cache / tags / invalidates shape the RPC endpoint a browser import
 * hits, and nothing else applies them, so this endpoint sets its own headers if
 * it wants caching. The namespace form of the route() adapter from
 * \@webjsdev/server (import * as q; export const GET = route(q)) picks up the
 * declared validate and middleware, which are the two an endpoint can reuse.
 */
import { listUsers } from '#modules/users/queries/list-users.server.ts';
import { createUser } from '#modules/users/actions/create-user.server.ts';

export async function GET() {
  return Response.json(await listUsers());
}

export async function POST(req: Request) {
  const body = await req.json();
  return Response.json(await createUser(body));
}
`);
    // Minimal starter test so a freshly scaffolded app ships with a test
    // and `webjs test` runs cleanly. Replace these with real assertions
    // once you wire the action/query to a real data source.
    await writeFile(join(appDir, 'test', 'unit', 'users.test.ts'), `import { test } from 'node:test';
import assert from 'node:assert/strict';

import { listUsers } from '#modules/users/queries/list-users.server.ts';
import { createUser } from '#modules/users/actions/create-user.server.ts';

test('listUsers returns an array', async () => {
  const users = await listUsers();
  assert.ok(Array.isArray(users));
});

test('createUser returns a success envelope with the input echoed back', async () => {
  const result = await createUser({ name: 'Test', email: 'test@example.com' });
  assert.equal(result.success, true);
  assert.equal(result.data.name, 'Test');
  assert.equal(result.data.email, 'test@example.com');
});
`);
    await writeFile(join(appDir, 'modules', 'users', 'types.ts'), `export interface User {
  id: string;
  name: string;
  email: string;
}

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number };
`);

    // The api backend-features showcase: endpoints under app/api/features/**
    // (the route() adapter + validation, rate limiting, streaming, file storage,
    // WebSockets + broadcast) that the root api index above links. The api
    // counterpart of the UI gallery. Prune what you skip.
    const { writeApiGallery } = await import('./api-gallery.js');
    await writeApiGallery(appDir);

    // The showcase-reset script (wired as `gallery:clear` for the api template).
    // It sheds app/api/features + its modules back to the health + users base.
    const apiClearSrc = join(TEMPLATES, 'scripts', 'clear-api-gallery.mjs');
    if (existsSync(apiClearSrc)) {
      await mkdir(join(appDir, 'scripts'), { recursive: true });
      await cp(apiClearSrc, join(appDir, 'scripts', 'clear-api-gallery.mjs'));
    }
  }

  if (!isApi) {
    // The UI template: layout + page + theme toggle + Tailwind

    // The Tailwind stylesheet is compiled from public/input.css (written below)
    // to a STATIC public/tailwind.css by css:build, and lib/utils/ui.ts helpers
    // are copied below, so the app boots with the exact blog example
    // architecture: light DOM + a real Tailwind stylesheet (styled with JS off)
    // + JS helpers.
    const publicDir = join(appDir, 'public');
    await mkdir(publicDir, { recursive: true });
    // Progressive-enhancement service worker (#271): ship the opt-in offline
    // primitive (the worker + its offline fallback) into the UI scaffold
    // (this block is api-excluded since api has no UI).
    // Dormant until the app registers it (see the skill's references/service-worker.md);
    // it never changes the JS-disabled baseline.
    for (const swFile of ['sw.js', 'offline.html']) {
      const swSrc = join(TEMPLATES, 'public', swFile);
      if (existsSync(swSrc)) await cp(swSrc, join(publicDir, swFile));
    }
    // A base SVG favicon (the root layout links it). It ships with the app, not
    // the gallery, so it survives `npm run gallery:clear`.
    const faviconSrc = join(TEMPLATES, 'public', 'favicon.svg');
    if (existsSync(faviconSrc)) await cp(faviconSrc, join(publicDir, 'favicon.svg'));

    // The gallery-reset script (wired as `gallery:clear`). Only UI templates have
    // a gallery, so it ships here (NOT in the flat templateFiles list, which would
    // copy it into the api app where it has no gallery and would clobber app/).
    const clearScriptSrc = join(TEMPLATES, 'scripts', 'clear-gallery.mjs');
    if (existsSync(clearScriptSrc)) {
      await mkdir(join(appDir, 'scripts'), { recursive: true });
      await cp(clearScriptSrc, join(appDir, 'scripts', 'clear-gallery.mjs'));
    }

    // Fail loudly if the @webjsdev/ui registry sources aren't on disk.
    // Without this, downstream copy helpers would silently skip and the
    // generated app would boot to ERR_MODULE_NOT_FOUND on the first page
    // render (the import in app/page.ts below points at a file we didn't
    // write).
    assertUiRegistryAvailable();

    // Pre-initialise @webjsdev/ui so the scaffold boots ready for
    // `webjs ui add <name>`: writes components.json + lib/utils/cn.ts +
    // styles/globals.css (the @webjsdev/ui theme).
    await writeUiBootstrap(appDir);

    // The gallery cards style with plain Tailwind (the app is pre-initialised for
    // `webjs ui add <name>` via writeUiBootstrap above, but ships no components
    // until you add them on demand).

    // The @webjsdev/ui theme (`--color-primary`, `--color-card`, the @theme maps,
    // @custom-variant, @keyframes) plus the app @theme mappings are compiled from
    // public/input.css into the STATIC public/tailwind.css that app/layout.ts
    // links, so the app is fully styled with JavaScript disabled. Write input.css:
    // `@import "tailwindcss"`, source globs, the ui theme (read from the registry
    // themes/index.css), then the app @theme inline block. The token VALUES live
    // on :root in app/layout.ts (plain CSS, so they resolve with JS off) and the
    // @theme inline maps here reference them by var(), the same split the blog
    // uses. Same theme also lives at styles/globals.css for `webjsui` tooling.
    const uiThemeRaw = await readThemeCss();
    await writeFile(join(publicDir, 'input.css'), `@import "tailwindcss";

/* Scan app sources so their utility classes make it into the compiled bundle.
   Tailwind v4 auto-scans the project too; these @source lines are explicit. */
@source "../app/**/*.{ts,js}";
@source "../components/**/*.{ts,js}";
@source "../modules/**/*.{ts,js}";
@source "../lib/**/*.{ts,js}";

${uiThemeRaw}

/* App @theme mappings. The token VALUES live on :root in app/layout.ts (plain
   CSS custom properties, so they resolve with JavaScript disabled); these
   @theme inline maps turn them into utilities (bg-primary, text-display, ...). */
@theme inline {
  --color-border-strong: var(--border-strong);
  --color-primary-tint: var(--primary-tint);
  --font-sans:  var(--font-sans);
  --font-serif: var(--font-serif);
  --font-mono:  var(--font-mono);
  --text-display: clamp(2.6rem, 1.6rem + 3.2vw, 4.25rem);
  --text-h1:      clamp(2rem, 1.5rem + 1.6vw, 2.85rem);
  --text-h2:      clamp(1.35rem, 1.15rem + 0.7vw, 1.7rem);
  --text-lede:    clamp(1.05rem, 0.95rem + 0.3vw, 1.2rem);
  --duration-fast: 140ms;
  --duration-slow: 380ms;
}
`);

    // The gallery: idiomatic, densely-commented single-feature demos under
    // app/features/ plus one whole example app under app/examples/, with logic
    // in modules/, all linked from the home page below. Shipped in the UI
    // scaffold so an agent gains context by browsing real working code; prune
    // per-feature (delete the route + its module) for what the app does not use,
    // or shed the whole gallery at once with `gallery:clear`.
    await copyGallery(appDir);

  await writeFile(join(appDir, 'app', 'layout.ts'), `import { html, cspNonce, asset } from '@webjsdev/core';
import type { LayoutProps } from '@webjsdev/core';
import '#components/theme-toggle.ts';

/**
 * Root layout: the ONLY file that writes the document shell. It wires a neutral
 * design-token palette, the light/dark theme, and the Tailwind stylesheet, then
 * renders \${children} in a bare container. Grow it in place: add a header, nav,
 * footer, or reading column here as your app needs them. Design tokens live as
 * plain CSS custom properties (they resolve with JavaScript disabled) and are
 * mapped into Tailwind via @theme in public/input.css, so bg-background,
 * text-foreground, bg-card, bg-primary, and border-border all work.
 */

// Declare the favicon via metadata.icons (NOT a hand-written <link> in the
// template): the framework emits metadata links into <head>, whereas a <link>
// written in the layout body stays in <body>, where browsers ignore it. The SVG
// lives at public/favicon.svg and serves at /public/favicon.svg.
export const metadata = { icons: '/public/favicon.svg' };

// LayoutProps types every layout argument (children, params, searchParams,
// url) from the framework, so children is a TemplateResult rather than an
// untyped value. Derive types like this everywhere instead of widening to
// unknown; see .agents/skills/webjs/references/typescript.md.
export default function RootLayout({ children }: LayoutProps) {
  // Read the in-flight request's CSP nonce so the theme-detection inline script
  // passes strict CSP. Returns '' when no CSP nonce is set.
  const nonce = cspNonce();
  return html\`
    <script nonce="\${nonce}">
      // Light/dark theme: apply the saved choice before paint (no flash). The
      // tokens follow color-scheme, which [data-theme] forces and otherwise
      // follows the OS, so an unset choice needs NO inline work here. The .dark
      // class is synced only for @webjsdev/ui components (they key off .dark).
      // Delete this block and the [data-theme] rules below for a single-theme app.
      (function(){
        try {
          var mq = window.matchMedia('(prefers-color-scheme: dark)');
          function apply(){
            var t = null;
            try { t = localStorage.getItem('webjs_theme'); } catch (_) {}
            var el = document.documentElement;
            if (t === 'light' || t === 'dark') el.dataset.theme = t;
            else delete el.dataset.theme;
            el.classList.toggle('dark', t === 'dark' || (t !== 'light' && mq.matches));
          }
          apply();
          mq.addEventListener('change', apply);
        } catch (_) {}
      })();
      // Header-measure: dormant until you add a fixed header. A fixed header
      // (use position:fixed, NOT sticky, which flickers on iOS WebKit during a
      // client-router nav) leaves normal flow, so --header-h reserves its height
      // for the content below. No header means a no-op and --header-h stays 0.
      (function(){
        function measure(){
          try {
            var hdr = document.querySelector('header');
            // Only a FIXED header leaves normal flow and needs its height
            // reserved; a normal in-flow header (the gallery's navbar) does not.
            if (!hdr || getComputedStyle(hdr).position !== 'fixed') return;
            var apply = function(){
              document.documentElement.style.setProperty('--header-h', hdr.offsetHeight + 'px');
            };
            apply();
            if (window.ResizeObserver) new ResizeObserver(apply).observe(hdr);
          } catch (_) {}
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', measure);
        else measure();
      })();
    </script>
    <meta name="color-scheme" content="light dark">
    <!-- JetBrains Mono for body/UI (its monospaced, developer-console feel) and
         Bricolage Grotesque for the display wordmark. Swap these for your own
         fonts (and update --font-sans / --font-display below). -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=JetBrains+Mono:wght@400;500;700&display=swap">
    <!-- Tailwind: a STATIC stylesheet compiled from public/input.css to
         public/tailwind.css by css:build (run automatically by the dev and start
         tasks; in dev it is also recompiled on request when a source changes, so
         it never goes stale). A real stylesheet, so the app is fully styled with
         JavaScript DISABLED (no in-browser compile).

         asset() adds a content hash in production (/public/tailwind.css?v=...)
         and the framework then serves it immutable for a year, so a deploy that
         changes the CSS changes the url and no browser or CDN can serve the old
         bytes. Mark the thing that FETCHES: do not wrap a <link rel="preload">
         whose asset is really fetched by an @font-face url() in the CSS, or the
         preload can never match the request and the file downloads twice. -->

    <link rel="stylesheet" href=\${asset('/public/tailwind.css')}>
    <style>
      /* Design tokens: ONE definition per colour via light-dark(LIGHT, DARK), so
         a palette change lands in a single place (DRY). The token NAMES are
         infrastructure (public/input.css maps them into Tailwind via @theme); the
         VALUES are a cool neutral-grey palette with a monospaced type system.
         color-scheme decides which side of each light-dark() applies: the default
         'light dark' follows the OS, and the toggle FORCES one via [data-theme]
         below. The light theme is a crisp WHITE page with near-black text, a
         readable muted grey, and visible borders (a washed-out light theme comes
         from a grey page + too-light muted text + faint borders). For a
         single-theme app, delete the [data-theme] rules and give each token a
         single colour instead of light-dark().
         EDGE CASES: light-dark() is COLOUR-only. A colour needed in just one
         theme sets the unused side to a no-op, e.g. light-dark(#fff, transparent).
         A DERIVED token that references a light-dark() one (like --primary-tint
         below) tracks both themes for free. A NON-colour token that must differ
         per theme (a shadow's geometry, a gradient, a size, an image) cannot use
         light-dark(); give it a :root[data-theme='dark'] override plus an
         @media (prefers-color-scheme: dark) { :root:not([data-theme]) { ... } }
         rule for the OS default. */
      :root {
        --font-sans:  'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        --font-serif: ui-serif, 'Iowan Old Style', Palatino, Georgia, serif;
        --font-mono:  'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        --font-display: 'Bricolage Grotesque', 'JetBrains Mono', ui-sans-serif, system-ui, sans-serif;
        --header-h: 0px;

        color-scheme: light dark;                              /* default: follow the OS */
        --background:         light-dark(#ffffff, #1e2226);
        --foreground:         light-dark(#191c20, #dee2e6);
        --card:               light-dark(#f7f8fa, #313539);
        --card-foreground:    light-dark(#191c20, #dee2e6);
        --popover:            light-dark(#ffffff, #313539);
        --popover-foreground: light-dark(#191c20, #dee2e6);
        --primary:            light-dark(#1e2226, #dee2e6);
        --primary-foreground: light-dark(#ffffff, #1e2226);
        --secondary:          light-dark(#eef0f2, #363a3e);
        --secondary-foreground: light-dark(#191c20, #dee2e6);
        --muted:              light-dark(#eef0f2, #313539);
        --muted-foreground:   light-dark(#565c64, #94989c);
        --accent:             light-dark(#e9ebef, #363a3e);
        --accent-foreground:  light-dark(#191c20, #f7fbff);
        --border:             light-dark(#e2e5e9, #3d434b);
        --border-strong:      light-dark(#ccd1d7, #454b51);
        --input:              light-dark(#e2e5e9, #34393e);
        --ring:               light-dark(#8b9198, #6b7075);
        /* A translucent tint of the primary, tracked automatically across
           light/dark. Used for focus rings (ring-primary-tint). */
        --primary-tint: color-mix(in srgb, var(--primary) 22%, transparent);
      }
      /* The toggle writes data-theme to FORCE a scheme; with neither attribute
         the default 'color-scheme: light dark' above follows the OS. */
      :root[data-theme='light'] { color-scheme: light; }
      :root[data-theme='dark']  { color-scheme: dark; }
    </style>
    <style>
      /* Base styles utility classes can't reach. */
      html, body { margin: 0; }
      body {
        padding-top: var(--header-h);
        background: var(--background);
        color: var(--foreground);
        font: 15px/1.6 var(--font-sans);
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
    </style>
    <!-- Top navbar, on every page: brand on the left, links + theme toggle on
         the right. It floats (no separator) and is in normal flow, so it just
         scrolls with the page; make it a fixed header only if you want it pinned
         (position: fixed, never sticky, which flickers on iOS during a nav). -->
    <header class="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
      <a href="/" class="inline-flex items-center gap-2 no-underline text-foreground font-bold tracking-tight" style="font-family: var(--font-display)">
        <span class="w-[22px] h-[22px] rounded-[7px] bg-gradient-to-br from-foreground to-muted-foreground" aria-hidden="true"></span>
        WebJs Gallery
      </a>
      <nav class="flex items-center gap-4 text-sm" aria-label="Primary">
        <a href="https://webjs.dev/docs" target="_blank" rel="noopener" class="hidden sm:inline text-muted-foreground hover:text-foreground no-underline transition-colors">Docs</a>
        <a href="https://github.com/webjsdev/webjs" target="_blank" rel="noopener" class="hidden sm:inline text-muted-foreground hover:text-foreground no-underline transition-colors">GitHub</a>
        <theme-toggle></theme-toggle>
      </nav>
    </header>
    <!-- Fill the viewport minus the h-14 (3.5rem) navbar, so a short page has no
         spurious scrollbar (min-h-dvh alone would overflow by the navbar height). -->
    <main class="min-h-[calc(100dvh-3.5rem)] max-w-5xl mx-auto px-4 sm:px-6 py-8">
      \${children}
    </main>
  \`;
}
`);

  // Home page: a gallery index. A masthead, then a grid that links every feature
  // demo and the example app, and a footer with the docs + source links. Treat it
  // as a starting point: prune the demos you do not use (delete the
  // app/features/<x> route AND its modules/<x>), then reshape this page into the
  // app's real landing page.
  await writeFile(join(appDir, 'app', 'page.ts'), `import { html } from '@webjsdev/core';
import { cardClass } from '#components/ui/card.ts';
import { badgeClass } from '#components/ui/badge.ts';
// The demo index is defined once in modules/gallery/nav.ts (the same source the
// left sidebar reads), so the home cards and the sidebar can never drift.
import { featureList, EXAMPLES } from '#modules/gallery/nav.ts';

export const metadata = {
  title: '${displayName}',
};

export default function Home() {
  // Flattened HERE rather than at module scope. A top-level call is a module
  // side effect, which would ship this page to the browser for nothing.
  const FEATURES = featureList();
  return html\`
    <div class="py-8 flex flex-col items-center gap-16">
      <!-- Hero -->
      <section class="flex flex-col items-center text-center gap-5">
        <h1 class="text-5xl sm:text-6xl font-bold tracking-tight leading-none m-0 break-words bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-transparent" style="font-family: var(--font-display); letter-spacing: -0.02em;">
          Explore the gallery
        </h1>
        <p class="text-base sm:text-lg text-muted-foreground max-w-lg leading-relaxed m-0">
          Each demo isolates a single WebJs capability in real, runnable code. Read the ones you need, then build your app on the same patterns.
        </p>
      </section>

      <!-- Gallery: every feature demo + the example app -->
      <section class="w-full flex flex-col gap-6">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          \${FEATURES.map(f => html\`
            <a href="\${f.href}" class=\${cardClass('group flex flex-col gap-1.5 rounded-xl p-4 no-underline transition-colors hover:border-border-strong hover:bg-accent')}>
              <span class="flex items-center justify-between gap-2">
                <span class="text-sm font-medium text-foreground">\${f.title}</span>
                <span class="text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true">&rarr;</span>
              </span>
              <span class="text-xs leading-relaxed text-muted-foreground">\${f.blurb}</span>
            </a>
          \`)}
        </div>
        \${EXAMPLES.map(e => html\`
          <a href="\${e.href}" class=\${cardClass('group flex flex-col gap-2 rounded-xl p-5 no-underline transition-colors hover:border-border-strong hover:bg-accent')}>
            <span class="flex items-center gap-2.5">
              <span class=\${badgeClass({ variant: 'outline' })}>Example app</span>
              <span class="text-sm font-medium text-foreground">\${e.title}</span>
              <span class="ml-auto text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true">&rarr;</span>
            </span>
            <span class="text-xs leading-relaxed text-muted-foreground">\${e.blurb}</span>
          </a>
        \`)}
      </section>

      <!-- Footer: docs + source -->
      <footer class="flex flex-col items-center gap-3">
        <nav class="flex items-center gap-6 text-sm text-muted-foreground" aria-label="WebJs links">
          <a href="https://webjs.dev/docs" target="_blank" rel="noopener" class="inline-flex items-center gap-2 hover:text-foreground transition-colors no-underline">\${iconBook()}<span>Docs</span></a>
          <a href="https://github.com/webjsdev/webjs" target="_blank" rel="noopener" class="inline-flex items-center gap-2 hover:text-foreground transition-colors no-underline">\${iconGithub()}<span>GitHub</span></a>
        </nav>
        <p class="text-[0.7rem] uppercase tracking-[0.15em] text-muted-foreground m-0 text-center">
          Built with WebJs &middot; MIT License
        </p>
      </footer>
    </div>
  \`;
}

function iconBook() {
  return html\`<svg class="w-4 h-4 stroke-current fill-none" style="stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/></svg>\`;
}
function iconGithub() {
  return html\`<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>\`;
}
`);

  // AGENTS.md is copied via the `templateFiles` loop above, from
  // `packages/cli/templates/AGENTS.md` with `{{APP_NAME}}` substitution.

  // --- Theme toggle component ---

  await writeFile(join(appDir, 'components', 'theme-toggle.ts'), `import { WebComponent, html, signal } from '@webjsdev/core';
import { cn } from '#lib/utils/cn.ts';
import { buttonClass } from '#components/ui/button.ts';

type Theme = 'system' | 'light' | 'dark';

/**
 * <theme-toggle> is a light-DOM component styled with Tailwind utilities.
 *
 * Light DOM is the default: no static shadow = true, no static styles.
 * Because this component has no custom CSS (only Tailwind classes,
 * which are already unique by construction), the class-prefix rule
 * doesn't apply here. If you ever add a <style> block, prefix every
 * selector with 'theme-toggle' (e.g. .theme-toggle__btn or
 * \`theme-toggle .btn\`).
 */
export class ThemeToggle extends WebComponent {
  theme = signal<Theme>('system');

  connectedCallback() {
    super.connectedCallback();
    let saved: string | null = null;
    try { saved = localStorage.getItem('webjs_theme'); } catch {}
    this.theme.set(saved === 'light' || saved === 'dark' ? saved : 'system');
  }

  cycle() {
    const t = this.theme.get();
    const next: Theme = t === 'system' ? 'light'
      : t === 'light' ? 'dark' : 'system';
    this.theme.set(next);
    try {
      if (next === 'system') localStorage.removeItem('webjs_theme');
      else localStorage.setItem('webjs_theme', next);
    } catch {}
    const el = document.documentElement;
    if (next === 'system') delete el.dataset.theme;
    else el.dataset.theme = next;
    // Our own tokens follow color-scheme via data-theme (set above). Keep the
    // .dark class in sync only for @webjsdev/ui components, which key off it.
    const dark = next === 'dark'
      || (next === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    el.classList.toggle('dark', dark);
  }

  render() {
    const t = this.theme.get();
    const label = t === 'system' ? 'AUTO' : t === 'light' ? 'LIGHT' : 'DARK';
    const icon = t === 'light' ? ICONS.sun : t === 'dark' ? ICONS.moon : ICONS.system;
    return html\`
      <button
        class=\${cn(buttonClass({ variant: 'secondary', size: 'none' }), 'w-9 h-9 rounded-full text-muted-foreground duration-150 hover:text-foreground active:scale-[0.94]')}
        @click=\${() => this.cycle()}
        aria-label="Cycle theme (currently \${label})"
        title="Theme: \${label.toLowerCase()}"
      >\${icon}</button>
    \`;
  }
}

const ICONS = {
  sun: html\`<svg class="w-4 h-4 stroke-current fill-none" style="stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M3 12h2M19 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>\`,
  moon: html\`<svg class="w-4 h-4 stroke-current fill-none" style="stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>\`,
  system: html\`<svg class="w-4 h-4 stroke-current fill-none" style="stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><path d="M3 5h18v11H3zM8 20h8M12 16v4"/></svg>\`,
};

ThemeToggle.register('theme-toggle');
`);
  } // end if (!isApi)

  // AGENTS.md is already in place via the shared `templateFiles` loop
  // earlier in this function, so no framework-root fallback needed.

  // --- Git init + configure hooks directory ---
  const { execSync } = await import('node:child_process');
  try {
    execSync('git init', { cwd: appDir, stdio: 'pipe' });
    // Use the tracked .hooks/ dir (the pre-commit blocks commits to main).
    execSync('git config core.hooksPath .hooks', { cwd: appDir, stdio: 'pipe' });
  } catch { /* git not available: skip */ }

  // --- Print success ---

  const guide = 'AGENTS.md, .agents/skills/webjs/   ← the agent guide';
  if (isApi) {
    console.log(`  ${name}/
    app/api/{health,users}/route.ts
    modules/users/{actions,queries,types.ts}   ← routes over server actions
    db/{schema,columns,connection}.server.ts   ← Drizzle (User model)
    ${guide}
`);
  } else {
    console.log(`  ${name}/
    app/{layout,page}.ts          ← gallery home; gallery:clear grows in place
    app/features/*, modules/*     ← browsable demos (incl. auth: login + protected route)
    components/theme-toggle.ts
    public/input.css              ← Tailwind entry (compiles to public/tailwind.css)
    db/{schema,columns,connection}.server.ts  ← Drizzle
    ${guide}
`);
  }
  console.log(`For AI agents, read this before editing:
  • Read AGENTS.md, then .agents/skills/webjs/SKILL.md. The skill is the guide
    to building a WebJs app and routes to focused references on demand.
  • This scaffold is a minimal starting point, not a demo to prune. Grow the app
    in place: add routes under app/, components under components/, and features
    under modules/<feature>/, and keep server-only code behind .server.ts.
  • Use the wired-up database (Drizzle): define real models in
    db/schema.server.ts, then run 'npm run db:generate' and 'npm run db:migrate'.
    Never store app data in JSON files, in-memory arrays, or localStorage.
  • Full hosted docs are at https://webjs.dev/docs.
`);

  // Auto-install (default). Detect the package manager from the env so
  // pnpm / yarn / bun users get their own. Pass `--no-install` (or
  // `{ install: false }` to scaffoldApp) to opt out, e.g. for CI tests
  // that exercise the scaffold without paying the install cost.
  // In bun mode, install with bun regardless of the invoking PM, so the app
  // commits `bun.lock` (text JSONC, git-diffable) instead of `package-lock.json`
  // (#541). Otherwise honour the invoking PM (npm / pnpm / yarn / bun).
  const pm = isBun ? 'bun' : detectPackageManager();
  let installed = false;
  let generatedMigration = false;
  if (shouldInstall) {
    console.log(`Running '${pm} install' in ${name}/ ...\n`);
    installed = runInstall(appDir, pm);
    if (!installed) {
      console.log(`\n[warn] ${pm} install failed. Run '${pm} install' manually in ${name}/ to finish setup.\n`);
    } else {
      // Author the initial migration NOW (drizzle-kit is installed), so the
      // shipped schema's tables exist and the very first `run dev` works with no
      // manual step (webjs.*.before applies the migration on boot). See runDbGenerate.
      console.log(`Authoring the initial database migration ('${pm} run db:generate') ...\n`);
      generatedMigration = runDbGenerate(appDir, pm);
      if (!generatedMigration) {
        console.log(`\n[warn] '${pm} run db:generate' failed. Run it manually in ${name}/ before '${pm} run dev'.\n`);
      }
    }
  }

  // Next-steps banner prints LAST so the actionable command is the
  // final thing on screen, never buried above the AI-agent guidance.
  // Single copy-paste line so the user can move from "scaffold done"
  // to "dev server up" in one command. The full-stack template ships
  // with @webjsdev/ui already initialised; the api template has no UI
  // but may add one later.
  const installSegment = installed ? '' : `${pm} install && `;
  // The shipped schema is applied on the first `run dev` (webjs.*.before runs
  // `db migrate`), but only if a migration FILE exists. When we installed, we
  // already authored it above (runDbGenerate), so the run command is just
  // `run dev`. Otherwise (--no-install, or generate failed) the user authors it
  // first: `db:generate` writes the migration from db/schema.server.ts, then
  // `run dev` applies it (Drizzle splits Prisma's `migrate dev` into
  // generate-then-migrate).
  const dbSegment = generatedMigration ? '' : `${pm} run db:generate && `;
  const runCommand = `cd ${name} && ${installSegment}${dbSegment}${pm} run dev`;
  // Postgres needs a reachable DATABASE_URL before any migrate (sqlite uses a
  // local file with no .env). Point it at a running database; `dev` / `start`
  // then apply pending migrations via webjs.*.before.
  const pgNote = dialect === 'postgres'
    ? `\nPostgres: copy .env.example to .env and set DATABASE_URL to a running database before \`${pm} run dev\`.\nThe example URL names the database \`${dbName}\`. Create that database or edit the URL.\n`
    : '';
  // Use `npx webjsdev ui ...` here, not `npx webjs ui ...`. The bare
  // `webjs` npm name is owned by an unrelated package; `npx webjs
  // <cmd>` would fetch THAT package instead of ours when run outside
  // a project context. `webjsdev` is our unscoped CLI alias; npx's
  // single-bin fallback resolves it to the `webjs` binary, so behaviour
  // matches `@webjsdev/cli` exactly while keeping the command short
  // and unambiguous.
  const uiNote = isApi
    ? `# If you later add a UI to this API project:
  #   npx webjsdev ui init && npx webjsdev ui add button card dialog`
    : `npx webjsdev ui add <name>     # add more ui-* components later`;
  console.log(`
Next steps:
  ${runCommand}
  # → http://localhost:8080
${pgNote}
Optional:
  ${uiNote}
`);
}
