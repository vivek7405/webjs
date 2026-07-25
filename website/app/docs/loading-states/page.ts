import { html } from '@webjsdev/core';

export const metadata = { title: 'Loading States | WebJs' };

export default function LoadingStates() {
  return html`
    <h1>Loading States</h1>
    <p>WebJs uses <code>loading.ts</code> files to automatically wrap page content in a Suspense boundary. The loading UI is flushed to the browser immediately while the async page function resolves in the background.</p>

    <h2>When to use</h2>
    <ul>
      <li>Pages with slow data fetching (database queries, external API calls).</li>
      <li>Any page where you want instant visual feedback instead of a blank screen.</li>
    </ul>

    <h2>When NOT to use</h2>
    <ul>
      <li>For fast pages that render in under 100ms. The loading state would flash and disappear, which is worse UX than waiting.</li>
      <li>For client-side loading within a component. Use the <a href="/docs/task">Task controller</a> instead.</li>
    </ul>

    <h2>Basic usage</h2>
    <p>Create a <code>loading.ts</code> file next to your page. The framework automatically wraps the page in a <code>Suspense</code> boundary using your loading component as the fallback:</p>

    <pre>// app/blog/loading.ts
import { html } from '@webjsdev/core';

export default function Loading() {
  return html${'`'}
    &lt;div class="skeleton"&gt;
      &lt;div class="skeleton-title"&gt;&lt;/div&gt;
      &lt;div class="skeleton-line"&gt;&lt;/div&gt;
      &lt;div class="skeleton-line"&gt;&lt;/div&gt;
    &lt;/div&gt;
  ${'`'};
}</pre>

    <pre>// app/blog/page.ts: this is async and may be slow
import { html } from '@webjsdev/core';

export default async function BlogPage() {
  const posts = await fetchPosts();  // slow DB query
  return html${'`'}&lt;ul&gt;...${'`'};
}</pre>

    <h3>What happens</h3>
    <ol>
      <li>The server renders the loading fallback and flushes it to the browser immediately.</li>
      <li>The page function runs in the background.</li>
      <li>When the page resolves, the server streams a <code>&lt;template&gt;</code> chunk that replaces the fallback with the real content, with no client JavaScript needed for the swap.</li>
    </ol>

    <h2>Nesting</h2>
    <p><code>loading.ts</code> files apply at their directory level. You can have different loading states for different sections:</p>

    <pre>app/
  loading.ts            ← fallback for the root page
  blog/
    loading.ts          ← fallback for all /blog/* pages
    [slug]/page.ts      ← wrapped by blog/loading.ts</pre>

    <h2>Loading states on client navigation</h2>
    <p>The same <code>loading.ts</code> also feeds client-side navigation. The SSR pipeline emits each segment's loading content as a hidden <code>&lt;template id="wj-loading:&lt;segment-path&gt;"&gt;</code> at body end. When a user clicks a link, the router clones the deepest matching template into the swap slot <strong>immediately</strong>, before the fetch even completes, so the user sees the skeleton instantly instead of stale content from the previous page.</p>
    <p>If the fetch fails (network error, server crash), the optimistic loading content is reverted and the router falls back to a full page navigation. The same files serve both server-side SSR Suspense and client-side nav optimistic UI. Write one <code>loading.ts</code>, get both behaviors.</p>

    <h2>Manual Suspense</h2>
    <p>For more control, use <code>Suspense()</code> directly in your page template instead of a <code>loading.ts</code> file:</p>

    <pre>import { html, Suspense } from '@webjsdev/core';

export default function Page() {
  return html${'`'}
    &lt;h1&gt;Dashboard&lt;/h1&gt;
    ${'${Suspense({ fallback: html`<p>Loading stats…</p>`, children: loadStats() })}'}
    ${'${Suspense({ fallback: html`<p>Loading feed…</p>`, children: loadFeed() })}'}
  ${'`'};
}</pre>

    <p>Each <code>Suspense</code> boundary resolves independently, so the feed can appear before the stats if it's faster.</p>

    <h2>Component re-fetch loading: renderFallback()</h2>
    <p>The loading states above are for a PAGE or REGION (a <code>loading.ts</code> skeleton, a <code>Suspense</code> boundary, a streamed <code>&lt;webjs-suspense&gt;</code>). A component that fetches its own data with <a href="/docs/data-fetching">async render</a> has a separate concern: what to show when it RE-FETCHES on the client (a prop / dependency change re-runs <code>async render()</code>).</p>
    <p>The default is stale-while-revalidate: the component keeps its current content until the new render resolves (no blank, no flash). Define <code>renderFallback()</code> ONLY to override that with an explicit loading state DURING the re-fetch. It is shown only on a client re-fetch, <strong>never on the first paint</strong>, and it does NOT trigger SSR streaming (to stream slow data on the first paint, wrap the component in <code>&lt;webjs-suspense&gt;</code> instead).</p>
    <pre>class UserActivity extends WebComponent({ uid: String }) {
  renderFallback() { return html${'`'}&lt;div class="skeleton h-24"&gt;&lt;/div&gt;${'`'}; }   // re-fetch only
  async render() {
    const items = await getActivity(this.uid);
    return html${'`'}&lt;ul&gt;${'${items.map((i) => html`<li>${i.label}</li>`)}'}&lt;/ul&gt;${'`'};
  }
}</pre>

    <h2>Next steps</h2>
    <ul>
      <li><a href="/docs/suspense">Streaming & Suspense</a>: the underlying streaming mechanism</li>
      <li><a href="/docs/error-handling">Error Handling</a>: <code>error.ts</code> boundaries</li>
      <li><a href="/docs/task">Task (Async Data)</a>: client-side loading states within components</li>
    </ul>
  `;
}
