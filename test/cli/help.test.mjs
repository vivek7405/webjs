/**
 * Tests for `webjs help <command>` (#975): per-command usage + Examples.
 *
 * A bare `webjs help` still prints the full USAGE banner; `webjs help <cmd>`
 * prints that command's usage line, summary, and an Examples block. An unknown
 * command falls back to the banner with a short note. Every documented command
 * must expose at least one example (that is the whole point: an agent reads the
 * exact invocation instead of guessing flags).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const CLI = resolve(REPO, 'packages', 'cli', 'bin', 'webjs.js');

function help(...args) {
  return spawnSync(process.execPath, [CLI, 'help', ...args], { encoding: 'utf8' });
}

/** Run the CLI with arbitrary argv (for the --help / -h flag forms). */
function cli(...args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

// A stable banner fragment that does not read as brand prose.
const BANNER = /per-command usage \+ examples/;

test('`--help` and `-h` at the top level print the banner', () => {
  for (const flag of ['--help', '-h']) {
    const r = cli(flag);
    assert.equal(r.status, 0, `${flag}: ${r.stderr}`);
    assert.match(r.stdout, BANNER, `${flag} prints the banner`);
  }
});

test('a `--help` / `-h` flag after a command prints that command\'s help', () => {
  for (const flag of ['--help', '-h']) {
    const routes = cli('routes', flag);
    assert.equal(routes.status, 0, `routes ${flag}: ${routes.stderr}`);
    assert.match(routes.stdout, /^Usage: webjs routes /m, `routes ${flag} shows routes help`);
    assert.match(routes.stdout, /^Examples:/m);

    const doctor = cli('doctor', flag);
    assert.match(doctor.stdout, /^Usage: webjs doctor \[--json\] \[--strict\]/m, `doctor ${flag} shows doctor help`);
  }
});

test('a `--help` flag short-circuits (does NOT run the command)', () => {
  // A route printer would emit "N page(s)"; the help intercept must fire first,
  // so `routes --help` in any directory prints help, never a route table.
  const r = cli('routes', '--help');
  assert.doesNotMatch(r.stdout, /page\(s\)/, 'help short-circuits before the routes body runs');
  assert.match(r.stdout, /^Usage: /m);
});

test('a `--help` flag on typecheck is NOT intercepted (forwards to tsc)', () => {
  // typecheck is a thin tsc wrapper, so --help idiomatically means tsc's own
  // help. The intercept must skip it: our Usage line must NOT appear.
  const r = cli('typecheck', '--help');
  assert.doesNotMatch(r.stdout, /^Usage: webjs typecheck /m, 'typecheck --help is not the framework help');
});

test('a `--help` flag on a passthrough command (db/ui) is NOT intercepted', () => {
  // db forwards to drizzle-kit and ui forwards to @webjsdev/ui; --help there
  // must reach the wrapped tool, not print the framework command help.
  for (const c of ['db', 'ui']) {
    const r = cli(c, '--help');
    assert.doesNotMatch(r.stdout, new RegExp(`^Usage: webjs ${c} `, 'm'), `${c} --help is not the framework help`);
  }
});

test('an unknown command with `--help` still errors (not silently intercepted)', () => {
  // `webjs bogus --help` must NOT become a silent success: only known,
  // non-passthrough commands are intercepted, so this falls to Unknown-command.
  const r = cli('bogus', '--help');
  assert.equal(r.status, 1, 'an unknown command is an error even with --help');
  assert.match(r.stderr, /Unknown command: bogus/);
});

// --- version -------------------------------------------------------------
test('`webjs version`, `--version`, and `-v` print the CLI version', async () => {
  const { readFile } = await import('node:fs/promises');
  const pkg = JSON.parse(await readFile(resolve(REPO, 'packages', 'cli', 'package.json'), 'utf8'));
  for (const form of [['version'], ['--version'], ['-v']]) {
    const r = cli(...form);
    assert.equal(r.status, 0, `${form.join(' ')}: ${r.stderr}`);
    assert.equal(r.stdout.trim(), pkg.version, `${form.join(' ')} prints ${pkg.version}`);
  }
});

test('bare `webjs help` prints the full USAGE banner', () => {
  const r = help();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /webjs commands:/);
  assert.match(r.stdout, /webjs routes/);
});

test('`webjs help routes` prints usage + summary + an Options table + examples', () => {
  const r = help('routes');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Usage: webjs routes /m);
  // The Options section documents each flag (Remix-CLI parity), incl. --no-headers
  // and a universal -h, --help row.
  assert.match(r.stdout, /^Options:/m);
  assert.match(r.stdout, /^ {2}--json\s+Emit/m);
  assert.match(r.stdout, /^ {2}--no-headers\s+/m);
  assert.match(r.stdout, /^ {2}-h, --help\s+Show this help\./m);
  assert.match(r.stdout, /^Examples:/m);
  assert.match(r.stdout, /webjs routes --json/);
});

test('a passthrough command\'s help says -h/--help forwards to the wrapped tool', () => {
  // `webjs help typecheck` must NOT claim "-h, --help  Show this help." because
  // typecheck --help actually forwards to tsc. The row is worded accordingly.
  const tc = help('typecheck');
  assert.match(tc.stdout, /-h, --help\s+Forwarded to tsc/);
  const db = help('db');
  assert.match(db.stdout, /-h, --help\s+Forwarded to drizzle-kit/);
  // A non-passthrough command keeps the generic wording.
  const routes = help('routes');
  assert.match(routes.stdout, /-h, --help\s+Show this help\./);
});

test('`webjs help doctor` documents --json and --strict', () => {
  const r = help('doctor');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Usage: webjs doctor \[--json\] \[--strict\]/);
  assert.match(r.stdout, /webjs doctor --strict/);
  assert.match(r.stdout, /webjs doctor --json/);
});

// Per-check severity is CONFIG, not a flag (#1257), so the usage line stays
// exactly as it was and the gate is documented in its own Config section. An
// agent reading only this help must be able to write a valid gate block.
test('`webjs help doctor` documents the package.json severity gate', () => {
  const r = help('doctor');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Config:/m);
  assert.match(r.stdout, /"webjs": \{ "doctor": \{ "gate"/);
  assert.match(r.stdout, /"off" \| "warn" \| "error"/);
  // The gate adds no flag, so the usage line is unchanged.
  assert.match(r.stdout, /^Usage: webjs doctor \[--json\] \[--strict\]$/m);
});

test('`webjs help <unknown>` exits non-zero with an error (Remix CLI parity)', () => {
  const r = help('bogus');
  assert.equal(r.status, 1, 'an unknown help topic is an error, not a silent success');
  assert.match(r.stderr, /Unknown help topic "bogus"/);
  // Still prints the banner (to stderr) so the caller sees the real commands.
  assert.match(r.stderr, /webjs commands:/);
});

// Drift guard: every command in the HELP map must carry a usage + at least one
// example. Reads the HELP object literal out of the CLI source so a new command
// added without an example reds this test.
test('every HELP entry has a usage line and at least one example', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(CLI, 'utf8');
  const start = src.indexOf('const HELP = {');
  assert.ok(start >= 0, 'HELP map is present in the CLI');
  // Slice out the object literal up to the printCommandHelp function.
  const end = src.indexOf('function printCommandHelp', start);
  const block = src.slice(start, end);
  // Each top-level command entry looks like `  name: {` at two-space indent.
  const commands = [...block.matchAll(/^ {2}([a-z]+): \{/gm)].map((m) => m[1]);
  assert.ok(commands.length >= 10, `found the HELP commands (${commands.length})`);
  for (const cmd of commands) {
    const r = help(cmd);
    assert.match(r.stdout, /^Usage: /m, `${cmd} shows a usage line`);
    assert.match(r.stdout, /^Examples:/m, `${cmd} shows an Examples block`);
    // At least one example line under Examples (indented, non-empty).
    const after = r.stdout.split('Examples:')[1] || '';
    assert.match(after, /\n {2}\S/, `${cmd} lists at least one example`);
  }
});
