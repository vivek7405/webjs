/**
 * The component gallery shares the marketing site's chrome (#1099).
 *
 * The gallery used to live on ui.webjs.dev with its own root layout, nav,
 * footer, announce strip, and a duplicated `@theme` block. Moving it to
 * webjs.dev/ui is only half the point; the other half is that it now renders
 * inside the SAME shell every other page uses, and specifically inside the
 * same sidebar shell as /docs, so a reader crossing from the documentation
 * into the components does not leave one design system and enter another.
 *
 * Nothing about that is self-enforcing. Someone can reintroduce a gallery-only
 * header, a second theme toggle, or a duplicate token block and the pages will
 * still render fine, just as two subtly different sites again.
 *
 * Asserted against the REAL request pipeline rather than the layout function
 * in isolation, because "the gallery page ends up wrapped in the root layout"
 * is exactly the property under test.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@webjsdev/server';

const WEBSITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const UI_INDEX = '/ui';
const UI_COMPONENT = '/ui/button';
const DOC_PATH = '/docs/routing';
const MARKETING_PATH = '/what-is-webjs';

let handle: (path: string) => Promise<Response>;

before(async () => {
  const app = await createRequestHandler({ appDir: WEBSITE_ROOT, dev: false });
  await app.warmup?.();
  handle = (path) => app.handle(new Request('http://localhost' + path));
});

const bodyOf = async (path: string) => {
  const res = await handle(path);
  assert.equal(res.status, 200, `${path} should render`);
  return res.text();
};

function headerOf(html: string): string {
  const start = html.indexOf('<div class="site-top');
  assert.ok(start >= 0, 'the shared fixed header wrapper is present');
  const end = html.indexOf('</header>', start);
  assert.ok(end > start, 'the header closes');
  return html.slice(start, end);
}

function footerOf(html: string): string {
  const start = html.indexOf('<footer');
  assert.ok(start >= 0, 'a footer is present');
  return html.slice(start, html.indexOf('</footer>', start));
}

test('a gallery page renders the SAME header and footer as a marketing page', async () => {
  const [ui, marketing] = await Promise.all([bodyOf(UI_COMPONENT), bodyOf(MARKETING_PATH)]);
  assert.equal(headerOf(ui), headerOf(marketing), 'the header is the shared one, byte for byte');
  assert.equal(footerOf(ui), footerOf(marketing), 'and so is the footer');
});

test('there is exactly one header, one footer, and one theme toggle', async () => {
  // The real regression to guard is a SECOND set of chrome rendered by a
  // gallery-specific layout, which byte-comparing the first match cannot see.
  const ui = await bodyOf(UI_COMPONENT);
  assert.equal(ui.split('<div class="site-top').length - 1, 1, 'one header');
  assert.equal(ui.split('<footer').length - 1, 1, 'one footer');
  assert.equal(ui.split('<theme-toggle').length - 1, 1, 'one theme toggle, the shared one');
});

test('the gallery uses the SAME sidebar shell as the docs', async () => {
  // Not merely "has a sidebar": the same one, from lib/ui/docs-shell.ts. The
  // whole reason that module was extracted is that two hand-maintained
  // sidebars drift, which is how the old site ended up looking foreign.
  const [ui, docs] = await Promise.all([bodyOf(UI_COMPONENT), bodyOf(DOC_PATH)]);
  for (const marker of ['id="docs-sidebar"', 'class="docs-nav', 'class="docs-backdrop"']) {
    assert.ok(ui.includes(marker), `the gallery renders ${marker}`);
    assert.ok(docs.includes(marker), `and so do the docs, from the same shell`);
  }
});

test('the sidebar groups components under bare Tier 1 and Tier 2 headers', async () => {
  const ui = await bodyOf(UI_INDEX);
  assert.match(ui, />Tier 1</, 'Tier 1 section header');
  assert.match(ui, />Tier 2</, 'Tier 2 section header');
  // The old site spelled these out as "Tier 1 Class helpers" / "Tier 2 Custom
  // elements" in the nav. The tiers are explained on the introduction page;
  // the sidebar only needs to group.
  assert.ok(!/Tier 1\s*<span[^>]*>\s*Class helpers/.test(ui), 'no descriptive suffix in the nav');
});

test('/ui opens on the introduction, with no separate landing page', async () => {
  // A marketing landing page in front of the gallery is exactly what this
  // migration removed: /ui IS the gallery, the way /docs opens on Getting
  // Started rather than on a pitch for the documentation.
  const res = await handle(UI_INDEX);
  assert.equal(res.status, 200, '/ui renders directly, no redirect to a sub-path');
  const html = await res.text();
  assert.ok(html.includes('id="docs-sidebar"'), 'and it renders inside the gallery shell');
});

test('every component in the registry has a reachable page', async () => {
  // The sidebar is generated from the registry index, so a component that is
  // listed but whose page 404s would be an invisible dead link on every page
  // of the section.
  const { loadRegistryIndex } = await import('#modules/ui/queries/registry.server.ts');
  const components = (await loadRegistryIndex()).filter((i: any) => i.type === 'registry:ui');
  assert.ok(components.length > 20, `sanity: expected the full kit, got ${components.length}`);
  const dead: string[] = [];
  for (const c of components) {
    const res = await handle(`/ui/${c.name}`);
    if (res.status !== 200) dead.push(`/ui/${c.name} (${res.status})`);
  }
  assert.deepEqual(dead, [], `these components are listed but do not render:\n  ${dead.join('\n  ')}`);
});

test('a non-component registry item does not get a page', async () => {
  // Themes and lib items are registry artifacts with nothing to render. They
  // resolve through loadRegistryItem, so without the type guard they would
  // 200 on an empty shell and land in search results as blank pages.
  for (const slug of ['theme-zinc', 'theme-neutral', 'lib-utils']) {
    const res = await handle(`/ui/${slug}`);
    assert.equal(res.status, 404, `/ui/${slug} is not a component page`);
  }
});

test('the gallery declares no design tokens of its own', () => {
  // A second @theme block is how the two sites drifted apart the first time.
  const layout = readFileSync(resolve(WEBSITE_ROOT, 'app/ui/layout.ts'), 'utf8');
  assert.ok(!layout.includes('@theme'), 'the gallery sub-layout declares no tokens');
  assert.ok(
    !/--fg\s*:|--bg\s*:|--accent\s*:/.test(layout),
    'and redefines none of the core color tokens either'
  );
});

test('the kit palette is scoped to previews, so it cannot leak into the chrome', () => {
  // The shadcn values must live on .ui-preview, never on :root. Declared at
  // :root they would repaint the whole marketing site with the kit's neutral
  // palette. They also have to be declared through `@theme inline`, or the
  // utilities resolve their var() at :root (where the kit palette does not
  // exist) and every filled component in a preview renders transparent.
  const css = readFileSync(resolve(WEBSITE_ROOT, 'public/input.css'), 'utf8');
  const inlineBlock = css.match(/@theme inline\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(inlineBlock.includes('--color-primary'), 'the kit palette maps through @theme inline');
  assert.ok(inlineBlock.includes('--color-accent'), 'including accent, which the preview re-scopes');
  assert.match(css, /\.ui-preview\s*\{[^}]*--primary:/, 'raw values are scoped to .ui-preview');
  assert.ok(
    !/:root\s*\{[^}]*--primary:/.test(css),
    'and never declared at :root, which would repaint the whole site'
  );
});

test('the dark variant tracks the site theme, not just the OS preference', () => {
  // The kit's components carry `dark:` utilities and Tailwind's default `dark:`
  // is the OS preference alone, so without this override a reader on a dark OS
  // who picks light gets light page tokens and dark component internals. The
  // marketing pages use no `dark:` utilities, so the override is inert outside
  // previews, which is also why nothing else would catch its removal.
  const css = readFileSync(resolve(WEBSITE_ROOT, 'public/input.css'), 'utf8');
  const variant = css.match(/@custom-variant dark \{[\s\S]*?\n\}/)?.[0];
  assert.ok(variant, 'the dark variant is redefined');
  assert.match(variant!, /prefers-color-scheme: dark/, 'it still honours the OS preference');
  assert.match(variant!, /data-theme='light'/, 'an explicit light choice beats a dark OS');
  assert.match(variant!, /data-theme='dark'/, 'an explicit dark choice beats a light OS');
});

test('a preview pane carries the scoping class', async () => {
  const html = await bodyOf(UI_COMPONENT);
  assert.ok(html.includes('class="ui-preview'), 'the preview pane opts into the kit palette');
});

/**
 * The registry API is a RELEASED CONTRACT, so it is asserted at the location
 * that now serves it.
 *
 * The redirect test covers the old host's `Location` strings, but a correct
 * redirect into a broken endpoint is still a broken `webjs ui add`, and
 * nothing else here exercised these routes. `/ui/registry` is also a static
 * segment sitting next to the `[name]` page route, so precedence is part of
 * the contract rather than an implementation detail.
 */
test('the registry endpoints serve the shapes a published CLI fetches', async () => {
  const manifest = await handle('/ui/registry');
  assert.equal(manifest.status, 200, 'the full manifest answers');
  assert.equal(manifest.headers.get('content-type'), 'application/json');
  const parsedManifest = JSON.parse(await manifest.text());
  assert.ok(Array.isArray(parsedManifest.items), 'the manifest carries its items');

  const index = await handle('/ui/registry/index.json');
  assert.equal(index.status, 200, 'the flat index answers');
  const items = JSON.parse(await index.text());
  assert.ok(Array.isArray(items) && items.some((i: any) => i.name === 'button'), 'the index lists components');

  // The item shape the CLI parses: `webjsui add` builds `<base>/<name>.json`
  // and reads `files[].content`. An item without inlined content installs an
  // empty file, which is worse than a 404.
  const item = await handle('/ui/registry/button.json');
  assert.equal(item.status, 200);
  const button = JSON.parse(await item.text());
  assert.equal(button.name, 'button');
  assert.equal(button.type, 'registry:ui');
  assert.ok(button.files?.[0]?.content?.includes('buttonClass'), 'the source is inlined, not an empty stub');

  // A synthesized theme resolves through the same route.
  assert.equal((await handle('/ui/registry/theme-zinc.json')).status, 200);
  // And an unknown item is a 404 rather than an empty 200.
  assert.equal((await handle('/ui/registry/does-not-exist.json')).status, 404);
});

test('the registry reserved slugs and CORS survive the move', async () => {
  // `index` and `registry` are reserved slugs the old host answered, carried
  // over verbatim; the CLI relies on them.
  for (const [slug, check] of [
    ['index', (v: any) => Array.isArray(v)],
    ['registry', (v: any) => Array.isArray(v.items)],
  ] as const) {
    const res = await handle(`/ui/registry/${slug}.json`);
    assert.equal(res.status, 200, `${slug} answers`);
    assert.ok(check(JSON.parse(await res.text())), `${slug} returns its documented shape`);
  }
  // The registry is fetched cross-origin by tooling; the old endpoints sent
  // this and dropping it would break a browser-context consumer.
  for (const path of ['/ui/registry', '/ui/registry/index.json', '/ui/registry/button.json']) {
    assert.equal(
      (await handle(path)).headers.get('access-control-allow-origin'),
      '*',
      `${path} is CORS-open`,
    );
  }
});

test('the static registry segment is not shadowed by the component page route', async () => {
  // /ui/registry sits next to /ui/[name]. If the dynamic page won, the CLI
  // would receive an HTML 200 instead of JSON, which parses as neither.
  const res = await handle('/ui/registry');
  assert.match(res.headers.get('content-type') ?? '', /application\/json/, 'JSON, not the component page');
});

test('the gallery appears in the sitemap, one URL per component', async () => {
  const res = await handle('/sitemap.xml');
  assert.equal(res.status, 200);
  const xml = await res.text();
  assert.ok(xml.includes('<loc>https://webjs.dev/ui</loc>'), 'the gallery index is listed');
  for (const name of ['button', 'dialog', 'alert-dialog']) {
    assert.ok(xml.includes(`<loc>https://webjs.dev/ui/${name}</loc>`), `${name} is listed`);
  }
  // A theme is not a page, so listing it would submit a 404 to crawlers.
  assert.ok(!xml.includes('/ui/theme-zinc'), 'non-component registry items stay out');
});

test('the drawer is a component, so nothing has to grep the layout for it', () => {
  // This test used to pin the branches of an inline delegated listener in
  // app/layout.ts, because test/components/browser/docs-drawer.test.js could
  // not import that listener and TRANSCRIBED it instead. Two tests, and the
  // browser one exercised a copy rather than shipping code.
  //
  // components/docs-drawer.ts is importable, so the browser test drives the
  // real element and this file has no transcription left to guard. What
  // survives is the one thing SSR can still check: the mechanism is gone from
  // the layout rather than living in two places at once.
  const layout = readFileSync(resolve(WEBSITE_ROOT, 'app/layout.ts'), 'utf8');
  for (const gone of ['syncDocsNav', 'docs-nav-toggle', 'docs-backdrop', 'data-docs-nav-open']) {
    assert.ok(!layout.includes(gone), `the root layout no longer mentions "${gone}"`);
  }
  const browserTest = readFileSync(
    resolve(WEBSITE_ROOT, 'test/components/browser/docs-drawer.test.js'),
    'utf8',
  );
  assert.ok(
    browserTest.includes("import '#components/docs-drawer.ts'"),
    'the browser test imports the real component instead of transcribing it',
  );
});

test('each component page describes itself, not the section', async () => {
  // 33 URLs sharing one description is the duplicate-content shape this whole
  // migration exists to avoid, so introducing it here would have been
  // self-defeating. The layout still supplies the section default, which is
  // what /ui itself uses.
  const descriptions = new Map<string, string>();
  for (const path of ['/ui/button', '/ui/dialog', '/ui/alert-dialog', '/ui/table']) {
    const html = await bodyOf(path);
    const d = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
    assert.ok(d, `${path} has a description`);
    descriptions.set(path, d!);
  }
  assert.equal(new Set(descriptions.values()).size, descriptions.size, 'every page has its own');

  // And it says something true about that component rather than a generic
  // blurb: the tier decides which sentence, so a component moving tier moves
  // its description with it.
  assert.match(descriptions.get('/ui/button')!, /class helper/, 'a Tier-1 component reads as a helper');
  assert.match(descriptions.get('/ui/button')!, /buttonClass\(\)/, 'and names its helper');
  assert.match(descriptions.get('/ui/dialog')!, /custom element/, 'a Tier-2 component reads as an element');
  assert.match(descriptions.get('/ui/alert-dialog')!, /ui-alert-dialog/, 'and names its tag');
});

test('no page ships a dead SSR action-seed payload', async () => {
  // Site-wide, not gallery-specific, but the gallery is what surfaced it.
  //
  // Every `'use server'` result invoked during SSR is serialized into the page
  // so a shipping async component can skip its on-hydration refetch (#472).
  // This site has no such consumer: no component here does an async render or
  // calls an action, and a page function never re-runs in the browser. So the
  // payload was pure weight, and it was not small: 35KB of a 141KB
  // /ui/dropdown-menu, and 304KB of a 1.1MB /changelog. `webjs.seed` is off
  // for this app as a result.
  //
  // If a component here ever DOES want seeding, re-enable it and delete this
  // test rather than working around it.
  for (const path of ['/ui', '/ui/dropdown-menu', '/changelog', '/blog', '/docs/routing']) {
    const html = await bodyOf(path);
    assert.ok(
      !html.includes('__webjs-seeds'),
      `${path} carries an action-seed payload no component on this site can consume`,
    );
  }
});

test('the old /docs/ui page is gone, permanently redirected to the gallery', async () => {
  // It was a second, hand-written description of the same kit and it had
  // drifted badly (roughly 55 components claimed against an actual 32, and a
  // <ui-button> API the kit does not have). Two pages chasing one keyword is
  // also the cannibalisation the site's own conventions warn about.
  const res = await handle('/docs/ui');
  assert.ok([301, 308].includes(res.status), `expected a permanent redirect, got ${res.status}`);
  assert.equal(new URL(res.headers.get('location')!, 'http://localhost').pathname, '/ui');
});
