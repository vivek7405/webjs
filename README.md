# webjs

A no-build, web-components-first, Next.js-inspired full-stack framework.
SSR + CSR, file-based routing, API routes, server actions — plain JavaScript
with JSDoc, zero bundler, ships ES modules straight to the browser.

## Why

- **No build.** Your `.js` files are served to the browser as ES modules.
  Edit, refresh, done.
- **Web components first.** Components define their own custom element +
  shadow-DOM styles. SSR emits Declarative Shadow DOM; the browser upgrades
  on connection — no hydration runtime in the critical path.
- **Next.js-style routing.** `app/page.js`, `app/[slug]/page.js`,
  `app/api/foo/route.js`, `app/error.js`, `app/not-found.js`, `(group)`,
  `_private`, layouts, async pages, `metadata`, `notFound()`, `redirect()`.
- **Server actions, both ways.** Import a `.server.js` function from a
  client component → it auto-rewrites into a CSRF-protected RPC stub.
  Wrap the same function in `expose('POST /api/posts', fn, { validate })` →
  it's also a first-class REST endpoint for external consumers. **One
  function, two callers, no `route.js` wrapper.**
- **Fine-grained client renderer.** Re-renders touch only the parts that
  changed; element identity, focus, cursor, scroll, and form state survive
  state updates. `repeat(items, key, tpl)` does keyed list reconciliation.
- **Production batteries.** CSRF on action RPC, error sanitisation in prod,
  graceful shutdown, Cache-Control + ETag on static assets, gzip/brotli
  negotiation, health endpoint, pluggable JSON logger, programmatic
  `createRequestHandler` for embedding.
- **Prisma + SQLite by default.** Schema-first via `webjs db migrate` /
  `webjs db generate` (Prisma CLI under the hood).

## Quickstart

```sh
git clone <this-repo> webjs && cd webjs
npm install                         # links workspaces

cd examples/blog
npx prisma migrate dev --name init  # create dev.db
npx webjs dev                       # http://localhost:3000
```

Open the home page, create a post via the form, watch the counter
component, then try:

```sh
curl http://localhost:3000/api/posts                  # GET — exposed action
curl -X POST http://localhost:3000/api/posts \        # POST — same function
  -H "content-type: application/json" \
  -d '{"title":"Hello","body":"World"}'
curl http://localhost:3000/__webjs/health             # health probe
```

## Repo layout

```
packages/
  core/     # webjs — html, css, WebComponent, isomorphic renderers, repeat,
            #         expose, notFound, redirect
  server/   # @webjs/server — dev/prod server, router, SSR, actions, csrf,
            #                 logger, compression, createRequestHandler
  cli/      # @webjs/cli — `webjs` binary
examples/
  blog/     # reference app exercising every feature
AGENTS.md   # the contract for AI agents and humans editing webjs apps
```

## Tiny example

```js
// app/page.js
import { html, repeat } from 'webjs';
import '../components/counter.js';
import { listPosts } from '../actions/posts.server.js';

export const metadata = { title: 'home' };

export default async function Home() {
  const posts = await listPosts();
  return html`
    <h1>posts</h1>
    <ul>
      ${repeat(posts, p => p.id, p => html`<li>${p.title}</li>`)}
    </ul>
    <my-counter count="3"></my-counter>
  `;
}
```

```js
// components/counter.js
import { WebComponent, html, css } from 'webjs';

export class Counter extends WebComponent {
  static tag = 'my-counter';
  static properties = { count: { type: Number } };
  static styles = css`button { font: inherit; }`;
  constructor() { super(); this.count = 0; }
  bump(d) { this.count += d; this.requestUpdate(); }
  render() {
    return html`
      <button @click=${() => this.bump(-1)}>−</button>
      <output>${this.count}</output>
      <button @click=${() => this.bump(1)}>+</button>
    `;
  }
}
Counter.register();
```

```js
// actions/posts.server.js
'use server';
import { expose } from 'webjs';
import { db } from './_db.js';

export const listPosts = expose('GET /api/posts', async () =>
  db.post.findMany({ orderBy: { createdAt: 'desc' } })
);

export const createPost = expose(
  'POST /api/posts',
  async ({ title, body }) => db.post.create({ data: { title, body, slug: slugify(title) } }),
  { validate(input) {
      if (!input?.title || !input?.body) throw new Error('title and body required');
      return input;
    }
  }
);
```

That's the whole stack: page renders posts, component handles client
interactivity, action serves both internal RPC and external REST.

## Production

```sh
cd examples/blog
npx prisma migrate deploy
npx webjs start --port 8080   # JSON logs to stdout, gzip/brotli, ETag, …
```

Health endpoint: `GET /__webjs/health`. Graceful shutdown on `SIGTERM`.

To embed inside an existing Node server:

```js
import { createRequestHandler } from '@webjs/server';
const app = await createRequestHandler({ appDir: process.cwd() });
// Express:
expressApp.use(async (req, res) => {
  const webReq = new Request(`http://${req.headers.host}${req.url}`, { … });
  const resp = await app.handle(webReq);
  // pipe resp into res
});
```

## Status

Pre-1.0. The core architecture is stable; expect surface-area churn around
ergonomics. See `AGENTS.md` for the full convention contract and the list
of features deliberately deferred (streaming, bundling, RSC tree serialisation).

## Tests

```sh
npm test              # 42+ unit tests across renderer, router, actions,
                      # csrf, expose, repeat, fine-grained client diffing
```
