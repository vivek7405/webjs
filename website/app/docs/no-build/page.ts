import { html } from '@webjsdev/core';

export const metadata = { title: 'No-Build Model | WebJs' };

export default function NoBuild() {
  return html`
    <h1>No-Build Model</h1>
    <p>WebJs has no bundler, no <code>webjs build</code> command, no output directory. The <code>.js</code> and <code>.ts</code> files you edit are the files the browser fetches. <code>npm run dev</code> and <code>npm run start</code> run the same source. This page is the canonical reference for how it works in practice and why per-file ESM at production scale is competitive with bundling.</p>

    <p>Related reading:</p>
    <ul>
      <li><a href="/docs/typescript">TypeScript</a> covers the type stripper in detail.</li>
      <li><a href="/docs/deployment">Deployment</a> covers HTTP/2 termination, reverse proxies, and Docker.</li>
      <li><a href="/docs/architecture">Architecture</a> covers the request lifecycle at a higher level.</li>
    </ul>

    <h2>The model</h2>
    <p>WebJs serves source as native ES modules over HTTP. The browser walks the import graph one file at a time, the server transforms each file lazily on first request, and an in-memory cache keyed by mtime makes subsequent requests instant. There is no concatenation, no minification, no chunk graph, no "prepare for production" phase. The Rails 7+ <a href="https://github.com/rails/importmap-rails">importmap-rails</a> + Hotwire pipeline is the closest analogue.</p>

    <table>
      <thead>
        <tr><th>Question</th><th>Answer</th></tr>
      </thead>
      <tbody>
        <tr><td>Is there a build step I run?</td><td>No. <code>npm run dev</code> and <code>npm run start</code> serve source directly.</td></tr>
        <tr><td>Is there a build step the framework runs?</td><td>Per-file type stripping for <code>.ts</code>, on first request, cached by mtime. That is the only transform.</td></tr>
        <tr><td>What about npm packages?</td><td>Resolved as one consistent graph via jspm.io on first reference. See <strong>Bare specifiers</strong> below.</td></tr>
        <tr><td>How does the browser resolve <code>import '@webjsdev/core'</code>?</td><td>An <code>&lt;script type="importmap"&gt;</code> emitted in <code>&lt;head&gt;</code> maps the specifier to a URL.</td></tr>
        <tr><td>Won't N small files be slow?</td><td>HTTP/2 multiplex makes per-file serving competitive with bundling. SSR-time modulepreload hints make it parallel.</td></tr>
        <tr><td>What does this gain me?</td><td>What you read is what runs. Granular cache invalidation. Zero build-config files. Edit-and-refresh dev loop.</td></tr>
      </tbody>
    </table>

    <h2>Request lifecycle (per JS file)</h2>
    <ol>
      <li>Browser parses HTML, finds <code>&lt;script type="module" src="/app/page.ts"&gt;</code> (or follows an <code>import</code> from one that was already loaded).</li>
      <li>Server receives the request. Reads the file from disk.</li>
      <li>If the file is <code>.ts</code> / <code>.mts</code>, runs the runtime's stripper: Node 24+'s built-in <code>module.stripTypeScriptTypes</code>, or <code>amaro</code> on Bun (byte-identical). This is whitespace replacement: every <code>(line, column)</code> in the source maps to the same position in the output, so no sourcemap is needed and stack traces are byte-exact. Only erasable TypeScript is supported. <code>enum</code>, <code>namespace</code> with values, parameter properties, legacy decorators, and <code>import = require</code> fail at strip time and the dev server returns a 500 naming the file. The scaffolded <code>tsconfig.json</code> turns on <code>erasableSyntaxOnly: true</code> by default so the compiler rejects these in your own code at edit time. Almost no npm package ships <code>.ts</code> source anyway: published packages compile to <code>.js</code> with sidecar <code>.d.ts</code> type files, which the runtime serves as plain JavaScript with no transform.</li>
      <li>Result is cached in memory keyed by <code>(absolute path, mtime)</code>. A file edit invalidates naturally.</li>
      <li>Response is served as <code>application/javascript</code> with appropriate cache headers. In dev: <code>no-cache</code> (always revalidate, so an edit shows up immediately). In prod: a request that carries the content-hash <code>?v=&lt;digest&gt;</code> query the framework emits (see below) is served <code>public, max-age=31536000, immutable</code>; a bare un-fingerprinted request falls back to <code>public, max-age=3600</code>. Either way a weak ETag rides along for conditional GET.</li>
      <li>Browser executes the module, encounters its imports, repeat from step 1 for each.</li>
    </ol>

    <h2>The importmap</h2>
    <p>An <code>&lt;script type="importmap"&gt;</code> is emitted in every SSR response's <code>&lt;head&gt;</code>. It tells the browser how to resolve every bare specifier (anything that isn't a relative <code>./foo</code> or absolute <code>/bar</code>) to a real URL. WebJs ships a minimal map and extends it dynamically as your app references new npm packages:</p>
    <pre>&lt;script type="importmap"&gt;
{
  "imports": {
    "@webjsdev/core":               "/__webjs/core/index-browser.js",
    "@webjsdev/core/":              "/__webjs/core/src/",
    "@webjsdev/core/client-router": "/__webjs/core/src/router-client.js",
    "@webjsdev/core/directives":    "/__webjs/core/src/directives.js",
    "@webjsdev/core/context":       "/__webjs/core/src/context.js",
    "@webjsdev/core/task":          "/__webjs/core/src/task.js",
    "@webjsdev/core/testing":       "/__webjs/core/src/testing.js",
    "@webjsdev/core/lazy-loader":   "/__webjs/core/src/lazy-loader.js",
    "dayjs":                        "https://ga.jspm.io/npm:dayjs@1.11.13/dayjs.min.js",
    "zod":                          "https://ga.jspm.io/npm:zod@3.23.8/lib/index.mjs"
  }
}
&lt;/script&gt;</pre>
    <p>The browser resolves every <code>import 'dayjs'</code> through this map. You never write a build config that says "alias dayjs to its dist file". The framework owns the registry, you write idiomatic ESM.</p>

    <h2>Module graph and modulepreload hints</h2>
    <p>At server startup, WebJs walks your app source and builds an in-memory graph of <code>file → Set&lt;imported files&gt;</code>. The walker parses <code>import</code> statements with a regex, resolves relative paths, and records every edge. Bare specifiers (npm deps) are not in the app graph, but the exact specifier is recorded as a separate <em>vendor edge</em> so reached npm dependencies can also be preloaded (see below).</p>
    <p>When the SSR pipeline renders a page, it computes the components on that page plus their transitive dependencies, and emits one <code>&lt;link rel="modulepreload"&gt;</code> per file:</p>
    <pre>&lt;link rel="modulepreload" href="/app/page.ts"&gt;
&lt;link rel="modulepreload" href="/components/post-card.ts"&gt;
&lt;link rel="modulepreload" href="/components/avatar.ts"&gt;
&lt;link rel="modulepreload" href="/lib/format-date.ts"&gt;</pre>
    <p>This converts a sequential <code>import</code> waterfall into a parallel fetch. The browser fires every request as soon as the HTML head is parsed, well before <code>&lt;script type="module"&gt;</code> at the bottom would have discovered them.</p>
    <h3>npm vendor dependencies are preloaded too</h3>
    <p>The same hinting extends to the npm packages your shipped modules import. WebJs emits a <code>&lt;link rel="modulepreload"&gt;</code> for each reached vendor URL (carrying its SRI <code>integrity</code> and <code>crossorigin</code>), byte-identical to the importmap target so the browser never double-fetches:</p>
    <pre>&lt;link rel="modulepreload" href="https://ga.jspm.io/npm:dayjs@1/dayjs.min.js" crossorigin integrity="sha384-…"&gt;</pre>
    <p>Only <strong>reached</strong> vendors are hinted: a package imported solely by a display-only (elided) component, or pinned but never imported, is left out, so this never over-fetches.</p>
    <p><strong>The honest caveat vs a bundle.</strong> This flattens the <em>first</em> level of the vendor graph (the packages your code imports directly). A vendor's own transitive dependencies are still discovered by parsing each fetched CDN module in turn, level by level, over the cross-origin connection, which is exactly the waterfall a bundler eliminates. So the complementary practice is <strong>shallow-dependency discipline</strong>: prefer few, shallow ESM dependencies. A library with a flat or one-level graph fully benefits; a deep tree still waterfalls past the first level.</p>
    <p>Server-only modules (filename matches <code>.server.{js,ts}</code> or content has a <code>'use server'</code> directive) are excluded from preload hints, and the dependency walk <strong>stops at</strong> them: a plain module reached only through a server file (a util that a server action imports) is excluded too. The browser only ever fetches the action's RPC stub, never the server file's own imports, so the preload set is exactly the set the page actually fetches. None of it reaches the browser as source. Lazy components (<code>static lazy = true</code>) are also excluded, since they load on viewport entry via IntersectionObserver, not page load.</p>
    <p><strong>Display-only components are excluded too, and not just from preloads.</strong> A component whose <code>render()</code> is a pure function of its inputs (no <code>@event</code> handler, no non-<code>state</code> reactive property, no overridden lifecycle hook, no signal / <code>Task</code> / streaming directive, no <code>&lt;slot&gt;</code>) does no client-side work, so its SSR'd HTML is the complete output. The server detects this statically and strips its side-effect import from the served page source, so the browser never downloads the module at all, and any npm package imported only by display-only components drops out of the importmap. This is the no-build equivalent of React Server Components' dead-JS elimination, with no bundler and no server/client directive. The analysis is conservative: anything it cannot prove inert keeps shipping. See <a href="/docs/progressive-enhancement">Progressive Enhancement</a>.</p>

    <h3>The module graph is also the authorisation gate</h3>
    <p>The same graph drives a second purpose: deciding which URLs the dev server is allowed to serve as source. Only files reachable from a page / layout / error / loading / not-found / component entry are servable; everything else 404s before any filesystem operation. This is webjs's equivalent of Next.js's bundler-derived page manifest, computed statically (lazily on the first request, memoized, and re-derived after each <code>fs.watch</code> rebuild) instead of via a build step. The server boots without walking the import graph at all; the first request builds it.</p>
    <p>Concretely: <code>GET /package.json</code>, <code>GET /node_modules/&lt;pkg&gt;/index.js</code>, <code>GET /scripts/build.js</code>, and any other file no client code imports return 404 by construction. The model is convention-neutral; if a page imports from <code>src/</code> or <code>features/</code>, those dirs become servable automatically. No <code>servedDirs</code> config to maintain.</p>
    <p>The walk follows static <code>import</code> / <code>export … from</code> edges AND string-literal dynamic imports, so <code>await import('./widget.ts')</code> of an app module is servable (fetched lazily at call time, not eagerly preloaded, because a dynamic import is lazy by intent). A computed specifier (<code>import('./pages/' + name + '.ts')</code>) cannot be resolved statically, so its target is not in the gate and 404s; in dev the 404 carries a hint pointing at the cause and recommending a string-literal import. If you need a computed set of modules client-side, give them a static import map (an object literal of <code>{ name: () =&gt; import('./pages/name.ts') }</code>) so each branch is a string-literal edge the gate can see.</p>
    <p>The <code>.server.{js,ts}</code> stub guardrail still runs as defense in depth: a server file that <em>does</em> reach the gate (because client code imports it for the RPC stub) gets stubbed at request time so its source never crosses the wire.</p>
    <p>The graph walker also stops AT server-file boundaries. Files imported only by a <code>.server.{js,ts}</code> file stay out of the gate, since the browser only ever sees the stub for the server file, never its transitive imports. A <code>lib/secrets.ts</code> consumed only by a server action is unreachable to direct URL fetches; a <code>lib/format.ts</code> consumed by both a page and a server action stays reachable through the page edge. Same posture as Next.js, where server-component code lands in separate chunks the client bundle never references.</p>

    <h2>103 Early Hints</h2>
    <p>In production, when a GET or HEAD request matches a page route, WebJs sends a <code>103 Early Hints</code> response <em>before</em> SSR begins. The hints carry <code>Link: &lt;url&gt;; rel=modulepreload</code> headers for the page's modules:</p>
    <pre>HTTP/1.1 103 Early Hints
Link: &lt;/app/page.ts&gt;; rel=modulepreload
Link: &lt;/components/post-card.ts&gt;; rel=modulepreload
...

HTTP/1.1 200 OK
Content-Type: text/html
...</pre>
    <p>The browser starts fetching JS modules while the server is still rendering HTML. By the time the document parser reaches the import statements, those files are already in cache. Most major edges (Cloudflare, fly-proxy, Fastly) forward 103 responses to the client. Early Hints are disabled in dev because file churn could send stale URLs before a rebuild.</p>

    <h2>Bare specifiers (npm packages)</h2>
    <p>The browser can't resolve <code>import dayjs from 'dayjs'</code> on its own. WebJs follows the Rails 7 + <code>importmap-rails</code> posture: bare specifiers resolve through an importmap to <strong>jspm.io</strong> CDN URLs, and the browser fetches the bundle directly from jspm.io. The WebJs server doesn't bundle, cache, or proxy vendor packages.</p>
    <ol>
      <li>Scan every <code>.js</code> / <code>.ts</code> file under the app for bare import specifiers (skipping <code>node_modules</code>, <code>.server.{js,ts}</code> files, <code>route.{js,ts}</code> / <code>middleware.{js,ts}</code>, <code>test/</code>, <code>'use server'</code> modules, type-only imports, and imports inside comments).</li>
      <li>For each discovered package, resolve the installed version from <code>node_modules/&lt;pkg&gt;/package.json</code>.</li>
      <li>Call <code>api.jspm.io/generate</code> once on the first request with the full install list as a single batch (e.g. <code>['dayjs@1.11.13', 'zod@3.23.8']</code>), so jspm.io resolves the whole set as one mutually-consistent graph. A directly-imported package and a transitive that needs a newer version of the same package agree on one URL, instead of skewing. jspm.io returns a fully-resolved importmap fragment with correct entry paths. If one install can't be resolved (a private or server-only dep), WebJs falls back to resolving the rest so one bad package never collapses the whole map.</li>
      <li>Emit those URLs verbatim in the page's <code>&lt;script type="importmap"&gt;</code>. Browser fetches directly from <code>ga.jspm.io</code>; webjs's server is never on the vendor-bytes path.</li>
    </ol>
    <p>Native modules and server-only packages (<code>node:*</code>, <code>pg</code>) are filtered out by the scanner (they're imported only from <code>.server.{js,ts}</code> / <code>route.{js,ts}</code> / <code>middleware.{js,ts}</code> files, which the scanner skips). Server packages never reach the browser.</p>
    <p><strong>Coherence is also verified as a check, not only at resolution.</strong> Resolving the whole install set as one batch (above) produces a coherent graph, but a hand-edited importmap or a partial vendor pin can still skew a transitive version. <code>webjs doctor</code> runs an <code>importmap-coherence</code> check that validates every resolved client dep's declared dependency/peer ranges against the versions actually pinned (including the generated <code>.webjs/vendor/importmap.json</code>), and names the conflicting packages, the required range, and the pinned version when they disagree. So a broken graph is caught before the browser runs it.</p>

    <h2>Optional: commit resolved URLs via <code>webjs vendor pin</code></h2>
    <p>By default the <code>api.jspm.io/generate</code> call happens once on the first request (memoized for the process), never at boot. To skip it entirely (no runtime dependency on jspm.io's API), run <code>webjs vendor pin</code>:</p>
    <pre>$ webjs vendor pin
Pinning vendor packages from /home/me/my-app...
  dayjs@1.11.13
  zod@3.23.8
Pinned 2 packages, wrote .webjs/vendor/importmap.json.</pre>
    <p>This writes <code>.webjs/vendor/importmap.json</code> with the resolved jspm.io URLs. Commit the file to source control. The server reads it from disk on the first request (memoized for the process), never at boot; no <code>api.jspm.io</code> call needed.</p>
    <p>The pin output is meant to be committed, so <code>webjs vendor pin</code> keeps it committable for you. The scaffold's <code>.gitignore</code> already excludes the transient <code>.webjs</code> caches (the generated <code>routes.d.ts</code>) while un-ignoring <code>.webjs/vendor/</code>, so a fresh app needs nothing. If your <code>.gitignore</code> would swallow the pins (for example an older or hand-edited one with a blanket <code>.webjs/</code> line), pinning adds the <code>!.webjs/vendor/</code> exception for you and tells you to <code>git add .gitignore .webjs/vendor</code>. When the exclusion lives somewhere it cannot patch (a parent repo's <code>.gitignore</code>, or <code>.git/info/exclude</code>), it prints a one-line notice with the exact lines to add instead. A no-vendor app, which never runs this command, is untouched.</p>
    <p>For offline-capable production (compliance, air-gapped, strict CSP), add <code>--download</code>:</p>
    <pre>$ webjs vendor pin --download
Pinning vendor packages from /home/me/my-app (downloading bundles)...
  dayjs@1.11.13                            8.2 KB
  zod@3.23.8                               12.5 KB
Pinned 2 packages, wrote .webjs/vendor/importmap.json + 2 bundles.</pre>
    <p>This downloads each bundle from jspm.io to <code>.webjs/vendor/&lt;pkg&gt;@&lt;version&gt;.js</code>. The importmap then points at local <code>/__webjs/vendor/&lt;file&gt;.js</code> URLs; the server serves the committed bundle files. Browser never touches jspm.io at runtime; works fully offline.</p>
    <p>Pin is intentionally manual (no <code>predev</code>/<code>prestart</code> auto-run). Auto-pin would cause silent churn in the committed importmap.json as jspm.io resolves URLs or transitive deps drift. Rails takes the same posture: <code>bin/importmap pin</code> is always developer-invoked.</p>
    <p><code>sha384</code> SRI integrity is on by default, with OR without a pin file. An unpinned (live-resolved) app hashes each cross-origin bundle at warmup and the SSR pipeline stamps the matching hash on each <code>&lt;link rel="modulepreload"&gt;</code> and on the importmap entry itself, so the browser refuses to execute a bundle whose bytes don't match (CDN compromise defense), even before you pin. The live hashing is bounded and fail-open: if a bundle fetch fails (a CDN hiccup), that one URL simply loads without integrity (logged once) and the app still boots. Running <code>webjs vendor pin</code> makes the hashes reproducible and removes the warmup fetch: it writes them alongside the imports in <code>importmap.json</code> under an <code>integrity</code> key (both <code>webjs vendor pin</code> and <code>--download</code> populate it), so the hashes only update when the command is rerun and routine cache-busting cannot drop them.</p>

    <h2>Switch CDN with <code>--from</code></h2>
    <p>If jspm.io has an incident, or you want jsdelivr-served packages, pass a different resolver:</p>
    <pre>$ webjs vendor pin --from jsdelivr
Pinning vendor packages from /home/me/my-app via jsdelivr...</pre>
    <p>Accepts <code>jspm</code> (default), <code>jsdelivr</code>, <code>unpkg</code>, or <code>skypack</code>. Same shape as Rails's <code>bin/importmap pin foo --from jsdelivr</code>. The chosen resolver is persisted in <code>importmap.json</code> as a <code>provider</code> sibling field so <code>webjs vendor update</code> targets the same CDN.</p>

    <h2>Maintenance commands</h2>
    <p>For pinned packages, three commands stand in for <code>npm audit</code> / <code>npm outdated</code> / <code>npm update</code>:</p>
    <pre>$ webjs vendor audit
$ webjs vendor outdated
$ webjs vendor update</pre>
    <p><code>audit</code> POSTs your pinned versions to the same <code>registry.npmjs.org/-/npm/v1/security/advisories/bulk</code> endpoint <code>npm audit</code> uses, prints any CVEs, and exits non-zero on findings so CI can gate. <code>outdated</code> queries each pinned package's <code>dist-tags.latest</code> and lists what trails. <code>update</code> re-pins every outdated package to its latest, recomputes SRI, and writes the new pin file (you still run <code>npm install &lt;pkg&gt;@&lt;latest&gt;</code> afterward to sync your <code>node_modules</code>).</p>

    <h2>A heavy client-only library (WebGL, canvas, a big imperative module)</h2>
    <p>A WebGL scene, a canvas visualization, or any large imperative third-party module (a physics engine, a map renderer) is client-only and must never run at SSR, and with no build step it rides the importmap instead of a bundler. The idiomatic pattern is one path, four parts:</p>
    <ol>
      <li><strong>A component SSRs a bare placeholder and boots the engine in the browser only.</strong> The component's own module never statically imports the library; it pulls in the engine module through a <em>string-literal</em> dynamic <code>import()</code> inside <code>connectedCallback</code> (which runs only in the browser), so the library never reaches SSR. Wrap the boot so a failure degrades to the SSR placeholder rather than hanging the page. A top-level <code>import</code> of the engine would drag the library into the SSR graph and crash on the first server-only global it touches; the string literal also keeps the engine module authorized by the import-graph gate above (a computed <code>import(expr)</code> 404s).</li>
      <li><strong>The engine module is framework-free and statically imports the library by its bare specifier</strong> (<code>import * as THREE from 'three'</code>). It is reached only through the browser-only dynamic import, so it never runs server-side.</li>
      <li><strong>Vendor the library into the importmap.</strong> <code>npm install three</code>, then <code>webjs vendor pin</code> pins <code>three</code> and its <code>three/addons/*</code> subpaths to a single CDN-hosted instance. (If the library is imported straight from a CDN with no local install, <code>webjs vendor pin</code> reports that it found the specifier but could not resolve a version and asks you to install it first.)</li>
      <li><strong>Share state between the engine loop and a component through a module-scope <code>signal()</code> used as a container.</strong> Every module that imports it gets the same instance. Two rules keep it SSR-safe and cheap: <code>import type</code> anything that transitively reaches the library (a value import would pull it into SSR; the TypeScript stripper erases a type-only import), and mutate the held object in place per animation frame rather than calling <code>.set()</code> 60 times a second (the reading component reads the signal inside its own <code>requestAnimationFrame</code>, outside any reactive render, so no re-render is needed). Use <code>.set()</code> only for a genuine state transition the UI should react to.</li>
    </ol>
    <p>The SSR baseline (the placeholder plus any server-rendered content) reads without the engine, so progressive enhancement holds, and the library rides the importmap, so there is still no build step. The full worked recipe with code is in the skill's <code>references/client-router-and-streaming.md</code>.</p>

    <h2>Why jspm.io and not local bundling?</h2>
    <p>A stricter "browser-native ESM only" interpretation of no-build would refuse to run any bundler anywhere on the user's machine, including for npm packages. Rails 7+ with <code>importmap-rails</code> is the canonical example, and WebJs adopts the same posture exactly. The WebJs server never invokes a bundler for vendor packages; jspm.io pre-bundled them on their CDN.</p>
    <p>Why jspm.io specifically: institutional sponsors (37signals, CacheFly, Socket, Framer), years of uptime, status page at <code>status.jspm.io</code>, standards-first maintenance by Guy Bedford (TC39 ESM + import maps + HTML spec). Same CDN Rails uses.</p>
    <p>The framework itself stays no-build in every sense that matters. Source equals runtime for your app code (no compile step before deploy, no output directory, no bundle hashes to invalidate). Vendor packages come pre-bundled from jspm.io. webjs's machine ships zero bundler invocations for vendor traffic, and zero bundler invocations for your own code.</p>
    <p>One narrow exception: <code>@webjsdev/core</code> ships pre-built <code>dist/</code> bundles alongside its <code>src/</code> in the npm tarball. The browser fetches the framework as ONE self-contained file, <code>/__webjs/core/dist/webjs-core-browser.js</code> (built with code-splitting off, so no <code>chunk-*.js</code>), instead of waterfalling through 15+ <code>src/</code> files. That single bundle re-exports the whole browser surface, so the bare specifier and the <code>/directives</code>, <code>/context</code>, <code>/task</code>, and <code>/client-router</code> subpaths all resolve to it and each import picks its named exports; only <code>/lazy-loader</code> stays a separate on-demand file. The bare specifier points at a BROWSER entry that drops server-only modules (<code>render-server.js</code>, <code>expose.js</code>, <code>setCspNonceProvider</code>) so server bytes never ride the wire. Node-side consumers resolve via the package's <code>exports</code> field and land on the universal <code>webjs-core.js</code>, which keeps the full surface for the SSR pipeline and unit tests. The readable <code>src/</code> still ships so AI agents grep it directly. The bundle is built ONCE at <code>npm publish</code> time on the framework author's machine via esbuild as a publish-time devDependency; user installs never invoke a bundler. Workspace dev (monorepo edits) silently falls back to per-file <code>src/</code> serving until <code>npm run build:dist</code> is run, so the edit-and-refresh loop has no build step. Only <code>@webjsdev/core</code> ships bundles; every other <code>@webjsdev/*</code> package is source-only.</p>

    <h2>Browser-side env vars without a build step</h2>
    <p>Next.js exposes <code>NEXT_PUBLIC_*</code> to the browser via build-time static substitution. WebJs has no build step, so it can't substitute literals into source. Instead, the SSR pipeline emits an inline <code>&lt;script&gt;</code> in the document head, before the importmap and any module code:</p>
    <pre>&lt;script&gt;
  window.process = window.process || {};
  window.process.env = Object.assign(window.process.env || {}, {
    "WEBJS_PUBLIC_API_URL": "https://api.example.com",
    "NODE_ENV": "production"
  });
&lt;/script&gt;</pre>
    <p>After that runs, <code>process.env.WEBJS_PUBLIC_X</code> is a real property read on a real object in the browser. No transform, no substitution, no build step. Same source equals runtime invariant as everything else on this page.</p>
    <p>Only env vars with the <code>WEBJS_PUBLIC_</code> prefix cross the wire. Everything else stays on the server. <code>NODE_ENV</code> is also defined so vendor bundles that probe it (lit, react, etc.) run cleanly in the browser. Full user-facing docs in <a href="/docs/configuration">Configuration</a>.</p>

    <h2>Granular cache invalidation</h2>
    <p>The killer feature of the no-build model is what happens between two deploys. With a bundler, edit one component and the entire bundle's content hash changes, so every user re-downloads everything. With per-file ESM:</p>
    <ul>
      <li>In prod the framework appends a per-file content hash to every same-origin asset URL it emits (the importmap targets, the <code>&lt;link rel="modulepreload"&gt;</code> hrefs, the boot module specifiers) as a <code>?v=&lt;digest&gt;</code> query, computed at serve time from the file bytes. A fingerprinted URL is served <code>public, max-age=31536000, immutable</code>, so the browser / CDN holds it for a year without revalidating.</li>
      <li>The file you edited has new bytes, so its digest changes, so its emitted URL changes, so a returning client fetches the new URL instead of serving the stale immutable copy. This is what makes <code>immutable</code> safe with no build step: the hash IS the version. The framework's own <code>@webjsdev/core</code> runtime is fingerprinted too, which fixes the exact regression an un-versioned <code>immutable</code> would cause (a year-pinned old core renderer running against a server emitting the new SSR shape after a version bump).</li>
      <li>Every other file is byte-identical to the previous deploy, so its digest (and URL) is unchanged and the browser serves the cached copy with no request at all.</li>
      <li>npm package URLs (jspm.io URLs include <code>@&lt;version&gt;</code>) change only when you bump the package, so browser caches invalidate automatically on version bump. A cross-origin vendor URL is NEVER fingerprinted (jspm already versions it; #235's SRI integrity is keyed by the un-hashed URL).</li>
    </ul>
    <p>Result: a typo fix in one component re-downloads exactly one file. A dependency upgrade re-downloads exactly one vendor bundle. A full deploy that touches two components costs two file downloads, not a megabyte of cache-busted bundle. Dev is unaffected: <code>webjs dev</code> emits no <code>?v</code> and serves every module <code>no-cache</code> so an edit shows up immediately.</p>

    <h2>HTTP/2 at the edge</h2>
    <p>Per-file ESM is competitive with bundling only over HTTP/2 (or HTTP/3). On HTTP/1.1 the browser limits concurrent connections per origin to six, so a hundred-file page serializes into sixteen waves. On HTTP/2 the same hundred files multiplex over one TCP connection, with header compression amortizing the per-request overhead.</p>
    <p>WebJs delegates TLS termination and HTTP/2 negotiation to the proxy in front of it. <code>webjs start</code> itself speaks plain HTTP/1.1 to its upstream. The full deployment story (PaaS edges, nginx, Caddy, Traefik configs) lives in the <a href="/docs/deployment">Deployment</a> doc.</p>

    <h2>Dev vs prod</h2>
    <table>
      <thead>
        <tr><th>Aspect</th><th>Dev (<code>webjs dev</code>)</th><th>Prod (<code>webjs start</code>)</th></tr>
      </thead>
      <tbody>
        <tr><td>TS stripping</td><td>Same: <code>module.stripTypeScriptTypes</code></td><td>Same</td></tr>
        <tr><td>Mtime cache</td><td>Cleared on file change via <code>fs.watch</code></td><td>Persists for process lifetime</td></tr>
        <tr><td>Vendor resolution</td><td>Reads <code>.webjs/vendor/importmap.json</code> if present; else calls <code>api.jspm.io/generate</code> on the first request (re-resolved after rebuild). Never at boot.</td><td>Reads <code>.webjs/vendor/importmap.json</code> if present; else calls <code>api.jspm.io/generate</code> on the first request, once. Never at boot.</td></tr>
        <tr><td>Cache-Control</td><td><code>no-cache</code></td><td><code>max-age=31536000, immutable</code> for a content-hashed <code>?v=&lt;digest&gt;</code> URL (the form the framework emits) and for <code>--download</code> bundles; <code>max-age=3600</code> for a bare un-fingerprinted request; jspm.io controls headers for direct CDN fetches</td></tr>
        <tr><td>103 Early Hints</td><td>Disabled (stale URL risk)</td><td>Enabled</td></tr>
        <tr><td>Compression</td><td>Off</td><td>Brotli/Gzip negotiated</td></tr>
        <tr><td>Live reload</td><td>SSE-driven full page reload</td><td>n/a</td></tr>
      </tbody>
    </table>

    <h2>When this falls down</h2>
    <p>The no-build model is well-suited to apps that fit the framework's assumptions. Concrete limitations to be aware of:</p>
    <ul>
      <li><strong>HTTP/1.1 only deploys are slow.</strong> If you can't put a reverse proxy or PaaS edge in front, per-file ESM will serialize on connection limits. Either accept the latency, deploy on PaaS, or front <code>webjs start</code> with nginx / Caddy.</li>
      <li><strong>Very large apps with deep import graphs.</strong> The modulepreload hint list grows with transitive deps. On a page that touches a hundred files, you ship a hundred preload links. Browsers handle this fine; some CDNs cap header size around 8 KB, which is a soft ceiling of roughly 80 preloads per page. The framework deduplicates against the boot script's imports to keep the list tight.</li>
      <li><strong>Non-erasable TypeScript in third-party deps.</strong> A <code>.ts</code> file in <code>node_modules</code> that uses <code>enum</code>, parameter properties, or other non-erasable syntax fails at strip time and the dev server returns a 500 naming the file and pointing at the <code>no-non-erasable-typescript</code> lint rule. WebJs is buildless end-to-end and has no bundler fallback. Doubly rare in practice: published npm packages almost always ship compiled <code>.js</code> + <code>.d.ts</code>, not raw TypeScript, so the runtime never sees a <code>.ts</code> file from <code>node_modules</code> to begin with. The realistic trigger is a monorepo-internal workspace package that exports <code>.ts</code> source with non-erasable syntax (raw <code>.ts</code> using only erasable syntax goes through the stripper just fine).</li>
      <li><strong>Tree-shaking is per-file, not bundle-wide.</strong> If you import a large utility module for one function, the whole module ships. Either import named symbols from a more focused entry point, or accept it. The mtime cache means repeat fetches are free, so the cost is one-time.</li>
    </ul>
    <p>None of these are show-stoppers, and none of them benefit from introducing a bundler. The framework is explicitly designed to make per-file ESM the right answer at production scale.</p>

    <h2>What is deliberately not in scope</h2>
    <ul>
      <li><strong>No <code>webjs build</code> command.</strong> Production performance comes from HTTP/2 multiplex + modulepreload hints, not concatenation. There is no plan to add one.</li>
      <li><strong>No per-route code splitting beyond what the browser already does.</strong> The import graph already loads each module on demand. Modulepreload hints are emitted per-route at SSR time, so the browser fetches exactly the files that route needs.</li>
      <li><strong>No Vite-grade HMR.</strong> Web components can only be <code>customElements.define</code>'d once per page, so the dev server does a full reload via SSE. Reloads are sub-100ms in practice.</li>
    </ul>
    <p>If a large-app performance problem ever materializes, the answer will be tightening the modulepreload graph or adopting per-route importmap scopes natively in the browser. Not reintroducing a build step.</p>
  `;
}
