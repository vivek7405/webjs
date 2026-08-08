/**
 * Render determinism, the precondition for conditional GET (#1127).
 *
 * The site opts every page into a public `Cache-Control` via the root layout,
 * which also makes the framework attach a weak ETag and answer `If-None-Match`
 * with a 304. That whole path is silently dead if a page does not render the
 * same bytes twice: a different body hashes to a different ETag, the validator
 * the browser holds never matches, and every revalidation ships the full
 * document instead of an empty 304.
 *
 * Nothing else in the suite catches this. The page still renders, every
 * assertion about its content still passes, and the only symptom is a caching
 * layer that quietly never engages. The original offender was a module-scope
 * counter minting `copy-cmd-hint-<n>` ids that never reset in a long-lived
 * server, so consecutive renders of the home page differed by a handful of
 * digits.
 *
 * This test is deliberately generic rather than a check for that one counter,
 * because the failure mode is a CLASS: any `Date.now()`, `Math.random()`,
 * incrementing id, or iteration-order wobble in any component a page renders
 * reintroduces it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { TemplateResult } from '@webjsdev/core';
import { renderToString } from '@webjsdev/core/server';
import RootLayout from '#app/layout.ts';
import LandingPage from '#app/page.ts';
import WhatIsWebJs from '#app/what-is-webjs/page.ts';
import WhyWebJs from '#app/why-webjs/page.ts';
import GettingStarted from '#app/docs/getting-started/page.ts';
import { layoutProps } from '#test/helpers/layout-props.ts';

// Render each page THROUGH the root layout. The ETag is computed over the whole
// served document, so a page-only render would miss anything the layout
// contributes, which is most of the risk surface: it is the layout that stamps
// the CSP nonce into four script tags and wraps every page's chrome. Guarding
// the page subtree alone would leave the exact file this test exists to protect
// (app/layout.ts) with no coverage at all.
const PAGES: Array<[string, () => TemplateResult]> = [
  ['/', () => LandingPage()],
  ['/what-is-webjs', () => WhatIsWebJs()],
  ['/why-webjs', () => WhyWebJs()],
  ['/docs/getting-started', () => GettingStarted()],
];

for (const [route, render] of PAGES) {
  test(`${route} renders identical bytes twice (ETag stability)`, async () => {
    const first = await renderToString(RootLayout(layoutProps(render())));
    const second = await renderToString(RootLayout(layoutProps(render())));
    assert.ok(first.length > 5000, 'renders a substantial full document, not a fragment');
    if (first !== second) {
      // Surface the first divergence rather than dumping two large documents,
      // so the failure names the offending markup directly.
      const a = first.split('\n');
      const b = second.split('\n');
      const i = a.findIndex((line, n) => line !== b[n]);
      assert.fail(
        `${route} rendered different bytes on a second render, so its ETag changes every request `
        + `and a 304 is impossible. First divergence at line ${i + 1}:\n`
        + `  render 1: ${a[i]?.trim()}\n  render 2: ${b[i]?.trim()}`,
      );
    }
  });
}
