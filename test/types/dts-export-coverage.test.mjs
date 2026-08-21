/**
 * Drift guard for issue #388: each published package's hand-maintained `.d.ts`
 * overlay must declare a SUPERSET of its runtime named exports, so every
 * `import { x } from '<pkg>'` that works at runtime also type-checks. The
 * `@webjsdev/core` overlay had drifted (36 of 82 runtime exports missing, incl.
 * `WebComponent`, `signal`, the whole directive set, the serializer).
 *
 * For each entry point it reads the runtime export names DYNAMICALLY (so the
 * guard can never go stale as exports are added), then tsc-checks a fixture that
 * imports every one from the overlay. A missing declaration surfaces as a
 * `no exported member` error naming the symbol. The counterfactual is built in:
 * drop any export from the `.d.ts` and this fails with that name.
 *
 * The entry list is READ from each package's own `exports` (#1291), the same way
 * the reverse guard (`dts-no-phantom-exports.test.mjs`, #1031) already does, so a
 * new subpath is forward-checked with no edit here. It used to be a hardcoded
 * three-element array while fifteen overlays existed, which left twelve subpaths
 * unguarded in this direction.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const tscBin = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

// Published packages whose `.d.ts` are HAND-WRITTEN overlays over `.js` JSDoc.
// The entry list is READ from each package's own `exports`, so a new subpath is
// covered with no edit here (#1291).
//
// `minEntries` matches the reverse guard's floor exactly: if `entryPairs` ever
// returns fewer overlay entries than this (a renamed `exports` shape, a mapping
// regression), the run FAILS loudly instead of silently checking almost nothing.
// `minNames` is the per-package total of CHECKED export names, which catches the
// failure the entry count cannot see: an entry that still resolves, but to a
// SMALLER module than intended, quietly shrinking the check. Each floor sits
// just below its package's real total, and raising an export count only makes
// the floor stricter, which is the same rationale recorded on the reverse guard.
//
// The real totals are deliberately NOT written down here. They move with every
// export, a frozen copy of them is wrong the next time anyone adds one, and a
// number in a comment fails nothing when it rots, so nothing catches it. Two of
// the three that used to sit on this line had already drifted before anyone
// noticed. Read the current totals off a failure message, or compute them with
// `entryPairs` + `checkedNames` below, which is what the assertions do.
const PACKAGES = [
  { name: '@webjsdev/core', dir: 'packages/core', minEntries: 12, minNames: 160 },
  { name: '@webjsdev/server', dir: 'packages/server', minEntries: 3, minNames: 140 },
];

/**
 * The `.d.ts` overlay + its runtime `.js` for every package export that declares
 * a `types`. The impl `.js` is DERIVED from the overlay path (a sibling
 * `foo.d.ts` overlays `foo.js`), NOT read from a `source` field: only some
 * entries carry `source` (the rest map `types` + `default`-to-dist), so keying on
 * `source` silently skips every server entry and five core subpaths. Same mapping
 * as the reverse guard, so the two halves check the same surface.
 */
function entryPairs(pkgDir) {
  const pkg = JSON.parse(readFileSync(join(ROOT, pkgDir, 'package.json'), 'utf8'));
  const pairs = [];
  for (const [key, val] of Object.entries(pkg.exports || {})) {
    if (!val || typeof val !== 'object' || !val.types || !val.types.endsWith('.d.ts')) continue;
    const types = val.types.replace(/^\.\//, '');
    // `impl` is the DERIVED sibling `.js`, not the package.json `source` field.
    pairs.push({ key, types, impl: types.replace(/\.d\.ts$/, '.js') });
  }
  return pairs;
}

/**
 * Runtime export names the overlay is REQUIRED to declare. A leading `_` marks a
 * test-only seam that is deliberately NOT part of the published API (the bulk of
 * them are the `Internal exports for unit testing` block in
 * `src/router-client.js`), so declaring them would publish a test seam as editor
 * autocomplete. The count is not stated here on purpose; see the note on
 * `minNames` above.
 *
 * The convention is expressed as a RULE rather than an ignore list, because a
 * list would grow with every new unit test, get edited on unrelated PRs, and rot
 * the moment someone forgot. The `_` prefix is already the module's own stated
 * convention, and this is the standard JS/TS treatment of an underscore-prefixed
 * member (the same shape as `noUnusedLocals` honouring a leading underscore).
 *
 * The exemption is one-sided by design and cannot desynchronise the pair: the
 * reverse guard computes declarations the runtime LACKS, so an undeclared `_`
 * export that exists at runtime is invisible to it by construction. If someone
 * ever DECLARES a `_foo` the runtime lacks, the reverse guard still flags it.
 *
 * Pure, so the real check and its counterfactual exercise the SAME filter.
 */
function checkedNames(mod) {
  return Object.keys(mod).filter((n) => n !== 'default' && !n.startsWith('_'));
}

/**
 * tsc-check a fixture importing `names` from `overlayPath` (an on-disk `.d.ts`),
 * and return the names the overlay does not declare.
 *
 * Resolution: the specifier drops the extension, and TypeScript resolves an
 * extensionless specifier to the sibling `.d.ts` BEFORE falling through to the
 * `.js` under `allowJs`, so the fixture reads the OVERLAY and not the JSDoc
 * implementation. That assumption is the whole mechanism, so it has its own
 * synthetic test at the bottom of this file.
 */
function undeclaredExports(overlayPath, names, fixturePath) {
  const spec = overlayPath.replace(/\\/g, '/').replace(/\.d\.ts$/, '');
  const src =
    `import {\n  ${names.join(',\n  ')},\n} from ${JSON.stringify(spec)};\n` +
    `void [\n  ${names.join(',\n  ')},\n];\n`;
  writeFileSync(fixturePath, src);
  try {
    const res = spawnSync(
      process.execPath,
      [
        tscBin, '--noEmit', '--strict',
        '--target', 'esnext', '--module', 'esnext',
        '--moduleResolution', 'bundler', '--lib', 'esnext,dom',
        '--skipLibCheck', '--allowJs', fixturePath,
      ],
      { cwd: ROOT, encoding: 'utf8' },
    );
    const out = `${res.stdout || ''}${res.stderr || ''}`;
    // Anti-vacuum: an unresolved import means EVERY name is reported as missing
    // or (worse) none is, so an empty `missing` would be a lie. A resolution
    // error means the harness itself is broken, so throw rather than return.
    // Mirrors the reverse guard's TS2307 throw.
    if (/error TS2307|Cannot find module/.test(out)) {
      throw new Error(`export-coverage fixture failed to resolve a module (harness broken):\n${out}`);
    }
    const missing = [...out.matchAll(/no exported member(?: named)? '([^']+)'/g)].map((m) => m[1]);
    return { missing, out, status: res.status };
  } finally {
    rmSync(fixturePath, { force: true });
  }
}

for (const { name, dir, minEntries, minNames } of PACKAGES) {
  const entries = entryPairs(dir);
  // Accumulated by the per-entry tests below and asserted against `minNames` in a
  // final test() per package, so the floor is a real test rather than a
  // top-level throw that node:test would attribute to nothing.
  let checkedTotal = 0;
  let exemptTotal = 0;

  test(`${name}: every published exports overlay is forward-checked (#1291)`, () => {
    assert.ok(
      entries.length >= minEntries,
      `${name}: expected >= ${minEntries} overlay entries, got ${entries.length} ` +
        `(exports mapping regressed? the guard would check nothing)`,
    );
  });

  for (const { key, types, impl } of entries) {
    const subpath = key === '.' ? name : `${name}${key.slice(1)}`;
    test(`${subpath}: .d.ts declares every runtime named export (#388)`, async () => {
      // Import the sibling `.js` by ABSOLUTE PATH, never the bare specifier.
      // Node resolves a bare specifier through the `default` condition, and four
      // core subpaths (`./directives`, `./context`, `./task`, `./client-router`)
      // all collapse onto the built `dist/webjs-core-browser.js`, so a bare
      // import would judge each of those overlays against the WHOLE bundle's 101
      // names instead of its own module's surface. That is not a stricter check,
      // it is a different and wrong one. Reading the source sibling also keeps
      // the guard runnable in a fresh worktree, where `packages/core/dist` is not
      // built. The source export set is a superset of any bundle's, so it is
      // also the strictest FORWARD surface available.
      //
      // What that leaves uncovered, stated precisely so nobody reads the line
      // above as a coverage claim: a value the overlay declares that the BROWSER
      // bundle drops is a reverse-direction question, and the reverse guard's
      // `BROWSER_SURFACES` checks exactly ONE overlay, `@webjsdev/core`'s `.`
      // (#1035). The four subpaths named above resolve to the browser bundle in
      // dist mode and have no browser check in either direction. That is a real
      // gap, not a covered one.
      const implPath = join(ROOT, dir, impl);
      const mod = await import(pathToFileURL(implPath).href);
      const names = checkedNames(mod);
      const exempt = Object.keys(mod).filter((n) => n.startsWith('_')).length;

      assert.ok(
        names.length >= 1,
        `${subpath}: resolved 0 checkable exports from ${dir}/${impl} ` +
          `(a broken import or a wrong sibling path would look exactly like this)`,
      );
      checkedTotal += names.length;
      exemptTotal += exempt;

      const overlay = join(ROOT, dir, types);
      // Derive the fixture name from `<package>/<subpath>` so entries running in
      // parallel can never race on one path.
      const tag = `${dir}_${key}`.replace(/[^A-Za-z0-9]/g, '_');
      const { missing, out, status } = undeclaredExports(
        overlay,
        names,
        join(here, `_export-coverage.${tag}.generated.ts`),
      );
      assert.deepEqual(
        missing,
        [],
        `${subpath}: ${dir}/${types} is missing declarations for runtime exports ` +
          `(a working import of these does not type-check): ${missing.join(', ')}`,
      );
      assert.equal(status, 0, `tsc reported errors for ${subpath}:\n${out}`);
    });
  }

  test(`${name}: the checked-name total has not silently shrunk (#1291)`, () => {
    assert.ok(
      checkedTotal >= minNames,
      `${name}: checked ${checkedTotal} export names across ${entries.length} entries, ` +
        `expected >= ${minNames} (an entry resolving to a SMALLER module than intended ` +
        `passes the per-entry >= 1 floor but shrinks the real coverage)`,
    );
    // The `_` exemption must actually FIRE somewhere on the real corpus. Without
    // this, a rename of the router-client test seam would leave `checkedNames`'s
    // filter as dead code and nobody would notice.
    if (name === '@webjsdev/core') {
      assert.ok(
        exemptTotal >= 1,
        `${name}: no underscore-prefixed export was exempted anywhere, so the ` +
          `test-only-seam rule in checkedNames() is dead code (it exempted ` +
          `${exemptTotal} today, and this fires only at 0)`,
      );
    }
  });
}

// --- Synthetic guards for the two assumptions the mechanism rests on. Both are
// permanent: they keep verifying what was verified by hand when this was written.

test('the underscore rule exempts test-only seams and nothing else (#1291)', () => {
  assert.deepEqual(checkedNames({ a: 1, _b: 2, default: 3 }), ['a']);
  // A name merely CONTAINING an underscore is API and stays checked.
  assert.deepEqual(checkedNames({ some_name: 1, _internal: 2 }), ['some_name']);
});

test('an extensionless import resolves to the .d.ts overlay, not the .js (#1291)', () => {
  // The entire mechanism depends on tsc preferring a sibling `.d.ts` over the
  // `.js` under `allowJs`. If that ever flipped, every fixture would read the
  // JSDoc implementation, every name would be "declared", and the guard would
  // pass vacuously on a completely missing overlay.
  const work = mkdtempSync(join(tmpdir(), 'webjs-dts-coverage-cf-'));
  try {
    writeFileSync(join(work, 'foo.js'), 'export function a() {}\nexport function b() {}\n');
    writeFileSync(join(work, 'foo.d.ts'), 'export declare function a(): void;\n');
    const { missing } = undeclaredExports(
      join(work, 'foo.d.ts'),
      ['a', 'b'],
      join(work, 'fixture.ts'),
    );
    assert.deepEqual(
      missing,
      ['b'],
      `expected only 'b' reported undeclared; got: ${missing.join(', ')}. If this is ` +
        `empty, tsc read foo.js instead of foo.d.ts and every real check above is vacuous`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
