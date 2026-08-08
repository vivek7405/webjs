/**
 * Unit tests for the docs search index's heading extraction
 * (lib/utils/doc-headings.ts).
 *
 * The extractor exists because the docs corpus is full of code samples that
 * open a line with `#`: a shell comment, or a JavaScript private class
 * field. Scored as headings they earn +5 each in `app/api/search/route.ts`,
 * accumulating per match, which is how a query for `localhost` ranked
 * /docs/backend-only at 16 off three `# → http://localhost:8080` comments.
 *
 * Two levels of coverage here, on purpose. The fixture pins the rule in
 * isolation, and the corpus test pins that the rule still holds against the
 * real docs, where the samples that motivated it actually live.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractHeadings } from '#lib/utils/doc-headings.ts';
import { getDocPages, type DocPage } from '#lib/docs-llms.server.ts';

const FIXTURE = [
  '# Getting Started',
  '',
  'Some prose.',
  '',
  '## Quick Start',
  '',
  '```',
  '# not a heading',
  'npm create webjs@latest my-app',
  'class Themed {',
  '  #field = 1;',
  '}',
  '```',
  '',
  '### Manual setup',
  '',
  '#### package.json',
  '',
  '  ```',
  '  # indented fence, still a fence',
  '  ```',
  '',
  '## Next Steps',
].join('\n');

test('a hash line inside a fence is not a heading, at any nesting', () => {
  assert.deepEqual(extractHeadings(FIXTURE), [
    'Getting Started',
    'Quick Start',
    'Manual setup',
    'package.json',
    'Next Steps',
  ]);
});

test('the real corpus keeps its headings and drops the shell comments', async () => {
  const pages = await getDocPages();
  const page = pages.find((p: DocPage) => p.path === '/docs/getting-started');
  assert.ok(page, 'expected /docs/getting-started in the corpus');
  const headings = extractHeadings(page.markdown);

  // A real heading survives at more than one level (## and ###).
  assert.ok(headings.includes('Quick Start'), 'an h2 survives');
  assert.ok(headings.includes('Using the scaffold'), 'an h3 survives');

  // Authored as a `# ` shell comment in app/docs/getting-started/page.ts.
  assert.ok(
    !headings.includes('scaffold a new app (no global install needed)'),
    'a shell comment inside a sample is not a heading',
  );

  // The floor is what stops an empty list passing the exclusion above, which
  // is the trap an absence-only assertion falls into. 13 today.
  assert.ok(headings.length >= 10, `expected the page's real headings, found ${headings.length}`);
});
