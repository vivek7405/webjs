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
  assert.match(checkAppName(undefined).reason, /empty/);
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
