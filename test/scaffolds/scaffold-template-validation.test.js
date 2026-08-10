import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { scaffoldApp } from '../../packages/cli/lib/create.js';
// The framework's own stripper seam, not `node:module` directly: it picks the
// built-in on Node and amaro on Bun, so this file runs under the Bun matrix,
// and it is the exact code path a real `webjs dev` boot takes on the emitted
// file.
import { stripTypeScript } from '../../packages/server/src/ts-strip.js';

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
    for (const bad of ["bad'name", 'bad`name', 'bad${name}', 'bad\\name', 'bad name', '-badname']) {
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
    assert.match(err.message, /letters, digits/);
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
    await assert.doesNotReject(() => stripTypeScript(page));
  } finally {
    console.log = restoreLog;
    await rm(cwd, { recursive: true, force: true });
  }
});

// The generators emit STRINGS, so a malformed doctor-gate block only shows in a
// freshly generated app. Both templates get the gate, and the generated CI
// workflow runs the script that reads it, which is the whole loop (#1257).
for (const template of ['full-stack', 'api']) {
  test(`the ${template} scaffold gates UNMARKED_ASSET_LINKS and runs doctor in CI`, async () => {
    const cwd = await tempCwd();
    const restoreLog = console.log;
    console.log = () => {};
    try {
      await scaffoldApp('my-app', cwd, { template, install: false });
      const pkg = JSON.parse(await readFile(join(cwd, 'my-app', 'package.json'), 'utf8'));
      assert.equal(pkg.webjs.doctor.gate.UNMARKED_ASSET_LINKS, 'error');
      assert.equal(pkg.scripts.doctor, 'webjs doctor');
      const ci = await readFile(join(cwd, 'my-app', '.github', 'workflows', 'ci.yml'), 'utf8');
      assert.match(ci, /^\s+- run: npm run doctor$/m, 'the conventions job runs doctor');
    } finally {
      console.log = restoreLog;
      await rm(cwd, { recursive: true, force: true });
    }
  });
}

test('an uppercase name scaffolds a working app end to end', async () => {
  // The rule deliberately allows uppercase, and the claim that goes with it is
  // that a capital letter is safe as the DIRECTORY, in the package.json
  // manifest, and in the emitted source. The pure validator cannot show any of
  // that, so assert it where it actually lands.
  const cwd = await tempCwd();
  const restoreLog = console.log;
  console.log = () => {};
  try {
    await scaffoldApp('MyApp', cwd, { template: 'full-stack', install: false });
    const pkg = JSON.parse(await readFile(join(cwd, 'MyApp', 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'MyApp');
    assert.equal(pkg.private, true, 'the manifest is private, which is why uppercase is fine');
    const page = await readFile(join(cwd, 'MyApp', 'app', 'page.ts'), 'utf8');
    assert.match(page, /title: 'MyApp'/);
    await assert.doesNotReject(() => stripTypeScript(page));
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
    assert.match(res.stderr, /letters and digits/);
    assert.deepEqual(await readdir(cwd), [], 'the CLI writes nothing for a rejected name');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('the create-webjs wrapper rejects a bad name too (npm / bun create webjs)', async () => {
  // `npm create webjs` and `bun create webjs` route through this wrapper, not
  // through `webjs create`, so its guard is a third entry point and needs its
  // own coverage. Without the guard the wrapper reaches `scaffoldApp`, whose
  // throw surfaces as an unhandled rejection instead of the guidance.
  const cwd = await tempCwd();
  try {
    const bin = fileURLToPath(
      new URL('../../packages/wrappers/create-webjs/bin/create-webjs.js', import.meta.url),
    );
    const res = spawnSync(process.execPath, [bin, "bad'name", '--no-install'], {
      cwd,
      encoding: 'utf8',
    });
    assert.notEqual(res.status, 0, 'a bad name must exit non-zero');
    // Assert on what ONLY the wrapper's own guard produces. Matching merely
    // "invalid app name" would also match `scaffoldApp`'s throw, so the test
    // would pass with the wrapper guard deleted (it did, before this line).
    // The guidance block and the absence of a stack trace are the difference.
    assert.match(res.stderr, /The name becomes the app's directory/);
    assert.match(res.stderr, /Example: webjs create my-app/);
    assert.ok(
      // Match on the frame markers, not on `at `: the guidance's own
      // "at most 214 characters" line is both indented and starts with `at`.
      !/file:\/\/|node:internal/.test(res.stderr),
      `a stack trace means the wrapper guard did not fire; got: ${res.stderr}`,
    );
    assert.deepEqual(await readdir(cwd), [], 'the wrapper writes nothing for a rejected name');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

// `action=""` is a conformance error: the HTML spec requires `action` to be a
// valid non-empty URL when the attribute is present. Every browser treats it as
// "submit to the current URL", which is why it went unnoticed in the gallery for
// so long. The WebJs fix is to BIND the action, not to drop the attribute: a
// page has no `action` export, so an unbound `method="post"` form is conformant
// and 405s (a bare GET form just re-renders). The gallery binds its forms now,
// so this guard is what stops the empty attribute creeping back into an app
// that `webjs create` generates.
//
// Scope note: CODE templates only, never `.md`. That is what makes a plain
// attribute scan safe here. Two earlier versions of this guard tried to match
// whole `<form>` tags so that prose in the copied skill markdown would not trip
// it, and both had holes: `[^>]*` stopped at the `>` inside an arrow function,
// and masking `${...}` holes blinded the scan to every form nested in a mapped
// sub-template. Skipping markdown removes the reason to parse tags at all.
//
// Framework tests that use the empty attribute are out of scope by
// construction, since they live outside `packages/cli/templates/`. They pin
// BEHAVIOUR rather than teaching the idiom: `router-client.test.js:2535` uses
// `formaction=""` as a fixture for how the client router resolves it, and the
// form-action guard tests assert that a REFUSED `?action=${fn}` still leaves
// the `action=""` a boolean binding would have emitted.
const EMPTY_ACTION_RE = /(?:^|\s)(?:form)?action\s*=\s*(""|'')/;

test('no scaffold template ships a conformance-error action="" or formaction=""', async () => {
  const templates = fileURLToPath(new URL('../../packages/cli/templates/', import.meta.url));
  const gallery = fileURLToPath(new URL('../../gallery/', import.meta.url));

  const offenders = [];
  let scanned = 0;
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        await walk(path);
        continue;
      }
      // Markdown IS in scope: `webjs create` ships AGENTS.md, CONVENTIONS.md,
      // and the agent rule files into every generated app, and those are what
      // TEACH the idiom. The one exclusion is the generated skill bundle under
      // `.agents/skills/`, the single place prose legitimately writes the
      // attribute while explaining why not to use it. (`prepack` copies it in
      // and `postpack --clean` removes it, so it is usually absent anyway.)
      if (!/\.(ts|tsx|js|jsx|mjs|html|md|cursorrules)$/.test(entry.name)) continue;
      if (path.includes(`${sep}.agents${sep}skills${sep}`)) continue;
      scanned++;
      const src = await readFile(path, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (EMPTY_ACTION_RE.test(line)) {
          offenders.push(`${path.slice(templates.length)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
  }
  await walk(templates);
  await walk(gallery);

  // Sanity floor: a walk that silently scanned nothing would pass vacuously.
  assert.ok(scanned > 20, `sanity: expected many template files, scanned ${scanned}`);
  assert.deepEqual(
    offenders,
    [],
    `scaffold templates must bind the action rather than emit an empty attribute:\n${offenders.join('\n')}`,
  );
});

test('the empty-action pattern matches every shape a template can write it in', () => {
  // The tree has zero offenders, so the assertion above passes whether or not
  // the pattern works. These fixtures are what prove it discriminates, and they
  // cover the two shapes that defeated the previous tag-matching versions: an
  // arrow function earlier in the tag, and a form nested in a sub-template.
  for (const shape of [
    '<form action="">',
    "<form action=''>",
    '<form\n  action=""\n  class="x">',
    '<form @submit=${(e: SubmitEvent) => this.add(e)}\n  action="">',
    '<form\naction=""\n  class="x">',
    '${list.map((t) => html`<form action="">${t.title}</form>`)}',
    '<button formaction="">go</button>',
    '<button @click=${(e) => this.go(e)}\n  formaction="">go</button>',
  ]) {
    assert.ok(EMPTY_ACTION_RE.test(shape.split('\n').find((l) => EMPTY_ACTION_RE.test(l)) ?? ''), `missed: ${shape}`);
  }

  for (const ok of ['<form action=${submitTodo}>', '<form action="/real/url">', '<button formaction=${publish}>']) {
    assert.ok(!ok.split('\n').some((l) => EMPTY_ACTION_RE.test(l)), `false positive: ${ok}`);
  }
});
