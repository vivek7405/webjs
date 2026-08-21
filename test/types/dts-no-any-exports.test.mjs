/**
 * Drift guard for issue #1451: a published package's `.d.ts` overlay must not
 * hand an APP an export typed `any`.
 *
 * The two sibling guards check export EXISTENCE in both directions
 * (`dts-export-coverage` #388 forward, `dts-no-phantom-exports` #1031 reverse),
 * and both are blind to this for the same two reasons. They run tsc with
 * `--allowJs`, so an overlay re-exporting from a JSDoc `.js` with no `.d.ts`
 * sibling still resolves, reading the types out of the JSDoc; and they assert a
 * name is DECLARED, never that it carries a type. An app has `allowJs` off (it
 * does not want the framework's `.js` in its program) and `skipLibCheck: true`,
 * so there the same re-export degrades silently to `any`. That is how `html`,
 * `css`, `TemplateResult`, `Suspense`, `repeat`, `connectWS`, `richFetch` and
 * `escapeText` / `escapeAttr` shipped as `any` to every scaffolded app while
 * every type test stayed green, taking a component's `render()` return, its
 * `static styles` and a page's return type down with them.
 *
 * So this guard inverts BOTH flags: `--allowJs` OFF, `--skipLibCheck` OFF. That
 * pair is the whole mechanism. Do not restore either to make an entry pass; the
 * fix is a real `.d.ts`.
 *
 * Two checks, because the failure has two shapes:
 *
 * 1. Per overlay, tsc must report NOTHING against the package's own files. The
 *    untyped re-export surfaces there as `TS7016` (implicitly `any`), and a
 *    value `export *` from an explicit `.d.ts` path as `TS2846`.
 * 2. A headline fixture proves the exports this issue named resolve to real
 *    types. It probes by ASSIGNMENT rather than by a conditional type, because
 *    an unresolved import produces TypeScript's error type, and that type
 *    absorbs every conditional: `0 extends (1 & T)`, `unknown extends T` and a
 *    bare `T extends X` all evaluate to the error type rather than to `true` or
 *    `false`, so a type-level `IsAny` silently reports nothing. Assigning to a
 *    branded type nothing real inhabits is the one probe that stays honest:
 *    a real type errors, `any` and the error type do not.
 *
 * Counterfactual: a synthetic overlay re-exporting an untyped `.js` is reported,
 * and adding the sibling `.d.ts` silences it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const tscBin = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

// `minEntries` matches the sibling guards' floors: if `entryPairs` ever returns
// fewer overlay entries than this (a renamed `exports` shape, a mapping
// regression), the run FAILS loudly instead of silently checking almost nothing.
const PACKAGES = [
  { name: '@webjsdev/core', dir: 'packages/core', minEntries: 12 },
  { name: '@webjsdev/server', dir: 'packages/server', minEntries: 3 },
];

/** Every export subpath that declares a `types` overlay. Same mapping as the siblings. */
function entryPairs(pkgDir) {
  const pkg = JSON.parse(readFileSync(join(ROOT, pkgDir, 'package.json'), 'utf8'));
  const pairs = [];
  for (const [key, val] of Object.entries(pkg.exports || {})) {
    if (!val || typeof val !== 'object' || !val.types || !val.types.endsWith('.d.ts')) continue;
    pairs.push({ key, types: val.types.replace(/^\.\//, '') });
  }
  return pairs;
}

/**
 * Run tsc over a fixture the way an APP resolves the packages, and return its
 * output. `allowJs` and `skipLibCheck` are deliberately absent / off.
 *
 * It goes through a generated tsconfig rather than CLI flags for one reason:
 * `paths` pins every bare `@webjsdev/*` specifier to THIS checkout's
 * `packages/`. A bare specifier otherwise resolves through the workspace's
 * `node_modules` symlink, which in a git worktree points at the PRIMARY
 * checkout, so the guard would grade the wrong copy of the package and pass
 * while the branch under test is still broken (or fail while it is fixed).
 */
const abs = (rel) => join(ROOT, rel).replace(/\\/g, '/');

function checkFixture(fixture) {
  const tsconfig = join(dirname(fixture), 'tsconfig.probe.json');
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        noEmit: true,
        strict: true,
        target: 'esnext',
        module: 'esnext',
        moduleResolution: 'bundler',
        lib: ['esnext', 'dom'],
        types: ['node'],
        skipLibCheck: false,
        // Absolute `paths` values, and no `baseUrl`: the tsconfig is generated
        // into a temp dir, and `baseUrl` is deprecated from TypeScript 6.
        paths: {
          '@webjsdev/core': [abs('packages/core/index.d.ts')],
          '@webjsdev/core/*': [abs('packages/core/src/*')],
          '@webjsdev/server': [abs('packages/server/index.d.ts')],
          '@webjsdev/server/*': [abs('packages/server/src/*')],
        },
        // Same reason: `types` resolves against the tsconfig's own directory.
        typeRoots: [abs('node_modules/@types')],
      },
      files: [fixture],
    }),
  );
  const res = spawnSync(process.execPath, [tscBin, '--noEmit', '-p', tsconfig], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return `${res.stdout || ''}${res.stderr || ''}`;
}

/**
 * Keep only the diagnostics that land in OUR OWN published sources. A run with
 * `skipLibCheck` off also type-checks every third-party `.d.ts` in the program
 * (drizzle-orm alone contributes about fifty), and those are not this guard's
 * business. `node_modules/@webjsdev/*` is included because the workspace links
 * each package there, so tsc may report either path for the same file.
 */
function ownPackageErrors(out) {
  return out
    .split('\n')
    .filter((l) => /error TS\d+/.test(l))
    .filter((l) => /(^|[/\\])packages[/\\]|node_modules[/\\]@webjsdev[/\\]/.test(l))
    .filter((l) => !/node_modules[/\\](?!@webjsdev)/.test(l))
    .map((l) => l.trim());
}

for (const { name, dir, minEntries } of PACKAGES) {
  test(`${name}: no overlay hands an app an \`any\` export (#1451)`, () => {
    const entries = entryPairs(dir);
    assert.ok(
      entries.length >= minEntries,
      `${name}: expected at least ${minEntries} overlay entries, found ${entries.length}. ` +
        `The exports mapping changed; fix the mapping rather than lowering the floor.`,
    );
    const workDir = mkdtempSync(join(tmpdir(), 'webjs-dts-any-'));
    try {
      // One fixture importing every overlay, so a single tsc run covers the
      // package and a cross-entry breakage cannot hide behind a per-entry run.
      const lines = entries.map(({ types }, i) => {
        const spec = join(ROOT, dir, types).replace(/\\/g, '/').replace(/\.d\.ts$/, '');
        return `type Entry${i} = typeof import(${JSON.stringify(spec)});\nexport type _E${i} = Entry${i};`;
      });
      const fixture = join(workDir, 'entries.ts');
      writeFileSync(fixture, `${lines.join('\n')}\n`);
      const out = checkFixture(fixture);
      // An unresolved overlay would make every entry `any` and this guard
      // vacuous, so a resolution failure is a broken harness, not a pass.
      if (/error TS2307|Cannot find module/.test(out)) {
        throw new Error(`no-any fixture failed to resolve an overlay (harness broken):\n${out}`);
      }
      const errors = ownPackageErrors(out);
      assert.deepEqual(
        errors,
        [],
        `${name} overlays do not type-check the way an app resolves them (allowJs off, ` +
          `skipLibCheck off), so the exports below reach every app as \`any\`:\n  ` +
          `${errors.join('\n  ')}\n` +
          `A TS7016 means the overlay re-exports from a JSDoc .js with no .d.ts sibling. ` +
          `Add the sibling; do not relax the flags here.`,
      );
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
}

test('the headline core and server exports carry real types, not `any` (#1451)', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'webjs-dts-headline-'));
  try {
    const core = join(ROOT, 'packages/core/index').replace(/\\/g, '/');
    const directives = join(ROOT, 'packages/core/src/directives').replace(/\\/g, '/');
    const server = join(ROOT, 'packages/server/index').replace(/\\/g, '/');
    // Nothing real inhabits `Probe`, so assigning a genuinely-typed export to it
    // is an error. `any` (and TypeScript's error type) assign cleanly, which is
    // exactly the silence this test reads as a failure.
    const fixture = join(workDir, 'headline.ts');
    const coreNames = ['html', 'css', 'Suspense', 'connectWS', 'richFetch', 'escapeText', 'escapeAttr', 'isTemplate', 'isCSS'];
    writeFileSync(
      fixture,
      `import { ${coreNames.join(', ')} } from ${JSON.stringify(core)};\n` +
      `import type { TemplateResult } from ${JSON.stringify(core)};\n` +
      `import { repeat } from ${JSON.stringify(directives)};\n` +
      `import type { RequestHandler } from ${JSON.stringify(server)};\n` +
      `declare const __brand: unique symbol;\n` +
      `type Probe = { readonly [__brand]: 'webjs-no-any' };\n` +
      // One statement per export. A missing error names the `any`.
      coreNames.map((n) => `const _${n}: Probe = ${n}; void _${n};`).join('\n') + '\n' +
      `const _repeat: Probe = repeat; void _repeat;\n` +
      `const _tmpl: Probe = null as unknown as TemplateResult; void _tmpl;\n` +
      `const _handle: Probe = null as unknown as RequestHandler['handle']; void _handle;\n`,
    );
    const out = checkFixture(fixture);
    if (/error TS2307|Cannot find module/.test(out)) {
      throw new Error(`headline fixture failed to resolve a package (harness broken):\n${out}`);
    }
    const expected = [...coreNames, 'repeat', 'tmpl', 'handle'];
    // ANY diagnostic on a probe line proves the type is real: each line holds a
    // single assignment to `Probe`, and only `any` lets one through silently.
    // The code varies with the export's shape (a function is TS2322, an object
    // type is TS2741), so keying on one code would silently stop discriminating.
    const errored = new Set(
      [...out.matchAll(/headline\.ts\((\d+),\d+\): error TS\d+/g)].map((m) => m[1]),
    );
    // Map the reported line numbers back to names via the fixture's own text.
    const src = readFileSync(fixture, 'utf8').split('\n');
    const errNames = [...errored].map((ln) => /const _([A-Za-z0-9_$]+): Probe/.exec(src[Number(ln) - 1])?.[1]);
    const missing = expected.filter((n) => !errNames.includes(n));
    assert.deepEqual(
      missing,
      [],
      `these exports resolve to \`any\` for an app (allowJs off), so nothing about ` +
        `their use is type-checked: ${missing.join(', ')}`,
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

// --- Counterfactual: the guard must FIRE on an untyped re-export and go quiet
// --- once the missing sibling exists.
test('the no-any guard fires on an overlay re-exporting an untyped .js (#1451)', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'webjs-dts-any-cf-'));
  try {
    // A JSDoc-typed impl with NO .d.ts sibling: what the real defect looked like.
    writeFileSync(
      join(workDir, 'impl.js'),
      '/** @param {string} s @returns {string} */\nexport function shout(s) { return s.toUpperCase(); }\n',
    );
    writeFileSync(join(workDir, 'overlay.d.ts'), "export { shout } from './impl.js';\n");
    const fixture = join(workDir, 'cf.ts');
    writeFileSync(fixture, `export type E = typeof import(${JSON.stringify(join(workDir, 'overlay').replace(/\\/g, '/'))});\n`);

    const before = checkFixture(fixture);
    assert.match(
      before,
      /overlay\.d\.ts\(1,\d+\): error TS7016/,
      'the guard must report the untyped re-export as TS7016',
    );

    // Adding the sibling .d.ts is the fix, and it must silence the guard.
    writeFileSync(join(workDir, 'impl.d.ts'), 'export function shout(s: string): string;\n');
    const after = checkFixture(fixture);
    assert.doesNotMatch(after, /error TS7016/, 'a typed sibling must make the guard clean');
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
