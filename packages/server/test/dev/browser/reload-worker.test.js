/**
 * Real-browser tests for the dev live-reload SharedWorker relay (#887).
 *
 * `dev-reload-worker.js` is the BROWSER half of the shared live-reload
 * connection: the exact source the served worker inlines (`reloadWorkerJs` reads
 * this file, strips `export`, and appends the `startReloadWorker(...)` call), so
 * driving it here tests the code that ships. The headline acceptance ("one
 * shared connection fans every reload / error out to every tab, and a
 * late-joining tab still gets the current error") is browser-observable, so it
 * runs in a real browser. The relay is driven with a fake EventSource + fake
 * MessagePorts so it needs no live SSE server.
 */
import { startReloadWorker, RELOAD_QUIET_MS, RELOAD_MAX_HOLD_MS } from '../../../src/dev-reload-worker.js';

import { assert } from '../../../../../test/browser-assert.js';

class FakeEventSource {
  constructor(url) { this.url = url; this._l = {}; FakeEventSource.last = this; }
  addEventListener(type, cb) { (this._l[type] || (this._l[type] = [])).push(cb); }
  fire(type, data) { (this._l[type] || []).forEach((cb) => cb({ data })); }
}

function fakePort() {
  const received = [];
  return { received, port: { start() {}, postMessage(m) { received.push(m); } } };
}

/**
 * A fake clock handed to the relay as its `scope` (#1397). The relay reads
 * `setTimeout` / `clearTimeout` off the scope precisely so a test can drive the
 * reload debounce deterministically and keep its assertions synchronous, with
 * no real waiting for a 2 to 5 second window.
 */
function fakeClock() {
  let now = 0;
  let id = 0;
  const jobs = new Map();
  const scope = {
    setTimeout(fn, ms) { jobs.set(++id, { at: now + ms, fn }); return id; },
    clearTimeout(t) { jobs.delete(t); },
  };
  return {
    scope,
    // Fire due jobs strictly in time order, re-scanning after each one. The
    // re-scan is what makes this faithful: the emitter CANCELS its sibling
    // timer as it fires, so a snapshot taken up front would run a job that no
    // longer exists and report two reloads where the relay emits one.
    tick(ms) {
      const target = now + ms;
      for (;;) {
        let nextId = null;
        let nextAt = Infinity;
        for (const [t, j] of jobs) {
          if (j.at <= target && j.at < nextAt) { nextAt = j.at; nextId = t; }
        }
        if (nextId === null) break;
        now = nextAt;
        const j = jobs.get(nextId);
        jobs.delete(nextId);
        j.fn();
      }
      now = target;
    },
  };
}

suite('dev reload SharedWorker relay (#887)', () => {
  test('fans a reload out to every connected tab (one connection, many tabs)', () => {
    const { scope, tick } = fakeClock();
    startReloadWorker(scope, FakeEventSource, '/__webjs/events');
    const a = fakePort();
    const b = fakePort();
    scope.onconnect({ ports: [a.port] });
    scope.onconnect({ ports: [b.port] });
    FakeEventSource.last.fire('reload');
    tick(RELOAD_QUIET_MS);
    assert.deepEqual(a.received, [{ type: 'reload' }], 'tab A reloaded');
    assert.deepEqual(b.received, [{ type: 'reload' }], 'tab B reloaded from the same worker');
  });

  test('relays an error frame to every connected tab', () => {
    const { scope } = fakeClock();
    startReloadWorker(scope, FakeEventSource, '/__webjs/events');
    const a = fakePort();
    scope.onconnect({ ports: [a.port] });
    FakeEventSource.last.fire('webjs-error', 'FRAME_JSON');
    assert.deepEqual(a.received, [{ type: 'webjs-error', data: 'FRAME_JSON' }]);
  });

  test('caches the error and replays it to a tab that connects later', () => {
    const { scope } = fakeClock();
    startReloadWorker(scope, FakeEventSource, '/__webjs/events');
    FakeEventSource.last.fire('webjs-error', 'FRAME_JSON'); // error before the tab opens
    const late = fakePort();
    scope.onconnect({ ports: [late.port] });
    assert.deepEqual(late.received, [{ type: 'webjs-error', data: 'FRAME_JSON' }], 'a late tab still shows the overlay');
  });

  test('clears the cached error on reload so a later tab does not see a stale overlay', () => {
    const { scope, tick } = fakeClock();
    startReloadWorker(scope, FakeEventSource, '/__webjs/events');
    FakeEventSource.last.fire('webjs-error', 'FRAME_JSON');
    FakeEventSource.last.fire('reload'); // the fix landed
    tick(RELOAD_QUIET_MS);
    const late = fakePort();
    scope.onconnect({ ports: [late.port] });
    assert.equal(late.received.length, 0, 'no stale error replayed after a reload');
  });

  test('connects the single EventSource at the given events URL', () => {
    const { scope } = fakeClock();
    const { es } = startReloadWorker(scope, FakeEventSource, '/base/__webjs/events');
    assert.equal(es.url, '/base/__webjs/events', 'the one connection uses the base-path-aware URL');
  });

  // #893: a `node --watch` restart drops the connection; if the in-process
  // reload frame was killed with the old process, no reload was delivered, so
  // the edit would need a manual refresh. The `hello` frame carries a
  // per-process boot id, so a CHANGED id on reconnect is the reload signal.
  test('a reconnect to a NEW process (changed boot id) fans a reload', () => {
    const { scope, tick } = fakeClock();
    startReloadWorker(scope, FakeEventSource, '/__webjs/events');
    const a = fakePort();
    scope.onconnect({ ports: [a.port] });
    FakeEventSource.last.fire('hello', 'BOOT_A'); // initial connect: baseline only
    tick(RELOAD_QUIET_MS);
    assert.deepEqual(a.received, [], 'the first hello does not reload');
    FakeEventSource.last.fire('hello', 'BOOT_B'); // reconnected to a fresh process
    tick(RELOAD_QUIET_MS);
    assert.deepEqual(a.received, [{ type: 'reload' }], 'a new boot id reloads the tab');
  });

  test('a transient reconnect to the SAME process (same boot id) never reloads', () => {
    const { scope, tick } = fakeClock();
    startReloadWorker(scope, FakeEventSource, '/__webjs/events');
    const a = fakePort();
    scope.onconnect({ ports: [a.port] });
    FakeEventSource.last.fire('hello', 'BOOT_A'); // first connect
    FakeEventSource.last.fire('hello', 'BOOT_A'); // sleep/wake or blip: same process
    tick(RELOAD_QUIET_MS);
    assert.deepEqual(a.received, [], 'a same-process reconnect is not an edit (no state loss)');
  });
});

// #1397: an agent saves several files a second or two apart, and EACH save
// produces TWO reload signals (the in-process `reload` frame, then a changed
// boot id when the browser reconnects to the restarted process). Acting on
// every one reloads into a server that is about to be killed again, which is
// how the page ends up unstyled. Both signals route through one debounced
// emitter instead.
suite('dev reload coalescing (#1397)', () => {
  test('a burst of signals inside the quiet window fans exactly ONE reload', () => {
    const { scope, tick } = fakeClock();
    startReloadWorker(scope, FakeEventSource, '/__webjs/events');
    const a = fakePort();
    scope.onconnect({ ports: [a.port] });
    const es = FakeEventSource.last;
    es.fire('hello', 'BOOT_A'); // baseline, no signal
    // The measured shape of one agent burst: an in-process frame, then a
    // reconnect with a new boot id, twice over. The gaps are inside the quiet
    // window and the whole burst plus its window is inside the cap, so this is
    // the case the debounce is meant to collapse completely.
    const gap = 700;
    es.fire('reload');
    tick(gap);
    es.fire('hello', 'BOOT_B');
    tick(gap);
    es.fire('reload');
    tick(gap);
    es.fire('hello', 'BOOT_C');
    assert.deepEqual(a.received, [], 'nothing fires while the edits are still landing');
    tick(RELOAD_QUIET_MS);
    assert.deepEqual(a.received, [{ type: 'reload' }], 'four signals coalesce into one reload');
  });

  test('a single signal in a quiet session reloads after exactly the quiet window', () => {
    const { scope, tick } = fakeClock();
    startReloadWorker(scope, FakeEventSource, '/__webjs/events');
    const a = fakePort();
    scope.onconnect({ ports: [a.port] });
    FakeEventSource.last.fire('reload');
    tick(RELOAD_QUIET_MS - 1);
    assert.deepEqual(a.received, [], 'not yet, the window has not elapsed');
    tick(1);
    assert.deepEqual(a.received, [{ type: 'reload' }], 'and never later than the window');
  });

  test('a sustained burst still reloads at the cap, measured from the first signal', () => {
    const { scope, tick } = fakeClock();
    startReloadWorker(scope, FakeEventSource, '/__webjs/events');
    const a = fakePort();
    scope.onconnect({ ports: [a.port] });
    const es = FakeEventSource.last;
    const step = RELOAD_QUIET_MS - 100; // close enough that the quiet timer never expires
    es.fire('reload'); // t = 0, the first signal of the batch
    let elapsed = 0;
    while (elapsed + step < RELOAD_MAX_HOLD_MS) {
      tick(step);
      elapsed += step;
      es.fire('reload');
      assert.deepEqual(a.received, [], 'the quiet window keeps being pushed out by the burst');
    }
    tick(RELOAD_MAX_HOLD_MS - elapsed);
    assert.deepEqual(a.received, [{ type: 'reload' }], 'the cap fires at RELOAD_MAX_HOLD_MS from the FIRST signal');
  });

  // COUNTERFACTUAL: re-arm the cap timer on every signal and the cap slides out
  // with the burst, so the last two assertions here both see nothing.
  test('the cap timer is not re-armed within a batch', () => {
    const { scope, tick } = fakeClock();
    startReloadWorker(scope, FakeEventSource, '/__webjs/events');
    const a = fakePort();
    scope.onconnect({ ports: [a.port] });
    const es = FakeEventSource.last;
    const step = RELOAD_QUIET_MS - 100;
    es.fire('reload'); // t = 0, the first signal of the batch
    tick(step);
    es.fire('reload'); // mid-batch: must not push the cap out
    tick(step);
    es.fire('reload'); // mid-batch again
    tick(RELOAD_MAX_HOLD_MS - 2 * step - 1);
    assert.deepEqual(a.received, [], 'the cap has not fired one tick early');
    tick(1);
    assert.deepEqual(a.received, [{ type: 'reload' }], 'the cap still measures from the first signal');
  });

  test('a signal after a cap fire starts a NEW batch', () => {
    const { scope, tick } = fakeClock();
    startReloadWorker(scope, FakeEventSource, '/__webjs/events');
    const a = fakePort();
    scope.onconnect({ ports: [a.port] });
    const es = FakeEventSource.last;
    const step = RELOAD_QUIET_MS - 100;
    // Sustain a burst until the cap fires, so batch one ends on the CAP rather
    // than on a quiet window (which is the case this test is about).
    es.fire('reload');
    tick(step);
    es.fire('reload');
    tick(step);
    es.fire('reload');
    tick(RELOAD_MAX_HOLD_MS - 2 * step);
    assert.equal(a.received.length, 1, 'batch one emitted at the cap');
    es.fire('reload');
    tick(RELOAD_QUIET_MS - 1);
    assert.equal(a.received.length, 1, 'batch two waits a full quiet window, it does not inherit the old timers');
    tick(1);
    assert.equal(a.received.length, 2, 'batch two emitted on its own window');
  });

  test('an error frame is never debounced', () => {
    const { scope } = fakeClock();
    startReloadWorker(scope, FakeEventSource, '/__webjs/events');
    const a = fakePort();
    scope.onconnect({ ports: [a.port] });
    FakeEventSource.last.fire('webjs-error', 'FRAME_JSON');
    // No tick: an overlay has to appear at once, and it is not a reload.
    assert.deepEqual(a.received, [{ type: 'webjs-error', data: 'FRAME_JSON' }]);
  });

  test('a reload signal clears the cached error immediately, before the debounced emit', () => {
    const { scope } = fakeClock();
    startReloadWorker(scope, FakeEventSource, '/__webjs/events');
    FakeEventSource.last.fire('webjs-error', 'FRAME_JSON');
    FakeEventSource.last.fire('reload'); // the rebuild fixed it; the reload is still pending
    const late = fakePort();
    scope.onconnect({ ports: [late.port] }); // connects DURING the pending window
    assert.equal(late.received.length, 0, 'no overlay for an error the rebuild already fixed');
  });
});
