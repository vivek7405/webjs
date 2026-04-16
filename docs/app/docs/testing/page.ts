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

    <h2>Client Renderer Tests (linkedom)</h2>
    <p>For testing the client-side fine-grained renderer without a real browser, use <code>linkedom</code> as a DOM shim:</p>
    <pre>import { before, test } from 'node:test';
import { parseHTML } from 'linkedom';

before(() =&gt; {
  const { window } = parseHTML('&lt;!doctype html&gt;&lt;html&gt;&lt;body&gt;&lt;/body&gt;&lt;/html&gt;');
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  // ... other globals
});

let html, render;
before(async () =&gt; {
  ({ html } = await import('webjs'));
  ({ render } = await import('webjs/client'));
});

test('preserves element identity on re-render', () =&gt; {
  const el = document.createElement('div');
  const view = (n) =&gt; html\`&lt;p&gt;\${n}&lt;/p&gt;\`;
  render(view(1), el);
  const pre = el.querySelector('p');
  render(view(2), el);
  assert.strictEqual(el.querySelector('p'), pre);
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

    <h2>Recommended Test Structure</h2>
    <pre>test/
  render-server.test.js   # SSR output
  render-client.test.js   # client diffing (linkedom)
  router.test.js          # route matching
  actions.test.js         # server action RPC + CSRF
  csrf.test.js            # token generation + verification
  expose.test.js          # expose() + validate hook
  suspense.test.js        # Suspense boundary rendering
  rate-limit.test.js      # rateLimit middleware
  websocket.test.js       # WS upgrade + handler</pre>
  `;
}
