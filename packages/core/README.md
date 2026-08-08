# @webjsdev/core

Isomorphic core runtime for [webjs](https://github.com/webjsdev/webjs), the
AI-first, web-components-first, no-build web framework.

This package ships the tagged-template `html` / `css` helpers, the
`WebComponent` base class, the client and server renderers (with Declarative
Shadow DOM support), directives, context protocol, the `Task` controller, and
the client-side navigation router.

Not intended for direct install. You'll usually get it as a transitive dep
when you scaffold an app with [`@webjsdev/cli`](https://www.npmjs.com/package/@webjsdev/cli).

## Install

```sh
npm install @webjsdev/core
```

## Use

```js
import { html, css, WebComponent } from '@webjsdev/core';

class Counter extends WebComponent({ count: Number }) {
  static styles = css`button { padding: 8px 12px; }`;

  render() {
    return html`<button @click=${() => this.count++}>${this.count}</button>`;
  }
}
Counter.register('x-counter');
```

`Class.register('tag-name')` is the webjs idiom. It calls
`customElements.define()` under the hood and adds tag validation,
registry bookkeeping (needed for lazy-loading), and a dev-time
double-register warning. Plain `customElements.define('x-counter',
Counter)` works identically.

Side-channel imports for optional features:

```js
import { unsafeHTML } from '@webjsdev/core/directives';
import { createContext } from '@webjsdev/core/context';
import { Task } from '@webjsdev/core/task';
```

See the full framework docs at https://github.com/webjsdev/webjs.

## Layout in the tarball

The tarball ships both `src/` and `dist/`. The browser fetches the
framework as ONE self-contained bundle, `dist/webjs-core-browser.js`,
instead of waterfalling through 15+ source files or a fan of code-split
chunks. That single file re-exports the whole browser surface (html,
render, WebComponent, the client router, directives, context, task,
signals), so the `@webjsdev/core`, `/directives`, `/context`, `/task`,
and `/client-router` specifiers all resolve to it and each import picks
its named exports. `splitting` is off, so there are no `chunk-*.js`. The
only other browser file is `dist/webjs-core-lazy-loader.js`, fetched
on-demand for `static lazy = true` components. SSR / Node resolve the
full surface via the package `exports` `default`. The readable `src/`
stays on disk so AI agents can grep it directly.

The bare `@webjsdev/core` specifier resolves to a BROWSER-only
entry (`dist/webjs-core-browser.js` in production, `index-browser.js`
in source-mode dev). The browser entry drops the server-only
`render-server.js` (~1.1k lines) and the three server-side setters
(`setCspNonceProvider`, `setAssetUrlProvider`, `setFormActionResolver`)
so server bytes never ride the wire.
Node-side consumers resolve via the package's `default` condition
and land on `index.js`, which keeps the full surface for the SSR
pipeline and unit tests. `renderToString` and `renderToStream` are
also available at the explicit `@webjsdev/core/server` subpath.

The bundle is built ONCE at `npm publish` time on the author's
machine via esbuild as a publish-time devDependency. User installs
never invoke a bundler. If you install the package via a git
dependency (`npm install github:webjsdev/webjs`), the `prepare`
lifecycle runs on your machine to produce the bundle; esbuild is
in `devDependencies` so it's available for that case.

## License

MIT
