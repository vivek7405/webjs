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
} from '../../lib/app-name.js';

test('accepts the names npm accepts', () => {
  for (const name of [
    'my-app',
    'myapp',
    'my_app',
    'my.app',
    'app2',
    '2app',
    'a',
    'a'.repeat(APP_NAME_MAX_LENGTH),
  ]) {
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

test('rejects uppercase with wording that says why', () => {
  const result = checkAppName('MyApp');
  assert.equal(result.ok, false);
  assert.match(result.reason, /uppercase/);
  assert.match(result.reason, /lowercase/);
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
  for (const name of ['bad\nname', 'bad\r\nname', 'a\u2028b']) {
    assert.throws(() => assertValidAppName(name), (err) => {
      assert.equal(err.message.split('\n').length, 1, `multi-line for ${JSON.stringify(name)}`);
      return true;
    });
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
  const thrown = (() => { try { assertValidAppName(long); } catch (e) { return e.message; } })();
  assert.ok(thrown.length < 300, `thrown message too long (${thrown.length})`);
});

test('rejects a leading separator, matching the shape the message states', () => {
  // The message claims "starting with a letter or a digit". A leading hyphen
  // passed, so the CLI printed a rule it did not enforce.
  for (const name of ['-app', '-', '--', '.app', '_app']) {
    const r = checkAppName(name);
    assert.equal(r.ok, false, `${JSON.stringify(name)} should be rejected`);
    assert.match(r.reason, /cannot start with/);
  }
  // A digit or letter start is still fine, including a name that is all digits.
  for (const name of ['2app', 'a', '9']) assert.equal(checkAppName(name).ok, true, name);
});

test('appNameErrorMessage names the input, the problem, and the shape', () => {
  const result = checkAppName('bad`name');
  const msg = appNameErrorMessage('bad`name', result.reason);
  assert.match(msg, /invalid app name "bad`name"/);
  assert.match(msg, /`/);
  assert.match(msg, /lowercase letters and digits/);
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
