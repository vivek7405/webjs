import { test } from 'node:test';
import assert from 'node:assert/strict';

import { registerClient, broadcast, clientCount } from '../packages/server/src/broadcast.js';

/** Create a mock WebSocket object. */
function mockWs() {
  const listeners = {};
  return {
    readyState: 1,
    sent: [],
    send(data) { this.sent.push(data); },
    on(event, cb) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    },
    _emit(event) {
      for (const cb of (listeners[event] || [])) cb();
    },
  };
}

test('registerClient adds client to path', () => {
  const ws = mockWs();
  registerClient('/test/reg', ws);
  assert.equal(clientCount('/test/reg'), 1);
  // Cleanup
  ws._emit('close');
});

test('broadcast sends to all clients on path', () => {
  const ws1 = mockWs();
  const ws2 = mockWs();
  registerClient('/test/bcast', ws1);
  registerClient('/test/bcast', ws2);
  broadcast('/test/bcast', 'hello');
  assert.deepEqual(ws1.sent, ['hello']);
  assert.deepEqual(ws2.sent, ['hello']);
  // Cleanup
  ws1._emit('close');
  ws2._emit('close');
});

test('broadcast with except skips sender', () => {
  const sender = mockWs();
  const other = mockWs();
  registerClient('/test/except', sender);
  registerClient('/test/except', other);
  broadcast('/test/except', 'msg', { except: sender });
  assert.deepEqual(sender.sent, []);
  assert.deepEqual(other.sent, ['msg']);
  // Cleanup
  sender._emit('close');
  other._emit('close');
});

test('broadcast skips clients with non-open readyState', () => {
  const ws = mockWs();
  ws.readyState = 3; // CLOSED
  registerClient('/test/closed', ws);
  broadcast('/test/closed', 'data');
  assert.deepEqual(ws.sent, []);
  ws._emit('close');
});

test('clientCount returns correct number', () => {
  const ws1 = mockWs();
  const ws2 = mockWs();
  const ws3 = mockWs();
  registerClient('/test/count', ws1);
  registerClient('/test/count', ws2);
  registerClient('/test/count', ws3);
  assert.equal(clientCount('/test/count'), 3);
  ws1._emit('close');
  ws2._emit('close');
  ws3._emit('close');
});

test('clientCount returns 0 for unknown path', () => {
  assert.equal(clientCount('/no/such/path'), 0);
});

test('client removal on close decrements count', () => {
  const ws1 = mockWs();
  const ws2 = mockWs();
  registerClient('/test/rm', ws1);
  registerClient('/test/rm', ws2);
  assert.equal(clientCount('/test/rm'), 2);
  ws1._emit('close');
  assert.equal(clientCount('/test/rm'), 1);
  ws2._emit('close');
  assert.equal(clientCount('/test/rm'), 0);
});

test('broadcast to nonexistent path does nothing', () => {
  // Should not throw
  broadcast('/nobody/here', 'hello');
});
