import { html } from '@webjskit/core';

export const metadata = { title: 'Task Controller — webjs' };

export default function TaskPage() {
  return html`
    <h1>Task Controller</h1>
    <p>The Task controller manages async operations inside components — data fetching, computations, or any promise-based work. It tracks loading, success, and error states automatically, cancels in-flight requests when args change, and provides a convenient <code>render()</code> helper for mapping states to templates.</p>

    <pre>import { Task, TaskStatus } from '@webjskit/core/task';</pre>

    <h2>Basic Usage</h2>
    <p>Create a Task inside a component. Pass a task function and an <code>args</code> function that returns the reactive inputs. When the args change, the task re-runs automatically.</p>

    <pre>import { WebComponent, html } from '@webjskit/core';
import { Task } from '@webjskit/core/task';

class UserProfile extends WebComponent {
  static properties = { userId: { type: String } };

  userId = '';

  #task = new Task(this, {
    task: async ([userId], { signal }) =&gt; {
      const res = await fetch(\`/api/users/\${userId}\`, { signal });
      if (!res.ok) throw new Error(\`User not found (\${res.status})\`);
      return res.json();
    },
    args: () =&gt; [this.userId],
  });

  render() {
    return this.#task.render({
      pending: () =&gt; html\`&lt;p&gt;Loading user...&lt;/p&gt;\`,
      complete: (user) =&gt; html\`
        &lt;h2&gt;\${user.name}&lt;/h2&gt;
        &lt;p&gt;\${user.email}&lt;/p&gt;
      \`,
      error: (err) =&gt; html\`&lt;p class="error"&gt;\${err.message}&lt;/p&gt;\`,
    });
  }
}
UserProfile.register('user-profile');</pre>

    <h2>Task States</h2>
    <p>A task is always in one of four states, exposed as <code>TaskStatus</code> constants:</p>

    <table>
      <thead>
        <tr><th>Status</th><th>Value</th><th>Meaning</th></tr>
      </thead>
      <tbody>
        <tr><td><code>TaskStatus.INITIAL</code></td><td>0</td><td>Task has never run yet. This is the state before the first <code>args</code> evaluation.</td></tr>
        <tr><td><code>TaskStatus.PENDING</code></td><td>1</td><td>Task is currently running. An AbortController is active.</td></tr>
        <tr><td><code>TaskStatus.COMPLETE</code></td><td>2</td><td>Task resolved successfully. The result is available at <code>task.value</code>.</td></tr>
        <tr><td><code>TaskStatus.ERROR</code></td><td>3</td><td>Task rejected. The error is available at <code>task.error</code>.</td></tr>
      </tbody>
    </table>

    <p>You can check the status directly:</p>

    <pre>render() {
  if (this.#task.status === TaskStatus.PENDING) {
    return html\`&lt;spinner-icon&gt;&lt;/spinner-icon&gt;\`;
  }
  if (this.#task.status === TaskStatus.ERROR) {
    return html\`&lt;p&gt;\${this.#task.error.message}&lt;/p&gt;\`;
  }
  if (this.#task.status === TaskStatus.COMPLETE) {
    return html\`&lt;p&gt;\${this.#task.value.name}&lt;/p&gt;\`;
  }
  return html\`&lt;p&gt;Waiting...&lt;/p&gt;\`;
}</pre>

    <h2>task.render()</h2>
    <p>The <code>render()</code> helper provides a cleaner pattern. Pass an object with callbacks for each state:</p>

    <pre>this.#task.render({
  initial: () =&gt; html\`&lt;p&gt;Enter a search term&lt;/p&gt;\`,
  pending: () =&gt; html\`&lt;p&gt;Searching...&lt;/p&gt;\`,
  complete: (data) =&gt; html\`&lt;result-list .items=\${data}&gt;&lt;/result-list&gt;\`,
  error: (err) =&gt; html\`&lt;p class="error"&gt;\${err.message}&lt;/p&gt;\`,
})</pre>

    <p>All callbacks are optional. If a callback is not provided for the current state, nothing is rendered for that state.</p>

    <h2>AbortSignal Support</h2>
    <p>Every task run receives an <code>AbortSignal</code> via the second parameter. The signal is automatically aborted when:</p>

    <ul>
      <li>The task's <code>args</code> change, triggering a new run (the previous run is cancelled).</li>
      <li>The host component is disconnected from the DOM.</li>
    </ul>

    <p>Pass the signal to <code>fetch()</code> or any other AbortSignal-aware API to cancel in-flight work:</p>

    <pre>#search = new Task(this, {
  task: async ([query], { signal }) =&gt; {
    // If the user types again before this resolves,
    // the signal aborts and this fetch is cancelled.
    const res = await fetch(\`/api/search?q=\${encodeURIComponent(query)}\`, { signal });
    return res.json();
  },
  args: () =&gt; [this.state.query],
});</pre>

    <p>This prevents race conditions where an older, slower request resolves after a newer one — a common bug in naive async patterns.</p>

    <h2>autoRun Behavior</h2>
    <p>By default, the task runs automatically whenever the <code>args</code> function returns new values (compared via shallow equality). This is the <code>autoRun: true</code> behavior.</p>

    <p>Set <code>autoRun: false</code> to control when the task runs manually:</p>

    <pre>#submit = new Task(this, {
  task: async ([formData], { signal }) =&gt; {
    const res = await fetch('/api/submit', {
      method: 'POST',
      body: JSON.stringify(formData),
      signal,
    });
    return res.json();
  },
  args: () =&gt; [this.state.formData],
  autoRun: false,  // only runs when you call .run()
});

handleSubmit(e) {
  e.preventDefault();
  this.#submit.run();  // manually trigger the task
}</pre>

    <p>Use <code>autoRun: false</code> for tasks that should only fire on explicit user action — form submissions, delete confirmations, or manual refresh buttons.</p>

    <h2>Reactive Args</h2>
    <p>The <code>args</code> function is called on every host update. When the returned array differs from the previous one (shallow comparison per element), the task re-runs. This creates a reactive chain: property change triggers host update, host update evaluates <code>args</code>, changed args trigger the task.</p>

    <pre>class SearchResults extends WebComponent {
  static properties = {
    query: { type: String },
    page:  { type: Number },
  };

  query = '';
  page = 1;

  // Re-runs whenever query OR page changes
  #results = new Task(this, {
    task: async ([q, p], { signal }) =&gt; {
      const res = await fetch(\`/api/search?q=\${q}&amp;page=\${p}\`, { signal });
      return res.json();
    },
    args: () =&gt; [this.query, this.page],
  });

  render() {
    return this.#results.render({
      pending: () =&gt; html\`&lt;p&gt;Loading...&lt;/p&gt;\`,
      complete: (data) =&gt; html\`
        &lt;ul&gt;\${data.items.map(i =&gt; html\`&lt;li&gt;\${i.title}&lt;/li&gt;\`)}&lt;/ul&gt;
        &lt;p&gt;Page \${this.page} of \${data.totalPages}&lt;/p&gt;
      \`,
      error: (e) =&gt; html\`&lt;p&gt;\${e.message}&lt;/p&gt;\`,
    });
  }
}
SearchResults.register('search-results');</pre>

    <h2>When to Use Task vs Async Page Functions</h2>

    <table>
      <thead>
        <tr><th>Scenario</th><th>Use</th></tr>
      </thead>
      <tbody>
        <tr><td>Page-level data loading (blog posts, product details)</td><td><strong>Async page function</strong> — runs on the server, included in the initial HTML.</td></tr>
        <tr><td>Search-as-you-type, autocomplete</td><td><strong>Task</strong> — client-side, reactive to user input, cancels stale requests.</td></tr>
        <tr><td>Lazy-loaded component data (expand a section, scroll into view)</td><td><strong>Task</strong> — client-side, runs on demand or on connect.</td></tr>
        <tr><td>Form submission</td><td><strong>Task with autoRun: false</strong> — fires on explicit user action.</td></tr>
        <tr><td>Data shown on first paint (SEO-relevant)</td><td><strong>Async page function</strong> — server-rendered HTML for crawlers.</td></tr>
        <tr><td>Data that changes based on client-side state (filters, tabs)</td><td><strong>Task</strong> — re-runs reactively when args change.</td></tr>
      </tbody>
    </table>

    <p>The rule of thumb: if the data should be in the initial HTML (for SEO, performance, or because it doesn't depend on client state), use an async page function. If the data depends on user interaction or client-only state, use Task.</p>

    <h2>Full Example: Search With Debounce</h2>

    <pre>import { WebComponent, html, css } from '@webjskit/core';
import { Task } from '@webjskit/core/task';

class LiveSearch extends WebComponent {

  static styles = css\`
    :host { display: block; }
    input { width: 100%; padding: 8px; font: inherit; }
    .results { margin-top: 8px; }
    .empty { color: var(--fg-muted, #888); }
  \`;

  constructor() {
    super();
    this.state = { query: '', debounced: '' };
    this._timer = null;
  }

  #results = new Task(this, {
    task: async ([q], { signal }) =&gt; {
      if (!q) return [];
      const res = await fetch(\`/api/search?q=\${encodeURIComponent(q)}\`, { signal });
      if (!res.ok) throw new Error('Search failed');
      return res.json();
    },
    args: () =&gt; [this.state.debounced],
  });

  onInput(e) {
    const query = e.target.value;
    this.setState({ query });
    clearTimeout(this._timer);
    this._timer = setTimeout(() =&gt; {
      this.setState({ debounced: query });
    }, 300);
  }

  disconnectedCallback() {
    clearTimeout(this._timer);
  }

  render() {
    return html\`
      &lt;input placeholder="Search..."
             .value=\${this.state.query}
             @input=\${(e) =&gt; this.onInput(e)} /&gt;
      &lt;div class="results"&gt;
        \${this.#results.render({
          initial: () =&gt; html\`&lt;p class="empty"&gt;Type to search&lt;/p&gt;\`,
          pending: () =&gt; html\`&lt;p&gt;Searching...&lt;/p&gt;\`,
          complete: (items) =&gt; items.length === 0
            ? html\`&lt;p class="empty"&gt;No results&lt;/p&gt;\`
            : html\`&lt;ul&gt;\${items.map(i =&gt; html\`&lt;li&gt;\${i.title}&lt;/li&gt;\`)}&lt;/ul&gt;\`,
          error: (e) =&gt; html\`&lt;p class="error"&gt;\${e.message}&lt;/p&gt;\`,
        })}
      &lt;/div&gt;
    \`;
  }
}
LiveSearch.register('live-search');</pre>

    <h2>Next Steps</h2>
    <ul>
      <li><a href="/docs/controllers">Reactive Controllers</a> — the general pattern Task is built on</li>
      <li><a href="/docs/context">Context Protocol</a> — share data across components without prop drilling</li>
      <li><a href="/docs/server-actions">Server Actions</a> — server-side data fetching and mutations</li>
    </ul>
  `;
}
