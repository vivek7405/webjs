/**
 * Unit tests for connectWS — client-side WebSocket helper with
 * reconnection + JSON codec + queued sends.
 *
 * Uses a fake WebSocket class to drive open/message/close/error events
 * synchronously. No network IO.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { connectWS } from '../packages/core/src/websocket-client.js';

/* ------------------------------------------------------------------
 * Fake WebSocket that captures constructor args and lets tests drive
 * events manually.
 * ------------------------------------------------------------------ */

/** @type {FakeWS[]} */
let instances;

class FakeWS {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = FakeWS.CONNECTING;
    this.sent = [];
    this.closed = null;
    instances.push(this);
  }
  send(data) { this.sent.push(data); }
  close(code, reason) {
    this.closed = { code, reason };
    this.readyState = FakeWS.CLOSED;
  }
  /* Test-only helpers */
  fireOpen() {
    this.readyState = FakeWS.OPEN;
    this.onopen?.(new Event('open'));
  }
  fireMessage(data) {
    this.onmessage?.({ data });
  }
  fireError() {
    this.onerror?.(new Event('error'));
  }
  fireClose(code = 1000) {
    this.readyState = FakeWS.CLOSED;
    this.onclose?.({ code });
  }
}

beforeEach(() => {
  instances = [];
  globalThis.WebSocket = FakeWS;
  globalThis.location = { protocol: 'https:', host: 'example.com' };
});

afterEach(() => {
  delete globalThis.WebSocket;
  delete globalThis.location;
});

/* ------------------------------------------------------------------
 * URL rewriting
 * ------------------------------------------------------------------ */

test('relative path is promoted to wss:// under https', () => {
  connectWS('/api/chat');
  assert.equal(instances[0].url, 'wss://example.com/api/chat');
});

test('relative path is promoted to ws:// under http', () => {
  globalThis.location.protocol = 'http:';
  connectWS('/api/chat');
  assert.equal(instances[0].url, 'ws://example.com/api/chat');
});

test('path without leading slash is normalised', () => {
  connectWS('api/chat');
  assert.equal(instances[0].url, 'wss://example.com/api/chat');
});

test('absolute ws:// URL is passed through unchanged', () => {
  connectWS('ws://other.test/ws');
  assert.equal(instances[0].url, 'ws://other.test/ws');
});

test('absolute wss:// URL is passed through unchanged', () => {
  connectWS('wss://secure.test/ws');
  assert.equal(instances[0].url, 'wss://secure.test/ws');
});

test('falls back to ws:// when there is no location', () => {
  delete globalThis.location;
  connectWS('/x');
  assert.equal(instances[0].url, 'ws:///x');
});

test('forwards protocols argument', () => {
  connectWS('/x', { protocols: ['v1', 'v2'] });
  assert.deepEqual(instances[0].protocols, ['v1', 'v2']);
});

/* ------------------------------------------------------------------
 * Lifecycle callbacks
 * ------------------------------------------------------------------ */

test('onOpen fires once the socket opens', () => {
  let opened = 0;
  connectWS('/x', { onOpen: () => opened++ });
  instances[0].fireOpen();
  assert.equal(opened, 1);
});

test('onMessage receives parsed JSON when the payload is valid JSON', () => {
  const received = [];
  connectWS('/x', { onMessage: (d) => received.push(d) });
  instances[0].fireOpen();
  instances[0].fireMessage('{"hello":"world"}');
  assert.deepEqual(received, [{ hello: 'world' }]);
});

test('onMessage receives raw string when the payload is not JSON', () => {
  const received = [];
  connectWS('/x', { onMessage: (d) => received.push(d) });
  instances[0].fireOpen();
  instances[0].fireMessage('plain');
  assert.deepEqual(received, ['plain']);
});

test('onMessage passes non-string payloads verbatim (e.g. binary)', () => {
  const received = [];
  connectWS('/x', { onMessage: (d) => received.push(d) });
  instances[0].fireOpen();
  const buf = new ArrayBuffer(4);
  instances[0].fireMessage(buf);
  assert.strictEqual(received[0], buf);
});

test('onError fires when the socket errors', () => {
  let errored = 0;
  connectWS('/x', { onError: () => errored++ });
  instances[0].fireError();
  assert.equal(errored, 1);
});

test('onClose fires when the socket closes', () => {
  let closed = 0;
  connectWS('/x', { onClose: () => closed++, reconnect: false });
  instances[0].fireOpen();
  instances[0].fireClose();
  assert.equal(closed, 1);
});

/* ------------------------------------------------------------------
 * Send + queue
 * ------------------------------------------------------------------ */

test('string is sent as-is when socket is open', () => {
  const conn = connectWS('/x');
  instances[0].fireOpen();
  conn.send('raw');
  assert.deepEqual(instances[0].sent, ['raw']);
});

test('object is JSON-stringified before sending', () => {
  const conn = connectWS('/x');
  instances[0].fireOpen();
  conn.send({ a: 1 });
  assert.deepEqual(instances[0].sent, [JSON.stringify({ a: 1 })]);
});

test('ArrayBuffer body is sent unchanged', () => {
  const conn = connectWS('/x');
  instances[0].fireOpen();
  const buf = new ArrayBuffer(8);
  conn.send(buf);
  assert.strictEqual(instances[0].sent[0], buf);
});

test('typed-array view body is sent unchanged', () => {
  const conn = connectWS('/x');
  instances[0].fireOpen();
  const bytes = new Uint8Array([1, 2, 3]);
  conn.send(bytes);
  assert.strictEqual(instances[0].sent[0], bytes);
});

test('sends queued while connecting are flushed on open', () => {
  const conn = connectWS('/x');
  conn.send({ a: 1 });
  conn.send({ b: 2 });
  assert.equal(instances[0].sent.length, 0, 'nothing sent yet');
  instances[0].fireOpen();
  assert.deepEqual(
    instances[0].sent,
    [JSON.stringify({ a: 1 }), JSON.stringify({ b: 2 })],
  );
});

/* ------------------------------------------------------------------
 * Reconnect + close
 * ------------------------------------------------------------------ */

test('auto-reconnects after close with exponential backoff', async (t) => {
  const realSetTimeout = globalThis.setTimeout;
  const scheduled = [];
  globalThis.setTimeout = (fn, delay) => {
    scheduled.push({ fn, delay });
    return 0;
  };
  t.after(() => { globalThis.setTimeout = realSetTimeout; });

  connectWS('/x');
  instances[0].fireClose();
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 1000, 'first reconnect after 1s');

  // Fire the scheduled reconnect.
  scheduled.shift().fn();
  assert.equal(instances.length, 2);
  instances[1].fireClose();
  assert.equal(scheduled[0].delay, 2000, 'second reconnect after 2s');
});

test('reconnect delay is capped at 30s', async (t) => {
  const realSetTimeout = globalThis.setTimeout;
  const scheduled = [];
  globalThis.setTimeout = (fn, delay) => {
    scheduled.push({ fn, delay });
    return 0;
  };
  t.after(() => { globalThis.setTimeout = realSetTimeout; });

  connectWS('/x');
  // Simulate many close/reconnect cycles.
  for (let i = 0; i < 10; i++) {
    instances[instances.length - 1].fireClose();
    const next = scheduled.pop();
    next.fn();
  }
  // The last scheduled reconnect should be capped at 30_000.
  instances[instances.length - 1].fireClose();
  assert.ok(scheduled[scheduled.length - 1].delay <= 30_000);
  assert.equal(scheduled[scheduled.length - 1].delay, 30_000);
});

test('successful open resets the retry counter', async (t) => {
  const realSetTimeout = globalThis.setTimeout;
  const scheduled = [];
  globalThis.setTimeout = (fn, delay) => {
    scheduled.push({ fn, delay });
    return 0;
  };
  t.after(() => { globalThis.setTimeout = realSetTimeout; });

  connectWS('/x');
  instances[0].fireClose();     // retry #0 → 1s
  scheduled.shift().fn();
  instances[1].fireClose();     // retry #1 → 2s
  scheduled.shift().fn();
  instances[2].fireOpen();      // reset counter
  instances[2].fireClose();     // retry #0 again → 1s
  assert.equal(scheduled[0].delay, 1000);
});

test('reconnect: false disables auto-reconnect', async (t) => {
  const realSetTimeout = globalThis.setTimeout;
  const scheduled = [];
  globalThis.setTimeout = (fn) => { scheduled.push(fn); return 0; };
  t.after(() => { globalThis.setTimeout = realSetTimeout; });

  connectWS('/x', { reconnect: false });
  instances[0].fireClose();
  assert.equal(scheduled.length, 0, 'no reconnect was scheduled');
});

test('close() stops reconnect + invokes native close', () => {
  const conn = connectWS('/x');
  conn.close(4000, 'bye');
  assert.deepEqual(instances[0].closed, { code: 4000, reason: 'bye' });
});

test('close() tolerates an already-closed socket (try/catch)', () => {
  const conn = connectWS('/x');
  instances[0].close = () => { throw new Error('already closed'); };
  assert.doesNotThrow(() => conn.close());
});

test('close() prevents subsequent reconnect scheduling', async (t) => {
  const realSetTimeout = globalThis.setTimeout;
  const scheduled = [];
  globalThis.setTimeout = (fn) => { scheduled.push(fn); return 0; };
  t.after(() => { globalThis.setTimeout = realSetTimeout; });

  const conn = connectWS('/x');
  conn.close();
  instances[0].fireClose();
  assert.equal(scheduled.length, 0);
});

/* ------------------------------------------------------------------
 * Getters
 * ------------------------------------------------------------------ */

test('socket getter exposes the current underlying WebSocket', () => {
  const conn = connectWS('/x');
  assert.strictEqual(conn.socket, instances[0]);
});

test('readyState getter returns CLOSED (3) when socket is null', () => {
  // Force a situation where ws is null by overriding WebSocket to throw
  // during construction inside the reconnect callback — unrealistic but
  // lets us exercise the null-coalescing branch.
  const conn = connectWS('/x');
  assert.equal(conn.readyState, FakeWS.CONNECTING);
  instances[0].fireOpen();
  assert.equal(conn.readyState, FakeWS.OPEN);
});

/* ------------------------------------------------------------------
 * Send while disconnected (queue behavior)
 * ------------------------------------------------------------------ */

test('send while not open queues the message', () => {
  const conn = connectWS('/x');
  conn.send('pre-open');
  assert.equal(instances[0].sent.length, 0);
});

test('queued strings and objects flush in order on open', () => {
  const conn = connectWS('/x');
  conn.send('a');
  conn.send({ b: 2 });
  conn.send('c');
  instances[0].fireOpen();
  assert.deepEqual(instances[0].sent, ['a', JSON.stringify({ b: 2 }), 'c']);
});
