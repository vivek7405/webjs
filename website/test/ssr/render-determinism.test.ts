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
import { renderToString } from '@webjsdev/core/server';
import LandingPage from '#app/page.ts';
import WhatIsWebJs from '#app/what-is-webjs/page.ts';
import WhyWebJs from '#app/why-webjs/page.ts';

const PAGES: Array<[string, () => unknown]> = [
  ['/', () => LandingPage()],
  ['/what-is-webjs', () => WhatIsWebJs()],
  ['/why-webjs', () => WhyWebJs()],
];

for (const [route, render] of PAGES) {
  test(`${route} renders identical bytes twice (ETag stability)`, async () => {
    const first = await renderToString(render() as any);
    const second = await renderToString(render() as any);
    assert.ok(first.length > 1000, 'renders substantial HTML');
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
