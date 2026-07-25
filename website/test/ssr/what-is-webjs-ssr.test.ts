/**
 * SSR / metadata tests for /what-is-webjs (app/what-is-webjs/page.ts).
 *
 * This page exists to answer one contested search query, so the assertions
 * here are deliberately SEO-shaped rather than cosmetic. The things that would
 * silently destroy the page's whole reason to exist are an edited <title> that
 * no longer matches the query, a JSON-LD block that drifts out of sync with the
 * visible FAQ (Google discounts schema it cannot see on the page), or a missing
 * canonical. Each of those is pinned below.
 *
 * Mirrors test/ssr/why-ssr.test.ts for the render smoke test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from '@webjsdev/core/server';
import WhatIsWebJs, { generateMetadata } from '#app/what-is-webjs/page.ts';

const CANONICAL = 'https://webjs.dev/what-is-webjs';

const types = (jsonLd: any): string[] => (Array.isArray(jsonLd) ? jsonLd : [jsonLd]).map((o) => o['@type']);

test('the page SSRs with the definition, the samples, the disambiguation, and a main landmark', async () => {
  const out = await renderToString(WhatIsWebJs());
  assert.ok(out.length > 2000, 'renders substantial HTML');
  assert.ok(out.includes('<main id="main"'), 'wraps content in a main landmark');
  // The exact-match H1 is the entire point of the page.
  assert.match(out, /<h1[^>]*>\s*What is WebJs\?\s*<\/h1>/, 'renders the exact-match H1');
  // The definition has to be IN the rendered HTML, not assembled by client JS,
  // or a crawler never sees it.
  assert.ok(
    out.includes('full-stack JavaScript web') && out.includes('framework built on web components'),
    'states the framework category in the server-rendered body',
  );
  assert.ok(out.includes('npm create webjs@latest my-app'), 'includes the install command');
  // The disambiguation section is what makes this page a better answer than
  // the pages it competes with, so it is load-bearing, not decoration.
  assert.ok(out.includes('whatsapp-web.js'), 'disambiguates whatsapp-web.js');
  assert.ok(out.includes('WebJS for Java'), 'disambiguates the older Java project');
});

test('metadata carries the exact-match title and a front-loaded definition', () => {
  const m = generateMetadata();
  assert.equal(m.title, 'What is WebJs?', 'title matches the target query exactly');
  // A SERP snippet truncates near 160 characters, so the definition has to land
  // inside that window to stand alone as an answer.
  const firstSentence = m.description.split('.')[0];
  assert.ok(firstSentence.length <= 160, 'the opening definition fits a snippet window');
  assert.match(firstSentence, /WebJs is a/, 'the description opens with a definition, not a pitch');
});

test('metadata is self-consistent across title, og, twitter, and canonical', () => {
  const m = generateMetadata();
  assert.equal(m.openGraph.title, m.title, 'og:title matches the <title>');
  assert.equal(m.twitter.title, m.title, 'twitter:title matches the <title>');
  assert.equal(m.openGraph.description, m.description, 'og:description matches the meta description');
  assert.equal(m.twitter.description, m.description, 'twitter:description matches the meta description');
  assert.equal(m.openGraph.url, CANONICAL, 'og:url is the canonical URL');
  assert.equal(m.alternates.canonical, CANONICAL, 'declares its own canonical');
});

test('the page emits SoftwareApplication + BreadcrumbList + FAQPage JSON-LD', () => {
  const m = generateMetadata();
  const t = types(m.jsonLd);
  assert.ok(t.includes('SoftwareApplication'), 'has SoftwareApplication');
  assert.ok(t.includes('BreadcrumbList'), 'has BreadcrumbList');
  assert.ok(t.includes('FAQPage'), 'has FAQPage');

  const app = (m.jsonLd as any[]).find((o) => o['@type'] === 'SoftwareApplication');
  assert.equal(app.offers.price, '0', 'declares it is free, which is a common query intent');
  assert.equal(app.codeRepository, 'https://github.com/webjsdev/webjs', 'links the repository');

  const crumbs = (m.jsonLd as any[]).find((o) => o['@type'] === 'BreadcrumbList');
  assert.equal(crumbs.itemListElement.at(-1).item, CANONICAL, 'breadcrumb ends at the canonical self URL');
});

test('every FAQPage entry is also VISIBLE in the rendered page', async () => {
  // Google discounts (and can penalise) FAQ schema whose answers are not on the
  // page. Both are built from the one FAQ array in the page module, so this
  // test is the guard that they were not decoupled later.
  const m = generateMetadata();
  const faq = (m.jsonLd as any[]).find((o) => o['@type'] === 'FAQPage');
  const out = await renderToString(WhatIsWebJs());

  assert.ok(faq.mainEntity.length >= 6, 'carries a substantive FAQ');
  for (const q of faq.mainEntity) {
    assert.ok(out.includes(q.name), `question is rendered on the page: ${q.name}`);
    // Compare on a distinctive fragment: the rendered answer is HTML-escaped,
    // so a whole-string compare would fail on apostrophes and angle brackets.
    const fragment = q.acceptedAnswer.text.split('.')[0].slice(0, 40);
    assert.ok(out.includes(fragment), `answer is rendered on the page: ${fragment}`);
  }
});

test('the FAQ answers the disambiguation and licensing questions searchers actually ask', () => {
  const m = generateMetadata();
  const faq = (m.jsonLd as any[]).find((o) => o['@type'] === 'FAQPage');
  const questions = faq.mainEntity.map((q: any) => q.name).join(' | ');
  assert.match(questions, /^What is WebJs\?/, 'leads with the exact query as the first question');
  assert.match(questions, /whatsapp-web\.js/, 'addresses the wwebjs confusion');
  assert.match(questions, /Java/, 'addresses the older Java project confusion');
  assert.match(questions, /free/i, 'addresses licensing, a top adjacent query');
  assert.match(questions, /build step/, 'addresses the headline technical differentiator');
});
