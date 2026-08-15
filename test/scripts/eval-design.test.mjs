/**
 * The design-quality scorer (#1116).
 *
 * The load-bearing assertions are the PER-LINE ones. A test that only checked
 * "dirty fails, clean passes" would stay green with a rubric line silently
 * dead, because eight failing lines are enough to fail the run. So every line
 * is asserted individually against the counterfactual fixture, which trips all
 * nine exactly once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = join(repoRoot, 'scripts/eval-design.mjs');
const DIRTY = join(repoRoot, 'test/fixtures/eval-design/dirty-app');
const CLEAN = join(repoRoot, 'test/fixtures/eval-design/clean-app');
const PROMPTS = join(repoRoot, 'scripts/eval-design/prompts');

/** The nine lines, named here so the test does not import the table it checks. */
const RUBRIC_LINES = [
  'raw-palette-utilities',
  'literal-colour-values',
  'arbitrary-spacing',
  'type-scale-adherence',
  'heading-hierarchy',
  'semantic-elevation',
  'empty-state-present',
  'action-pyramid',
  'label-value-antipattern',
];

function run(appDir, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, appDir, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function scoreJson(appDir) {
  const r = run(appDir, '--json');
  return JSON.parse(r.stdout);
}

test('exits non-zero on the counterfactual app', () => {
  const r = run(DIRTY);
  assert.equal(r.status, 1, `expected a failing exit, got ${r.status}\n${r.stdout}`);
});

test('exits zero on the clean app', () => {
  const r = run(CLEAN);
  assert.equal(r.status, 0, `expected a passing exit, got ${r.status}\n${r.stdout}`);
});

test('reports exactly the nine rubric lines', () => {
  const result = scoreJson(DIRTY);
  assert.deepEqual(
    result.lines.map((l) => l.name),
    RUBRIC_LINES,
  );
});

// The counterfactual, per line. Deleting any one rubric line from the script
// makes exactly its own assertion below fail, which is what proves each line is
// live rather than carried by its siblings.
for (const name of RUBRIC_LINES) {
  test(`rubric line fires on the counterfactual: ${name}`, () => {
    const result = scoreJson(DIRTY);
    const line = result.lines.find((l) => l.name === name);
    assert.ok(line, `${name} is missing from the rubric entirely`);
    assert.ok(line.count > 0, `${name} counted 0 on the dirty fixture, so it is not firing`);
    assert.equal(line.pass, false);
  });

  test(`rubric line is quiet on the clean app: ${name}`, () => {
    const result = scoreJson(CLEAN);
    const line = result.lines.find((l) => l.name === name);
    assert.ok(line, `${name} is missing from the rubric entirely`);
    assert.equal(line.count, 0, `${name} counted ${line.count} on the clean fixture: ${JSON.stringify(line.hits)}`);
  });
}

test('every hit carries a real file and line', () => {
  const result = scoreJson(DIRTY);
  for (const line of result.lines) {
    for (const hit of line.hits) {
      assert.match(hit.file, /\.[jt]s$/, `${line.name} hit has no source file`);
      assert.ok(Number.isInteger(hit.line) && hit.line > 0, `${line.name} hit has no line number`);
      const source = readFileSync(join(DIRTY, hit.file), 'utf8').split('\n');
      assert.ok(hit.line <= source.length, `${line.name} points past the end of ${hit.file}`);
    }
  }
});

test('a comment mentioning a defect is not counted as one', () => {
  // The first run of the scorer counted `#1116` in a doc comment as a hex
  // colour. Prose about a defect is not the defect.
  const result = scoreJson(CLEAN);
  const literals = result.lines.find((l) => l.name === 'literal-colour-values');
  assert.equal(literals.count, 0, JSON.stringify(literals.hits));
});

test('json output carries the whole result shape', () => {
  const result = scoreJson(DIRTY);
  assert.equal(typeof result.appDir, 'string');
  assert.equal(result.pass, false);
  for (const line of result.lines) {
    assert.equal(typeof line.name, 'string');
    assert.equal(typeof line.count, 'number');
    assert.equal(line.target, 0);
    assert.equal(typeof line.pass, 'boolean');
    assert.ok(Array.isArray(line.hits));
  }
});

test('missing app directory exits 2 rather than passing vacuously', () => {
  const r = run(join(repoRoot, 'test/fixtures/eval-design/does-not-exist'));
  assert.equal(r.status, 2);
});

// The instrument itself. A prompt carrying design vocabulary measures the
// prompt rather than the guidance, so the ban is asserted, not just documented.
const BANNED = [
  'beautiful',
  'clean',
  'modern',
  'polished',
  'professional',
  'sleek',
  'elegant',
  'minimal',
  'hierarchy',
  'spacing',
  'layout',
  'palette',
  'color',
  'colour',
  'typography',
  'font',
  'empty state',
  'elevation',
  'shadow',
  'responsive',
  'accessible',
  'design',
  'style',
  '@webjsdev/ui',
];

test('the three prompt files exist and nothing else does', () => {
  const files = readdirSync(PROMPTS).sort();
  assert.deepEqual(files, ['README.md', 'content-page.md', 'dashboard.md', 'settings-form.md']);
});

for (const prompt of ['dashboard', 'settings-form', 'content-page']) {
  test(`prompt carries no design vocabulary: ${prompt}`, () => {
    const text = readFileSync(join(PROMPTS, `${prompt}.md`), 'utf8').toLowerCase();
    for (const word of BANNED) {
      assert.ok(!text.includes(word), `${prompt}.md contains the banned word "${word}"`);
    }
  });

  test(`prompt ends with the one allowed framework hint: ${prompt}`, () => {
    const text = readFileSync(join(PROMPTS, `${prompt}.md`), 'utf8').trim();
    assert.ok(
      text.endsWith('Build this in the WebJs app in this directory.'),
      `${prompt}.md must end with the shared closing line, identical across all three`,
    );
  });
}
