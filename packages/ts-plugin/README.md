# @webjskit/ts-plugin

A TypeScript language-service plugin for webjs. Gives editors that speak
`tsserver` (VS Code, Neovim via `nvim-lspconfig` / `typescript-tools.nvim`,
Zed, WebStorm) go-to-definition for custom element tag names used inside
`` html`` `` tagged template literals.

```ts
import { Counter } from './counter.ts';

render(html`
  <my-counter count=${3}></my-counter>
  //  ^ cursor here → `gd` / F12 / Ctrl+Click jumps to the Counter class
`, el);
```

## Why this exists

`ts-lit-plugin` — the standard tsserver plugin for `` html`` `` intelligence —
resolves tag names via the Lit ecosystem's conventions:

- `customElements.define('my-el', MyEl)` direct static calls
- `@customElement('my-el')` decorators
- `declare global { interface HTMLElementTagNameMap { 'my-el': MyEl } }`
- `@customElement my-el` JSDoc

webjs components use none of these at the author site — they use
`static tag = 'my-el'` + a later `MyEl.register()` call. That's
indirection the plugin can't statically trace.

This plugin fills the gap by recognising the `static tag` pattern
directly. It runs *alongside* `ts-lit-plugin` (which still handles
attribute completions, diagnostics, etc.) — this plugin's only job is
tag → class resolution.

## Install

In your webjs app:

```sh
npm i -D @webjskit/ts-plugin
```

Add to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [
      { "name": "ts-lit-plugin", "strict": true },
      { "name": "@webjskit/ts-plugin" }
    ]
  }
}
```

Plugin order matters — list `ts-lit-plugin` first so attribute
intelligence comes from its registry; `@webjskit/ts-plugin` contributes
the definition when ts-lit-plugin's is empty.

After install, make your editor use the **workspace's** TypeScript
(check `:LspInfo` in Neovim, or the TypeScript version indicator in
VS Code's status bar).

## What it recognises

A class counts as a webjs component when:

- It's a `class` declaration (named or exported default).
- It extends an identifier called `WebComponent` (or anything that resolves
  to `@webjskit/core`'s `WebComponent` base).
- It has a `static tag = '<tag-name>'` field with a string literal value
  containing a hyphen (HTML spec requirement).

The plugin walks every `SourceFile` in the `Program` when it's first
asked for a definition and caches the tag → class map keyed by file
version. The map is rebuilt on file change.

## License

MIT
