/**
 * Tests for `webjs check --json` (#262).
 *
 * The CLI's `check` command already returns structured `Violation[]` from
 * `checkConventions(appDir)` and pretty-prints them; `--json` emits the raw
 * structured violations plus a summary count as JSON, so an agent running
 * `webjs check` in a loop consumes structured data instead of regex-scraping
 * stdout.
 *
 * Covered:
 *   - stdout PARSES as JSON (no pretty-print leakage) whose `violations` match
 *     `checkConventions` (shape `{ rule, file, message, fix }`), plus a
 *     `summary.count`.
 *   - exits NON-ZERO when there are violations, ZERO when clean.
 *   - the shared `projectCheck` projector is byte-identical to what the MCP
 *     `check` tool returns (single source of truth).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..', '..');
const CLI = resolve(REPO, 'packages', 'cli', 'bin', 'webjs.js');

const { checkConventions } = await import('@webjsdev/server/check');
const { projectCheck } = await import(
  resolve(REPO, 'packages', 'mcp', 'src', 'check-report.js')
);

const cleanup = [];
after(() => { for (const d of cleanup) rmSync(d, { recursive: true, force: true }); });

function tmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'check-json-'));
  cleanup.push(dir);
  return dir;
}

function write(dir, rel, content) {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** Run `node bin/webjs.js check --json` in appDir, return { code, stdout }. */
function runCheckJson(appDir, extraArgs = []) {
  const r = spawnSync(process.execPath, [CLI, 'check', '--json', ...extraArgs], {
    cwd: appDir,
    encoding: 'utf8',
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('check --json: clean app emits parseable JSON and exits 0', async () => {
  const dir = tmpDir();
  // A minimal, convention-clean app: a page that default-exports a function.
  write(dir, 'app/page.ts', `import { html } from '@webjsdev/core';\nexport default function Home() { return html\`<h1>Hi</h1>\`; }\n`);

  const { code, stdout } = runCheckJson(dir);
  // No pretty-print leakage: the WHOLE stdout parses as JSON.
  const report = JSON.parse(stdout.trim());
  assert.ok(Array.isArray(report.violations), 'violations is an array');
  assert.equal(report.violations.length, 0, 'no violations for a clean app');
  assert.equal(report.summary.count, 0, 'summary.count is 0');
  assert.deepEqual(report.summary.byRule, {}, 'byRule is empty');
  assert.equal(code, 0, 'exit 0 when clean');

  // Matches checkConventions directly (the projector wraps the raw array).
  const violations = await checkConventions(dir);
  assert.deepEqual(report, projectCheck(violations));
});

test('check --json: app with a violation emits the violation and exits non-zero', async () => {
  const dir = tmpDir();
  // The fixture needs an `app/` directory to BE an app: `webjs check` refuses
  // outside one (#1301), the same way its clean-app sibling above is shaped.
  write(dir, 'app/page.ts', `import { html } from '@webjsdev/core';\nexport default function Home() { return html\`<h1>Hi</h1>\`; }\n`);
  // A component that defines a WebComponent subclass but never registers it
  // trips `components-have-register`.
  write(
    dir,
    'components/broken.ts',
    `import { WebComponent, html } from '@webjsdev/core';\n` +
    `export class Broken extends WebComponent {\n` +
    `  render() { return html\`<p>x</p>\`; }\n` +
    `}\n`,
  );

  const { code, stdout } = runCheckJson(dir);
  const report = JSON.parse(stdout.trim());
  assert.ok(report.violations.length > 0, 'at least one violation reported');
  // Each violation carries the { rule, file, message, fix } shape.
  for (const v of report.violations) {
    assert.equal(typeof v.rule, 'string');
    assert.equal(typeof v.file, 'string');
    assert.equal(typeof v.message, 'string');
    assert.equal(typeof v.fix, 'string');
  }
  assert.equal(report.summary.count, report.violations.length, 'count matches length');
  // byRule tallies per rule.
  const total = Object.values(report.summary.byRule).reduce((a, b) => a + b, 0);
  assert.equal(total, report.violations.length, 'byRule sums to the total');
  assert.notEqual(code, 0, 'exit non-zero when violations exist');

  // Cross-check against the raw checker.
  const violations = await checkConventions(dir);
  assert.deepEqual(report, projectCheck(violations));
});

test('check --json: --rules still short-circuits (does not emit JSON)', () => {
  const dir = tmpDir();
  write(dir, 'app/page.ts', `export default function P() {}\n`);
  // --rules is the existing behavior; --json must not hijack it.
  const r = spawnSync(process.execPath, [CLI, 'check', '--rules', '--json'], {
    cwd: dir,
    encoding: 'utf8',
  });
  assert.match(r.stdout, /correctness rules/, '--rules prints the rule listing');
  assert.throws(() => JSON.parse(r.stdout.trim()), 'rule listing is not JSON');
});

test('projectCheck: summary tallies per rule', () => {
  const violations = [
    { rule: 'a', file: 'x', message: 'm', fix: 'f' },
    { rule: 'a', file: 'y', message: 'm', fix: 'f' },
    { rule: 'b', file: 'z', message: 'm', fix: 'f' },
  ];
  const report = projectCheck(violations);
  assert.equal(report.summary.count, 3);
  assert.deepEqual(report.summary.byRule, { a: 2, b: 1 });
  // violations are passed through verbatim.
  assert.deepEqual(report.violations, violations);
});
