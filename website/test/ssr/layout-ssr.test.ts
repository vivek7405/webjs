/**
 * SSR guard for the root layout.
 *
 * A literal custom-element tag written inside the foundation <style> block
 * (for example "<copy-cmd>" in a CSS comment) is picked up by the SSR pass and
 * rendered as a real element, which once produced a phantom copy-cmd whose
 * button floated at the page edge. The layout legitimately contains the
 * copy-cmd CSS selector text, but it must render no copy-cmd ELEMENT and no
 * copy button. This test renders the layout and asserts neither appears.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { html } from '@webjsdev/core';
import { renderToString } from '@webjsdev/core/server';
import RootLayout from '#app/layout.ts';
import LandingPage from '#app/page.ts';
import NotFound from '#app/not-found.ts';
import ErrorBoundary from '#app/error.ts';
import { layoutProps } from '#test/helpers/layout-props.ts';

test('the root layout SSR emits no phantom copy-cmd element or copy button', async () => {
  const out = await renderToString(RootLayout(layoutProps(html`<main>content</main>`)));
  // cursor-copy is the copy button's class, present only if a copy-cmd rendered.
  assert.ok(!out.includes('cursor-copy'), 'no phantom copy button rendered from the layout');
  // An actual <copy-cmd ...> tag (not the CSS selector text "copy-cmd {").
  assert.ok(!/<copy-cmd[\s>]/.test(out), 'no phantom copy-cmd element rendered from the layout');
});

test('warms the analytics origin with a connection hint', async () => {
  // The async gtag script is the one cross-origin runtime dependency; a
  // preconnect lets its handshake overlap head parse instead of starting cold.
  const out = await renderToString(RootLayout(layoutProps(html`<main>x</main>`)));
  assert.ok(out.includes('rel="preconnect" href="https://www.googletagmanager.com"'), 'preconnects the gtag origin');
});

test('every nav landmark carries a distinguishing aria-label', async () => {
  // Multiple <nav> landmarks (header desktop, header mobile-menu, footer)
  // must each have an accessible name so a screen reader's landmark list can
  // tell them apart. Assert no <nav> ships without an aria-label, and that
  // the header and footer names are distinct (both can sit in the a11y tree
  // on a mobile viewport at once).
  const out = await renderToString(RootLayout(layoutProps(LandingPage())));
  const navs = out.match(/<nav\b[^>]*>/g) || [];
  assert.ok(navs.length >= 2, 'the composed document renders multiple nav landmarks');
  const labels = navs.map((tag) => (tag.match(/aria-label="([^"]+)"/) || [])[1]);
  for (let i = 0; i < navs.length; i++) {
    assert.ok(labels[i], `nav landmark is unlabeled: ${navs[i]}`);
  }
  // Every nav landmark needs a UNIQUE name so the landmark list can tell them
  // apart (two same-named navs read as ambiguous duplicates).
  assert.equal(new Set(labels).size, labels.length, `nav labels must be unique, saw: ${labels.join(', ')}`);
  assert.ok(labels.includes('Footer'), 'the footer nav is labeled Footer');
});

test('the root layout renders the site footer around a bare child (every page gets it)', async () => {
  // The footer is layout chrome, not per-page markup, so a page that renders
  // only its own <main> (blog, compare, changelog, articles) still gets exactly
  // one footer. Compose the layout around a minimal child and assert the footer
  // nav is present and appears once. Guards against the footer regressing back
  // into individual pages (where blog/compare/changelog silently lost it).
  const out = await renderToString(RootLayout(layoutProps(html`<main>content</main>`)));
  const footers = (out.match(/<footer\b/g) || []).length;
  assert.equal(footers, 1, 'the layout renders exactly one footer around any page');
  assert.ok(out.includes('aria-label="Footer"'), 'the layout-rendered footer nav is labeled Footer');
});

test('external new-tab links announce the context change and hide decorative glyphs', async () => {
  const out = await renderToString(RootLayout(layoutProps(LandingPage())));
  // Every target="_blank" link carries a visually-hidden new-tab cue.
  assert.ok(out.includes('class="sr-only"> (opens in a new tab)'), 'external links carry an sr-only new-tab cue');
  // The cue rides multiple external links (nav + CTAs + footer), not a single one.
  const count = (out.match(/\(opens in a new tab\)/g) || []).length;
  assert.ok(count >= 5, `the new-tab cue appears on multiple external links (saw ${count})`);
});

test('no nav or footer link points at the example-blog demo', async () => {
  // Demo was removed from the site deliberately (owner call, 2026-07-30).
  const out = await renderToString(RootLayout(layoutProps(html`<main>x</main>`)));
  assert.ok(!out.includes('>Demo<'), 'no Demo nav link is rendered');
  assert.ok(!out.includes('example-blog'), 'nothing links at the example-blog app');
});

test('the header menu is a component, not a delegated listener in the layout', async () => {
  // Native <details> has no Escape dismissal, no outside-click dismissal, and
  // no close-on-link. Those used to be a delegated listener inlined here, which
  // is why the old version of this test grepped the served HTML for "'Escape'":
  // an inline script has no component harness to test against.
  //
  // <site-nav-menu> is that harness now, so the BEHAVIOUR is asserted in
  // test/components/browser/site-nav-menu.test.js against the real element.
  // What is left to check from SSR is the wiring, plus the fact that the old
  // mechanism is really gone rather than merely duplicated.
  const out = await renderToString(RootLayout(layoutProps(html`<main>x</main>`)));
  assert.ok(/<site-nav-menu[\s>]/.test(out), 'the layout renders the menu component');
  assert.ok(/<details\s+class="mobile-menu/.test(out), 'the native details still SSRs, so it works with JS off');

  const layoutSrc = readFileSync(fileURLToPath(new URL('../../app/layout.ts', import.meta.url)), 'utf8');
  for (const gone of ['syncDocsNav', 'closeDocsNav', 'data-docs-nav-open', ".mobile-menu[open]", "addEventListener('click'"]) {
    assert.ok(!layoutSrc.includes(gone), `the layout no longer carries "${gone}"`);
  }
});

test('the layout keeps only boot-critical inline script', async () => {
  // Two inline scripts are legitimate and must NOT be moved into components.
  // The theme bootstrap has to run before first paint or a reader who chose
  // dark sees the light palette flash; the --header-h measurement backs the
  // fixed-header offset. Everything else that was in here is a component now.
  const layoutSrc = readFileSync(fileURLToPath(new URL('../../app/layout.ts', import.meta.url)), 'utf8');
  assert.ok(layoutSrc.includes('THEME_STORAGE_KEY'), 'the theme bootstrap reads the shared key');
  assert.ok(layoutSrc.includes('--header-h'), 'the header measurement stays inline');
  // The key is interpolated from lib/theme.ts rather than written out again,
  // so a rename cannot leave the two readers disagreeing.
  assert.ok(!/localStorage\.getItem\('webjs_theme'\)/.test(layoutSrc), 'the storage key is not hard-coded a second time');
});

test('the layout ships no animations (static page, no smooth-scroll)', () => {
  // The landing page was stripped of all motion to fix janky scroll: no
  // scroll-reveal, no breathing-glow or heart-pump keyframes, no smooth-scroll.
  // Pin it so a re-introduced animation is caught here.
  const layoutSrc = readFileSync(fileURLToPath(new URL('../../app/layout.ts', import.meta.url)), 'utf8');
  // (the prefers-reduced-motion clamp legitimately forces scroll-behavior: auto,
  // so ban the smooth variant specifically, not the bare property.)
  for (const banned of ['@keyframes', 'scroll-behavior: smooth', 'reveal-ready', 'data-reveal', 'content-visibility']) {
    assert.ok(!layoutSrc.includes(banned), `layout must not reintroduce "${banned}"`);
  }
});

test('every <main id="main"> skip-link target in app/ is focusable', () => {
  // The layout's skip link lands on the #main of EVERY route, so every page
  // declaring the target must make it focusable (tabindex="-1"), not just the
  // landing/404/error pages. Walk app/ source so blog, [slug], and changelog
  // are covered without rendering their data deps, and future pages too.
  const appDir = fileURLToPath(new URL('../../app', import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) files.push(p);
    }
  };
  walk(appDir);
  let targets = 0;
  for (const f of files) {
    for (const tag of readFileSync(f, 'utf8').match(/<main id="main"[^>]*>/g) || []) {
      targets++;
      assert.ok(tag.includes('tabindex="-1"'), `${f}: skip-link target must be focusable, got ${tag}`);
    }
  }
  assert.ok(targets >= 5, `expected the skip-link target on several pages, found ${targets}`);
});

test('the skip-to-content link resolves on the 404 and error pages too', async () => {
  // The skip link lives in the layout and wraps EVERY page, so the 404 and
  // error-boundary pages must also expose a #main target, not just the landing
  // page. Compose the layout around each and assert the fragment resolves.
  for (const [name, page] of [['not-found', NotFound()], ['error', ErrorBoundary({ error: new Error('boom') })]] as const) {
    const out = await renderToString(RootLayout(layoutProps(page)));
    const m = out.match(/href="#([\w-]+)"[^>]*>\s*Skip to content/);
    assert.ok(m, `${name}: a skip-to-content link is rendered`);
    assert.ok(out.includes(`<main id="${m[1]}" tabindex="-1"`), `${name}: the #${m[1]} target is a focusable main landmark`);
  }
});

test('the skip-to-content link targets the page main landmark (paired)', async () => {
  // Compose the layout around the real page, the way the SSR pipeline does,
  // so the skip-link href and the landmark id are checked as a matching pair.
  const out = await renderToString(RootLayout(layoutProps(LandingPage())));
  const m = out.match(/href="#([\w-]+)"[^>]*>\s*Skip to content/);
  assert.ok(m, 'a skip-to-content link with an href fragment is rendered');
  // The target must be programmatically focusable (tabindex="-1") or activating
  // the skip link only scrolls; focus must actually land in the content.
  assert.ok(out.includes(`<main id="${m[1]}" tabindex="-1"`), `the #${m[1]} target is a focusable main landmark`);
});
