/**
 * Real-browser tests for the `<webjs-stream>` surgical-update element (#248).
 *
 * `<webjs-stream action target>` wraps a `<template>` and, on connect, clones
 * the template content and applies it to the target by native DOM, then removes
 * itself. `renderStream(html)` parses a server-sent payload and inserts the
 * stream elements (which self-apply). Two delivery paths share this applier:
 * a content-negotiated form response over the client router, and a live-channel
 * message handed to `renderStream`.
 *
 * These MUST run in a real browser: the applier upgrades a custom element,
 * clones `<template>` content, and mutates the live DOM, none of which the
 * SSR/linkedom path exercises. We import the element + router for their side
 * effects and assert the post-apply DOM.
 */
import { renderStream } from '../../../src/webjs-stream.js';
import '../../../src/webjs-stream.js';
import { enableClientRouter } from '../../../src/router-client.js';
import { connectWS } from '../../../src/websocket-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';

/** Shared across the suites below; installed per test in setup(). */
let navGuard;
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() { for (let i = 0; i < 4; i++) await tick(); }

suite('<webjs-stream> applier (#248)', () => {
  let host;
  function setup() {
    navGuard = installNavGuard();
    host = document.createElement('div');
    document.body.appendChild(host);
  }
  function teardown() {
    navGuard.remove();
    host.remove();
    // Clean up any stray stream elements a failing case left behind.
    document.querySelectorAll('webjs-stream').forEach((e) => e.remove());
  }

  test('append adds template content as the last child of the target', async () => {
    setup();
    host.innerHTML = '<ul id="list"><li>one</li></ul>';
    renderStream('<webjs-stream action="append" target="list"><template><li>two</li></template></webjs-stream>');
    await settle();
    const items = [...host.querySelectorAll('#list li')].map((li) => li.textContent);
    assert.equal(items.join(','), 'one,two', 'appended after existing children');
    assert.equal(document.querySelectorAll('webjs-stream').length, 0, 'the stream element removed itself');
    teardown();
  });

  test('prepend adds template content as the first child of the target', async () => {
    setup();
    host.innerHTML = '<ul id="list"><li>one</li></ul>';
    renderStream('<webjs-stream action="prepend" target="list"><template><li>zero</li></template></webjs-stream>');
    await settle();
    const items = [...host.querySelectorAll('#list li')].map((li) => li.textContent);
    assert.equal(items.join(','), 'zero,one', 'prepended before existing children');
    teardown();
  });

  test('replace swaps the target element itself', async () => {
    setup();
    host.innerHTML = '<div id="card"><p>old</p></div>';
    renderStream('<webjs-stream action="replace" target="card"><template><div id="card"><p>new</p></div></template></webjs-stream>');
    await settle();
    assert.equal(host.querySelector('#card p').textContent, 'new', 'card replaced');
    assert.equal(host.querySelectorAll('#card').length, 1, 'exactly one card remains');
    teardown();
  });

  test('update replaces the children of the target, keeping the element', async () => {
    setup();
    host.innerHTML = '<span id="count" class="badge">3</span>';
    renderStream('<webjs-stream action="update" target="count"><template>4</template></webjs-stream>');
    await settle();
    const el = host.querySelector('#count');
    assert.equal(el.textContent, '4', 'children replaced');
    assert.ok(el.classList.contains('badge'), 'the element itself (and its class) is preserved');
    teardown();
  });

  test('remove deletes the target and needs no template', async () => {
    setup();
    host.innerHTML = '<li id="row-7">doomed</li><li id="row-8">keep</li>';
    renderStream('<webjs-stream action="remove" target="row-7"></webjs-stream>');
    await settle();
    assert.equal(host.querySelector('#row-7'), null, 'target removed');
    assert.ok(host.querySelector('#row-8'), 'sibling untouched');
    teardown();
  });

  test('before / after insert as siblings of the target', async () => {
    setup();
    host.innerHTML = '<div id="anchor">A</div>';
    renderStream('<webjs-stream action="before" target="anchor"><template><div class="b">B</div></template></webjs-stream>');
    renderStream('<webjs-stream action="after" target="anchor"><template><div class="c">C</div></template></webjs-stream>');
    await settle();
    const seq = [...host.children].map((el) => el.textContent).join('');
    assert.equal(seq, 'BAC', 'before then anchor then after');
    teardown();
  });

  test('targets (a selector) applies to every match', async () => {
    setup();
    host.id = 'stream-host';
    host.innerHTML = '<p class="t">x</p><p class="t">y</p><p class="other">z</p>';
    renderStream('<webjs-stream action="update" targets="#stream-host .t"><template>hit</template></webjs-stream>');
    await settle();
    const ts = [...host.querySelectorAll('.t')].map((p) => p.textContent);
    assert.equal(ts.join(','), 'hit,hit', 'both .t updated');
    assert.equal(host.querySelector('.other').textContent, 'z', 'non-matching element untouched');
    teardown();
  });

  test('a missing target is a no-op and still self-removes (no throw)', async () => {
    setup();
    host.innerHTML = '<div id="present"></div>';
    renderStream('<webjs-stream action="append" target="absent"><template><b>x</b></template></webjs-stream>');
    await settle();
    assert.equal(host.querySelector('b'), null, 'nothing applied for an absent target');
    assert.equal(document.querySelectorAll('webjs-stream').length, 0, 'still removed itself');
    teardown();
  });

  test('multiple stream elements in one payload all apply', async () => {
    setup();
    host.innerHTML = '<ul id="list"></ul><span id="n">0</span>';
    renderStream(
      '<webjs-stream action="append" target="list"><template><li>a</li></template></webjs-stream>' +
      '<webjs-stream action="update" target="n"><template>1</template></webjs-stream>'
    );
    await settle();
    assert.equal(host.querySelector('#list li').textContent, 'a', 'first action applied');
    assert.equal(host.querySelector('#n').textContent, '1', 'second action applied');
    teardown();
  });

  test('a newline-joined multi-action payload leaves no stray text nodes in <body>', async () => {
    setup();
    host.innerHTML = '<ul id="list"></ul>';
    // The server joins parts with "\n" (streamResponse). renderStream must NOT
    // accrete the intervening whitespace text nodes in <body>.
    const before = document.body.childNodes.length;
    renderStream(
      '<webjs-stream action="append" target="list"><template><li>a</li></template></webjs-stream>\n' +
      '<webjs-stream action="append" target="list"><template><li>b</li></template></webjs-stream>\n' +
      '<webjs-stream action="append" target="list"><template><li>c</li></template></webjs-stream>'
    );
    await settle();
    assert.equal([...host.querySelectorAll('#list li')].map((l) => l.textContent).join(''), 'abc', 'all three applied');
    assert.equal(document.body.childNodes.length, before, 'no net <body> children added (no stray text nodes)');
    teardown();
  });
});

suite('Client router: content-negotiated stream-action form response (#248)', () => {
  let host, origFetch, calls;
  function setup() {
    navGuard = installNavGuard();
    enableClientRouter(); // idempotent
    host = document.createElement('div');
    document.body.appendChild(host);
    origFetch = window.fetch;
    calls = [];
  }
  function teardown() {
    navGuard.remove();
    window.fetch = origFetch;
    host.remove();
    document.querySelectorAll('webjs-stream').forEach((e) => e.remove());
  }

  test('a form POST whose response is a stream patches in place AND sends the stream Accept', async () => {
    setup();
    window.fetch = (url, init) => {
      calls.push({ url: String(url), init: init || {} });
      return Promise.resolve(new Response(
        '<webjs-stream action="append" target="comments"><template><li>hi</li></template></webjs-stream>',
        { status: 200, headers: { 'content-type': 'text/vnd.webjs-stream.html; charset=utf-8', 'x-webjs-build': '' } },
      ));
    };
    host.innerHTML =
      '<ul id="comments"></ul>' +
      '<form id="f" method="post" action="/comment"><input name="text" value="hi"><button type="submit">Send</button></form>';
    const form = host.querySelector('#f');
    form.requestSubmit(form.querySelector('button'));
    await settle();

    assert.equal(calls.length, 1, 'exactly one request');
    const accept = (calls[0].init.headers && calls[0].init.headers['accept']) || '';
    assert.ok(accept.indexOf('text/vnd.webjs-stream.html') === 0, 'the stream MIME leads the Accept header');
    assert.equal(host.querySelector('#comments li').textContent, 'hi', 'the comment was appended surgically');
    teardown();
  });
});

suite('Live channel: connectWS message applied by the same applier (#248)', () => {
  let host, OrigWS, sockets;
  function setup() {
    navGuard = installNavGuard();
    host = document.createElement('div');
    document.body.appendChild(host);
    OrigWS = window.WebSocket;
    sockets = [];
    // A fake WebSocket: connectWS calls `new WebSocket(url)` and sets onmessage;
    // we capture the instance so the test can fire a server message.
    class FakeWS {
      constructor() { this.readyState = 1; sockets.push(this); }
      send() {}
      close() { this.readyState = 3; }
    }
    FakeWS.OPEN = 1;
    window.WebSocket = FakeWS;
  }
  function teardown() {
    navGuard.remove();
    window.WebSocket = OrigWS;
    host.remove();
    document.querySelectorAll('webjs-stream').forEach((e) => e.remove());
  }

  test('a broadcast/WS stream message patches the live DOM via renderStream', async () => {
    setup();
    host.innerHTML = '<ul id="feed"></ul>';
    // The canonical live-channel wiring: a stream payload arrives and is applied
    // by the SAME applier the HTTP path uses.
    const conn = connectWS('/feed', { reconnect: false, onMessage: (m) => renderStream(m) });
    await settle();
    // The server pushes a stream-action string (not JSON, so connectWS leaves
    // it as a string and hands it to onMessage).
    sockets[0].onmessage({ data: '<webjs-stream action="append" target="feed"><template><li>ping</li></template></webjs-stream>' });
    await settle();
    assert.equal(host.querySelector('#feed li').textContent, 'ping', 'the live message appended surgically');
    conn.close();
    teardown();
  });
});
