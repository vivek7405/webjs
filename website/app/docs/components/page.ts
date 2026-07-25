import { html } from '@webjsdev/core';

export const metadata = { title: 'Components | WebJs' };

export default function Components() {
  return html`
    <h1>Components</h1>
    <p>WebJs components are <strong>standard HTML custom elements</strong> built on a thin base class called <code>WebComponent</code>. If you are coming from React, think of <code>WebComponent</code> as a class component whose render method returns a tagged template instead of JSX. The browser owns the component lifecycle. There is no virtual DOM, no reconciler, and no framework-specific component model to learn.</p>

    <h2>The WebComponent Base Class</h2>
    <p>Every interactive component extends <code>WebComponent</code>, declares its <strong>property map</strong> by passing a shape into the base-class factory (<code>extends WebComponent({ ... })</code>, and optionally <code>static styles</code> for shadow-DOM components), implements <code>render()</code>, and registers itself by passing a hyphenated tag name to <code>ClassName.register('tag-name')</code>. The tag name is an argument to <code>.register()</code>, not a static field.</p>

    <pre>import { WebComponent, html, css, signal } from '@webjsdev/core';

class MyCounter extends WebComponent {

  // Instance signal carries component-local state. SignalWatcher
  // (built into WebComponent) auto-tracks .get() reads and re-renders.
  count = signal(0);

  static styles = css\`
    :host { display: inline-flex; gap: 8px; align-items: center; }
    button { font: inherit; padding: 4px 12px; cursor: pointer; }
    output { font-variant-numeric: tabular-nums; min-width: 3ch; text-align: center; }
  \`;

  render() {
    return html\`
      &lt;button @click=\${() =&gt; this.count.set(this.count.get() - 1)}&gt;-&lt;/button&gt;
      &lt;output&gt;\${this.count.get()}&lt;/output&gt;
      &lt;button @click=\${() =&gt; this.count.set(this.count.get() + 1)}&gt;+&lt;/button&gt;
    \`;
  }
}

MyCounter.register('my-counter');</pre>

    <p>That is a complete, working component. Import it from a page or layout and use it like any HTML element:</p>

    <pre>import '#components/my-counter.ts';

export default function Home() {
  return html\`&lt;my-counter&gt;&lt;/my-counter&gt;\`;
}</pre>

    <h2>Tag Names</h2>
    <p>The HTML spec requires that custom element names contain a <strong>hyphen</strong>. This is how the browser distinguishes <code>&lt;my-counter&gt;</code> from built-in elements like <code>&lt;div&gt;</code>. Register the component with <code>Class.register('tag')</code> at the bottom of the file:</p>

    <pre>class UserCard extends WebComponent {
  // ...
}
UserCard.register('user-card');</pre>

    <p>If you forget the hyphen, the browser throws at registration time with a clear error message.</p>

    <h2>Properties</h2>
    <p>Reactive properties that ride HTML attributes are declared in <strong>one</strong> place: the base-class factory. You pass the property shape directly into <code>WebComponent({ ... })</code>, the types flow to TypeScript automatically (no <code>declare</code> lines), and the runtime installs a reactive accessor for each key. A hand-written <code>static properties = { ... }</code> field in the class body is no longer supported and throws at construction.</p>

    <h3>The factory shape</h3>
    <p>Map each property name to its type constructor. Default values are set in the constructor after <code>super()</code> (never a class-field initializer, which runs after <code>super()</code> and clobbers the reactive accessor):</p>

    <pre>import { WebComponent, html } from '@webjsdev/core';

class UserCard extends WebComponent({
  name:     String,
  age:      Number,
  active:   Boolean,
  config:   Object,
  tags:     Array,
}) {
  constructor() {
    super();
    this.name = 'Anonymous';
    this.age = 0;
    this.active = false;
    this.config = {};
    this.tags = [];
  }

  render() {
    return html\`
      &lt;p&gt;\${this.name} (age \${this.age})&lt;/p&gt;
      &lt;p&gt;Active: \${this.active ? 'yes' : 'no'}&lt;/p&gt;
      &lt;p&gt;Tags: \${this.tags.join(', ')}&lt;/p&gt;
    \`;
  }
}
UserCard.register('user-card');</pre>

    <h3>Property options and narrowed types with prop()</h3>
    <p>When a property needs options (reflection, a renamed attribute, internal-only state) or a narrowed TypeScript type, wrap the type in the <code>prop()</code> helper. A bare constructor (<code>name: String</code>) is shorthand for <code>name: prop(String)</code>.</p>

    <pre>import { WebComponent, html, prop } from '@webjsdev/core';

interface Student { name: string; gpa: number; }

class UserCard extends WebComponent({
  count:   prop(Number, { reflect: true }),       // reflect to the attribute
  label:   prop(String, { attribute: 'aria-label' }), // renamed attribute
  open:    prop({ state: true }),                  // internal, no attribute
  student: prop&lt;Student&gt;(Object),                  // narrowed object type
  tags:    prop&lt;string[]&gt;(Array),                  // array-typed: pass Array, not Object
  size:    prop&lt;'sm' | 'lg'&gt;(String),              // narrowed enum type
}) {
  constructor() {
    super();
    this.size = 'sm';                              // default in the constructor
  }
  render() {
    return html\`&lt;p&gt;\${this.student.name} (\${this.size})&lt;/p&gt;\`;
  }
}
UserCard.register('user-card');</pre>

    <p>Set a default by assigning in the <code>constructor()</code> after <code>super()</code> (never a class-field initializer, which clobbers the reactive accessor). An applied attribute overrides it.</p>

    <p>Declare an <strong>array-typed</strong> property with the <code>Array</code> constructor, not <code>Object</code> (<code>tags: prop&lt;string[]&gt;(Array)</code>). The default converter treats both the same (each JSON-encodes the value), so <code>Object</code> does not break anything, but <code>Array</code> states the property's shape correctly. The <code>array-prop-uses-array-type</code> rule in <code>webjs check</code> flags an array-typed generic declared with <code>Object</code>.</p>

    <h3>Attribute-to-Property Coercion</h3>
    <p>When an attribute changes on the DOM element, WebJs coerces the string value to the declared type:</p>

    <ul>
      <li><strong>String</strong>: passed through as-is.</li>
      <li><strong>Number</strong>: converted via <code>Number(value)</code>. Null attributes become <code>null</code>.</li>
      <li><strong>Boolean</strong>: the attribute is <code>true</code> if present and not <code>"false"</code>. Removing the attribute sets <code>false</code>.</li>
      <li><strong>Object / Array</strong>: parsed via <code>JSON.parse()</code>. If parsing fails, the raw string is used.</li>
    </ul>

    <p>Property names are automatically converted between camelCase (JavaScript) and kebab-case (HTML). A property named <code>userName</code> observes the attribute <code>user-name</code>.</p>

    <blockquote>If you are coming from React: properties in WebJs serve a similar role to props, but they are backed by real DOM attributes. You can inspect them in DevTools, set them from plain HTML, and they survive page serialization during SSR.</blockquote>

    <h2>State</h2>
    <p>Signals are the default state primitive. Import <code>signal</code> from <code>@webjsdev/core</code> and read with <code>signal.get()</code> inside <code>render()</code>. The component's built-in SignalWatcher tracks the read and re-renders whenever the signal changes. Instance signals (class-field initializers) carry component-local state; module-scope signals share state across components.</p>

    <pre>import { WebComponent, html, signal } from '@webjsdev/core';

class TodoList extends WebComponent {
  items  = signal&lt;{ id: number; text: string; done: boolean }[]&gt;([]);
  filter = signal&lt;'all' | 'active'&gt;('all');

  addItem(text) {
    this.items.set([...this.items.get(), { id: Date.now(), text, done: false }]);
  }

  toggleItem(id) {
    this.items.set(this.items.get().map(it =&gt;
      it.id === id ? { ...it, done: !it.done } : it
    ));
  }

  render() {
    const visible = this.filter.get() === 'all'
      ? this.items.get()
      : this.items.get().filter(it =&gt; !it.done);

    return html\`
      &lt;ul&gt;
        \${visible.map(it =&gt; html\`
          &lt;li @click=\${() =&gt; this.toggleItem(it.id)}
              style=\${it.done ? 'text-decoration: line-through' : ''}&gt;
            \${it.text}
          &lt;/li&gt;
        \`)}
      &lt;/ul&gt;
    \`;
  }
}
TodoList.register('todo-list');</pre>

    <h3>How signal updates render</h3>
    <ul>
      <li><strong>Dynamic tracking</strong>: every render re-records its dependency set. A signal read inside <code>render()</code> subscribes the component to that signal; signals that fall out of the current control flow stop driving re-renders.</li>
      <li><strong>Batched re-render</strong>: calling <code>signal.set</code> (or assigning a reactive property, or calling <code>requestUpdate</code>) multiple times in the same synchronous block only triggers <strong>one</strong> re-render. Updates are batched via <code>queueMicrotask</code>, so the DOM update happens after the current call stack finishes but before the next frame paints.</li>
    </ul>

    <pre>// These two writes result in a single re-render, not two:
this.count.set(1);
this.label = 'hello';
// render() is called once with the new count and label.</pre>

    <h3>Fine-grained binding with <code>watch()</code></h3>
    <p>Reading <code>signal.get()</code> inside <code>render()</code> subscribes the WHOLE component to that signal: any change re-runs <code>render()</code>. When a single template hole depends on a single signal value and the rest of the template doesn't, the <code>watch(signal)</code> directive from <code>@webjsdev/core/directives</code> is a cheaper alternative: the directive sets up its own per-hole subscription, and <em>only</em> the bound text node (or attribute value) updates when the signal fires. The host's <code>render()</code> does not re-run, which also means <code>shouldUpdate</code> / <code>willUpdate</code> / <code>updated</code> are bypassed for that change.</p>

    <pre>import { html, signal } from '@webjsdev/core';
import { watch } from '@webjsdev/core/directives';

const count = signal(0);

class Counter extends WebComponent {
  render() {
    // The host subscribes to nothing; only this hole updates.
    return html\`
      &lt;button @click=\${() =&gt; count.set(count.get() + 1)}&gt;
        \${watch(count)}
      &lt;/button&gt;
    \`;
  }
}
Counter.register('my-counter');</pre>

    <p>SSR inlines the current value once; subscription is a client-only concern. Pick <code>watch()</code> when the binding is a scalar (text node, attribute value) tied to one signal and the surrounding template is expensive or static. Pick <code>signal.get()</code> when the render branches on the value, derives several things from it, or reads multiple signals together.</p>

    <h2>Styles</h2>
    <p>Use the <code>css</code> tagged template to declare scoped styles. They are automatically adopted into the component's shadow root.</p>

    <pre>import { WebComponent, html, css } from '@webjsdev/core';

class StyledCard extends WebComponent {
  static styles = css\`
    :host {
      display: block;
      padding: var(--sp-4);
      border: 1px solid var(--border);
      border-radius: var(--rad-lg);
      background: var(--bg-elev);
    }
    :host(:hover) {
      border-color: var(--border-strong);
      box-shadow: var(--shadow);
    }
    h3 { margin: 0 0 8px; }
    p  { margin: 0; color: var(--fg-muted); }
  \`;

  render() {
    return html\`
      &lt;h3&gt;&lt;slot name="title"&gt;Untitled&lt;/slot&gt;&lt;/h3&gt;
      &lt;p&gt;&lt;slot&gt;&lt;/slot&gt;&lt;/p&gt;
    \`;
  }
}
StyledCard.register('styled-card');</pre>

    <h3>How Styles Are Applied</h3>
    <ul>
      <li><strong>adoptedStyleSheets</strong>: when the browser supports it (all modern browsers), styles are applied via <code>adoptedStyleSheets</code> on the shadow root. This is the most efficient path: the browser parses the CSS once and shares the <code>CSSStyleSheet</code> object across all instances of the same component.</li>
      <li><strong>Fallback</strong>: on older browsers, a <code>&lt;style&gt;</code> element is injected into the shadow root instead.</li>
    </ul>

    <h3>Design Tokens via CSS Custom Properties</h3>
    <p>CSS custom properties (variables) <strong>inherit across shadow DOM boundaries</strong>. This is the primary mechanism for theming in WebJs. Define tokens on <code>:root</code> or a parent element, and every component in the tree can read them:</p>

    <pre>/* In your root layout or global stylesheet */
:root {
  --accent: oklch(0.58 0.15 55);
  --bg-elev: white;
  --border: oklch(0.88 0.01 75);
  --rad-lg: 12px;
  --sp-4: 16px;
}

/* Inside a component's static styles, these "just work" */
static styles = css\`
  :host {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--rad-lg);
    padding: var(--sp-4);
  }
  .accent { color: var(--accent); }
\`;</pre>

    <blockquote>This is fundamentally different from React CSS-in-JS solutions that require runtime injection or build tooling. WebJs uses the platform: shadow DOM gives you scoping, CSS custom properties give you theming, and there is nothing to configure.</blockquote>

    <h2>Light DOM (default)</h2>
    <p>Light DOM is the default because global CSS and Tailwind utility classes apply directly: no <code>:host</code>, no <code>::part</code>, no CSS-variable plumbing. The browser renders a plain custom element with normal children. This is the mode the blog example uses everywhere except when shadow DOM buys something specific.</p>
    <p><strong>Light-DOM hosts default to <code>display: block</code>.</strong> A custom element is <code>display: inline</code> by default (so a container component would collapse), and a light-DOM component has no <code>:host</code> to fix it with. So the framework marks every light host <code>data-wj-host</code> and injects one low-priority-layer rule (<code>@layer webjs-host &#123; :where([data-wj-host]) &#123; display: block &#125; &#125;</code>), overridable by any author style including Tailwind utilities (<code>class="flex"</code> wins). Shadow-DOM hosts are NOT marked: set their display via <code>:host</code> in <code>static styles</code>, the way Lit does (fully respected). See the <a href="/docs/styling">styling</a> page.</p>

    <pre>// static shadow = false is the default, no need to declare it.
class AppCard extends WebComponent({ heading: String }) {
  constructor() {
    super();
    this.heading = '';
  }

  render() {
    return html\`
      &lt;div class="rounded-lg border border-border bg-bg-elev p-6"&gt;
        &lt;h3 class="font-serif text-lg mb-2"&gt;\${this.heading}&lt;/h3&gt;
        &lt;p class="text-fg-muted"&gt;Tailwind utility classes apply directly.&lt;/p&gt;
      &lt;/div&gt;
    \`;
  }
}
AppCard.register('app-card');</pre>

    <h3>Class-prefix rule for custom CSS</h3>
    <p>Tailwind utilities are unique by construction, so most light-DOM components need zero custom CSS. If you <em>do</em> author a <code>&lt;style&gt;</code> block or import a stylesheet, <strong>every class selector MUST be prefixed with the component's tag name</strong>. Otherwise two components with a <code>.card</code> or <code>.header</code> class will style each other.</p>

    <pre>// Pattern A: BEM-ish class names prefixed with tag
class MyCard extends WebComponent {
  render() {
    return html\`
      &lt;style&gt;
        .my-card__body  { padding: 16px; }
        .my-card__title { font-weight: 600; }
      &lt;/style&gt;
      &lt;div class="my-card__body"&gt;&lt;h3 class="my-card__title"&gt;\${t}&lt;/h3&gt;&lt;/div&gt;
    \`;
  }
}

// Pattern B: descendant selector rooted at the tag
class MyCard extends WebComponent {
  render() {
    return html\`
      &lt;style&gt;
        my-card .body  { padding: 16px; }
        my-card .title { font-weight: 600; }
      &lt;/style&gt;
      &lt;div class="body"&gt;&lt;h3 class="title"&gt;\${t}&lt;/h3&gt;&lt;/div&gt;
    \`;
  }
}</pre>

    <h2>Shadow DOM (opt-in)</h2>
    <p>Set <code>static shadow = true</code> when you want one of these:</p>
    <ul>
      <li>Scoped styles via <code>static styles = css\`...\`</code> (adopted via <code>adoptedStyleSheets</code>) without prefix discipline.</li>
      <li><code>::slotted()</code> CSS selectors from inside the shadow tree, since the native browser projection is what makes them work.</li>
      <li>Third-party embed isolation: your component looks right in any host page, regardless of their CSS.</li>
    </ul>
    <p><strong>Slots themselves are NOT a reason to opt into shadow DOM.</strong> <code>&lt;slot&gt;</code>, <code>&lt;slot name="x"&gt;</code>, fallback content, <code>assignedNodes()</code>, <code>assignedElements()</code>, <code>assignedSlot</code>, <code>slotchange</code>, named-slot routing, and first-wins resolution all work identically in light DOM (the framework's default). See the <strong>Slots</strong> section below for the full surface.</p>

    <pre>class Card extends WebComponent {
  static shadow = true;                 // opt in
  static styles = css\`
    :host { display: block; padding: 16px; border: 1px solid var(--border); border-radius: 8px; }
    h3 { margin: 0 0 8px; }
    p  { color: var(--fg-muted); margin: 0; }
  \`;
  render() {
    return html\`
      &lt;h3&gt;&lt;slot name="title"&gt;&lt;/slot&gt;&lt;/h3&gt;
      &lt;p&gt;&lt;slot&gt;&lt;/slot&gt;&lt;/p&gt;
    \`;
  }
}
Card.register('my-card');</pre>

    <p><code>static styles</code> on a light-DOM component is silently ignored. There's no shadow root to adopt them into. If you see your styles failing, check whether you forgot <code>static shadow = true</code>.</p>

    <h3>Mode summary</h3>
    <p>Both modes are <strong>fully SSR'd</strong>. Shadow DOM renders via Declarative Shadow DOM (<code>&lt;template shadowrootmode="open"&gt;</code>). Light DOM renders content directly as HTML with a <code>&lt;!--webjs-hydrate--&gt;</code> marker. Both hydrate on the client without flash.</p>

    <table>
      <thead>
        <tr><th>Component type</th><th>Mode</th><th>Why</th></tr>
      </thead>
      <tbody>
        <tr><td>Global / Tailwind utility classes, simple composition</td><td><strong>Light DOM</strong> (default)</td><td>Utilities apply directly. No host plumbing.</td></tr>
        <tr><td><code>static styles = css\`\`</code> scoped styles</td><td>Shadow DOM</td><td><code>adoptedStyleSheets</code> needs a shadow root.</td></tr>
        <tr><td><code>&lt;slot&gt;</code> content projection</td><td><strong>Either</strong></td><td>Full shadow-DOM spec parity in light DOM. Same <code>&lt;slot&gt;</code> / <code>&lt;slot name="x"&gt;</code> / fallback / <code>assignedNodes</code> / <code>slotchange</code> in both modes.</td></tr>
        <tr><td>Third-party embed needing isolation</td><td>Shadow DOM</td><td>CSS can't leak in or out.</td></tr>
      </tbody>
    </table>

    <h2>SSR and the first paint</h2>

    <p>Every web component on a page runs through the SSR pipeline. For each rendered tag, the server:</p>

    <ol>
      <li>Calls <code>new Cls()</code>: the constructor runs.</li>
      <li>Applies the element's attributes to the instance (via the factory's property converters).</li>
      <li>Calls <code>instance.render()</code> and awaits the resulting template.</li>
      <li>Inlines the rendered HTML as the element's children (light DOM) or wraps it in <code>&lt;template shadowrootmode="open"&gt;</code> (shadow DOM).</li>
    </ol>

    <p>The server runs the pre-render value-deriving hooks before <code>render()</code>: <code>willUpdate</code> and controllers' <code>hostUpdate</code>, then it reflects <code>reflect: true</code> properties. <strong>It does NOT call <code>connectedCallback</code>, <code>firstUpdated</code>, <code>updated</code>, or any browser-only hook.</strong> Those run only after the script loads in the browser. This is intentional. The server runs many components for many concurrent requests, and the browser-only hooks frequently touch <code>window</code>, <code>document</code>, <code>localStorage</code>, observers, and timers that don't exist server-side. (A <code>Task</code> is the exception among controllers: its <code>hostUpdate</code> does not auto-run at SSR, so it ships the <code>INITIAL</code> state and fetches only on hydration.)</p>

    <h3>Rule: SSR-meaningful state goes in the constructor</h3>

    <p>Whatever state should appear in the first paint MUST be set in the constructor (after <code>super()</code>) or be derivable from the factory's properties + the tag's attributes. The SSR pipeline reads exactly these values.</p>

    <pre>// ❌ first paint is empty (initial state set in browser-only hook)
class Cart extends WebComponent({ items: prop&lt;Item[]&gt;(Array) }) {
  connectedCallback() {                       // ← server never runs this
    super.connectedCallback();
    this.items = readFromLocalStorage();
    this.requestUpdate();
  }

  render() { return html\`&lt;ul&gt;\${this.items.map(/* … */)}&lt;/ul&gt;\`; }
}</pre>

    <pre>// ✅ SSR-safe: instance signal carries the default,
//    browser hook refines after hydration
class Cart extends WebComponent {
  items = signal&lt;Item[]&gt;([]);                  // ← SSR uses this

  connectedCallback() {
    super.connectedCallback();
    const stored = readFromLocalStorage();
    if (stored) this.items.set(stored);         // browser-only refinement
  }

  render() { return html\`&lt;ul&gt;\${this.items.get().map(/* … */)}&lt;/ul&gt;\`; }
}</pre>

    <h3>Where each kind of data belongs</h3>

    <table>
      <thead>
        <tr><th>Data source</th><th>Where to read it</th></tr>
      </thead>
      <tbody>
        <tr><td>Database, session, cookies, request headers</td><td>Page function (server). Pass to the component as an attribute or property.</td></tr>
        <tr><td>Server data a leaf component needs in the first paint</td><td>An <code>async render()</code> in the component (<code>const u = await getUser(this.uid)</code>). Co-located, no prop-drilling. See below.</td></tr>
        <tr><td>Initial state / defaults known at coding time</td><td>Instance signal in a class-field initializer, or the component's <code>constructor()</code> after <code>super()</code>.</td></tr>
        <tr><td>Browser-only: <code>localStorage</code>, viewport, <code>matchMedia</code>, <code>navigator.*</code></td><td>Component's <code>connectedCallback()</code>, then write the signal to refine.</td></tr>
        <tr><td>Flash-sensitive (theme, RTL direction)</td><td>Synchronous inline <code>&lt;script&gt;</code> in the root layout's <code>&lt;head&gt;</code> that writes attributes to <code>document.documentElement</code> before custom elements upgrade.</td></tr>
      </tbody>
    </table>

    <p>This is the design rule that makes <a href="/docs/progressive-enhancement">progressive enhancement</a> work in webjs: the component's HTML lands in the response, with the right content, before any script runs.</p>

    <h3>Compound components: reading the parent with closest() at SSR</h3>
    <p>A compound component (a tabs trigger, a toggle-group item) derives its active or pressed state by walking up to the parent and reading the parent's value. WebJs supports <code>this.closest(...)</code> at SSR for <strong>tag-name selectors only</strong>, so the active or pressed state is marked in the <strong>first server paint</strong>, not only after hydration.</p>

    <pre>class UiTabsTrigger extends WebComponent({ value: String }) {
  get _tabs() { return this.closest('ui-tabs'); }

  render() {
    const active = this._tabs?.value === this.value;
    this.dataset.state = active ? 'active' : 'inactive';
    return html\`&lt;button data-state=\${active ? 'active' : 'inactive'}&gt;&lt;slot&gt;&lt;/slot&gt;&lt;/button&gt;\`;
  }
}
UiTabsTrigger.register('ui-tabs-trigger');</pre>

    <p>The SSR walker threads the chain of enclosing custom-element instances into each instance, and the server element shim's <code>closest()</code> resolves a parent over that chain (so <code>this.closest('ui-tabs').value</code> reads the live parent property the walker already applied). Host IDL properties a <code>render()</code> mutates on <code>this</code> (<code>this.dataset.*</code>, <code>this.className</code>, <code>this.hidden</code>, the <code>aria*</code> mixin) reflect to the matching attribute on the SSR'd host tag, so the active tab is marked before any JavaScript runs. The first client render produces the identical state (the browser's real <code>closest()</code> against the real DOM), so there is no hydration flash. Two limits apply.</p>
    <ul>
      <li>Only <strong>tag-name selectors</strong> resolve at SSR (<code>closest('ui-tabs')</code>). A class, attribute, or descendant selector returns <code>null</code> server-side and resolves on the client. That covers the compound-component pattern, anything finer is client-only.</li>
      <li>The compound <strong>parent</strong> must be light DOM (the default, and what every UI-kit compound component uses). A shadow-DOM parent projects its children through a native <code>&lt;slot&gt;</code>, and those slotted children are not threaded the SSR ancestor chain, so their <code>closest(parent)</code> resolves to <code>null</code> in the first server paint (it still resolves on the client after hydration). Keep compound parents light DOM for a correct first paint.</li>
    </ul>
    <p>Genuine layout or live-DOM reads (<code>querySelector</code>, <code>classList</code>, <code>attachShadow</code>, geometry) still throw at SSR, so keep them in <code>connectedCallback</code> or <code>firstUpdated</code>. See <a href="/docs/ssr">Server-Side Rendering</a> for the server element shim that backs this.</p>

    <h2>Fetching data in a component (async render)</h2>
    <p>A leaf component can fetch its own server data into the first paint, so you do not have to fetch it in the page and prop-drill it down. Make <code>render()</code> async and call a <code>'use server'</code> action directly:</p>
    <pre>class UserProfile extends WebComponent({ uid: String }) {
  async render() {
    const u = await getUser(this.uid);   // real fn at SSR, RPC stub on the client
    return html\`&lt;h3&gt;\${u.name}&lt;/h3&gt;\`;
  }
}
UserProfile.register('user-profile');</pre>
    <p>SSR awaits the render, so the data is in the first paint with no fallback (JS-off reads it). On a client re-fetch (a prop change) the default is stale-while-revalidate: the prior content stays until the new render resolves. Define <code>renderFallback()</code> only to show a loading state DURING a re-fetch (never on the first paint). A thrown <code>await</code> is isolated to that component, with <code>renderError()</code> as the optional custom UI.</p>
    <h3>Which tool to reach for</h3>
    <ul>
      <li><strong>Server data knowable at request time</strong>: <code>async render()</code> in the component. The default, simplest case.</li>
      <li><strong>Re-fetch where stale content would mislead</strong>: add <code>renderFallback()</code>.</li>
      <li><strong>Genuinely client-only data</strong> (depends on a click, viewport, localStorage, or live updates, not needed in the first paint): use <code>Task</code> / signals plus an RPC action. A <code>Task</code> shows its pending state at SSR, so it loses first-paint data.</li>
      <li><strong>Slow server data</strong> where blocking the first byte hurts: stream it by wrapping the component in <code>&lt;webjs-suspense .fallback=\${html\`…\`}&gt;</code> (fallback on the first byte, content streams in). See <a href="/docs/data-fetching">Data fetching</a>.</li>
    </ul>
    <h3>Anti-patterns</h3>
    <ul>
      <li>Do NOT prop-drill server data through layers when the leaf component can fetch it itself.</li>
      <li>Do NOT put <code>await getData()</code> in a page / layout function if it can live in a component (page fetches run sequentially, a route-level waterfall).</li>
      <li>Do NOT fetch in <code>connectedCallback</code> / <code>Task</code> for data that is knowable server-side (that yields a fallback-then-RPC, not first-paint data).</li>
      <li>Do NOT expect <code>renderFallback()</code> to affect the first paint, and do NOT add <code>renderError()</code> on every component (isolation is automatic).</li>
    </ul>

    <h2>Slots: Content Projection</h2>
    <p>Slots are how a parent passes content into a component. If you are coming from React, think of the default slot as <code>children</code>. <strong>WebJs supports the full shadow-DOM <code>&lt;slot&gt;</code> surface in light DOM as well as shadow DOM</strong>, so every example below works identically whether the component sets <code>static shadow = true</code> or leaves it at the default (light DOM). The light-DOM runtime mirrors <code>HTMLSlotElement.assignedNodes()</code>, <code>assignedElements()</code>, <code>assignedSlot</code>, and the <code>slotchange</code> event, plus named slots, fallback content, and first-wins resolution. To our knowledge no other web-components framework offers this complete parity in light DOM. Lit's slot APIs only work inside shadow roots, and Stencil's light-DOM slot polyfill has known gaps around fallback content and mixed shadow / non-shadow trees.</p>

    <h3>The native slot API, in light DOM</h3>
    <p>There is no WebJs-specific slot API. Light-DOM slots ARE the native DOM slot API, so post-mount writes are live exactly as in shadow DOM: <code>appendChild</code>, <code>insertBefore</code>, <code>removeChild</code>, <code>el.remove()</code>, <code>innerHTML</code>, flipping a child's <code>slot=""</code> attribute, and <code>HTMLSlotElement.assign()</code> all re-project immediately. The reads (<code>assignedNodes()</code>, <code>assignedElements()</code>, <code>assignedSlot</code>) and the <code>slotchange</code> event behave identically to shadow DOM, including native async-coalesced <code>slotchange</code> timing. One caveat rides <code>assign()</code>, which in light DOM is an <em>extension</em> (an element-bound overlay that works alongside name matching) while native shadow <code>assign()</code> only works under <code>slotAssignment: 'manual'</code>, a mode WebJs's shadow side does not set. So <code>assign()</code> is the one write that does not survive flipping to <code>static shadow = true</code>; prefer <code>slot=""</code> attributes in a component meant to move between modes.</p>

    <pre>const card = document.querySelector('my-card');

// Every one of these is live, and identical to shadow DOM:
card.appendChild(node);
card.querySelector('[slot=old]').slot = 'new'; // re-projects
card.innerHTML = '&lt;p&gt;replaced&lt;/p&gt;';

// Reads mirror shadow DOM:
card.querySelector('slot').assignedNodes();
node.assignedSlot;
card.querySelector('slot').addEventListener('slotchange', ...);</pre>

    <p><strong>Migrating from a shadow-DOM component</strong>: flip <code>static shadow</code> and nothing else changes, with the documented gaps on this page as the exceptions (most notably the <code>assign()</code> caveat above and first-render read timing). You write the same template and the same imperative code.</p>

    <p><strong>The four light-DOM gaps</strong>, all a consequence of light DOM having no shadow boundary, not missing features:</p>
    <ul>
      <li><strong>Structural host reads.</strong> <code>host.children</code> / <code>host.childNodes</code> / <code>host.querySelector(':scope > ...')</code> and the <code>innerHTML</code> <em>getter</em> read the rendered template, not the authored children (in shadow DOM the authored children stay in the host's light tree). Read slotted content with <code>assignedNodes()</code> instead.</li>
      <li><strong><code>assignedChild.parentNode</code></strong> is the <code>&lt;slot&gt;</code> element, not the host.</li>
      <li><strong><code>::slotted()</code> CSS</strong> is shadow-only (it needs the boundary to select across). In light DOM, style slotted content with normal selectors or Tailwind on the children directly, which is strictly more powerful.</li>
      <li><strong>Initial-projection timing.</strong> The first light-DOM projection lands one microtask after the first render, so <code>firstUpdated()</code> sees the <code>&lt;slot&gt;</code> element with an <em>empty</em> <code>assignedNodes()</code> (shadow DOM projects natively before it). Read assigned content from a <code>slotchange</code> listener, or after a microtask. Every later read and every mutation-driven update is identical in both modes.</li>
    </ul>

    <p><strong>Conditional-on-slot</strong> at render time (branching a template on whether a slot has content) is not a thing in either mode, because a shadow template can't branch on light-child presence at render time either. Use CSS <code>:has()</code> / <code>slot:empty</code>, or a <code>slotchange</code> listener.</p>

    <p>A generic DOM library that reaches into a component should operate on the assigned nodes, never on the host element itself.</p>

    <p><strong>Live writes need the component's JS on the page.</strong> A display-only slotted wrapper (a component that only renders a <code>&lt;slot&gt;</code>, with no interactivity) is elided, so it ships no JavaScript and its post-mount native writes are inert, the same as any elided component. A component that is actually interacted with ships automatically (a client module references its tag); if a consumer reaches an otherwise-display-only wrapper through a string selector the analyzer cannot see, force it to ship with <code>static interactive = true</code>. Shadow-DOM components always ship, so this is the one boundary set by elision rather than by slots.</p>

    <p><strong>Forwarded slots project their content everywhere.</strong> A template can forward a slot into a nested component (<code>html\`&lt;inner-shell&gt;&lt;slot&gt;&lt;/slot&gt;&lt;/inner-shell&gt;\`</code>), and the outer component's content projects through it on a client-only mount, in the server-rendered first paint, and across hydration (it does not flash back to the fallback on the client). The renderer stamps each slot with the host whose template produced it, so a forwarded slot routes to the outer component that rendered it rather than the child it nests in.</p>

    <p><strong>A layout's named slots stay in sync across soft navigation.</strong> When a <em>layout</em> renders its <code>\${children}</code> inside a slotted shell and a page emits top-level <code>slot=""</code>-attributed children, the named-slot slices update on a soft-nav boundary swap just as the default slice does: the swap resyncs every slot of the enclosing shell from the incoming page.</p>

    <h3>Default Slot</h3>
    <p>The <code>&lt;slot&gt;&lt;/slot&gt;</code> element in a component's <code>render()</code> is where the parent's child content appears:</p>

    <pre>// Component definition
class AppShell extends WebComponent {
  // ...
  render() {
    return html\`
      &lt;header&gt;My App&lt;/header&gt;
      &lt;main&gt;&lt;slot&gt;&lt;/slot&gt;&lt;/main&gt;
      &lt;footer&gt;Copyright 2026&lt;/footer&gt;
    \`;
  }
}

// Usage: the &lt;p&gt; is projected into &lt;main&gt;
html\`
  &lt;app-shell&gt;
    &lt;p&gt;This paragraph appears inside the main slot.&lt;/p&gt;
  &lt;/app-shell&gt;
\`;</pre>

    <p>This is how WebJs layouts work: the <code>doc-shell</code> and <code>blog-shell</code> components in the examples use a default <code>&lt;slot&gt;</code> to receive page content from the router.</p>

    <h3>Named Slots</h3>
    <p>Use <code>&lt;slot name="..."&gt;</code> to route different pieces of content to different parts of a component:</p>

    <pre>class PageLayout extends WebComponent {
  static styles = css\`
    .sidebar { float: left; width: 200px; }
    .content { margin-left: 220px; }
    footer   { clear: both; border-top: 1px solid #ccc; padding-top: 16px; }
  \`;

  render() {
    return html\`
      &lt;div class="sidebar"&gt;
        &lt;slot name="sidebar"&gt;&lt;em&gt;No sidebar provided&lt;/em&gt;&lt;/slot&gt;
      &lt;/div&gt;
      &lt;div class="content"&gt;
        &lt;slot&gt;&lt;/slot&gt;
      &lt;/div&gt;
      &lt;footer&gt;
        &lt;slot name="footer"&gt;Default footer content&lt;/slot&gt;
      &lt;/footer&gt;
    \`;
  }
}
PageLayout.register('page-layout');

// Usage: assign content to named slots with the slot="" attribute
html\`
  &lt;page-layout&gt;
    &lt;nav slot="sidebar"&gt;
      &lt;a href="/"&gt;Home&lt;/a&gt;
      &lt;a href="/about"&gt;About&lt;/a&gt;
    &lt;/nav&gt;

    &lt;h1&gt;Main Content&lt;/h1&gt;
    &lt;p&gt;This goes into the default (unnamed) slot.&lt;/p&gt;

    &lt;small slot="footer"&gt;Custom footer here.&lt;/small&gt;
  &lt;/page-layout&gt;
\`;</pre>

    <p>Content without a <code>slot</code> attribute goes to the default (unnamed) slot. Content with <code>slot="name"</code> is routed to the matching <code>&lt;slot name="name"&gt;</code>. Text inside the <code>&lt;slot&gt;</code> tag itself is fallback content shown when no matching content is provided.</p>

    <h2>Lifecycle</h2>
    <p>WebJs components use the standard custom element lifecycle callbacks. If you override them, <strong>always call super</strong>.</p>

    <h3>connectedCallback()</h3>
    <p>Called when the element is inserted into the document. This is where WebJs attaches the shadow root, adopts styles, and performs the first render. Use it for setup work like fetching data, opening WebSocket connections, or reading from <code>localStorage</code>:</p>

    <pre>connectedCallback() {
  super.connectedCallback();  // REQUIRED: sets up shadow root + first render
  this._ws = connectWS('/api/chat', {
    onMessage: (msg) =&gt; this.messages.set([...this.messages.get(), msg]),
  });
}</pre>

    <blockquote>Forgetting <code>super.connectedCallback()</code> is the #1 mistake. Without it, the component will never render.</blockquote>

    <h3>disconnectedCallback()</h3>
    <p>Called when the element is removed from the document. Clean up event listeners, timers, WebSocket connections, and other resources:</p>

    <pre>disconnectedCallback() {
  this._ws?.close();
  this._ws = null;
  clearInterval(this._timer);
}</pre>

    <p>You do not need to call <code>super.disconnectedCallback()</code> (the base class is a no-op), but it does not hurt to include it for safety.</p>

    <h3>attributeChangedCallback(name, oldValue, newValue)</h3>
    <p>Called when one of the <code>observedAttributes</code> changes. WebJs handles this for you. It coerces the attribute value based on the type declared in the factory shape, sets the corresponding instance property, and schedules a re-render. You rarely need to override this, but you can if you need side effects when a specific attribute changes:</p>

    <pre>attributeChangedCallback(name, oldVal, newVal) {
  super.attributeChangedCallback(name, oldVal, newVal);
  if (name === 'src' &amp;&amp; newVal !== oldVal) {
    this._loadImage(newVal);
  }
}</pre>

    <h3>Render Is Automatic</h3>
    <p>You never call <code>render()</code> directly. It is called automatically:</p>
    <ul>
      <li>Once during <code>connectedCallback()</code> (first paint).</li>
      <li>After every signal write the render reads (tracked by the built-in SignalWatcher).</li>
      <li>After every reactive-property assignment.</li>
      <li>After every <code>requestUpdate()</code> call.</li>
      <li>After every observed attribute change.</li>
    </ul>

    <h2>Events in Templates</h2>
    <p>Attach event listeners using the <code>@event</code> syntax in templates. This works like React's <code>onClick</code>, <code>onSubmit</code>, etc., but maps directly to DOM event names:</p>

    <pre>render() {
  return html\`
    &lt;button @click=\${() =&gt; this.increment()}&gt;Click me&lt;/button&gt;
    &lt;form @submit=\${(e) =&gt; this.handleSubmit(e)}&gt;
      &lt;input @input=\${(e) =&gt; this.onInput(e)} /&gt;
      &lt;button type="submit"&gt;Send&lt;/button&gt;
    &lt;/form&gt;
  \`;
}</pre>

    <h3>How Event Binding Works</h3>
    <ul>
      <li><strong>Server rendering</strong>: <code>@event</code> bindings are stripped during SSR. The HTML sent to the browser contains no inline handlers. This is safe, clean, and Content-Security-Policy friendly.</li>
      <li><strong>Client rendering</strong>: on the client, each <code>@event</code> binding creates a <strong>stable dispatcher</strong> function that is registered once with <code>addEventListener</code>. When you re-render with a new handler reference, the dispatcher is updated in place, so no listener is removed and re-added. This eliminates event listener churn that plagues naive re-render strategies.</li>
    </ul>

    <pre>// Even though this creates a new arrow function on every render,
// the actual addEventListener is only called once. The dispatcher
// swaps the inner handler reference behind the scenes.
render() {
  return html\`
    &lt;button @click=\${() =&gt; this.count.set(this.count.get() + 1)}&gt;
      \${this.count.get()}
    &lt;/button&gt;
  \`;
}</pre>

    <h2>Properties vs Attributes in Templates</h2>
    <p>Templates support three binding prefixes for setting values on elements:</p>

    <h3>Regular Attributes: <code>attr=\${value}</code></h3>
    <p>Sets an HTML attribute. The value is stringified. If the value is <code>null</code>, <code>undefined</code>, or <code>false</code>, the attribute is removed.</p>

    <pre>html\`&lt;input type="text" value=\${this.name} class=\${this.active ? 'on' : 'off'} /&gt;\`</pre>

    <h3>Property Bindings: <code>.prop=\${value}</code></h3>
    <p>Sets a JavaScript property directly on the DOM element, bypassing attribute serialization. Use this when you need to pass objects, arrays, or other non-string values to a child component:</p>

    <pre>html\`&lt;my-chart .data=\${this.chartData} .options=\${{ animate: true }}&gt;&lt;/my-chart&gt;\`</pre>

    <p><strong>On custom elements, property bindings round-trip through SSR.</strong> The renderer serializes the value via webjs's wire format (which handles Array, Object, Date, Map, Set, BigInt, and reference cycles) and emits it as a <code>data-webjs-prop-*</code> attribute. The SSR walker reads the attribute before calling <code>render()</code> so the component's first paint includes the bound value. On the client, <code>connectedCallback</code> applies and strips the attribute. End-to-end DX: <code>html\`&lt;post-list .posts=\${posts}&gt;&lt;/post-list&gt;\`</code> in a page function just works, with rich types preserved.</p>

    <p><strong>On native elements (<code>&lt;input&gt;</code>, <code>&lt;button&gt;</code>, etc.), property bindings still drop at SSR.</strong> Native elements have no SSR walker that would consume the side-channel attribute, and the framework's HTML primitives already cover this case via the attribute form (<code>value=\${v}</code>, <code>checked=\${b}</code>). When the template runs in the browser (component <code>render()</code>, dynamic re-renders), the property is set normally. The property form is most useful for two-way controlled inputs via <code>.value=\${live(v)}</code> paired with an <code>@input</code> handler.</p>

    <p><strong>Unserializable values</strong> (functions, class instances with private state, DOM nodes) drop at SSR with a single-line dev warning. The browser sees the property as <code>undefined</code>. Use <code>@event=\${fn}</code> for callbacks or set imperatively in <code>firstUpdated</code> for client-only references.</p>

    <h3>Boolean Attributes: <code>?attr=\${flag}</code></h3>
    <p>Adds the attribute if the value is truthy, removes it if falsy. This is the correct way to handle boolean HTML attributes like <code>disabled</code>, <code>checked</code>, <code>hidden</code>, and <code>readonly</code>:</p>

    <pre>html\`
  &lt;button ?disabled=\${!this.connected.get()}&gt;Send&lt;/button&gt;
  &lt;input ?checked=\${this.agreed.get()} type="checkbox" /&gt;
  &lt;div ?hidden=\${this.items.get().length === 0}&gt;No items&lt;/div&gt;
\`</pre>

    <p>During SSR, <code>?disabled=\${true}</code> emits <code>disabled=""</code> and <code>?disabled=\${false}</code> emits nothing, matching how the browser interprets boolean attributes.</p>

    <h2>Class.register('tag')</h2>
    <p>Register the component with <code>Class.register('tag')</code> at the bottom of the file:</p>

    <pre>MyCounter.register('my-counter');</pre>

    <p>WebJs wraps the native API (and installs a compatible shim on the server) so the same line works in both environments:</p>
    <ul>
      <li><strong>Browser</strong>: tells the browser to upgrade all <code>&lt;my-counter&gt;</code> elements with the <code>MyCounter</code> class, and mirrors the mapping into webjs's internal registry.</li>
      <li><strong>Server</strong>: stores the class in the internal registry so <code>renderToString</code> can look it up for Declarative Shadow DOM injection.</li>
    </ul>

    <p>Module URLs for <code>&lt;link rel="modulepreload"&gt;</code> hints are discovered separately, by a server-side scanner that walks the app tree on the first request (memoized, and re-run after each rebuild) and derives the file path for each discovered tag. No per-component <code>import.meta.url</code> argument needed.</p>

    <blockquote>Always call <code>Class.register</code> at the module's top level, outside the class body. The component registers as soon as the module is imported, both on server and client.</blockquote>

    <p>The tag argument accepts any short-string quote style. <code>register('my-counter')</code>, <code>register("my-counter")</code>, and <code>register(&#96;my-counter&#96;)</code> are all equivalent. The framework's <code>tag-name-has-hyphen</code> lint rule reads the tag through any of them.</p>

    <h2>Server Rendering</h2>
    <p>WebJs components are server-rendered using <strong>Declarative Shadow DOM</strong>. When the server renders a page containing <code>&lt;my-counter count="5"&gt;&lt;/my-counter&gt;</code>, the output looks like:</p>

    <pre>&lt;my-counter count="5"&gt;
  &lt;template shadowrootmode="open"&gt;
    &lt;style&gt;
      :host { display: inline-flex; gap: 8px; }
      button { font: inherit; padding: 4px 12px; }
    &lt;/style&gt;
    &lt;button&gt;-&lt;/button&gt;
    &lt;output&gt;5&lt;/output&gt;
    &lt;button&gt;+&lt;/button&gt;
  &lt;/template&gt;
&lt;/my-counter&gt;</pre>

    <h3>How SSR Works</h3>
    <ul>
      <li>The server imports the component module, which calls <code>Class.register('tag')</code> and stores the class in the registry.</li>
      <li>During <code>renderToString()</code>, the server scans the output HTML for registered custom element tags.</li>
      <li>For each match, it creates a temporary instance, applies attributes from the HTML, calls <code>render()</code>, and wraps the result in a <code>&lt;template shadowrootmode="open"&gt;</code> block with the component's styles.</li>
      <li>The browser parses this as a native declarative shadow root, so the content is visible <strong>before any JavaScript loads</strong>.</li>
      <li>When the component's JS module eventually loads and the custom element upgrades, the existing shadow root is reused. The client renderer performs a fine-grained diff against the already-painted DOM.</li>
    </ul>

    <h3>Async Rendering on the Server</h3>
    <p>On the server, <code>render()</code> can be async. This lets you fetch data inside a component:</p>

    <pre>class UserProfile extends WebComponent({ userId: String }) {
  constructor() {
    super();
    this.userId = '';
  }

  async render() {
    // This await is resolved during SSR, so the full HTML is sent to the client
    const user = await fetch(\`/api/users/\${this.userId}\`).then(r =&gt; r.json());
    return html\`
      &lt;h2&gt;\${user.name}&lt;/h2&gt;
      &lt;p&gt;\${user.email}&lt;/p&gt;
    \`;
  }
}
UserProfile.register('user-profile');</pre>

    <p>On the client, <code>render()</code> is called synchronously. If you need async data on the client, fetch it in <code>connectedCallback()</code> and write a signal when the data arrives.</p>

    <h2>Fine-Grained Client Renderer</h2>
    <p>The client renderer does <strong>not</strong> rebuild the entire DOM on every state change. Instead, it tracks each dynamic "hole" in the template and only touches the parts that actually changed.</p>

    <h3>What Gets Preserved</h3>
    <ul>
      <li><strong>Focus</strong>: if an <code>&lt;input&gt;</code> is focused when a signal write triggers a re-render, it stays focused.</li>
      <li><strong>Cursor position</strong>: the text cursor inside an input or textarea does not jump.</li>
      <li><strong>Selection</strong>: text selections survive re-renders.</li>
      <li><strong>Scroll position</strong>: scroll state of overflow containers is not disturbed.</li>
    </ul>

    <p>This happens because the renderer only updates the specific text node, attribute, or property that changed. Elements that are not affected by the state change are never touched.</p>

    <h3>Template Caching</h3>
    <p>Templates are compiled once per unique <code>strings</code> array (the static parts of the tagged template). Because JavaScript engines intern tagged template string arrays, the same <code>html\`...\`</code> expression in a <code>render()</code> method produces the same <code>strings</code> identity on every call. This means:</p>
    <ul>
      <li>The template is parsed into a <code>&lt;template&gt;</code> element and a list of part descriptors <strong>once</strong>.</li>
      <li>On subsequent renders, the existing DOM is reused and only the changed values are applied.</li>
      <li>If the template shape changes (e.g., a conditional returns a different <code>html\`...\`</code>), the old DOM is torn down and rebuilt.</li>
    </ul>

    <h3>Keyed Lists with repeat()</h3>
    <p>By default, rendering an array of templates rebuilds all children when any item changes. For lists where items have stable identities, use <code>repeat()</code> to enable keyed reconciliation:</p>

    <pre>import { WebComponent, html, css, repeat } from '@webjsdev/core';

class TaskList extends WebComponent {
  tasks = signal([
    { id: 1, text: 'Buy groceries', done: false },
    { id: 2, text: 'Write docs', done: true },
    { id: 3, text: 'Ship feature', done: false },
  ]);

  toggle(id) {
    this.tasks.set(this.tasks.get().map(t =&gt;
      t.id === id ? { ...t, done: !t.done } : t
    ));
  }

  render() {
    return html\`
      &lt;ul&gt;
        \${repeat(
          this.tasks.get(),
          (task) =&gt; task.id,           // key function: must be stable + unique
          (task) =&gt; html\`
            &lt;li @click=\${() =&gt; this.toggle(task.id)}
                style=\${task.done ? 'text-decoration: line-through' : ''}&gt;
              \${task.text}
            &lt;/li&gt;
          \`
        )}
      &lt;/ul&gt;
    \`;
  }
}
TaskList.register('task-list');</pre>

    <h3>How repeat() Works</h3>
    <ul>
      <li>Each item is identified by the key returned from the key function (first argument after items).</li>
      <li>On re-render, items with matching keys <strong>update in place</strong>: the DOM nodes are reused, not recreated.</li>
      <li>New keys cause fresh nodes to be inserted. Missing keys cause nodes to be removed.</li>
      <li>When the order changes, existing DOM nodes are <strong>moved</strong> (via <code>insertBefore</code>), not destroyed and rebuilt. This preserves element identity, focus, scroll, and any internal state.</li>
    </ul>

    <blockquote>Use a stable ID from your data as the key, like <code>task.id</code> or <code>user.email</code>. Never use the array index as a key. It defeats the purpose of keyed reconciliation, just like in React.</blockquote>

    <p>On the server, <code>repeat()</code> is simply iterated in order. Keys are only used on the client for efficient DOM updates.</p>

    <h2>Putting It All Together</h2>
    <p>Here is a complete example showing properties, state, events, lifecycle, slots, and scoped styles in a single component:</p>

    <pre>import { WebComponent, html, css, repeat, connectWS } from '@webjsdev/core';

class ChatBox extends WebComponent {

  static styles = css\`
    :host { display: block; border: 1px solid var(--border); border-radius: var(--rad-lg); }
    .log  { height: 200px; overflow-y: auto; padding: var(--sp-4); }
    .log p { margin: 0 0 var(--sp-2); }
    form  { display: flex; gap: var(--sp-2); padding: var(--sp-3); border-top: 1px solid var(--border); }
    input { flex: 1; padding: var(--sp-2); border: 1px solid var(--border); border-radius: var(--rad); }
    button { padding: var(--sp-2) var(--sp-4); background: var(--accent); color: var(--accent-fg);
             border: 0; border-radius: var(--rad); cursor: pointer; }
  \`;

  _conn = null;
  lines = signal([]);
  connected = signal(false);

  connectedCallback() {
    super.connectedCallback();   // always call super!
    this._conn = connectWS('/api/chat', {
      onOpen:    () =&gt; this.connected.set(true),
      onClose:   () =&gt; this.connected.set(false),
      onMessage: (msg) =&gt; {
        this.lines.set([...this.lines.get(), msg].slice(-50));
      },
    });
  }

  disconnectedCallback() {
    this._conn?.close();
    this._conn = null;
  }

  send(e) {
    e.preventDefault();
    const input = this.shadowRoot.querySelector('input');
    if (!input.value.trim() || !this._conn) return;
    this._conn.send({ text: input.value });
    input.value = '';
  }

  render() {
    const lines = this.lines.get();
    const connected = this.connected.get();
    return html\`
      &lt;div class="log"&gt;
        \${lines.length === 0
          ? html\`&lt;p&gt;&lt;em&gt;No messages yet.&lt;/em&gt;&lt;/p&gt;\`
          : repeat(lines, (l) =&gt; l.id, (l) =&gt; html\`&lt;p&gt;\${l.text}&lt;/p&gt;\`)}
      &lt;/div&gt;
      &lt;form @submit=\${(e) =&gt; this.send(e)}&gt;
        &lt;input placeholder=\${connected ? 'Say hi...' : 'Reconnecting...'}
               ?disabled=\${!connected} autocomplete="off" /&gt;
        &lt;button ?disabled=\${!connected}&gt;Send&lt;/button&gt;
      &lt;/form&gt;
    \`;
  }
}
ChatBox.register('chat-box');</pre>

    <h2>Quick Reference</h2>
    <ul>
      <li><strong>Extend</strong> the <code>WebComponent({ ... })</code> factory with your property shape (and optionally <code>static styles</code> for shadow-DOM components).</li>
      <li><strong>Implement</strong> <code>render()</code> returning <code>html\`...\`</code>.</li>
      <li><strong>Register</strong> with <code>ClassName.register('tag-name')</code> at the bottom of the file. Tag must contain a hyphen.</li>
      <li><strong>State</strong>: instance signals (<code>foo = signal(...)</code>) or reactive properties (the <code>WebComponent({ ... })</code> factory, with <code>prop()</code> for options). Both feed the same batched re-render scheduler.</li>
      <li><strong>Events</strong>: <code>@click</code>, <code>@submit</code>, <code>@input</code> in templates. Stable dispatchers, no listener churn.</li>
      <li><strong>Bindings</strong>: <code>attr=\${v}</code> for attributes, <code>.prop=\${v}</code> for properties, <code>?bool=\${v}</code> for booleans.</li>
      <li><strong>Slots</strong>: <code>&lt;slot&gt;</code> for default content, <code>&lt;slot name="x"&gt;</code> for named slots, fallback content, <code>assignedNodes()</code>, <code>slotchange</code>. Works identically in light DOM and shadow DOM.</li>
      <li><strong>Light DOM</strong> by default. Set <code>static shadow = true</code> to opt in to shadow DOM for scoped styles (<code>static styles = css\`...\`</code>) or third-party embed isolation.</li>
      <li><strong>Lifecycle</strong>: <code>connectedCallback()</code> (call super!), <code>disconnectedCallback()</code>, <code>attributeChangedCallback()</code>.</li>
      <li><strong>Lists</strong>: <code>repeat(items, keyFn, templateFn)</code> for efficient keyed updates.</li>
      <li><strong>SSR</strong>: components render to Declarative Shadow DOM. Async <code>render()</code> supported on the server.</li>
    </ul>

    <h2>Next Steps</h2>
    <ul>
      <li><a href="/docs/styling">Styling</a>: design tokens, scoped CSS, and theming in depth</li>
      <li><a href="/docs/ssr">Server-Side Rendering</a>: Declarative Shadow DOM, streaming, and hydration</li>
      <li><a href="/docs/server-actions">Server Actions</a>: call server functions from components</li>
      <li><a href="/docs/suspense">Streaming &amp; Suspense</a>: deferred data with fallback UI</li>
    </ul>
  `;
}
