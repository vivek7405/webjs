/**
 * Unit tests for the shared FAQ convention parser (lib/utils/faq.ts).
 *
 * The parser turns a `## FAQ` markdown section into structured items that
 * BOTH render (as normal markdown) and feed a `FAQPage` JSON-LD block, so
 * the structured data always matches what a visitor sees.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFaq, faqJsonLd } from '#lib/utils/faq.ts';

const BODY = `Intro paragraph.

## Some other section

Not a question.

## FAQ

### Is it production ready?
Yes, with caveats. It runs on Node and Bun.

### Does it need a build step?
No. Modules are served directly.

## After FAQ

This trailing section must not be swallowed into the last answer.`;

test('parseFaq extracts each ### question and its answer, bounded by the FAQ section', () => {
  const items = parseFaq(BODY);
  assert.equal(items.length, 2, 'finds exactly the two questions in the FAQ section');
  assert.equal(items[0].question, 'Is it production ready?');
  assert.match(items[0].answer, /^Yes, with caveats\./);
  assert.equal(items[1].question, 'Does it need a build step?');
  assert.match(items[1].answer, /^No\. Modules are served directly\.$/);
  // The section after `## FAQ` must not leak into the last answer.
  assert.doesNotMatch(items[1].answer, /trailing section/, 'stops at the next ## heading');
});

test('parseFaq returns [] when there is no FAQ section (counterfactual)', () => {
  assert.deepEqual(parseFaq('# Title\n\nNo FAQ here.\n\n### Stray heading\nText.'), [], 'no ## FAQ means no items');
});

test('faqJsonLd builds a schema.org FAQPage from items, or null when empty', () => {
  const ld = faqJsonLd(parseFaq(BODY)) as any;
  assert.equal(ld['@type'], 'FAQPage');
  assert.equal(ld['@context'], 'https://schema.org');
  assert.equal(ld.mainEntity.length, 2);
  assert.equal(ld.mainEntity[0]['@type'], 'Question');
  assert.equal(ld.mainEntity[0].name, 'Is it production ready?');
  assert.equal(ld.mainEntity[0].acceptedAnswer['@type'], 'Answer');
  assert.match(ld.mainEntity[0].acceptedAnswer.text, /Yes, with caveats/);
  // Counterfactual: no items means no schema (so a page can conditionally spread it).
  assert.equal(faqJsonLd([]), null, 'empty items yield null, not an empty FAQPage');
});
