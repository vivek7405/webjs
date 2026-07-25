/**
 * Guards the static GitHub Pages answer page (#1088).
 *
 * `seo/github-pages/index.html` is published to https://webjsdev.github.io/webjs/
 * by .github/workflows/pages.yml. It exists to occupy a search result for the
 * "what is webjs" query, which several unrelated projects share the name for.
 *
 * That purpose is entirely carried by a handful of easily-broken details: the
 * exact-match title and h1, a self-referential canonical, and structured data
 * that actually parses. A cosmetic edit can silently destroy any of them
 * without looking wrong, and nothing else in the repo would notice, so they are
 * pinned here. The workflow repeats the title and h1 check at deploy time,
 * which is the backstop for an edit that lands without running the suite.
 *
 * These assertions are intentionally about the page's JOB, not its styling.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE = resolve(REPO_ROOT, 'seo', 'github-pages', 'index.html');
const html = readFileSync(PAGE, 'utf8');

const PAGES_URL = 'https://webjsdev.github.io/webjs/';

test('the page leads with the exact-match title and h1 it exists to rank for', () => {
  assert.match(html, /<title>What is WebJs\? [^<]*<\/title>/, 'title opens with the exact query');
  assert.ok(html.includes('<h1>What is WebJs?</h1>'), 'h1 is the exact query');
});

test('the meta description front-loads a definition', () => {
  const m = html.match(/<meta name="description" content="([^"]+)"/);
  assert.ok(m, 'declares a meta description');
  assert.match(m[1], /^WebJs is a/, 'opens with a definition, not a pitch');
  // A SERP snippet truncates near 160 characters, so the definition itself has
  // to land inside that window to stand alone as an answer.
  assert.ok(m[1].split('.')[0].length <= 160, 'the opening definition fits a snippet window');
});

test('the canonical is self-referential, not pointed at webjs.dev', () => {
  // Deliberate. Canonicalising to the marketing site would suppress this page
  // from ranking on its own, which defeats the entire reason it exists.
  const m = html.match(/<link rel="canonical" href="([^"]+)"/);
  assert.ok(m, 'declares a canonical');
  assert.equal(m[1], PAGES_URL, 'canonical points at the Pages URL itself');
});

test('the page is indexable', () => {
  const m = html.match(/<meta name="robots" content="([^"]+)"/);
  assert.ok(m, 'declares a robots meta');
  assert.match(m[1], /\bindex\b/, 'is indexable');
  assert.ok(!/\bnoindex\b/.test(m[1]), 'is not noindex');
});

test('every JSON-LD block parses and is typed', () => {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.ok(blocks.length >= 2, 'ships at least the SoftwareApplication and FAQPage blocks');

  const parsed = blocks.map((b) => {
    // A malformed block is invisible to a reader and silently ignored by a
    // crawler, so parsing it here is the only place it gets caught.
    try {
      return JSON.parse(b[1]);
    } catch (err) {
      assert.fail(`JSON-LD block does not parse: ${err.message}`);
    }
  });

  const types = parsed.map((p) => p['@type']);
  assert.ok(types.includes('SoftwareApplication'), 'declares SoftwareApplication');
  assert.ok(types.includes('FAQPage'), 'declares FAQPage');

  const app = parsed.find((p) => p['@type'] === 'SoftwareApplication');
  assert.equal(app.offers.price, '0', 'states it is free, a common query intent');
  assert.equal(app.codeRepository, 'https://github.com/webjsdev/webjs', 'links the repository');
});

test('every FAQPage answer is also VISIBLE in the page body', () => {
  // Google discounts FAQ schema whose answers are not on the page. This file is
  // hand-written rather than generated from one source, so the two CAN drift.
  // This is the test that catches it.
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  const faq = blocks.map((b) => JSON.parse(b[1])).find((p) => p['@type'] === 'FAQPage');
  const body = html.slice(html.indexOf('<body>'));

  for (const q of faq.mainEntity) {
    // Match on a distinctive leading fragment of the answer, since the visible
    // copy is wrapped in markup and reworded slightly for reading flow.
    const fragment = q.acceptedAnswer.text.split('.')[0].slice(0, 30);
    assert.ok(body.includes(fragment), `answer is visible on the page: "${fragment}"`);
  }
});

test('the disambiguation section names the projects sharing the name', () => {
  // This is what makes the page a genuinely better answer than a stub, and it
  // is the reason a searcher looking for a different WebJS still gets helped.
  for (const name of ['whatsapp-web.js', 'WebJS for Java', 'webJS toolkit']) {
    assert.ok(html.includes(name), `names ${name}`);
  }
});

test('the page is self-contained, with no external runtime dependency', () => {
  // GitHub Pages serves this as a flat static file. A CDN script or webfont
  // would add a failure mode and a render delay for zero benefit here.
  assert.ok(!/<script\s+[^>]*src=/.test(html), 'no external scripts');
  assert.ok(!/<link[^>]+rel="stylesheet"/.test(html), 'no external stylesheets');
  assert.ok(html.includes('<style>'), 'styles are inlined');
});

test('it links onward to the canonical project surfaces', () => {
  assert.ok(html.includes('https://webjs.dev/what-is-webjs'), 'links the full overview');
  assert.ok(html.includes('https://github.com/webjsdev/webjs'), 'links the repository');
  assert.ok(html.includes('https://docs.webjs.dev'), 'links the docs');
});
