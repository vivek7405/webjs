import { html } from '@webjsdev/core';

export const metadata = { title: 'Error Handling | WebJs' };

export default function ErrorHandling() {
  return html`
    <h1>Error Handling</h1>
    <p>WebJs provides nested error boundaries via <code>error.js</code>/<code>error.ts</code> files, plus component-level error handling via <code>renderError()</code>. Errors are caught at the nearest boundary and rendered without crashing the entire page.</p>

    <h2>When to use</h2>
    <ul>
      <li>Show a user-friendly error page when a route or layout throws during rendering.</li>
      <li>Isolate failures in one section of the page from the rest (e.g. a broken sidebar shouldn't crash the whole layout).</li>
      <li>Catch errors from async page functions, server actions, or database queries.</li>
    </ul>

    <h2>When NOT to use</h2>
    <ul>
      <li>For 404 pages: use <code>not-found.ts</code> instead, or throw <code>notFound()</code> from a page function.</li>
      <li>
        For form validation errors there are two valid patterns, neither of which uses error boundaries:
        <ul>
          <li><strong>JS-side</strong>: handle validation in the component's submit handler, keep errors in component state.</li>
          <li><strong>Server-rendered (Rails / Django / Laravel style)</strong>: bind a <code>'use server'</code> action into the form and return a failure <code>ActionResult</code> (<code>{ success: false, fieldErrors, values, status: 422 }</code>). The framework re-SSRs the SAME page at <code>422 Unprocessable Entity</code> with the result on <code>ctx.actionData</code>, so the page repopulates inputs from <code>actionData.values</code> and shows messages from <code>actionData.fieldErrors</code> (no hand-rolled <code>new Response(...)</code>). The client router applies that response in place regardless of status code, so the user sees the validated form without a full page reload and without losing their typed values. See the <a href="/docs/server-actions">server actions</a> docs for the form-binding pattern and the <a href="/docs/client-router">client router</a> docs for the rendering behavior.</li>
        </ul>
      </li>
    </ul>

    <h2>Route-level error boundaries</h2>
    <p>Place an <code>error.ts</code> file at any level in the <code>app/</code> directory. When a page or layout at that level (or deeper) throws, the nearest <code>error.ts</code> is rendered instead.</p>

    <code-block>// app/error.ts: root error boundary
import { html } from '@webjsdev/core';

export default function ErrorPage({ error }: { error: Error }) {
  return html${'`'}
    &lt;h1&gt;Something went wrong&lt;/h1&gt;
    &lt;p&gt;${'${error.message}'}&lt;/p&gt;
    &lt;a href="/"&gt;Go home&lt;/a&gt;
  ${'`'};
}</code-block>

    <h3>Nesting</h3>
    <p>Error boundaries are nested. The framework walks from the throwing component outward until it finds the nearest <code>error.ts</code>:</p>
    <code-block>app/
  error.ts              ← catches errors from any page
  blog/
    error.ts            ← catches errors from /blog/* pages only
    [slug]/page.ts      ← if this throws, blog/error.ts handles it</code-block>

    <p>If <code>blog/error.ts</code> also throws, the parent <code>app/error.ts</code> catches it.</p>

    <h2>not-found.ts</h2>
    <p>A special error boundary for 404 responses. Place <code>not-found.ts</code> at any route level, and the nearest one wins:</p>

    <code-block>// app/not-found.ts
import { html } from '@webjsdev/core';

export default function NotFound() {
  return html${'`'}
    &lt;h1&gt;Page not found&lt;/h1&gt;
    &lt;p&gt;The page you're looking for doesn't exist.&lt;/p&gt;
    &lt;a href="/"&gt;Go home&lt;/a&gt;
  ${'`'};
}</code-block>

    <p>Trigger a 404 programmatically from any page function or server action:</p>

    <code-block>import { notFound } from '@webjsdev/core';

export default async function PostPage({ params }: { params: { slug: string } }) {
  const post = await getPost(params.slug);
  if (!post) notFound();  // renders nearest not-found.ts
  return html${'`'}...&lt;/h1&gt;${'`'};
}</code-block>

    <h2>forbidden.ts and unauthorized.ts</h2>
    <p>Throw <code>forbidden()</code> (403) or <code>unauthorized()</code> (401) from a page/layout function or a form-bound action, the same way as <code>notFound()</code>. The nearest <code>forbidden.ts</code> / <code>unauthorized.ts</code> boundary renders (a default page when none exists). Use <code>unauthorized()</code> for a request that is not authenticated, and <code>forbidden()</code> for an authenticated user who lacks permission:</p>

    <code-block>import { forbidden, unauthorized } from '@webjsdev/core';

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) unauthorized();        // renders nearest unauthorized.ts (401)
  if (!user.isAdmin) forbidden();   // renders nearest forbidden.ts (403)
  return html${'`'}...${'`'};
}</code-block>

    <p>Inside a <code>'use server'</code> RPC action (one a client component calls), return a <code>{ success: false, error, status }</code> <code>ActionResult</code> for an auth failure rather than throwing <code>forbidden()</code> / <code>unauthorized()</code>. The boundary render is a page-routing concern, the same guidance as for <code>notFound()</code> / <code>redirect()</code>.</p>

    <h2>global-error.ts and global-not-found.ts</h2>
    <p>Two root-only boundaries (in <code>app/</code> exactly). <code>global-error.ts</code> is the app-wide catch-all, tried after the nested <code>error.ts</code> boundaries are exhausted, and it renders its OWN full document (a root-layout failure is when it fires):</p>

    <code-block>// app/global-error.ts
import { html } from '@webjsdev/core';

export default function GlobalError({ error }: { error: Error }) {
  return html${'`'}
    &lt;!doctype html&gt;
    &lt;html&gt;&lt;body&gt;&lt;h1&gt;Something went wrong&lt;/h1&gt;&lt;/body&gt;&lt;/html&gt;
  ${'`'};
}</code-block>

    <p>Keep <code>global-error.ts</code> static (no components / hydration): it is returned verbatim with no importmap or boot script, so it must not depend on the module system that may have just failed. Under an opt-in CSP, give any inline <code>&lt;script&gt;</code> the <code>cspNonce()</code>. An inline <code>&lt;style&gt;</code> needs one only if you tighten <code>style-src</code>, since the default policy allows inline style outright.</p>

    <p><code>global-not-found.ts</code> renders for a URL that matches nothing anywhere, when no <code>not-found.ts</code> applies.</p>

    <h2>Component-level error handling</h2>
    <p>Override <code>renderError(error)</code> in any <code>WebComponent</code> to catch errors from that component's <code>render()</code> method:</p>

    <code-block>class MyWidget extends WebComponent {

  render() {
    // If this throws, renderError() is called instead
    return html${'`'}&lt;div&gt;${'${this.riskyComputation()}'}&lt;/div&gt;${'`'};
  }

  renderError(error: Error) {
    return html${'`'}&lt;p class="error"&gt;Widget failed: ${'${error.message}'}&lt;/p&gt;${'`'};
  }
}</code-block>

    <p>If <code>renderError()</code> is not defined, the error is logged to the console and the component's shadow root shows the last successful render (or nothing on first render).</p>

    <h2>Per-component error isolation is automatic (async render)</h2>
    <p>For a component with an <code>async render()</code>, error isolation is a default that needs no user code. A thrown <code>await getData()</code> (or any render throw) is caught for THAT component: its siblings render normally and the failure never bubbles to the route <code>error.ts</code>. On the server the default renders a component-scoped error box in dev and a silent empty element in prod (no internal detail leaks); on the client the same boundary runs. Add <code>renderError()</code> only to customize the error UI. This delivers a per-route-error-boundary experience at the component level, without per-component routes.</p>

    <h2>A directive that throws mid-commit stays consistent</h2>
    <p>The component boundary above also covers <code>watch(signal)</code> and <code>until()</code>, which commit outside the update cycle, so a throw from either reaches <code>renderError()</code> rather than the window. It reaches the component whose <em>template</em> holds the binding, which is not always the element the binding sits inside: a <code>watch()</code> written between a child component's tags belongs to the parent that wrote it. <code>asyncAppend</code> / <code>asyncReplace</code> are covered the same way: a chunk's own commit throw, and a <code>watch()</code> or <code>until()</code> nested inside a chunk, both reach the owning component's <code>renderError()</code>. A chunk's own commit throw also stops the stream, since the boundary is about to render an error state and appending into a region it may have replaced is not a recovery; a nested directive throws from its own handler outside that loop, so it reaches the boundary without stopping the stream. Your own code is the exception: a throw from the iterable or from a <code>mapper</code> you passed alongside it is a generator failing rather than a render, so it is still logged to the console and you are expected to handle it. That ends the stream too.</p>
    <p>Beyond reporting the error, the directive's own state is left describing the DOM that actually exists, which is what makes the NEXT render correct. That matters because the failure is otherwise silent: the renders that expose it are fully valid and log nothing. The hole whose commit threw is marked so the next render re-applies it instead of skipping it as unchanged, which is what used to leave a region blank for good. Both list reconcilers additionally repair their own bookkeeping so it describes the DOM again, and the next render is an ordinary reconcile rather than a rebuild of the region, which would throw away the node identity they exist to preserve. <code>repeat()</code> re-unites its key map and repositions every row (the symptom was a permanently duplicated row). A plain <code>.map()</code> array splices back the part of its slot list the failed pass never reached, which is what a slot REPLACED rather than updated in place needs (its template shape changed, its kind changed between text, template and empty, or the array grew past its old length), since that is the branch that inserts the replacement before removing what it replaced (the symptom was a stranded row that outlived even a render of an empty array). <code>guard()</code> records its new deps only once the commit succeeds, so a later render with those deps re-renders the region instead of skipping past one the throw had blanked; <code>until()</code> advances its resolved priority only after its commit succeeds, so a failed high-priority resolution does not refuse the lower-priority one behind it.</p>
    <p>Tearing content back out is covered too, and it has to be, because a teardown has no next render to repair it. Unbinding a <code>ref</code> while a row is removed can never abort the removal of the rest of the list, and <code>repeat()</code> drops each leftover key from its map before touching that row, so the map never describes a row that has already been removed. Without that, a throw part-way through left the row you had DELETED on screen, reordered the survivors, and let a later render that re-added the key reinsert the disposed instance. The cost is that a <code>ref</code> whose object <code>value</code> setter throws is swallowed on teardown, matching the ref callback, which was already swallowed everywhere (lit guards neither and propagates from both, so this is a deliberate divergence). It applies to teardown only: on the COMMIT path a throwing object-ref setter still reaches <code>renderError()</code>. Covered also means a removal takes the row's own boundary markers with it, so a list that grows and shrinks all day is net zero on the nodes the renderer added, rather than accruing one invisible comment per removed row for the life of the region.</p>

    <h2>Server action errors</h2>
    <p>Errors thrown from server actions are sanitized in production: the client gets a generic <code>"Internal server error"</code> message plus a short <code>digest</code>, never the raw thrown message or the stack trace. The full error is logged server-side keyed by that digest, so a client-reported digest maps back to the server log line. A <code>redirect()</code> / <code>notFound()</code> control-flow throw passes through. To surface a specific user-facing message, return an <code>ActionResult</code> <code>{ success: false, error }</code> envelope instead of throwing.</p>

    <h2>Dev error overlay</h2>
    <p>In development, an SSR render crash, a non-erasable-TypeScript strip failure, and a failed rebuild each push a rich error overlay to the open tab over the live-reload channel, without a manual refresh. The overlay shows the message, the offending <code>file:line:column</code>, and a source code frame of the failing line with context. A TypeScript strip failure also shows the erasable-syntax hint inline (a non-erasable <code>enum</code> / <code>namespace</code> breaks only the client module fetch, so the page still server-renders but hydration is dead; the overlay surfaces that instead of burying the hint in a console comment). The overlay dismisses on the next successful rebuild, and the frame is replayed to a tab opened after the breaking edit.</p>
    <p>A render error's overlay is scoped to the page that produced it. It comes down when you navigate away, it never appears in a tab that is viewing a different page, and merely prefetching a link to a broken page (which happens on hover, since link prefetch is on by default) does not raise one on the page you are actually on. A rebuild or TypeScript error is not page-scoped, because it describes a broken build rather than one route, so it stays put until the next successful rebuild.</p>
    <p>This is strictly a development feature. In production the error response stays terse (only <code>message</code>, never the stack or any file path), and the overlay client is never served, so nothing about your source leaks. An embedding host can observe the same frames via the <code>onDevError</code> option on <code>createRequestHandler</code> / <code>startServer</code>.</p>

    <h2>Next steps</h2>
    <ul>
      <li><a href="/docs/routing">Routing</a>: file conventions for pages, layouts, and error boundaries</li>
      <li><a href="/docs/loading-states">Loading States</a>: <code>loading.ts</code> for Suspense boundaries</li>
      <li><a href="/docs/server-actions">Server Actions</a>: error handling in RPC calls</li>
    </ul>
  `;
}
