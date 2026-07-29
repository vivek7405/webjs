/**
 * Client half of bare-await async render (#469), real browser via WTR.
 *
 * Covers the stale-while-revalidate default, the renderFallback() override
 * (re-fetch only, never first paint), per-component renderError isolation,
 * and the superseding-render race guard.
 */
import { html } from '../../../src/html.js';
import { WebComponent } from '../../../src/component.js';
import { activeActionSignal } from '../../../src/action-abort-client.js';

const { suite, test } = window.Mocha ? Mocha : { suite, test };
import { assert } from '../../../../../test/browser-assert.js';

let host;
function container() {
  if (host) host.remove();
  host = document.createElement('div');
  document.body.appendChild(host);
  return host;
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const uniq = (p) => `${p}-${++n}`;

suite('async render() on the client', () => {
  test('awaits render() and commits the resolved template', async () => {
    const tag = uniq('async-basic');
    class C extends WebComponent {
      async render() {
        await tick(5);
        return html`<p class="loaded">done</p>`;
      }
    }
    C.register(tag);
    const el = document.createElement(tag);
    container().appendChild(el);
    await el.updateComplete;
    await tick(0);
    assert.ok(el.querySelector('.loaded'), 'resolved template committed');
    assert.equal(el.querySelector('.loaded').textContent, 'done');
  });

  test('stale-while-revalidate: prior content stays during a re-fetch (no renderFallback)', async () => {
    const tag = uniq('async-swr');
    let resolveGate;
    class C extends WebComponent({ v: Number }) {
      constructor() { super(); this.v = 1; this.gate = null; }
      async render() {
        const v = this.v;
        if (this.gate) await this.gate;
        return html`<p class="val">v=${v}</p>`;
      }
    }
    C.register(tag);
    const el = document.createElement(tag);
    container().appendChild(el);
    await el.updateComplete;
    await tick(0);
    assert.equal(el.querySelector('.val').textContent, 'v=1', 'first render committed');

    // Trigger a re-fetch that hangs on a gate; the OLD content must persist.
    el.gate = new Promise((res) => { resolveGate = res; });
    el.v = 2;
    await tick(0);
    assert.equal(el.querySelector('.val').textContent, 'v=1', 'stale content stays during the re-fetch');
    resolveGate();
    await el.updateComplete;
    await tick(0);
    assert.equal(el.querySelector('.val').textContent, 'v=2', 'new content commits when the fetch resolves');
  });

  test('renderFallback() shows a loading state during a re-fetch, never on first paint', async () => {
    const tag = uniq('async-fallback');
    let resolveGate;
    class C extends WebComponent({ v: Number }) {
      constructor() { super(); this.v = 1; this.gate = null; }
      renderFallback() { return html`<p class="skeleton">loading…</p>`; }
      async render() {
        const v = this.v;
        if (this.gate) await this.gate;
        return html`<p class="val">v=${v}</p>`;
      }
    }
    C.register(tag);
    const el = document.createElement(tag);
    container().appendChild(el);
    await el.updateComplete;
    await tick(0);
    // First paint: NO fallback, the resolved value instead.
    assert.ok(!el.querySelector('.skeleton'), 'no fallback on first paint');
    assert.equal(el.querySelector('.val').textContent, 'v=1');

    // Re-fetch: the fallback replaces the stale content while loading.
    el.gate = new Promise((res) => { resolveGate = res; });
    el.v = 2;
    await tick(0);
    assert.ok(el.querySelector('.skeleton'), 'fallback shown during the re-fetch');
    assert.ok(!el.querySelector('.val'), 'stale content replaced by the fallback');
    resolveGate();
    await el.updateComplete;
    await tick(0);
    assert.equal(el.querySelector('.val').textContent, 'v=2', 'real content replaces the fallback');
  });

  test('updateComplete does not resolve before an in-flight async commit (shouldUpdate=false cycle)', async () => {
    const tag = uniq('async-uc');
    let resolveGate;
    class C extends WebComponent({ v: Number, noop: Number }) {
      constructor() { super(); this.v = 1; this.noop = 0; }
      // Skip ONLY a cycle whose sole change is `noop` (not the first render,
      // whose changedProperties carries every initial property value).
      shouldUpdate(cp) { return !(cp.size === 1 && cp.has('noop')); }
      async render() {
        const v = this.v;
        if (this.gate) await this.gate;
        return html`<p class="val">v=${v}</p>`;
      }
    }
    C.register(tag);
    const el = document.createElement(tag);
    container().appendChild(el);
    await el.updateComplete;
    await tick(0);

    // Start a gated re-fetch, then fire a non-committing cycle during it.
    el.gate = new Promise((res) => { resolveGate = res; });
    el.v = 2;
    await tick(0);                  // cycle A (async, v=2) is in flight, gated
    assert.equal(el.querySelector('.val').textContent, 'v=1', 'still stale before the commit');
    el.noop = 99;                   // shouldUpdate=false cycle while the async render is in flight
    let domAtResolve = null;
    el.updateComplete.then(() => { domAtResolve = el.querySelector('.val').textContent; });
    await tick(0);                  // let the non-committing cycle run
    assert.equal(domAtResolve, null, 'updateComplete did NOT resolve while the async render is in flight');
    resolveGate();
    await el.updateComplete;
    await tick(0);
    assert.equal(el.querySelector('.val').textContent, 'v=2', 'the async commit landed');
    assert.equal(domAtResolve, 'v=2', 'updateComplete resolved only after the async DOM commit');
  });

  test('a rejected async render renders renderError(), the element survives', async () => {
    const tag = uniq('async-err');
    const origError = console.error;
    console.error = () => {};
    try {
      class C extends WebComponent {
        async render() { await tick(2); throw new Error('boom'); }
        renderError(e) { return html`<p class="err">${e.message}</p>`; }
      }
      C.register(tag);
      const el = document.createElement(tag);
      container().appendChild(el);
      await el.updateComplete;
      await tick(5);
      assert.ok(el.querySelector('.err'), 'renderError committed');
      assert.equal(el.querySelector('.err').textContent, 'boom');
    } finally {
      console.error = origError;
    }
  });

  // Sibling of the test above, and a different failure: there the FETCH
  // rejects, here the fetch resolves and the COMMIT throws. The two used to
  // disagree, because `.then(onFulfil, onRejected)` does not route onFulfil's
  // own throw to its sibling handler.
  //
  // Run in a real browser rather than only under linkedom because this is the
  // shipped combination: an async render returning the refused `.action=${fn}`
  // binding on a native form, where `action` is a reflected IDL attribute that
  // a DOM shim does not model. The imported action is an RPC stub on the
  // client, still a function, so the guard fires here exactly as it would in
  // an app.
  test('a throw from the COMMIT of an async render reaches renderError(), not the window', async () => {
    const tag = uniq('async-commit-err');
    const origError = console.error;
    console.error = () => {};
    const escaped = [];
    const onRejection = (e) => { escaped.push(e); e.preventDefault(); };
    window.addEventListener('unhandledrejection', onRejection);
    try {
      const serverAction = async function saveTodo(input) { return { ok: true }; };
      class C extends WebComponent {
        async render() { await tick(2); return html`<form .action=${serverAction}></form>`; }
        renderError(e) { return html`<p class="err">${e.message}</p>`; }
      }
      C.register(tag);
      const el = document.createElement(tag);
      container().appendChild(el);

      // Bounded on purpose, and crossing the bound is a hard failure: an
      // updateComplete that never settles is precisely the bug, so awaiting it
      // unguarded would hang the run instead of reporting it.
      const settled = await Promise.race([
        // resolve and reject are different outcomes: a rejecting updateComplete
        // keeps renderError() firing while every awaiting caller starts throwing.
        el.updateComplete.then(() => 'resolved', () => 'REJECTED'),
        tick(1000).then(() => 'NEVER SETTLED'),
      ]);
      await tick(5);

      assert.equal(settled, 'resolved', 'updateComplete must RESOLVE, not reject, after a contained commit failure');
      assert.ok(el.querySelector('.err'), 'renderError committed');
      assert.match(el.querySelector('.err').textContent, /interpolated into action=/);
      assert.equal(escaped.length, 0, 'the refusal must not reach window.unhandledrejection');
      assert.equal(el.__pendingAsyncCommits, 0, 'the in-flight count is released, not wedged');
      // The whole point of the guard: nothing carrying the source reaches the DOM.
      assert.ok(!el.innerHTML.includes('saveTodo'), 'no function source in the live DOM');
    } finally {
      window.removeEventListener('unhandledrejection', onRejection);
      console.error = origError;
    }
  });

  test('race guard: the NEW render commits, a later-resolving STALE one is dropped', async () => {
    const tag = uniq('async-race');
    const gates = [];
    class C extends WebComponent({ v: Number }) {
      constructor() { super(); this.v = 0; }
      async render() {
        const v = this.v;
        await new Promise((res) => { gates[v] = res; });
        return html`<p class="val">v=${v}</p>`;
      }
    }
    C.register(tag);
    const el = document.createElement(tag);
    container().appendChild(el);
    await tick(0);            // first render (v=0) is in flight, gated
    el.v = 1;                 // supersede before v=0 resolves
    await tick(0);
    // Resolve the NEW render FIRST so it commits, THEN the stale one. Without
    // the token guard the late stale resolution would clobber back to v=0.
    gates[1] && gates[1]();
    await el.updateComplete;
    await tick(0);
    assert.equal(el.querySelector('.val').textContent, 'v=1', 'the new render committed');
    gates[0] && gates[0]();   // the stale render resolves last
    await tick(0);
    assert.equal(el.querySelector('.val').textContent, 'v=1', 'the stale resolution did NOT overwrite the new content');
  });

  test('race guard: an async render superseded by a SYNC render is dropped', async () => {
    // Regression: __renderToken must be stamped for every commit (sync too),
    // or a stale async resolution clobbers a fresh synchronous commit.
    const tag = uniq('async-sync-race');
    let resolveGate;
    class C extends WebComponent({ v: Number }) {
      constructor() { super(); this.v = 0; this.sync = false; }
      render() {
        if (this.sync) return html`<p class="val">v=${this.v}</p>`;   // synchronous
        const v = this.v;
        return new Promise((res) => { resolveGate = () => res(html`<p class="val">v=${v}</p>`); });
      }
    }
    C.register(tag);
    const el = document.createElement(tag);
    container().appendChild(el);
    await tick(0);            // first render (v=0) is async, in flight, gated
    el.sync = true;
    el.v = 1;                 // a SYNC cycle that commits v=1 immediately
    await el.updateComplete;
    await tick(0);
    assert.equal(el.querySelector('.val').textContent, 'v=1', 'the sync render committed');
    resolveGate();            // the stale async render resolves last
    await tick(5);
    assert.equal(el.querySelector('.val').textContent, 'v=1', 'the stale async resolution did NOT clobber the sync commit');
  });

  test('updateComplete resolves when a superseding SYNC render THROWS during an in-flight async render (#470)', async () => {
    // Behavior guard: an async render is in flight (it owns updateComplete via
    // the pending-async counter). A superseding cycle bumps the token and throws
    // synchronously. The render-error boundary catches the throw and the cycle
    // completes as a (failed) sync commit (didCommit=true), which resolves
    // updateComplete via _postCommit. So `await el.updateComplete` must NOT hang,
    // and the later-settling stale async render must not clobber or deadlock it.
    const tag = uniq('async-throw-supersede');
    let resolveGate;
    class C extends WebComponent({ v: Number }) {
      constructor() { super(); this.v = 0; this.boom = false; }
      render() {
        if (this.boom) throw new Error('superseding render boom');   // synchronous throw
        const v = this.v;
        return new Promise((res) => { resolveGate = () => res(html`<p class="val">v=${v}</p>`); });
      }
    }
    C.register(tag);
    const el = document.createElement(tag);
    container().appendChild(el);
    await tick(0);            // first render (v=0) async, in flight, gated
    el.boom = true;
    el.v = 1;                 // a SYNC cycle that bumps the token and throws

    // updateComplete must resolve (not hang). Guard with a timeout so a
    // regression fails as a timeout rather than hanging the whole suite.
    const settled = await Promise.race([
      el.updateComplete.then(() => 'resolved'),
      tick(2000).then(() => 'timeout'),
    ]);
    assert.equal(settled, 'resolved', 'updateComplete resolved after a throwing superseding render (did not hang)');

    // The stale async render resolving late must not throw or hang either.
    resolveGate();
    await tick(5);
    assert.ok(el.isConnected, 'the element survived the throwing supersede');
  });

  // #492: a superseded async render aborts the previous render's active action
  // signal. The action reads activeActionSignal() (as the generated stub does);
  // a prop change supersedes the in-flight render and must abort that signal.
  test('a superseded async render aborts the previous render\'s active action signal (#492)', async () => {
    const tag = uniq('abort-signal');
    /** @type {(AbortSignal|undefined)[]} */
    const captured = [];
    let release;
    class C extends WebComponent({ v: Number }) {
      async render() {
        captured.push(activeActionSignal());        // the stub captures this synchronously
        await new Promise((r) => { release = r; }); // hold the render in flight
        return html`<p class="v">${this.v}</p>`;
      }
    }
    C.register(tag);
    const el = document.createElement(tag);
    el.v = 0;
    container().appendChild(el);
    await tick(10); // the first render is in flight (captured[0] bound)
    assert.ok(captured[0], 'the first render bound an active signal');
    assert.equal(captured[0].aborted, false, 'not aborted while it is the current render');

    // Supersede with a prop change: the previous render's signal must abort.
    el.v = 1;
    await tick(10);
    assert.equal(captured[0].aborted, true, 'the superseded render\'s action signal was aborted');
    assert.ok(captured[1], 'the new render bound a fresh signal');
    assert.equal(captured[1].aborted, false, 'the current render\'s signal is live');
    if (release) release(); // let the stale render resolve (dropped by the token guard)
    await tick(5);
  });
});
