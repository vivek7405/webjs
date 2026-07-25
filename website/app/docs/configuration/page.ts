import { html } from '@webjsdev/core';

export const metadata = { title: 'Configuration | WebJs' };

export default function Configuration() {
  return html`
    <h1>Configuration</h1>
    <p>WebJs is designed to work with <strong>zero configuration</strong>. File conventions handle routing, TypeScript works out of the box, and the server is pre-configured with sensible defaults. This page documents what you <em>can</em> configure when you need to.</p>

    <h2>CLI Options</h2>
    <h3>webjs dev</h3>
    <pre>webjs dev [--port 8080]</pre>
    <ul>
      <li><code>--port</code>: dev server port. Precedence is <code>--port</code> &gt; <code>PORT</code> (a real env var <em>or</em> a <code>PORT</code> in the app's <code>.env</code>) &gt; <code>8080</code>. A real exported <code>PORT</code> still wins over the <code>.env</code> value, matching the auto-load's shell-wins-over-file rule.</li>
      <li>File watching via Node's built-in <code>fs.watch</code> (automatic)</li>
      <li>Live reload via SSE (<code>/__webjs/events</code>)</li>
      <li>TypeScript files transformed on the fly</li>
      <li>No cache-busting needed, since module loads are busted per request</li>
    </ul>

    <h3>webjs start</h3>
    <pre>webjs start [--port 8080]</pre>
    <ul>
      <li><code>--port</code>: production server port. Same precedence as <code>dev</code>: <code>--port</code> &gt; <code>PORT</code> (real env var or <code>.env</code>) &gt; <code>8080</code>.</li>
      <li>Speaks plain HTTP/1.1. TLS termination + HTTP/2 to the browser is the proxy's job (PaaS edges or nginx/Caddy/Traefik)</li>
      <li>gzip/brotli compression enabled by default</li>
      <li>Static file ETag + Cache-Control headers</li>
      <li>Graceful shutdown on SIGTERM/SIGINT</li>
      <li>JSON logger (structured, one line per event)</li>
    </ul>

    <h3>webjs db</h3>
    <pre>webjs db generate     # drizzle-kit generate
webjs db migrate      # drizzle-kit migrate
webjs db push         # drizzle-kit push
webjs db studio       # drizzle-kit studio
webjs db seed         # run db/seed.server.ts</pre>

    <h3>webjs routes</h3>
    <pre>webjs routes                    # a grouped tree of pages + route handlers
webjs routes --table            # aligned KIND / PATH / METHODS / FILE columns
webjs routes --table --no-headers   # same, without the header row (pipe-friendly)
webjs routes --json             # structured JSON (matches the MCP list_routes tool)</pre>
    <p>Prints the route table to stdout: every page (path, owner file, dynamic params) and every <code>route.&#123;js,ts&#125;</code> handler (path, owner file, HTTP methods). It reuses the same route walker that backs the typed-routes generator and the dev server, so it always reflects exactly what the framework will serve. The <code>--json</code> shape is byte-identical to the read-only MCP <code>list_routes</code> tool, so an agent gets the same data whether it shells out or calls the MCP.</p>

    <h3>webjs doctor</h3>
    <pre>webjs doctor            # human-readable project-health checklist
webjs doctor --json     # structured results (each with a stable code) + a summary
webjs doctor --strict   # also fail the exit on warnings, not just hard failures</pre>
    <p>Verifies project health: the Node version floor, <code>erasableSyntaxOnly</code>, <code>.env</code> drift, vendor-pin freshness, importmap coherence, <code>@webjsdev/*</code> version coherence, framework resolvability, the git hook, and a page/layout elision advisory. Each result carries a stable machine <code>code</code> (for example <code>NODE_VERSION</code>, <code>TSCONFIG_ERASABLE</code>, <code>IMPORTMAP_COHERENCE</code>) so an agent branches on the failure kind, not the message text. The <code>--json</code> payload is an object <code>&#123; results, summary &#125;</code> (the <code>results</code> array holds the per-check objects, each with its <code>code</code>). By default the exit is non-zero only on a hard <em>toolchain</em> failure; <code>--strict</code> also fails on warnings, so it can gate a fully-clean fix loop the way <code>webjs check --json</code> does.</p>

    <h3>webjs version</h3>
    <pre>webjs version           # print the installed @webjsdev/cli version
webjs --version  /  -v  # the same, flag form</pre>
    <p>Prints the installed <code>@webjsdev/cli</code> version, so an agent can detect the toolchain version before relying on a command.</p>

    <h3>webjs help</h3>
    <pre>webjs help              # the full command banner
webjs help routes       # usage + summary + an Options table + Examples for one command
webjs --help  /  -h     # the banner (flag form)
webjs routes --help     # one command's help (flag form)</pre>
    <p><code>webjs help &lt;command&gt;</code> prints that command's exact usage line, a one-line summary, an Options table documenting every flag, and worked examples, so you (or an agent) read the real invocation instead of guessing flags. The <code>--help</code> / <code>-h</code> flag forms are equivalent: bare at the top level for the banner, or after a command for that command's help. Commands that wrap an external tool (<code>typecheck</code> to <code>tsc</code>, <code>db</code> to drizzle-kit, <code>ui</code> to <code>@webjsdev/ui</code>) forward <code>--help</code> to that tool. An unknown help topic exits non-zero.</p>

    <h2>tsconfig.json</h2>
    <p>Optional but recommended for editor + CI type-checking:</p>
    <pre>{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "checkJs": true,
    "allowJs": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true
  },
  "include": ["app/**/*", "components/**/*", "modules/**/*", "lib/**/*"],
  "exclude": ["node_modules", ".webjs"]
}</pre>
    <p>Key settings:</p>
    <ul>
      <li><code>noEmit</code>: type-check only, no compiled output (preserves no-build)</li>
      <li><code>allowImportingTsExtensions</code>: needed for explicit <code>.ts</code> in imports</li>
      <li><code>checkJs</code>: type-check <code>.js</code> files too (for mixed codebases)</li>
    </ul>

    <h2>webjs check: correctness, not config</h2>
    <p><code>webjs check</code> runs a fixed set of correctness checks (a crash, a security leak, a build or type-strip failure). They always run; there is no project-level config to disable them, and the checks read no <code>package.json</code> config block of their own. Project <em>conventions</em> (layout, naming, testing) are guidance in the shipped skill (<code>.agents/skills/webjs/SKILL.md</code>) and <code>AGENTS.md</code>, not a tool. See <a href="/docs/conventions">Conventions &amp; AI Workflow</a> for the split and run <code>webjs check --rules</code> to list the checks.</p>

    <h2>Security response headers</h2>
    <p>WebJs sets standard security headers on every response by default (<code>X-Content-Type-Options</code>, <code>X-Frame-Options</code>, <code>Referrer-Policy</code>, <code>Permissions-Policy</code>, plus <code>Strict-Transport-Security</code> in production over HTTPS). Override or extend them per path with a <code>webjs.headers</code> block in <code>package.json</code>, an array of <code>&#123; source, headers: [&#123; key, value &#125;] &#125;</code> rules where <code>source</code> is a URLPattern path pattern and a <code>null</code> value removes a default. App middleware wins over the path config, which wins over the defaults. A <code>webjs.csp</code> key (off by default) additionally mints a per-request CSP nonce and emits a matching <code>Content-Security-Policy</code> header. See <a href="/docs/deployment">Deployment &rarr; Secure response headers</a> for the full reference.</p>

    <h2>Redirects</h2>
    <p>For a moved URL, declare a redirect under <code>webjs.redirects</code> in <code>package.json</code>, an array of <code>&#123; source, destination, permanent?, statusCode? &#125;</code> rules. <code>source</code> is a URLPattern path pattern (so <code>:param</code> / <code>:rest*</code> works) and <code>destination</code> is the target: a path, a path referencing named groups from the source (<code>/posts/:slug</code> filled from <code>/blog/:slug</code>), or an absolute URL for an external redirect. <code>permanent</code> defaults to <code>true</code> (a <strong>308</strong> Permanent Redirect, what SEO wants so link equity transfers); <code>permanent: false</code> is a <strong>307</strong> Temporary Redirect. 308 / 307 preserve the request method (a redirected POST stays a POST); for a legacy <strong>301</strong> / <strong>302</strong> set <code>statusCode</code> explicitly. The incoming query string is preserved by default. Redirects apply at the very start of request handling, before routing, and a malformed entry is dropped with a warning rather than crashing the app.</p>
    <pre><code>&#123;
  "webjs": &#123;
    "redirects": [
      &#123; "source": "/old", "destination": "/new" &#125;,
      &#123; "source": "/blog/:slug", "destination": "/posts/:slug" &#125;,
      &#123; "source": "/legacy", "destination": "/", "permanent": false &#125;,
      &#123; "source": "/docs", "destination": "https://docs.example.com" &#125;
    ]
  &#125;
&#125;</code></pre>

    <h2>Trailing slash</h2>
    <p>webjs's file router matches <code>/about</code> and <code>/about/</code> against the same route, so both render identical HTML. That is duplicate content for SEO (the two URLs split link equity) and two keys in the client-router cache. Pick one canonical form with a <code>webjs.trailingSlash</code> key in <code>package.json</code>: <code>"never"</code> strips a trailing slash (<code>/about/</code> &rarr; <code>/about</code>, the recommended form for most apps), <code>"always"</code> adds one (<code>/about</code> &rarr; <code>/about/</code>), and <code>"ignore"</code> (the default, also the behavior when the key is absent) does nothing, so an existing app is unchanged unless it opts in. The non-canonical URL gets a <strong>308</strong> Permanent Redirect (link equity transfers, and a redirected POST stays a POST). The root <code>/</code> is always left alone; under <code>"always"</code> a path whose last segment looks like a file (has a dot, e.g. <code>/logo.png</code>) is not given a trailing slash. The query string is preserved. Canonicalization runs right after the <code>webjs.redirects</code> rules (so an explicit redirect wins first), at the very start of request handling. There is no server-side loop guard: a redirect whose <code>destination</code> contradicts the slash policy (e.g. <code>"never"</code> with a destination of <code>/x/</code>) creates an infinite redirect loop, so keeping redirect destinations consistent with the policy is your responsibility.</p>
    <pre><code>&#123; "webjs": &#123; "trailingSlash": "never" &#125; &#125;</code></pre>

    <h2>Base path (sub-path deployment)</h2>
    <p>Deploying an app under a sub-path (<code>example.com/app/</code>) behind a proxy that does not strip the prefix breaks module resolution unless every framework-emitted URL carries the prefix. Set <code>webjs.basePath</code> in <code>package.json</code> and WebJs handles it: <code>"app"</code>, <code>"/app"</code>, and <code>"/app/"</code> all normalize to <code>/app</code>, a nested <code>/foo/bar</code> is allowed, and an empty value (or the absence of the key) is a root mount that changes nothing. The prefix is stripped from the incoming request path at the very start of request handling (so route matching, redirects, the trailing-slash policy, and the header config all see a root-relative path) and prepended to every framework-emitted absolute URL: the importmap targets, the modulepreload hints, the boot script's module specifiers, and the dev reload script. A request whose path is not under the base path is not for this app and returns a 404. Author-written <code>&lt;a href&gt;</code> links and client-side navigation are not auto-prefixed yet (a documented follow-up), so target the prefix in your own links when deploying under a base path.</p>
    <pre><code>&#123; "webjs": &#123; "basePath": "/app" &#125; &#125;</code></pre>

    <h2>Client router</h2>
    <p>The client router is automatic: it auto-enables in the browser whenever <code>@webjsdev/core</code> loads (any page that ships a component), so SPA-style navigation needs no import or setup. To opt the whole app out and use plain full-page (multi-page) navigation instead, set <code>webjs.clientRouter</code> to <code>false</code>. Components still hydrate and stay interactive; only the link and form interception is disabled, so every navigation is a full browser load. The default (and any value other than <code>false</code>) keeps the router on. See <a href="/docs/client-router">Client Router</a> for the runtime <code>disableClientRouter()</code> / <code>enableClientRouter()</code> escape hatches.</p>
    <pre><code>&#123; "webjs": &#123; "clientRouter": false &#125; &#125;</code></pre>

    <h2>Request limits &amp; server timeouts</h2>
    <p>The server caps inbound request bodies and bounds connection lifetimes by default, so an uncapped body is not a memory-exhaustion vector and a slow connection is not a slowloris vector. Both apply with secure defaults when unset and are configurable in <code>package.json</code> (env overrides win, and a value of <code>0</code> disables that limit / timeout).</p>
    <p><strong>Body-size limit (413).</strong> Every request body the server reads (the action RPC endpoint, <code>route.&#123;js,ts&#125;</code> handlers via <code>readBody</code>, and the no-JS page-action form path) is capped. A JSON / RPC body defaults to 1 MiB (<code>webjs.maxBodyBytes</code> or <code>WEBJS_MAX_BODY_BYTES</code>); a form / multipart body defaults to 10 MiB (<code>webjs.maxMultipartBytes</code> or <code>WEBJS_MAX_MULTIPART_BYTES</code>). An over-limit body responds <code>413 Payload Too Large</code> and is never buffered whole: a <code>Content-Length</code> over the cap is rejected before the body is read, and a chunked body with no declared length is abandoned the instant it crosses the cap.</p>
    <p><strong>Server timeouts.</strong> The production server sets three node:http built-ins: <code>requestTimeout</code> (30s, <code>webjs.requestTimeoutMs</code> / <code>WEBJS_REQUEST_TIMEOUT_MS</code>) bounds the time to receive the whole request, <code>headersTimeout</code> (20s, <code>webjs.headersTimeoutMs</code> / <code>WEBJS_HEADERS_TIMEOUT_MS</code>) the time to receive just the headers, and <code>keepAliveTimeout</code> (5s, <code>webjs.keepAliveTimeoutMs</code> / <code>WEBJS_KEEP_ALIVE_TIMEOUT_MS</code>) the idle window before a kept-alive socket is closed. Per node semantics <code>headersTimeout</code> must be under <code>requestTimeout</code> to fire, so an inconsistent config is clamped automatically.</p>
    <pre>&#123; "webjs": &#123; "maxBodyBytes": 262144, "maxMultipartBytes": 5242880, "requestTimeoutMs": 30000 &#125; &#125;</pre>

    <h2>Environment Variables</h2>
    <p>Use <code>process.env</code> in server-side code (pages, actions, route handlers, middleware). WebJs auto-loads <code>&lt;appDir&gt;/.env</code> into <code>process.env</code> once at boot using Node 24+'s built-in <code>process.loadEnvFile</code>, so a scaffolded app with a committed <code>.env.example</code> and a developer-copied <code>.env</code> just works without installing <code>dotenv</code> or wiring up the file path. The auto-load fires before any server-only module is imported, which matters for code that reads <code>process.env</code> at module-init time (e.g. <code>createAuth({ secret: process.env.AUTH_SECRET })</code>).</p>

    <p><strong>Precedence: shell wins over file.</strong> <code>process.loadEnvFile</code> does not override values that are already present in <code>process.env</code>, so values exported by the host shell or a process manager (Docker, systemd, Railway, Fly) take precedence over the same key in <code>.env</code>. This matches the Rails / Next / Astro convention: <code>.env</code> is for developer-local defaults; production secrets come from the platform.</p>

    <p><strong>No file, no problem.</strong> A missing <code>.env</code>, a malformed file, or running on Node without <code>loadEnvFile</code> all fail silently. The server still boots; only the missing values are <code>undefined</code> (the same way a typo would be).</p>

    <p>Override per-invocation by passing values on the command line:</p>
    <pre>DATABASE_URL=postgres://... npm start</pre>

    <h3>Validating env vars at boot (env.{js,ts})</h3>
    <p>The auto-load populates <code>process.env</code> but does not check it, so a missing or misconfigured required var (an absent <code>DATABASE_URL</code>, a too-short <code>AUTH_SECRET</code>) fails late and cryptically: a database connection error mid-request, an undefined secret signing a token. Add an optional <code>env.{js,ts}</code> module at the app root (a sibling of <code>middleware.js</code> and <code>readiness.js</code>) that default-exports a schema, and WebJs validates the environment at boot and <strong>fails fast</strong> with one message listing every problem at once.</p>
    <pre>// env.ts (app root)
export default {
  DATABASE_URL: 'string',                                   // required by default
  AUTH_SECRET: { type: 'string', required: true, minLength: 16 },
  PORT: { type: 'number', optional: true, default: 8080 },  // coerced + defaulted (webjs default port)
  NODE_ENV: { type: 'enum', values: ['development', 'production', 'test'] },
};</pre>
    <p>Each field is a type name (<code>'string'</code>) or an options object. Supported types: <code>string</code>, <code>number</code>, <code>boolean</code>, <code>url</code>, <code>enum</code>. A field is <strong>required by default</strong>; mark it <code>optional: true</code> (or give it a <code>default</code>) to allow it to be absent. String fields support <code>minLength</code> and a <code>pattern</code> (a RegExp or string); <code>enum</code> fields take a <code>values</code> array. Coerced values (a <code>number</code>, a <code>boolean</code>) and applied defaults are written back to <code>process.env</code>, so the app reads the coerced value.</p>
    <p><strong>Fails fast, reports everything.</strong> On a validation failure the server does not start. It throws a clear, aggregated Error naming every offending var and what is wrong (missing, wrong type, failed constraint), so the CLI exits non-zero and an embedded host rejects at boot. The whole list is reported at once, never one error at a time.</p>
    <p><strong>Escape hatch: a function validator.</strong> Instead of a schema object, default-export a function <code>(env) =&gt; void</code>. It runs at boot with the env object and any thrown Error becomes the boot failure. This is how an app uses zod (or any validator) without WebJs depending on it:</p>
    <pre>// env.ts (function form)
import { z } from 'zod';
const schema = z.object({ DATABASE_URL: z.string().url(), AUTH_SECRET: z.string().min(16) });
export default (env) =&gt; { schema.parse(env); };</pre>
    <p>The whole feature is opt-in: with no <code>env.{js,ts}</code> at the app root, nothing changes.</p>

    <h3>Server-only env vars (the default)</h3>
    <p>Any environment variable that does not start with <code>WEBJS_PUBLIC_</code> is <strong>server-only</strong>. It is never sent to the browser. <code>DATABASE_URL</code>, <code>AUTH_SECRET</code>, OAuth client secrets, third-party API keys: read them in server actions, route handlers, middleware, or page functions, and pass derived values (not the raw secret) to components.</p>

    <h3>Public env vars (WEBJS_PUBLIC_*)</h3>
    <p>Any env var whose name starts with <code>WEBJS_PUBLIC_</code> is exposed to the browser as <code>process.env.WEBJS_PUBLIC_X</code>. WebJs injects an inline script in the SSR'd HTML head that sets <code>window.process.env</code> before any user code or vendor bundle runs. Components can read these directly:</p>
    <pre>// .env at the app root (auto-loaded at boot)
WEBJS_PUBLIC_API_URL=https://api.example.com
WEBJS_PUBLIC_STRIPE_KEY=pk_live_abc
SENTRY_DSN=https://x@sentry.io/y      # server-only, no prefix

// components/checkout.ts
class Checkout extends WebComponent {
  render() {
    return html\`&lt;a href=\${process.env.WEBJS_PUBLIC_API_URL + '/pay'}&gt;Pay&lt;/a&gt;\`;
  }
}</pre>
    <p>This is the no-build equivalent of Next.js's <code>NEXT_PUBLIC_</code> convention. There is no transform step. The value is a real property read on a real <code>window.process.env</code> object in the browser.</p>

    <p><strong>NODE_ENV is always defined in the browser.</strong> The shim sets <code>process.env.NODE_ENV</code> to <code>'development'</code> in <code>webjs dev</code> or <code>'production'</code> in <code>webjs start</code>. Vendor bundles that probe <code>process.env.NODE_ENV</code> (lit, react, others) read the right value with no extra config.</p>

    <p><strong>Naming and safety.</strong> The prefix is fail-closed. An env var without <code>WEBJS_PUBLIC_</code> in its name cannot accidentally reach the browser at runtime, even if a component naively writes <code>process.env.DATABASE_URL</code>. The value will read as <code>undefined</code>, the same way a typo would. There is no way to opt out of the prefix, by design.</p>

    <p><strong>The SSR-time gap, and the lint rule that closes it.</strong> A component's <code>render()</code> runs on the server during SSR. If a component reads <code>process.env.SECRET</code> there and interpolates it into the HTML output, the secret gets shipped to every browser even though the runtime shim does not expose it. To catch this at write time, <code>webjs check</code> ships a <code>no-server-env-in-components</code> rule that flags any <code>process.env.X</code> read in a component file when <code>X</code> is not <code>WEBJS_PUBLIC_*</code> and not <code>NODE_ENV</code>. The fix is always one of: rename to <code>WEBJS_PUBLIC_*</code> if the value is intended for the browser, or read it in a page function / server action / middleware and pass a derived value to the component as an attribute.</p>

    <h2>Programmatic API</h2>
    <pre>import { startServer, createRequestHandler } from '@webjsdev/server';

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
</pre>

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
