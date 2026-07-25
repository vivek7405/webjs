import { html } from '@webjsdev/core';

export const metadata = { title: 'Testing | WebJs' };

export default function Testing() {
  return html`
    <h1>Testing</h1>
    <p>WebJs uses Node's built-in <code>node:test</code> runner, so no external test framework is needed. The framework itself ships with 70+ tests covering the server renderer, router, actions, CSRF, client diffing, and more.</p>

    <h2>Running Tests</h2>
    <pre># from the webjs monorepo root
npm test
# or directly:
node --test test/*.test.js</pre>

    <h2>Server-Side Tests</h2>
    <p>Test your server actions, queries, and utilities directly. They're just async functions:</p>
    <pre>import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listPosts } from '#modules/posts/queries/list-posts.server.ts';

test('listPosts returns an array', async () =&gt; {
  const posts = await listPosts();
  assert.ok(Array.isArray(posts));
});</pre>

    <h2>Renderer Tests</h2>
    <p>Test <code>renderToString</code> for SSR output. Import it from <code>@webjsdev/core/server</code>, not the root, so your test stays explicit about which side it runs on:</p>
    <pre>import { html } from '@webjsdev/core';
import { renderToString } from '@webjsdev/core/server';

test('renders template with interpolation', async () =&gt; {
  const out = await renderToString(html\`&lt;p&gt;\${'hello'}&lt;/p&gt;\`);
  assert.match(out, /&lt;p&gt;hello&lt;\\/p&gt;/);
});

test('escapes text content', async () =&gt; {
  const out = await renderToString(html\`&lt;p&gt;\${'&lt;script&gt;'}&lt;/p&gt;\`);
  assert.match(out, /&amp;lt;script&amp;gt;/);
});</pre>

    <h2>Component Test Helpers</h2>
    <p>Import the mount + hydrate + a11y helpers from <code>@webjsdev/core/testing</code>. They run inside the WTR Chromium session (real DOM), and are thin wrappers over the browser already running:</p>
    <pre>import { fixture, ssrFixture, waitForUpdate, assertNoA11yViolations,
  click, shadowQuery, shadowQueryAll } from '@webjsdev/core/testing';</pre>

    <h3>fixture() vs ssrFixture()</h3>
    <p>Both server-render an <code>html</code> template (via <code>renderToString</code>, with DSD) and set the markup into a container so the browser upgrades the custom element. The difference is how they wait:</p>
    <ul>
      <li><strong>fixture(template)</strong> waits two macrotasks. Use it for a quick mount where the SSR-then-hydrate distinction does not matter.</li>
      <li><strong>ssrFixture(template)</strong> awaits the element's native <code>updateComplete</code> promise (the real render-cycle resolution), not a timer, so the post-hydration DOM is observable deterministically. It is the documented SSR + hydrate entry. The component class must already be registered (the test imports its module, same as <code>fixture()</code>).</li>
    </ul>
    <pre>import { html } from '@webjsdev/core';
import { ssrFixture, waitForUpdate } from '@webjsdev/core/testing';

const el = await ssrFixture(html\`&lt;my-counter count="5"&gt;&lt;/my-counter&gt;\`);
assert.ok(el.innerHTML.includes('5'));          // post-hydration DOM

el.count = 10;
await waitForUpdate(el);                          // awaits the real cycle
assert.ok(el.innerHTML.includes('10'));</pre>
    <p><code>waitForUpdate(el)</code> also awaits the native <code>updateComplete</code> when present (falling back to a macrotask flush for a plain element), so a re-render after a property assignment or signal <code>set()</code> settles deterministically.</p>

    <h3>Catching a hydration mismatch</h3>
    <p>Because <code>ssrFixture</code> renders the SSR HTML and then hydrates it, the SSR'd markup and the post-hydration DOM should agree. A divergence (the server renders one thing, the client another) is observable by comparing the SSR'd inner HTML against the live <code>el.innerHTML</code> (or <code>el.shadowRoot.innerHTML</code>) after it resolves. Normalise the SSR string first (strip the <code>&lt;!--webjs-hydrate--&gt;</code> marker, <code>data-webjs-prop-*</code> attributes, and part comments), then compare. The counterfactual is a component whose <code>render()</code> is non-deterministic across the SSR call and the hydration render, which the comparison catches.</p>

    <h3>assertNoA11yViolations (opt-in)</h3>
    <p><code>assertNoA11yViolations(el, opts?)</code> is an opt-in accessibility assertion that runs the standard axe-core engine against an element's subtree in the WTR Chromium session. Nothing calls it for you, it is never a forced gate. axe-core is a test-only peer, imported dynamically by the helper, so it is not a hard dependency of <code>@webjsdev/core</code>. Install it where you run the test (<code>npm install -D axe-core</code>; the scaffold and this repo already ship it).</p>
    <p>On zero violations it resolves. On a violation it throws an Error whose message lists each violation's id, impact, a short help string, and the failing nodes' selectors, so the failure is actionable. <code>opts</code> passes through to <code>axe.run</code> (for example <code>{ rules: { 'color-contrast': { enabled: false } } }</code>).</p>
    <pre>import { ssrFixture, assertNoA11yViolations } from '@webjsdev/core/testing';

const el = await ssrFixture(html\`&lt;my-form&gt;&lt;/my-form&gt;\`);
await assertNoA11yViolations(el);                // passes a clean subtree

// a &lt;button&gt; with no accessible name, an &lt;input&gt; with no label,
// or an &lt;img&gt; with no alt: each throws a named violation.</pre>

    <h2>Renderer Tests (browser)</h2>
    <p>Client-side tests run in <strong>real Chromium</strong> via Web Test Runner + Playwright. No fake DOM, just full Shadow DOM, events, adoptedStyleSheets, everything works.</p>
    <pre>// test/renderer/browser/renderer.test.js: runs in real Chromium
import { html } from '@webjsdev/core';
import { render } from '@webjsdev/core';

suite('Client renderer', () =&gt; {
  test('preserves element identity on re-render', () =&gt; {
    const el = document.createElement('div');
    const view = (n) =&gt; html\`&lt;p&gt;\${n}&lt;/p&gt;\`;
    render(view(1), el);
    const pre = el.querySelector('p');
    render(view(2), el);
    assert.strictEqual(el.querySelector('p'), pre);
  });

  test('Shadow DOM works', () =&gt; {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    render(html\`&lt;p&gt;inside shadow&lt;/p&gt;\`, shadow);
    assert.ok(shadow.querySelector('p'));
  });
});</pre>

    <h2>The handle() Test Harness</h2>
    <p><code>createRequestHandler({ appDir }).handle(request)</code> drives the FULL request pipeline (middleware, routing, SSR, page actions, server-action RPC, auth + CSRF) and returns a native <code>Response</code>. It is the same entry the framework's own suite uses, so the most realistic way to test an app is to fire a <code>Request</code> through it and assert on the <code>Response</code>, with no spawned process and no network.</p>
    <p><code>@webjsdev/server/testing</code> ships thin builders over that <code>handle()</code>. They are not a test framework. Each is a few lines over native <code>Request</code> / <code>Response</code>, and they reuse the REAL cookie / header names and the REAL wire serializer, so a test exercises the production contract, never a parallel fake.</p>
    <pre>import { createRequestHandler } from '@webjsdev/server';
import { testRequest, invokeActionForTest, loginAndGetCookies, withSessionCookie }
  from '@webjsdev/server/testing';

const app = await createRequestHandler({ appDir: process.cwd(), dev: true });</pre>

    <h3>testRequest: fire a request, get the Response</h3>
    <pre>const res = await testRequest(app.handle, '/about');
assert.equal(res.status, 200);
assert.match(await res.text(), /About/);</pre>
    <p>A bare path (<code>/about</code>) is prefixed with a dummy origin (the pipeline only reads <code>pathname</code> + <code>search</code>). A full URL string or a pre-built <code>Request</code> works too. The optional third arg is a standard <code>RequestInit</code> (method, headers, body).</p>

    <h3>The auth/session helpers</h3>
    <p>Server-action CSRF is an Origin / <code>Sec-Fetch-Site</code> check, so a test needs no CSRF setup: <code>invokeActionForTest</code> models a same-origin browser POST and passes the check automatically (and <code>rawActionRequest(app, file, fn, args, { crossOrigin: true })</code> models a cross-site request to assert the 403). <code>loginAndGetCookies(handle, { email, password })</code> drives the REAL credentials login through <code>handle()</code> (the <code>createAuth</code> route handler) and captures the genuine signed session <code>Set-Cookie</code>, so a follow-up request can hit a protected route as the logged-in user. <code>withSessionCookie(init, cookies)</code> merges those captured cookies onto a request init.</p>
    <pre>// unauthenticated protected route is gated
const gated = await testRequest(app.handle, '/dashboard');
assert.equal(gated.status, 302);                     // -&gt; /login

// real login, then reuse the captured cookie
const { cookies } = await loginAndGetCookies(app.handle, { email, password });
const dash = await testRequest(app.handle, '/dashboard', withSessionCookie({}, cookies));
assert.equal(dash.status, 200);</pre>
    <p>The session cookie is the production cookie, captured from a real login, never a hand-built shape. (The default login path is <code>/api/auth/signin/credentials</code>, the route <code>createAuth</code>'s handler routes a credentials login through. Override <code>opts.loginPath</code> / <code>opts.body</code> for a different wiring.)</p>

    <h3>invokeActionForTest: round-trip an action through the REAL endpoint</h3>
    <pre>// modules/posts/actions/create.server.ts exports createPost
const out = await invokeActionForTest(
  app, 'modules/posts/actions/create.server.ts', 'createPost', [input]);</pre>
    <p><code>invokeActionForTest</code> serializes <code>args</code> with the WebJs serializer (exactly as the generated client stub does), POSTs them to the REAL <code>/__webjs/action/&lt;hash&gt;/&lt;fn&gt;</code> endpoint as a same-origin request (so it passes the cross-origin CSRF check), and parses the response with the serializer. The action is addressed by the SHA-256 hash of its <code>.server.{js,ts}</code> file path (absolute or appDir-relative) plus the function name, the same scheme the stub uses.</p>
    <p><strong>Prefer this over a direct import of the action.</strong> A direct import calls the function in-process and bypasses three production concerns the endpoint enforces:</p>
    <ul>
      <li><strong>the wire serializer</strong> (a <code>Date</code> / <code>Map</code> / <code>BigInt</code> arg or return is genuinely encoded and decoded, not passed by reference),</li>
      <li><strong>CSRF</strong> (a missing token is a 403),</li>
      <li><strong>prod error sanitization</strong> (a thrown error surfaces as a sanitized message-only payload, never the stack or extra error fields).</li>
    </ul>
    <p>So <code>invokeActionForTest</code> catches a serializer / CSRF / error-sanitization regression a direct import cannot see. For the negative cases (assert a 403 on missing CSRF, or inspect a sanitized 500 body), <code>rawActionRequest(...)</code> returns the raw <code>Response</code> and never throws on a non-2xx. Pass <code>{ omitCsrf: true }</code> to deliberately drop the CSRF pair.</p>

    <h2>API Route Tests</h2>
    <p>Drive route handlers through the same <code>handle()</code> entry (here via <code>testRequest</code>), or call them directly:</p>
    <pre>import { createRequestHandler } from '@webjsdev/server';

test('GET /api/hello returns JSON', async () =&gt; {
  const app = await createRequestHandler({ appDir: process.cwd(), dev: true });
  const req = new Request('http://x/api/hello');
  const resp = await app.handle(req);
  assert.equal(resp.status, 200);
  const data = await resp.json();
  assert.ok(data.hello);
});</pre>

    <h2>Router Tests</h2>
    <p>Scaffold a temp directory, call <code>buildRouteTable</code>, and assert matches:</p>
    <pre>import { buildRouteTable, matchPage, matchApi } from '@webjsdev/server';

test('matches dynamic routes', async () =&gt; {
  const dir = await scaffoldTempDir({
    'app/blog/[slug]/page.ts': 'export default () =&gt; ""',
  });
  const table = await buildRouteTable(dir);
  const m = matchPage(table, '/blog/hello');
  assert.ok(m);
  assert.deepEqual(m.params, { slug: 'hello' });
});</pre>

    <h2>WebSocket Tests</h2>
    <pre>import { WebSocket } from 'ws';
import { createServer } from 'node:http';
import { buildRouteTable } from '@webjsdev/server';
import { attachWebSocket } from '@webjsdev/server';

test('WS echo works', async () =&gt; {
  const table = await buildRouteTable(dir);
  const server = createServer();
  attachWebSocket(server, () =&gt; table, { dev: false, logger });
  await new Promise(r =&gt; server.listen(0, r));
  const port = server.address().port;
  const ws = new WebSocket(\`ws://localhost:\${port}/api/echo\`);
  // ... assert messages
  server.close();
});</pre>

    <h2>webjs test command</h2>
    <p>The CLI provides a built-in test runner:</p>
    <pre># Run unit tests
webjs test

# Run unit + browser tests (WTR + Playwright)
webjs test --browser</pre>

    <p>It discovers test files by feature folder, with the kind as a subfolder inside the feature only when that kind is present:</p>
    <ul>
      <li><code>test/&lt;feature&gt;/&lt;name&gt;.test.{ts,js,mjs}</code>: unit + integration (node)</li>
      <li><code>test/&lt;feature&gt;/browser/&lt;name&gt;.test.js</code>: browser tests (with the <code>--browser</code> flag)</li>
      <li><code>test/&lt;feature&gt;/e2e/&lt;name&gt;.test.{ts,mjs}</code>: e2e (opt in with <code>WEBJS_E2E=1</code>)</li>
    </ul>

    <h2>Browser Tests (WTR + Playwright)</h2>
    <p>Browser tests launch real Chromium to exercise hydration, the DOM, slots, the client router, and custom-element upgrade. <code>ssrFixture()</code> server-renders a template then hydrates it in the real browser:</p>
    <pre>import { html } from '@webjsdev/core';
import { ssrFixture, assertNoA11yViolations } from '@webjsdev/core/testing';

suite('Example browser tests', () =&gt; {
  test('ssrFixture hydrates a server-rendered button', async () =&gt; {
    const el = await ssrFixture(html\`&lt;button type="button"&gt;Save&lt;/button&gt;\`);
    assert.equal(el.tagName, 'BUTTON');
    assert.ok(el.textContent.includes('Save'));   // label survives hydration
  });

  test('a button with an accessible name has no a11y violations', async () =&gt; {
    const el = await ssrFixture(html\`&lt;button type="button"&gt;Submit form&lt;/button&gt;\`);
    await assertNoA11yViolations(el);              // opt-in a11y check
  });
});</pre>

    <h2>Convention Validation</h2>
    <p><code>webjs check</code> validates your app for correctness issues:</p>
    <pre># Run the correctness checks
webjs check

# List the checks and their descriptions
webjs check --rules</pre>
    <p>Checks include: no browser globals in <code>render()</code> (SSR crash), no non-public <code>process.env</code> in components (leaked secret), reactive props use <code>declare</code> (broken reactivity), <code>Class.register('tag')</code> present, tag names have hyphens, <code>'use server'</code> needs the <code>.server</code> extension, a server-only import in a shipping browser module, and erasable TypeScript only. They always run. Project conventions (layout, testing, styling) are guidance in the shipped skill (<code>.agents/skills/webjs/SKILL.md</code>) and <code>AGENTS.md</code>, not checks. <code>webjs check --rules</code> is the authoritative, current list.</p>

    <h2>Recommended Test Structure</h2>
    <p>Feature folders are primary, and the test kind is a subfolder inside the feature only when that kind is present:</p>
    <pre>test/
  auth/
    auth.test.ts                 # server tests (node:test)
    browser/login-form.test.js   # browser tests (WTR + Playwright)
  posts/
    posts.test.ts
    browser/post-editor.test.js
  hello/
    hello.test.ts                # the scaffold's starter test
    browser/hello.test.js
    e2e/hello.test.ts</pre>

    <h2>AI Agent Testing Convention</h2>
    <p>In a WebJs project, AI agents are expected to write tests automatically with every code change. The convention is defined in <code>AGENTS.md</code> and the shipped skill (<code>.agents/skills/webjs/SKILL.md</code>):</p>
    <ul>
      <li><strong>New server action</strong> needs a unit test (round-trip it through <code>invokeActionForTest</code>).</li>
      <li><strong>New component</strong> needs a unit test (SSR rendering), plus a browser test via <code>ssrFixture()</code> when hydration / DOM / slots matter.</li>
      <li><strong>New page or route</strong> needs an e2e test (or a <code>handle()</code> assertion via <code>testRequest</code>).</li>
      <li><strong>Bug fix</strong> needs a regression test (the counterfactual that fails when reverted).</li>
    </ul>
    <p>The user should never have to ask for tests. They are part of every deliverable.</p>
  `;
}
