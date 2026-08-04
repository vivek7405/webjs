import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';

import { scaffoldApp } from '../../packages/cli/lib/create.js';

async function tempCwd() {
  return mkdtemp(join(tmpdir(), 'webjs-scaffold-'));
}

test('scaffoldApp rejects unknown templates', async () => {
  const cwd = await tempCwd();
  try {
    await assert.rejects(
      () => scaffoldApp('my-app', cwd, { template: 'todo' }),
      /Unknown template 'todo'/,
    );
    await assert.rejects(
      () => scaffoldApp('my-app', cwd, { template: 'blog' }),
      /Unknown template 'blog'/,
    );
    await assert.rejects(
      () => scaffoldApp('my-app', cwd, { template: 'ecommerce' }),
      /Unknown template 'ecommerce'/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('scaffoldApp error message mentions the valid templates', async () => {
  const cwd = await tempCwd();
  try {
    try {
      await scaffoldApp('my-app', cwd, { template: 'nope' });
      assert.fail('should have thrown');
    } catch (err) {
      assert.match(err.message, /full-stack/);
      assert.match(err.message, /api/);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

// --- App-name validation (#1066) -----------------------------------------
//
// The name is interpolated into generated source as a template-literal value
// (`metadata.title` in app/page.ts, the api template's root route handler) and
// written verbatim into the generated package.json `name`, so an unvalidated
// quote / backtick / `${` emits a file that fails to parse on the fresh app's
// very first boot. `scaffoldApp` is a public entry the tests call directly, so
// it re-validates the same way it re-validates `--template`.

test('scaffoldApp rejects names that would break generated source', async () => {
  const cwd = await tempCwd();
  try {
    for (const bad of ["bad'name", 'bad`name', 'bad${name}', 'bad\\name', 'bad name', 'BadName']) {
      await assert.rejects(
        () => scaffoldApp(bad, cwd, { template: 'full-stack' }),
        /Invalid app name/,
        `${JSON.stringify(bad)} should be rejected`,
      );
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('scaffoldApp writes NOTHING when the name is rejected', async () => {
  const cwd = await tempCwd();
  try {
    await assert.rejects(() => scaffoldApp("bad'name", cwd, { template: 'full-stack' }));
    // The guard runs before the first mkdir, so the target directory (and any
    // partial scaffold inside it) must not exist.
    assert.deepEqual(await readdir(cwd), [], 'a rejected name leaves no files behind');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('scaffoldApp app-name error states the allowed shape', async () => {
  const cwd = await tempCwd();
  try {
    await scaffoldApp('bad`name', cwd, { template: 'full-stack' });
    assert.fail('should have thrown');
  } catch (err) {
    assert.match(err.message, /lowercase letters/);
    assert.match(err.message, /214/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('a valid kebab name still scaffolds, and its title survives verbatim', async () => {
  const cwd = await tempCwd();
  const restoreLog = console.log;
  console.log = () => {};
  try {
    await scaffoldApp('my-app', cwd, { template: 'full-stack', install: false });
    const pkg = JSON.parse(await readFile(join(cwd, 'my-app', 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'my-app');
    // The display-name derivation (title-cased) must keep working for a valid
    // name; this is what the guard has to leave untouched.
    const page = await readFile(join(cwd, 'my-app', 'app', 'page.ts'), 'utf8');
    assert.match(page, /title: 'My App'/);
    // And the emitted page must survive the TypeScript stripper, which is the
    // exact step a name-borne syntax error fails. Reverting the guard and
    // scaffolding `bad'name` emits `title: 'Bad'Name',` here, and this call is
    // what throws `Expected ',', got 'ident'` (the fresh app's first-boot 500).
    assert.doesNotThrow(() => stripTypeScriptTypes(page, { mode: 'strip' }));
  } finally {
    console.log = restoreLog;
    await rm(cwd, { recursive: true, force: true });
  }
});

test('the CLI rejects a bad app name non-zero, before writing anything', async () => {
  const cwd = await tempCwd();
  try {
    const bin = fileURLToPath(new URL('../../packages/cli/bin/webjs.js', import.meta.url));
    const res = spawnSync(process.execPath, [bin, 'create', "bad'name"], {
      cwd,
      encoding: 'utf8',
    });
    assert.notEqual(res.status, 0, 'a bad name must exit non-zero');
    assert.match(res.stderr, /invalid app name/i);
    assert.match(res.stderr, /lowercase letters/);
    assert.deepEqual(await readdir(cwd), [], 'the CLI writes nothing for a rejected name');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
