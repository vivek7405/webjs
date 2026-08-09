import { html } from '@webjsdev/core';

export const metadata = { title: 'Configuration | WebJs' };

export default function Configuration() {
  return html`
    <h1>Configuration</h1>
    <p>WebJs is designed to work with <strong>zero configuration</strong>. File conventions handle routing, TypeScript works out of the box, and the server is pre-configured with sensible defaults. This page documents what you <em>can</em> configure when you need to.</p>

    <h2>CLI Options</h2>
    <h3>webjs dev</h3>
    <code-block>webjs dev [--port 8080]</code-block>
    <ul>
      <li><code>--port</code>: dev server port. Precedence is <code>--port</code> &gt; <code>PORT</code> (a real env var <em>or</em> a <code>PORT</code> in the app's <code>.env</code>) &gt; <code>8080</code>. A real exported <code>PORT</code> still wins over the <code>.env</code> value, matching the auto-load's shell-wins-over-file rule.</li>
      <li>File watching via Node's built-in <code>fs.watch</code> (automatic)</li>
      <li>Live reload via SSE (<code>/__webjs/events</code>)</li>
      <li>TypeScript files transformed on the fly</li>
      <li>No cache-busting needed, since module loads are busted per request</li>
    </ul>

    <h3>webjs start</h3>
    <code-block>webjs start [--port 8080]</code-block>
    <ul>
      <li><code>--port</code>: production server port. Same precedence as <code>dev</code>: <code>--port</code> &gt; <code>PORT</code> (real env var or <code>.env</code>) &gt; <code>8080</code>.</li>
      <li>Speaks plain HTTP/1.1. TLS termination + HTTP/2 to the browser is the proxy's job (PaaS edges or nginx/Caddy/Traefik)</li>
      <li>gzip/brotli compression enabled by default</li>
      <li>Static file ETag + Cache-Control headers</li>
      <li>Graceful shutdown on SIGTERM/SIGINT</li>
      <li>JSON logger (structured, one line per event)</li>
    </ul>

    <h3>webjs db</h3>
    <code-block>webjs db generate     # drizzle-kit generate
webjs db migrate      # drizzle-kit migrate
webjs db push         # drizzle-kit push
webjs db studio       # drizzle-kit studio
webjs db seed         # run db/seed.server.ts</code-block>

    <h3>webjs routes</h3>
    <code-block>webjs routes                    # a grouped tree of pages + route handlers
webjs routes --table            # aligned KIND / PATH / METHODS / FILE columns
webjs routes --table --no-headers   # same, without the header row (pipe-friendly)
webjs routes --json             # structured JSON (matches the MCP list_routes tool)</code-block>
    <p>Prints the route table to stdout: every page (path, owner file, dynamic params) and every <code>route.&#123;js,ts&#125;</code> handler (path, owner file, HTTP methods). It reuses the same route walker that backs the typed-routes generator and the dev server, so it always reflects exactly what the framework will serve. The <code>--json</code> shape is byte-identical to the read-only MCP <code>list_routes</code> tool, so an agent gets the same data whether it shells out or calls the MCP.</p>

    <h3>webjs doctor</h3>
    <code-block>webjs doctor            # human-readable project-health checklist
webjs doctor --json     # structured results (each with a stable code) + a summary
webjs doctor --strict   # also fail on EVERY remaining warning, not just hard failures and gated errors</code-block>
    <p>Per-check severity is <em>configuration</em>, not a flag. Declare it in <code>package.json</code> under <code>webjs.doctor.gate</code>, keyed by the stable code every result carries, on the same three-level scale ESLint uses. That is what lets CI gate on a chosen subset without <code>--strict</code> making every warning fatal, which is unusable on a runner (the git-hook, env-drift, vendor-pin, and framework-resolve checks are all environment-shaped and would fail a perfectly healthy build).</p>
    <code-block>&#123;
  "webjs": &#123;
    "doctor": &#123;
      "gate": &#123;
        "UNMARKED_ASSET_LINKS": "error",
        "ELISION_CARRIERS": "off"
      &#125;
    &#125;
  &#125;
&#125;</code-block>
    <p><code>error</code> fails the exit, <code>warn</code> reports without failing, and <code>off</code> silences the check: its finding is not printed and it cannot fail the exit, including under <code>--strict</code>. A silenced check still appears on the checklist as <code>[off]</code> and in the summary's silenced count, so it is never invisible, and <code>--json</code> still carries its whole result. A code with no entry keeps its default (<code>error</code> for a hard toolchain failure, <code>warn</code> otherwise), so an app that declares nothing behaves exactly as it did before. Two guarantees make it safe to put in a required CI job: a result that could not check, such as a network or toolchain outage, is capped at <code>warn</code> and can never be escalated, and a malformed gate exits 1 naming the offender rather than being ignored, so a typo cannot silently un-gate the build. That last one covers an unknown code, a bad severity, a wrong shape (a non-object <code>doctor</code> or <code>gate</code>), and a misspelled sibling of <code>gate</code> such as <code>gates</code>; under <code>--json</code> they come back as a <code>configErrors</code> array alongside an empty <code>results</code>.</p>
    <p>Verifies project health: the Node version floor, <code>erasableSyntaxOnly</code>, <code>.env</code> drift, vendor-pin freshness, importmap coherence, <code>@webjsdev/*</code> version coherence, framework resolvability, the git hook, a page/layout elision advisory, and a warning when a route module writes a <code>&lt;link rel="stylesheet"&gt;</code> without <code>asset()</code> (so its url is un-versioned and a deploy cannot bust a cached copy). Each result carries a stable machine <code>code</code> (for example <code>NODE_VERSION</code>, <code>TSCONFIG_ERASABLE</code>, <code>IMPORTMAP_COHERENCE</code>) so an agent branches on the failure kind, not the message text. The <code>--json</code> payload is an object <code>&#123; results, summary &#125;</code> (the <code>results</code> array holds the per-check objects, each with its <code>code</code> and its effective <code>severity</code>; the <code>summary</code> counts <code>pass</code> / <code>warn</code> / <code>fail</code> / <code>off</code>). A rejected <code>webjs.doctor</code> config is the one path that adds a third key, <code>configErrors</code>, with <code>results</code> empty because no check ran. The exit is non-zero on a hard <em>toolchain</em> failure, and on any check the app gated <code>error</code> (see the severity gate above); <code>--strict</code> additionally fails on every remaining warning, so it can gate a fully-clean fix loop the way <code>webjs check --json</code> does.</p>

    <h3>webjs version</h3>
    <code-block>webjs version           # print the installed @webjsdev/cli version
webjs --version  /  -v  # the same, flag form</code-block>
    <p>Prints the installed <code>@webjsdev/cli</code> version, so an agent can detect the toolchain version before relying on a command.</p>

    <h3>webjs help</h3>
    <code-block>webjs help              # the full command banner
webjs help routes       # usage + summary + an Options table + Examples for one command
webjs --help  /  -h     # the banner (flag form)
webjs routes --help     # one command's help (flag form)</code-block>
    <p><code>webjs help &lt;command&gt;</code> prints that command's exact usage line, a one-line summary, an Options table documenting every flag, and worked examples, so you (or an agent) read the real invocation instead of guessing flags. The <code>--help</code> / <code>-h</code> flag forms are equivalent: bare at the top level for the banner, or after a command for that command's help. Commands that wrap an external tool (<code>typecheck</code> to <code>tsc</code>, <code>db</code> to drizzle-kit, <code>ui</code> to <code>@webjsdev/ui</code>) forward <code>--help</code> to that tool. An unknown help topic exits non-zero.</p>

    <h2>tsconfig.json</h2>
    <p>Optional but recommended for editor + CI type-checking:</p>
    <code-block>{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "erasableSyntaxOnly": true,
    "plugins": [{ "name": "@webjsdev/intellisense" }]
  },
  "include": [
    "app/**/*",
    "components/**/*",
    "modules/**/*",
    "lib/**/*",
    "test/**/*",
    "middleware.js",
    "middleware.ts",
    ".webjs/routes.d.ts"
  ],
  "exclude": ["node_modules", ".webjs/vendor", "db/migrations"]
}</code-block>
    <p>Key settings:</p>
    <ul>
      <li><code>noEmit</code>: type-check only, no compiled output (preserves no-build)</li>
      <li><code>allowImportingTsExtensions</code>: needed for explicit <code>.ts</code> in imports</li>
      <li><code>erasableSyntaxOnly</code>: rejects the TypeScript syntax Node's built-in stripper cannot erase</li>
      <li><code>include</code> covers <code>test/</code>, so <code>npm run typecheck</code> reads the tests you write and a type error there fails the same one command</li>
    </ul>

    <h2>webjs check: correctness, not config</h2>
    <p><code>webjs check</code> runs a fixed set of correctness checks (a crash, a security leak, a reactive prop that silently stops re-rendering, a build or type-strip failure). They always run; there is no project-level config to disable them, and the checks read no <code>package.json</code> config block of their own. Project <em>conventions</em> (layout, naming, testing) are guidance in the shipped skill (<code>.agents/skills/webjs/SKILL.md</code>) and <code>AGENTS.md</code>, not a tool. See <a href="/docs/conventions">Conventions &amp; AI Workflow</a> for the split and run <code>webjs check --rules</code> to list the checks.</p>

    <h2>Security response headers</h2>
    <p>WebJs sets standard security headers on every response by default (<code>X-Content-Type-Options</code>, <code>X-Frame-Options</code>, <code>Referrer-Policy</code>, <code>Permissions-Policy</code>, plus <code>Strict-Transport-Security</code> in production over HTTPS). Override or extend them per path with a <code>webjs.headers</code> block in <code>package.json</code>, an array of <code>&#123; source, headers: [&#123; key, value &#125;] &#125;</code> rules where <code>source</code> is a URLPattern path pattern and a <code>null</code> value removes a default. App middleware wins over the path config, which wins over the defaults. A <code>webjs.csp</code> key (off by default) additionally mints a per-request CSP nonce and emits a matching <code>Content-Security-Policy</code> header. See <a href="/docs/deployment">Deployment &rarr; Secure response headers</a> for the full reference.</p>

    <h2>Redirects</h2>
    <p>For a moved URL, declare a redirect under <code>webjs.redirects</code> in <code>package.json</code>, an array of <code>&#123; source, destination, permanent?, statusCode? &#125;</code> rules. <code>source</code> is a URLPattern path pattern (so <code>:param</code> / <code>:rest*</code> works) and <code>destination</code> is the target: a path, a path referencing named groups from the source (<code>/posts/:slug</code> filled from <code>/blog/:slug</code>), or an absolute URL for an external redirect. <code>permanent</code> defaults to <code>true</code> (a <strong>308</strong> Permanent Redirect, what SEO wants so link equity transfers); <code>permanent: false</code> is a <strong>307</strong> Temporary Redirect. 308 / 307 preserve the request method (a redirected POST stays a POST); for a legacy <strong>301</strong> / <strong>302</strong> set <code>statusCode</code> explicitly. The incoming query string is preserved by default. Redirects apply at the very start of request handling, before routing, and a malformed entry is dropped with a warning rather than crashing the app.</p>
    <code-block>&#123;
  "webjs": &#123;
    "redirects": [
      &#123; "source": "/old", "destination": "/new" &#125;,
      &#123; "source": "/blog/:slug", "destination": "/posts/:slug" &#125;,
      &#123; "source": "/legacy", "destination": "/", "permanent": false &#125;,
      &#123; "source": "/docs", "destination": "https://docs.example.com" &#125;
    ]
  &#125;
&#125;</code-block>

    <h2>Trailing slash</h2>
    <p>webjs's file router matches <code>/about</code> and <code>/about/</code> against the same route, so both render identical HTML. That is duplicate content for SEO (the two URLs split link equity) and two keys in the client-router cache. Pick one canonical form with a <code>webjs.trailingSlash</code> key in <code>package.json</code>: <code>"never"</code> strips a trailing slash (<code>/about/</code> &rarr; <code>/about</code>, the recommended form for most apps), <code>"always"</code> adds one (<code>/about</code> &rarr; <code>/about/</code>), and <code>"ignore"</code> (the default, also the behavior when the key is absent) does nothing, so an existing app is unchanged unless it opts in. The non-canonical URL gets a <strong>308</strong> Permanent Redirect (link equity transfers, and a redirected POST stays a POST). The root <code>/</code> is always left alone; under <code>"always"</code> a path whose last segment looks like a file (has a dot, e.g. <code>/logo.png</code>) is not given a trailing slash. The query string is preserved. Canonicalization runs right after the <code>webjs.redirects</code> rules (so an explicit redirect wins first), at the very start of request handling. There is no server-side loop guard: a redirect whose <code>destination</code> contradicts the slash policy (e.g. <code>"never"</code> with a destination of <code>/x/</code>) creates an infinite redirect loop, so keeping redirect destinations consistent with the policy is your responsibility.</p>
    <code-block>&#123; "webjs": &#123; "trailingSlash": "never" &#125; &#125;</code-block>

    <h2>Base path (sub-path deployment)</h2>
    <p>Deploying an app under a sub-path (<code>example.com/app/</code>) behind a proxy that does not strip the prefix breaks module resolution unless every framework-emitted URL carries the prefix. Set <code>webjs.basePath</code> in <code>package.json</code> and WebJs handles it: <code>"app"</code>, <code>"/app"</code>, and <code>"/app/"</code> all normalize to <code>/app</code>, a nested <code>/foo/bar</code> is allowed, and an empty value (or the absence of the key) is a root mount that changes nothing. The prefix is stripped from the incoming request path at the very start of request handling (so route matching, redirects, the trailing-slash policy, and the header config all see a root-relative path) and prepended to every framework-emitted absolute URL: the importmap targets, the modulepreload hints, the boot script's module specifiers, and the dev reload script. A request whose path is not under the base path is not for this app and returns a 404. Author-written <code>&lt;a href&gt;</code> links and client-side navigation are not auto-prefixed yet (a documented follow-up), so target the prefix in your own links when deploying under a base path.</p>
    <code-block>&#123; "webjs": &#123; "basePath": "/app" &#125; &#125;</code-block>

    <h2>Client router</h2>
    <p>The client router is automatic: it auto-enables in the browser whenever <code>@webjsdev/core</code> loads (any page that ships a component), so SPA-style navigation needs no import or setup. To opt the whole app out and use plain full-page (multi-page) navigation instead, set <code>webjs.clientRouter</code> to <code>false</code>. Components still hydrate and stay interactive; only the link and form interception is disabled, so every navigation is a full browser load. The default (and any value other than <code>false</code>) keeps the router on. See <a href="/docs/client-router">Client Router</a> for the runtime <code>disableClientRouter()</code> / <code>enableClientRouter()</code> escape hatches.</p>
    <code-block>&#123; "webjs": &#123; "clientRouter": false &#125; &#125;</code-block>

    <h2>SSR action seeding</h2>
    <p>Each <code>'use server'</code> action result invoked during a buffered SSR render is serialized into the page, and the generated RPC stub reads that seed on its first client call, so a shipping async component does not re-issue the request on hydration. It is on by default and needs no code. Turn it off with <code>webjs.seed</code> in <code>package.json</code> or <code>WEBJS_SEED=0</code>, in which case the client re-fetches on hydration exactly as it did before the feature.</p>
    <code-block>&#123; "webjs": &#123; "seed": false &#125; &#125;</code-block>
    <p><strong>Seeing whether it works.</strong> A seed miss is invisible from the outside: the page still renders correctly, it just pays a network round-trip per async component on every first load. So in development (and only there) every page response carries an <code>X-Webjs-Seed</code> header, also folded into the access-log line as a <code>seed</code> field. Its value is <code>off</code> when seeding is disabled, <code>html-cache</code> when the cached-HTML path answered, <code>collected=&lt;m&gt;, emitted=&lt;n&gt;</code> on a normal render, and <code>collected=&lt;m&gt;, emitted=0, streamed</code> on a page carrying a <code>Suspense</code> or <code>&lt;webjs-suspense&gt;</code> boundary (a streamed render emits no seeds, because its deferred regions resolve after the first flush). A <code>collected</code> above <code>emitted</code> means the serializer could not encode a returned value and the whole block was dropped.</p>
    <p>The browser logs one warning per page view when a hydration call missed its seed AND the cause is provable, naming which applies; it stays silent otherwise, including on a page that emitted no seeds, where the header is the reliable signal. Development also warns once per action function when a single render returns two different results for the same arguments, the one case where a seed can disagree with the paint the user is looking at. None of this reaches production: no header, no marker, and prod HTML is byte-identical.</p>

    <h2>Display-only elision</h2>
    <p>WebJs never downloads a component module that does no client work: the import is stripped from the served source and the module, its <code>modulepreload</code> hint, and any vendor reachable only through it are pruned. This is on by default and biased toward shipping, so anything ambiguous keeps its JavaScript. Set <code>webjs.elide</code> to <code>false</code> to turn it off app-wide, which makes every module ship.</p>
    <code-block>&#123; "webjs": &#123; "elide": false &#125; &#125;</code-block>
    <p>The <code>WEBJS_ELIDE</code> environment variable overrides the config key per run (<code>0</code> / <code>false</code> / <code>off</code> / <code>no</code> force it off, <code>1</code> / <code>true</code> / <code>on</code> / <code>yes</code> force it on). That override is also the seam <code>webjs elision --verify</code> uses to render one app both ways in a single process.</p>
    <code-block>WEBJS_ELIDE=0 npm run start</code-block>
    <p>Reach for the switch to isolate a bug, not as a permanent setting: everything it turns off is JavaScript your users would otherwise never download. To see WHAT is being dropped and why, run <code>webjs elision</code>. See <a href="/docs/elision">Display-Only Elision</a>.</p>

    <h2>Request limits &amp; server timeouts</h2>
    <p>The server caps inbound request bodies and bounds connection lifetimes by default, so an uncapped body is not a memory-exhaustion vector and a slow connection is not a slowloris vector. Both apply with secure defaults when unset and are configurable in <code>package.json</code> (env overrides win, and a value of <code>0</code> disables that limit / timeout).</p>
    <p><strong>Body-size limit (413).</strong> Every request body the server reads (the action RPC endpoint, <code>route.&#123;js,ts&#125;</code> handlers via <code>readBody</code>, and the no-JS form-action dispatch path) is capped. A JSON / RPC body defaults to 1 MiB (<code>webjs.maxBodyBytes</code> or <code>WEBJS_MAX_BODY_BYTES</code>); a form / multipart body defaults to 10 MiB (<code>webjs.maxMultipartBytes</code> or <code>WEBJS_MAX_MULTIPART_BYTES</code>). An over-limit body responds <code>413 Payload Too Large</code> and is never buffered whole: a <code>Content-Length</code> over the cap is rejected before the body is read, and a chunked body with no declared length is abandoned the instant it crosses the cap.</p>
    <p><strong>Server timeouts.</strong> The production server sets three node:http built-ins: <code>requestTimeout</code> (30s, <code>webjs.requestTimeoutMs</code> / <code>WEBJS_REQUEST_TIMEOUT_MS</code>) bounds the time to receive the whole request, <code>headersTimeout</code> (20s, <code>webjs.headersTimeoutMs</code> / <code>WEBJS_HEADERS_TIMEOUT_MS</code>) the time to receive just the headers, and <code>keepAliveTimeout</code> (5s, <code>webjs.keepAliveTimeoutMs</code> / <code>WEBJS_KEEP_ALIVE_TIMEOUT_MS</code>) the idle window before a kept-alive socket is closed. Per node semantics <code>headersTimeout</code> must be under <code>requestTimeout</code> to fire, so an inconsistent config is clamped automatically.</p>
    <code-block>&#123; "webjs": &#123; "maxBodyBytes": 262144, "maxMultipartBytes": 5242880, "requestTimeoutMs": 30000 &#125; &#125;</code-block>

    <h2>Config typos are reported at boot</h2>
    <p>Every key in the <code>webjs</code> block is optional, which means an unknown one has no way to announce itself: write <code>"redirect"</code> for <code>"redirects"</code> and the key is simply never read, the feature sits at its default, and the app looks configured. So WebJs validates the block against its published JSON Schema once per boot, in development and in production alike, and prints a single warning naming what it ignored.</p>
    <p>It is a <strong>warning, never a failure</strong>. A typo costs one feature its setting, and refusing to boot over that would cost the whole app, usually mid-deploy.</p>
    <p><strong>What it catches, and what it does not.</strong> It reports an unknown top-level key, a value outside an allowed set (<code>trailingSlash</code>), and a wrong-typed boolean or whole number (<code>elide</code>, <code>seed</code>, <code>clientRouter</code>, <code>maxBodyBytes</code>, <code>maxMultipartBytes</code>, and the three timeouts). That is 9 of the 17 keys. It does not descend into nested objects, so a key misspelled inside <code>webjs.dev</code> or <code>webjs.start</code> is missed, and it does not check the type of the other 8 (<code>headers</code>, <code>redirects</code>, <code>basePath</code>, <code>allowedOrigins</code>, <code>csp</code>, <code>dev</code>, <code>start</code>, <code>doctor</code>), which are the free-form array, string, and object shapes where a blunt check would start rejecting configs that work. Give one of those the wrong type outright, as in <code>"headers": "x"</code>, and it passes this check and its reader quietly falls back to the default.</p>
    <p>That key-level case is the whole of the gap. A malformed <em>entry</em> inside a well-shaped <code>headers</code> or <code>redirects</code> array already warns on its own, and a wrong-shaped <code>doctor</code> block is not dropped at all: <code>webjs doctor</code> exits non-zero naming it, because a silently ignored gate would leave CI un-gated while looking gated. Editors catch more of this earlier still: a scaffolded app wires the schema into <code>.vscode/settings.json</code>, and the <code>WebjsConfig</code> type from <code>@webjsdev/core</code> types the block while you author it.</p>

    <h2>Environment Variables</h2>
    <p>Use <code>process.env</code> in server-side code (pages, actions, route handlers, middleware). WebJs auto-loads <code>&lt;appDir&gt;/.env</code> into <code>process.env</code> once at boot using Node 24+'s built-in <code>process.loadEnvFile</code>, so a scaffolded app with a committed <code>.env.example</code> and a developer-copied <code>.env</code> just works without installing <code>dotenv</code> or wiring up the file path. The auto-load fires before any server-only module is imported, which matters for code that reads <code>process.env</code> at module-init time (e.g. <code>createAuth({ secret: process.env.AUTH_SECRET })</code>).</p>

    <p><strong>Precedence: shell wins over file.</strong> <code>process.loadEnvFile</code> does not override values that are already present in <code>process.env</code>, so values exported by the host shell or a process manager (Docker, systemd, Railway, Fly) take precedence over the same key in <code>.env</code>. This matches the Rails / Next / Astro convention: <code>.env</code> is for developer-local defaults; production secrets come from the platform.</p>

    <p><strong>No file, no problem.</strong> A missing <code>.env</code>, a malformed file, or running on Node without <code>loadEnvFile</code> all fail silently. The server still boots; only the missing values are <code>undefined</code> (the same way a typo would be).</p>

    <p>Override per-invocation by passing values on the command line:</p>
    <code-block>DATABASE_URL=postgres://... npm start</code-block>

    <h3>Validating env vars at boot (env.{js,ts})</h3>
    <p>The auto-load populates <code>process.env</code> but does not check it, so a missing or misconfigured required var (an absent <code>DATABASE_URL</code>, a too-short <code>AUTH_SECRET</code>) fails late and cryptically: a database connection error mid-request, an undefined secret signing a token. Add an optional <code>env.{js,ts}</code> module at the app root (a sibling of <code>middleware.js</code> and <code>readiness.js</code>) that default-exports a schema, and WebJs validates the environment at boot and <strong>fails fast</strong> with one message listing every problem at once.</p>
    <code-block>// env.ts (app root)
export default {
  DATABASE_URL: 'string',                                   // required by default
  AUTH_SECRET: { type: 'string', required: true, minLength: 16 },
  PORT: { type: 'number', optional: true, default: 8080 },  // coerced + defaulted (webjs default port)
  NODE_ENV: { type: 'enum', values: ['development', 'production', 'test'] },
};</code-block>
    <p>Each field is a type name (<code>'string'</code>) or an options object. Supported types: <code>string</code>, <code>number</code>, <code>boolean</code>, <code>url</code>, <code>enum</code>. A field is <strong>required by default</strong>; mark it <code>optional: true</code> (or give it a <code>default</code>) to allow it to be absent. String fields support <code>minLength</code> and a <code>pattern</code> (a RegExp or string); <code>enum</code> fields take a <code>values</code> array. Coerced values (a <code>number</code>, a <code>boolean</code>) and applied defaults are written back to <code>process.env</code>, so the app reads the coerced value.</p>
    <p><strong>Fails fast, reports everything.</strong> On a validation failure the server does not start. It throws a clear, aggregated Error naming every offending var and what is wrong (missing, wrong type, failed constraint), so the CLI exits non-zero and an embedded host rejects at boot. The whole list is reported at once, never one error at a time.</p>
    <p><strong>Escape hatch: a function validator.</strong> Instead of a schema object, default-export a function <code>(env) =&gt; void</code>. It runs at boot with the env object and any thrown Error becomes the boot failure. This is how an app uses zod (or any validator) without WebJs depending on it:</p>
    <code-block>// env.ts (function form)
import { z } from 'zod';
const schema = z.object({ DATABASE_URL: z.string().url(), AUTH_SECRET: z.string().min(16) });
export default (env) =&gt; { schema.parse(env); };</code-block>
    <p>The whole feature is opt-in: with no <code>env.{js,ts}</code> at the app root, nothing changes.</p>

    <h3>Server-only env vars (the default)</h3>
    <p>Any environment variable that does not start with <code>WEBJS_PUBLIC_</code> is <strong>server-only</strong>. It is never sent to the browser. <code>DATABASE_URL</code>, <code>AUTH_SECRET</code>, OAuth client secrets, third-party API keys: read them in server actions, route handlers, middleware, or page functions, and pass derived values (not the raw secret) to components.</p>

    <h3>Public env vars (WEBJS_PUBLIC_*)</h3>
    <p>Any env var whose name starts with <code>WEBJS_PUBLIC_</code> is exposed to the browser as <code>process.env.WEBJS_PUBLIC_X</code>. WebJs injects an inline script in the SSR'd HTML head that sets <code>window.process.env</code> before any user code or vendor bundle runs. Components can read these directly:</p>
    <code-block>// .env at the app root (auto-loaded at boot)
WEBJS_PUBLIC_API_URL=https://api.example.com
WEBJS_PUBLIC_STRIPE_KEY=pk_live_abc
SENTRY_DSN=https://x@sentry.io/y      # server-only, no prefix

// components/checkout.ts
class Checkout extends WebComponent {
  render() {
    return html\`&lt;a href=\${process.env.WEBJS_PUBLIC_API_URL + '/pay'}&gt;Pay&lt;/a&gt;\`;
  }
}</code-block>
    <p>This is the no-build equivalent of Next.js's <code>NEXT_PUBLIC_</code> convention. There is no transform step. The value is a real property read on a real <code>window.process.env</code> object in the browser.</p>

    <p><strong>NODE_ENV is always defined in the browser.</strong> The shim sets <code>process.env.NODE_ENV</code> to <code>'development'</code> in <code>webjs dev</code> or <code>'production'</code> in <code>webjs start</code>. Vendor bundles that probe <code>process.env.NODE_ENV</code> (lit, react, others) read the right value with no extra config.</p>

    <p><strong>Naming and safety.</strong> The prefix is fail-closed. An env var without <code>WEBJS_PUBLIC_</code> in its name cannot accidentally reach the browser at runtime, even if a component naively writes <code>process.env.DATABASE_URL</code>. The value will read as <code>undefined</code>, the same way a typo would. There is no way to opt out of the prefix, by design.</p>

    <p><strong>The SSR-time gap, and the lint rule that closes it.</strong> A component's <code>render()</code> runs on the server during SSR. If a component reads <code>process.env.SECRET</code> there and interpolates it into the HTML output, the secret gets shipped to every browser even though the runtime shim does not expose it. To catch this at write time, <code>webjs check</code> ships a <code>no-server-env-in-components</code> rule that flags any <code>process.env.X</code> read in a component file when <code>X</code> is not <code>WEBJS_PUBLIC_*</code> and not <code>NODE_ENV</code>. The fix is always one of: rename to <code>WEBJS_PUBLIC_*</code> if the value is intended for the browser, or read it in a page function / server action / middleware and pass a derived value to the component as an attribute.</p>

    <h2>Programmatic API</h2>
    <code-block>import { startServer, createRequestHandler } from '@webjsdev/server';

// Option 1: Full server
await startServer({
  appDir: process.cwd(),
  port: 8080,
  dev: false,
  compress: true,
  http2: false,
  logger: myCustomLogger, // { info, warn, error }
});

// Option 2: Embeddable handler
const app = await createRequestHandler({
  appDir: process.cwd(),
  dev: false,
  logger: myCustomLogger,
});
const resp = await app.handle(new Request('http://x/api/hello'));
</code-block>

    <h2>What Can't Be Configured</h2>
    <p>Some things are intentionally fixed:</p>
    <ul>
      <li><strong>Routing conventions</strong>: <code>page.ts</code>, <code>layout.ts</code>, <code>route.ts</code>, <code>middleware.ts</code>, <code>error.ts</code>, <code>not-found.ts</code> are the file names. No aliases.</li>
      <li><strong>Light DOM by default</strong>: components render into light DOM so global CSS and Tailwind utilities apply directly. Opt into shadow DOM per component with <code>static shadow = true</code>. No global toggle.</li>
      <li><strong>CSRF on server actions</strong>: always on for <code>/__webjs/action/*</code> RPC. Can't disable.</li>
      <li><strong>Import map</strong>: auto-generated. Maps <code>@webjsdev/core</code> sub-paths to framework-served URLs and any bare npm imports your client code uses to vendor bundles.</li>
    </ul>
  `;
}
