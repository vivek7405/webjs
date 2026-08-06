# Components

## What This Covers

- Declaring reactive properties through the `WebComponent({ ... })` factory and `prop()`, with options (`reflect`, `state`, `attribute`, `default`, `converter`, `hasChanged`)
- Signals as the default state primitive for component-local and shared state, plus `effect` / `batch`
- The Lit-aligned lifecycle and exactly which hooks SSR runs versus skips
- Light DOM (default) versus shadow DOM, and the light-host `display: block` rule
- Slots with full shadow-DOM parity in both DOM modes
- `async render()`: SSR-blocking first paint, client stale-while-revalidate, `renderFallback()` / `renderError()`
- `Task` for client-only async data, and context (`createContext` / `ContextProvider` / `ContextConsumer`) to avoid attribute drilling
- The lit-html directive set (`repeat`, `watch`, `live`, `keyed`, `guard`, `cache`, `until`, `unsafeHTML`, `ref`, `asyncAppend` / `asyncReplace`, `templateContent`)
- Display-only elision (when a component is stripped from the browser)
- Inherited members app code must NOT shadow (`title`, `remove`, `render`, ...)

Read this when you are authoring or reviewing a `WebComponent`. For styling a component (Tailwind, the tag-prefix rule, host sizing) see `styling.md`. For streaming a slow region or programmatic navigation see `client-router-and-streaming.md`. For Lit habits that break WebJs see `muscle-memory-gotchas.md`.

## Reactive properties: the base-class factory

Reactive properties are declared by passing their shape into `WebComponent({ ... })`. The types flow automatically to `this.<prop>`, so there is NO `static properties` block and NO `declare` line (a `static properties` block throws at runtime, caught by `no-static-properties`).

```ts
import { WebComponent, prop, html } from '@webjsdev/core';

class Dialog extends WebComponent({
  open: prop(Boolean, { reflect: true }),                       // reflects to the `open` attribute
  showClose: prop(Boolean, { attribute: 'show-close-button' }), // custom attribute name
  variant: prop<'info' | 'danger'>(String, { reflect: true }),  // narrowed union type
  student: prop<Student>(Object),                               // narrowed object type
  items: prop<Tag[]>(Array),                                    // array-typed prop uses Array, not Object
  internal: prop({ state: true }),                             // internal state, no attribute, no type
}) {
  constructor() {
    super();
    this.open = false;             // set defaults in the constructor, after super()
    this.student = { name: '', email: '' };
    this.items = [];
  }
  render() {
    return html`<button ?disabled=${!this.open}>${this.variant}</button>`;
  }
}
Dialog.register('ui-dialog');
```

The bare form is shorthand: `count: Number` means `prop(Number)`. Use `prop()` to pass options or narrow the TS type.

| Option | Default | Meaning |
|---|---|---|
| `type` | `String` | Constructor feeding the default attribute converter |
| `reflect` | `false` | Property changes write back to the HTML attribute (a function value removes it instead, see below) |
| `state` | `false` | Internal-only. No attribute, not observed |
| `attribute` | derived from name | The HTML attribute name the property rides |
| `default` | none | Declarative initial value (a function runs per instance for a fresh object / array) |
| `hasChanged` | strict `!==` | Custom change detection |
| `converter` | type-based | Custom attribute-to-property serialization |

For an array-typed prop pass `Array`, not `Object` (`array-prop-uses-array-type` flags the `Object` form). For anything the built-in converters cannot parse (Date, Map, Set) supply a `converter`.

**A `reflect: true` property holding a FUNCTION drops its attribute instead of writing one, and so does one holding an array that carries a function, unless the prop is `Object` or `Array` typed.** A function has no HTML attribute representation, and the serializations it would otherwise get are both useless and dangerous. `String(fn)` is the function's SOURCE, so a reflected `'use server'` action would ship its whole body, closure secrets included, to every visitor, and `JSON.stringify(fn)` is `undefined`, which lands in the attribute as the literal four-character string. So the reflection path treats a function like `null`, removes the attribute, and warns naming the property, the tag, and the attribute. This holds on both sides, since SSR and the client-side setter run the same path, and it holds for every property name (the leak was never specific to one called `action`). Two exceptions. A property with a custom `converter.toAttribute` runs that converter first and is left alone, because an author who writes one has taken responsibility for serializing whatever they are handed. And an `Object` or `Array` typed property CARRYING a function keeps its data, because `JSON.stringify` drops the function to `null` and omits the key, so `[1, 2, fn]` reflects as `[1,2,null]` with no source and nothing else lost. If you need a function on a component, use a plain property or a signal and do not mark it `reflect`.

**Never use a class-field declaration OR initializer** (`count = 0`, `student: Student = {...}`, `todos!: Todo[]`). Under `useDefineForClassFields` even a type-only `todos!: Todo[]` compiles to define an own property after `super()`, which clobbers the prototype's reactive accessor and silently breaks reactivity. Only declare props in the factory and read/write them off `this`. The `reactive-props-no-class-field` rule catches this.

## Signals are the default state primitive

Reserve the factory for values that ride an HTML attribute, reflect to one, or arrive via `.prop=${value}` SSR hydration. For everything else use signals.

```ts
import { signal, computed } from '@webjsdev/core';

const cart = signal<Item[]>([]);                 // module-scope: shared across components, survives navigations
const count = computed(() => cart.get().length); // derived
```

Read with `signal.get()` inside `render()`; the built-in `SignalWatcher` tracks the read and re-renders on change. An instance signal created in the constructor is component-local. For a fine-grained DOM swap use `${watch(signal)}` from `@webjsdev/core/directives`.

Two more signal primitives from `@webjsdev/core` cover client-side reactions and batched writes:

- `effect(fn)` runs `fn` now and re-runs it whenever a signal it read changes. It is a BROWSER-ONLY side-effect primitive (a subscription, a `document.title` sync, an analytics ping), not a render path. It returns a disposer, so create it in `connectedCallback` and call the disposer in `disconnectedCallback` to avoid a leak.
- `batch(fn)` coalesces several `.set()` writes inside `fn` into ONE re-render instead of one per write. Reach for it when a handler updates multiple signals at once.

```ts
import { signal, effect, batch } from '@webjsdev/core';
const open = signal(false), count = signal(0);
connectedCallback() { super.connectedCallback(); this.dispose = effect(() => { document.title = `(${count.get()})`; }); }
disconnectedCallback() { super.disconnectedCallback(); this.dispose?.(); }
reset() { batch(() => { open.set(false); count.set(0); }); }   // one re-render, not two
```

## Lifecycle (Lit-aligned) and what SSR runs

Each update cycle runs these in order; each receives a `changedProperties` Map.

| # | Hook | When |
|---|---|---|
| 1 | `shouldUpdate(changed)` | Return `false` to skip. Default `true`. |
| 2 | `willUpdate(changed)` | Pre-render. Assignments here fold into THIS cycle. |
| 3 | `update(changed)` | Default calls `render()` + commits. Override rarely. |
| 4 | `firstUpdated(changed)` | Once, on the first render only. |
| 5 | `updated(changed)` | Every commit. Ad-hoc post-render DOM work. |
| 6 | `updateComplete` resolves | `await el.updateComplete` to read post-render DOM in tests. |

**SSR runs only the value-deriving path**: the constructor, attribute application, `willUpdate` (and controllers' `hostUpdate`), `reflect: true` reflection, then `render()`. It does NOT invoke `connectedCallback`, `disconnectedCallback`, `firstUpdated`, `updated`, `update`'s DOM commit, `hostUpdated`, or `shouldUpdate`. So set first-paint defaults in the constructor, derive SSR-visible state in `willUpdate`, and keep browser-only work (DOM queries, layout, `localStorage`, viewport) in `connectedCallback` / `firstUpdated`. A browser global in the constructor or `render()` throws at SSR (flagged by `no-browser-globals-in-render`; attribute methods and `closest()` are shimmed).

## Light DOM (default) vs shadow DOM

Light DOM is the default: global CSS and Tailwind utilities apply directly, no `:host` or CSS-var plumbing. Set `static shadow = true` only for `static styles = css\`...\`` scoped styles, third-party embed isolation, or the native `::slotted()` selector.

```ts
class Panel extends WebComponent({ label: String }) {
  static shadow = true;
  static styles = css`:host { display: block } .body { padding: 16px }`;
  render() { return html`<div class="body">${this.label}</div>`; }
}
```

- A light-DOM component authoring custom CSS MUST prefix every class selector with its tag name (`.my-card__body` or `my-card .body`). Prefer Tailwind, unique by construction. `static styles` on a light-DOM component is silently ignored.
- **Never interpolate into a component's `<style>` or `<script>` body** (`html\`<style>${x}</style>\``). The server emits it but the client drops the raw-text hole, so it paints then wipes to empty on hydrate (flagged by `no-interpolation-in-raw-text-element`). Use `static styles` or Tailwind.
- Light-DOM hosts are marked `display: block` via one low-priority `@layer webjs-host` rule (overridable by any Tailwind utility). Shadow hosts are NOT marked; set `:host { display: block }` in `static styles`. Size the HOST (put `w-full max-w-[...]` on the render root), not only an inner wrapper. See `styling.md`.

## Slots

The full `<slot>` surface works in light DOM with shadow-DOM parity; migrating modes never requires a template rewrite. A forwarded slot projects its content everywhere (client, SSR, hydration).

**A tag name inside an HTML comment is not instantiated.** `<!-- <my-card> is the wrapper -->` documents the template and renders no component, the same as in a browser. That holds for component tags, `<slot>`, and `<webjs-suspense>`. It extends to attribute values and to every element whose content the HTML parser reads as text rather than markup: `<script>`, `<style>`, `<iframe>`, `<xmp>`, `<noembed>`, `<noframes>`, `<plaintext>`, `<textarea>`, `<title>`. (Before #1128 a commented tag was constructed as a real element and ate the rest of the comment along with the markup after it, so an ordinary explanatory comment could silently delete part of the page.)

Two elements are deliberately excluded, and the second matters more. `<template>` content IS parsed and legitimately carries components, which is what Declarative Shadow DOM and streamed swaps rely on. `<noscript>` content is also parsed, because a browser with scripting disabled reads it as markup, and that is the case a progressive-enhancement framework exists to serve, so components inside `<noscript>` render normally.

Element nesting respects comments too: a comment holding the open or close tag of the element it sits inside (`<my-card>kid<!-- </my-card> --></my-card>`) rides along as content, and the element still ends at its real close tag. Script bodies follow the parser's double-escape rule, so the legacy `<!-- <script>... -->` wrapper pattern stays text to its true end.

```ts
class MyCard extends WebComponent {
  render() {
    return html`
      <header><slot name="header"></slot></header>
      <main><slot></slot></main>
      <footer><slot name="footer">no actions</slot></footer>`;
  }
}
```

Named slots, the default slot (unnamed children, text, comments), fallback content (a slot's inner markup when nothing matches), and first-wins resolution all behave per spec. The DOM API mirrors shadow slots: `assignedNodes` / `assignedElements` (with `{ flatten: true }`), `element.assignedSlot`, and the `slotchange` event. Both modes are SSR'd (light DOM places children into `<slot data-webjs-light data-projection="actual">`, shadow DOM via Declarative Shadow DOM), so slotted content renders with no JS.

**Light-DOM slots ARE the native DOM slot API (#1021, full shadow parity).** There is no WebJs-specific slot API. Post-mount writes are live exactly as in shadow DOM, and moving a component between `static shadow = false` and `true` never needs a rewrite:

```ts
const card = document.querySelector('my-card');
card.appendChild(node);                         // live, projected
card.querySelector('[slot=old]').slot = 'new';  // flip re-projects
card.innerHTML = '<p>replaced</p>';             // replaces slotted content
card.querySelector('slot').assignedNodes();     // read, mirrors shadow
node.assignedSlot;
card.querySelector('slot').addEventListener('slotchange', ...); // async + coalesced
```

Things to internalize. (1) Every native mutation is live: `appendChild` / `insertBefore` / `removeChild` / `el.remove()` / `innerHTML` / `el.slot=` flip / `HTMLSlotElement.assign()`. Reorder-by-append moves a child to the end (native semantics), a fragment expands and drains, and `insertBefore` against a renderer/non-child ref throws `NotFoundError`. One caveat rides `assign()`: the light-DOM version is an EXTENSION (an element-bound overlay while name matching keeps working), and native shadow `assign()` needs `slotAssignment: 'manual'` which WebJs does not set, so `assign()` is the one write that does NOT survive flipping to `static shadow = true`; avoid it in mode-portable components. (2) Four inherent gaps (from light DOM having no shadow boundary). The gaps: structural host reads (`host.children` / `host.childNodes` / `querySelector(':scope > ...')` / the `innerHTML` GETTER read the rendered template, not the authored children, so read slotted content with `assignedNodes()`); `assignedChild.parentNode` is the `<slot>`; `::slotted()` CSS is shadow-only (style slotted content with normal selectors / Tailwind); and initial-projection lifecycle timing (`firstUpdated` sees the `<slot>` element with EMPTY `assignedNodes()`, because the first light-DOM projection lands one microtask after the first render, where shadow DOM projects natively before it; read assigned content from a `slotchange` listener or after a microtask). (3) Conditional-on-slot at render time does not exist in EITHER mode (a shadow template can't branch on light-child presence at render time either); use CSS `:has()` / `slot:empty` or a `slotchange` listener. (4) The name `default` is a reserved alias for the default slot; do not name a slot `default`. (5) A display-only slotted wrapper still elides; a component whose slots are mutated at runtime is already shipped because a consumer references its tag (force a ship with `static interactive = true` only for a dynamically-resolved reference the analyser cannot see). (6) A generic DOM library should operate on the assigned nodes, never on the host element itself; writes into an ACTIVELY ASSIGNED slot container are folded into the record (self-heal), while a fallback-mode slot's content is renderer-owned and out of contract. (7) A FORWARDED slot projects its content everywhere (#1023): a template may forward a slot into a nested component (html`<inner-shell><slot></slot></inner-shell>`), and the outer component's content projects through it on a client-only mount, in the SSR first paint, and across hydration (no flash back to fallback). The renderer stamps each slot with its template owner (carried across SSR as `data-wj-slot-owner`), so a forwarded slot routes to the outer host that rendered it, not the child it nests in. (8) A LAYOUT's named slots stay in sync across soft navigation (#1024): when a layout renders its `${children}` inside a slotted shell and a page emits top-level `slot=`-attributed children, the named-slot slices update on a soft-nav boundary swap just as the default slice does (the swap resyncs every own slot of the enclosing shell from the incoming page).

A compound child reads its parent at the first server paint via `closest('ui-tabs')` (only tag-name selectors resolve at SSR, and the compound parent must be light DOM). Genuine live-DOM reads (`querySelector`, `classList`, geometry) still throw at SSR, so keep them in `connectedCallback` / `firstUpdated`.

## Async render: first-paint server data

`render()` may be `async`, so a leaf component fetches its own server data into the first paint with no prop-drilling.

```ts
class UserActivity extends WebComponent({ uid: String }) {
  renderFallback() { return html`<div class="skeleton h-24"></div>`; } // optional, re-fetch only
  async render() {
    const items = await getActivity(this.uid); // 'use server' action: real fn at SSR, RPC stub on client
    return html`<ul>${items.map((i) => html`<li>${i.label}</li>`)}</ul>`;
  }
}
```

Three decoupled concerns, do not conflate them.

1. **SSR always blocks by default.** The server awaits `async render()`, so the resolved data is baked into the first paint. There is no first-paint fallback, ever (a progressive-enhancement upgrade over a client-fetched `Task`).
2. **The client re-fetch default is stale-while-revalidate.** When a prop or dependency change re-runs `async render()`, the previous content stays until the new render resolves. No blank, no flash, no user code.
3. **`renderFallback()` is the OPTIONAL re-fetch loading UI.** Shown ONLY during a client re-fetch, NEVER on first paint, and it does NOT create a server-streaming boundary.

Errors are isolated per component by default (no user code): a thrown `await` renders a component-scoped error state while siblings render, never bubbling to the route `error.ts`. Override `renderError(error)` only to customize it (dev shows the message, prod stays silent). The boundary covers the COMMIT as well as the fetch, so a template that throws while being applied (a refused binding, a value whose `toString` throws) reaches `renderError()` too, and `updateComplete` still settles. Those two halves used to disagree: a fetch rejection was contained and a commit throw escaped as an unhandled rejection that also left `updateComplete` pending forever.

The boundary also covers `watch(signal)` (its notify microtask) and `until()` (its promise resolution), which commit outside the update cycle. A throw from either used to surface at the window instead of the owning component. It routes to the component whose TEMPLATE holds the binding, which is not always the element the binding sits inside: `html`<child-el>${watch(sig)}</child-el>`` belongs to the parent that wrote it, not to `child-el`. `asyncAppend` / `asyncReplace` is the third such site and is covered the same way: a chunk's own commit throw, and a `watch` / `until` nested inside a chunk, both reach the owning component's `renderError()`. A chunk's own commit throw also STOPS the stream, since the boundary is about to render an error state and appending into a region it may have replaced is not a recovery; a nested directive throws from its own handler outside that loop, so it reaches the boundary but does not stop the stream, the same as a directive nested anywhere else. What stays at `console.error` is the author's own code, the iterable AND any `mapper` passed alongside it, on the standing reasoning that an author's iterable should handle its own errors. That ends the stream too, and always has. With a bare `render()` into a plain container there is no component to receive a commit throw, so it surfaces rather than being swallowed, which is what `watch` and `until` already do.

**A commit that throws leaves the directive's own state consistent, so the NEXT valid render is correct.** This matters because the corruption is otherwise silent: the renders that expose it are fully valid and log nothing after the first throw. The hole whose commit threw is marked so the next render re-applies it rather than skipping it as unchanged (its recorded value is never advanced past a throw, and would otherwise match exactly what the recovering render supplies, leaving a child region blank for good). Both list reconcilers additionally repair their own bookkeeping so it describes the DOM again, and the next render is an ordinary reconcile rather than a rebuild of the region, which would discard the node identity the reconcilers exist to preserve. `repeat()` re-unites its key map and repositions every row (the failure was a permanently duplicated row). A plain `.map()` array splices the part of its slot list the failed pass never reached back on, which matters whenever a slot is REPLACED rather than updated in place (its template shape changed, its kind changed between text, template and empty, or the array grew past its old length), since that is the branch that inserts the replacement before removing what it replaced (the failure was a stranded row that outlived even a render of an empty array). `guard()` records its new deps only once the commit succeeds, so a later render with those same deps re-renders the region instead of short-circuiting past a region the throw had blanked; `until()` advances its resolved priority only after the commit succeeds, so a failed high-priority resolution does not refuse the lower-priority one behind it.

**Teardown is total as well.** Removing a row is not a commit and has no retry, so a throw while tearing one down cannot be allowed to abandon the rest. Unbinding a `ref` during teardown can never abort the removal of the remaining rows, and `repeat()` drops each leftover key from its map before touching that row, so the map never describes a row that has already been removed (which used to leave the row the app DELETED on screen, reorder the survivors, and let a later render that re-added that key reinsert the disposed instance). To make that hold, a `ref` whose object `value` setter throws is now SWALLOWED on teardown, matching the ref CALLBACK, which was already swallowed everywhere. That is a deliberate divergence from lit, which guards neither and propagates from both. It applies to teardown only: on the COMMIT path a throwing object-ref setter still reaches `renderError()`, because there the boundary can report it and the next render can repair it. Total also means a removal takes the row's own boundary markers with it, so a list that grows and shrinks all day is net zero on the nodes the renderer added, rather than accruing one invisible comment per removed row for the life of the region.

Decision rules. Use `async render()` for request-time server data that should be in the first paint (the default). Add `renderFallback()` when a client re-fetch's stale content would mislead. Use `Task` / signals for genuinely client-only data (a click, viewport, live updates). For SLOW data where blocking the first byte hurts, wrap the region in `<webjs-suspense .fallback=${html\`Loading...\`}>` to stream it (the only way to show a first-paint fallback; see `client-router-and-streaming.md`). Do NOT fetch in `connectedCallback` for data knowable server-side, and do NOT prop-drill what a leaf can fetch itself.

## Task: client-only async data

For async data that is genuinely CLIENT-only (it depends on a click, viewport, or a live source, so `async render()` cannot bake it in at SSR), use the `Task` reactive controller. It shows its pending state at SSR (staying `INITIAL`), then runs in the browser.

```ts
import { Task, TaskStatus } from '@webjsdev/core/task';

class SearchResults extends WebComponent({ q: String }) {
  #search = new Task(this, {
    task: async ([q], { signal }) => (await fetch(`/api/s?q=${q}`, { signal })).json(),
    args: () => [this.q],   // the args array spreads into the task's first parameter
  });
  render() {
    switch (this.#search.status) {
      case TaskStatus.PENDING: return html`<p>Searching...</p>`;
      case TaskStatus.ERROR:   return html`<p>${this.#search.error.message}</p>`;
      case TaskStatus.COMPLETE: return html`<ul>${this.#search.value.map((r) => html`<li>${r.title}</li>`)}</ul>`;
      default: return html`<p>Type to search.</p>`;   // INITIAL (also the SSR state)
    }
  }
}
```

`args()` re-runs the task whenever its return changes; call `this.#task.run()` to trigger it manually. `TaskStatus` is `INITIAL` / `PENDING` / `COMPLETE` / `ERROR`. Prefer `async render()` for server data that should be in the first paint; reach for `Task` only when the data cannot exist until the browser runs.

## Context: share state without attribute drilling

When a value must reach a deep descendant without threading it through every intermediate component's attributes, use context (from `@webjsdev/core/context`). This is a CLIENT-TIME concern: a provider publishes on connect, so context is empty at SSR. For server-known data, pass it through the page function or a `.prop` instead (see `muscle-memory-gotchas.md`).

```ts
import { createContext, ContextProvider, ContextConsumer } from '@webjsdev/core/context';

export const themeContext = createContext<'light' | 'dark'>('theme');

class ThemeRoot extends WebComponent({}) {
  #provider = new ContextProvider(this, { context: themeContext, initialValue: 'dark' });
  toggle() { this.#provider.setValue(this.#provider.value === 'dark' ? 'light' : 'dark'); }
}

class ThemedCard extends WebComponent({}) {
  #theme = new ContextConsumer(this, { context: themeContext, subscribe: true }); // re-renders on change
  render() { return html`<div class=${this.#theme.value === 'dark' ? 'bg-black' : 'bg-white'}>...</div>`; }
}
```

`subscribe: true` re-renders the consumer on every provider change; omit it for a one-shot read. A component can also fire a `ContextRequestEvent` to pull a value imperatively.

## Directives (lit-html parity)

Import from `@webjsdev/core/directives`. Everything a `class`/`style`/conditional needs is plain JS (`classMap` is `class=${cond ? 'a' : 'b'}`, `when` is a ternary, `map` is `.map`); reach for a directive only for the jobs below.

| Directive | Use it for |
|---|---|
| `repeat(items, keyFn, tpl)` | A keyed list where items reorder / insert / remove (preserves DOM + state per key). A static list is a plain `.map`. |
| `watch(signal)` | A fine-grained DOM swap of one signal's value without re-rendering the whole component. |
| `live(value)` | An `input` / `textarea` `.value` bound to state, so a user edit that equals the last committed value still resets. |
| `keyed(key, tpl)` | Force a fresh subtree (discard old DOM + state) when `key` changes. |
| `guard(deps, () => tpl)` | Skip re-rendering an expensive subtree unless `deps` change. |
| `cache(tpl)` | Keep the DOM of an inactive branch around when toggling between templates. |
| `until(promise, fallback)` | Render `fallback` until `promise` resolves (prefer `Task` in a component, `Suspense` for a page). |
| `unsafeHTML(str)` | Render a TRUSTED raw HTML string. NEVER pass user input (XSS). |
| `ref(cb)` / `createRef()` | Get a handle to the rendered DOM node. |
| `asyncAppend(iter)` / `asyncReplace(iter)` | Stream from an async iterable, appending each value or replacing with the latest. |
| `templateContent(el)` | Render the content of a `<template>` element. |

## Display-only elision

A component that does no client-side work renders the same SSR'd HTML with or without its JS, so WebJs strips its import from the served source (and any vendor reachable only through it). This is automatic and conservative. A component stays elidable while it has NONE of:

- an `@event` binding or native handler property (`.onclick`)
- a factory-declared reactive property that is not `{ state: true }`
- an overridden lifecycle hook (including `renderFallback` / `renderError`)
- an imported `signal` / `computed` / `watch` / `Task` / `ref` / streaming directive, or `addController` / `requestUpdate`
- code that runs at module load (a top-level call, non-data `new`, dynamic `import(...)`, top-level `await`); only declarations and `X.register(...)` are allowed
- the dynamic slot READ surface (`slotchange`, `assignedNodes` / `assignedElements` / `assignedSlot`); merely RENDERING a `<slot>` does not ship (the SSR output carries the placed children, so a display-only slotted wrapper is byte-identical without its JS; native-write liveness is consumer-driven and the consumer's tag reference forces the ship)
- being rendered by a component that itself ships

A bare `async render()` (no other signal, light DOM) is elided too: the SSR'd data is the complete first paint. Force shipping with `static interactive = true` when interactivity is invisible to static analysis. `static shadow = true` always ships (Declarative Shadow DOM re-attaches only during parsing). Turn elision off app-wide with `{ "webjs": { "elide": false } }` or `WEBJS_ELIDE=0`.

### What `static interactive = true` does and does not rescue

The analyser reads source lexically, so exactly two real shapes escape it, and the override covers both:

- **An OBSERVER that computes the tag it waits for.** `customElements.whenDefined(TAG)` where `TAG` is a variable does not name a tag the analyser can resolve, so the observed component is elided, its `register` never runs, and the `await` never settles. Put `static interactive = true` on the OBSERVED component.
- **A `:defined` rule in an external stylesheet.** `public/app.css` is not in the module graph, so a `my-badge:defined { … }` rule is invisible. Same fix, on the component the rule names.

**It does NOT rescue a component whose OWN registration tag is computed.** `Badge.register(TAG)` is not a registration the scanner recognises (invariant 3 requires a literal tag), so that component is never in the component set at all: it gets no verdict, nothing consults the analyser for it, and the override has nothing to attach to. The registration still runs whenever the module reaches the browser, so what you always lose is the verdict, the tag-to-module registry entry, and the preload hint. If the importing page is elided or inert, the import goes with it and the element never registers at all. Always pass a literal: `Badge.register('my-badge')`. `webjs dev` warns about this shape, and `webjs elision` / `webjs doctor` report it as an **orphan**. An orphan is either of two things, and they fail differently: a class with no registration call at all never upgrades, full stop, while a class with a computed tag still registers whenever its module reaches the browser.

### Inspecting and proving the verdict

Elision is the one thing WebJs decides about your code that you did not write down, so it is inspectable rather than something to reason about from the rules above.

```sh
webjs elision                      # per-module verdict, and the evidence behind every ship
webjs elision --json               # the same object, for a tool or an agent
webjs elision --verify             # prove elision changed nothing your app serves
webjs elision --verify --routes /,/blog/hello   # add paths (the only way to cover a dynamic route)
```

**Reading the report.** Every component is `elided` or `shipped`. A shipped one carries the `evidence` that forced it, first match wins:

| `evidence` | Means | `by` |
|---|---|---|
| `own` | its own source carries a signal; `reason` is the exact one | null |
| `observed` | another module observes its registration (`whenDefined` / `:defined` / `instanceof`) | the observer |
| `closure` | something it imports does client work | the import |
| `render` | a shipping component can render its tag | that component |
| `import` | a shipping component imports it | that component |
| `unreadable` | its source could not be read, so it ships conservatively | null |

An elided row carries no reason on purpose: elision is the ABSENCE of every signal, so there is no positive fact to report.

**What to do with each verdict.** `elided` on a component you believe is interactive is the one result worth acting on: find the signal it is missing (the list above), and if the interactivity is genuinely invisible to static analysis, add `static interactive = true`. `shipped` with an `evidence` you did not expect is usually a `closure` row, and the fix is to move the client-effecting import out of that component's path. An `orphans` row is always a bug: give the class a literal registration tag.

**What `--verify` proves.** It renders every static page route with elision on and off and diffs the bytes with the JS-loaded set masked out, which is the framework's own guard pointed at your app. So it proves elision did not change what your app SERVES. It does not prove post-hydration behaviour, because a wrongly dropped module shows up as a dead click, not as different bytes. Cover that half by running your own browser or e2e suite twice:

```sh
WEBJS_ELIDE=1 npm run test:e2e
WEBJS_ELIDE=0 npm run test:e2e
```

It exits non-zero on a divergence AND on a corpus where nothing could be compared, so it is safe to put in CI. The ON side is forced on rather than read from your config, so the comparison is a real one even in an app that has elision switched off, and the run reports how many modules elision actually dropped so a trivially-true pass is visible. Dynamic routes are skipped by name (rendering one would mean inventing param values); pass real ones with `--routes`. A route whose two same-side renders already differ is reported as nondeterministic and excluded, since a differential over live data proves nothing.

`webjs doctor` carries the same verdict as a one-line inventory, and warns only on an orphan.

## Members app code must not shadow

A `WebComponent` inherits `HTMLElement` (browser) or an `ElementShim` (SSR) plus the framework reactivity base. A reactive prop or method whose NAME collides either fails to compile (`TS2415` for a type-incompatible property, `TS2416` for a method signature) or silently hijacks the native member at runtime. The fix is always to rename. The DOM MUTATION methods WebJs instruments for the light-DOM slot API (`append`, `prepend`, `before`, `after`, `replaceWith`, `replaceChildren`, `remove`, `appendChild`, `insertBefore`, `removeChild`, `replaceChild`) are the dangerous case TypeScript does NOT catch (a shorter override is assignable to the native signature), so a handler named `append()` compiles yet silently never runs. `webjs check`'s `no-shadowed-native-member` rule catches exactly these.

- HTMLElement / Element: `title`, `id`, `slot`, `role`, `hidden`, `dir`, `lang`, `translate`, `draggable`, `tabIndex`, `className`, `dataset`, `remove`, `closest`, `matches`, `focus`, `blur`, `click`, `append` / `prepend`, `before` / `after`. Rename (`postTitle`, `removeItem`, `handleClick`).
- WebComponent base: `render`, `update`, `requestUpdate`, `updated` / `firstUpdated`, `willUpdate` / `shouldUpdate`, `connectedCallback`, `renderError` / `renderFallback`, `addController` / `removeController`, `updateComplete` (#1021: there is no WebJs slot API to override; slots are native). Only override one deliberately, with its exact signature; never repurpose the name for app logic.

Framework-private fields are underscore-prefixed (`_renderRoot`, `_connected`, `_changedProperties`, `_updatePromise`, `_isUpdating`); never declare a prop or field that matches one. Safe, non-inherited names: `label`, `open`, `count`, `value`, `name`, `items`, `todos`, `active`, `variant`, `size`, `checked`, `selected`, `heading`, `message`, `status`. When in doubt, grep the base surface in `node_modules/@webjsdev/core/src/component.js`.
