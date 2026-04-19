# @webjskit/core

Isomorphic core runtime for [webjs](https://github.com/vivek7405/webjs) — an
AI-first, web-components-first, no-build web framework.

This package ships the tagged-template `html` / `css` helpers, the
`WebComponent` base class, the client and server renderers (with Declarative
Shadow DOM support), directives, context protocol, the `Task` controller, and
the client-side navigation router.

Not intended for direct install — you'll usually get it as a transitive dep
when you scaffold an app with [`@webjskit/cli`](https://www.npmjs.com/package/@webjskit/cli).

## Install

```sh
npm install @webjskit/core
```

## Use

```js
import { html, css, WebComponent } from '@webjskit/core';

class Counter extends WebComponent {
  static properties = { count: { type: Number } };
  static styles = css`button { padding: 8px 12px; }`;

  render() {
    return html`<button @click=${() => this.count++}>${this.count}</button>`;
  }
}
customElements.define('x-counter', Counter);
```

Side-channel imports for optional features:

```js
import '@webjskit/core/client-router';            // SPA-style link interception
import { unsafeHTML } from '@webjskit/core/directives';
import { createContext } from '@webjskit/core/context';
import { Task } from '@webjskit/core/task';
```

See the full framework docs at https://github.com/vivek7405/webjs.

## License

MIT
