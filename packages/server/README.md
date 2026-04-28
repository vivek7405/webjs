# @webjskit/server

Dev + production server for [webjs](https://github.com/vivek7405/webjs) —
file-based routing, streaming SSR, server actions, WebSocket upgrades, and
live reload.

Rarely installed directly. Use [`@webjskit/cli`](https://www.npmjs.com/package/@webjskit/cli)
to scaffold and run an app; it pulls this package in as a dependency.

## Features

- **File-based routing** at parity with NextJs App Router — `page.ts`,
  `layout.ts`, `route.ts`, `error.ts`, `loading.ts`, `not-found.ts`,
  `middleware.ts`, `[param]`, `[...slug]`, `(groups)`, `_private`.
- **Streaming SSR** with Suspense boundaries.
- **Server actions** — import a `.server.ts` function from a client component
  and it auto-rewrites into a type-safe RPC stub. webjs's built-in serializer on the wire — Date/Map/Set/BigInt/TypedArray/Blob/File/FormData/cycles all survive.
- **WebSockets** — export `WS` from `route.ts` and it becomes a WebSocket
  endpoint on the same path.
- **Live reload** for dev.
- **Bare-specifier auto-bundling** for npm packages via import maps, backed
  by esbuild (Vite-style `optimizeDeps`).

## Install

```sh
npm install @webjskit/server @webjskit/core
```

## Use

Normally invoked via the CLI:

```sh
webjs dev
webjs start
```

Or programmatically:

```js
import { startServer } from '@webjskit/server';

await startServer({ port: 3000, appDir: process.cwd(), dev: true });
```

See the full framework docs at https://github.com/vivek7405/webjs.

## License

MIT
