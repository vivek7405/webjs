import { html } from '@webjsdev/core';

export const metadata = {
  title: 'Data Fetching | WebJs',
  description: 'When to reach for async render(), webjs-suspense streaming, Task and signals, or webjs-frame. The decision guide and anti-patterns.',
};

export default function DataFetching() {
  return html`
    <h1>Data Fetching</h1>
    <p>WebJs gives a component four ways to get data into the page. This is the canonical guide to which one to reach for, and the anti-patterns to avoid. The headline is <strong>bare-await async render</strong>: a component fetches its own server data into the first paint, co-located, with no page orchestration.</p>

    <h2>The default: async render()</h2>
    <p>Make a component's <code>render()</code> async and call a <code>'use server'</code> action directly. Writing <code>await</code> makes the function async; WebJs awaits a promise-returning <code>render()</code> automatically on both the server and the client. There is no flag.</p>
    <code-block>// (a) blocking async render: real data in the first paint, the common case
class UserProfile extends WebComponent({ uid: String }) {
  async render() {
    const u = await getUser(this.uid);   // real fn at SSR, RPC stub on the client
    return html\`&lt;h3&gt;${'${u.name}'}&lt;/h3&gt;\`;
  }
}
UserProfile.register('user-profile');</code-block>
    <p>SSR awaits the render, so the resolved DATA is in the first paint with no fallback. A JS-off client reads it (a progressive-enhancement UPGRADE over a client-fetched <code>Task</code>, which shows nothing without JS). <code>getUser</code> is isomorphic: the real function during SSR, an RPC stub on the client.</p>

    <h2>The three concerns are decoupled (do not conflate them)</h2>
    <ol>
      <li><strong>SSR always blocks by default.</strong> The data is in the first paint, no fallback markup. This is the PE-safe baseline.</li>
      <li><strong>The client re-fetch default is stale-while-revalidate.</strong> A prop / dependency change re-runs <code>async render()</code>; the current content stays until the new render resolves (no blank, no flash).</li>
      <li><strong><code>renderFallback()</code> is the optional re-fetch loading UI.</strong> Shown ONLY during a client re-fetch, NEVER on the first paint, and it does NOT trigger SSR streaming.</li>
    </ol>

    <h2>Streaming a slow region with webjs-suspense</h2>
    <p>A bare <code>async render()</code> blocks the first byte. For a SLOW region where that wait hurts, wrap it in <code>&lt;webjs-suspense&gt;</code> to stream it. This is the ONLY way to show a first-paint fallback.</p>
    <code-block>// (b) webjs-suspense-wrapped slow component that streams (first-paint fallback)
html\`
  &lt;webjs-suspense .fallback=${'${html`<p>Loading section…</p>`}'}&gt;
    &lt;user-profile uid="42"&gt;&lt;/user-profile&gt;
    &lt;user-activity uid="42"&gt;&lt;/user-activity&gt;
  &lt;/webjs-suspense&gt;
\`;</code-block>
    <p>The fallback flushes on the first byte; the resolved content streams in. Multiple boundaries fetch concurrently (no server waterfall). One boundary groups several components under one fallback, and the boundary <code>.fallback</code> wins over a contained component's <code>renderFallback()</code>. On a client-router navigation the boundary streams progressively too (the shell with the fallback applies immediately, then the data streams in). A throwing component inside a boundary is isolated to its own error state while siblings stream.</p>

    <h2>The re-fetch loading state: renderFallback()</h2>
    <code-block>// (c) renderFallback() as the client re-fetch loading state (re-fetch on a prop change)
class UserActivity extends WebComponent({ uid: String }) {
  renderFallback() { return html\`&lt;div class="skeleton h-24"&gt;&lt;/div&gt;\`; }
  async render() {
    const items = await getActivity(this.uid);
    return html\`&lt;ul&gt;${'${items.map((i) => html`<li>${i.label}</li>`)}'}&lt;/ul&gt;\`;
  }
}</code-block>
    <p>Define <code>renderFallback()</code> only when stale content during a re-fetch would mislead. It is a prop-aware method (not a static field), so it can branch on the component's current state. <code>Task</code> cannot cover this case: a <code>Task</code> renders its pending state at SSR, losing the first-paint data, and you cannot wrap a signal around your own <code>await</code> inside <code>render()</code>.</p>

    <h2>Errors are isolated by default</h2>
    <code-block>// (d) the no-op error case: isolation works WITHOUT renderError()
class Report extends WebComponent {
  async render() { return html\`&lt;pre&gt;${'${await getReport()}'}&lt;/pre&gt;\`; }
  // no renderError() needed: a thrown await is isolated to THIS component,
  // siblings render, the page does not blank. Add renderError() only to
  // customize the error UI.
}</code-block>
    <p>A thrown <code>await getData()</code> (or any render throw) renders a component-scoped error state while siblings render, never bubbling to the route <code>error.ts</code>. The default surfaces the tag and message in dev and renders a silent empty element in prod (no leak). This is a per-route-error-boundary experience at the component level, with no per-component routes.</p>

    <h2>A bare async leaf ships zero JS (elision)</h2>
    <p>A <strong>bare</strong> <code>async render()</code> with no other client signal (no <code>@event</code>, no non-<code>state</code> reactive prop, no signal, no lifecycle hook, no <code>&lt;slot&gt;</code>, light DOM) produces its complete output at SSR, so the framework ELIDES its module from the browser. That drops the JS download AND the redundant on-hydration re-fetch. A content or docs leaf that fetches and displays is the common shape. The first paint is byte-identical with or without the module. Only the stale-while-revalidate refresh-on-load goes away, which is moot for request-stable data (the usual case).</p>
    <p>Two cases always ship, even bare. <code>static shadow = true</code> ships because Declarative Shadow DOM attaches only during HTML parsing, so a streamed or soft-navigated shadow component needs its module to re-run <code>attachShadow</code>. <code>static interactive = true</code> is the explicit author override that forces the module to ship even when it would be elided, for interactivity static analysis cannot see (a dynamically-computed tag string, or a <code>:defined</code> rule in an external stylesheet). Any independent signal (an <code>@event</code>, a non-<code>state</code> prop, a signal, <code>renderFallback()</code>, an interactive child it imports) ships the module as usual.</p>

    <h2>A shipping async component does not re-fetch on hydration (seeding)</h2>
    <p>When an async component DOES ship (it has an interactivity signal, so it cannot be elided), WebJs still avoids the redundant hydration fetch. Each <code>'use server'</code> action result invoked during the SSR render is serialized into the page, and the generated RPC stub reads that seed on its first client call. So <code>const u = await getUser(this.id)</code> runs once, on the server, and the client's first render reuses the result with <strong>no network round-trip</strong>. A later refetch (a prop or signal change, a new argument) misses the seed and goes to the server as normal.</p>
    <p><strong>What a hit guarantees.</strong> A seed hit returns the value the SSR render that produced this page computed for exactly this action, function, and argument list, so a hit cannot show the user something different from the HTML they are already looking at. Navigating to another page evicts whatever the previous one left unconsumed, so a departed render's value is never served. On an HTML-cached page (<code>export const revalidate</code>) the seed rides inside the cached bytes, so it is exactly as fresh as the HTML it came with. A miss simply re-fetches. There is one shape where a hit can differ from the paint, and WebJs warns about it in development: an action that returns a DIFFERENT result for the SAME arguments twice in one render, where the seed carries the last result while the first component painted the first one. Keep an action deterministic for a given argument list.</p>
    <p>It is automatic and needs no code: the same <code>async render()</code> you already wrote. There is no source transform and no build step (the capture is a transparent server-side facade over the action module), so what you write is what you see in the browser source tab. It is on by default; disable it with <code>"webjs": { "seed": false }</code> in <code>package.json</code> or <code>WEBJS_SEED=0</code>, in which case the client re-fetches on hydration (the stale-while-revalidate default hides the flicker). Seeding also needs a fully buffered render: a page carrying a <code>Suspense</code> or <code>&lt;webjs-suspense&gt;</code> boundary emits no seed block at all, so every action on that page calls out on hydration, not just the streamed region.</p>
    <p><strong>Telling whether it is working.</strong> A miss looks exactly like a hit from the outside, so development surfaces it two ways. Every dev page response carries an <code>X-Webjs-Seed</code> header (<code>collected=&lt;m&gt;, emitted=&lt;n&gt;</code> on a normal render, plus <code>off</code>, <code>html-cache</code>, and <code>... streamed</code> variants), folded into the access log as a <code>seed</code> field. And the browser logs one warning per page view when a hydration call missed AND the cause is provable: the page streams, the serializer dropped the block, or the page seeded that same action under different arguments (usually one computed from browser-only state). It stays silent otherwise, including on a page that emitted no seeds, because every action call routes through the same lookup, mutations and client-only reads included, so a miss there is not evidence of a defect; the header's <code>collected=0</code> states that case instead. Nothing of this reaches production. See <a href="/docs/configuration">Configuration</a>.</p>

    <h2>HTTP-verb actions: cacheable reads and tag invalidation</h2>
    <p>An action declares its HTTP semantics through reserved sibling exports, the same way a page declares <code>export const revalidate</code>. The function stays a plain <code>export async function</code> (one per file); a <code>method</code> export picks the verb, and a GET can be cached.</p>
    <code-block>// modules/users/queries/get-user.server.ts
'use server';
export const method = 'GET';                  // 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; absent =&gt; POST
export const cache = 60;                       // seconds, or { maxAge, swr, public }; default private
export const tags = (id) =&gt; ['user:' + id];
export async function getUser(id) { return db.user.find(id); }</code-block>
    <code-block>// modules/users/actions/update-user.server.ts
'use server';
export const invalidates = (id) =&gt; ['user:' + id];
export async function updateUser(id, data) { /* ... */ }</code-block>
    <p>The call site never changes (<code>await getUser(7)</code>). A <strong>GET</strong> rides its args in the URL, is CSRF-exempt, and carries an ETag; add a <code>cache</code> export and it is also served with <code>Cache-Control</code>, so a repeat read within the window comes from the browser cache and a stale one revalidates with a 304. Without <code>cache</code> a GET is <code>no-store</code>, since the verb marks the read as safe and <code>cache</code> is what makes it cacheable. A <strong>mutation</strong> sends a body, is CSRF-protected, and on completion its <code>invalidates</code> tags evict the matching server cache and tell the client to refetch the affected reads. A wrong request method is a <code>405</code>. It is additive: an action with no <code>method</code> stays a POST, exactly as before. The cache defaults to <code>private</code>; <code>{ public: true }</code> shares the response across users keyed only by URL, so use it only for data identical for every visitor, never a per-user read. In the object form <code>maxAge</code> is the freshness window in seconds and <code>swr</code> adds a stale-while-revalidate grace window (also seconds), during which an expired response is still served instantly while the browser refreshes it in the background. The full header reference lives on the <a href="/docs/server-actions">server actions</a> page.</p>
    <p>A public REST endpoint is a <code>route.ts</code> that imports and calls the action; <code>validate</code> is a boundary concern (the RPC endpoint and the route handler), not a direct server-to-server call.</p>
    <p>Cancellation is automatic: a superseded <code>async render()</code> (a newer prop or signal change while a fetch is in flight) aborts the previous render's in-flight action fetch, and on the server an action can read the request's <code>AbortSignal</code> via <code>actionSignal()</code> to stop expensive work when the client disconnects.</p>
    <p>An action can declare <code>export const middleware = [mw1, mw2]</code> (each <code>async (ctx, next) =&gt; result</code>): the chain runs around the action on the RPC and REST boundaries, short-circuits (an auth middleware returning an <code>ActionResult</code> instead of calling <code>next()</code>), and accumulates context the action reads via <code>actionContext()</code>.</p>

    <h2>Streaming results: return a stream or async generator</h2>
    <p>When an action <em>returns</em> a <code>ReadableStream</code>, an async iterable, or an async generator, the framework streams each chunk over the single RPC response instead of buffering the whole thing. The call site gets back an async iterable to <code>for await</code>, and each chunk arrives as it is produced. This is for token streams (an LLM response), progress events, or a large result set you want to render incrementally.</p>
    <code-block>// modules/ai/actions/stream-answer.server.ts
'use server';
export async function* streamAnswer(prompt) {
  for await (const token of llm.complete(prompt)) yield token;
}</code-block>
    <code-block>// in a component
for await (const token of await streamAnswer(q)) {
  this.text.set(this.text.get() + token);   // renders incrementally
}</code-block>
    <p>Detection is purely on the return value, so any verb can stream and there is no config export to set. Each chunk round-trips through the serializer (a <code>Date</code> / <code>Map</code> / <code>BigInt</code> inside a chunk survives). Back-pressure is respected, and the stream cancels when the client disconnects or the render is superseded (the same <code>AbortSignal</code> wiring as above), so a server generator stops producing. A streamed result is never cached or seeded; a mid-stream error surfaces as a throw from the iterable (wrap the <code>for await</code> in <code>try/catch</code>). For a slow region you want behind a fallback on the FIRST paint, reach for <code>&lt;webjs-suspense&gt;</code> instead; streaming RPC is for an imperative stream a component consumes after an interaction.</p>

    <h2>Decision rules</h2>
    <ol>
      <li><strong>Server data knowable at request time.</strong> Fetch it IN the component with <code>async render()</code>. Co-located, no prop-drilling, data in the first paint. The default, simplest case.</li>
      <li><strong>Slow server data</strong> where blocking the first byte hurts. Wrap in <code>&lt;webjs-suspense&gt;</code> to stream it. Deliberately, for slow regions, not by default.</li>
      <li><strong>Client re-fetch where stale content would mislead.</strong> Add <code>renderFallback()</code> for a loading state during the re-fetch.</li>
      <li><strong>One fallback for a whole section</strong>, or a context-specific fallback. Use <code>&lt;webjs-suspense&gt;</code> around several components (override plus grouping).</li>
      <li><strong>Genuinely client-only data</strong> (depends on a click, viewport, localStorage, or live updates, not needed in the first paint). Use <code>Task</code> / signals plus an RPC action.</li>
      <li><strong>Errors.</strong> Do nothing by default. The framework isolates a failed async component automatically. Add <code>renderError()</code> ONLY to customize the error UI.</li>
      <li><strong>A pure fetch-and-display leaf.</strong> A bare <code>async render()</code> with no other signal is ELIDED automatically (no module download, no on-hydration re-fetch), and its first paint is unchanged. Add <code>static interactive = true</code> only to force a component the analyser would elide to ship, and <code>static shadow = true</code> always ships.</li>
    </ol>

    <h2>Deferred or self-refreshing regions: webjs-frame with webjs-suspense</h2>
    <p>Everything above puts data in the FIRST response (blocking or streamed). Some regions instead need to load or refresh <strong>independently of a full-page navigation</strong>, which is the one thing a page or layout cannot do, because a page/layout re-renders only at the route level (the whole route, on navigation). The unit for an independent region is <code>&lt;webjs-frame&gt;</code>, a server-rendered, URL-addressable sub-region that loads and reloads on its own and ships <strong>zero component JS</strong> (its content is server HTML, swapped in by the framework). It is the WebJs answer to a leaf that behaves like an RSC server component, re-rendering through a server round-trip rather than shipping a module.</p>
    <p><strong>webjs-frame is webjs's take on Turbo Frames</strong> (from Hotwire Turbo), so the mental model and most muscle memory transfer directly. A frame is a lazy, URL-addressable region; a link or form targeting it swaps only that region; <code>loading="lazy"</code> defers it to viewport entry. If you know <code>&lt;turbo-frame&gt;</code>, you already know <code>&lt;webjs-frame&gt;</code>.</p>
    <p>Reach for a frame, not a page/layout, when the region:</p>
    <ol>
      <li><strong>Refreshes on its own</strong> (a dashboard widget, a "load more", a filtered list) without reloading the page. Drive it with a <code>data-webjs-frame="&lt;id&gt;"</code> link or form, or by changing its <code>src</code>; the server re-renders just that route and the frame swaps the result in. No component module ships.</li>
      <li><strong>Is below the fold or expensive and should NOT hold the first response open.</strong> Use <code>&lt;webjs-frame id src loading="lazy"&gt;</code>, so the first response ships fast and small and the frame self-loads its URL on viewport entry (a second request). This is the deliberately-deferred case, distinct from streaming.</li>
      <li><strong>Is URL-addressable</strong> (a tab panel, a detail pane) that maps to a route.</li>
    </ol>
    <p><strong>Combining the two.</strong> A frame defers a region to a SECOND request; <code>&lt;webjs-suspense&gt;</code> streams slow data WITHIN a response. They compose: a frame whose route is itself slow can wrap that data in <code>&lt;webjs-suspense&gt;</code>, so the frame defers the load (lazy, on viewport) and the slow data then streams in behind a fallback inside the frame. A comments section that is both below the fold AND slow is the canonical case.</p>
    <code-block>// app/post/[id]/page.ts, defer the comments to a lazy frame
html\`
  &lt;article&gt;...the post (in the first paint)...&lt;/article&gt;
  &lt;webjs-frame id="comments" src=${'${`/post/${id}/comments`}'} loading="lazy"&gt;&lt;/webjs-frame&gt;
\`;

// app/post/[id]/comments/page.ts, the frame's route streams its slow data
html\`
  &lt;webjs-frame id="comments"&gt;
    &lt;webjs-suspense .fallback=${'${html`<p>Loading comments…</p>`}'}&gt;
      &lt;comment-list post-id=${'${id}'}&gt;&lt;/comment-list&gt;
    &lt;/webjs-suspense&gt;
  &lt;/webjs-frame&gt;
\`;</code-block>
    <p>The right way: point the frame's <code>src</code> / <code>data-webjs-frame</code> at a <code>route.ts</code> or page that renders the region server-side; wrap genuinely-slow data inside it in <code>&lt;webjs-suspense&gt;</code>; use <code>loading="lazy"</code> for below-the-fold; and keep PE-critical content in the first paint (a frame <code>src</code> is JS-dependent, so a no-JS client sees only what was rendered into the frame). One caveat: when a framed route streams, the frame's byte-saving subtree extraction is skipped (the full page renders server-side and the client slices out the region), so you trade some wire bytes for the streaming.</p>
    <h2>Surgical single-element updates and live channels: webjs-stream</h2>
    <p>A frame or a region swap redraws a whole region. That is too coarse for "append ONE comment", "remove ONE row", "bump a count", or "insert a toast". For those, <code>&lt;webjs-stream&gt;</code> applies a per-element update declared as plain HTML: a <code>&lt;webjs-stream action target&gt;</code> wrapping a single <code>&lt;template&gt;</code>, where <code>action</code> is one of <code>append</code> / <code>prepend</code> / <code>before</code> / <code>after</code> / <code>replace</code> / <code>update</code> / <code>remove</code> and <code>target</code> is an element id. The element self-applies on connect and removes itself, so it needs no per-app DOM code.</p>
    <p><strong>webjs-stream is webjs's take on Turbo Streams</strong> (from Hotwire Turbo); the action set mirrors <code>&lt;turbo-stream&gt;</code>, so that muscle memory transfers directly. The same applier serves two delivery paths: a content-negotiated <code>&lt;form&gt;</code> response (the client router asks for the stream MIME only on a JS-driven submit, so a JS-off form still gets a normal render), and a <strong>live channel</strong>, where <code>renderStream(message)</code> in a <code>connectWS</code> handler applies a <code>broadcast()</code>ed payload. So chat, notifications, and presence reuse the same grammar.</p>
    <code-block>// server: append one comment, fan it out to other viewers, degrade for no-JS
import { stream, streamResponse, acceptsStream, broadcast } from '@webjsdev/server';
import { escapeText } from '@webjsdev/core';
export async function POST(req, { params }) {
  const c = await addComment(params.id, await req.formData());
  const html = stream.append('comments', '&lt;li&gt;' + escapeText(c.text) + '&lt;/li&gt;');
  broadcast('post:' + params.id, html);
  return acceptsStream(req) ? streamResponse(html) : Response.redirect(new URL('/post/' + params.id, req.url), 303);
}</code-block>
    <p>Reach for <code>&lt;webjs-stream&gt;</code> when the change is a single element inside an otherwise-unchanged region, or when a live channel pushes incremental updates. Use a region swap or a <code>&lt;webjs-frame&gt;</code> reload when a whole region changes; those are not the tool for one row.</p>

    <h2>Which primitive when (the decision boundary)</h2>
    <ul>
      <li><strong>async render</strong>: co-located server data in the FIRST paint (the default).</li>
      <li><strong>webjs-suspense</strong>: slow data that should still be in the first response, streamed behind a fallback.</li>
      <li><strong>webjs-frame</strong>: a region that loads / refreshes INDEPENDENTLY of a full navigation (self-refresh, lazy below-the-fold, URL-addressable), server-rendered, zero component JS. Turbo Frames.</li>
      <li><strong>webjs-stream</strong>: a SURGICAL single-element update (append / remove / replace one node) or a live-channel push. Turbo Streams.</li>
    </ul>

    <h2>Anti-patterns</h2>
    <ul>
      <li>Do NOT prop-drill server data through layers when the leaf component can fetch it itself.</li>
      <li>Do NOT put <code>await getData()</code> in a page / layout function if it can live in a component: page / layout fetches run SEQUENTIALLY (a route-level waterfall), while component fetches run in PARALLEL via boundaries.</li>
      <li>Do NOT fetch in <code>connectedCallback</code> / <code>Task</code> for data that is knowable server-side (that yields a fallback-then-RPC, not first-paint data).</li>
      <li>Do NOT use a <code>&lt;webjs-frame src&gt;</code> for primary component data. It is a client second request (a waterfall), not first paint. Frames are for URL-addressable / deferred regions only.</li>
      <li>Do NOT expect <code>renderFallback()</code> to affect the first paint or trigger SSR streaming. It is the CLIENT re-fetch loading state. To show a first-paint fallback, wrap in <code>&lt;webjs-suspense&gt;</code>.</li>
      <li>Do NOT add <code>renderError()</code> on every component. Isolation is automatic.</li>
      <li>Do NOT wrap in <code>&lt;webjs-suspense&gt;</code> when a component <code>renderFallback()</code> already suffices (one layered model).</li>
      <li>Do NOT bolt on a needless signal (or <code>static interactive = true</code>) to "force" a bare async leaf to ship. It is correctly elided and progressive-enhancement-safe already. Reach for the override only when the analyser genuinely cannot see a component's interactivity.</li>
    </ul>

    <p>See <a href="/docs/suspense">Streaming &amp; Suspense</a>, <a href="/docs/components">Components</a>, <a href="/docs/lifecycle">Lifecycle Hooks</a>, and <a href="/docs/error-handling">Error Handling</a>.</p>
  `;
}
