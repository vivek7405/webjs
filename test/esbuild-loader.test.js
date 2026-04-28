/**
 * Tests for the esbuild loader hook that webjs registers at server boot
 * to transform server-side `.ts` imports. The hook lives at
 * `packages/server/src/esbuild-loader.js` and ensures SSR + hydration
 * use the same TypeScript transformer (esbuild) — important because
 * Node's built-in stripper rejects non-erasable syntax (enum, parameter
 * properties, decorators) while esbuild handles them, and a mismatch
 * surfaces as "works in browser, throws on server."
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const LOADER = new URL('../packages/server/src/esbuild-loader.js', import.meta.url).href;

/**
 * Run a snippet in a child Node process with the loader registered.
 * We use a child process because `module.register()` from the same
 * process can race with the test runner's own loader chain.
 */
function runWithLoader(tsSource, importExpr = "import('./fixture.ts').then(m => console.log(JSON.stringify(m.default)))") {
  const dir = mkdtempSync(join(tmpdir(), 'webjs-loader-'));
  try {
    writeFileSync(join(dir, 'fixture.ts'), tsSource);
    const driver = `
      import { register } from 'node:module';
      register(${JSON.stringify(LOADER)});
      ${importExpr};
    `;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', driver], {
      cwd: dir, encoding: 'utf8', timeout: 15000,
    });
    return { stdout: r.stdout.trim(), stderr: r.stderr.trim(), status: r.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('esbuild loader hook', () => {
  it('strips erasable type annotations (the common case)', () => {
    const r = runWithLoader(`
      type Greeting = string;
      const hello: Greeting = 'world';
      export default hello;
    `);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '"world"');
  });

  it('compiles enums (which the native Node stripper rejects)', () => {
    const r = runWithLoader(`
      enum Color { Red = 'red', Green = 'green' }
      export default Color.Green;
    `);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '"green"');
  });

  it('handles parameter properties (the native Node stripper rejects them)', () => {
    const r = runWithLoader(`
      class Box {
        constructor(public value: string) {}
      }
      export default new Box('inside').value;
    `);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '"inside"');
  });

  it('supports namespaces with values', () => {
    const r = runWithLoader(`
      namespace Util { export const VERSION = '1.0'; }
      export default Util.VERSION;
    `);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '"1.0"');
  });

  it('preserves generics at call sites', () => {
    const r = runWithLoader(`
      function identity<T>(x: T): T { return x; }
      export default identity<number>(42);
    `);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '42');
  });

  it('does not transform non-TS files (delegates to next loader)', () => {
    const r = runWithLoader(
      `// not relevant to .js check`,
      `
      import('./fixture.js').then(m => console.log(JSON.stringify(m.default)));
      `
    );
    // The .js fixture doesn't exist; we just want to confirm the loader
    // doesn't try to transform .js files (it should delegate, then Node
    // emits a normal MODULE_NOT_FOUND).
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Cannot find module|ERR_MODULE_NOT_FOUND/);
  });

  it('caches by file mtime (re-import is fast and yields same result)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'webjs-loader-cache-'));
    try {
      writeFileSync(join(dir, 'fixture.ts'), `export default 'first';`);
      const driver = `
        import { register } from 'node:module';
        register(${JSON.stringify(LOADER)});
        const a = await import('./fixture.ts');
        const b = await import('./fixture.ts');
        console.log(JSON.stringify({ a: a.default, b: b.default, sameRef: a === b }));
      `;
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', driver], {
        cwd: dir, encoding: 'utf8', timeout: 15000,
      });
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout.trim());
      assert.equal(out.a, 'first');
      assert.equal(out.b, 'first');
      assert.equal(out.sameRef, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
