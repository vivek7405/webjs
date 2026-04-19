import { html } from '@webjskit/core';

export const metadata = { title: 'Lifecycle Hooks — webjs' };

export default function Lifecycle() {
  return html`
    <h1>Lifecycle Hooks</h1>
    <p>webjs follows a <strong>"less is more"</strong> philosophy for lifecycle hooks. Only hooks with no native workaround are included. AI agents don't need abstractions for things that a few lines of code can handle.</p>

    <h2>The Update Cycle</h2>
    <p>When <code>setState()</code> or a property change triggers a re-render:</p>
    <ol>
      <li>Controllers' <code>beforeRender()</code></li>
      <li><code>render()</code> + DOM commit (with error boundary)</li>
      <li>Controllers' <code>afterRender()</code></li>
      <li><code>firstUpdated()</code> — once, on the first render only</li>
    </ol>

    <h2>render()</h2>
    <p>The core of every component. Returns a <code>TemplateResult</code> via the <code>html</code> tag. Called on every state change.</p>
    <pre>render() {
  // Derived state goes here, before the template:
  const filtered = this.state.items.filter(i =&gt; i.active);
  const count = filtered.length;

  return html\`
    &lt;p&gt;\${count} active items&lt;/p&gt;
    &lt;ul&gt;\${filtered.map(i =&gt; html\`&lt;li&gt;\${i.name}&lt;/li&gt;\`)}&lt;/ul&gt;
  \`;
}</pre>
    <p>No <code>willUpdate</code> needed — compute derived state at the top of <code>render()</code>.</p>

    <h2>setState(patch)</h2>
    <p>Shallow-merges the patch into <code>this.state</code> and schedules a microtask-batched re-render. Multiple <code>setState</code> calls within the same microtask are batched into one render.</p>
    <pre>this.setState({ count: this.state.count + 1 });
this.setState({ name: 'updated' });
// Only one render happens</pre>

    <h2>firstUpdated()</h2>
    <p>Called once after the first render. The shadow DOM is populated, so you can query elements. Use for one-time setup: focus, measurements, third-party library init.</p>
    <pre>firstUpdated() {
  this.shadowRoot.querySelector('input')?.focus();
  this._chart = new Chart(this.shadowRoot.querySelector('canvas'));
}</pre>
    <p><code>connectedCallback</code> fires <em>before</em> the first render, so shadow children don't exist there yet. That's why <code>firstUpdated</code> exists.</p>

    <h2>renderError(error)</h2>
    <p>Called when <code>render()</code> throws. Return a fallback template to show instead of crashing the page.</p>
    <pre>renderError(error) {
  return html\`&lt;p style="color:red"&gt;Error: \${error.message}&lt;/p&gt;\`;
}</pre>
    <p>Without this, one broken component would crash the entire page. The default implementation renders nothing and logs to console.</p>

    <h2>What's NOT included (and why)</h2>
    <table>
      <thead><tr><th>Hook</th><th>Native workaround</th></tr></thead>
      <tbody>
        <tr><td><code>shouldUpdate</code></td><td>Return early from <code>render()</code> with an if-statement</td></tr>
        <tr><td><code>willUpdate</code></td><td>Compute at the top of <code>render()</code></td></tr>
        <tr><td><code>updated</code></td><td>Use <code>queueMicrotask()</code> after <code>setState()</code></td></tr>
        <tr><td><code>changedProperties</code></td><td>Track manually with <code>this._prev = {...this.state}</code></td></tr>
        <tr><td><code>query(sel)</code></td><td><code>this.shadowRoot.querySelector(sel)</code></td></tr>
      </tbody>
    </table>
    <p>These abstractions add API surface without solving problems that native code can't. Fewer hooks = fewer concepts for AI agents to choose between.</p>

    <h2>Native Web Component Callbacks</h2>
    <p>These are provided by <code>HTMLElement</code> itself and work as normal in webjs components:</p>
    <ul>
      <li><code>connectedCallback()</code> — element added to DOM (call <code>super.connectedCallback()</code>)</li>
      <li><code>disconnectedCallback()</code> — element removed from DOM</li>
      <li><code>attributeChangedCallback(name, old, new)</code> — observed attribute changed</li>
      <li><code>static observedAttributes</code> — declares which attributes to watch</li>
    </ul>
  `;
}
