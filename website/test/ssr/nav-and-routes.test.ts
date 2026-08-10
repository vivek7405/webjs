/**
 * Guards the header/footer split and the /why to /why-webjs rename (#1094).
 *
 * Three things here are easy to half-do and impossible to notice locally:
 *
 *  - moving a nav item OUT of the header but forgetting to put it in the
 *    footer, so the page becomes unreachable from the chrome entirely
 *  - renaming a route but leaving an internal link, the sitemap entry, or the
 *    og:url pointing at the old path, which sends crawlers and readers to a
 *    redirect instead of the page
 *  - shipping the rename WITHOUT the 301, which silently drops whatever
 *    ranking equity the old URL had accumulated
 *
 * Each is asserted against observable output (rendered HTML, the serialized
 * sitemap, the config the framework actually reads) rather than source text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { html } from '@webjsdev/core';
import { renderToString } from '@webjsdev/core/server';
import RootLayout from '#app/layout.ts';
import Sitemap from '#app/sitemap.ts';
import { siteFooter } from '#lib/ui/site-footer.ts';
import { layoutProps } from '#test/helpers/layout-props.ts';

const WEBSITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const renderLayout = () => renderToString(RootLayout(layoutProps(html`<main>x</main>`)));

test('the header nav no longer carries Why WebJs', async () => {
  const out = await renderLayout();
  const header = out.slice(0, out.indexOf('<footer'));
  assert.ok(!header.includes('href="/why-webjs"'), 'not in the header (desktop or mobile menu)');
  assert.ok(!header.includes('href="/why"'), 'and not left pointing at the old path either');
});

test('the footer Resources column carries Why WebJs', async () => {
  // Moved, not deleted. Without this the page is unreachable from the chrome.
  const out = await renderToString(siteFooter());
  assert.ok(out.includes('href="/why-webjs"'), 'linked from the footer');
  assert.ok(out.includes('href="/what-is-webjs"'), 'still alongside What is WebJs?');
});

test('the footer Community column carries the social profiles', async () => {
  // The footer is the only chrome that links the social accounts, so a dropped
  // entry here is the account becoming unreachable from the site. Each opens in
  // a new tab, which needs the noopener/noreferrer pair and the screen-reader
  // cue that the rest of the column already carries.
  const out = await renderToString(siteFooter());
  for (const href of ['https://x.com/webjsdev', 'https://bsky.app/profile/webjs.bsky.social']) {
    const anchor = out.slice(out.indexOf(`href="${href}"`));
    assert.ok(out.includes(`href="${href}"`), `footer links ${href}`);
    assert.ok(anchor.startsWith(`href="${href}" target="_blank" rel="noopener noreferrer"`), `${href} opens safely in a new tab`);
    assert.ok(anchor.slice(0, 400).includes('opens in a new tab'), `${href} announces the new-tab context`);
  }
  assert.ok(out.includes('>X<'), 'the X link is labelled');
  assert.ok(out.includes('>Bluesky<'), 'the Bluesky link is labelled');
});

test('the header still carries the rest of the nav', async () => {
  // Counterweight to the removal assertions: prove we removed ONE entry, not
  // that the nav failed to render at all.
  const out = await renderLayout();
  for (const href of ['/blog', '/compare', '/changelog']) {
    assert.ok(out.includes(`href="${href}"`), `header still links ${href}`);
  }
});

test('both header and footer link the gallery, safely, in a new tab', async () => {
  // The gallery is a separate deployment, so it is the one chrome entry that
  // has to carry the full cross-origin treatment: the noopener/noreferrer pair
  // (a target="_blank" link without it hands the opened page a window.opener
  // handle back into this one) and the screen-reader cue that every other
  // external link in the chrome already carries. Both surfaces are asserted
  // because they are edited in different files and adding one alone is the
  // easy half-done change.
  const header = (await renderLayout()).split('<footer')[0];
  for (const [surface, out] of [['header', header], ['footer', await renderToString(siteFooter())]] as const) {
    const at = out.indexOf('href="https://gallery.webjs.dev"');
    assert.ok(at >= 0, `${surface} links the gallery`);
    const anchor = out.slice(at);
    assert.ok(
      anchor.startsWith('href="https://gallery.webjs.dev" target="_blank" rel="noopener noreferrer"'),
      `${surface} gallery link opens safely in a new tab`,
    );
    assert.ok(anchor.slice(0, 400).includes('opens in a new tab'), `${surface} announces the new-tab context`);
    assert.ok(anchor.slice(0, 400).includes('>Gallery'), `${surface} gallery link is labelled`);
  }
});

test('the sitemap lists /why-webjs and not the old /why', async () => {
  const xml = String(await Sitemap());
  assert.ok(xml.includes('<loc>https://webjs.dev/why-webjs</loc>'), 'lists the new path');
  assert.ok(!xml.includes('<loc>https://webjs.dev/why</loc>'), 'does not list the redirecting path');
});

test('a permanent redirect preserves the old /why URL', async () => {
  // The rename is only safe because the old URL keeps resolving. This reads the
  // config the framework actually consumes (compileRedirectRules reads
  // package.json webjs.redirects), so deleting the entry fails here.
  const pkg = JSON.parse(readFileSync(resolve(WEBSITE_ROOT, 'package.json'), 'utf8'));
  const rules = pkg.webjs?.redirects ?? [];
  const rule = rules.find((r: any) => r.source === '/why');
  assert.ok(rule, 'a redirect rule exists for /why');
  assert.equal(rule.destination, '/why-webjs', 'points at the new path');
  assert.ok(rule.permanent === true || rule.statusCode === 301, 'is a PERMANENT redirect, so signals transfer');
});

test('no internal link still points at the old /why path', async () => {
  // A link to /why would still work, but every visit would eat a redirect hop.
  const pages = await Promise.all([renderLayout(), renderToString(siteFooter())]);
  for (const out of pages) {
    assert.ok(!/href="\/why"/.test(out), 'no chrome link targets the pre-rename path');
  }
});

test('the footer writes the brand name with proper casing', async () => {
  // Invariant 11: WebJs is capitalized wherever it NAMES the project in prose,
  // and the lowercase `webjs` form is reserved for literal code tokens (a CLI
  // command, the domain, an `@webjsdev` package, a config key, an env var).
  // The footer renders on EVERY page, so a slip here is the most-viewed
  // instance of the brand name on the site, and it shipped that way once
  // already (#1190).
  //
  // The edit-time hook that enforces casing only scans NEW content, so a string
  // already in the tree is never re-checked and CI has no equivalent. This test
  // is that missing check, scoped to the one surface that matters most.
  const out = await renderToString(siteFooter());
  assert.ok(out.includes('Built with WebJs'), 'footer credits the brand with proper casing');
  assert.ok(!/Built with webjs/.test(out), 'and never the lowercase code-token form');

  // Route paths are NOT prose and must stay lowercase, so guard against an
  // over-eager fix that "corrects" the hrefs and breaks every comparison link.
  assert.ok(out.includes('href="/compare/webjs-vs-nextjs"'), 'url paths stay lowercase');
});
