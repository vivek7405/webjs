import { html } from '@webjsdev/core';

export const metadata = { title: 'Client Router | WebJs' };

export default function ClientRouter() {
  return html`
    <h1>Client Router</h1>
    <p>WebJs ships a nested-layout-aware client router that intercepts same-origin <code>&lt;a&gt;</code> clicks <strong>and</strong> <code>&lt;form&gt;</code> submissions, fetches the target HTML, and swaps only the deepest layout boundary the two pages don't share. Outer layout DOM is preserved: sidenav scroll, input values, <code>&lt;details&gt;</code> open state, mounted custom elements all survive navigation without authors writing anything.</p>
    <p>The router is automatic and needs no import: it auto-enables whenever <code>@webjsdev/core</code> loads in the browser, which happens on any page that ships a component. For 99% of apps the contract is "write standard HTML, navigation gets faster." The advanced primitives below (frames, revalidation, programmatic navigation) exist for the cases where you need to take over.</p>

    <p>The one edge: a <strong>fully-static page with zero components</strong> ships no JavaScript at all, so it has no router and its links do a normal full-page navigation (correct progressive enhancement, and cheaper). This is invisible during a session, since a router started on any earlier interactive page stays active across soft navigations. It only shows on a cold direct load of such a page (a bare error or 404 screen). If you want soft navigation there too, render any component in the page or its layout, or add <code>import '@webjsdev/core/client-router'</code> to force the router on.</p>

    <p><strong>Opting out app-wide.</strong> If you want plain full-page navigation everywhere (a classic multi-page app) even though you ship interactive components, set <code>&#123; "webjs": &#123; "clientRouter": false &#125; &#125;</code> in <code>package.json</code>. Components still hydrate and stay interactive; only the link / form interception is turned off, so every navigation is a full browser load. To turn it off for just one moment at runtime, call <code>disableClientRouter()</code> (and <code>enableClientRouter()</code> to turn it back on), both from <code>@webjsdev/core</code>.</p>

    <h2>How it works (auto-magic, no opt-in)</h2>
    <ol>
      <li>SSR emits KEYED boundary comment pairs around each layout's <code>\${children}</code> interpolation and around the page itself: open <code>&lt;!--wj:children:&lt;segment&gt;:&lt;route-key&gt;--&gt;</code>, close <code>&lt;!--/wj:children:&lt;segment&gt;--&gt;</code>. The segment is the folder-derived pattern; the route-key is the resolved path for this request (dynamic params substituted, values percent-encoded). Derived from folder structure, with authors writing nothing.</li>
      <li>On a click or form submit, the router STRICTLY scans both the live DOM and the incoming HTML into segment maps (a close must match its innermost open; any truncated, mispaired, or duplicated boundary poisons the scan) and DECIDES which of two tiers to apply, with Next.js parity. Nothing is applied yet: a boundary whose route-key CHANGED will be wholesale REPLACED at the PARENT of the shallowest change (a layout's boundary wraps only its children, so anchoring at the parent remounts the changed layout's own markup too, exactly like Next re-rendering a layout with new params), while an all-keys-equal nav (a searchParams-only change) will MORPH the deepest shared boundary in place so hydrated component state survives. A poisoned scan or no shared boundary degrades to a normal full page load, never a guessed swap, so a malformed response cannot corrupt the live DOM. Because the boundaries are comments, the parse that turns a response into a document has to preserve them: <code>Document.parseHTMLUnsafe</code> strips every comment in some browser versions, so the router probes it once and parses with <code>DOMParser</code> instead when it is lossy.</li>
      <li>The URL updates via <code>pushState</code>, and this happens <strong>before the incoming content replaces what is on screen</strong>, not after. The order is deliberate: the entry for the page you are leaving is finalized while that page is still the live document, rather than against the content that replaced it. This is Turbo Drive's ordering too. (It was introduced as a fix for the blank iOS back-swipe preview, on the theory that WebKit binds the gesture snapshot when the entry is recorded. That theory turned out to be wrong, and the preview was actually fixed by leaving <code>history.scrollRestoration</code> alone; the ordering is kept because recording an entry against its own page is correct regardless.) One exception worth knowing: if a <code>loading.&#123;js,ts&#125;</code> skeleton is showing (it is applied optimistically, before the response arrives), the entry is recorded against that skeleton rather than the page you left.</li>
      <li>The <code>&lt;head&gt;</code> is add-only merged (preserves runtime-injected styles like Tailwind's), still before the content itself changes.</li>
      <li>The swap runs, applying the tier chosen in step 2. The diff inside the swap region is keyed by <code>data-key</code> or <code>id</code>. Matched elements are reused with in-place attribute updates. <strong>Live attributes</strong> (<code>value</code>, <code>checked</code>, <code>selected</code>, <code>indeterminate</code>, <code>disabled</code>, <code>open</code>, <code>popover</code>) are never overwritten, so user input and disclosure state survive the swap.</li>
      <li><code>&lt;script&gt;</code> tags re-execute and custom elements upgrade. That re-execution reaches a script wherever it sits, inside the swapped content or as a top-level node of the swapped range itself (a layout emitting its enhancement script as a sibling of <code>\${children}</code>). A parsed script node carries the HTML spec's "already started" flag, so the router replaces it with a fresh clone; that is what makes it run. The clone carries the page-load CSP nonce, not the nonce the response was rendered with. The one exception is a script INSIDE an element the swap preserved by identity through <code>data-webjs-permanent</code>, covered below.</li>
      <li>A <code>webjs:navigate</code> event fires on <code>document</code> with the final URL.</li>
    </ol>
    <p><strong>Write swapped scripts to be re-runnable.</strong> A script inside a swapped range runs again on every navigation that swaps that range, and giving it an <code>id</code> does not change that. The keyed differ reuses the live element, and the router still re-emits it. So a script that installs a listener or a <code>MutationObserver</code> should either be idempotent or guard on a flag it sets the first time. The alternative, running once and then never again, is the worse default: it is exactly what a progressive-enhancement script (a syntax highlighter, a chart initializer) must not do after a soft nav. Put anything that genuinely must run once in the root layout, whose markup is never swapped. <code>data-webjs-permanent</code> splits into two cases here. A script that IS the marked element is re-emitted like any other, so the attribute is not an escape hatch for a script itself. A script INSIDE a marked element that the swap actually preserved is left alone, because the attribute means that whole subtree survives as the same live node.</p>
    <p><strong>Wire-byte optimization</strong>: the router sends an <code>X-Webjs-Have</code> request header listing <code>segment:route-key</code> entries for the boundaries it already has (the key lets the server re-render a dynamic layout the client holds for different params instead of skipping it). The server walks the target page's layout chain innermost-to-outermost, short-circuits at the first match, and returns only the divergent fragment wrapped in that layout's boundary pair. Outer layouts are never re-serialized for same-shell navigations, and a reduced response is served <code>private</code> so no shared cache can store it and serve it to a full-page navigation. It also carries <code>Vary: X-Webjs-Have</code> for caches that honour that header, but the guarantee does not depend on it: Cloudflare honours only <code>Accept-Encoding</code>. On a page that opted into caching via <code>metadata.cacheControl</code>, the fragment still carries an <code>ETag</code>, so the router's revalidating fetches stay cheap; on a default <code>no-store</code> page there is nothing to validate either way.</p>

    <h2>Progressive streaming on navigation</h2>
    <p>When the destination streams (it has a <code>Suspense</code> or <a href="/docs/suspense">&lt;webjs-suspense&gt;</a> boundary), the router applies the response PROGRESSIVELY: it advances the URL and swaps the shell (with the fallbacks) in immediately, then streams each resolved boundary into the live DOM as it arrives, fast-before-slow. So a soft navigation to a streamed page matches the initial-load experience (fallback first, content streams in) instead of buffering the whole response before the swap. A non-streaming page is unaffected (the response is read to completion and applied once). A navigation superseded mid-stream stops applying, and a mid-stream transport failure leaves the applied boundaries in place with the rest showing their fallback (non-destructive).</p>

    <h2>Form submissions</h2>
    <p><code>&lt;form action="/x" method="post"&gt;</code> works exactly per the HTML spec. WebJs intercepts the <code>submit</code> event in the bubble phase (after a component's own <code>@submit</code> handler) and routes the same fetch the browser would have sent through the partial-swap pipeline. Because it runs after, a component that calls <code>e.preventDefault()</code> in <code>@submit</code> keeps the form to itself and the router leaves it alone; the same applies to <code>@click</code> on links. Submitter attributes (<code>formmethod</code>, <code>formaction</code>, <code>formenctype</code>, <code>formtarget</code> on a clicked <code>&lt;button&gt;</code>) take precedence over the form's own per HTML5, decided on whether the attribute is PRESENT rather than on its value being non-empty: <code>formmethod=""</code> really does submit as a GET, because a present-but-empty enumerated attribute falls to its own invalid-value default instead of inheriting the form's.</p>
    <ul>
      <li><strong>GET forms</strong>: <code>FormData</code> is promoted to the URL query string (replacing any existing query on <code>action</code>). The URL is then fetched and applied like a link click.</li>
      <li><strong>POST / PUT / PATCH / DELETE forms</strong>: <code>FormData</code> is sent as the request body. After a successful response the snapshot cache is cleared (other cached URLs may reflect stale server state).</li>
    </ul>
    <p>Forms that handle submission in JavaScript (<code>@submit=\${e =&gt; { e.preventDefault(); /* RPC */ }}</code>) are untouched. The router only intercepts when <code>event.defaultPrevented</code> is false.</p>

    <p><strong>Auto-skipped</strong> (no opt-out needed):</p>
    <ul>
      <li><code>method="dialog"</code>: browser-native <code>&lt;dialog&gt;</code> dismissal</li>
      <li>A resolved <code>target</code> that is neither empty nor <code>_self</code>: iframes, popups, named windows. A submitter's <code>formtarget</code> wins over the form's whenever the attribute is PRESENT, so <code>formtarget=""</code> brings a <code>target="_blank"</code> form back to the current context and is routed, exactly as the browser would submit it.</li>
      <li>Cross-origin <code>action</code></li>
      <li>Non-HTML extensions on the <code>action</code> URL</li>
    </ul>

    <h3>Submission state (<code>webjs:submit-start</code> / <code>webjs:submit-end</code> + <code>aria-busy</code>)</h3>
    <p>When a <code>&lt;form&gt;</code> submits through the JS-enhanced router, the form gets a submission lifecycle a component can read to disable the submit button, show a spinner, or set a pending style.</p>
    <ul>
      <li>The router sets the native <code>aria-busy="true"</code> on the form for the in-flight duration (cleared on settle). This IS the readable "is this form submitting" primitive. Any component can poll <code>form.getAttribute('aria-busy')</code> or style <code>form[aria-busy="true"]</code> in CSS.</li>
      <li>It dispatches a bubbling <code>webjs:submit-start</code> (detail <code>{ form, url }</code>) when the submission fetch starts, and <code>webjs:submit-end</code> (detail <code>{ form, url, ok }</code>, where <code>ok</code> is whether the submission settled as a success) on EVERY settle (a success, a 4xx/5xx validation re-render, a navigation error, or an abort by a superseding submit). The pair is balanced even under a rapid re-submit (a nav-token guard keeps a superseded submit's teardown from clearing the busy state a newer submit set, the same guard <code>&lt;webjs-frame&gt;</code> uses).</li>
    </ul>
    <code-block>// A submit button that disables itself while its form is submitting.
form.addEventListener('webjs:submit-start', () =&gt; { button.disabled = true; });
form.addEventListener('webjs:submit-end', (e) =&gt; {
  button.disabled = false;            // e.detail = { form, url, ok }
});
/* or purely in CSS, no JS: */
/* form[aria-busy="true"] button[type="submit"] { opacity: .5; pointer-events: none; } */</code-block>
    <p>Progressive enhancement is unaffected. With JS off the form is a normal POST. The events and <code>aria-busy</code> are a client-only enhancement. To skip the wait rather than style it, see <a href="/docs/optimistic-ui">Optimistic UI</a>.</p>

    <h2>Non-2xx HTML responses render in place</h2>
    <p>Any response with a <code>text/html</code> body is applied to the DOM regardless of status code. This makes the standard server-rendered validation pattern work end-to-end:</p>
    <ul>
      <li><strong>2xx</strong>: normal navigation.</li>
      <li><strong>4xx (e.g. 422)</strong>: server re-renders the form with <code>value</code> attributes preserving what the user typed, inline error messages visible, no full-page reload. The Rails / Django / Laravel / Phoenix server-side validation flow.</li>
      <li><strong>5xx with HTML</strong>: error page rendered in place (not a flash of blank then reload).</li>
    </ul>
    <p>Non-HTML <em>error</em> responses (a JSON error envelope from a 500), and transport/parse failures, recover in place via the <code>webjs:navigation-error</code> event below rather than a destructive full reload.</p>
    <p><strong>204 No Content</strong>: DOM untouched. History records the requested URL ("stay on current page" pattern for autosave-style submissions).</p>
    <p><strong>3xx redirects</strong>: <code>fetch()</code> follows them automatically. The <em>final</em> URL after redirects is recorded in history (Post-Redirect-Get pattern works correctly).</p>

    <h2>Failed navigations recover in place (<code>webjs:navigation-error</code>)</h2>
    <p>A successful swap and an HTML error body of any status both apply in place (above). The remaining failure cases are a <strong>non-HTML error response</strong> (a 500 carrying a JSON body) and a <strong>transport/parse failure</strong> (the <code>fetch</code> rejected, or the body claimed HTML but did not parse). For those the router no longer abandons the SPA with a destructive full <code>location.href</code> reload (which would discard the partial-swap shell, scroll, focus, and in-flight client state, and eat a second round-trip that may itself fail to the browser's default error page).</p>
    <p>Instead the router dispatches a cancelable, bubbling <code>webjs:navigation-error</code> event on <code>document</code>, with detail <code>{ url, status, error }</code>: <code>status</code> is the HTTP status when a response arrived (else <code>null</code>), and <code>error</code> is the <code>Error</code> for a transport/parse failure (else <code>null</code>).</p>
    <ul>
      <li><strong><code>preventDefault()</code></strong> hands recovery to your app. The router does nothing further, so the current page is left exactly as it is (shell, scroll, focus, and client state preserved). Show a toast, retry, or navigate elsewhere.</li>
      <li><strong>Not cancelled (the default)</strong> renders a minimal in-place error surface, a <code>&lt;div role="alert"&gt;</code> carrying a generic message plus the status, into the deepest layout children slot (the same target a normal partial swap writes to, so outer chrome and nav are preserved).</li>
      <li><strong>Last-resort hard load</strong> happens only when there is no shared layout marker to render into (a genuine cross-document nav), and only after the event was not cancelled.</li>
    </ul>
    <p>An <strong>AbortError</strong> (a newer navigation superseding this one) is a normal supersede, not an error, and never fires <code>webjs:navigation-error</code>.</p>
    <code-block>document.addEventListener('webjs:navigation-error', (e) =&gt; {
  // e.detail = { url, status, error }
  e.preventDefault();                 // app handles recovery; page left intact
  showToast(\`Could not load \${e.detail.url} (status \${e.detail.status})\`);
});</code-block>

    <h2>Strip transient state before back/forward (<code>webjs:before-cache</code>)</h2>
    <p>Back/Forward restores from a URL-keyed snapshot cache (Turbo's SnapshotCache pattern) for instant navigation. Because a snapshot is a raw <code>outerHTML</code> clone of the live page, anything <em>open</em> when you navigate away (a hover-card, a dropdown, a toast) is captured open and <strong>restored open</strong> on Forward. The router dispatches <code>webjs:before-cache</code> on <code>document</code> synchronously, on the page being cached, right before the snapshot is read, so a handler can reset that state and edits land in the snapshot. The kit's overlays already do this, so they come back closed.</p>
    <code-block>document.addEventListener('webjs:before-cache', () =&gt; {
  document.querySelectorAll('[data-transient]').forEach((el) =&gt; el.remove());
  // close open menus, clear in-progress toasts, reset a wizard step, ...
});</code-block>

    <h2><code>&lt;webjs-frame&gt;</code>: escape hatch for non-layout regions</h2>
    <p><code>&lt;webjs-frame&gt;</code> is webjs's take on <strong>Turbo Frames</strong> (from Hotwire Turbo), so if you know <code>&lt;turbo-frame&gt;</code> the model transfers directly: a lazy, URL-addressable region that swaps on its own, driven by a link or form that targets its id. See <a href="/docs/data-fetching">Data fetching</a> for when to reach for a frame versus async render, <code>&lt;webjs-suspense&gt;</code>, or <code>&lt;webjs-stream&gt;</code>, and for combining a lazy frame with streamed content inside it.</p>
    <p>The marker mechanism scopes swaps to the deepest shared <strong>layout</strong>. When you need a swap region <em>smaller</em> than the deepest layout (typically a widget inside a page that should swap independently of the rest of the page) wrap it in <code>&lt;webjs-frame id="..."&gt;</code>.</p>
    <code-block>// app/posts/[slug]/page.ts
export default async function PostPage({ params }) {
  const post = await getPost(params.slug);
  return html\`
    &lt;article&gt;\${post.body}&lt;/article&gt;

    &lt;webjs-frame id="comments"&gt;
      \${await renderComments(post.id, /* page */ 1)}
      &lt;a href="/posts/\${params.slug}/comments?page=2"&gt;Load more&lt;/a&gt;
    &lt;/webjs-frame&gt;
  \`;
}</code-block>
    <p>When the user clicks "Load more", the router's <code>closest('webjs-frame')</code> from the click target finds <code>#comments</code>. The fetched response is expected to contain a <code>&lt;webjs-frame id="comments"&gt;</code> too. Only its children swap into the live frame, leaving the article body (and any reading scroll position, video playback, etc.) fully intact.</p>
    <p>This takes precedence over the layout-marker mechanism. Most apps never need it. Only reach for it when you've identified that the auto-marker swap is wider than the actual change.</p>

    <h3>A frame swap never scrolls the page</h3>
    <p>A page navigation scrolls to top, the way a browser does. A frame swap does not: it changes one region and leaves the rest of the document standing, the reader's scroll offset included. Without that, filtering a panel below the fold would throw the reader back to the top of the page, with the panel they just clicked in off screen. The rule covers every way a frame swaps, a nested link, an external <code>data-webjs-frame</code> trigger, a frame-targeted form submission, and a <code>src</code> self-load, and it covers a <code>#hash</code> on a frame link too, which rides the URL without moving the viewport.</p>
    <p>One thing this rule does NOT cover, because the router never sees it: a <em>pure</em> fragment link whose path and query match the page it sits on. The click handler bows out before <code>preventDefault</code>, so the browser performs its own native fragment jump and the window does move.</p>
    <p><strong>Every spelling of a fragment link is the browser's, the bare <code>#</code> included.</strong> <code>href="#"</code> is the back-to-top idiom, and it serializes with an <em>empty</em> fragment that reads identically to no fragment at all through <code>URL.hash</code>, so the bow-out tests the <code>href</code> for a <code>#</code> instead. A <code>&lt;a href="#"&gt;Back to top&lt;/a&gt;</code> therefore scrolls to top natively, inside a frame as well as outside one. <code>href=""</code> is not a fragment link at all: it resolves to the current url with the fragment <em>removed</em>, which the spec reloads rather than jumps, so the router navigates it like any other link.</p>
    <p><strong>Read "never scrolls" as "WebJs never writes a scroll", not as a promise the viewport cannot move.</strong> A swap that makes the panel shorter shortens the document with it, and a reader parked near the bottom is then holding an offset the document can no longer reach, so the browser clamps it. On the gallery's frames demo, filtering from All to Done at the bottom of the page moves the window from 474 to 405, exactly the 69px the document lost. The router writes no scroll there, and any DOM change that shortens a page does the same. Keeping the frame a stable height across its states avoids it.</p>
    <p>The escapes are page navigations and DO scroll to top: <code>data-webjs-frame="_top"</code>, and an id that cannot be matched to a live frame, which warns and degrades to a normal navigation. Do not read that second one as covering a <em>response</em> that lacks the requested frame (the <code>webjs:frame-missing</code> warning): there the frame resolved and the navigation stayed frame-scoped, so the offset holds and only the panel is left unchanged. Turbo's <code>autoscroll</code> opt-in, which scrolls the frame itself into view on swap, has no WebJs equivalent; the router simply never writes scroll for a frame.</p>

    <h3>External targeting (<code>data-webjs-frame</code>) and <code>_top</code></h3>
    <p>A trigger does not have to be nested inside the frame it drives. Mirroring Turbo's <code>data-turbo-frame</code>, an <code>&lt;a&gt;</code> or <code>&lt;form&gt;</code> (or any ancestor of it) carrying <code>data-webjs-frame="&lt;id&gt;"</code> drives the frame with that id from anywhere in the document, resolved via <code>getElementById</code>. So an external nav/sidebar link or a filter form can drive a content frame it does not enclose.</p>
    <code-block>&lt;nav data-webjs-frame="results"&gt;
  &lt;a href="/products?sort=new"&gt;Newest&lt;/a&gt;
  &lt;a href="/products?sort=top"&gt;Top rated&lt;/a&gt;
&lt;/nav&gt;
&lt;form action="/products" data-webjs-frame="results"&gt;…filters…&lt;/form&gt;

&lt;webjs-frame id="results"&gt;…current results…&lt;/webjs-frame&gt;</code-block>
    <p>An explicit <code>data-webjs-frame</code> WINS over the closest-enclosing-frame default. The reserved token <code>data-webjs-frame="_top"</code> on a trigger INSIDE a frame breaks OUT to a full-page navigation. An id that does not resolve to a live <code>&lt;webjs-frame&gt;</code> warns once and falls back to a normal navigation (it never throws). With JS disabled the attribute is inert on a plain <code>&lt;a href&gt;</code>, so the click is a normal full navigation, the correct progressive-enhancement fallback.</p>

    <h3>Busy state (<code>aria-busy</code> + <code>webjs:frame-busy</code>)</h3>
    <p>While a frame's navigation is in flight the router sets the native <code>aria-busy="true"</code> on the frame element and clears it (to <code>"false"</code>) on every exit, a successful swap, a frame-missing response, an HTTP/transport error, or an abort by a newer navigation. So assistive tech announces the loading state, and CSS can style the busy region with <code>webjs-frame[aria-busy="true"]</code>. The router also dispatches a bubbling <code>webjs:frame-busy</code> event on the frame at both edges (detail <code>{ frameId, busy }</code>, <code>true</code> at start then <code>false</code> at finish) for app-level hooks.</p>

    <h3>Self-loading frames (<code>src</code> + <code>loading</code>)</h3>
    <p>A frame can fetch its OWN content instead of waiting for a click or a form. Give it a <code>src</code> and it self-fetches that URL as a frame nav and applies the matching <code>&lt;webjs-frame id&gt;</code> subtree from the response into itself, through the same frame-swap path (so the busy lifecycle, the navigation-error recovery, and the frame-missing fallback all apply). The <code>loading</code> attribute picks when: <code>eager</code> (or absent) fetches on connect, <code>lazy</code> fetches when the frame first scrolls into view (reusing the same IntersectionObserver budget as a <code>static lazy = true</code> component).</p>
    <code-block>&lt;webjs-frame id="comments" src="/posts/42/comments" loading="lazy"&gt;
  &lt;p&gt;Loading comments...&lt;/p&gt;
&lt;/webjs-frame&gt;</code-block>
    <p>A <code>src</code> change after connect re-loads; eager connect, the lazy observer, and a <code>src</code> mutation never double-fetch the same URL. Because the request carries the <code>x-webjs-frame</code> header, the <strong>server returns only the matched subtree</strong> (byte-equivalent to what the client would slice from a full-page render, but far fewer bytes), falling back to the full page when the frame is absent.</p>
    <p><strong>Progressive-enhancement caveat:</strong> a <code>src</code>-driven frame is JS-dependent. The browser does not natively fetch a <code>&lt;webjs-frame src&gt;</code> (unlike an <code>&lt;iframe&gt;</code>), so with JS off the frame shows only whatever children were server-rendered into it. Use <code>src</code> / <code>loading</code> for deferred content (comments, a recommendations rail, an expensive card) where a JS-off placeholder is acceptable; for content that must exist without JS, render it server-side into the frame instead.</p>

    <h2>Stream actions (surgical element updates)</h2>
    <p><code>&lt;webjs-stream&gt;</code> is webjs's take on <strong>Turbo Streams</strong> (from Hotwire Turbo); the action set (<code>append</code> / <code>prepend</code> / <code>before</code> / <code>after</code> / <code>replace</code> / <code>update</code> / <code>remove</code>) mirrors <code>&lt;turbo-stream&gt;</code>, so that knowledge transfers directly.</p>
    <p>A region swap is the right tool for "this part of the page changed". It is too coarse for "append ONE comment", "remove ONE row", or "bump a count". For those, a server response declares per-element actions as plain HTML, a <code>&lt;webjs-stream action target&gt;</code> wrapping one <code>&lt;template&gt;</code>:</p>
    <code-block>&lt;webjs-stream action="append" target="comments"&gt;
  &lt;template&gt;&lt;li&gt;Nice post!&lt;/li&gt;&lt;/template&gt;
&lt;/webjs-stream&gt;</code-block>
    <p>The element clones its template on connect, applies the action by native DOM, then removes itself. Actions mirror Turbo's set: <code>append</code> / <code>prepend</code> (last / first child of the target id), <code>before</code> / <code>after</code> (sibling of the target), <code>replace</code> (the target element), <code>update</code> (its children), <code>remove</code> (delete it, no template). A <code>targets</code> CSS selector applies to every match instead of a single <code>target</code> id.</p>
    <p>One applier serves two delivery paths. Over HTTP, a <code>&lt;form&gt;</code> submission rides the router, which adds <code>Accept: text/vnd.webjs-stream.html</code>; the server returns a stream only then and the router applies it surgically. With JS off the browser sends no such header, so the same endpoint returns a normal render and the form is a plain full-page POST (progressive-enhancement-safe). Over a live channel, <code>renderStream(message)</code> from a <code>connectWS</code> handler applies a <code>broadcast()</code>ed payload, so chat and notifications reuse the same applier.</p>
    <p>Build the payload server-side and apply it client-side:</p>
    <code-block>// app/posts/[id]/route.ts
import { stream, streamResponse, acceptsStream, broadcast } from '@webjsdev/server';
import { escapeText } from '@webjsdev/core';
export async function POST(req, { params }) {
  const c = await addComment(params.id, await req.formData());
  const html = stream.append('comments', '&lt;li&gt;' + escapeText(c.text) + '&lt;/li&gt;');
  broadcast('post:' + params.id, html);              // fan out to other viewers
  if (acceptsStream(req)) return streamResponse(html); // JS client: surgical
  return Response.redirect(new URL('/posts/' + params.id, req.url), 303); // no-JS: normal render
}</code-block>
    <code-block>// a component, for the live channel
import { connectWS, renderStream } from '@webjsdev/core';
connectWS('/posts/' + id + '/feed', { onMessage: (m) =&gt; renderStream(m) });</code-block>
    <p><code>stream.*</code> escapes the target id but NOT the content (server-authored HTML, like an <code>html</code> hole, so escape any user substring yourself with <code>escapeText</code> from <code>@webjsdev/core</code>). <code>renderStream</code> and the <code>&lt;webjs-stream&gt;</code> element are auto-registered by the client router.</p>

    <h2>View Transitions (opt-in, all three swap paths)</h2>
    <p>The router can wrap a client navigation's DOM mutation in the native <a href="https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API">View Transitions API</a> (<code>document.startViewTransition</code>), so a same-shell partial swap cross-fades (or runs your <code>::view-transition-*</code> CSS) instead of snapping. It is OFF by default and purely OPT-IN, so an unconfigured app behaves exactly as before (no animation surprise, no regression in a browser without the API). Opt in by adding a meta to the page head, mirroring Turbo's <code>&lt;meta name="view-transition"&gt;</code> convention:</p>
    <code-block>&lt;!-- in the root layout's &lt;head&gt;, or any page's head --&gt;
&lt;meta name="view-transition" content="same-origin"&gt;</code-block>
    <p>The accepted opt-in value is <code>same-origin</code> (every client-router swap is same-origin by construction, so it reads as "animate these in-app navigations"); any other value, or the meta being absent, keeps transitions off. The opt-in is PER page, so it is a page-scoped meta: put it on one page's metadata to animate that page, or on the root layout to animate the whole app. Navigating to a page that does NOT declare it turns transitions back off, because the soft-nav head merge reconciles page-scoped <code>&lt;meta&gt;</code> tags (a stale one the previous page declared is removed, not left to leak).</p>
    <p>View transitions COMPOSE with Suspense streaming: a streamed boundary (a <code>loading.ts</code> skeleton or a <code>&lt;webjs-suspense&gt;</code> region) navigated to under an active transition still resolves its content progressively, because the streamed resolve waits for the transition's DOM swap to commit before applying.</p>
    <p>When enabled and supported, the transition wraps ALL THREE swap paths, the deepest-marker layout swap, the <code>&lt;webjs-frame&gt;</code> swap, AND the full-body fallback, not just the full-body case (the inverse of what an author expects, since the marker and frame swaps are the common designed-for paths). The transition wraps the DOM MUTATION ONLY, never the fetch (which already happened); the browser captures the before/after around the synchronous swap. When <code>startViewTransition</code> is unavailable (Firefox / older Safari), the swap runs synchronously, byte-identical to the no-transition path, with no flash and no throw.</p>

    <h3>Persisting elements across a swap (<code>data-webjs-permanent</code>)</h3>
    <p>An element marked <code>data-webjs-permanent</code> (it MUST also carry an <code>id</code>) survives a navigation as the SAME live DOM node, by node identity, so a playing <code>&lt;audio&gt;</code> / <code>&lt;video&gt;</code>, a live widget, an open menu, or any element with accumulated JS state keeps running across the swap instead of being destroyed and re-created from the incoming HTML. Mirrors Turbo's permanent-element behaviour.</p>
    <code-block>&lt;audio id="player" data-webjs-permanent controls src="/track.mp3"&gt;&lt;/audio&gt;</code-block>
    <p>Mechanism: before the destructive swap, for each <code>[data-webjs-permanent][id]</code> in the CURRENT DOM the router looks for a matching <code>#id</code> in the INCOMING document; when BOTH exist, the LIVE node is moved into the incoming tree's position (replacing the incoming placeholder), so the swap adopts the live node rather than recreating it. It works for the full-body path AND the in-region (marker / frame) paths, and is a STRONGER guarantee than the keyed reconciler (which preserves identity for matched keyed children): a permanent node keeps EXACT identity even where the reconciler would otherwise recreate it. Rules:</p>
    <ul>
      <li>The element must have an <code>id</code> (the match key) and the attribute on BOTH the current and incoming render of the page.</li>
      <li>An id present in the current but ABSENT from the incoming doc is NOT force-persisted (it is being removed; the swap removes it as usual).</li>
      <li>Only a CURRENT node actually carrying <code>data-webjs-permanent</code> is moved (an incoming <code>#id</code> that resolves to a non-permanent current element is left untouched).</li>
      <li>The node is placed exactly where the incoming document puts it, so it never escapes a frame / region boundary.</li>
      <li>The attribute is SUBTREE-scoped, so a <code>&lt;script&gt;</code> inside a preserved element is NOT re-emitted and does not run again. That is the point: re-running a widget's init script against the live instance you asked the router to keep is a double-initialization, not a refresh.</li>
      <li>The script exemption applies only once the element has ACTUALLY been preserved. The first time a permanent element arrives there is nothing to preserve (the both-exist rule above), so it is ordinary new content and its scripts run like any other. An element with no <code>id</code> can never be preserved, so it never gets the exemption either.</li>
      <li>A script that IS the marked element is always re-emitted. The attribute preserves accumulated JS state, and a script's only state is that it ran; exempting it would leave a script that runs on a cold load and never on a soft navigation.</li>
    </ul>
    <p>Progressive enhancement: with JS off, <code>data-webjs-permanent</code> is an inert attribute and the navigation is a normal full-page load.</p>

    <h2>Snapshot cache + back/forward</h2>
    <p>The router maintains a URL-keyed LRU cache of page snapshots (capacity 16). On back/forward via <code>popstate</code>, the cached DOM is applied instantly and the captured window-scroll position is restored. A background refetch then revalidates the snapshot quietly.</p>
    <p>The <code>popstate</code> an in-page fragment <em>click</em> produces is the exception, and it restores nothing. The browser has already done the jump, so the router absorbs it and leaves live DOM identity and hydrated component state alone. That covers a repeat click of one anchor too, which replaces its history entry rather than pushing a new one and still fires <code>popstate</code> with the URL unchanged.</p>
    <p>The gate is which popstate the router <em>caused</em>, not how the URL looks: it marks the click it bowed out of and the next <code>popstate</code> consumes that mark. A Back between two entries differing only by fragment can still need a re-render, because a form's raw <code>action</code> attribute carries no fragment, so a bound-submitter form declaring <code>action="/p"</code> pushes its 422 re-render at <code>/p</code> while the reader sits at <code>/p#sec</code>. So an ordinary Back or Forward between two fragment states still re-renders.</p>
    <p>A back/forward restore reserves the page's recorded HEIGHT across the swap, then suppresses the browser's scroll anchoring (<code>overflow-anchor</code>) for the restore's duration, then puts both back. The reservation is what makes the saved offset reachable: the snapshot's markup is briefly shorter than the page it was serialized from, because its components have not rendered yet, so without it the browser clamps the restore to whatever the short document allowed and the reader lands short. The suppression covers the other half: content still SHIFTS above the viewport as those components render, and anchoring would add that shift to the offset just replayed, landing the reader below where they left. The window closes on the first real input (<code>wheel</code>, <code>touchmove</code>, <code>keydown</code>, <code>pointerdown</code>), so a reader who starts scrolling mid-restore gets normal anchoring back immediately. It also closes as soon as another page navigation starts, since the window outlives its own restore and must not be inherited by a page it was never meant for. Absent either of those it closes once the restore is over, which is the later of that restore's background revalidation settling and a short floor, and at the latest on a 2s ceiling. The floor matters because waiting on the revalidation alone would tie the window to network latency rather than to the growth it guards. Suppression only withholds a browser correction, it never moves the viewport. The height reservation releases on the same settle and ceiling, and on a superseding navigation, but deliberately NOT on user input: releasing the page's height under a reader mid-scroll is the one harm an early release could do. If your app sets <code>overflow-anchor</code> or an inline <code>min-height</code> on the root itself, each is saved and put back.</p>
    <p>A frame-targeted navigation or submission is the one exception to the closing rule above: it swaps a single <code>&lt;webjs-frame&gt;</code> rather than the page, so the restored offset is still the right one and the restore is left running. Frame targeting here means what it means everywhere else, so a trigger that breaks out with <code>data-webjs-frame="_top"</code>, or names an id that does not resolve, is a page navigation and does close the window.</p>
    <p><strong>The browser restores Back/Forward scroll, not the router.</strong> WebJs FORCES <code>history.scrollRestoration</code> to <code>auto</code> when the router starts, overriding an app that had set <code>'manual'</code> (and putting that value back if you call <code>disableClientRouter()</code>), so <strong>setting it to <code>'manual'</code> yourself does not take effect while the router is running</strong>. Only under <code>auto</code> does the browser record a scroll position per history entry, replay it on a traverse, and compose the iOS edge back-swipe gesture preview from that recording. The router writes no scroll of its own on a restore: it reserves the recorded height across the swap so the browser's replay lands on a document that can hold the offset, and that is the entire mechanism. One writer, which is the model Next and Remix 3 use as well. Taking manual control suppresses the recording, so every scrolled page previews blank for the whole duration of the gesture; that is a real bug WebJs shipped, inherited from Turbo Drive's <code>assumeControlOfScrollRestoration</code>, and it is why Turbo still has it (Turbo is single-writer too, but its writer is the app rather than the browser).</p>
    <p>Navigation never animates the scroll, so setting <code>html { scroll-behavior: smooth }</code> in your app does not make it do so. The forward-nav scroll-to-top is the router's own write and is forced <code>behavior: 'instant'</code>; the back/forward restore is the browser's and is not a scrolling-API call at all, so <code>scroll-behavior</code> cannot reach it either. It jumps like a native page load. A hash-anchor (<code>#section</code>) link still scrolls smoothly when you opt into it. Because route transitions ignore <code>scroll-behavior: smooth</code> (it only affects in-page anchors), the router logs a one-time dev-only console hint if it detects that setting on <code>&lt;html&gt;</code>, and notes that combining it with a sticky <code>backdrop-filter</code> header can flash on iOS during navigation.</p>
    <p>After a server action mutates data that a cached page depends on, call <code>revalidate()</code>:</p>
    <code-block>import { revalidate } from '@webjsdev/core';

// Invalidate one cached URL, next visit refetches
revalidate('/products/123');

// Clear the entire cache, useful after broad mutations
revalidate();</code-block>
    <p>Mutating form submissions (POST / PUT / PATCH / DELETE) clear the cache automatically on success. You only need <code>revalidate()</code> when the mutation happens via JS / RPC and didn't go through a form.</p>

    <h2 id="preserving-scroll">Preserving scroll on a forward navigation (<code>data-preserve-scroll</code>)</h2>
    <p>A forward navigation scrolls to the top, the way a browser does. <code>data-preserve-scroll</code> is the per-link escape hatch, for a navigation that changes only part of what the reader is looking at: a filter, sort, or tab link whose control sits below the fold, a pager, or a form that re-renders in place with validation errors. WebJs wants it more than most frameworks do, because a searchParams-only navigation already morphs the deepest shared boundary and keeps the hydrated state of every component around it, so the scroll is the only thing such a navigation still throws away.</p>
    <code-block>&lt;!-- one link --&gt;
&lt;a href="?sort=new" data-preserve-scroll&gt;Newest&lt;/a&gt;

&lt;!-- or a whole region, resolved with closest() --&gt;
&lt;nav data-preserve-scroll&gt;
  &lt;a href="?sort=new"&gt;Newest&lt;/a&gt;
  &lt;a href="?sort=top"&gt;Top&lt;/a&gt;
  &lt;a href="/" data-preserve-scroll="false"&gt;Home&lt;/a&gt;  &lt;!-- opts back out --&gt;
&lt;/nav&gt;

&lt;!-- forms too: resolved from the submitter, falling back to the form itself --&gt;
&lt;form method="post" action="${'${saveDraft}'}" data-preserve-scroll&gt;...&lt;/form&gt;</code-block>
    <p>The attribute resolves through <code>closest()</code>, so one mark on a wrapping element covers every link inside it, and <code>data-preserve-scroll="false"</code> on something nearer opts back out. On a form the lookup starts at the submitter and falls back to the form, so a marked form covers its buttons even when one is attached from elsewhere with <code>form="id"</code> rather than nested inside it. A hash link still scrolls to its anchor, because the reader named a target and a named target beats a blanket preference. It is inert on a frame-targeted link, since a frame swap never writes a scroll to begin with, and inert with JS off, where the link is a plain <code>&lt;a&gt;</code>, so nothing about a page's correctness may depend on it.</p>
    <p>It carries the reader's <em>current</em> offset onto the destination. It does not restore the offset they once had there, which is a different feature and not one WebJs ships, so this is the wrong tool for a "back to the list" link.</p>

    <h2>Link prefetch (on by default)</h2>
    <p>Same-origin in-app links are prefetched speculatively, so a click resolves from a warm cache with no round-trip. No attribute is needed; it is on for every internal <code>&lt;a href&gt;</code>, the way Next, Nuxt, and SvelteKit ship auto-prefetch, and the prefetch sends the same headers a real navigation does so the click consumes the fragment.</p>
    <p>The default strategy is <strong>device-adaptive</strong>, because one strategy cannot serve both input modalities. On a hover-capable pointer (mouse / trackpad) the default is <strong>intent</strong> (warm on hover or focus, a real head-start before the click). On touch the default is <strong>viewport</strong> (warm as links settle on-screen), because touch has no hover and <code>touchstart</code> fires at tap time, too late to help. The modality is detected with <code>matchMedia('(hover: hover) and (pointer: fine)')</code>, not a user-agent sniff, and a per-link <code>data-prefetch</code> always overrides it.</p>
    <p>Choose a strategy per link with <code>data-prefetch</code> (a valid-HTML <code>data-*</code> attribute, since WebJs has no Link component). Next-style aliases are accepted:</p>
    <code-block>&lt;a href="/dashboard"&gt;adaptive: intent on pointer, viewport on touch (default)&lt;/a&gt;
&lt;a href="/dashboard" data-prefetch="intent"&gt;hover / focus / touch&lt;/a&gt;
&lt;a href="/dashboard" data-prefetch="render"&gt;eager, on insert (alias: true)&lt;/a&gt;
&lt;a href="/dashboard" data-prefetch="viewport"&gt;on scroll into view (alias: auto)&lt;/a&gt;
&lt;a href="/dashboard" data-prefetch="none"&gt;never (alias: false)&lt;/a&gt;</code-block>
    <p>The <strong>viewport</strong> strategy waits a ~250ms dwell before warming and cancels the instant a link scrolls back out, so a fast scroll through a long list spends no requests (the same over-fetch gate Astro, Next, Nuxt, Remix, TanStack, and Turbo apply). On touch, <code>touchstart</code> additionally warms the tapped link itself. The guiding rule is snappy without bloating the network tab: when the two conflict, the gate under-fetches.</p>
    <p>Only internal links qualify, using the same eligibility as a click: cross-origin, <code>download</code>, <code>target</code> other than <code>_self</code>, non-HTML extensions, <code>data-no-router</code>, and pure hash jumps are skipped. Opt out with <code>data-prefetch="none"</code>, <code>data-no-prefetch</code>, or <code>rel="external"</code>. Speculation is bounded (a concurrency cap with a draining queue, in-flight de-dupe, an LRU + TTL cache) and is disabled under <code>Save-Data</code>, <code>prefers-reduced-data</code>, or a 2g connection. A mutating form submission and <code>revalidate()</code> evict the prefetch cache too, so a fragment prefetched before a mutation is never served stale.</p>
    <p><strong>Prefetch issues a real GET</strong>, so a non-idempotent action (logout, anything that mutates) must be a POST or a <code>&lt;form&gt;</code>, never a GET link. This matches every framework that auto-prefetches. A native <code>&lt;link rel="prefetch"&gt;</code> in the document head is the browser's own mechanism and is left untouched.</p>

    <h3>The prefetch cache is anchor-validated, not just URL-keyed</h3>
    <p>A prefetched fragment is a <em>reduced</em> response. The request carries <code>X-Webjs-Have</code> (the layout boundaries the client already holds) and the server returns only the divergent part, starting at the deepest boundary it short-circuited on. That boundary is the fragment's <strong>anchor</strong>, and the fragment applies to any live DOM that still offers it with the same route-key.</p>
    <p>So on consume the router validates the anchor, not the whole <code>have</code> string. A fragment anchored at the root layout survives an unrelated navigation and stays a cache hit, because every page carries the root boundary. One anchored at <code>/docs</code> is discarded once you leave the docs section: applying it would hand the swap a tree sharing no boundary with the live DOM, which correctly degrades to a full page load. A discard costs one round-trip, which is the cheap side of that trade.</p>
    <p>The router also never prefetches the page it is already on. Such a request cannot serve any later navigation (a same-URL click short-circuits) and only occupies one of the capped cache slots. It happens routinely, because a hover's intent timer can fire <em>after</em> the click it belongs to has already swapped, at which point the link under the cursor points at the current page. Both behaviours are internal and need no configuration.</p>

    <h3>Frame links are prefetched too, in their own dimension</h3>
    <p>A link that drives a <code>&lt;webjs-frame&gt;</code> is prefetched with the same <code>X-Webjs-Frame</code> header its click will send, so the warm entry is the frame subtree the swap actually needs and the click is instant. Without this the hover cost a duplicate request and bought nothing, because the click needs a different response than a page-level prefetch holds.</p>
    <p>Since the server varies that response on the request header, the cache keys an entry by URL <em>plus</em> frame id. A prefetched page fragment is therefore never applied into a frame region, nor a frame subtree into a full-page swap, and both can be cached for one URL at once. A frame entry is validated by its frame still being in the document rather than by a boundary anchor, because a subtree carries no boundary comment. A framed link pointing at the URL you are already on is not prefetched at all: that is a frame refresh, and a refresh must show fresh bytes. A <code>&lt;webjs-frame src&gt;</code> that loads itself stands outside this cache entirely, neither reading it nor keeping an entry it supersedes, for the same reason.</p>
    <p><strong>A route that streams does not get this.</strong> The server slices the subtree only when the render did not stream, so a route with a <code>loading.{js,ts}</code> or a <code>Suspense</code> boundary answers every framed request with the whole document instead. The router will not cache that under a frame key. The swap looks for the frame inside the response body, and on a streamed page it may not be there yet: content still inside a pending boundary arrives in a <code>&lt;template&gt;</code> the swap does not descend into. Consuming such an entry would then leave the region unchanged and log a warning, while the navigation around it still completes: the URL advances, though the scroll offset is left alone as on any frame nav, so the reader gets a changed address over an unchanged panel. A frame sitting outside every boundary does arrive in the first flush and would be found, but the router cannot tell the two cases apart from the bytes, so it declines the body either way. On those routes the click still costs its round trip, exactly as before. The refusal is remembered, so the link re-asks about once per cache TTL rather than on every hover (the memo set is itself small and capped, so a page with many distinct refused frame links can re-ask sooner).</p>
    <p>One thing to expect in the network tab: because dedupe is per dimension, a page that links the <em>same</em> URL twice, once driving a frame and once not, warms both and issues two speculative requests where it previously issued one. The two responses genuinely differ and a click on either link needs its own, so collapsing them would leave one of the links unwarmed ahead of the click. Both stay inside the same cache cap, concurrency gate, TTL, and <code>Save-Data</code> gate as every other prefetch, and no new prefetch trigger is added.</p>

    <h2>Observing a degraded navigation (<code>webjs:navigation-fallback</code>)</h2>
    <p>Some conditions make a soft navigation impossible: the boundary-integrity scan finds no trustworthy shared segment, a click lands while the document is still parsing, or a cross-deploy build mismatch is detected. Rather than guess and risk a corrupt DOM, the router degrades to a full page load, which is bounded and correct but not soft.</p>
    <p>Every such path dispatches <code>webjs:navigation-fallback</code> on <code>document</code>, <strong>in all environments including production</strong>, with detail <code>&#123; cause, href, willReload &#125;</code>. Causes are <code>no-shared-boundary</code>, <code>live-boundaries-malformed</code>, <code>incoming-boundaries-malformed</code>, <code>readyState-loading</code>, <code>deploy-mismatch</code>, <code>deploy-mismatch-reload-suppressed</code>, <code>navigation-error-unrecoverable</code>, <code>revalidation-discarded</code>, and <code>pre-boot-navigation</code>. <code>willReload</code> is <code>false</code> for a degradation that does not reload (a dropped background revalidation), so a listener can tell a click that became a document load from a background op that was skipped. The event is not cancelable: by the time it fires, degrading is the only safe option. In development a deduped console warning also prints.</p>
    <code-block>document.addEventListener('webjs:navigation-fallback', (e) =&gt; {
  // A full document load on a click is a UX regression worth knowing about.
  if (e.detail.willReload) analytics.track('router_full_load', e.detail);
});</code-block>
    <p><code>pre-boot-navigation</code> is the one cause reported <em>about</em> a load rather than during one. The boot is a module script, which the HTML spec defers until parsing finishes, while the links it will intercept are clickable from first paint. A click inside that window is a plain browser navigation, and the arriving document reports it with <code>willReload: false</code> because the load already happened. On a warm cache the window is a few tens of milliseconds; on a first visit over a slow connection it is long enough to matter, which is why the runtime is hinted in the head with <code>&lt;link rel="modulepreload"&gt;</code> rather than discovered a round trip later.</p>
    <p>Read it as a rate, not as a verdict on any single event. The check knows only that this document arrived by a same-origin navigation that was not a soft nav, so a <code>data-no-router</code> link, a <code>target="_blank"</code> open, a cross-document form post, and an app that turned the client router off all land here too. A reload, a back/forward restore, an external entry, and a full load the router itself chose are excluded. The report comes from the router's own boot, so a page that ships no client runtime (a fully elided, display-only route) reports nothing, which is also a page with no router that a click could have outrun.</p>

    <h2>Per-segment loading skeletons</h2>
    <p>Each <code>loading.{js,ts}</code> in the route chain is rendered into a hidden <code>&lt;template id="wj-loading:&lt;segment-path&gt;"&gt;</code> at body end. On nav-start, the client clones the deepest matching template into the swap slot, so users see an instant per-segment skeleton during the fetch instead of stale content.</p>


    <h2>Concurrent navigations + cancellation</h2>
    <p>Each click / submit <code>abort()</code>s any in-flight fetch from the prior one (Turbo Drive's <code>navigator.stop()</code> pattern). Rapid clicks won't produce N parallel requests competing to be applied last. A monotonic nav-token additionally short-circuits any response that arrives after a newer navigation has settled, so a slow first request that races past its abort cannot revert the newer page.</p>

    <h2>Programmatic navigation</h2>
    <code-block>import { navigate } from '@webjsdev/core';

// Push history entry
await navigate('/about');

// Replace current history entry
await navigate('/login', { replace: true });

// Keep the reader's scroll offset (the twin of data-preserve-scroll)
await navigate('/products?sort=new', { scroll: false });</code-block>

    <h2>Refreshing the page you are on</h2>
    <p><code>refreshPage()</code> re-renders the <em>current</em> URL on the server and applies it in place, with no page load. It records no history entry and never scrolls, so the reader keeps their place and Back still goes to the previous page.</p>
    <code-block>import { refreshPage } from '@webjsdev/core';

// 'page' (the default): morph the deepest shared boundary
await refreshPage();

// 'shell': replace the whole body, for when the LAYOUT's own markup changed
await refreshPage('shell');</code-block>
    <p>The two modes differ in what survives. <code>'page'</code> morphs the deepest shared boundary, so the outer layout's DOM and the hydrated state of its components are preserved. <code>'shell'</code> replaces the whole body, which is what a layout change needs: a layout's own header, nav, and footer live outside every children range, so a boundary morph would leave them untouched. Component instances do not survive a <code>'shell'</code> refresh.</p>
    <p>A refresh sends no <code>X-Webjs-Have</code> header, deliberately. The server short-circuits at the first layout the client already holds, and a same-URL request matches every one of them, so the response would omit the very layout that changed. It resolves <code>false</code> when it did not apply (the router is disabled, or the fetch failed), so the caller can fall back to a full load.</p>
    <p>It does <strong>not</strong> reload changed component modules, and cannot: <code>customElements.define</code> is once-per-tag and a module URL is fetched once per document. That is exactly why the dev server calls <code>refreshPage()</code> for a page or layout edit and falls back to a full reload for a component edit. See <a href="/docs/runtime">Runtime</a> for which dev modes get the in-place refresh.</p>

    <h2>Opt-out per link / form</h2>
    <code-block>&lt;a href="/logout" data-no-router&gt;Log out&lt;/a&gt;
&lt;form action="/legacy" data-no-router&gt;...&lt;/form&gt;
&lt;form action="/x"&gt;&lt;button data-no-router&gt;Full reload&lt;/button&gt;&lt;/form&gt;</code-block>
    <p>Use <code>data-no-router</code> for:</p>
    <ul>
      <li><strong>Auth flows</strong>: <code>/logout</code>, <code>/auth/google</code>, OAuth redirect chains. A full reload wipes in-memory module state (cached user data, auth tokens) that an SPA-style swap would leave behind.</li>
      <li><strong>Print views / embed pages</strong>: anywhere you want a clean-slate render without the existing layout.</li>
      <li><strong>Experimental routes</strong> backed by a different client runtime that needs a full boot.</li>
    </ul>
    <p>To keep the router but skip its scroll-to-top, the attribute is <code>data-preserve-scroll</code> rather than this one. See <a href="#preserving-scroll">Preserving scroll on a forward navigation</a> above.</p>

    <h2>Auto-skipped (no <code>data-no-router</code> needed)</h2>
    <ul>
      <li>Cross-origin hrefs.</li>
      <li>Links with a <code>download</code> attribute, a <code>target</code> other than <code>_self</code>, or clicked with a modifier key (⌘/Ctrl/Shift/Alt).</li>
      <li>Pure hash fragments on the same page (browser jumps to the anchor).</li>
      <li>Hrefs whose path ends in a non-HTML extension: <code>.pdf</code>, <code>.zip</code>, <code>.json</code>, <code>.xml</code>, images, media, archives, documents.</li>
      <li>Responses whose <code>Content-Type</code> isn't <code>text/html</code>.</li>
    </ul>

    <h2>Loading indicator</h2>
    <p>The router can expose a <code>data-navigating</code> attribute on <code>&lt;html&gt;</code> during navigation (deferred 150ms, so quick sub-150ms navs never trigger it) for a subtle progress indicator. It is <strong>opt-in</strong>: add <code>data-webjs-nav-progress</code> to your <code>&lt;html&gt;</code> element to enable it. It stays off by default because toggling an attribute on the root re-resolves <code>oklch()</code> and <code>color-mix()</code> token values on WebKit (so every iOS browser), repainting them for one frame. On a token-driven theme that shows as a visible flash on a slow nav. Enable it only when your theme does not lean on wide-gamut color tokens, or drive your indicator off the <code>webjs:navigate</code> event instead.</p>
    <code-block>&lt;html data-webjs-nav-progress&gt; &lt;!-- opt in once, in your root layout --&gt;

html[data-navigating] {
  cursor: progress;
}
html[data-navigating]::after {
  content: '';
  position: fixed;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: var(--accent);
  animation: progress 1s ease-in-out infinite;
}</code-block>

    <h2>Listening for navigations</h2>
    <code-block>document.addEventListener('webjs:navigate', (e) =&gt; {
  console.log('Navigated to:', e.detail.url);
  // Track page view, update active nav indicator, etc.
});</code-block>

    <h2>Disabling the router entirely</h2>
    <code-block>import { disableClientRouter } from '@webjsdev/core/client-router';
disableClientRouter();</code-block>

    <h2>Next steps</h2>
    <ul>
      <li><a href="/docs/routing">Routing</a>: file-based route conventions</li>
      <li><a href="/docs/loading-states">Loading states</a>: <code>loading.ts</code> per segment</li>
      <li><a href="/docs/server-actions">Server actions</a>: for forms handled via JS / RPC</li>
      <li><a href="/docs/ssr">Server-Side Rendering</a>: the SSR pipeline that emits the markers this router walks</li>
    </ul>
  `;
}
