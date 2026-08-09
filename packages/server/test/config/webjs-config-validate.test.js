/**
 * Boot-time `webjs` config validation (#1300).
 *
 * Two layers, deliberately separate. The unit half pins
 * `validateAppWebjsConfig` on its own. The boot half proves the validator is
 * actually WIRED into `createRequestHandler`, which is the assertion that would
 * survive someone deleting the call site while every unit test stayed green.
 *
 * The ruling this file guards is warn-and-continue: a typo'd key must produce a
 * warning AND a working handler. Change the warn to a throw and the
 * "boot completes" assertion reds.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateAppWebjsConfig } from '../../src/webjs-config-validate.js';
import { createRequestHandler } from '../../src/dev.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_URL = pathToFileURL(resolve(__dirname, '../../../core/src/html.js')).toString();
const PAGE =
  `import { html } from ${JSON.stringify(HTML_URL)};\n` +
  `export default function P() { return html\`<h1>home</h1>\`; }\n`;

/** The stable fragment of the boot warning, so a test can pick it out. */
const CONFIG_WARNING = 'block in package.json has';

let tmpRoot;
before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-cfg-validate-'));
});
after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** An app fixture whose package.json carries the given config block. */
function makeApp(block) {
  const appDir = mkdtempSync(join(tmpRoot, 'app-'));
  mkdirSync(join(appDir, 'app'), { recursive: true });
  writeFileSync(join(appDir, 'app', 'page.js'), PAGE);
  const pkg = { name: 'fixture', type: 'module' };
  if (block !== undefined) pkg.webjs = block;
  writeFileSync(join(appDir, 'package.json'), JSON.stringify(pkg));
  return appDir;
}

/** Captures warnings so a test can assert on how many fired and what they said. */
function capturingLogger() {
  const warns = [];
  return {
    warns,
    logger: { info: () => {}, warn: (msg) => warns.push(String(msg)), error: () => {} },
  };
}

/** Only the config warnings, so an unrelated boot warning cannot skew a count. */
const configWarnings = (warns) => warns.filter((w) => w.includes(CONFIG_WARNING));

/* ------------ validateAppWebjsConfig ------------ */

test('no config block at all is nothing to report', () => {
  assert.deepEqual(validateAppWebjsConfig({ name: 'x' }), []);
  assert.deepEqual(validateAppWebjsConfig({}), []);
  assert.deepEqual(validateAppWebjsConfig(undefined), []);
  assert.deepEqual(validateAppWebjsConfig(null), []);
});

test('a non-object config block is nothing to report', () => {
  // The readers treat each of these as unconfigured, and none is a typo this
  // could usefully name, so reporting on them would be noise.
  assert.deepEqual(validateAppWebjsConfig({ webjs: 'yes' }), []);
  assert.deepEqual(validateAppWebjsConfig({ webjs: 42 }), []);
  assert.deepEqual(validateAppWebjsConfig({ webjs: [] }), []);
});

test('a representative valid block is nothing to report', () => {
  const problems = validateAppWebjsConfig({
    webjs: {
      elide: false,
      trailingSlash: 'never',
      basePath: '/app',
      maxBodyBytes: 262144,
      redirects: [{ source: '/old', destination: '/new', permanent: false }],
      doctor: { gate: { UNMARKED_ASSET_LINKS: 'error' } },
    },
  });
  assert.deepEqual(problems, []);
});

test('a typo names the key that was dropped', () => {
  const problems = validateAppWebjsConfig({ webjs: { redirect: [] } });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /redirect/);
});

test('a bad enum value and a wrong-typed leaf are reported', () => {
  assert.equal(validateAppWebjsConfig({ webjs: { trailingSlash: 'sometimes' } }).length, 1);
  assert.equal(validateAppWebjsConfig({ webjs: { elide: 'yes' } }).length, 1);
});

test('every problem in one block is reported, not just the first', () => {
  const problems = validateAppWebjsConfig({
    webjs: { redirect: [], nope: 1, trailingSlash: 'sometimes' },
  });
  assert.equal(problems.length, 3);
});

/* ------------ the boot path ------------ */

test('a typo warns once at boot and the boot still completes', async () => {
  const { warns, logger } = capturingLogger();
  const appDir = makeApp({ redirect: [] });

  const app = await createRequestHandler({ appDir, dev: true, logger });

  // The ruling. A config problem must never cost the app its boot.
  assert.ok(app && typeof app.handle === 'function', 'createRequestHandler resolved');
  const res = await app.handle(new Request('http://x/'));
  assert.equal(res.status, 200, 'the app still serves');

  const found = configWarnings(warns);
  assert.equal(found.length, 1, `expected exactly one config warning, saw ${warns.length} warnings`);
  assert.match(found[0], /redirect/, 'the warning names the typo');
});

test('several problems ride one aggregated warning', async () => {
  const { warns, logger } = capturingLogger();
  const appDir = makeApp({ redirect: [], trailingSlash: 'sometimes' });

  await createRequestHandler({ appDir, dev: true, logger });

  const found = configWarnings(warns);
  assert.equal(found.length, 1, 'one line, not one per problem');
  assert.match(found[0], /redirect/);
  assert.match(found[0], /trailingSlash/);
});

test('a clean config leaves the boot output unchanged', async () => {
  const { warns, logger } = capturingLogger();
  const appDir = makeApp({ elide: false, trailingSlash: 'never' });

  await createRequestHandler({ appDir, dev: true, logger });

  assert.deepEqual(configWarnings(warns), [], 'a healthy app boots silently');
});

test('an app with no package.json boots silently', async () => {
  const { warns, logger } = capturingLogger();
  const appDir = mkdtempSync(join(tmpRoot, 'nopkg-'));
  mkdirSync(join(appDir, 'app'), { recursive: true });
  writeFileSync(join(appDir, 'app', 'page.js'), PAGE);

  await createRequestHandler({ appDir, dev: true, logger });

  assert.deepEqual(configWarnings(warns), []);
});
