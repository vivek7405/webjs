/**
 * Internal docs links resolve, and the text-only variants stay out of the
 * search index (#1098).
 *
 * Both of these matter more now than they did on the old subdomain, for the
 * same reason: everything here is on the domain the migration exists to
 * consolidate. A dead cross-link inside the docs is a 404 on webjs.dev, and
 * the per-page markdown routes are full-text copies of pages that also exist
 * as HTML, which is exactly the near-duplicate problem the move is meant to
 * end rather than reproduce.
 *
 * The link check found three real 404s that had been shipping on
 * docs.webjs.dev (`/docs/route-handlers`, `/docs/caching`, `/docs/advanced`,
 * none of which are real slugs), so it is a guard worth having rather than a
 * formality.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@webjsdev/server';

const WEBSITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCS_ROOT = resolve(WEBSITE_ROOT, 'app', 'docs');

let handle: (path: string) => Promise<Response>;

before(async () => {
  const app = await createRequestHandler({ appDir: WEBSITE_ROOT, dev: false });
  await app.warmup?.();
  handle = (path) => app.handle(new Request('http://localhost' + path));
});

/**
 * Every `/docs/...` link the docs themselves publish, with where it came from.
 *
 * Two sources, and the second is the one that matters most. Doc page prose
 * yields around 36 distinct slugs, but the SIDEBAR is the only surface that
 * links all 45, and its hrefs are single-quoted object literals rendered
 * through a template hole, so a walk that only reads `href="..."` in page
 * files cannot see them. A typo there would ship a 404 in the primary
 * navigation of every docs page with this test green.
 *
 * A fragment is split off rather than skipped: the path still has to resolve,
 * and dropping the whole link because it carries a `#` is how a dead
 * `/docs/components#state` survived the first version of this check.
 */
async function internalDocLinks(): Promise<{ from: string; href: string }[]> {
  const out: { from: string; href: string }[] = [];

  const push = (from: string, raw: string) => {
    const href = raw.split('#')[0].split('?')[0];
    if (href.startsWith('/docs')) out.push({ from, href });
  };

  // The sidebar, read from the layout that renders it.
  const layout = await readFile(resolve(DOCS_ROOT, 'layout.ts'), 'utf8');
  for (const m of layout.matchAll(/href:\s*'([^']+)'/g)) push('layout.ts (sidebar)', m[1]);

  // Prose links in every doc page, including app/docs/page.ts itself.
  const files: string[] = [resolve(DOCS_ROOT, 'page.ts')];
  for (const d of await readdir(DOCS_ROOT, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('[')) continue;
    files.push(resolve(DOCS_ROOT, d.name, 'page.ts'), resolve(DOCS_ROOT, d.name, 'page.js'));
  }
  for (const file of files) {
    const src = await readFile(file, 'utf8').catch(() => null);
    if (src == null) continue;
    const from = file.slice(DOCS_ROOT.length + 1);
    for (const m of src.matchAll(/href=["']([^"']+)["']/g)) push(from, m[1]);
  }

  return out;
}

test('every internal /docs link the docs publish resolves', async () => {
  const links = await internalDocLinks();
  // The sidebar alone contributes 45, so a floor well above that proves both
  // sources were actually read rather than one silently yielding nothing.
  assert.ok(links.length > 60, `sanity: expected many internal links, found ${links.length}`);
  assert.ok(
    links.some((l) => l.from.includes('sidebar')),
    'the sidebar nav must be covered: it is the only surface linking every page',
  );

  const seen = new Map<string, number>();
  const dead: string[] = [];
  for (const { from, href } of links) {
    let status = seen.get(href);
    if (status === undefined) {
      status = (await handle(href)).status;
      seen.set(href, status);
    }
    // A redirect is fine: /docs itself 308s to the introduction.
    if (status >= 400) dead.push(`${from} -> ${href} (${status})`);
  }
  assert.deepEqual(dead, [], `dead internal docs links:\n  ${dead.join('\n  ')}`);
});

test('the text-only page copies are fetchable but not indexable', async () => {
  // Fetchable is the point (an agent asking for llms.txt wants the text);
  // indexable is not (it is the same content as the HTML page, on the same
  // domain, and text/plain cannot carry a canonical link).
  for (const path of ['/llms-full.txt', '/docs/routing/llms.txt']) {
    const res = await handle(path);
    assert.equal(res.status, 200, `${path} is still served`);
    assert.match(res.headers.get('x-robots-tag') || '', /noindex/, `${path} is noindex`);
  }
});

test('the site llms.txt index stays indexable', async () => {
  // It is a short link list rather than a copy of any page, and the
  // llmstxt.org convention is that it is the discoverable entry point.
  const res = await handle('/llms.txt');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-robots-tag'), null);
});
