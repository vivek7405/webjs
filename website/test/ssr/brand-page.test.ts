/**
 * /brand renders, and renders the truth.
 *
 * The page shipped 365 lines with no test at all (review round 1). Beyond
 * "does it render", the assertions pin the claims that drifted before: the
 * downloadable files it links must exist on disk, and the copy must not
 * contradict the palette (the first draft said "electric cyan" beside amber
 * chips).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from '@webjsdev/core/server';
import BrandPage from '#app/brand/page.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('/brand renders its sections', async () => {
  const html = await renderToString(BrandPage());
  for (const heading of ['The marks', 'Clear space and minimum size', 'Colour', 'Typography', 'Writing the name', 'Permission and trademark']) {
    assert.ok(html.includes(heading), `missing section: ${heading}`);
  }
  assert.ok(!/cyan/i.test(html), 'palette copy contradicts the swatches');
});

test('every asset /brand offers for download exists and is path-weight', async () => {
  const html = await renderToString(BrandPage());
  const files = [...new Set([...html.matchAll(/\/public\/brand\/([a-z0-9.-]+\.(?:svg|zip))/g)].map((m) => m[1]))];
  assert.ok(files.length >= 5, `expected the asset set, saw ${files.length}`);
  for (const f of files) {
    const p = resolve(ROOT, 'public/brand', f);
    assert.ok(existsSync(p), `linked asset missing on disk: ${f}`);
    if (f.endsWith('.svg')) {
      assert.ok(statSync(p).size < 10_000, `${f} should be path-weight, is ${statSync(p).size} bytes`);
    }
  }
});
