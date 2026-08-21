/**
 * The generated `package.json` must not permit a TypeScript that cannot read
 * the `tsconfig.json` the SAME generator writes.
 *
 * The scaffold shipped `"typescript": "^5.6.0"` alongside a tsconfig setting
 * `erasableSyntaxOnly`, which landed in TypeScript 5.8. Every version in the
 * lower half of that range refuses the config outright with
 * `TS5023: Unknown compiler option 'erasableSyntaxOnly'`, exit 2, nothing else
 * checked. It stayed invisible because `npm install` resolves a caret range to
 * the newest matching version, so a fresh scaffold picked up 5.9 and worked; it
 * bites a pinned install, an older lockfile, or a toolchain whose own compiler
 * is older. Nothing tied the two files together, so they were free to drift.
 *
 * This ties them. `REQUIRES` maps each compiler option the generator emits to
 * the TypeScript version that introduced it, and the test asserts two things:
 * the declared range's LOWEST satisfying version clears the highest floor among
 * the emitted options, and every emitted option is classified. The second half
 * is what keeps this from rotting: adding an option the table does not know
 * fails the test until someone records its floor, the same "classify it or CI
 * stays red" contract as the gallery-coverage manifest.
 *
 * Counterfactual: restore `^5.6.0` (or add an unclassified option) and this
 * fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scaffoldApp } from '../../packages/cli/lib/create.js';

/**
 * The TypeScript release that introduced each compiler option the generated
 * tsconfig sets. `1.0.0` means "as old as anything we care about", used for the
 * options that predate every version this project could run.
 */
const REQUIRES = {
  target: '1.0.0',
  module: '1.0.0',
  moduleResolution: '1.0.0',
  lib: '1.0.0',
  types: '1.0.0',
  strict: '2.3.0',
  noEmit: '1.0.0',
  skipLibCheck: '2.0.0',
  plugins: '2.3.0',
  allowImportingTsExtensions: '5.0.0',
  // The option this guard exists for.
  erasableSyntaxOnly: '5.8.0',
};

const TEMPLATES = ['full-stack', 'api'];

for (const template of TEMPLATES) {
  test(`${template}: the declared typescript range can read the generated tsconfig`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), `webjs-tsfloor-${template}-`));
    try {
      await scaffoldApp('demo', cwd, { template, install: false });
      const pkg = JSON.parse(await readFile(join(cwd, 'demo', 'package.json'), 'utf8'));
      // The generator emits plain JSON today (JSON.stringify, no comments),
      // but tsconfig.json is JSONC by convention, so parse defensively: a
      // comment added to the output later must red an assertion here, never
      // crash the parse.
      const tsconfigRaw = await readFile(join(cwd, 'demo', 'tsconfig.json'), 'utf8');
      const options = Object.keys(JSON.parse(stripJsonComments(tsconfigRaw)).compilerOptions);

      const unclassified = options.filter((o) => !(o in REQUIRES));
      assert.deepEqual(
        unclassified,
        [],
        `the generated tsconfig sets compiler option(s) with no recorded TypeScript ` +
          `floor: ${unclassified.join(', ')}. Add each to REQUIRES with the version ` +
          `that introduced it, so the declared range keeps being checked against it.`,
      );

      const required = options
        .map((o) => REQUIRES[o])
        .reduce((hi, v) => (compare(v, hi) > 0 ? v : hi), '1.0.0');

      const range = pkg.devDependencies?.typescript;
      assert.ok(range, `${template}: the generated package.json declares no typescript`);
      // The LOWEST version the range admits is the one that has to work: npm
      // resolves a caret to the newest match today, which is exactly why the
      // drift went unnoticed.
      const lowest = lowestSatisfying(range);
      assert.ok(
        compare(lowest, required) >= 0,
        `${template}: "typescript": "${range}" admits ${lowest}, but the ` +
          `generated tsconfig needs at least ${required} (its highest option floor). ` +
          `That version refuses the config with TS5023 and checks nothing.`,
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}

/**
 * The lowest version a range admits. Deliberately narrow: it understands the
 * range shapes a generated manifest actually uses and THROWS on anything else,
 * because a range this cannot read is one it must not silently pass. Written
 * out rather than pulled from `semver`, which this repo does not declare as a
 * dependency (it is only present transitively, so importing it here would make
 * the test hostage to an unrelated lockfile change).
 */
function lowestSatisfying(range) {
  const m = /^\s*(?:\^|~|>=)?\s*(\d+)\.(\d+)\.(\d+)\s*$/.exec(range);
  if (!m) {
    throw new Error(
      `cannot read the version range ${JSON.stringify(range)}. Extend ` +
        `lowestSatisfying() to cover it rather than loosening this guard.`,
    );
  }
  return `${m[1]}.${m[2]}.${m[3]}`;
}

/** Numeric x.y.z comparison. Returns >0 when `a` is newer than `b`. */
function compare(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * Strip `//` and block comments from JSONC. The generated tsconfig has none
 * today, so this is a no-op on it; it exists so a comment added to the output
 * later degrades to a failed assertion instead of a parse crash. String-aware,
 * so a `//` inside a value is not eaten.
 */
function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (c === '\n') { inLine = false; out += c; }
      continue;
    }
    if (inBlock) {
      if (c === '*' && next === '/') { inBlock = false; i += 1; }
      continue;
    }
    if (inString) {
      out += c;
      if (c === '\\') { out += next; i += 1; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && next === '/') { inLine = true; i += 1; continue; }
    if (c === '/' && next === '*') { inBlock = true; i += 1; continue; }
    out += c;
  }
  return out;
}
