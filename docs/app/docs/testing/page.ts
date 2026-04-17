import { html } from 'webjs';

export const metadata = { title: 'Testing — webjs' };

export default function Testing() {
  return html`
    <h1>Testing</h1>
    <p>webjs uses Node's built-in <code>node:test</code> runner — no external test framework needed. The framework itself ships with 70+ tests covering the server renderer, router, actions, CSRF, client diffing, and more.</p>

    <h2>Running Tests</h2>
    <pre># from the webjs monorepo root
npm test
# or directly:
node --test test/*.test.js</pre>

    <h2>Server-Side Tests</h2>
    <p>Test your server actions, queries, and utilities directly — they're just async functions:</p>
    <pre>import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listPosts } from '../modules/posts/queries/list-posts.server.ts';

test('listPosts returns an array', async () =&gt; {
  const posts = await listPosts();
  assert.ok(Array.isArray(posts));
});</pre>

    <h2>Renderer Tests</h2>
    <p>Test <code>renderToString</code> for SSR output:</p>
    <pre>import { html, renderToString } from 'webjs';

test('renders template with interpolation', async () =&gt; {
  const out = await renderToString(html\`&lt;p&gt;\${'hello'}&lt;/p&gt;\`);
  assert.match(out, /&lt;p&gt;hello&lt;\\/p&gt;/);
});

test('escapes text content', async () =&gt; {
  const out = await renderToString(html\`&lt;p&gt;\${'&lt;script&gt;'}&lt;/p&gt;\`);
  assert.match(out, /&amp;lt;script&amp;gt;/);
});</pre>

    <h2>Router Tests</h2>
    <p>Scaffold a temp directory, call <code>buildRouteTable</code>, and assert matches:</p>
    <pre>import { buildRouteTable, matchPage, matchApi } from '@webjs/server';

test('matches dynamic routes', async () =&gt; {
  const dir = await scaffoldTempDir({
    'app/blog/[slug]/page.ts': 'export default () =&gt; ""',
  });
  const table = await buildRouteTable(dir);
  const m = matchPage(table, '/blog/hello');
  assert.ok(m);
  assert.deepEqual(m.params, { slug: 'hello' });
});</pre>

    <h2>Browser Tests (WTR + Playwright)</h2>
    <p>Client-side tests run in <strong>real Chromium</strong> via Web Test Runner + Playwright. No fake DOM — full Shadow DOM, events, adoptedStyleSheets, everything works.</p>
    <pre>// test/browser/renderer.test.js — runs in real Chromium
import { html } from '../../packages/core/src/html.js';
import { render } from '../../packages/core/src/render-client.js';

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

    <h2>API Route Tests</h2>
    <p>Use <code>fetch</code> against a running dev/test server, or call route handlers directly:</p>
    <pre>import { createRequestHandler } from '@webjs/server';

test('GET /api/hello returns JSON', async () =&gt; {
  const app = await createRequestHandler({ appDir: process.cwd(), dev: true });
  const req = new Request('http://x/api/hello');
  const resp = await app.handle(req);
  assert.equal(resp.status, 200);
  const data = await resp.json();
  assert.ok(data.hello);
});</pre>

    <h2>WebSocket Tests</h2>
    <pre>import { WebSocket } from 'ws';
import { createServer } from 'node:http';
import { buildRouteTable } from '@webjs/server';
import { attachWebSocket } from '@webjs/server';

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
npx webjs test

# Run unit + browser tests (WTR + Playwright)
npx webjs test --browser</pre>

    <p>It discovers test files automatically:</p>
    <ul>
      <li><code>test/unit/*.test.{ts,js}</code> — unit tests</li>
      <li><code>test/browser/*.test.{ts,js}</code> — E2E tests (with <code>--browser</code> flag)</li>
      <li><code>test/*.test.{ts,js}</code> — root-level tests (flat layout)</li>
    </ul>

    <h2>Browser Tests (WTR + Playwright)</h2>
    <p>E2E tests launch a real browser to test full user flows:</p>
    <pre>import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

describe('Contact form', () =&gt; {
  // Tests run in real Chromium via Playwright
  before(async () =&gt; { /* ... */ });
  after(async () =&gt; { /* cleanup */ });

  test('user can submit the form', async () =&gt; {
    await page.goto(baseUrl + '/contact');
    await page.type('input[name="email"]', 'test@example.com');
    await page.click('button[type="submit"]');
    // Assert success message appears
  });
});</pre>

    <h2>Convention Validation</h2>
    <p><code>webjs check</code> validates your app against conventions:</p>
    <pre># Check all conventions
npx webjs check

# List available rules
npx webjs check --rules</pre>
    <p>Rules include: actions in modules, one function per action file, components have <code>.register()</code>, no server imports in client code, tests exist for modules, tag names have hyphens.</p>
    <p>Override rules in <code>package.json</code>:</p>
    <pre>{ "webjs": { "conventions": { "tests-exist": false } } }</pre>

    <h2>Recommended Test Structure</h2>
    <pre>test/
  unit/
    auth.test.ts            # server tests (node:test)
    posts.test.ts
  browser/
    components.test.js      # browser tests (WTR + Playwright)
    navigation.test.js
web-test-runner.config.js   # WTR config</pre>

    <h2>AI Agent Testing Convention</h2>
    <p>In a webjs project, AI agents are expected to write tests automatically with every code change. The convention is defined in <code>CONVENTIONS.md</code>:</p>
    <ul>
      <li><strong>New server action</strong> → unit test required</li>
      <li><strong>New component</strong> → unit test (SSR rendering) required</li>
      <li><strong>New page or route</strong> → E2E test required</li>
      <li><strong>Bug fix</strong> → regression test required</li>
    </ul>
    <p>The user should never have to ask for tests — they are part of every deliverable.</p>
  `;
}
