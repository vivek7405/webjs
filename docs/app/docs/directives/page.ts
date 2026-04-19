import { html } from '@webjs/core';

export const metadata = { title: 'Directives — webjs' };

export default function Directives() {
  return html`
    <h1>Directives</h1>
    <p>webjs follows a <strong>"less is more"</strong> philosophy. Only three directives are built in — each solves a problem that has <em>no native alternative</em>. Everything else uses native JavaScript and HTML patterns.</p>

    <pre>import { repeat } from '@webjs/core';            // keyed lists
import { unsafeHTML, live } from '@webjs/core/directives'; // raw HTML, input sync</pre>

    <h2>repeat(items, keyFn, templateFn)</h2>
    <p><strong>Essential.</strong> Keyed list reconciliation. Without it, re-rendering an array destroys and recreates all DOM nodes — losing focus, scroll position, and component state.</p>
    <pre>import { html, repeat } from '@webjs/core';

html\`&lt;ul&gt;
  \${repeat(
    items,
    (item) =&gt; item.id,         // stable unique key
    (item) =&gt; html\`&lt;li&gt;\${item.name}&lt;/li&gt;\`
  )}
&lt;/ul&gt;\`;</pre>
    <p><strong>When to use:</strong> Any list where items can be added, removed, or reordered and you need to preserve DOM identity (e.g., animated lists, forms with inputs, draggable items).</p>
    <p><strong>When NOT to use:</strong> Static lists or lists that always re-render fully — use plain <code>\${items.map(...)}</code> instead.</p>

    <h2>unsafeHTML(htmlString)</h2>
    <p><strong>Essential.</strong> Renders a raw HTML string without escaping. The only way to inject pre-built HTML (CMS content, markdown output) into a template.</p>
    <pre>import { unsafeHTML } from '@webjs/core/directives';

// Trusted markdown output
html\`&lt;article&gt;\${unsafeHTML(markdownToHtml(post.body))}&lt;/article&gt;\`;</pre>
    <p><strong>Security warning:</strong> NEVER use with user-supplied input. This is an XSS vector. Only use with content you control or have sanitized.</p>

    <h2>live(value)</h2>
    <p><strong>Essential.</strong> Dirty-checks against the <em>live DOM value</em> instead of the last rendered value. Solves the input desync problem where the user types between renders.</p>
    <pre>import { live } from '@webjs/core/directives';

html\`&lt;input .value=\${live(this.state.query)}
       @input=\${(e) =&gt; this.setState({ query: e.target.value })}&gt;\`;</pre>
    <p><strong>When to use:</strong> <code>.value</code>, <code>.checked</code>, or <code>.selectedIndex</code> bindings on <code>&lt;input&gt;</code>, <code>&lt;textarea&gt;</code>, <code>&lt;select&gt;</code> where the user can modify the DOM value between renders.</p>

    <h2>Native patterns (no directive needed)</h2>
    <p>For everything else, use native JavaScript. AI agents generate these patterns automatically:</p>

    <h3>Conditional CSS classes</h3>
    <pre>// Instead of classMap({active: x, error: y}):
html\`&lt;div class=\${[x &amp;&amp; 'active', y &amp;&amp; 'error'].filter(Boolean).join(' ')}&gt;\`;</pre>

    <h3>Dynamic inline styles</h3>
    <pre>// Instead of styleMap({color: c, fontSize: s}):
html\`&lt;div style=\${\`color:\${c};font-size:\${s}\`}&gt;\`;</pre>

    <h3>Optional attributes</h3>
    <pre>// Instead of ifDefined(val):
html\`&lt;img src=\${src ?? null}&gt;\`;  // null removes the attribute</pre>

    <h3>Conditional rendering</h3>
    <pre>// Instead of when(cond, a, b):
html\`\${loggedIn ? html\`&lt;p&gt;Welcome&lt;/p&gt;\` : html\`&lt;a href="/login"&gt;Sign in&lt;/a&gt;\`}\`;</pre>

    <h3>Element references</h3>
    <pre>// Instead of ref(callback):
firstUpdated() {
  this.canvas = this.query('canvas');
  this.ctx = this.canvas.getContext('2d');
}</pre>

    <h3>Memoization</h3>
    <pre>// Instead of guard(deps, fn):
willUpdate(changed) {
  if (changed.has('items')) {
    this.__expensiveResult = computeExpensive(this.state.items);
  }
}</pre>

    <h3>Async data in components</h3>
    <pre>// Instead of until(promise, fallback):
// Use the Task controller (handles loading, error, abort):
#task = new Task(this, {
  task: async ([id], { signal }) =&gt; fetch(\`/api/\${id}\`, { signal }).then(r =&gt; r.json()),
  args: () =&gt; [this.userId],
});
render() { return this.#task.render({ pending: () =&gt; html\`Loading...\`, complete: (d) =&gt; html\`\${d.name}\` }); }</pre>

    <h3>Preserve DOM (tabs/views)</h3>
    <pre>// Instead of cache(template):
// Use CSS to hide inactive views — DOM stays in memory:
html\`
  &lt;div style=\${\`display:\${tab === 'a' ? 'block' : 'none'}\`}&gt;Tab A content&lt;/div&gt;
  &lt;div style=\${\`display:\${tab === 'b' ? 'block' : 'none'}\`}&gt;Tab B content&lt;/div&gt;
\`;</pre>

    <h2>Why "less is more"</h2>
    <p>webjs is an AI-first framework. AI agents don't need syntax sugar — they generate verbose code as easily as terse code. Fewer directives means:</p>
    <ul>
      <li><strong>Fewer concepts</strong> for agents to choose between (less chance of wrong choice)</li>
      <li><strong>Smaller API surface</strong> to maintain and test</li>
      <li><strong>More portable knowledge</strong> — native patterns work in any framework</li>
      <li><strong>Fewer edge cases</strong> in the renderer</li>
    </ul>
  `;
}
