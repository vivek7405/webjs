/**
 * Web Test Runner configuration.
 *
 * Runs browser tests (components, directives, interactions) in real Chromium
 * via Playwright. Server tests (actions, queries) use node:test.
 *
 *   test/<feature>/<file>.test.ts             ← node tests
 *   test/<feature>/browser/<file>.test.js     ← this runner
 *
 * Run:
 *   webjs test              # runs both server + browser tests
 *   webjs test --browser    # browser tests only
 *   webjs test --server     # server tests only
 *
 * A webjs browser test imports the REAL app: a `.ts` component that imports a
 * `'use server'` action. Plain web-test-runner serves raw TypeScript with no
 * transform, so that never loads. This config proxies every module request to
 * the webjs dev pipeline via `createBrowserTestHandler`, so the browser gets
 * the SAME output as `webjs dev`: TypeScript stripped, a `.server.ts` import
 * rewritten to a typed RPC stub, `#`-alias imports resolved, `@webjsdev/core`
 * served, and the importmap injected. (#806)
 */
import { playwrightLauncher } from '@web/test-runner-playwright';
import { createBrowserTestHandler } from '@webjsdev/server/testing';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';

// One webjs handler for the app, warmed once and shared. Top-level await so the
// importmap is ready before `testRunnerHtml` is called for the first test file.
const webjs = await createBrowserTestHandler(resolve('.'));

export default {
  // Browser tests are `.js` (web-test-runner serves them through its own test
  // framework); the components + modules they import are `.ts`, served
  // transformed by the webjs middleware below.
  // Browser tests live under any `browser/` dir: the top-level `test/<feature>/
  // browser/`, OR co-located next to the code they exercise (a component's
  // `modules/<feature>/components/browser/`, the modules-architecture default).
  files: [
    'test/**/browser/**/*.test.js',
    'app/**/browser/**/*.test.js',
    'modules/**/browser/**/*.test.js',
    'components/**/browser/**/*.test.js',
  ],
  // webjs's importmap resolves `@webjsdev/core`, the `#` app aliases, and
  // vendors, so web-test-runner must NOT rewrite bare specifiers to
  // node_modules paths.
  nodeResolve: false,
  // Inject the webjs importmap so a bare / `#`-aliased import in a served module
  // resolves in the browser exactly as it does under `webjs dev`.
  testRunnerHtml: (testFrameworkImport) =>
    `<!DOCTYPE html>
<html>
  <head>${webjs.importmapHtml()}</head>
  <body>
    <script type="module" src="${testFrameworkImport}"></script>
  </body>
</html>`,
  middleware: [
    async (ctx, next) => {
      // web-test-runner owns: its own internals (/__web-test-runner,
      // /__web-dev-server, /__wds), the TEST FILES themselves (it wraps each
      // for the test framework), and the DOCUMENT navigation (the test-runner
      // HTML page, `Sec-Fetch-Dest: document`). If webjs served the page, WTR's
      // test bootstrap would never load and the session would time out. NOTE:
      // match the WTR/WDS prefixes specifically, NOT a broad `/__web`, because
      // webjs's own paths are `/__webjs/...` and MUST be proxied below.
      if (
        ctx.path.startsWith('/__web-test-runner') ||
        ctx.path.startsWith('/__web-dev-server') ||
        ctx.path.startsWith('/__wds') ||
        /\.test\.(js|mjs)$/.test(ctx.path) ||
        (ctx.get('sec-fetch-dest') || '') === 'document'
      ) {
        return next();
      }
      // The dev live-reload SSE has no meaning in a test run; short-circuit it
      // so it neither hangs nor logs a 404.
      if (ctx.path === '/__webjs/events') {
        ctx.status = 204;
        return;
      }
      // Everything else (a `.ts` component, a `.server.ts` action, the `#`
      // alias, `/__webjs/core/*`, vendors) goes through the webjs dev pipeline.
      // A GET/HEAD has no body; a POST (a browser test firing an action RPC)
      // carries one. `ctx.req` is a Node IncomingMessage, so wrap it in a web
      // ReadableStream (the same `Readable.toWeb` the server's own request
      // bridge uses), NOT pass the raw Node stream.
      const hasBody = ctx.method !== 'GET' && ctx.method !== 'HEAD';
      const req = new Request(`http://localhost${ctx.originalUrl || ctx.url}`, {
        method: ctx.method,
        headers: ctx.headers,
        body: hasBody ? Readable.toWeb(ctx.req) : undefined,
        duplex: 'half',
      });
      const res = await webjs.handle(req);
      // A 404 means webjs does not own this path; let web-test-runner try.
      if (res.status === 404) return next();
      ctx.status = res.status;
      // Copy headers, but handle Set-Cookie separately: `Headers.forEach`
      // comma-joins multiple Set-Cookie into one malformed value, so use
      // `getSetCookie()` and append each (an action driving a multi-cookie auth
      // flow would otherwise lose a cookie in the browser).
      res.headers.forEach((value, key) => { if (key.toLowerCase() !== 'set-cookie') ctx.set(key, value); });
      for (const cookie of res.headers.getSetCookie?.() ?? []) ctx.append('set-cookie', cookie);
      ctx.body = Buffer.from(await res.arrayBuffer());
    },
  ],
  browsers: [playwrightLauncher({ product: 'chromium' })],
  testFramework: {
    config: {
      ui: 'tdd',
      timeout: 10000,
    },
  },
};
