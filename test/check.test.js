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
      `import { WebComponent } from 'webjs';
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
      `import { WebComponent } from 'webjs';
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
      `import { WebComponent } from 'webjs';
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
      `import { WebComponent } from 'webjs';
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
      `import { WebComponent } from 'webjs';
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
      `import { WebComponent } from 'webjs';
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
