import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { init } from '../src/commands/init.js';
import { getConfig } from '../src/utils/get-config.js';

const origFetch = globalThis.fetch;

function stubFetch() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/lib-utils.json')) {
      return new Response(JSON.stringify({
        name: 'lib-utils', type: 'registry:lib',
        files: [{ path: 'lib/utils.ts', type: 'registry:lib', content: 'export function cn(){}\n' }],
      }), { status: 200 });
    }
    if (u.endsWith('/lib-dom.json')) {
      return new Response(JSON.stringify({
        name: 'lib-dom', type: 'registry:lib',
        files: [{ path: 'lib/dom.ts', type: 'registry:lib', content: 'export function onBeforeCache(){ return () => {}; }\n' }],
      }), { status: 200 });
    }
    if (u.includes('/theme-')) {
      return new Response(JSON.stringify({
        name: 'theme-neutral', type: 'registry:theme',
        files: [{ path: 'themes/index.css', type: 'registry:file', target: 'app/globals.css', content: '/* @webjsdev/ui theme */\n:root { --primary: #000; }\n' }],
      }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
}

function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'webjsui-init-'));
  writeFileSync(join(d, 'package.json'), JSON.stringify({ dependencies: {} }));
  return d;
}

// #1129: the defaults used to be computed by a `defaultsForProject()` switch on
// a detected project type. They are plain constants now, so this test is what
// stands between a stray edit and a silently different components.json. It
// pins EVERY field, not a sample: a wrong `utils` alias is the failure mode
// that matters (get-config.js appends '.ts', so `lib/utils/cn` is what
// resolves to lib/utils/cn.ts), and it is invisible until `add` writes an
// import that does not resolve.
test('init: writes components.json with the WebJs defaults', async () => {
  stubFetch();
  const d = tmp();
  try {
    await init.parseAsync(['--yes', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    const cfg = JSON.parse(readFileSync(join(d, 'components.json'), 'utf8'));
    assert.equal(cfg.style, 'default');
    assert.equal(cfg.tailwind.baseColor, 'neutral');
    assert.equal(cfg.tailwind.cssVariables, true);
    // styles/globals.css, NOT app/globals.css: app/ is routing-only in WebJs.
    assert.equal(cfg.tailwind.css, 'styles/globals.css');
    assert.deepEqual(cfg.aliases, {
      components: 'components',
      utils: 'lib/utils/cn',
      ui: 'components/ui',
      lib: 'lib',
    });
    assert.equal(cfg.iconLibrary, 'lucide');
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

// The emitted config is only half the contract. These assert the FILES land
// where the aliases say they do, which is what `add`'s import rewriting reads:
// the cn() helper at the `utils` alias + '.ts', and the client-only DOM helper
// as its sibling (#819).
test('init: writes the cn helper and its DOM sibling under lib/utils/', async () => {
  stubFetch();
  const d = tmp();
  try {
    await init.parseAsync(['--yes', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    assert.ok(existsSync(join(d, 'lib', 'utils', 'cn.ts')), 'cn.ts at the utils alias');
    assert.match(readFileSync(join(d, 'lib', 'utils', 'cn.ts'), 'utf8'), /cn/);
    assert.ok(existsSync(join(d, 'lib', 'utils', 'dom.ts')), 'dom.ts beside it');
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

// The whole point of scoping the kit to WebJs is that there is ONE default set.
// A Next-shaped project used to get app/globals.css and @/ aliases; it now gets
// the same config as anything else, and `--css` remains the escape hatch.
test('init: does not vary its defaults by what the host project looks like', async () => {
  stubFetch();
  const d = mkdtempSync(join(tmpdir(), 'webjsui-init-next-'));
  writeFileSync(join(d, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }));
  try {
    await init.parseAsync(['--yes', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    const cfg = JSON.parse(readFileSync(join(d, 'components.json'), 'utf8'));
    assert.equal(cfg.tailwind.css, 'styles/globals.css');
    assert.equal(cfg.aliases.utils, 'lib/utils/cn');
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

test('init: appends theme CSS to globals.css', async () => {
  stubFetch();
  const d = tmp();
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(d, 'styles'), { recursive: true });
    writeFileSync(join(d, 'styles', 'globals.css'), '/* existing */\n');
    await init.parseAsync(['--yes', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    const css = readFileSync(join(d, 'styles', 'globals.css'), 'utf8');
    assert.match(css, /\/\* existing \*\//);
    assert.match(css, /@webjsdev\/ui theme/);
    assert.match(css, /--primary: #000/);
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

test('init: theme is idempotent (doesn\'t append twice)', async () => {
  stubFetch();
  const d = tmp();
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(d, 'styles'), { recursive: true });
    writeFileSync(join(d, 'styles', 'globals.css'), '');
    await init.parseAsync(['--yes', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    await init.parseAsync(['--yes', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    const css = readFileSync(join(d, 'styles', 'globals.css'), 'utf8');
    const occurrences = (css.match(/@webjsdev\/ui theme/g) || []).length;
    assert.equal(occurrences, 1, 'theme block should only appear once');
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

test('init: accepts --base-color override', async () => {
  stubFetch();
  const d = tmp();
  try {
    await init.parseAsync(['--yes', '--base-color', 'zinc', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    const cfg = JSON.parse(readFileSync(join(d, 'components.json'), 'utf8'));
    assert.equal(cfg.tailwind.baseColor, 'zinc');
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

test('init: accepts --css override', async () => {
  stubFetch();
  const d = tmp();
  try {
    await init.parseAsync(['--yes', '--css', 'src/styles.css', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    const cfg = JSON.parse(readFileSync(join(d, 'components.json'), 'utf8'));
    assert.equal(cfg.tailwind.css, 'src/styles.css');
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

// #983: init must exit non-zero when the theme tokens could not be written
// (the old soft-fail left an unstyled install with a clean exit code). The
// counterfactual is the local-first success case just above it.
test('init: hard-fails (exit non-zero) when the theme cannot be written', async () => {
  globalThis.fetch = async () => new Response('nope', { status: 404 });
  const origExit = process.exit;
  const origErr = console.error;
  const origLog = console.log;
  let code = null;
  process.exit = (c) => { code = c; throw new Error('__exit__'); };
  console.log = () => {};
  console.error = () => {};
  const d = tmp();
  try {
    // A registry URL not used elsewhere, so the fetcher's per-URL cache can't
    // shadow this 404 with an earlier test's cached success.
    await init
      .parseAsync(['--yes', '--cwd', d, '--registry', 'http://hardfail/r'], { from: 'user' })
      .catch((e) => { if (e.message !== '__exit__') throw e; });
    assert.equal(code, 1, 'init exits non-zero on an unwritten theme');
  } finally {
    process.exit = origExit;
    console.error = origErr;
    console.log = origLog;
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

test('init: local-first (default registry) writes the theme and exits 0', async () => {
  // No fetch stub: proves the theme resolves from the PACKAGED registry with no
  // network. This is the counterfactual to the hard-fail test above.
  globalThis.fetch = async () => { throw new Error('should not fetch'); };
  const origExit = process.exit;
  let exited = false;
  process.exit = () => { exited = true; throw new Error('__exit__'); };
  const origLog = console.log;
  console.log = () => {};
  const d = tmp();
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(d, 'styles'), { recursive: true });
    writeFileSync(join(d, 'styles', 'globals.css'), '/* existing */\n');
    await init.parseAsync(['--yes', '--cwd', d], { from: 'user' });
    assert.equal(exited, false, 'init did not exit non-zero');
    const css = readFileSync(join(d, 'styles', 'globals.css'), 'utf8');
    assert.match(css, /@webjsdev\/ui theme/);
  } finally {
    process.exit = origExit;
    console.log = origLog;
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

// #1129 made `init` write into `lib/utils/`, which is where `webjs create`
// puts the helper and where the you-own-it model expects your edits to live.
// The write was unguarded, so re-running init (the documented fix for an
// unstyled install) silently replaced edited source. It must not.
test('init: keeps an existing cn helper instead of replacing it', async () => {
  stubFetch();
  const d = tmp();
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(d, 'lib', 'utils'), { recursive: true });
    writeFileSync(join(d, 'lib', 'utils', 'cn.ts'), 'export const MINE = 1;\n');
    writeFileSync(join(d, 'lib', 'utils', 'dom.ts'), 'export const ALSO_MINE = 1;\n');

    await init.parseAsync(['--yes', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });

    assert.match(readFileSync(join(d, 'lib', 'utils', 'cn.ts'), 'utf8'), /MINE/, 'edited cn.ts survives');
    assert.match(readFileSync(join(d, 'lib', 'utils', 'dom.ts'), 'utf8'), /ALSO_MINE/, 'edited dom.ts survives');
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

test('init: --overwrite does replace them', async () => {
  stubFetch();
  const d = tmp();
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(d, 'lib', 'utils'), { recursive: true });
    writeFileSync(join(d, 'lib', 'utils', 'cn.ts'), 'export const MINE = 1;\n');

    await init.parseAsync(['--yes', '--overwrite', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });

    assert.doesNotMatch(readFileSync(join(d, 'lib', 'utils', 'cn.ts'), 'utf8'), /MINE/);
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

// An older project initialised at alias `lib/utils` must not be silently
// relocated to `lib/utils/cn` by a re-run: its already-added components import
// the old path, and moving the alias would strand every one of them.
test('init: re-run keeps an older project on its own aliases', async () => {
  stubFetch();
  const d = tmp();
  try {
    writeFileSync(join(d, 'components.json'), JSON.stringify({
      $schema: 'https://ui.webjs.dev/schema.json',
      style: 'default',
      tailwind: { css: 'styles/globals.css', baseColor: 'neutral', cssVariables: true },
      aliases: { components: 'components', utils: 'lib/utils', ui: 'components/ui', lib: 'lib' },
    }));

    await init.parseAsync(['--yes', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });

    const cfg = JSON.parse(readFileSync(join(d, 'components.json'), 'utf8'));
    assert.equal(cfg.aliases.utils, 'lib/utils', 'the old alias is preserved');
    assert.equal(existsSync(join(d, 'lib', 'utils', 'cn.ts')), false, 'no helper at the new layout');
    assert.ok(existsSync(join(d, 'lib', 'utils.ts')), 'the helper stays where the project expects it');
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

// The first pass at the re-run guard only preserved `aliases`, so a project
// whose stylesheet is not the default (examples/blog builds public/input.css)
// still got repointed, and the theme appended to a file it never compiles.
test('init: re-run preserves a non-default stylesheet and base color', async () => {
  stubFetch();
  const d = tmp();
  try {
    writeFileSync(join(d, 'components.json'), JSON.stringify({
      $schema: 'https://ui.webjs.dev/schema.json',
      style: 'default',
      tailwind: { css: 'public/input.css', baseColor: 'zinc', cssVariables: true },
      aliases: { components: 'components', utils: 'lib/utils/cn', ui: 'components/ui', lib: 'lib' },
    }));
    await init.parseAsync(['--yes', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    const cfg = JSON.parse(readFileSync(join(d, 'components.json'), 'utf8'));
    assert.equal(cfg.tailwind.css, 'public/input.css', 'stylesheet path is preserved');
    assert.equal(cfg.tailwind.baseColor, 'zinc', 'base color is preserved');
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

// The config schema is .strict(), so a shadcn-shaped config with extra keys
// throws on parse. Treating that as "no config" would relocate the aliases and
// then overwrite the file, which is the data loss the guard exists to stop.
test('init: keeps settings from a config carrying unknown keys', async () => {
  stubFetch();
  const d = tmp();
  try {
    writeFileSync(join(d, 'components.json'), JSON.stringify({
      $schema: 'https://ui.webjs.dev/schema.json',
      style: 'default',
      rsc: true,
      tsx: true,
      tailwind: { css: 'src/app.css', baseColor: 'stone', cssVariables: true },
      aliases: { components: 'components', utils: 'src/lib/cn', ui: 'components/ui', lib: 'lib' },
    }));
    await init.parseAsync(['--yes', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    const cfg = JSON.parse(readFileSync(join(d, 'components.json'), 'utf8'));
    assert.equal(cfg.aliases.utils, 'src/lib/cn', 'aliases survive a strict-schema miss');
    assert.equal(cfg.tailwind.css, 'src/app.css');
    // Unknown keys are DROPPED, not carried through: the schema is strict, so
    // writing one back produces a config `add` / `diff` / `info` throw on. The
    // file must stay readable by the commands that consume it.
    assert.equal(cfg.rsc, undefined, 'unknown keys are not written back');
    assert.doesNotThrow(() => getConfig(d), 'what init wrote must parse');
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

test('init: refuses to replace a components.json it cannot parse', async () => {
  stubFetch();
  const d = tmp();
  const origExit = process.exit;
  const origErr = console.error;
  let code = null;
  process.exit = (c) => { code = c; throw new Error('__exit__'); };
  console.error = () => {};
  try {
    writeFileSync(join(d, 'components.json'), '{ this is not json');
    await init
      .parseAsync(['--yes', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' })
      .catch((e) => { if (e.message !== '__exit__') throw e; });
    assert.equal(code, 1, 'exits non-zero rather than clobbering');
    assert.equal(readFileSync(join(d, 'components.json'), 'utf8'), '{ this is not json', 'file untouched');
  } finally {
    process.exit = origExit;
    console.error = origErr;
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

// A declared alias map may omit keys the schema defaults. Reading the config
// raw skips that default-filling, so taking the map wholesale left `utils`
// undefined and crashed init after it had already written the config.
test('init: a partial alias map is filled from the defaults, not left undefined', async () => {
  stubFetch();
  const d = tmp();
  try {
    writeFileSync(join(d, 'components.json'), JSON.stringify({
      $schema: 'https://ui.webjs.dev/schema.json',
      style: 'default',
      tailwind: { css: 'styles/globals.css', baseColor: 'neutral', cssVariables: true },
      aliases: { components: 'components', ui: 'components/ui', lib: 'lib' },
    }));
    await init.parseAsync(['--yes', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    const cfg = JSON.parse(readFileSync(join(d, 'components.json'), 'utf8'));
    assert.equal(cfg.aliases.utils, 'lib/utils/cn', 'the missing key takes the default');
    assert.equal(cfg.aliases.components, 'components', 'declared keys are still preserved');
    assert.ok(existsSync(join(d, 'lib', 'utils', 'cn.ts')), 'and the helper is actually written');
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

// The printed hint has to name a command the reader can actually run. `npx
// webjsui` resolves the PACKAGE name `webjsui`, which is not published (it is a
// bin declared inside `@webjsdev/ui`), so it only works where the kit is already
// a direct dep. It is not one for a `webjs ui init` caller, since the scaffold
// leaves `@webjsdev/ui` unpinned.
test('init: the success hint prints a command that resolves without a prior install (#1264)', async () => {
  stubFetch();
  const d = tmp();
  const origLog = console.log;
  const out = [];
  console.log = (...args) => out.push(args.join(' '));
  try {
    await init.parseAsync(['--yes', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
  } finally {
    console.log = origLog;
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
  const text = out.join('\n');
  assert.match(text, /npx @webjsdev\/ui add/);
  assert.doesNotMatch(text, /npx webjsui/, 'the bare bin name does not resolve for a `webjs ui` caller');
});
