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
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

test('a term that only appears in shell comments scores at the body floor', async () => {
  // `localhost` reaches this corpus only through `# → http://localhost:8080`
  // sample comments. Before the heading scan tracked fences those counted as
  // headings at +5 each, and they accumulate, so /docs/backend-only scored 16
  // for the term and /docs/getting-started 11, both off comment lines alone.
  //
  // If a future doc page grows a REAL heading containing `localhost`, that
  // page legitimately scores above 1 and this expectation should change with
  // it rather than be worked around.
  const hits = await search('localhost');
  assert.ok(hits.length > 0, 'the term still matches, at body weight');
  assert.deepEqual(
    hits.filter((h: Hit) => h.score !== 1).map((h: Hit) => `${h.path}=${h.score}`),
    [],
    'no page is promoted above the body floor by a sample comment',
  );
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
  // whenever the server ran from anywhere but the app dir. This has to run in
  // a FRESH process: in prod mode the module cache is not busted, so a chdir
  // inside this process would happen after the modules already resolved their
  // roots, and the check would pass even with the bug restored.
  const script = `
    const { createRequestHandler } = await import('@webjsdev/server');
    process.chdir(${JSON.stringify(tmpdir())});
    const app = await createRequestHandler({ appDir: ${JSON.stringify(WEBSITE_ROOT)}, dev: false });
    await app.warmup?.();
    const res = await app.handle(new Request('http://localhost/api/search?q=components'));
    const hits = await res.json();
    process.stdout.write('HITS:' + hits.length);
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: WEBSITE_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const hits = Number(/HITS:(\d+)/.exec(out)?.[1] ?? 0);
  assert.ok(hits > 0, 'a fresh process with an unrelated cwd still indexes the docs');
});

test('a result click hands off to the client router, not a page reload', () => {
  // The browser suite pins that the click is intercepted; it cannot pin where
  // the handoff goes without navigating the test runner out of the suite. The
  // component used to probe a `window.navigate` global the router has never
  // defined, so every result quietly fell through to location.href.
  const src = readFileSync(resolve(WEBSITE_ROOT, 'components/doc-search.ts'), 'utf8');
  assert.ok(!src.includes('window as any).navigate'), 'no probe for a global that does not exist');
  assert.match(src, /import \{[^}]*\bnavigate\b[^}]*\} from '@webjsdev\/core'/, 'imports the router navigate');
});
