import { html } from '@webjs/core';

export const metadata = { title: 'Error Handling — webjs' };

export default function ErrorHandling() {
  return html`
    <h1>Error Handling</h1>
    <p>webjs provides nested error boundaries via <code>error.js</code>/<code>error.ts</code> files, plus component-level error handling via <code>renderError()</code>. Errors are caught at the nearest boundary and rendered without crashing the entire page.</p>

    <h2>When to use</h2>
    <ul>
      <li>Show a user-friendly error page when a route or layout throws during rendering.</li>
      <li>Isolate failures in one section of the page from the rest (e.g. a broken sidebar shouldn't crash the whole layout).</li>
      <li>Catch errors from async page functions, server actions, or database queries.</li>
    </ul>

    <h2>When NOT to use</h2>
    <ul>
      <li>For 404 pages — use <code>not-found.ts</code> instead, or throw <code>notFound()</code> from a page function.</li>
      <li>For form validation errors — handle those in your component state, not error boundaries.</li>
    </ul>

    <h2>Route-level error boundaries</h2>
    <p>Place an <code>error.ts</code> file at any level in the <code>app/</code> directory. When a page or layout at that level (or deeper) throws, the nearest <code>error.ts</code> is rendered instead.</p>

    <pre>// app/error.ts — root error boundary
import { html } from '@webjs/core';

export default function ErrorPage({ error }: { error: Error }) {
  return html${'`'}
    &lt;h1&gt;Something went wrong&lt;/h1&gt;
    &lt;p&gt;${'${error.message}'}&lt;/p&gt;
    &lt;a href="/"&gt;Go home&lt;/a&gt;
  ${'`'};
}</pre>

    <h3>Nesting</h3>
    <p>Error boundaries are nested — the framework walks from the throwing component outward until it finds the nearest <code>error.ts</code>:</p>
    <pre>app/
  error.ts              ← catches errors from any page
  blog/
    error.ts            ← catches errors from /blog/* pages only
    [slug]/page.ts      ← if this throws, blog/error.ts handles it</pre>

    <p>If <code>blog/error.ts</code> also throws, the parent <code>app/error.ts</code> catches it.</p>

    <h2>not-found.ts</h2>
    <p>A special error boundary for 404 responses. Place <code>not-found.ts</code> at any route level — the nearest one wins:</p>

    <pre>// app/not-found.ts
import { html } from '@webjs/core';

export default function NotFound() {
  return html${'`'}
    &lt;h1&gt;Page not found&lt;/h1&gt;
    &lt;p&gt;The page you're looking for doesn't exist.&lt;/p&gt;
    &lt;a href="/"&gt;Go home&lt;/a&gt;
  ${'`'};
}</pre>

    <p>Trigger a 404 programmatically from any page function or server action:</p>

    <pre>import { notFound } from '@webjs/core';

export default async function PostPage({ params }: { params: { slug: string } }) {
  const post = await getPost(params.slug);
  if (!post) notFound();  // renders nearest not-found.ts
  return html${'`'}...&lt;/h1&gt;${'`'};
}</pre>

    <h2>Component-level error handling</h2>
    <p>Override <code>renderError(error)</code> in any <code>WebComponent</code> to catch errors from that component's <code>render()</code> method:</p>

    <pre>class MyWidget extends WebComponent {

  render() {
    // If this throws, renderError() is called instead
    return html${'`'}&lt;div&gt;${'${this.riskyComputation()}'}&lt;/div&gt;${'`'};
  }

  renderError(error: Error) {
    return html${'`'}&lt;p class="error"&gt;Widget failed: ${'${error.message}'}&lt;/p&gt;${'`'};
  }
}</pre>

    <p>If <code>renderError()</code> is not defined, the error is logged to the console and the component's shadow root shows the last successful render (or nothing on first render).</p>

    <h2>Server action errors</h2>
    <p>Errors thrown from server actions are sanitized in production: only the <code>message</code> property is sent to the client, never the stack trace. Internal errors (no message) are collapsed to "Internal server error". The full error is always logged server-side.</p>

    <h2>Next steps</h2>
    <ul>
      <li><a href="/docs/routing">Routing</a> — file conventions for pages, layouts, and error boundaries</li>
      <li><a href="/docs/loading-states">Loading States</a> — <code>loading.ts</code> for Suspense boundaries</li>
      <li><a href="/docs/server-actions">Server Actions</a> — error handling in RPC calls</li>
    </ul>
  `;
}
