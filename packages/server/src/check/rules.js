/**
 * @typedef {{
 *   rule: string,
 *   file: string,
 *   message: string,
 *   fix: string,
 * }} Violation
 */

/**
 * @typedef {{
 *   name: string,
 *   description: string,
 * }} RuleDescriptor
 */

/**
 * All available rule names with descriptions. Useful for help text and
 * documentation generators.
 *
 * @type {RuleDescriptor[]}
 */
export const RULES = [
  {
    name: 'components-have-register',
    description:
      'Component files that define a class extending WebComponent must register the class with ClassName.register(\'tag\') (or customElements.define). The server-side scanner derives the module URL from the file path.',
  },
  {
    name: 'no-server-env-in-components',
    description:
      'Component files (under components/ or modules/*/components/) must not read non-public environment variables. process.env.X is allowed when X starts with WEBJS_PUBLIC_ (exposed to the browser via the SSR shim) or equals NODE_ENV (also defined in the browser). Any other process.env read in a component would leak the server-side value into the SSR\'d HTML, then read as undefined after hydration. Read server-only env vars in a page function, server action, or middleware (which never reach the browser as source) and pass derived values to the component as attributes.',
  },
  {
    name: 'tag-name-has-hyphen',
    description:
      'Static tag = \'...\' in component files must contain a hyphen (HTML custom element spec).',
  },
  {
    name: 'no-duplicate-tag',
    description:
      'A custom-element tag name must be registered exactly once across the app. Two `Class.register(\'tag\')` / `customElements.define(\'tag\', …)` calls for the SAME tag resolve INCONSISTENTLY at runtime: SSR overwrites the registry (last registration wins) while the browser keeps the first native upgrade, so the rendered element and the webjs registry disagree. Rename one tag.',
  },
  {
    name: 'no-static-properties',
    description:
      'Reactive properties must be declared via the `extends WebComponent({ … })` factory, never a hand-written `static properties = { … }` field in the class body. The factory types each field for you (no `declare` needed) and the runtime throws on a direct `static properties`. Migrate `class X extends WebComponent { static properties = { count: { type: Number } } }` to `class X extends WebComponent({ count: Number })`; use the `prop()` helper for options (`prop(Number, { reflect: true })`) and set defaults in the constructor after super().',
  },
  {
    name: 'reactive-props-no-class-field',
    description:
      'A reactive property declared via the `extends WebComponent({ … })` factory must NOT also have a plain class-field declaration (`count = 0`, `count: number = 0`, `count!: number`, or `count?: number`) in the class body. Under modern class-field semantics (including `erasableSyntaxOnly: true`) every class-field declaration compiles to Object.defineProperty *after* super(), clobbering the framework\'s reactive accessor and silently breaking re-renders. Set the default by assigning in the constructor after super().',
  },
  {
    name: 'array-prop-uses-array-type',
    description:
      'An array-typed reactive property declared via the `extends WebComponent({ … })` factory must pass the `Array` runtime constructor, not `Object`: `count: prop<Tag[]>(Array)`, never `prop<Tag[]>(Object)`. The two share one converter (both JSON-encode the value), so the wrong one does not crash, but `Object` misstates the prop contract to the next reader and diverges from the documented built-in set (String/Number/Boolean/Object/Array). Fires only when the factory generic is itself an array type (`T[]`, `readonly T[]`, `Array<T>`, `ReadonlyArray<T>`) AND the constructor argument is `Object`; a bare `foo: Object` with no generic is never flagged. Fix: change the constructor to `Array`.',
  },
  {
    name: 'shell-in-non-root-layout',
    description:
      'Only the root layout (app/layout.{js,ts}) may write a <!doctype>/<html>/<head>/<body> shell to override default <html lang>, <body class>, etc. Non-root layouts (app/<segment>/layout.{js,ts}) and pages (app/**/page.{js,ts}) must not: the framework auto-emits the wrapper around the whole composition, so a nested shell ends up nested inside <body> where browsers drop it. Triggers on any of <!doctype>, <html, <head, <body in a non-root layout or page.',
  },
  {
    name: 'erasable-typescript-only',
    description:
      'Apps must opt into TypeScript\'s `erasableSyntaxOnly: true` so the compiler rejects non-erasable syntax (enum, namespace with values, constructor parameter properties, legacy decorators with emitDecoratorMetadata, import = require) at edit time. webjs strips types via Node\'s built-in `module.stripTypeScriptTypes`, which only supports erasable TypeScript and produces byte-exact position preservation (no sourcemap overhead). Files using non-erasable syntax fail at strip time and the dev server returns a 500 pointing at the no-non-erasable-typescript rule; webjs is buildless end-to-end and has no bundler fallback. The rule checks the project\'s tsconfig.json and warns when `erasableSyntaxOnly` is missing or set to false. Set `compilerOptions.erasableSyntaxOnly: true` in tsconfig.json to comply.',
  },
  {
    name: 'use-server-needs-extension',
    description:
      'Files that declare the `\'use server\'` directive at the top must also have the `.server.{js,ts,mts,mjs}` extension. The two markers are complementary, not interchangeable: `.server.ts` is the path-level boundary that triggers source protection by the file router; `\'use server\'` is the semantic opt-in that registers exports as RPC-callable from client code. A `\'use server\'` directive without the extension is silently ignored: the file is served to the browser as plain source, exports are NOT registered as RPC, and code the developer expects to run on the server actually runs in the browser. Rename the file to add the `.server.` infix.',
  },
  {
    name: 'use-server-exports-callable',
    description:
      'A `.server.{js,ts}` file that declares the `\'use server\'` directive registers its function exports as RPC-callable server actions, but only its FUNCTION exports: `buildActionIndex` / the stub generator register an export only when `typeof export === \'function\'`, so a `\'use server\'` file that exports zero functions (or only a non-function `const` / a type / only verb config like `method` / `cache`) registers NOTHING and gives no signal. The developer believes they exposed an action; nothing did, and the failure only surfaces as a 404 / undefined at the first call site. This is the complement of `use-server-needs-extension` (the directive without the extension) and of `one-action-per-configured-file` (more than one action in a configured file); this rule catches the directive-present-but-nothing-callable case. The rule asserts only that the file exports at least one callable, NOT that the action returns a value (a server action may be a void side-effect or throw `redirect()` / `notFound()` and never return). Conservative: a re-export (`export ... from`, `export *`) or an `export const NAME = <identifier-or-call>` (a possible factory-produced function such as `export const get = cache(fetch)`) is treated as a possible callable and NOT flagged, so the rule fires only when every export is provably non-callable. Fix: export an `async function` action, or drop the `\'use server\'` directive if the file is a plain server-only utility.',
  },
  {
    name: 'no-non-erasable-typescript',
    description:
      'Scans .ts / .mts source for the four non-erasable TypeScript constructs (enum declarations, namespace blocks with value statements, constructor parameter properties, and `import = require`) that the framework\'s type-stripper rejects at request time. Companion to `erasable-typescript-only`: that rule checks the tsconfig flag, this rule checks the actual source. Both run by default so the flag check catches violations early in the editor while the source scan catches violations even if the tsconfig flag is missing or the rule is bypassed. Skips node_modules, dist, build, .git, .next, and _private folders.',
  },
  {
    name: 'no-browser-globals-in-render',
    description:
      'Flags genuinely browser-only APIs used in a WebComponent constructor, willUpdate, or render() method. The SSR pipeline instantiates the component, runs willUpdate plus controllers\' hostUpdate, reflects properties, and calls render() to produce HTML, on a server element shim that backs the attribute methods but has no real DOM. So a browser global (document, window, localStorage, sessionStorage, navigator, location, matchMedia, screen, history) or an unshimmed HTMLElement member on `this` (attachShadow, shadowRoot, classList, querySelector, querySelectorAll, getBoundingClientRect, focus, blur, scrollIntoView) touched there throws at SSR time (the isomorphic footgun). The attribute methods (getAttribute/setAttribute/hasAttribute/removeAttribute/toggleAttribute), the event methods (addEventListener/removeEventListener/dispatchEvent), and attachInternals are shim-backed and run server-side, so they are NOT flagged. The flagged APIs belong in connectedCallback() or a lifecycle hook (firstUpdated/updated), which SSR never calls; seed first-paint defaults in the constructor (or derive them in willUpdate) only from server-known inputs (attributes, props). Conservative: only the constructor, willUpdate, and render bodies are scanned, and only direct references, so helper indirection is not flagged (the runtime SSR error covers that case).',
  },
  {
    name: 'no-shadowed-native-member',
    description:
      'Flags a WebComponent class method whose name collides with a native DOM mutation method that WebJs relies on and INSTRUMENTS on every light-DOM host for the slot API (#1021): append, prepend, before, after, replaceWith, replaceChildren, remove, appendChild, insertBefore, removeChild, replaceChild. A method of the same name is SHADOWED at runtime (the instrumented native method wins), so the component method silently never runs, while TypeScript stays green because a zero/one-arg override is assignable to the native signature. Found dogfooding the stream demo (#248): a component named its button handler `append()`, so clicking Append called the slot-append no-op instead of the handler. Rename the handler to a non-native name (appendRow / prependRow / removeItem). The `render` / lifecycle hooks are MEANT to be overridden and are not flagged; only the native DOM mutation members are.',
  },
  {
    name: 'no-server-import-in-browser-module',
    description:
      'A page / layout / component module that SHIPS to the browser (the build does NOT elide it) must not transitively import a server-only `.server.{ts,js}` module. The server module is replaced by a stub in the browser, so the import is fine while the module never loads client-side: a display-only page is elided, and a page whose only client relevance is importing shipping components is import-only (#605/#963), dropped from the boot in favour of its components. But the moment the page does its OWN client work (the client router, a reactive primitive, a module-scope browser-global access, a client-effecting non-component util) it ships whole, dragging the server import with it. The stub then throws (or a server-only export like `auth` is missing) the instant the module loads, a runtime browser crash that `webjs typecheck` and the rest of `webjs check` miss. The rule reuses the build\'s own elision verdict, so it ONLY fires on modules that genuinely ship; an elided, inert, or import-only page is never flagged. The fix is to keep the server call off the browser-shipped module: gate the route in `middleware.ts`, call the server through a `\'use server\'` action, or move the module\'s own client work into a component so the page is dropped again. Server-to-server imports (`.server.ts` importing `.server.ts`) and `middleware.ts` / `route.ts` (never shipped) are never flagged.',
  },
  {
    name: 'one-action-per-configured-file',
    description:
      'A `\'use server\'` action file that declares HTTP-verb config (any of `method` / `cache` / `tags` / `invalidates` / `validate`, #488) must export exactly ONE callable action function. The config is file-level (it applies to the action in the file), so a second exported function would silently inherit the same verb / cache, which is almost never intended and makes the contract ambiguous. Move the extra function to its own `.server.ts` file (the one-function-per-file convention), or, if it is a private helper, do not export it. Files with no verb config are unaffected.',
  },
  {
    name: 'form-action-not-a-get-action',
    description:
      'Flags `<form action=${someAction}>` bound to a `\'use server\'` action whose file declares `export const method = \'GET\'` (#488). A GET action is a READ: it is CSRF-exempt and rides its arguments in the url, while a form submission is a CSRF-checked POST carrying a body, so the two contracts contradict each other and the submission is answered with a 405 at runtime. The rule reads the imported action\'s own file, so it only fires when the binding really does resolve to a GET-declared action. Fix by dropping the `method` export (an action with no `method` is a POST, which is what a form wants) or by binding a different action; if the form really is a read, use a plain `<form method="get" action="/search">` with no bound action.',
  },
  {
    name: 'no-redirect-in-api-route',
    description:
      'API route handlers (`route.{js,ts}`) must NOT call `redirect()` from `@webjsdev/core`. That function throws a control-flow signal designed for the SSR page renderer; in a route handler it goes uncaught and produces a 500. Use `Response.redirect(url, 303)` for external redirects or return a 3xx Response directly. Page functions, layouts, and server actions may still use `redirect()` (caught by the SSR pipeline).',
  },
  {
    name: 'no-interpolation-in-raw-text-element',
    description:
      'Flags a template interpolation (`${...}`) placed as a child of a `<style>` or `<script>` element inside a COMPONENT `html` template. Raw-text elements are an SSR/client asymmetry trap: the server renderer emits the interpolated content, but the client renderer drops it (a raw-text hole is a `noop`, since the compile cache is keyed on the static strings), so the element renders correctly on the server and then wipes to empty on hydration. Scoped to components (files with a `WebComponent` class), which hydrate; pages and layouts render server-only and never hydrate, so a page interpolating a `css` result into a `<style>` is a legitimate pattern and is not flagged. In a component, author scoped CSS with `static styles` (shadow DOM) or a `css` template. Found dogfooding a tic-tac-toe app (#845): a `<style>${STYLE}</style>` painted at SSR then vanished on hydrate.',
  },
  {
    name: 'no-missing-local-import',
    description:
      'Flags a NAMED value import of a symbol that a resolvable app-internal module does not export (`import { todos } from \'#db/schema.server.ts\'` when the schema no longer exports `todos`). The binding is `undefined` at runtime and crashes on first use, yet the rest of `webjs check` (elision-based, it does not compile types) misses it, so a schema swap that orphans a gallery module can pass `check` while `typecheck` is red. This is the runtime-crash class `check` exists to catch, filling that gap so an agent running only `check` cannot ship a broken import. Deliberately conservative to never false-positive on a valid app: it only inspects app-internal specifiers (a relative `./` path or a `#` alias) that resolve to a file in the app, only NAMED value imports (a `type` import, a default import, a namespace import, and any bare / `node:` / npm-package specifier are skipped), and it treats a module as UNKNOWABLE (never flags imports from it) when its exports are not fully enumerable: a `export * from ...` star re-export, a destructuring `export const { a } = ...`, or a multi-declarator `export const a = .., b = ..`. It reads names from `export function/class/const/let/var/type/interface/enum` and from `export { a, b as c }` / `export { x } from ...` clauses (the alias after `as` is the exported name). A re-export barrel therefore resolves correctly, and a `\'use server\'` action file exports its function names normally. Found dogfooding a tic-tac-toe app: dropping the example `todos` table left a gallery module importing it, green under `check` but red under `typecheck`.',
  },
];

/** Set of all known rule names for fast lookup. */
export const RULE_NAMES = new Set(RULES.map((r) => r.name));
