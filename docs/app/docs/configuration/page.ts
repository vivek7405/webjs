import { html } from '@webjskit/core';

export const metadata = { title: 'Configuration — webjs' };

export default function Configuration() {
  return html`
    <h1>Configuration</h1>
    <p>webjs is designed to work with <strong>zero configuration</strong>. File conventions handle routing, TypeScript works out of the box, and the server is pre-configured with sensible defaults. This page documents what you <em>can</em> configure when you need to.</p>

    <h2>CLI Options</h2>
    <h3>webjs dev</h3>
    <pre>webjs dev [--port 3000]</pre>
    <ul>
      <li><code>--port</code> — dev server port (default: <code>3000</code>, or <code>PORT</code> env var)</li>
      <li>File watching via chokidar (automatic)</li>
      <li>Live reload via SSE (<code>/__webjs/events</code>)</li>
      <li>TypeScript files transformed on the fly</li>
      <li>No cache-busting needed — module loads are busted per request</li>
    </ul>

    <h3>webjs start</h3>
    <pre>webjs start [--port 3000] [--http2 --cert &lt;path&gt; --key &lt;path&gt;]</pre>
    <ul>
      <li><code>--port</code> — production server port</li>
      <li><code>--http2 --cert &lt;pem&gt; --key &lt;pem&gt;</code> — serve HTTP/2 over TLS (falls back to H1.1 if cert/key missing)</li>
      <li>gzip/brotli compression enabled by default</li>
      <li>Static file ETag + Cache-Control headers</li>
      <li>Graceful shutdown on SIGTERM/SIGINT</li>
      <li>JSON logger (structured, one line per event)</li>
    </ul>

    <h3>webjs build</h3>
    <pre>webjs build [--no-minify] [--no-sourcemap]</pre>
    <ul>
      <li>Bundles all client-facing modules (components, pages, layouts) into <code>.webjs/bundle.js</code> via esbuild</li>
      <li>Optional — the framework works without it (no-build by default)</li>
      <li>If the bundle exists, production mode serves it instead of per-file imports</li>
    </ul>

    <h3>webjs db</h3>
    <pre>webjs db generate     # prisma generate
webjs db migrate &lt;name&gt;  # prisma migrate dev
webjs db studio       # prisma studio</pre>

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
      <li><code>noEmit</code> — type-check only, no compiled output (preserves no-build)</li>
      <li><code>allowImportingTsExtensions</code> — needed for explicit <code>.ts</code> in imports</li>
      <li><code>checkJs</code> — type-check <code>.js</code> files too (for mixed codebases)</li>
    </ul>

    <h2>Environment Variables</h2>
    <p>Use <code>process.env</code> in server-side code (pages, actions, route handlers, middleware). There's no built-in <code>.env</code> loader — use <code>dotenv</code> or pass vars via the shell:</p>
    <pre>DATABASE_URL=postgres://... webjs start</pre>
    <blockquote><strong>Warning:</strong> never reference <code>process.env</code> in component code that runs on the client. It's undefined in the browser and would leak server secrets if it worked.</blockquote>

    <h2>Programmatic API</h2>
    <pre>import { startServer, createRequestHandler } from '@webjskit/server';

// Option 1: Full server
await startServer({
  appDir: process.cwd(),
  port: 3000,
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
      <li><strong>Routing conventions</strong> — <code>page.ts</code>, <code>layout.ts</code>, <code>route.ts</code>, <code>middleware.ts</code>, <code>error.ts</code>, <code>not-found.ts</code> are the file names. No aliases.</li>
      <li><strong>Shadow DOM by default</strong> — components use shadow DOM unless <code>static shadow = false</code>. No global opt-out.</li>
      <li><strong>CSRF on server actions</strong> — always on for <code>/__webjs/action/*</code> RPC. Can't disable.</li>
      <li><strong>Import map</strong> — auto-generated. Maps <code>@webjskit/core</code> sub-paths to framework-served URLs and any bare npm imports your client code uses to vendor bundles.</li>
    </ul>
  `;
}
