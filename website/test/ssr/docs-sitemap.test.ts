/**
 * The docs are in the sitemap (#1098).
 *
 * The docs are the largest body of indexable content the project has, and
 * docs.webjs.dev served no sitemap.xml at all. That is most of the reason the
 * migration was cheap: there was little accumulated indexing to disturb. It is
 * also the reason this assertion matters more than a normal sitemap test.
 * Moving the pages onto webjs.dev without enumerating them here would leave
 * them exactly as undiscoverable as they were on the subdomain, and nothing
 * about the rendered pages would look wrong.
 *
 * Enumerated from the live pages on disk rather than a hardcoded list, so the
 * count assertion below is what proves a NEW doc page is crawlable the moment
 * it exists, with no second file to remember to edit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Sitemap from '#app/sitemap.ts';

const WEBSITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const xml = () => Sitemap();

/** The doc topic folders on disk that actually hold a page. */
async function docTopics(): Promise<string[]> {
  const root = resolve(WEBSITE_ROOT, 'app', 'docs');
  const dirents = await readdir(root, { withFileTypes: true });
  const out: string[] = [];
  for (const d of dirents) {
    if (!d.isDirectory() || d.name.startsWith('.') || d.name.startsWith('_') || d.name.startsWith('[')) continue;
    const files = await readdir(resolve(root, d.name)).catch((): string[] => []);
    if (files.includes('page.ts') || files.includes('page.js')) out.push(d.name);
  }
  return out;
}

test('the sitemap lists every doc page', async () => {
  const [out, topics] = await Promise.all([xml(), docTopics()]);
  assert.ok(topics.length > 20, `sanity: expected many doc topics, found ${topics.length}`);
  const missing = topics.filter((t) => !out.includes(`<loc>https://webjs.dev/docs/${t}</loc>`));
  assert.deepEqual(missing, [], 'every doc topic must have a sitemap entry');
});

test('the doc entries are absolute URLs on the main domain', async () => {
  const out = await xml();
  assert.ok(out.includes('<loc>https://webjs.dev/docs/getting-started</loc>'));
  assert.ok(!out.includes('docs.webjs.dev'), 'no entry may point at the old subdomain');
});

test('the introduction outranks the rest of the docs', async () => {
  // It is the entry point, and the page external links land on most often.
  const out = await xml();
  const entry = out.slice(out.indexOf('https://webjs.dev/docs/getting-started'));
  assert.match(entry.slice(0, 200), /<priority>0\.9<\/priority>/);
});

test('the bare /docs redirect is NOT listed', async () => {
  // It 308s to /docs/getting-started. Listing a redirect asks a crawler to
  // spend a fetch discovering that; the destination is listed instead.
  const out = await xml();
  assert.ok(!out.includes('<loc>https://webjs.dev/docs</loc>'), '/docs itself is not a sitemap entry');
});

test('the existing marketing entries survived the docs addition', async () => {
  const out = await xml();
  for (const path of ['/', '/what-is-webjs', '/why-webjs', '/blog', '/compare', '/changelog']) {
    assert.ok(out.includes(`<loc>https://webjs.dev${path}</loc>`), `still lists ${path}`);
  }
});
