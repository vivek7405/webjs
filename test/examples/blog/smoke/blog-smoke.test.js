/**
 * Blog runtime smoke test: boots `webjs dev` against examples/blog/ and
 * asserts every migrated surface still renders correctly.
 *
 * Unlike the puppeteer-based `test/e2e.test.mjs` (gated behind
 * WEBJS_E2E=1, requires Chromium), this is a fetch-only test that always
 * runs as part of `npm test`. The trade-off: no JS execution, no
 * hydration check: just SSR HTML + HTTP status assertions. Catches the
 * specific regression classes the recent Tier-1/Tier-2 migration would
 * introduce:
 *   - stale `<ui-button>`/`<ui-card>`/etc. tags in any migrated page
 *   - missing class-helper output (e.g. cardClass returns its tailwind
 *     string and that string appears in /login HTML)
 *   - Tier-2 `<ui-dialog>` rendering on /ui-demo
 *   - server boot failures from broken imports in the migrated files
 *
 * Skipped automatically when the blog DB hasn't been migrated yet
 * (predev/prestart hooks usually handle this, but in a fresh CI clone
 * with no migrations, just skip rather than fail).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..', '..');
const BLOG_DIR = resolve(ROOT, 'examples', 'blog');

/** Bind to port 0, capture the assigned port, release. Race-free enough for a serial test. */
function freePort() {
  return new Promise((resolveP, rejectP) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rejectP);
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolveP(port));
    });
  });
}

const skip =
  !existsSync(resolve(BLOG_DIR, 'package.json')) ||
  !existsSync(resolve(BLOG_DIR, 'db', 'dev.db'));

describe('Blog smoke (Tier-1/Tier-2 migration)', { skip: skip && 'blog or its DB not present' }, () => {
  let proc, baseUrl;

  before(async () => {
    const port = await freePort();
    baseUrl = `http://localhost:${port}`;

    proc = spawn('node', [resolve(ROOT, 'packages/cli/bin/webjs.js'), 'dev', '--port', String(port)], {
      cwd: BLOG_DIR,
      env: { ...process.env, WEBJS_TS_VERBOSE: '0' },
      // ignore stdio so the OS doesn't fill an unread pipe buffer and
      // block webjs dev's output. The request logs would otherwise
      // saturate ~64KB and freeze the child.
      stdio: 'ignore',
      // Detach so SIGTERM in `after()` cleans up the whole process group
      // (webjs dev spawns its own node --watch child).
      detached: true,
    });
    // Avoid keeping the parent process alive on proc's behalf.
    proc.unref();

    // Wait for the server to print "ready" or for / to return 200.
    const start = Date.now();
    while (Date.now() - start < 15000) {
      try {
        const r = await fetch(baseUrl + '/');
        if (r.ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('blog dev server did not become ready within 15s');
  });

  after(async () => {
    if (!proc) return;
    // Signal the whole detached process group so the node --watch child
    // and the dev server child both get the signal.
    try { process.kill(-proc.pid, 'SIGTERM'); } catch {}
    await new Promise((r) => setTimeout(r, 300));
    try { process.kill(-proc.pid, 'SIGKILL'); } catch {}
  });

  test('routes return expected status codes', async () => {
    const cases = [
      ['/',                       200],
      ['/login',                  200],
      ['/about',                  200],
      ['/ui-demo',                200],
      ['/api/hello',              200],
      ['/api/posts',              200],
      ['/dashboard',              302], // auth gate
      ['/blog/does-not-exist',    404],
    ];
    for (const [path, expected] of cases) {
      const r = await fetch(baseUrl + path, { redirect: 'manual' });
      assert.equal(r.status, expected, `${path} returned ${r.status}, expected ${expected}`);
    }
  });

  test('homepage modulepreload hints all resolve (no 404 preload)', async () => {
    // Browserless guard for the #158 / #159 class: the served HTML must never
    // emit a <link rel="modulepreload"> for a file the server then 404s
    // (server-only deps reached through a .server file, or an import shown as
    // code inside a template literal). Fast HTTP-only check, no browser.
    const html = await (await fetch(baseUrl + '/')).text();
    const hrefs = [...html.matchAll(/<link[^>]+rel=["']modulepreload["'][^>]*href=["']([^"']+)["']/g)]
      .map((m) => m[1])
      .filter((h) => h.startsWith('/'));
    assert.ok(hrefs.length > 0, 'expected at least one same-origin modulepreload to probe');
    const broken = [];
    for (const h of hrefs) {
      const r = await fetch(baseUrl + h);
      if (r.status >= 400) broken.push(`${h} -> ${r.status}`);
    }
    assert.equal(broken.length, 0, `modulepreload hints must all resolve; broken:\n${broken.join('\n')}`);
  });

  test('homepage is import-only: app/page.ts is dropped from the boot (#619)', async () => {
    // The home page does no client work of its own; it only imports interactive
    // components. Its lib/utils/cn.ts dependency used to drag a customElements
    // reference (dead Base/defineElement helpers) into the page closure, which
    // pinned the whole page module. With that dead code removed, the page is
    // import-only: the boot emits its interactive leaves directly and drops
    // app/page.ts. Regression guard for the #619 dogfood fix.
    const html = await (await fetch(baseUrl + '/')).text();
    const boot = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)]
      .map((m) => m[1])
      .join('\n');
    const specs = [...boot.matchAll(/import\s+["']([^"']+)["']/g)].map((m) => m[1]);
    const pageInBoot = specs.some((s) => /\/app\/page\.(ts|js)/.test(s));
    const counterInBoot = specs.some((s) => /counter\.(ts|js)/.test(s));
    assert.equal(pageInBoot, false, `app/page.ts must NOT be in the boot (import-only). boot specs: ${specs.join(', ')}`);
    assert.ok(counterInBoot, 'the interactive leaves are emitted directly (counter present)');
  });

  test('/login renders class-helper output, not stale <ui-X> tags', async () => {
    const html = await fetch(baseUrl + '/login').then((r) => r.text());

    // Characteristic buttonClass() output.
    assert.match(html, /bg-primary text-primary-foreground hover:bg-primary/);
    // Characteristic inputClass() output.
    assert.match(html, /border-input/);
    // Characteristic labelClass() output. The full string is
    // "flex items-center gap-2 text-sm leading-none font-medium …".
    // Pin on a unique stretch.
    assert.match(html, /text-sm leading-none font-medium/);
    // Characteristic cardClass() output.
    assert.match(html, /rounded-xl border bg-card/);

    // No stale Tier-1 tags.
    for (const tag of ['ui-button', 'ui-card', 'ui-card-header', 'ui-card-content', 'ui-input', 'ui-label', 'ui-alert', 'ui-badge']) {
      assert.doesNotMatch(html, new RegExp(`<${tag}\\b`), `/login should not render <${tag}>`);
    }
  });

  test('/ui-demo renders BOTH class-helper output AND Tier-2 ui-dialog', async () => {
    const html = await fetch(baseUrl + '/ui-demo').then((r) => r.text());

    // Tier 1: cardClass + buttonClass output present.
    assert.match(html, /rounded-xl border bg-card/, 'cardClass output present');
    assert.match(html, /bg-primary text-primary-foreground hover:bg-primary/, 'buttonClass output present');

    // Tier 2: <ui-dialog> + subparts rendered as custom elements.
    for (const tag of ['ui-dialog', 'ui-dialog-trigger', 'ui-dialog-content']) {
      assert.match(html, new RegExp(`<${tag}\\b`), `expected <${tag}> on /ui-demo`);
    }

    // The dialog role belongs on the native <dialog>, and NOWHERE else in the
    // rendered output. The native element has an implicit dialog role of its
    // own, so a second one on the inner content div exposes two nested
    // dialog-family nodes to a screen reader. This is the first paint, which is
    // where render() puts the role, so it is observable here.
    assert.match(
      html,
      /<dialog[^>]*data-slot="dialog-native"[^>]*role="dialog"|<dialog[^>]*role="dialog"[^>]*data-slot="dialog-native"/,
      'the native <dialog> should carry role="dialog"',
    );
    const contentDiv = html.match(/<div[^>]*data-slot="dialog-content"[^>]*>/)?.[0] ?? '';
    assert.ok(contentDiv, 'the dialog content panel should render');
    assert.doesNotMatch(contentDiv, /\brole=/, `the content panel must carry no second dialog role: ${contentDiv}`);
    // aria-modal is redundant on a showModal()-opened native dialog, which the
    // platform already exposes as modal.
    assert.doesNotMatch(html, /aria-modal/, '/ui-demo should serve no aria-modal');

    // No stale Tier-1 tags.
    for (const tag of ['ui-button', 'ui-card', 'ui-card-header', 'ui-input', 'ui-label', 'ui-alert', 'ui-badge']) {
      assert.doesNotMatch(html, new RegExp(`<${tag}\\b`), `/ui-demo should not render <${tag}>`);
    }
  });

  test('/api/hello returns valid JSON', async () => {
    const r = await fetch(baseUrl + '/api/hello');
    const json = await r.json();
    assert.equal(typeof json.hello, 'string');
  });

  test('/ chat-box SSR shows "Connecting…" (not the alarming "Reconnecting…") before JS runs', async () => {
    // Before the chat-box fix the initial SSR copy was "Reconnecting…"
    // with an accent warning dot. A user landing on a cold page saw
    // that for the ~500ms it took the WS handshake to complete and
    // mistakenly read the page as broken. The component now SSRs a
    // neutral "Connecting…" state and only transitions to
    // "Reconnecting…" after a real close event.
    const html = await fetch(baseUrl + '/').then((r) => r.text());
    assert.match(html, /<chat-box\b/, 'chat-box element should be present');
    assert.match(html, /Connecting…/, 'SSR should render "Connecting…" before JS hydration');
    assert.doesNotMatch(html, /Reconnecting…/, 'SSR must NOT render "Reconnecting…" on first paint');
  });

  test('/stream-demo: async render data is in the first paint, the slow boundary STREAMS (#469/#471/#473)', async () => {
    // Server-pipeline integration for async render plus webjs-suspense. The
    // greeting is fetched IN the component (async render) and must be in the
    // SSR HTML with no JS, while the slow fact streams behind a fallback.
    const r = await fetch(baseUrl + '/stream-demo');
    assert.equal(r.status, 200);
    const html = await r.text();
    // async render bakes the data into the first paint (PE-safe, JS-off reads it).
    assert.match(html, /class="async-greeting"/, 'the async component rendered');
    assert.match(html, /Hello, world!/, 'async render data is in the first paint, no JS needed');
    // The slow region is wrapped in a streaming boundary: the fallback is the
    // placeholder, and the content streams in as a data-webjs-resolve template.
    assert.match(html, /<webjs-suspense id="s\d+">/, 'the boundary placeholder carries an id');
    assert.match(html, /loading the fact/, 'the boundary fallback flushed first');
    assert.match(html, /<!--wj-stream-shell-->/, 'the shell-ready sentinel is emitted for progressive soft-nav');
    assert.match(html, /<template data-webjs-resolve="s\d+">/, 'the boundary streamed a resolve template');
    assert.match(html, /The answer is 42\./, 'the slow content streamed in');
  });

  test('/stream-demo: a JS-off client reads the async-render data but NOT the streamed content', async () => {
    // Progressive enhancement: blocking async render is in the HTML; the
    // streamed boundary needs JS to swap (its fallback is what no-JS sees).
    const html = await fetch(baseUrl + '/stream-demo').then((r) => r.text());
    // The async greeting (blocking) is readable with JS off.
    assert.match(html, /Hello, world!/, 'blocking async render is PE-safe (in the HTML)');
    // The streamed fact's fallback is in the boundary element; without JS the
    // swap script never runs, so the fallback is what a no-JS client keeps.
    assert.match(html, /<webjs-suspense id="s\d+">[\s\S]*?loading the fact/, 'the no-JS client sees the boundary fallback');
  });
});
