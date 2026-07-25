import { html } from '@webjsdev/core';

export const metadata = { title: 'Runtime (Node & Bun) | WebJs' };

export default function Runtime() {
  return html`
    <h1>Runtime</h1>
    <p>WebJs runs on <strong>Node 24+</strong> or <strong>Bun</strong>. The same app source runs on either; the framework picks a runtime-neutral path internally and only the listener shell, the type stripper, and a few built-ins differ. Deno is a planned target (the listener seam is already runtime-neutral), not yet supported. This page is the single reference for the per-runtime commands and differences; other pages link here rather than repeat them.</p>

    <p>Related reading:</p>
    <ul>
      <li><a href="/docs/getting-started">Getting Started</a> for scaffolding an app.</li>
      <li><a href="/docs/no-build">No-Build Model</a> for how source is served.</li>
      <li><a href="/docs/deployment">Deployment</a> for shipping a container.</li>
    </ul>

    <h2>Node vs Bun at a glance</h2>
    <table>
      <thead>
        <tr><th>Area</th><th>Node 24+</th><th>Bun</th><th>Deno</th></tr>
      </thead>
      <tbody>
        <tr><td>Install</td><td><code>npm install</code></td><td><code>bun install</code> (required, like Node)</td><td>planned</td></tr>
        <tr><td>Run</td><td><code>npm run dev</code> / <code>npm run start</code></td><td><code>bun run dev</code> / <code>bun run start</code></td><td>planned</td></tr>
        <tr><td>Listener</td><td><code>node:http</code> shell</td><td>native <code>Bun.serve</code> (about 1.9x req/s on the listening path)</td><td>planned</td></tr>
        <tr><td>TypeScript stripping</td><td>built-in <code>module.stripTypeScriptTypes</code></td><td><code>amaro</code></td><td>planned</td></tr>
        <tr><td>SQLite driver</td><td>built-in <code>node:sqlite</code></td><td>built-in <code>bun:sqlite</code></td><td>planned</td></tr>
        <tr><td>Hot reload</td><td><code>node --watch</code></td><td><code>bun --hot</code></td><td>planned</td></tr>
        <tr><td>WebSocket</td><td>the <code>ws</code> library</td><td>native <code>Bun.serve</code> (bridged to the same API)</td><td>planned</td></tr>
        <tr><td>103 Early Hints</td><td>yes</td><td>no (<code>Bun.serve</code> has no informational-response API)</td><td>planned</td></tr>
      </tbody>
    </table>
    <p>Either way the <code>.ts</code> stripping is position-preserving with no sourcemap, and the bytes the browser fetches are identical. The 103 Early Hints gap only costs a small first-load latency edge where your edge forwards 103, never correctness (the modulepreload hints still ship in the document head).</p>

    <h2>Node (the default)</h2>
    <p>Scaffold with <code>webjs create my-app</code> (Node is the default runtime). Then:</p>
    <pre>npm install
npm run dev      # or: npm run start</pre>
    <p>Node 24+ is required: the built-in TypeScript stripper (<code>module.stripTypeScriptTypes</code>, stable from Node 24) and recursive <code>fs.watch</code> need it. The CLI's <code>assertNodeVersion()</code> preflight enforces the floor.</p>

    <h2>Bun</h2>
    <p>Scaffold with <code>webjs create my-app --runtime bun</code>, or <code>bun create webjs my-app</code> (the runtime is auto-detected from the invoking package manager). Then:</p>
    <pre>bun install
bun run dev      # or: bun run start</pre>
    <p>A Bun app installs with <code>bun install</code> (like Node), then runs on Bun: its <code>dev</code> / <code>start</code> / <code>db</code> scripts force <code>bun --bun</code>, which overrides the <code>webjs</code> bin's Node shebang so the server runs on Bun, where it selects the native <code>Bun.serve</code> listener and strips types via <code>amaro</code>. The dependencies resolve from <code>node_modules</code>, the same as Node.</p>
    <p>The install also gives editor type intelligence (the editor reads the <code>.d.ts</code> files in <code>node_modules</code>).</p>

    <h3>Install model and reproducibility</h3>
    <p>A Bun app commits a <code>bun.lock</code> (the Bun analog of <code>package-lock.json</code>) for reproducible, offline installs. The scaffold's Bun Dockerfile runs <code>bun install</code> and serves on Bun via <code>CMD ["bun", "--bun", "run", "start"]</code>.</p>

    <h2>Future runtimes</h2>
    <p>The server's listener selection is a runtime-neutral seam: <code>startServer</code> chooses the <code>Bun.serve</code> shell on Bun and the <code>node:http</code> shell on Node through the same seam, which is designed to also host a <code>Deno.serve</code> or an embedded adapter later. When Deno support lands it will appear here. Edge runtimes with no filesystem are a separate, later target.</p>
  `;
}
