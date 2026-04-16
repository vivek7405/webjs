import { html } from 'webjs';

export const metadata = { title: 'Components — webjs' };

export default function Components() {
  return html`
    <h1>Components</h1>
    <p>webjs components are <strong>standard HTML custom elements</strong> built on a thin base class called <code>WebComponent</code>. If you are coming from React, think of <code>WebComponent</code> as a class component whose render method returns a tagged template instead of JSX. The browser owns the component lifecycle — there is no virtual DOM, no reconciler, and no framework-specific component model to learn.</p>

    <h2>The WebComponent Base Class</h2>
    <p>Every interactive component extends <code>WebComponent</code> and declares three static fields: a <strong>tag name</strong>, a <strong>property map</strong>, and <strong>styles</strong>. Then it implements <code>render()</code> and registers itself.</p>

    <pre>import { WebComponent, html, css } from 'webjs';

class MyCounter extends WebComponent {
  static tag = 'my-counter';

  static properties = {
    count: { type: Number },
  };

  static styles = css\`
    :host { display: inline-flex; gap: 8px; align-items: center; }
    button { font: inherit; padding: 4px 12px; cursor: pointer; }
    output { font-variant-numeric: tabular-nums; min-width: 3ch; text-align: center; }
  \`;

  count = 0;

  render() {
    return html\`
      &lt;button @click=\${() =&gt; { this.count--; this.requestUpdate(); }}&gt;-&lt;/button&gt;
      &lt;output&gt;\${this.count}&lt;/output&gt;
      &lt;button @click=\${() =&gt; { this.count++; this.requestUpdate(); }}&gt;+&lt;/button&gt;
    \`;
  }
}

MyCounter.register(import.meta.url);</pre>

    <p>That is a complete, working component. Import it from a page or layout and use it like any HTML element:</p>

    <pre>import '../components/my-counter.ts';

export default function Home() {
  return html\`&lt;my-counter count="5"&gt;&lt;/my-counter&gt;\`;
}</pre>

    <h2>Tag Names</h2>
    <p>The HTML spec requires that custom element names contain a <strong>hyphen</strong>. This is how the browser distinguishes <code>&lt;my-counter&gt;</code> from built-in elements like <code>&lt;div&gt;</code>. Set the tag via the <code>static tag</code> field:</p>

    <pre>class UserCard extends WebComponent {
  static tag = 'user-card';  // must contain a hyphen
  // ...
}</pre>

    <p>If you forget the hyphen, the browser will throw when the element is registered. If you forget <code>static tag</code> entirely, <code>register()</code> throws with a clear error message.</p>

    <h2>Properties</h2>
    <p>The <code>static properties</code> object declares which HTML attributes the component observes, along with their type for coercion. The browser's <code>observedAttributes</code> list is auto-derived from the property names — you never write it by hand.</p>

    <pre>class UserCard extends WebComponent {
  static tag = 'user-card';

  static properties = {
    name:     { type: String },
    age:      { type: Number },
    active:   { type: Boolean },
    config:   { type: Object },
    tags:     { type: Array },
  };

  // Default values
  name = 'Anonymous';
  age = 0;
  active = false;
  config = {};
  tags = [];

  render() {
    return html\`
      &lt;p&gt;\${this.name} (age \${this.age})&lt;/p&gt;
      &lt;p&gt;Active: \${this.active ? 'yes' : 'no'}&lt;/p&gt;
      &lt;p&gt;Tags: \${this.tags.join(', ')}&lt;/p&gt;
    \`;
  }
}
UserCard.register(import.meta.url);</pre>

    <h3>Attribute-to-Property Coercion</h3>
    <p>When an attribute changes on the DOM element, webjs coerces the string value to the declared type:</p>

    <ul>
      <li><strong>String</strong> — passed through as-is.</li>
      <li><strong>Number</strong> — converted via <code>Number(value)</code>. Null attributes become <code>null</code>.</li>
      <li><strong>Boolean</strong> — the attribute is <code>true</code> if present and not <code>"false"</code>. Removing the attribute sets <code>false</code>.</li>
      <li><strong>Object / Array</strong> — parsed via <code>JSON.parse()</code>. If parsing fails, the raw string is used.</li>
    </ul>

    <p>Property names are automatically converted between camelCase (JavaScript) and kebab-case (HTML). A property named <code>userName</code> observes the attribute <code>user-name</code>.</p>

    <blockquote>If you are coming from React: properties in webjs serve a similar role to props, but they are backed by real DOM attributes. You can inspect them in DevTools, set them from plain HTML, and they survive page serialization during SSR.</blockquote>

    <h2>State</h2>
    <p>For internal, non-attribute state, use <code>this.state</code> and <code>this.setState()</code>. This pattern will feel familiar if you have used React class components.</p>

    <pre>class TodoList extends WebComponent {
  static tag = 'todo-list';

  constructor() {
    super();
    this.state = {
      items: [],
      filter: 'all',
    };
  }

  addItem(text) {
    this.setState({
      items: [...this.state.items, { id: Date.now(), text, done: false }],
    });
  }

  toggleItem(id) {
    this.setState({
      items: this.state.items.map(it =&gt;
        it.id === id ? { ...it, done: !it.done } : it
      ),
    });
  }

  render() {
    const visible = this.state.filter === 'all'
      ? this.state.items
      : this.state.items.filter(it =&gt; !it.done);

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
TodoList.register(import.meta.url);</pre>

    <h3>How setState Works</h3>
    <ul>
      <li><strong>Shallow merge</strong> — <code>this.setState({ filter: 'active' })</code> merges <code>{ filter: 'active' }</code> into <code>this.state</code> without touching other keys. This is the same semantics as React's <code>setState</code>.</li>
      <li><strong>Batched re-render</strong> — calling <code>setState</code> (or <code>requestUpdate</code>) multiple times in the same synchronous block only triggers <strong>one</strong> re-render. Updates are batched via <code>queueMicrotask</code>, so the DOM update happens after the current call stack finishes but before the next frame paints.</li>
    </ul>

    <pre>// These two calls result in a single re-render, not two:
this.setState({ count: 1 });
this.setState({ label: 'hello' });
// render() is called once with { count: 1, label: 'hello' }</pre>

    <h2>Styles</h2>
    <p>Use the <code>css</code> tagged template to declare scoped styles. They are automatically adopted into the component's shadow root.</p>

    <pre>import { WebComponent, html, css } from 'webjs';

class StyledCard extends WebComponent {
  static tag = 'styled-card';
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
StyledCard.register(import.meta.url);</pre>

    <h3>How Styles Are Applied</h3>
    <ul>
      <li><strong>adoptedStyleSheets</strong> — when the browser supports it (all modern browsers), styles are applied via <code>adoptedStyleSheets</code> on the shadow root. This is the most efficient path: the browser parses the CSS once and shares the <code>CSSStyleSheet</code> object across all instances of the same component.</li>
      <li><strong>Fallback</strong> — on older browsers, a <code>&lt;style&gt;</code> element is injected into the shadow root instead.</li>
    </ul>

    <h3>Design Tokens via CSS Custom Properties</h3>
    <p>CSS custom properties (variables) <strong>inherit across shadow DOM boundaries</strong>. This is the primary mechanism for theming in webjs. Define tokens on <code>:root</code> or a parent element, and every component in the tree can read them:</p>

    <pre>/* In your root layout or global stylesheet */
:root {
  --accent: oklch(0.58 0.15 55);
  --bg-elev: white;
  --border: oklch(0.88 0.01 75);
  --rad-lg: 12px;
  --sp-4: 16px;
}

/* Inside a component's static styles — these "just work" */
static styles = css\`
  :host {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--rad-lg);
    padding: var(--sp-4);
  }
  .accent { color: var(--accent); }
\`;</pre>

    <blockquote>This is fundamentally different from React CSS-in-JS solutions that require runtime injection or build tooling. webjs uses the platform: shadow DOM gives you scoping, CSS custom properties give you theming, and there is nothing to configure.</blockquote>

    <h2>Shadow DOM</h2>
    <p>Shadow DOM is <strong>enabled by default</strong>. Every component gets its own shadow root, which means:</p>
    <ul>
      <li>Styles declared in <code>static styles</code> are scoped — they cannot leak out and document styles cannot leak in (except CSS custom properties, which inherit by design).</li>
      <li>The component's internal DOM is encapsulated. <code>document.querySelector</code> from outside will not reach elements inside the shadow root.</li>
      <li>Content from the parent is projected into the component via <code>&lt;slot&gt;</code> elements.</li>
    </ul>

    <h3>Opting Out: Light DOM</h3>
    <p>Set <code>static shadow = false</code> to render directly into the element (light DOM). This is useful for components that need to participate in the parent's CSS cascade, or for layout primitives that should not create a style boundary:</p>

    <pre>class InlineAlert extends WebComponent {
  static tag = 'inline-alert';
  static shadow = false;  // renders into light DOM

  static properties = {
    type: { type: String },
  };

  type = 'info';

  render() {
    return html\`
      &lt;div class="alert alert--\${this.type}"&gt;
        \${this.type === 'warning' ? '⚠ ' : ''}
        This content lives in light DOM.
      &lt;/div&gt;
    \`;
  }
}
InlineAlert.register(import.meta.url);</pre>

    <p>With <code>shadow = false</code>, <code>static styles</code> are <strong>not</strong> adopted (there is no shadow root to adopt them into). Style the component via regular document stylesheets instead.</p>

    <h2>Slots: Content Projection</h2>
    <p>Slots are how a parent passes content into a shadow DOM component. If you are coming from React, think of the default slot as <code>children</code>.</p>

    <h3>Default Slot</h3>
    <p>The <code>&lt;slot&gt;&lt;/slot&gt;</code> element in a component's <code>render()</code> is where the parent's child content appears:</p>

    <pre>// Component definition
class AppShell extends WebComponent {
  static tag = 'app-shell';
  // ...
  render() {
    return html\`
      &lt;header&gt;My App&lt;/header&gt;
      &lt;main&gt;&lt;slot&gt;&lt;/slot&gt;&lt;/main&gt;
      &lt;footer&gt;Copyright 2026&lt;/footer&gt;
    \`;
  }
}

// Usage — the &lt;p&gt; is projected into &lt;main&gt;
html\`
  &lt;app-shell&gt;
    &lt;p&gt;This paragraph appears inside the main slot.&lt;/p&gt;
  &lt;/app-shell&gt;
\`;</pre>

    <p>This is how webjs layouts work: the <code>doc-shell</code> and <code>blog-shell</code> components in the examples use a default <code>&lt;slot&gt;</code> to receive page content from the router.</p>

    <h3>Named Slots</h3>
    <p>Use <code>&lt;slot name="..."&gt;</code> to route different pieces of content to different parts of a component:</p>

    <pre>class PageLayout extends WebComponent {
  static tag = 'page-layout';
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
PageLayout.register(import.meta.url);

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
    <p>webjs components use the standard custom element lifecycle callbacks. If you override them, <strong>always call super</strong>.</p>

    <h3>connectedCallback()</h3>
    <p>Called when the element is inserted into the document. This is where webjs attaches the shadow root, adopts styles, and performs the first render. Use it for setup work like fetching data, opening WebSocket connections, or reading from <code>localStorage</code>:</p>

    <pre>connectedCallback() {
  super.connectedCallback();  // REQUIRED — sets up shadow root + first render
  this._ws = connectWS('/api/chat', {
    onMessage: (msg) =&gt; this.setState({ messages: [...this.state.messages, msg] }),
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
    <p>Called when one of the <code>observedAttributes</code> changes. webjs handles this for you — it coerces the attribute value based on the type declared in <code>static properties</code>, sets the corresponding instance property, and schedules a re-render. You rarely need to override this, but you can if you need side effects when a specific attribute changes:</p>

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
      <li>After every <code>setState()</code> call (batched via microtask).</li>
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
      <li><strong>Server rendering</strong> — <code>@event</code> bindings are stripped during SSR. The HTML sent to the browser contains no inline handlers. This is safe, clean, and Content-Security-Policy friendly.</li>
      <li><strong>Client rendering</strong> — on the client, each <code>@event</code> binding creates a <strong>stable dispatcher</strong> function that is registered once with <code>addEventListener</code>. When you re-render with a new handler reference, the dispatcher is updated in place — no listener is removed and re-added. This eliminates event listener churn that plagues naive re-render strategies.</li>
    </ul>

    <pre>// Even though this creates a new arrow function on every render,
// the actual addEventListener is only called once. The dispatcher
// swaps the inner handler reference behind the scenes.
render() {
  return html\`
    &lt;button @click=\${() =&gt; this.setState({ count: this.state.count + 1 })}&gt;
      \${this.state.count}
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

    <p>Property bindings are <strong>stripped during SSR</strong> (there is no DOM object to set a property on). Use them for client-only interactivity.</p>

    <h3>Boolean Attributes: <code>?attr=\${flag}</code></h3>
    <p>Adds the attribute if the value is truthy, removes it if falsy. This is the correct way to handle boolean HTML attributes like <code>disabled</code>, <code>checked</code>, <code>hidden</code>, and <code>readonly</code>:</p>

    <pre>html\`
  &lt;button ?disabled=\${!this.state.connected}&gt;Send&lt;/button&gt;
  &lt;input ?checked=\${this.state.agreed} type="checkbox" /&gt;
  &lt;div ?hidden=\${this.state.items.length === 0}&gt;No items&lt;/div&gt;
\`</pre>

    <p>During SSR, <code>?disabled=\${true}</code> emits <code>disabled=""</code> and <code>?disabled=\${false}</code> emits nothing — matching how the browser interprets boolean attributes.</p>

    <h2>register(import.meta.url)</h2>
    <p>Every component must call <code>register()</code> after its class definition. This static method does two things:</p>

    <pre>MyCounter.register(import.meta.url);</pre>

    <ol>
      <li><strong>Registers with <code>customElements.define()</code></strong> — on the browser, this tells the browser to upgrade all <code>&lt;my-counter&gt;</code> elements with the <code>MyCounter</code> class. On the server, it stores the class in an internal registry so <code>renderToString</code> can look it up.</li>
      <li><strong>Stores the module URL</strong> — passing <code>import.meta.url</code> lets the SSR shell emit <code>&lt;link rel="modulepreload"&gt;</code> hints for the component's JavaScript file. This eliminates a network round-trip: the browser starts fetching the module <strong>before</strong> the HTML parser encounters the custom element tag, so the component upgrades faster.</li>
    </ol>

    <p>You can omit <code>import.meta.url</code> and just call <code>MyCounter.register()</code>, but you lose the modulepreload optimization.</p>

    <pre>// With module URL — recommended
Counter.register(import.meta.url);

// Without module URL — works but no modulepreload hint
Counter.register();</pre>

    <blockquote>Always call <code>register()</code> at the module's top level, outside the class body. This ensures the component is registered as soon as the module is imported, both on server and client.</blockquote>

    <h2>Server Rendering</h2>
    <p>webjs components are server-rendered using <strong>Declarative Shadow DOM</strong>. When the server renders a page containing <code>&lt;my-counter count="5"&gt;&lt;/my-counter&gt;</code>, the output looks like:</p>

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
      <li>The server imports the component module, which calls <code>register()</code> and stores the class in the registry.</li>
      <li>During <code>renderToString()</code>, the server scans the output HTML for registered custom element tags.</li>
      <li>For each match, it creates a temporary instance, applies attributes from the HTML, calls <code>render()</code>, and wraps the result in a <code>&lt;template shadowrootmode="open"&gt;</code> block with the component's styles.</li>
      <li>The browser parses this as a native declarative shadow root — the content is visible <strong>before any JavaScript loads</strong>.</li>
      <li>When the component's JS module eventually loads and the custom element upgrades, the existing shadow root is reused. The client renderer performs a fine-grained diff against the already-painted DOM.</li>
    </ul>

    <h3>Async Rendering on the Server</h3>
    <p>On the server, <code>render()</code> can be async. This lets you fetch data inside a component:</p>

    <pre>class UserProfile extends WebComponent {
  static tag = 'user-profile';
  static properties = { userId: { type: String } };

  userId = '';

  async render() {
    // This await is resolved during SSR — the full HTML is sent to the client
    const user = await fetch(\`/api/users/\${this.userId}\`).then(r =&gt; r.json());
    return html\`
      &lt;h2&gt;\${user.name}&lt;/h2&gt;
      &lt;p&gt;\${user.email}&lt;/p&gt;
    \`;
  }
}
UserProfile.register(import.meta.url);</pre>

    <p>On the client, <code>render()</code> is called synchronously. If you need async data on the client, fetch it in <code>connectedCallback()</code> and call <code>setState()</code> when the data arrives.</p>

    <h2>Fine-Grained Client Renderer</h2>
    <p>The client renderer does <strong>not</strong> rebuild the entire DOM on every state change. Instead, it tracks each dynamic "hole" in the template and only touches the parts that actually changed.</p>

    <h3>What Gets Preserved</h3>
    <ul>
      <li><strong>Focus</strong> — if an <code>&lt;input&gt;</code> is focused when you call <code>setState()</code>, it stays focused after re-render.</li>
      <li><strong>Cursor position</strong> — the text cursor inside an input or textarea does not jump.</li>
      <li><strong>Selection</strong> — text selections survive re-renders.</li>
      <li><strong>Scroll position</strong> — scroll state of overflow containers is not disturbed.</li>
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

    <pre>import { WebComponent, html, css, repeat } from 'webjs';

class TaskList extends WebComponent {
  static tag = 'task-list';

  constructor() {
    super();
    this.state = {
      tasks: [
        { id: 1, text: 'Buy groceries', done: false },
        { id: 2, text: 'Write docs', done: true },
        { id: 3, text: 'Ship feature', done: false },
      ],
    };
  }

  toggle(id) {
    this.setState({
      tasks: this.state.tasks.map(t =&gt;
        t.id === id ? { ...t, done: !t.done } : t
      ),
    });
  }

  render() {
    return html\`
      &lt;ul&gt;
        \${repeat(
          this.state.tasks,
          (task) =&gt; task.id,           // key function — must be stable + unique
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
TaskList.register(import.meta.url);</pre>

    <h3>How repeat() Works</h3>
    <ul>
      <li>Each item is identified by the key returned from the key function (first argument after items).</li>
      <li>On re-render, items with matching keys <strong>update in place</strong> — the DOM nodes are reused, not recreated.</li>
      <li>New keys cause fresh nodes to be inserted. Missing keys cause nodes to be removed.</li>
      <li>When the order changes, existing DOM nodes are <strong>moved</strong> (via <code>insertBefore</code>), not destroyed and rebuilt. This preserves element identity, focus, scroll, and any internal state.</li>
    </ul>

    <blockquote>Use a stable ID from your data as the key — like <code>task.id</code> or <code>user.email</code>. Never use the array index as a key; it defeats the purpose of keyed reconciliation, just like in React.</blockquote>

    <p>On the server, <code>repeat()</code> is simply iterated in order — keys are only used on the client for efficient DOM updates.</p>

    <h2>Putting It All Together</h2>
    <p>Here is a complete example showing properties, state, events, lifecycle, slots, and scoped styles in a single component:</p>

    <pre>import { WebComponent, html, css, repeat, connectWS } from 'webjs';

class ChatBox extends WebComponent {
  static tag = 'chat-box';

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

  constructor() {
    super();
    this.state = { lines: [], connected: false };
  }

  connectedCallback() {
    super.connectedCallback();   // always call super!
    this._conn = connectWS('/api/chat', {
      onOpen:    () =&gt; this.setState({ connected: true }),
      onClose:   () =&gt; this.setState({ connected: false }),
      onMessage: (msg) =&gt; {
        this.setState({ lines: [...this.state.lines, msg].slice(-50) });
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
    const { lines, connected } = this.state;
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
ChatBox.register(import.meta.url);</pre>

    <h2>Quick Reference</h2>
    <ul>
      <li><strong>Extend</strong> <code>WebComponent</code> and set <code>static tag</code>, <code>static properties</code>, <code>static styles</code>.</li>
      <li><strong>Implement</strong> <code>render()</code> returning <code>html\`...\`</code>.</li>
      <li><strong>Register</strong> with <code>ClassName.register(import.meta.url)</code>.</li>
      <li><strong>State</strong> — use <code>this.setState({...})</code> for shallow merge + batched re-render.</li>
      <li><strong>Events</strong> — <code>@click</code>, <code>@submit</code>, <code>@input</code> in templates. Stable dispatchers, no listener churn.</li>
      <li><strong>Bindings</strong> — <code>attr=\${v}</code> for attributes, <code>.prop=\${v}</code> for properties, <code>?bool=\${v}</code> for booleans.</li>
      <li><strong>Slots</strong> — <code>&lt;slot&gt;</code> for default content, <code>&lt;slot name="x"&gt;</code> for named slots.</li>
      <li><strong>Shadow DOM</strong> — on by default. Set <code>static shadow = false</code> for light DOM.</li>
      <li><strong>Lifecycle</strong> — <code>connectedCallback()</code> (call super!), <code>disconnectedCallback()</code>, <code>attributeChangedCallback()</code>.</li>
      <li><strong>Lists</strong> — <code>repeat(items, keyFn, templateFn)</code> for efficient keyed updates.</li>
      <li><strong>SSR</strong> — components render to Declarative Shadow DOM. Async <code>render()</code> supported on the server.</li>
    </ul>

    <h2>Next Steps</h2>
    <ul>
      <li><a href="/docs/styling">Styling</a> — design tokens, scoped CSS, and theming in depth</li>
      <li><a href="/docs/ssr">Server-Side Rendering</a> — Declarative Shadow DOM, streaming, and hydration</li>
      <li><a href="/docs/server-actions">Server Actions</a> — call server functions from components</li>
      <li><a href="/docs/suspense">Streaming &amp; Suspense</a> — deferred data with fallback UI</li>
    </ul>
  `;
}
