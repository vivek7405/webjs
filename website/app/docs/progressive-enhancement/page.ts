import { html } from '@webjsdev/core';

export const metadata = {
  title: 'Progressive Enhancement | WebJs',
  description:
    'WebJs pages and components are SSR\'d to real HTML. Read-paths, navigation, and form submissions work without JavaScript. JS is opt-in per interactive behavior: only the click / signal / focus handlers require scripts, not the component\'s first paint.',
};

export default function ProgressiveEnhancement() {
  return html`
    <h1>Progressive Enhancement</h1>

    <p>
      <strong>WebJs is HTML-first by design.</strong> Every page is server-rendered to real HTML. Every web component runs its <code>render()</code> on the server, so the component's initial markup is in the response before any script loads. With JavaScript disabled (slow networks, strict CSP, hostile proxies, user preference, ad-blockers, hydration races) the page still paints, content reads, links navigate, and forms submit.
    </p>

    <p>
      JavaScript is opt-in <em>per interactive behavior</em>, not per component. A counter custom element renders as "0" on the server, and only the +/- click handling needs JS. A dropdown renders its trigger and closed state on the server, and only the open/close toggle needs JS. The HTML is the floor, and <code>@click</code>, signal mutations, and the client router are layered on top.
    </p>

    <h2>What works without JavaScript</h2>

    <ul>
      <li><strong>Page rendering.</strong> Every <code>page.ts</code> runs on the server and emits HTML. Layouts, metadata, OG tags, the page body all arrive in the first response.</li>
      <li><strong>Custom elements' initial markup.</strong> Every web component's <code>render()</code> runs server-side. Light-DOM components serialize as direct children, and shadow-DOM components emit Declarative Shadow DOM so scoped styles paint before JS loads.</li>
      <li><strong>Navigation.</strong> <code>&lt;a href="..."&gt;</code> is a real link. The client router enhances it into a partial-swap when JS is active. With JS off, the browser performs a standard navigation.</li>
      <li><strong>Form submissions (write-paths).</strong> Server actions are reachable as plain HTML form POSTs:
        <pre>&lt;form action="/actions/createPost" method="post"&gt;
  &lt;input name="title"&gt;
  &lt;textarea name="body"&gt;&lt;/textarea&gt;
  &lt;button type="submit"&gt;Save&lt;/button&gt;
&lt;/form&gt;</pre>
        Submitting this form works whether or not JavaScript is enabled. The client router upgrades it to a partial-swap submission when active.
      </li>
      <li><strong>CSS-driven interactivity.</strong> Hover, focus, <code>:checked</code>, <code>:target</code>, <code>&lt;details&gt;</code>/<code>&lt;summary&gt;</code>, native dropdowns (<code>&lt;select&gt;</code>) all work without JS by construction.</li>
      <li><strong>Suspense fallbacks.</strong> The fallback HTML is in the first chunk of the response. Without JS, the user sees the fallback content and won't see streamed-in updates, but the page is never blank.</li>
      <li><strong>Streaming-injected modulepreload hints.</strong> The server emits <code>&lt;link rel="modulepreload"&gt;</code> for every module the page needs. With JS off, those preloads are simply ignored.</li>
    </ul>

    <h2>What needs JavaScript</h2>

    <p>
      Only behaviors that <em>respond</em> to user input or update state in place:
    </p>

    <ul>
      <li><strong><code>@click</code> / <code>@input</code> / <code>@change</code> handlers on custom elements.</strong> The button is in the HTML, the handler isn't.</li>
      <li><strong>Signal updates and reactive re-renders.</strong> A counter starts at its server-rendered value; counting up calls <code>signal.set()</code>, which the component's built-in SignalWatcher picks up and re-renders.</li>
      <li><strong>Client-router partial-swap navigation.</strong> With JS off, links still navigate, they just trigger a full-page load instead of a swap. UX degrades to the standard browser experience.</li>
      <li><strong>Suspense streaming.</strong> The fallback paints without JS, but streamed-in updates need scripts to be applied.</li>
      <li><strong>WebSockets.</strong> No fallback; if you need realtime, you need JS.</li>
    </ul>

    <p>
      Notice the asymmetry: <em>showing</em> things works without JS, while <em>reacting</em> to user input or external events requires it. This is the right asymmetry for the web platform.
    </p>

    <h2>Display-only components ship zero JavaScript</h2>

    <p>
      WebJs takes the asymmetry one step further. A component whose <code>render()</code> is a pure function of its inputs, with no <code>@event</code> handler, no non-<code>state</code> reactive property, no overridden lifecycle hook, no signal or <code>Task</code>, no <code>&lt;slot&gt;</code>, produces identical HTML whether or not its module ever reaches the browser. So the framework detects these statically and <strong>strips their import from the served page</strong>. The module is never downloaded, and any npm package imported only by display-only components (an icon set, a date formatter) drops out of the importmap.
    </p>

    <p>
      This is automatic. There is no opt-in keyword and no server-versus-client split to reason about: the same component file is isomorphic, the framework just notices that its browser half would be dead weight. The analysis is deliberately conservative, so anything it cannot prove inert keeps shipping normally. A false "ship" only costs a few bytes; it never breaks behavior.
    </p>

    <p>
      <strong>One boundary to know.</strong> Eliding a module means its <code>customElements.define</code> never runs in the browser, so the tag stays an un-upgraded element. That is invisible for a tag that exists only as server-rendered markup, but it would matter if shipping client code observes the registration. The framework <strong>detects the statically visible forms of that observation</strong>, a literal <code>customElements.whenDefined('the-tag')</code>, a CSS <code>the-tag:defined</code> rule, or an <code>instanceof TheClass</code> check anywhere in your code, and automatically ships the observed component instead of eliding it. You only need to act in the cases static analysis cannot see: a tag name built from a dynamic / interpolated string, or a <code>:defined</code> rule in an external stylesheet outside the module graph. There, give the component an interactivity signal (an <code>@event</code>, a non-<code>state</code> reactive property, or a lifecycle hook) so it ships. This is rare in idiomatic webjs, where display-only elements are read as plain server-rendered markup.
    </p>

    <p>
      The same applies to whole routes. A <code>page</code> or <code>layout</code> that does no client work, even transitively (no event, signal, client router, npm import, client global, or interactive component anywhere in its subtree), is dropped from the boot script entirely, so a fully-static route ships <em>zero</em> application JavaScript and is pure server-rendered HTML. It still navigates and submits forms via native browser behavior, which is exactly the progressive-enhancement baseline. A layout that only carries interactive components is import-only, so it drops too and the boot emits those components directly; the client router rides along automatically when any of them loads <code>@webjsdev/core</code>.
    </p>
    <p>
      To keep this working, treat a <code>page</code> / <code>layout</code> as a pure carrier: its only browser-relevant job should be registering the components it imports. It starts shipping its own module the moment its closure does some OTHER client work, which is invisible in tests because it is an elision verdict, not a behavior change. So avoid module-scope client work in a page/layout (a top-level call, a <code>window</code> / <code>document</code> access, a <code>@webjsdev/core/client-router</code> import; routing is automatic) and avoid importing a non-component utility that touches a client global. Put client behavior in a component and server-only code in a <code>.server.&#123;js,ts&#125;</code> file. The verdict is path-aware: client work reached only <em>through</em> a component the page imports (say a shared module-scope signal the component uses) does not pin the page, because the emitted component carries it; only a component-free path from the page to client work ships the page whole. The quick check: <code>page.ts</code> / <code>layout.ts</code> should not appear in the browser's network tab.
    </p>

    <p>
      It is the no-build framework's answer to dead-JavaScript-on-the-wire elimination, the one benefit React Server Components offer that a progressive-enhancement framework would otherwise lack, achieved here without a bundler, a Flight protocol, or a new mental model. (And it really is just an optimization on isomorphic modules, not an RSC-style server/client split, see <a href="/docs/architecture">Architecture</a>.)
    </p>

    <pre>// Elided: pure render, no interactivity. SSR'd HTML is the whole story,
// the browser never downloads this module.
class Badge extends WebComponent {
  render() { return html\`&lt;span class="badge"&gt;verified&lt;/span&gt;\`; }
}
Badge.register('status-badge');

// Shipped: a single @click makes it interactive, so its JS is fetched.
class Counter extends WebComponent {
  render() { return html\`&lt;button @click=\${'${() => this.inc()}'}&gt;+&lt;/button&gt;\`; }
}
Counter.register('my-counter');</pre>

    <h3>Where your npm packages run</h3>
    <p>An npm package reaches the browser when a module that loads on the client imports it (the boot script loads page/layout modules and the components they register; loading a module runs its <code>import</code> statements). So:</p>
    <ul>
      <li><strong>Server-only dependency</strong> (a date library you only use during SSR): put it behind <code>.server.{js,ts}</code> for a guaranteed-off-the-client result. It also drops automatically if it's used only inside a fully static page/component that gets elided, but the <code>.server</code> boundary is the explicit, always-correct choice.</li>
      <li><strong>Client-only package</strong> (analytics, a polyfill) on a page with no other interactivity: just import it. A <em>side-effect</em> import (<code>import 'analytics'</code>) or a guarded <code>window</code> init counts as client work, so the page keeps shipping and the package loads. You do not need a <code>'use client'</code>-style annotation, the import itself is the signal.</li>
    </ul>
    <p>The distinction the framework draws is "does this module do top-level client work?", not "does it import an npm package." A package used only as a value inside a page's body or a display-only component's <code>render</code> never executes on the client, so it rides away when that inert module is elided.</p>

    <h2>The design rules</h2>

    <p>
      Build features so the first paint is the right content, and JavaScript only adds reactivity on top.
    </p>

    <h3>1. Use real <code>&lt;a&gt;</code> for navigation</h3>

    <p>
      Don't write JS-only click handlers for routing.
    </p>

    <pre>// ✅ works without JS, and the router enhances it
&lt;a href="/posts/${'${post.id}'}"&gt;${'${post.title}'}&lt;/a&gt;

// ❌ requires JS to navigate
&lt;button @click=${'${() => router.push(`/posts/${post.id}`)}'}&gt;
  ${'${post.title}'}
&lt;/button&gt;</pre>

    <h3>2. Use <code>&lt;form&gt;</code> + a page action for writes</h3>

    <p>
      A <code>page.ts</code> may export an <code>action</code> alongside its default render function. A non-GET <code>&lt;form&gt;</code> submission to the page's own URL runs the action, which returns an <code>ActionResult</code>. It works as a plain HTML POST when JS is off, and as a partial-swap submission when JS is on. <strong>One piece of code covers both ends of the spectrum, and no form library is involved.</strong>
    </p>

    <p>
      The action validates on the server, then returns one of two outcomes. A <strong>success</strong> result is a <code>303 See Other</code> to <code>result.redirect</code> (Post/Redirect/Get). A <strong>failure</strong> result re-SSRs the same page at <code>422</code> with the result on <code>ctx.actionData</code>, so the page repopulates the fields from <code>actionData.values</code> and shows the messages from <code>actionData.fieldErrors</code>.
    </p>

    <pre>// app/posts/page.ts
import { html } from '@webjsdev/core';
import { createPost } from '#modules/posts/actions/create-post.server.ts';

// runs only on the server, receives the already-parsed formData
export async function action({ formData }: { formData: FormData }) {
  const title = String(formData.get('title') || '').trim();
  const body = String(formData.get('body') || '').trim();
  const values = { title, body };
  if (!title) {
    return { success: false, fieldErrors: { title: 'Title is required' }, values, status: 422 };
  }
  const post = await createPost({ title, body });
  return { success: true, redirect: \`/posts/\${post.id}\` };
}

export default function NewPost({ actionData }: {
  actionData?: { fieldErrors?: Record&lt;string, string&gt;; values?: Record&lt;string, string&gt; };
}) {
  const errors = actionData?.fieldErrors || {};
  const values = actionData?.values || {};
  return html\`
    &lt;form method="POST"&gt;
      &lt;input name="title" value=\${values.title || ''} required&gt;
      \${errors.title ? html\`&lt;p class="error"&gt;\${errors.title}&lt;/p&gt;\` : ''}
      &lt;textarea name="body" required&gt;\${values.body || ''}&lt;/textarea&gt;
      &lt;button type="submit"&gt;Publish&lt;/button&gt;
    &lt;/form&gt;
  \`;
}</pre>

    <p>
      With JS off the browser submits, follows the 303, or renders the 422. With JS on the client router applies the 422 in place (no reload, typed input preserved) and follows the 303 via fetch. Avoid the pattern of <code>fetch('/api/...')</code> + a click handler for write-paths. That's JS-required by construction.
    </p>

    <h3>3. Make components render correctly on the server</h3>

    <p>
      The component's <code>render()</code> output must be the right HTML, not a placeholder waiting for hydration. Bad:
    </p>

    <pre>// ❌ first paint is empty, relies on hydration
class PostList extends WebComponent {
  posts = [];
  render() { return html\`&lt;ul&gt;${'${this.posts.map(...)}'}&lt;/ul&gt;\`; }
  async firstUpdated() {
    this.posts = await fetchPosts();   // ← only runs in browser
    this.requestUpdate();
  }
}</pre>

    <p>Good. Fetch on the server, render with real data, no client roundtrip:</p>

    <pre>// ✅ first paint has the data
// app/posts/page.ts
import { listPosts } from '#modules/posts/queries/list-posts.server.ts';
export default async function Posts() {
  const posts = await listPosts();
  return html\`&lt;post-list .posts=\${posts}&gt;&lt;/post-list&gt;\`;
}</pre>

    <h3>4. Don't gate read-paths on hydration</h3>

    <p>
      Static content (text, images, links, lists, marketing sections, layouts) should be plain HTML or a function returning an <code>html\`\`</code> template, not a custom element. Custom elements are for when you need <em>state</em> or <em>lifecycle</em>. If your component has no <code>@click</code>, no signal mutation, and no <code>firstUpdated()</code> doing anything, it should probably be a plain function.
    </p>

    <h3>5. Use <code>&lt;form&gt;</code>'s built-in validation before reaching for JS</h3>

    <p>
      <code>required</code>, <code>pattern</code>, <code>min</code>/<code>max</code>, <code>type="email"</code>, <code>type="url"</code> are all enforced by the browser without JS. Add custom JS validation only when these aren't enough.
    </p>

    <h3>6. Set SSR-meaningful defaults in the <em>constructor</em>, not <code>connectedCallback</code></h3>

    <p>
      The SSR pipeline constructs each web component (<code>new Cls()</code>), applies its attributes, runs <code>willUpdate</code> and controllers' <code>hostUpdate</code>, reflects <code>reflect: true</code> properties, and calls <code>render()</code>. <strong>It does <em>not</em> call <code>connectedCallback</code>, <code>firstUpdated</code>, <code>updated</code>, or any browser-only hook.</strong> Those run only in the browser, after the script loads. Whatever state your component should display on first paint must be set in the constructor, derived in <code>willUpdate</code>, or be derivable from the factory's reactive properties on the element's attributes.
    </p>

    <pre>// ❌ first paint is empty, initial state set in browser-only hook
class Cart extends WebComponent({ items: prop&lt;Item[]&gt;(Array) }) {
  connectedCallback() {                       // ← server never runs this
    super.connectedCallback();
    this.items = readFromLocalStorage();
    this.requestUpdate();
  }

  render() { return html\`&lt;ul&gt;${'${this.items.map(...)}'}&lt;/ul&gt;\`; }
}</pre>

    <pre>// ✅ SSR-safe: sensible default in the constructor, browser hook
//    refines it after hydration
class Cart extends WebComponent {
  items = signal&lt;Item[]&gt;([]);                  // ← SSR uses this

  connectedCallback() {
    super.connectedCallback();
    const stored = readFromLocalStorage();
    if (stored) this.items.set(stored);         // browser-only refinement
  }

  render() { return html\`&lt;ul&gt;${'${this.items.get().map(...)}'}&lt;/ul&gt;\`; }
}</pre>

    <p>
      For data that genuinely can't be known on the server (a user's <code>localStorage</code>, viewport size, online status, time zone, theme preference), one of three patterns works:
    </p>

    <ul>
      <li><strong>Sensible default + browser refinement.</strong> The instance signal's initial value (<code>[]</code>, <code>'system'</code>, empty) is what SSR renders. <code>connectedCallback</code> reads the browser-only source and writes the signal. Accept that the first paint may flash from the default to the real value once JS arrives. Often fine.</li>
      <li><strong>Synchronous bootstrap script.</strong> If the flash is unacceptable (theme color, RTL direction), emit a tiny inline <code>&lt;script&gt;</code> in the layout's <code>&lt;head&gt;</code> that reads <code>localStorage</code> and writes the value to <code>document.documentElement</code> (e.g. <code>data-theme</code> attribute). CSS reads from that attribute, so the page renders with the correct value before the component upgrades. This is how <code>&lt;theme-toggle&gt;</code> works in this docs site.</li>
      <li><strong>Send it from the server.</strong> If the data is available via a cookie or the request (session, accept-language), read it in the page function and pass it as an attribute or property on the component. The SSR pipeline applies attributes before <code>render()</code>, so the first paint has the right value.</li>
    </ul>

    <h2>Testing: run with JavaScript disabled</h2>

    <p>
      Before marking a feature done, exercise the user's read + write paths with JS turned off. In Chrome DevTools: <strong>Settings → Debugger → "Disable JavaScript"</strong>. Then:
    </p>

    <ul>
      <li>Reload the page. Content should paint. Look for an empty container, a stuck loading skeleton, or a JS-rendered widget showing nothing. Those indicate a hydration-dependent first paint.</li>
      <li>Navigate via the page's links. Each should produce a full page load that lands on the right URL.</li>
      <li>Submit each form. Each should POST to its action URL and render the resulting page.</li>
      <li>Interactive widgets (counters, dropdowns) won't react. That's expected and fine. The widget's <em>initial</em> state should still be visible.</li>
    </ul>

    <p>
      A green run here means your feature degrades correctly. Your users on flaky networks, strict CSP, and Chrome's "data saver" mode will thank you.
    </p>

    <h2>Why this matters</h2>

    <ul>
      <li><strong>Resilience.</strong> Scripts can fail to load, be blocked, or hang. Networks drop. Edges return JS-stripped HTML through aggressive CDN transforms. With HTML-first, your page survives all of it.</li>
      <li><strong>Performance.</strong> Time-to-first-content is determined by HTML, not by waiting for a JS bundle to parse and execute. Even with JS available, the user reads earlier.</li>
      <li><strong>SEO and link previews.</strong> Crawlers and link-preview generators see real content, not a JS shell. Open Graph, Twitter cards, Discord embeds all just work.</li>
      <li><strong>Accessibility.</strong> Real <code>&lt;a&gt;</code> and real <code>&lt;form&gt;</code> elements come with keyboard, screen-reader, and assistive-tech support out of the box. Reinvented JS-only equivalents almost never do.</li>
      <li><strong>Composability.</strong> Server actions can be called via RPC <em>and</em> via plain HTML forms with the same code. Routes work via the client router <em>and</em> via plain browser navigation with the same URLs. One implementation, two ends of the progressive-enhancement spectrum.</li>
    </ul>

    <p>
      Progressive enhancement isn't a feature you enable in WebJs. It's the architecture. <a href="/docs/architecture">Architecture</a> walks through how the request lifecycle produces HTML-first responses. <a href="/docs/server-actions">Server Actions</a> shows the form-first pattern. <a href="/docs/client-router">Client Router</a> shows how the SPA-style transitions enhance plain links and forms.
    </p>
  `;
}
