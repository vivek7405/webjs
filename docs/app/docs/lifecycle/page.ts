import { html } from 'webjs';

export const metadata = { title: 'Lifecycle Hooks — webjs' };

export default function Lifecycle() {
  return html`
    <h1>Lifecycle Hooks</h1>
    <p>Every webjs component follows a predictable update cycle. When a property changes or <code>setState()</code> is called, the component goes through a series of hooks before and after rendering. Understanding this cycle lets you put logic in the right place — pre-render computation, one-time DOM setup, or post-render side effects.</p>

    <h2>The Update Cycle</h2>
    <p>When <code>setState()</code> or a property change triggers a re-render, the following hooks run in order:</p>

    <ol>
      <li><strong>shouldUpdate(changed)</strong> — Return <code>false</code> to skip the entire render. Default returns <code>true</code>.</li>
      <li><strong>willUpdate(changed)</strong> — Pre-render computation. Runs after <code>shouldUpdate</code> passes. Read-only: do not call <code>setState()</code> here.</li>
      <li><strong>Controllers' hostUpdate()</strong> — Every attached controller's <code>hostUpdate()</code> method runs.</li>
      <li><strong>render()</strong> — Returns a <code>TemplateResult</code>. The returned template is diffed against the existing DOM.</li>
      <li><strong>Controllers' hostUpdated()</strong> — Every attached controller's <code>hostUpdated()</code> method runs.</li>
      <li><strong>firstUpdated(changed)</strong> — Runs <em>only after the first render</em>. Never called again.</li>
      <li><strong>updated(changed)</strong> — Runs after <em>every</em> render, including the first.</li>
    </ol>

    <p>The <code>changed</code> parameter is a <code>Map&lt;string, unknown&gt;</code> where keys are the property names that changed and values are their <strong>previous</strong> values.</p>

    <h2>When to Use Each Hook</h2>

    <h3>shouldUpdate(changed)</h3>
    <p>Use for performance optimization on components that receive frequent updates but only need to re-render for certain changes.</p>

    <pre>shouldUpdate(changed) {
  // Only re-render when 'items' or 'filter' changed.
  // Ignore changes to 'highlightId' (handled via direct DOM manipulation).
  return changed.has('items') || changed.has('filter');
}</pre>

    <p>Most components do not need this. The default (<code>true</code>) is correct for the vast majority of cases. Add <code>shouldUpdate</code> only when you have measured a performance problem.</p>

    <h3>willUpdate(changed)</h3>
    <p>Use for computing derived values that the <code>render()</code> method needs. This is the place to transform state into render-ready data without triggering another update cycle.</p>

    <pre>willUpdate(changed) {
  if (changed.has('items') || changed.has('sortOrder')) {
    // Compute a sorted copy for render() to use.
    // Do NOT call setState() here — it would loop.
    this._sortedItems = [...this.state.items].sort((a, b) =&gt;
      this.state.sortOrder === 'asc'
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name)
    );
  }
}</pre>

    <p><strong>Important:</strong> <code>willUpdate</code> is read-only with respect to state. Calling <code>setState()</code> inside <code>willUpdate</code> would schedule another render, creating an infinite loop. Store derived data on plain instance properties (e.g., <code>this._sortedItems</code>) instead.</p>

    <h3>render()</h3>
    <p>The only required method. Returns a <code>TemplateResult</code> via the <code>html</code> tagged template. You never call <code>render()</code> directly — the framework calls it automatically.</p>

    <pre>render() {
  return html\`
    &lt;h2&gt;\${this.title}&lt;/h2&gt;
    &lt;ul&gt;
      \${this._sortedItems.map(item =&gt; html\`&lt;li&gt;\${item.name}&lt;/li&gt;\`)}
    &lt;/ul&gt;
  \`;
}</pre>

    <p>Keep <code>render()</code> pure — it should read state and return a template, nothing else. Side effects belong in <code>updated()</code> or <code>firstUpdated()</code>.</p>

    <h3>firstUpdated(changed)</h3>
    <p>Runs once after the very first render. The shadow DOM (or light DOM) is now populated, so you can safely query elements, measure dimensions, set focus, or initialize third-party libraries.</p>

    <pre>firstUpdated(changed) {
  // Focus the input on first render
  this.query('input')?.focus();

  // Initialize a chart library that needs a real DOM element
  this._chart = new Chart(this.query('#chart-canvas'), {
    type: 'line',
    data: this.chartData,
  });
}</pre>

    <p>Common uses: setting initial focus, attaching a ResizeObserver, initializing a canvas context, connecting to a third-party widget library.</p>

    <h3>updated(changed)</h3>
    <p>Runs after every render, including the first. Use it for side effects that depend on the current DOM state — syncing with external systems, triggering animations, or logging analytics events.</p>

    <pre>updated(changed) {
  if (changed.has('route')) {
    // Scroll to top when the route changes
    this.query('.content')?.scrollTo(0, 0);
  }

  if (changed.has('items')) {
    // Notify an external analytics system
    analytics.track('items_updated', { count: this.state.items.length });
  }
}</pre>

    <p><strong>Be careful with setState in updated().</strong> Calling <code>setState()</code> inside <code>updated()</code> triggers another render cycle. This is sometimes intentional (e.g., measuring a rendered element and storing its size), but make sure the condition eventually stabilizes to avoid infinite loops.</p>

    <h2>Full Example</h2>
    <p>A component that computes a filtered list in <code>willUpdate</code>, sets focus in <code>firstUpdated</code>, and syncs scroll position in <code>updated</code>:</p>

    <pre>import { WebComponent, html, css } from 'webjs';

class SearchableList extends WebComponent {
  static tag = 'searchable-list';

  static properties = {
    items: { type: Array },
  };

  static styles = css\`
    :host { display: block; }
    input { width: 100%; padding: 8px; margin-bottom: 8px; box-sizing: border-box; }
    ul { max-height: 300px; overflow-y: auto; margin: 0; padding: 0; list-style: none; }
    li { padding: 6px 8px; border-bottom: 1px solid var(--border, #eee); }
  \`;

  items = [];

  constructor() {
    super();
    this.state = { query: '' };
    this._filtered = [];
  }

  willUpdate(changed) {
    if (changed.has('items') || changed.has('query')) {
      const q = this.state.query.toLowerCase();
      this._filtered = q
        ? this.items.filter(it =&gt; it.name.toLowerCase().includes(q))
        : this.items;
    }
  }

  firstUpdated() {
    // Auto-focus the search input on first paint
    this.query('input')?.focus();
  }

  updated(changed) {
    if (changed.has('query')) {
      // Scroll the list back to the top whenever the filter changes
      this.query('ul')?.scrollTo(0, 0);
    }
  }

  render() {
    return html\`
      &lt;input placeholder="Search..."
             .value=\${this.state.query}
             @input=\${(e) =&gt; this.setState({ query: e.target.value })} /&gt;
      &lt;ul&gt;
        \${this._filtered.map(it =&gt; html\`&lt;li&gt;\${it.name}&lt;/li&gt;\`)}
      &lt;/ul&gt;
      &lt;p&gt;\${this._filtered.length} of \${this.items.length} items&lt;/p&gt;
    \`;
  }
}
SearchableList.register(import.meta.url);</pre>

    <h2>requestUpdate()</h2>
    <p>Manually schedule a re-render. Normally you use <code>setState()</code>, which calls <code>requestUpdate()</code> internally. Use <code>requestUpdate()</code> directly when you have mutated an instance property (not tracked by <code>setState</code>) and need the template to reflect the change.</p>

    <pre>// Mutating a non-state property — must manually request an update
this.count++;
this.requestUpdate();

// setState already calls requestUpdate — no need to call it separately
this.setState({ count: this.state.count + 1 });</pre>

    <p><code>requestUpdate()</code> is batched via <code>queueMicrotask</code>. Calling it multiple times in the same synchronous block results in a single render pass.</p>

    <h3>When Controllers Use requestUpdate()</h3>
    <p>Reactive controllers call <code>this.host.requestUpdate()</code> to notify the host component that controller state has changed and the template should be re-evaluated. This is how controllers trigger re-renders without owning state:</p>

    <pre>class TimerController {
  constructor(host, interval) {
    this.host = host;
    this.value = 0;
    this._interval = interval;
    host.addController(this);
  }

  hostConnected() {
    this._id = setInterval(() =&gt; {
      this.value++;
      this.host.requestUpdate();  // trigger host re-render
    }, this._interval);
  }

  hostDisconnected() {
    clearInterval(this._id);
  }
}</pre>

    <h2>The connectedCallback / disconnectedCallback Lifecycle</h2>
    <p>In addition to the update cycle hooks, components have the standard custom element lifecycle callbacks:</p>

    <ul>
      <li><strong>connectedCallback()</strong> — Called when the element is inserted into the DOM. webjs uses this to attach the shadow root, adopt styles, and perform the first render. <strong>Always call <code>super.connectedCallback()</code></strong> — without it the component will never render.</li>
      <li><strong>disconnectedCallback()</strong> — Called when the element is removed from the DOM. Clean up event listeners, timers, WebSocket connections, and other resources here.</li>
      <li><strong>attributeChangedCallback(name, oldVal, newVal)</strong> — Called when an observed attribute changes. webjs handles coercion and re-render scheduling automatically. Override only for side effects on specific attribute changes.</li>
    </ul>

    <h2>Lifecycle Summary</h2>
    <ul>
      <li><strong>Most components</strong> only need <code>render()</code>.</li>
      <li><strong>Add <code>firstUpdated</code></strong> for one-time DOM work: canvas init, focus, measure, third-party lib setup.</li>
      <li><strong>Add <code>updated</code></strong> for post-render side effects: scroll sync, analytics, external system notification.</li>
      <li><strong>Add <code>willUpdate</code></strong> for derived/computed data that <code>render()</code> consumes.</li>
      <li><strong>Add <code>shouldUpdate</code></strong> only as a performance optimization when you have measured a bottleneck.</li>
      <li><strong><code>requestUpdate()</code></strong> is for manual re-render triggers — used by controllers and when mutating non-state properties.</li>
    </ul>
  `;
}
