/**
 * Unit tests for the pure app-name validator (#1066).
 *
 * The scaffold interpolates the app name into generated source as a
 * template-literal value, so a name carrying a quote, a backtick, or a `${`
 * emits a file that fails to parse. These tests pin the rule itself; the
 * boundary tests (CLI + `scaffoldApp`) live in
 * `test/scaffolds/scaffold-template-validation.test.js`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkAppName,
  assertValidAppName,
  appNameErrorMessage,
  APP_NAME_MAX_LENGTH,
  APP_NAME_SHAPE,
  toDatabaseName,
  DB_NAME_MAX_LENGTH,
} from '../../lib/app-name.js';

/**
 * The names the accept-list above declares valid, hoisted so the database-name
 * shape property can run over exactly that corpus.
 */
const VALID_NAMES = [
  'my-app',
  'myapp',
  'my_app',
  'my.app',
  'app2',
  '2app',
  'a',
  'a'.repeat(APP_NAME_MAX_LENGTH),
  'MyApp',
  'TaskFlow',
  'My_App.v2',
];

// Uppercase is deliberately allowed in `VALID_NAMES`. It never broke a
// generated file, the scaffold's package.json is private so the name is never
// published, and `webjs create MyApp` worked before this guard existed.
test('accepts every name the rule allows', () => {
  for (const name of VALID_NAMES) {
    assert.equal(checkAppName(name).ok, true, `${name} should be accepted`);
    assert.equal(assertValidAppName(name), name);
  }
});

test('rejects the characters that break generated source', () => {
  // Each of these lands inside a template literal in the emitted app/page.ts
  // and the emitted package.json, so each one is a syntax error downstream.
  for (const [name, offender] of [
    ["bad'name", "'"],
    ['bad`name', '`'],
    ['bad${name}', '$'],
    ['bad\\name', '\\'],
    ['bad"name', '"'],
    ['bad name', ' '],
    ['bad/name', '/'],
    ['bad\nname', undefined],
  ]) {
    const result = checkAppName(name);
    assert.equal(result.ok, false, `${JSON.stringify(name)} should be rejected`);
    if (offender) {
      assert.match(
        result.reason,
        new RegExp(offender.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `the reason should name the offending character for ${JSON.stringify(name)}`,
      );
    }
  }
});

test('a control character is named by code point, not printed raw', () => {
  const result = checkAppName('bad\x01name');
  assert.equal(result.ok, false);
  assert.match(result.reason, /U\+0001/);
  assert.ok(!result.reason.includes('\x01'), 'the raw control byte is not echoed back');
});

test('a reserved name is refused whatever its case', () => {
  // The name is also a directory, so `Node_Modules` collides with
  // `node_modules` on a case-insensitive filesystem.
  for (const name of ['node_modules', 'NODE_MODULES', 'Node_Modules', 'Favicon.ICO']) {
    assert.equal(checkAppName(name).ok, false, `${name} should be rejected`);
    assert.match(checkAppName(name).reason, /reserved/);
  }
});

test('rejects empty, whitespace-padded, over-long, and reserved names', () => {
  assert.match(checkAppName('').reason, /empty/);
  // A non-string is NOT empty, and saying so misleads the programmatic caller
  // who is debugging their own argument.
  assert.match(checkAppName(undefined).reason, /must be a string.*undefined/);
  assert.match(checkAppName(123).reason, /must be a string.*number/);
  assert.match(checkAppName({}).reason, /must be a string.*object/);
  assert.match(checkAppName(' my-app').reason, /whitespace/);
  assert.match(checkAppName('my-app ').reason, /whitespace/);
  const tooLong = checkAppName('a'.repeat(APP_NAME_MAX_LENGTH + 1));
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.reason, new RegExp(String(APP_NAME_MAX_LENGTH)));
  assert.match(checkAppName('node_modules').reason, /reserved/);
  assert.match(checkAppName('favicon.ico').reason, /reserved/);
});

test('rejects a leading dot or underscore', () => {
  assert.match(checkAppName('.hidden').reason, /cannot start with '\.'/);
  assert.match(checkAppName('_private').reason, /cannot start with '_'/);
  // A leading quote is a bad CHARACTER, not a bad separator, so the message
  // should point at the quote.
  assert.match(checkAppName("'quoted").reason, /not allowed/);
});

test('assertValidAppName throws a single-line message carrying the rule', () => {
  assert.throws(
    () => assertValidAppName("bad'name"),
    (err) => {
      assert.match(err.message, /Invalid app name 'bad'name'/);
      assert.ok(!err.message.includes('\n'), 'the thrown message stays single-line');
      assert.ok(err.message.includes(APP_NAME_SHAPE), 'the thrown message states the allowed shape');
      return true;
    },
  );
});

test('the single-line contract holds for the one input that can break it', () => {
  // A newline-bearing name is REJECTED by checkAppName, so it is exactly the
  // input that reaches the thrown message. Interpolating it raw made the Error
  // multi-line, contradicting the contract this function documents.
  for (const name of ['bad\nname', 'bad\r\nname', 'a\u2028b', 'a\u2029b']) {
    assert.throws(() => assertValidAppName(name), (err) => {
      // `split('\n')` does NOT see U+2028 / U+2029, which are JS
      // LineTerminators too, so testing that way makes those two cases no-ops.
      // Assert on every line terminator, and on the escaped form landing.
      assert.ok(
        !/[\n\r\u2028\u2029]/.test(err.message),
        `line terminator survived for ${JSON.stringify(name)}: ${JSON.stringify(err.message)}`,
      );
      assert.match(err.message, /<U\+[0-9A-F]{4}>/);
      return true;
    });
  }
});

test('C1 controls are escaped too, not just C0', () => {
  // An 8-bit terminal reads U+0080 to U+009F as control functions, so they are
  // no safer to echo than the C0 range.
  for (const name of ['bad\u0080name', 'bad\u009bname']) {
    const rendered = appNameErrorMessage(name, checkAppName(name).reason);
    assert.ok(!/[\u0080-\u009f]/.test(rendered), `raw C1 survived: ${JSON.stringify(rendered)}`);
    assert.match(rendered, /<U\+00[89][0-9A-F]>/);
  }
});

test('the reserved names the code refuses are named in the guidance', () => {
  // Both satisfy every other stated condition, so a reader who only had the
  // shape would conclude they are legal.
  for (const name of ['node_modules', 'favicon.ico']) {
    const r = checkAppName(name);
    assert.equal(r.ok, false);
    const msg = appNameErrorMessage(name, r.reason);
    assert.match(msg, /node_modules/);
    assert.match(msg, /favicon\.ico/);
    assert.match(msg, /reserve/);
  }
});

test('a rejected name is never echoed back with its raw control bytes', () => {
  // Both renderers print the name into a terminal. A name of `\x1b[31m...`
  // would replay the escape and repaint the user's shell, so the sanitizer has
  // to run on the RENDERED message, not only on the per-character reason.
  for (const name of ['bad\x01name', 'bad\x1b[31mname', 'bad\nname']) {
    const rendered = appNameErrorMessage(name, checkAppName(name).reason);
    let thrown = '';
    try { assertValidAppName(name); } catch (err) { thrown = err.message; }
    for (const surface of [rendered, thrown]) {
      assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f]/.test(surface.replace(/\n/g, ' ')),
        `raw control byte survived into: ${JSON.stringify(surface)}`);
    }
    assert.ok(!thrown.includes('\x1b'), 'no ANSI escape in the thrown message');
  }
  assert.match(appNameErrorMessage('bad\x01name', 'x'), /<U\+0001>/);
});

test('a maximally long name cannot blow out the message width', () => {
  // 215 characters is a REJECTED length, so it reaches the renderer. Echoing it
  // whole produced a ~240-column first line.
  const long = 'a'.repeat(APP_NAME_MAX_LENGTH + 1);
  const msg = appNameErrorMessage(long, checkAppName(long).reason);
  for (const line of msg.split('\n')) {
    assert.ok(line.length <= 80, `message line too long (${line.length}): ${line}`);
  }
  // The invariant is that the message does NOT grow with the input, which a
  // fixed character budget only tests by coincidence (it broke the moment the
  // shape sentence gained a clause). A 215-char and a 5000-char name must
  // render the same length, because the name is capped either way.
  const huge = 'a'.repeat(5000);
  const msgOf = (n) => { try { assertValidAppName(n); return ''; } catch (e) { return e.message; } };
  assert.equal(
    msgOf(huge).length - String(huge.length).length,
    msgOf(long).length - String(long.length).length,
    'the thrown message length must not scale with the name length',
  );
});

test('rejects a leading separator, matching the shape the message states', () => {
  // The message claims "starting with a letter or a digit". A leading hyphen
  // passed, so the CLI printed a rule it did not enforce.
  for (const name of ['-app', '-', '--', '.app', '_app', '-App', '.MyApp']) {
    const r = checkAppName(name);
    assert.equal(r.ok, false, `${JSON.stringify(name)} should be rejected`);
    assert.match(r.reason, /cannot start with/);
  }
  // A digit or letter start is still fine, including a name that is all digits.
  for (const name of ['2app', 'a', '9', 'A', 'MyApp']) assert.equal(checkAppName(name).ok, true, name);
});

test('appNameErrorMessage names the input, the problem, and the shape', () => {
  const result = checkAppName('bad`name');
  const msg = appNameErrorMessage('bad`name', result.reason);
  assert.match(msg, /invalid app name "bad`name"/);
  assert.match(msg, /`/);
  assert.match(msg, /letters and digits/);
  assert.match(msg, new RegExp(String(APP_NAME_MAX_LENGTH)));
  assert.match(msg, /webjs create my-app/);
  // No line runs past a narrow terminal, since this is the first thing a user
  // sees after a typo.
  for (const line of msg.split('\n')) {
    assert.ok(line.length <= 80, `message line too long: ${line}`);
  }
});

test('an offending quote is not printed as an unreadable triple quote', () => {
  // `'` wrapped in `'` renders as `'''`, which reads as nothing at all.
  assert.match(checkAppName("bad'name").reason, /"'" is not allowed/);
  assert.match(checkAppName('bad"name').reason, /'"' is not allowed/);
  assert.match(checkAppName('bad name').reason, /a space is not allowed/);
});

test('derives a fold-stable postgres database name from the app name', () => {
  // `MyApp` is the headline bug: the emitted URL used to keep the capitals,
  // while `CREATE DATABASE MyApp;` folds to `myapp`, so the URL named a
  // database that did not exist.
  for (const [input, expected] of [
    ['MyApp', 'myapp'],
    // No camel split. Rails splits here, but the goal is the name PostgreSQL
    // itself folds to, and a separator PostgreSQL would not insert is a
    // mismatch in the opposite direction.
    ['TaskFlow', 'taskflow'],
    ['My.App-2', 'my_app_2'],
    ['My_App.v2', 'my_app_v2'],
    ['my_app', 'my_app'],
    // Byte-identical to the output before the fix: the no-regression case.
    ['my-pg', 'my_pg'],
    // An unquoted PostgreSQL identifier may not start with a digit.
    ['2app', '_2app'],
  ]) {
    assert.equal(toDatabaseName(input), expected, `${input} should derive ${expected}`);
  }
});

test('caps the derived database name at the postgres identifier limit', () => {
  assert.equal(DB_NAME_MAX_LENGTH, 63);
  assert.equal(toDatabaseName('a'.repeat(APP_NAME_MAX_LENGTH)).length, DB_NAME_MAX_LENGTH);
  // The fold runs BEFORE the slice, so every character reaching the cap is one
  // ASCII byte and a code-unit slice is a byte slice.
  const upper = toDatabaseName('A'.repeat(APP_NAME_MAX_LENGTH));
  assert.equal(upper.length, DB_NAME_MAX_LENGTH);
  assert.equal(upper, 'a'.repeat(DB_NAME_MAX_LENGTH));
  // The digit prefix is applied BEFORE the slice, so the cap governs the final
  // string rather than being exceeded by one.
  const prefixed = toDatabaseName('2' + 'a'.repeat(APP_NAME_MAX_LENGTH - 1));
  assert.equal(prefixed.length, DB_NAME_MAX_LENGTH);
  assert.ok(prefixed.startsWith('_2'));
});

test('the derived database name is idempotent and always a legal identifier', () => {
  for (const name of [...VALID_NAMES, 'My.App-2', 'MyApp', '2app']) {
    const derived = toDatabaseName(name);
    assert.equal(toDatabaseName(derived), derived, `${name} should be idempotent`);
    // The executable form of the "an empty result is unreachable" argument: a
    // validated name's first character is [A-Za-z0-9], which folds into the
    // class and survives, so there is no empty-result fallback branch.
    assert.ok(derived.length > 0, `${name} should derive a non-empty name`);
    assert.match(derived, /^[a-z_][a-z0-9_]*$/);
  }
});
