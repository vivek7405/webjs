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

/** Every `/docs/...` href written in a doc page, with the page it came from. */
async function internalDocLinks(): Promise<{ from: string; href: string }[]> {
  const out: { from: string; href: string }[] = [];
  for (const d of await readdir(DOCS_ROOT, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('[')) continue;
    for (const ext of ['ts', 'js']) {
      const file = resolve(DOCS_ROOT, d.name, `page.${ext}`);
      const src = await readFile(file, 'utf8').catch(() => null);
      if (src == null) continue;
      for (const m of src.matchAll(/href="(\/docs\/[^"#?]*)"/g)) {
        out.push({ from: d.name, href: m[1] });
      }
      break;
    }
  }
  return out;
}

test('every internal /docs link in a doc page resolves', async () => {
  const links = await internalDocLinks();
  assert.ok(links.length > 20, `sanity: expected many internal links, found ${links.length}`);

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
