/**
 * Verifies that the full-stack scaffold pre-initialises the Webjs UI kit
 * correctly: components.json + lib/utils/cn.ts + styles/globals.css are written
 * so the app is ready for `webjs ui add`, but no component kit is pre-copied
 * (components are added on demand). The API template deliberately ships none of
 * that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scaffoldApp } from '../../packages/cli/lib/create.js';
import { DEFAULT_ALIASES, DEFAULT_TAILWIND_CSS } from '../../packages/ui/src/commands/init.js';
import { add } from '../../packages/ui/src/commands/add.js';
import { analyzeAppElision } from '../../packages/server/src/elision-report.js';

async function tempCwd() {
  return mkdtemp(join(tmpdir(), 'webjs-scaffold-ui-'));
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

test('full-stack scaffold pre-initialises the Webjs UI kit', async () => {
  const cwd = await tempCwd();
  try {
    await scaffoldApp('demo', cwd, { template: 'full-stack' });
    const appDir = join(cwd, 'demo');

    // Bootstrap for `webjs ui add`: the config + cn() helper + theme ship, so an
    // app can add more components on demand. The gallery ALSO ships its example
    // design system (components/ui/ class helpers + lib/utils/ui.ts fragment
    // helpers) that the demos use; gallery:clear removes those examples.
    assert.ok(await exists(join(appDir, 'components.json')), 'components.json should exist');
    assert.ok(await exists(join(appDir, 'lib', 'utils', 'cn.ts')), 'lib/utils/cn.ts should exist');
    assert.ok(await exists(join(appDir, 'styles', 'globals.css')), 'styles/globals.css should exist');
    assert.equal(existsSync(join(appDir, 'app', 'globals.css')), false, 'globals.css must not be in routing-only app/');
    assert.ok(await exists(join(appDir, 'components', 'ui', 'button.ts')), 'the gallery ships the design system (components/ui)');
    assert.ok(await exists(join(appDir, 'components', 'ui', 'badge.ts')), 'the gallery ships badgeClass');
    assert.ok(await exists(join(appDir, 'lib', 'utils', 'ui.ts')), 'the gallery ships the ui.ts fragment helpers');

    // The scaffold and `webjsui init` must emit the SAME components.json, so
    // that initialising a bare app and scaffolding a new one land on one
    // layout. Asserted against the ui package's own constants rather than a
    // copied literal, because these two generators silently disagreed on the
    // `utils` alias until #1129 while a comment on each claimed they matched.
    const cfg = JSON.parse(await readFile(join(appDir, 'components.json'), 'utf8'));
    assert.equal(cfg.tailwind.css, DEFAULT_TAILWIND_CSS);
    assert.equal(cfg.tailwind.baseColor, 'neutral');
    assert.deepEqual(cfg.aliases, DEFAULT_ALIASES);

    // The gallery home builds its feature/example cards on the design system.
    const layout = await readFile(join(appDir, 'app', 'layout.ts'), 'utf8');
    const page = await readFile(join(appDir, 'app', 'page.ts'), 'utf8');
    assert.match(page, /Explore the gallery/, 'home is the gallery index page');
    assert.match(page, /cardClass|badgeClass/, 'the home cards use the design-system helpers');

    // CSS delivery (#947): the layout links a STATIC compiled stylesheet (works
    // with JS off), not the browser runtime. The Tailwind @theme maps live in
    // public/input.css; the token VALUES stay inline in the layout (plain CSS).
    // The href goes through asset() (#1194), so the compiled stylesheet carries
    // a content hash in production and is served immutable: a deploy that
    // changes the CSS changes the url, and no browser or CDN can serve the old
    // bytes at the stable path. Still a plain static stylesheet, JS-off safe.
    assert.match(layout, /<link rel="stylesheet" href=\$\{asset\('\/public\/tailwind\.css'\)\}>/,
      'layout links the static compiled stylesheet through asset()');
    assert.match(layout, /import \{[^}]*\basset\b[^}]*\} from '@webjsdev\/core'/,
      'and imports asset from core');
    assert.doesNotMatch(layout, /tailwind-browser\.js|type="text\/tailwindcss"/,
      'layout no longer ships the Tailwind browser runtime');
    const inputCss = await readFile(join(appDir, 'public', 'input.css'), 'utf8');
    assert.match(inputCss, /@import "tailwindcss"/, 'input.css imports Tailwind');
    assert.match(inputCss, /color-primary/, 'input.css carries the @theme color maps');
    assert.match(layout, /--primary:\s*light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)/i, 'the palette VALUES stay inline via light-dark() (JS-off safe)');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('api scaffold deliberately ships no ui-* components', async () => {
  const cwd = await tempCwd();
  try {
    await scaffoldApp('demo', cwd, { template: 'api' });
    const appDir = join(cwd, 'demo');

    // API has no UI: none of these should exist
    assert.equal(existsSync(join(appDir, 'components', 'ui')), false);
    assert.equal(existsSync(join(appDir, 'components.json')), false);
    assert.equal(existsSync(join(appDir, 'app', 'globals.css')), false);
    assert.equal(existsSync(join(appDir, 'styles', 'globals.css')), false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('api scaffold route imports resolve to real modules/ files', async () => {
  // The route imports modules via the #modules alias (#555/#556), which
  // eliminates the relative `../`-depth off-by-one this test originally
  // guarded: `#modules/<feature>/...` is depth-independent.
  const cwd = await tempCwd();
  try {
    await scaffoldApp('demo', cwd, { template: 'api' });
    const appDir = join(cwd, 'demo');

    const route = await readFile(join(appDir, 'app', 'api', 'users', 'route.ts'), 'utf8');
    // Must NOT contain any relative `../` path to modules (the alias replaces it).
    assert.doesNotMatch(
      route,
      /from '(\.\.\/)+modules\//,
      'route.ts should reach modules/ via the #modules alias, not a relative ../ path',
    );
    // Must use the #modules alias.
    assert.match(route, /from '#modules\/users\/queries\/list-users\.server\.ts'/);
    assert.match(route, /from '#modules\/users\/actions\/create-user\.server\.ts'/);

    // The imported module files must actually exist on disk.
    assert.ok(
      await exists(join(appDir, 'modules', 'users', 'queries', 'list-users.server.ts')),
      'modules/users/queries/list-users.server.ts should exist',
    );
    assert.ok(
      await exists(join(appDir, 'modules', 'users', 'actions', 'create-user.server.ts')),
      'modules/users/actions/create-user.server.ts should exist',
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('lib/utils/cn.ts ships the pure cn() helper; onBeforeCache is in lib/utils/dom.ts (#819)', async () => {
  const cwd = await tempCwd();
  try {
    await scaffoldApp('demo', cwd, { template: 'full-stack' });
    const utils = await readFile(join(cwd, 'demo', 'lib', 'utils', 'cn.ts'), 'utf8');
    assert.match(utils, /export function cn/);
    assert.match(utils, /ClassValue/);
    // #819: the HTMLElement-era Base + defineElement were removed (the ui
    // components extend WebComponent now), so cn.ts stays pure and importing it
    // does not pin a page. onBeforeCache moved to its own client module.
    assert.ok(!/export\s+(?:class|const)\s+Base\b/.test(utils), 'Base removed from cn.ts');
    assert.ok(!/export\s+function\s+defineElement\b/.test(utils), 'defineElement removed from cn.ts');
    const dom = await readFile(join(cwd, 'demo', 'lib', 'utils', 'dom.ts'), 'utf8');
    assert.match(dom, /export function onBeforeCache\b/, 'onBeforeCache is shipped in lib/utils/dom.ts');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('kit helpers do not pin a page to the browser (#1320)', async () => {
  // The end-to-end property #1320 is about: a page whose only client-facing
  // imports are Tier-1 class helpers must still be elided. Both defects that
  // broke it were module-scope work (`...borderGroups()` in cn.ts, a stylesheet
  // injection in native-select.ts), and either one made this page ship whole.
  //
  // Asserted on the elision REPORT rather than on byte size: size moves with
  // every unrelated kit change, so it would be a maintenance tax carrying no
  // extra signal.
  const cwd = await tempCwd();
  try {
    await scaffoldApp('demo', cwd, { template: 'full-stack' });
    const appDir = join(cwd, 'demo');

    // Local-first registry resolution, so no network. `--no-deps` skips the npm
    // install the app does not need to be analysed.
    await add.parseAsync(
      ['button', 'card', 'input', 'native-select', '--cwd', appDir, '--overwrite', '--yes', '--no-deps'],
      { from: 'user' },
    );

    await mkdir(join(appDir, 'app', 'kit'), { recursive: true });
    await writeFile(join(appDir, 'app', 'kit', 'page.ts'), [
      `import { html } from '@webjsdev/core';`,
      `import { buttonClass } from '#components/ui/button.ts';`,
      `import { cardClass } from '#components/ui/card.ts';`,
      `import { inputClass } from '#components/ui/input.ts';`,
      `import { nativeSelectClass, nativeSelectWrapperClass } from '#components/ui/native-select.ts';`,
      ``,
      `export default function Kit() {`,
      `  return html\`<div class=\${cardClass()}>`,
      `    <input class=\${inputClass()} name="q">`,
      `    <div class=\${nativeSelectWrapperClass()}>`,
      `      <select class=\${nativeSelectClass()} name="plan"><option value="a">A</option></select>`,
      `    </div>`,
      `    <button class=\${buttonClass()}>Go</button>`,
      `  </div>\`;`,
      `}`,
    ].join('\n'));

    const report = await analyzeAppElision(appDir);
    assert.ok(report.analysed, `elision analysis ran (skipped: ${report.skipped})`);

    const kit = report.routeModules.find((r) => r.file === join('app', 'kit', 'page.ts'));
    assert.ok(kit, 'the kit page has a verdict');
    // It imports only Tier-1 helpers, which register no element, so there is
    // nothing for it to carry into the browser.
    assert.equal(kit.verdict, 'inert', `kit page ships, blocked by ${kit.blocker}`);

    // And no OTHER route module is pinned by the two modules this fixed, which
    // is the assertion that fails if either regression comes back anywhere in
    // the scaffold.
    const pinned = report.routeModules.filter(
      (r) => r.verdict === 'shipped'
        && (r.blocker?.endsWith(join('lib', 'utils', 'cn.ts'))
          || r.blocker?.endsWith(join('components', 'ui', 'native-select.ts'))),
    );
    assert.deepEqual(pinned, [], 'no route module is pinned by cn.ts or native-select.ts');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
