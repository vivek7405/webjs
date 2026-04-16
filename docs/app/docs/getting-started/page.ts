import { html } from 'webjs';

export const metadata = { title: 'Getting Started — webjs' };

export default function GettingStarted() {
  return html`
    <h1>Getting Started</h1>
    <p>webjs is a <strong>no-build, web-components-first</strong> full-stack framework inspired by NextJs and Lit. You can use it as a full-stack framework with server-rendered pages, or as a lightweight backend-only API framework — the same file conventions work either way.</p>

    <h2>Prerequisites</h2>
    <ul>
      <li><strong>Node.js 23.6+</strong> — required for native TypeScript type-stripping. Node 20+ works if you stick to plain JavaScript.</li>
      <li><strong>npm</strong> (or any package manager).</li>
    </ul>

    <h2>Quick Start</h2>
    <pre>git clone https://github.com/vivek7405/webjs
cd webjs && npm install

cd examples/blog
npx prisma migrate dev --name init
npx webjs dev
# → http://localhost:3000</pre>

    <p>Open the blog in a browser. You'll see a full-featured app with posts, comments, live chat, auth, and a counter — all built on webjs.</p>

    <h2>Create a New App</h2>
    <p>To start from scratch, create a directory with this structure:</p>
    <pre>my-app/
├── app/
│   ├── layout.ts     # root layout wrapping every page
│   ├── page.ts       # home page at /
│   └── api/
│       └── hello/
│           └── route.ts   # GET /api/hello
├── components/
│   └── counter.ts    # interactive web component
├── package.json
└── tsconfig.json     # optional, for type-checking</pre>

    <h3>package.json</h3>
    <pre>{
  "name": "my-app",
  "type": "module",
  "scripts": {
    "dev": "webjs dev",
    "start": "webjs start"
  },
  "dependencies": {
    "@webjs/cli": "0.1.0",
    "@webjs/server": "0.1.0",
    "webjs": "0.1.0"
  }
}</pre>

    <h3>app/layout.ts</h3>
    <pre>import { html } from 'webjs';

export default function Layout({ children }: { children: unknown }) {
  return html\`
    &lt;h1&gt;My App&lt;/h1&gt;
    \${children}
  \`;
}</pre>

    <h3>app/page.ts</h3>
    <pre>import { html } from 'webjs';
import '../components/counter.ts';

export default function Home() {
  return html\`
    &lt;p&gt;Welcome to webjs!&lt;/p&gt;
    &lt;my-counter count="0"&gt;&lt;/my-counter&gt;
  \`;
}</pre>

    <h3>components/counter.ts</h3>
    <pre>import { WebComponent, html, css } from 'webjs';

export class Counter extends WebComponent {
  static tag = 'my-counter';
  static properties = { count: { type: Number } };
  static styles = css\`
    :host { display: inline-flex; gap: 8px; }
    button { font: inherit; padding: 4px 12px; }
  \`;
  count = 0;

  render() {
    return html\`
      &lt;button @click=\${() =&gt; { this.count--; this.requestUpdate(); }}&gt;−&lt;/button&gt;
      &lt;span&gt;\${this.count}&lt;/span&gt;
      &lt;button @click=\${() =&gt; { this.count++; this.requestUpdate(); }}&gt;+&lt;/button&gt;
    \`;
  }
}
Counter.register(import.meta.url);</pre>

    <h3>Run it</h3>
    <pre>npx webjs dev
# → http://localhost:3000</pre>

    <p>That's it — no build step, no bundler config, no compilation. Edit any <code>.ts</code> file, refresh, and see it.</p>

    <h2>How It Works</h2>
    <ul>
      <li><strong>Server-side:</strong> Node 23.6+ strips TypeScript types at runtime. Your <code>.ts</code> pages and server actions run directly.</li>
      <li><strong>Client-side:</strong> The dev server transforms <code>.ts</code> files via esbuild (~1ms/file, cached by mtime) before serving to the browser.</li>
      <li><strong>SSR:</strong> Pages are rendered to HTML strings on the server. Web components emit Declarative Shadow DOM so the browser paints before JS loads.</li>
      <li><strong>Hydration:</strong> When JS loads, custom elements upgrade and become interactive. The fine-grained renderer preserves focus, cursor position, and form state across state updates.</li>
    </ul>

    <h2>Next Steps</h2>
    <ul>
      <li><a href="/docs/routing">Routing</a> — file-based routing inspired by NextJs App Router</li>
      <li><a href="/docs/components">Components</a> — web components with shadow DOM + scoped styles</li>
      <li><a href="/docs/server-actions">Server Actions</a> — type-safe server functions callable from client components</li>
      <li><a href="/docs/backend-only">Backend-Only Mode</a> — use webjs as a pure API framework</li>
    </ul>
  `;
}
