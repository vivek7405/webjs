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
  // Not merely "has a sidebar": the same one, from lib/docs-shell.ts. The
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

test('a preview pane carries the scoping class', async () => {
  const html = await bodyOf(UI_COMPONENT);
  assert.ok(html.includes('class="ui-preview'), 'the preview pane opts into the kit palette');
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

test('the old /docs/ui page is gone, permanently redirected to the gallery', async () => {
  // It was a second, hand-written description of the same kit and it had
  // drifted badly (roughly 55 components claimed against an actual 32, and a
  // <ui-button> API the kit does not have). Two pages chasing one keyword is
  // also the cannibalisation the site's own conventions warn about.
  const res = await handle('/docs/ui');
  assert.ok([301, 308].includes(res.status), `expected a permanent redirect, got ${res.status}`);
  assert.equal(new URL(res.headers.get('location')!, 'http://localhost').pathname, '/ui');
});
