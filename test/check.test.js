import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { checkConventions } from '../packages/server/src/check.js';

async function makeTempApp() {
  const dir = await mkdtemp(join(tmpdir(), 'webjs-check-'));
  return dir;
}

test('tag-name-has-hyphen: flags component without hyphen in tag', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'components'), { recursive: true });
    await writeFile(
      join(appDir, 'components', 'bad.js'),
      `import { WebComponent } from '@webjs/core';
class BadComp extends WebComponent {}
BadComp.register('badcomp');
`,
    );

    const violations = await checkConventions(appDir);
    const v = violations.find((v) => v.rule === 'tag-name-has-hyphen');
    assert.ok(v, 'expected tag-name-has-hyphen violation');
    assert.ok(v.message.includes('badcomp'));
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('tag-name-has-hyphen: passes for valid hyphenated tag', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'components'), { recursive: true });
    await writeFile(
      join(appDir, 'components', 'good.js'),
      `import { WebComponent } from '@webjs/core';
class GoodComp extends WebComponent {}
GoodComp.register('good-comp');
`,
    );

    const violations = await checkConventions(appDir);
    const v = violations.find((v) => v.rule === 'tag-name-has-hyphen');
    assert.equal(v, undefined, 'should not flag hyphenated tag');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('components-have-register: flags component with no register() call', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'components'), { recursive: true });
    await writeFile(
      join(appDir, 'components', 'no-reg.js'),
      `import { WebComponent } from '@webjs/core';
class NoReg extends WebComponent {}
`,
    );

    const violations = await checkConventions(appDir);
    const v = violations.find((v) => v.rule === 'components-have-register');
    assert.ok(v, 'expected components-have-register violation');
    assert.ok(v.message.includes('register'));
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('components-have-register: passes with Class.register("tag")', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'components'), { recursive: true });
    await writeFile(
      join(appDir, 'components', 'good.js'),
      `import { WebComponent } from '@webjs/core';
class GoodComp extends WebComponent {}
GoodComp.register('good-comp');
`,
    );

    const violations = await checkConventions(appDir);
    const v = violations.find((v) => v.rule === 'components-have-register');
    assert.equal(v, undefined, 'should not flag component with Class.register()');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('components-have-register: passes with customElements.define fallback', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'components'), { recursive: true });
    await writeFile(
      join(appDir, 'components', 'native.js'),
      `import { WebComponent } from '@webjs/core';
class NativeComp extends WebComponent {}
customElements.define('native-comp', NativeComp);
`,
    );

    const violations = await checkConventions(appDir);
    const v = violations.find((v) => v.rule === 'components-have-register');
    assert.equal(v, undefined, 'should not flag native-API registration');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('no violations for empty app', async () => {
  const appDir = await makeTempApp();
  try {
    const violations = await checkConventions(appDir);
    assert.equal(violations.length, 0);
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('rule override disables a rule', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'components'), { recursive: true });
    await writeFile(
      join(appDir, 'components', 'bad.js'),
      `import { WebComponent } from '@webjs/core';
class BadComp extends WebComponent {}
BadComp.register('badcomp');
`,
    );

    const violations = await checkConventions(appDir, {
      rules: { 'tag-name-has-hyphen': false },
    });
    const v = violations.find((v) => v.rule === 'tag-name-has-hyphen');
    assert.equal(v, undefined, 'disabled rule should not fire');
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

/* -------------------- actions-in-modules -------------------- */

test('actions-in-modules: flags .server.ts file outside modules/*/actions or queries', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'modules'), { recursive: true });
    await mkdir(join(appDir, 'app', 'api'), { recursive: true });
    await writeFile(
      join(appDir, 'app', 'api', 'create.server.ts'),
      `export async function create() {}`,
    );
    const violations = await checkConventions(appDir);
    const v = violations.find((v) => v.rule === 'actions-in-modules');
    assert.ok(v, 'expected actions-in-modules violation');
    assert.ok(v.message.includes('actions/'));
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('actions-in-modules: ignores files already inside modules/*/actions', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'modules', 'users', 'actions'), { recursive: true });
    await writeFile(
      join(appDir, 'modules', 'users', 'actions', 'create.server.ts'),
      `export async function create() {}`,
    );
    const violations = await checkConventions(appDir);
    assert.equal(violations.find((v) => v.rule === 'actions-in-modules'), undefined);
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('actions-in-modules: ignores files inside modules/*/queries', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'modules', 'users', 'queries'), { recursive: true });
    await writeFile(
      join(appDir, 'modules', 'users', 'queries', 'list.server.ts'),
      `export async function list() {}`,
    );
    const violations = await checkConventions(appDir);
    assert.equal(violations.find((v) => v.rule === 'actions-in-modules'), undefined);
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('actions-in-modules: ignores files inside modules/*/components or utils', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'modules', 'users', 'components'), { recursive: true });
    await mkdir(join(appDir, 'modules', 'users', 'utils'), { recursive: true });
    await writeFile(
      join(appDir, 'modules', 'users', 'components', 'form.server.ts'),
      `'use server';\nexport async function submit() {}`,
    );
    await writeFile(
      join(appDir, 'modules', 'users', 'utils', 'helper.server.ts'),
      `'use server';\nexport async function helper() {}`,
    );
    const violations = await checkConventions(appDir);
    assert.equal(violations.find((v) => v.rule === 'actions-in-modules'), undefined);
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('actions-in-modules: not enforced when modules/ does not exist', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'app', 'api'), { recursive: true });
    await writeFile(
      join(appDir, 'app', 'api', 'rogue.server.ts'),
      `export async function rogue() {}`,
    );
    const violations = await checkConventions(appDir);
    // With no modules/ dir, the rule is skipped.
    assert.equal(violations.find((v) => v.rule === 'actions-in-modules'), undefined);
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

/* -------------------- one-function-per-action -------------------- */

test('one-function-per-action: flags file exporting > 1 async function', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'modules', 'users', 'actions'), { recursive: true });
    await writeFile(
      join(appDir, 'modules', 'users', 'actions', 'multi.server.ts'),
      `export async function create() {}\nexport async function remove() {}\n`,
    );
    const violations = await checkConventions(appDir);
    const v = violations.find((v) => v.rule === 'one-function-per-action');
    assert.ok(v, 'expected one-function-per-action violation');
    assert.ok(v.message.includes('2 functions'));
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('one-function-per-action: passes for single-function file', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'modules', 'users', 'actions'), { recursive: true });
    await writeFile(
      join(appDir, 'modules', 'users', 'actions', 'single.server.ts'),
      `export async function create() {}\n`,
    );
    const violations = await checkConventions(appDir);
    assert.equal(violations.find((v) => v.rule === 'one-function-per-action'), undefined);
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('one-function-per-action: detects `export const foo = async ...` pattern', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'modules', 'u', 'actions'), { recursive: true });
    await writeFile(
      join(appDir, 'modules', 'u', 'actions', 'arrow.server.ts'),
      `export const a = async () => {};\nexport const b = async () => {};\n`,
    );
    const violations = await checkConventions(appDir);
    const v = violations.find((v) => v.rule === 'one-function-per-action');
    assert.ok(v);
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

/* -------------------- no-server-imports-in-components -------------------- */

test('no-server-imports-in-components: flags direct @prisma/client import', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'components'), { recursive: true });
    await writeFile(
      join(appDir, 'components', 'bad.ts'),
      `import { WebComponent } from '@webjs/core';\n` +
      `import { PrismaClient } from '@prisma/client';\n` +
      `class Bad extends WebComponent {}\nBad.register('bad-c');\n`,
    );
    const violations = await checkConventions(appDir);
    const v = violations.find((v) => v.rule === 'no-server-imports-in-components');
    assert.ok(v);
    assert.ok(v.message.includes('@prisma/client'));
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('no-server-imports-in-components: flags direct node:* imports', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'components'), { recursive: true });
    await writeFile(
      join(appDir, 'components', 'bad.ts'),
      `import { WebComponent } from '@webjs/core';\n` +
      `import fs from 'node:fs';\n` +
      `class Bad extends WebComponent {}\nBad.register('bad-n');\n`,
    );
    const violations = await checkConventions(appDir);
    const v = violations.find((v) => v.rule === 'no-server-imports-in-components');
    assert.ok(v && v.message.includes('node:'));
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('no-server-imports-in-components: flags imports from lib/', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'components'), { recursive: true });
    await writeFile(
      join(appDir, 'components', 'bad.ts'),
      `import { WebComponent } from '@webjs/core';\n` +
      `import { prisma } from '../lib/prisma';\n` +
      `class Bad extends WebComponent {}\nBad.register('bad-l');\n`,
    );
    const violations = await checkConventions(appDir);
    const v = violations.find((v) => v.rule === 'no-server-imports-in-components');
    assert.ok(v && v.message.includes('lib/'));
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('no-server-imports-in-components: skips .server.ts files (they may import anything)', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'modules', 'a', 'components'), { recursive: true });
    await writeFile(
      join(appDir, 'modules', 'a', 'components', 'thing.server.ts'),
      `import fs from 'node:fs';\nexport async function handle() {}\n`,
    );
    const violations = await checkConventions(appDir);
    assert.equal(violations.find((v) => v.rule === 'no-server-imports-in-components'), undefined);
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

/* -------------------- tests-exist -------------------- */

test('tests-exist: flags modules/feature with no matching test file', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'modules', 'orphan'), { recursive: true });
    const violations = await checkConventions(appDir);
    const v = violations.find(
      (x) => x.rule === 'tests-exist' && x.file.includes('orphan'),
    );
    assert.ok(v);
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('tests-exist: passes when a test file mentions the module name', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'modules', 'posts'), { recursive: true });
    await mkdir(join(appDir, 'test', 'unit'), { recursive: true });
    await writeFile(
      join(appDir, 'test', 'unit', 'posts.test.ts'),
      `import { test } from 'node:test';\n`,
    );
    const violations = await checkConventions(appDir);
    assert.equal(
      violations.find((v) => v.rule === 'tests-exist' && v.file.includes('posts')),
      undefined,
    );
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

/* -------------------- package.json / webjs.conventions.js overrides -------------------- */

test('override via package.json "conventions" disables a rule', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'components'), { recursive: true });
    await writeFile(
      join(appDir, 'components', 'bad.js'),
      `import { WebComponent } from '@webjs/core';\n` +
      `class BadComp extends WebComponent {}\nBadComp.register('badcomp');\n`,
    );
    await writeFile(
      join(appDir, 'package.json'),
      JSON.stringify({
        name: 'x',
        conventions: { 'tag-name-has-hyphen': false },
      }),
    );
    const violations = await checkConventions(appDir);
    assert.equal(violations.find((v) => v.rule === 'tag-name-has-hyphen'), undefined);
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('override via webjs.conventions.js disables a rule', async () => {
  const appDir = await makeTempApp();
  try {
    await mkdir(join(appDir, 'components'), { recursive: true });
    await writeFile(
      join(appDir, 'components', 'bad.js'),
      `import { WebComponent } from '@webjs/core';\n` +
      `class BadComp extends WebComponent {}\nBadComp.register('badcomp');\n`,
    );
    await writeFile(
      join(appDir, 'webjs.conventions.js'),
      `export default { 'tag-name-has-hyphen': false };\n`,
    );
    const violations = await checkConventions(appDir);
    assert.equal(violations.find((v) => v.rule === 'tag-name-has-hyphen'), undefined);
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test('unknown rule name in override is ignored (no crash)', async () => {
  const appDir = await makeTempApp();
  try {
    const violations = await checkConventions(appDir, {
      rules: { 'nonexistent-rule': false },
    });
    assert.ok(Array.isArray(violations));
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});
