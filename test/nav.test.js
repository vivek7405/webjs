import { test } from 'node:test';
import assert from 'node:assert/strict';

import { notFound, redirect, isNotFound, isRedirect } from '../packages/core/src/nav.js';

test('notFound throws an error with the sentinel', () => {
  try {
    notFound();
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(isNotFound(e));
    assert.equal(isRedirect(e), false);
  }
});

test('redirect throws an error with URL and default status', () => {
  try {
    redirect('/login');
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(isRedirect(e));
    assert.equal(e.url, '/login');
    assert.equal(e.status, 307);
    assert.equal(isNotFound(e), false);
  }
});

test('redirect accepts custom status code', () => {
  try {
    redirect('/new-url', 308);
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(isRedirect(e));
    assert.equal(e.status, 308);
  }
});

test('isNotFound returns false for plain errors', () => {
  assert.equal(isNotFound(new Error('nope')), false);
  assert.equal(isNotFound(null), false);
  assert.equal(isNotFound(undefined), false);
  assert.equal(isNotFound(42), false);
});

test('isRedirect returns false for plain errors', () => {
  assert.equal(isRedirect(new Error('nope')), false);
  assert.equal(isRedirect(null), false);
  assert.equal(isRedirect(undefined), false);
});

test('sentinels use Symbol.for so they match cross-realm', () => {
  // Manually create a sentinel matching the implementation
  const err = new Error('test');
  err.__webjs = Symbol.for('webjs.notFound');
  assert.ok(isNotFound(err));

  const err2 = new Error('test');
  err2.__webjs = Symbol.for('webjs.redirect');
  assert.ok(isRedirect(err2));
});
