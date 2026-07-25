/**
 * The docs search endpoint (#1098).
 *
 * `/api/search` moved apps with the docs, and its index was rewritten. It
 * used to do its own filesystem walk, rooted at `process.cwd()`, reaching
 * OUT of the app with a `../../../../packages/server/src/fs-walk.js` relative
 * import. Both are now gone: it indexes off `getDocPages()`, the same
 * extraction the llms.txt routes use, anchored to import.meta.url.
 *
 * That means search and the machine-readable corpus can no longer disagree
 * about what a page is called, and the endpoint works identically under
 * `webjs start`, in a test harness, and in a deployed app. The cwd
 * independence is the part worth pinning: the old version silently returned
 * nothing whenever cwd was not the app dir.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@webjsdev/server';

const WEBSITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

type Hit = { path: string; title: string; score: number; snippet: string };

let search: (q: string) => Promise<Hit[]>;

before(async () => {
  const app = await createRequestHandler({ appDir: WEBSITE_ROOT, dev: false });
  await app.warmup?.();
  search = async (q: string) => {
    const res = await app.handle(new Request('http://localhost/api/search?q=' + encodeURIComponent(q)));
    assert.equal(res.status, 200);
    return res.json() as Promise<Hit[]>;
  };
});

test('a term returns doc pages, ranked, with paths under /docs', async () => {
  const hits = await search('routing');
  assert.ok(hits.length > 0, 'expected at least one hit');
  assert.ok(hits.every((h) => h.path.startsWith('/docs/')), 'every hit is a doc page');
  const scores = hits.map((h) => h.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'results come back ranked');
});

test('a title match outranks a passing mention in the body', async () => {
  const hits = await search('middleware');
  assert.equal(hits[0].path, '/docs/middleware', 'the page ABOUT the term wins');
});

test('a query shorter than two characters returns nothing', async () => {
  assert.deepEqual(await search('r'), []);
  assert.deepEqual(await search(''), []);
});

test('a term with no matches returns an empty list, not an error', async () => {
  assert.deepEqual(await search('zzzzzznotathing'), []);
});

test('hits carry a title and a snippet the dropdown can render', async () => {
  const [hit] = await search('server actions');
  assert.ok(hit.title && hit.title.length > 0, 'has a title');
  assert.ok(hit.snippet && hit.snippet.length > 0, 'has a snippet');
  assert.ok(!hit.title.includes('|'), 'the " | WebJs" suffix is stripped');
});

test('the index does not depend on the working directory', async () => {
  // The old index walked from process.cwd(), so it silently returned nothing
  // whenever the server ran from anywhere but the app dir. `webjs test` runs
  // this suite FROM the app dir, which is the one cwd that cannot catch that,
  // so the check moves the working directory out from under a fresh handler
  // and asserts search still works.
  const original = process.cwd();
  process.chdir(tmpdir());
  try {
    const app = await createRequestHandler({ appDir: WEBSITE_ROOT, dev: false });
    await app.warmup?.();
    const res = await app.handle(new Request('http://localhost/api/search?q=components'));
    assert.equal(res.status, 200);
    assert.ok(((await res.json()) as Hit[]).length > 0, 'indexed the docs from an unrelated cwd');
  } finally {
    process.chdir(original);
  }
});
