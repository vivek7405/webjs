import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimistic } from '../../src/optimistic.js';

// Mock component host
class MockHost {
  constructor() {
    this.updateCount = 0;
    this.controllers = [];
  }
  requestUpdate() {
    this.updateCount++;
  }
  addController(c) {
    this.controllers.push(c);
  }
  removeController(c) {
    this.controllers = this.controllers.filter(x => x !== c);
  }
}

test('declarative optimistic: tracks source value initially', () => {
  const host = new MockHost();
  let todos = ['a', 'b'];
  const opt = optimistic(host, {
    source: () => todos,
    update: (state, payload) => [...state, payload],
  });

  assert.deepEqual(opt.value, ['a', 'b']);
  assert.equal(host.updateCount, 0);
});

test('declarative optimistic: manual add and release cycles', () => {
  const host = new MockHost();
  let todos = ['a', 'b'];
  const opt = optimistic(host, {
    source: () => todos,
    update: (state, payload) => [...state, payload],
  });

  const release = opt.add('c');
  assert.deepEqual(opt.value, ['a', 'b', 'c']);
  assert.equal(host.updateCount, 1, 'schedules render on add');

  // source state updates in the background
  todos = ['a', 'b', 'real-c'];

  release();
  assert.deepEqual(opt.value, ['a', 'b', 'real-c'], 'reverts to new source state after release');
  assert.equal(host.updateCount, 2, 'schedules render on release');
});

test('declarative optimistic: default reducer replaces state directly', () => {
  const host = new MockHost();
  let count = 0;
  const opt = optimistic(host, {
    source: () => count,
  });

  assert.equal(opt.value, 0);
  const release = opt.add(42);
  assert.equal(opt.value, 42);

  count = 1;
  release();
  assert.equal(opt.value, 1);
});

test('declarative optimistic: auto-releases when a Promise resolves', async () => {
  const host = new MockHost();
  let todos = ['a', 'b'];
  const opt = optimistic(host, {
    source: () => todos,
    update: (state, payload) => [...state, payload],
  });

  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  opt.add('c', promise);
  assert.deepEqual(opt.value, ['a', 'b', 'c']);
  assert.equal(host.updateCount, 1);

  // simulate server action completing and source state updating
  todos = ['a', 'b', 'real-c'];
  resolvePromise({ success: true });

  await promise;
  // wait for microtask tick for .finally() to execute
  await new Promise(r => setTimeout(r, 0));

  assert.deepEqual(opt.value, ['a', 'b', 'real-c'], 'auto-reverted once promise resolved');
  assert.equal(host.updateCount, 2);
});

test('declarative optimistic: auto-releases when a Promise rejects', async () => {
  const host = new MockHost();
  let todos = ['a', 'b'];
  const opt = optimistic(host, {
    source: () => todos,
    update: (state, payload) => [...state, payload],
  });

  let rejectPromise;
  const promise = new Promise((_, reject) => {
    rejectPromise = reject;
  });

  opt.add('c', promise);
  assert.deepEqual(opt.value, ['a', 'b', 'c']);

  rejectPromise(new Error('fail'));

  await promise.catch(() => {});
  await new Promise(r => setTimeout(r, 0));

  assert.deepEqual(opt.value, ['a', 'b'], 'reverted after promise rejection');
  assert.equal(host.updateCount, 2);
});

test('declarative optimistic: concurrent updates fold in order', () => {
  const host = new MockHost();
  let todos = ['a'];
  const opt = optimistic(host, {
    source: () => todos,
    update: (state, payload) => [...state, payload],
  });

  const r1 = opt.add('b');
  const r2 = opt.add('c');

  assert.deepEqual(opt.value, ['a', 'b', 'c'], 'both updates applied');
  assert.equal(host.updateCount, 2);

  r1();
  assert.deepEqual(opt.value, ['a', 'c'], 'first update released, second remains');
  assert.equal(host.updateCount, 3);

  r2();
  assert.deepEqual(opt.value, ['a'], 'all updates released');
  assert.equal(host.updateCount, 4);
});

test('declarative optimistic: handles host lacking requestUpdate method', () => {
  const host = {}; // no requestUpdate method
  let val = 'a';
  const opt = optimistic(host, { source: () => val });

  assert.equal(opt.value, 'a');
  const release = opt.add('b');
  assert.equal(opt.value, 'b');

  release();
  assert.equal(opt.value, 'a');
});

test('declarative optimistic: handles thenables lacking finally method', async () => {
  const host = new MockHost();
  let val = 'a';
  const opt = optimistic(host, { source: () => val });

  // Custom thenable without finally
  let resolveThenable;
  const thenable = {
    then(onFulfilled, onRejected) {
      return new Promise((resolve) => {
        resolveThenable = resolve;
      }).then(onFulfilled, onRejected);
    }
  };

  opt.add('b', thenable);
  assert.equal(opt.value, 'b');

  resolveThenable();
  // wait for microtasks
  await new Promise(r => setTimeout(r, 0));

  assert.equal(opt.value, 'a', 'auto-released using fallback then()');
});


// The reducer runs on EVERY `.value` read, not once per `.add()`, so a reducer
// that MINTS a value hands the pending row a different one on each render. The
// canonical docs snippets used to do exactly that (`crypto.randomUUID()` inside
// `update`), which silently breaks a keyed list: `repeat(todos, t => t.id, ...)`
// sees a brand-new key every update and rebuilds the row, losing focus, any
// in-progress transition, and DOM state. These pin the RUNTIME fact the docs
// now rely on (the reducer re-runs per read); the doc snippets themselves have
// no test coverage, so a doc revert would not red these.
test('declarative optimistic: .value is stable across repeated reads for one queued update', () => {
  const host = new MockHost();
  const todos = [{ id: 'real-1', title: 'existing' }];
  const opt = optimistic(host, {
    source: () => todos,
    // PURE: everything comes off the payload.
    update: (state, add) => [...state, { id: add.tempId, title: add.title, pending: true }],
  });

  opt.add({ tempId: 'tmp-abc', title: 'new' });

  const first = opt.value;
  const second = opt.value;
  const third = opt.value;

  assert.equal(first.at(-1).id, 'tmp-abc');
  assert.equal(second.at(-1).id, first.at(-1).id, 'a second read must not change the pending id');
  assert.equal(third.at(-1).id, first.at(-1).id, 'a third read must not change the pending id');
  // The confirmed rows are untouched by the overlay on every read.
  assert.equal(second[0].id, 'real-1');
});

test('declarative optimistic: a minting reducer is what instability looks like', () => {
  const host = new MockHost();
  let n = 0;
  const opt = optimistic(host, {
    source: () => [],
    // IMPURE, the shape the docs must never teach: a fresh id per read.
    update: (state, title) => [...state, { id: `minted-${++n}`, title }],
  });

  opt.add('new');

  assert.notEqual(
    opt.value.at(-1).id,
    opt.value.at(-1).id,
    'a minting reducer yields a different id on each read, which is the bug the pure shape avoids',
  );
});

test('declarative optimistic: two concurrent adds get distinct ids from their payloads', () => {
  const host = new MockHost();
  const opt = optimistic(host, {
    source: () => [],
    update: (state, add) => [...state, { id: add.tempId, title: add.title }],
  });

  // The old `{ id: 'tmp' }` snippet gave both pending rows the SAME id. Queue
  // stacking and release survive that (`add()` keys its entry on an internal
  // `opt-N`, never on the row's id), so what breaks is downstream: a keyed
  // list, a handler capturing the id, an `aria-activedescendant`, a selector.
  const releaseFirst = opt.add({ tempId: 'tmp-1', title: 'first' });
  opt.add({ tempId: 'tmp-2', title: 'second' });

  // Both queued updates must fold, so a payload-derived id yields two rows.
  // Under the old hardcoded `{ id: 'tmp' }` the SAME two folds produced two
  // rows sharing one id, which is what broke keyed rendering downstream.
  assert.equal(opt.value.length, 2, 'both queued updates must fold into .value');
  assert.equal(new Set(opt.value.map(t => t.id)).size, 2, 'concurrent pending rows must not share an id');

  // Releasing the FIRST must drop only its row, which is what proves the queue
  // is keyed independently of whatever id the reducer wrote.
  releaseFirst();
  assert.deepEqual(opt.value.map(t => t.title), ['second']);
});
