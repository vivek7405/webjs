# webjs

A no-build, web-components-first, Next.js-inspired framework. SSR + CSR,
file-based routing, API routes, and server actions — all in plain JS with JSDoc.

> **Heads up:** webjs is pre-alpha. APIs will change. Read [`AGENTS.md`](./AGENTS.md) before editing a webjs app with an AI assistant.

## Why

- **No build.** Your `.js` files are served to the browser as ES modules. Reload and see it.
- **Web components, real SSR.** Components render to Declarative Shadow DOM on the server; the browser upgrades them on connect — no hydration script, no framework runtime in the critical path.
- **Next.js-style routing.** `app/page.js`, `app/[slug]/page.js`, `app/api/foo/route.js`.
- **Server actions.** `actions/*.server.js` exports async functions; import them from a client component and call them — the dev server silently rewrites the import into a typed RPC stub.
- **JSDoc.** No TS, no compile step.
- **Prisma.** Recommended ORM; `webjs db migrate` and `webjs db generate` wrap the Prisma CLI.

## Quickstart

```sh
# from the monorepo root
npm install
cd examples/blog
npx prisma migrate dev --name init   # creates dev.db
npx webjs dev                        # http://localhost:3000
```

## Repo layout

```
packages/
  core/     # webjs — html, css, WebComponent, renderers
  server/   # @webjs/server — dev/prod server, router, SSR, actions
  cli/      # @webjs/cli — `webjs` binary
examples/
  blog/     # reference app exercising every feature
AGENTS.md   # the contract AI agents and humans edit webjs apps against
```

## Tiny example

```js
// app/page.js
import { html } from 'webjs';
import '../components/counter.js';

export default async function Home() {
  return html`<h1>hi</h1><my-counter count="3"></my-counter>`;
}
```

```js
// components/counter.js
import { WebComponent, html, css } from 'webjs';
export class Counter extends WebComponent {
  static tag = 'my-counter';
  static properties = { count: { type: Number } };
  static styles = css`button { font: inherit; }`;
  state = { n: 0 };
  connectedCallback() { super.connectedCallback(); this.setState({ n: this.count || 0 }); }
  render() {
    return html`<button @click=${() => this.setState({ n: this.state.n + 1 })}>${this.state.n}</button>`;
  }
}
Counter.register();
```

That's it — no build, no bundler, no hydration API. SSR prints the button with the initial count; the browser upgrades and clicks increment.

## Docs

Conventions and invariants live in [`AGENTS.md`](./AGENTS.md) at the repo root.
