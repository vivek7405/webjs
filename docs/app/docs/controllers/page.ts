import { html } from '@webjskit/core';

export const metadata = { title: 'Reactive Controllers — webjs' };

export default function Controllers() {
  return html`
    <h1>Reactive Controllers</h1>
    <p>Reactive controllers are a composition pattern for sharing lifecycle-bound logic across components without using inheritance. Instead of building mixin chains or base class hierarchies, you create standalone controller objects that hook into any component's lifecycle.</p>

    <h2>What Controllers Solve</h2>
    <p>Consider a scenario where three different components all need to fetch data on connect, poll on an interval, and clean up on disconnect. Without controllers, your options are:</p>

    <ul>
      <li><strong>Inheritance</strong> — Create a <code>FetchableComponent</code> base class. But what if a component needs both fetching and resize observation? Multiple inheritance is not possible, and deep class chains are fragile.</li>
      <li><strong>Mixins</strong> — Works but gets messy with multiple mixins fighting over the same lifecycle methods and naming collisions.</li>
      <li><strong>Copy-paste</strong> — Duplicated logic across components, violating DRY.</li>
    </ul>

    <p>Controllers solve this cleanly: each controller is an independent object that registers itself with a host component via <code>addController()</code>. The component automatically calls the controller's lifecycle methods at the right time. Multiple controllers coexist on the same component without conflict.</p>

    <h2>The Controller Protocol</h2>
    <p>A controller is any object that implements some or all of these methods:</p>

    <ul>
      <li><strong>onMount()</strong> — Called when the host component's <code>connectedCallback</code> fires. Set up subscriptions, timers, and event listeners here.</li>
      <li><strong>onUnmount()</strong> — Called when the host component's <code>disconnectedCallback</code> fires. Clean up resources.</li>
      <li><strong>beforeRender()</strong> — Called before the host's <code>render()</code> method. Pre-render controller logic.</li>
      <li><strong>afterRender()</strong> — Called after the host's <code>render()</code> method, before <code>firstUpdated()</code>. Post-render controller logic.</li>
    </ul>

    <p>All methods are optional. Implement only the ones your controller needs.</p>

    <h2>Creating a Custom Controller</h2>
    <p>Here is a minimal controller that tracks the host element's visibility via IntersectionObserver:</p>

    <pre>class VisibilityController {
  constructor(host, options = {}) {
    this.host = host;
    this.isVisible = false;
    this._options = options;
    this._observer = null;
    host.addController(this);  // register with the host
  }

  onMount() {
    this._observer = new IntersectionObserver(
      ([entry]) =&gt; {
        this.isVisible = entry.isIntersecting;
        this.host.requestUpdate();  // tell the host to re-render
      },
      { threshold: this._options.threshold ?? 0 },
    );
    this._observer.observe(this.host);
  }

  onUnmount() {
    this._observer?.disconnect();
    this._observer = null;
  }
}</pre>

    <p>Usage in any component:</p>

    <pre>import { WebComponent, html, css } from '@webjskit/core';

class LazyImage extends WebComponent {
  static properties = { src: { type: String } };

  #visibility = new VisibilityController(this, { threshold: 0.1 });

  src = '';

  render() {
    return html\`
      \${this.#visibility.isVisible
        ? html\`&lt;img src=\${this.src} alt="" /&gt;\`
        : html\`&lt;div class="placeholder"&gt;Loading...&lt;/div&gt;\`}
    \`;
  }
}
LazyImage.register('lazy-image');</pre>

    <h2>Example: FetchController</h2>
    <p>A reusable controller that fetches data from a URL and exposes loading/error/data states:</p>

    <pre>class FetchController {
  constructor(host, url) {
    this.host = host;
    this.url = url;
    this.data = null;
    this.error = null;
    this.loading = false;
    host.addController(this);
  }

  async onMount() {
    this.loading = true;
    this.host.requestUpdate();

    try {
      const res = await fetch(this.url);
      if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
      this.data = await res.json();
      this.error = null;
    } catch (e) {
      this.error = e;
      this.data = null;
    } finally {
      this.loading = false;
      this.host.requestUpdate();
    }
  }

  onUnmount() {
    // Could abort an in-flight request here if using AbortController
  }
}</pre>

    <p>Any component can now fetch data by creating a <code>FetchController</code> instance:</p>

    <pre>import { WebComponent, html } from '@webjskit/core';

class UserList extends WebComponent {

  #users = new FetchController(this, '/api/users');

  render() {
    if (this.#users.loading) return html\`&lt;p&gt;Loading...&lt;/p&gt;\`;
    if (this.#users.error) return html\`&lt;p&gt;Error: \${this.#users.error.message}&lt;/p&gt;\`;

    return html\`
      &lt;ul&gt;
        \${this.#users.data?.map(u =&gt; html\`&lt;li&gt;\${u.name}&lt;/li&gt;\`)}
      &lt;/ul&gt;
    \`;
  }
}
UserList.register('user-list');</pre>

    <h2>Multiple Controllers on One Component</h2>
    <p>Controllers compose naturally. A single component can use any number of controllers:</p>

    <pre>class DashboardWidget extends WebComponent {

  #data = new FetchController(this, '/api/dashboard/stats');
  #visibility = new VisibilityController(this, { threshold: 0.5 });
  #timer = new IntervalController(this, 30000, () =&gt; this.refresh());

  refresh() {
    // Re-fetch data
  }

  render() {
    if (!this.#visibility.isVisible) return html\`&lt;div class="offscreen"&gt;&lt;/div&gt;\`;
    if (this.#data.loading) return html\`&lt;p&gt;Loading...&lt;/p&gt;\`;
    return html\`&lt;div&gt;\${this.#data.data?.summary}&lt;/div&gt;\`;
  }
}
DashboardWidget.register('dashboard-widget');</pre>

    <h2>Built-in Controllers</h2>
    <p>webjs ships three controllers out of the box:</p>

    <h3>Task</h3>
    <p>Manages async operations with automatic loading/error states, abort support, and reactive args. Imported from <code>webjs/task</code>. See the <a href="/docs/task">Task Controller</a> page for full documentation.</p>

    <pre>import { Task } from '@webjskit/core/task';

class UserProfile extends WebComponent {
  static properties = { userId: { type: String } };

  #task = new Task(this, {
    task: async ([id], { signal }) =&gt; {
      const res = await fetch(\`/api/users/\${id}\`, { signal });
      return res.json();
    },
    args: () =&gt; [this.userId],
  });

  render() {
    return this.#task.render({
      pending: () =&gt; html\`&lt;p&gt;Loading...&lt;/p&gt;\`,
      complete: (user) =&gt; html\`&lt;h1&gt;\${user.name}&lt;/h1&gt;\`,
      error: (e) =&gt; html\`&lt;p&gt;Error: \${e.message}&lt;/p&gt;\`,
    });
  }
}</pre>

    <h3>ContextProvider</h3>
    <p>Provides a value to all descendant components via the context protocol. Imported from <code>webjs/context</code>. See the <a href="/docs/context">Context Protocol</a> page for full documentation.</p>

    <pre>import { createContext, ContextProvider } from '@webjskit/core/context';

const themeContext = createContext('theme');

class AppShell extends WebComponent {

  #themeProvider = new ContextProvider(this, {
    context: themeContext,
    initialValue: 'light',
  });

  toggleTheme() {
    const next = this.#themeProvider.value === 'light' ? 'dark' : 'light';
    this.#themeProvider.setValue(next);
  }
}</pre>

    <h3>ContextConsumer</h3>
    <p>Consumes a value from an ancestor provider. Imported from <code>webjs/context</code>.</p>

    <pre>import { createContext, ContextConsumer } from '@webjskit/core/context';

const themeContext = createContext('theme');

class ThemeBadge extends WebComponent {

  #theme = new ContextConsumer(this, {
    context: themeContext,
    subscribe: true,  // re-render when the value changes
  });

  render() {
    return html\`&lt;span&gt;Current theme: \${this.#theme.value}&lt;/span&gt;\`;
  }
}</pre>

    <h2>When to Use Controllers</h2>
    <ul>
      <li><strong>Reusable lifecycle logic</strong> — fetch, timer, subscription, resize observer, intersection observer, media query, keyboard shortcuts.</li>
      <li><strong>Cross-cutting concerns</strong> — logging, analytics, performance monitoring that multiple components need.</li>
      <li><strong>Avoiding deep inheritance</strong> — when a component needs behavior from multiple sources, controllers compose where inheritance cannot.</li>
    </ul>

    <h2>When NOT to Use Controllers</h2>
    <ul>
      <li><strong>Simple one-off logic</strong> — if only one component needs the behavior, put it directly in the component. Don't over-abstract.</li>
      <li><strong>Shared rendering</strong> — controllers don't produce templates. For reusable UI, create a component. Controllers are for reusable <em>behavior</em>.</li>
      <li><strong>Page-level data</strong> — use async page functions for server-side data loading. Controllers run on the client.</li>
    </ul>

    <h2>Next Steps</h2>
    <ul>
      <li><a href="/docs/context">Context Protocol</a> — cross-component data sharing without prop drilling</li>
      <li><a href="/docs/task">Task Controller</a> — async data fetching with loading/error states</li>
      <li><a href="/docs/lifecycle">Lifecycle Hooks</a> — the full component update cycle</li>
    </ul>
  `;
}
