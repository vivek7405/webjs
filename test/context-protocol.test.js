import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createContext,
  ContextRequestEvent,
  ContextProvider,
  ContextConsumer,
} from '../packages/core/src/context.js';

// ---------------------------------------------------------------------------
// Helpers — mock host that simulates a WebComponent with EventTarget
// ---------------------------------------------------------------------------

function createMockHost() {
  const target = new EventTarget();
  const controllers = [];
  let updateCount = 0;

  const host = {
    addEventListener: (type, fn, opts) => target.addEventListener(type, fn, opts),
    removeEventListener: (type, fn, opts) => target.removeEventListener(type, fn, opts),
    dispatchEvent: (e) => target.dispatchEvent(e),
    isConnected: true,
    requestUpdate() { updateCount++; },
    addController(c) { controllers.push(c); },
  };

  return { host, controllers, getUpdateCount: () => updateCount };
}

// ---------------------------------------------------------------------------
// createContext
// ---------------------------------------------------------------------------

test('createContext: returns object with name', () => {
  const ctx = createContext('theme');
  assert.equal(ctx.name, 'theme');
  assert.ok(ctx.__context__);
});

test('createContext: different calls return different objects', () => {
  const a = createContext('theme');
  const b = createContext('theme');
  assert.notEqual(a, b);
});

// ---------------------------------------------------------------------------
// ContextRequestEvent
// ---------------------------------------------------------------------------

test('ContextRequestEvent: has correct type, bubbles, and composed', () => {
  const ctx = createContext('test');
  const cb = () => {};
  const evt = new ContextRequestEvent(ctx, cb, true);

  assert.equal(evt.type, 'context-request');
  assert.equal(evt.bubbles, true);
  assert.equal(evt.composed, true);
  assert.equal(evt.context, ctx);
  assert.equal(evt.callback, cb);
  assert.equal(evt.subscribe, true);
});

test('ContextRequestEvent: subscribe defaults to false', () => {
  const ctx = createContext('test');
  const evt = new ContextRequestEvent(ctx, () => {});
  assert.equal(evt.subscribe, false);
});

// ---------------------------------------------------------------------------
// ContextProvider
// ---------------------------------------------------------------------------

test('ContextProvider: responds to context-request with value', () => {
  const { host } = createMockHost();
  const ctx = createContext('color');
  const provider = new ContextProvider(host, { context: ctx, initialValue: 'red' });

  // Simulate hostConnected — starts listening.
  provider.hostConnected();

  let received;
  const event = new ContextRequestEvent(ctx, (value) => { received = value; });
  host.dispatchEvent(event);

  assert.equal(received, 'red');
  assert.equal(provider.value, 'red');

  provider.hostDisconnected();
});

test('ContextProvider: ignores requests for a different context', () => {
  const { host } = createMockHost();
  const ctxA = createContext('a');
  const ctxB = createContext('b');
  const provider = new ContextProvider(host, { context: ctxA, initialValue: 42 });
  provider.hostConnected();

  let received;
  const event = new ContextRequestEvent(ctxB, (value) => { received = value; });
  host.dispatchEvent(event);

  assert.equal(received, undefined);
  provider.hostDisconnected();
});

test('ContextProvider: setValue notifies subscribers', () => {
  const { host } = createMockHost();
  const ctx = createContext('count');
  const provider = new ContextProvider(host, { context: ctx, initialValue: 0 });
  provider.hostConnected();

  const values = [];
  const event = new ContextRequestEvent(ctx, (value) => { values.push(value); }, true);
  host.dispatchEvent(event);

  assert.deepEqual(values, [0]);

  provider.setValue(1);
  assert.deepEqual(values, [0, 1]);

  provider.setValue(2);
  assert.deepEqual(values, [0, 1, 2]);

  provider.hostDisconnected();
});

test('ContextProvider: setValue with same value is a no-op', () => {
  const { host } = createMockHost();
  const ctx = createContext('val');
  const provider = new ContextProvider(host, { context: ctx, initialValue: 'x' });
  provider.hostConnected();

  const values = [];
  const event = new ContextRequestEvent(ctx, (v) => { values.push(v); }, true);
  host.dispatchEvent(event);

  provider.setValue('x'); // same value — should not notify
  assert.deepEqual(values, ['x']);

  provider.hostDisconnected();
});

test('ContextProvider: subscriber can unsubscribe', () => {
  const { host } = createMockHost();
  const ctx = createContext('unsub');
  const provider = new ContextProvider(host, { context: ctx, initialValue: 'a' });
  provider.hostConnected();

  const values = [];
  let unsub;
  const event = new ContextRequestEvent(ctx, (value, unsubscribe) => {
    values.push(value);
    unsub = unsubscribe;
  }, true);
  host.dispatchEvent(event);

  assert.deepEqual(values, ['a']);

  unsub();
  provider.setValue('b');
  // After unsubscribe, no new values should arrive.
  assert.deepEqual(values, ['a']);

  provider.hostDisconnected();
});

// ---------------------------------------------------------------------------
// ContextConsumer
// ---------------------------------------------------------------------------

test('ContextConsumer: dispatches context-request on hostConnected', () => {
  const { host } = createMockHost();
  const ctx = createContext('theme');

  // Set up a provider first.
  const provider = new ContextProvider(host, { context: ctx, initialValue: 'dark' });
  provider.hostConnected();

  // Create consumer on the same host (in a real app it would be a descendant).
  const consumer = new ContextConsumer(host, { context: ctx, subscribe: true });
  consumer.hostConnected();

  assert.equal(consumer.value, 'dark');

  provider.hostDisconnected();
  consumer.hostDisconnected();
});

test('ContextConsumer: receives updated value when provider calls setValue', () => {
  const { host, getUpdateCount } = createMockHost();
  const ctx = createContext('lang');

  const provider = new ContextProvider(host, { context: ctx, initialValue: 'en' });
  provider.hostConnected();

  const consumer = new ContextConsumer(host, { context: ctx, subscribe: true });
  consumer.hostConnected();

  assert.equal(consumer.value, 'en');
  const beforeCount = getUpdateCount();

  provider.setValue('fr');
  assert.equal(consumer.value, 'fr');
  assert.ok(getUpdateCount() > beforeCount, 'requestUpdate should have been called');

  provider.hostDisconnected();
  consumer.hostDisconnected();
});

test('ContextConsumer: hostDisconnected unsubscribes', () => {
  const { host, getUpdateCount } = createMockHost();
  const ctx = createContext('size');

  const provider = new ContextProvider(host, { context: ctx, initialValue: 10 });
  provider.hostConnected();

  const consumer = new ContextConsumer(host, { context: ctx, subscribe: true });
  consumer.hostConnected();

  assert.equal(consumer.value, 10);

  consumer.hostDisconnected();
  const countAfterDisconnect = getUpdateCount();

  provider.setValue(20);
  // Consumer should not have been updated after disconnecting.
  assert.equal(consumer.value, 10);
  assert.equal(getUpdateCount(), countAfterDisconnect);

  provider.hostDisconnected();
});

test('ContextConsumer: subscribe false does a one-shot read', () => {
  const { host } = createMockHost();
  const ctx = createContext('once');

  const provider = new ContextProvider(host, { context: ctx, initialValue: 'snap' });
  provider.hostConnected();

  const consumer = new ContextConsumer(host, { context: ctx, subscribe: false });
  consumer.hostConnected();

  assert.equal(consumer.value, 'snap');

  provider.setValue('changed');
  // Non-subscribing consumer should not receive updates.
  assert.equal(consumer.value, 'snap');

  provider.hostDisconnected();
});
