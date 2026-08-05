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
 * links all 43, and its hrefs are single-quoted object literals rendered
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
  // The sidebar alone contributes 43, so a floor well above that proves both
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

test('every doc page on disk is reachable from the sidebar', async () => {
  // The reverse of the check above, and the direction that actually rots. The
  // sitemap and llms.txt both enumerate topics FROM DISK, and /docs is a
  // redirect rather than a listing page, so the sidebar is the only surface a
  // human can navigate from. A new page would appear in the sitemap and the
  // AI index automatically while being orphaned from every human path, with
  // every other test green.
  const layout = await readFile(resolve(DOCS_ROOT, 'layout.ts'), 'utf8');
  const linked = new Set(
    [...layout.matchAll(/href:\s*'(\/docs\/[^']+)'/g)].map((m) => m[1]),
  );

  const orphans: string[] = [];
  for (const d of await readdir(DOCS_ROOT, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.') || d.name.startsWith('_') || d.name.startsWith('[')) continue;
    const files = await readdir(resolve(DOCS_ROOT, d.name)).catch(() => [] as string[]);
    if (!files.includes('page.ts') && !files.includes('page.js')) continue;
    if (!linked.has(`/docs/${d.name}`)) orphans.push(d.name);
  }

  assert.deepEqual(
    orphans,
    [],
    `these doc pages exist but no sidebar entry links them:\n  ${orphans.join('\n  ')}`,
  );
});

test('no two doc pages declare the same metadata title', async () => {
  // Two pages sharing a title compete for the same query on the domain the
  // #1098 migration exists to consolidate authority onto, and a reader
  // arriving from search cannot tell which one answers their question. That
  // is exactly what /docs/auth and /docs/authentication did: both declared
  // 'Authentication | WebJs', both rendered <h1>Authentication</h1>, and
  // their opening paragraphs contradicted each other about whether WebJs
  // ships auth at all. The sitemap and llms.txt enumerate topics from disk,
  // so both were submitted to search engines as identically-titled entries.
  const byTitle = new Map<string, string[]>();
  const pages: string[] = [];
  const unparsed: string[] = [];

  for (const d of await readdir(DOCS_ROOT, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.') || d.name.startsWith('_') || d.name.startsWith('[')) continue;
    const dir = resolve(DOCS_ROOT, d.name);
    const files = await readdir(dir).catch(() => [] as string[]);
    const page = files.find((f) => f === 'page.ts' || f === 'page.js');
    if (!page) continue;
    pages.push(d.name);
    const src = await readFile(resolve(dir, page), 'utf8');
    // `export const metadata = { title: '...' }`, the shape every docs page uses.
    // NOT `[^}]*?`: that cannot cross a nested object, so a page growing a
    // `jsonLd` or `openGraph` before `title` would silently stop being checked.
    const m = src.match(/export\s+const\s+metadata\s*=\s*\{[\s\S]*?\btitle:\s*['"`]([^'"`]+)['"`]/);
    if (!m) { unparsed.push(d.name); continue; }
    const list = byTitle.get(m[1]) ?? [];
    list.push(d.name);
    byTitle.set(m[1], list);
  }

  // Sanity floor, matching the sibling tests in this file. Without it a parser
  // change that yields nothing makes this test pass vacuously, which is the
  // failure mode it exists to prevent.
  assert.ok(pages.length > 30, `sanity: expected many doc pages, saw ${pages.length}`);
  assert.deepEqual(unparsed, [], `these doc pages have a metadata block this test could not parse:\n  ${unparsed.join('\n  ')}`);

  const collisions = [...byTitle.entries()]
    .filter(([, dirs]) => dirs.length > 1)
    .map(([title, dirs]) => `${title} <- ${dirs.sort().join(', ')}`);

  assert.deepEqual(
    collisions,
    [],
    `these doc pages share a metadata title, so they compete for the same query:\n  ${collisions.join('\n  ')}`,
  );
});

test('a doc page h1 matches its sidebar label', async () => {
  // Only one of the pair ever disagreed with its own nav entry. Both
  // rendered <h1>Authentication</h1>. /docs/authentication was labelled
  // 'Authentication', so it agreed with itself. /docs/auth was labelled
  // 'Auth (Providers)' and rendered a heading byte-identical to its SIBLING's
  // label, so clicking one nav entry landed the reader on a heading naming
  // the other page. Both slugs are pinned rather than just /docs/auth because
  // the collision was between one page's h1 and the OTHER's label, so pinning
  // half of it would leave the other half free to drift back into it.
  //
  // Scoped to these two rather than every page, and NOT because the rest
  // diverge. Most doc entries already read the same in both places. It is
  // scoped because five of the 41 unpinned pages would fail a byte-equal
  // check: getting-started, runtime, task and editor-setup deliberately use
  // a label that differs from their heading, and conventions reads the same
  // but escapes its ampersand in the h1, so it compares unequal. All five
  // are correct as they stand, so widening this test reds on working pages.
  const layout = await readFile(resolve(DOCS_ROOT, 'layout.ts'), 'utf8');
  const labelFor = (href: string) => {
    const m = layout.match(new RegExp(`href:\\s*'${href}',\\s*label:\\s*'([^']+)'`));
    return m?.[1];
  };

  for (const slug of ['auth', 'authentication']) {
    const src = await readFile(resolve(DOCS_ROOT, slug, 'page.ts'), 'utf8').catch(
      () => readFile(resolve(DOCS_ROOT, slug, 'page.js'), 'utf8'),
    );
    const h1 = src.match(/<h1>([^<]+)<\/h1>/)?.[1];
    assert.equal(h1, labelFor(`/docs/${slug}`), `/docs/${slug}: <h1> and sidebar label must agree`);
  }
});

test('every docs sidebar label and section title is Title Case', async () => {
  // Two labels drifted to sentence case ('Build your own authentication' and
  // 'Auth providers (createAuth)') against 42 Title Case siblings, and nothing
  // caught it because casing is not a link, a title, or an order. The rule is
  // the one comparable docs sites converge on: prose takes the project's
  // convention, and a CODE IDENTIFIER is written verbatim and never recased.
  // Qwik ships both 'API Reference' and 'API reference' in one sidebar because
  // neither half was ever written down.
  //
  // This is a FLOOR, not a Title Case parser. It asserts each word STARTS with
  // a capital, so 'Build YOUR Own Authentication' passes. That is deliberate:
  // the drift it exists to catch is sentence case, and a stricter rule is one
  // people delete the first time it fires on something legitimate.

  // Words a title-case scheme leaves lowercase after the first position.
  // Generous on purpose, so this PERMITS both 'Deploying With Docker' and
  // 'Deploying with Docker'. Only 'Migrating from Next.js' exercises it today.
  // The rest are here so the first 'Deploying on Railway' does not red CI for a
  // label that was never wrong.
  const MINOR_WORDS = new Set([
    'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'if', 'in', 'into',
    'nor', 'of', 'off', 'on', 'onto', 'or', 'over', 'per', 'so', 'the', 'to',
    'up', 'via', 'vs', 'with', 'yet',
  ]);

  // Words whose casing is fixed by something other than prose, so recasing
  // them would be WRONG rather than a correction. Two kinds qualify: a code
  // token ('@webjsdev/ui', 'createAuth', 'webjs check', 'package.json') and a
  // brand that starts lowercase ('macOS', 'iOS', 'npm'). No structural rule
  // can carry this: shape detects '@webjsdev/ui' and 'createAuth', but a
  // future 'webjs check' label is two ordinary lowercase words,
  // byte-indistinguishable from the slip this test hunts. So the exemption is
  // a named list, and adding to it is the deliberate act that records "this
  // spelling is correct, not a slip". Matched against the
  // word with wrapping punctuation stripped, so it survives a rename to
  // 'Auth Providers (createAuth API)'.
  const IDENTIFIERS = new Set(['createAuth', '@webjsdev/ui']);

  const layout = await readFile(resolve(DOCS_ROOT, 'layout.ts'), 'utf8');
  // Slice to the NAV_SECTIONS literal. Outside it sit the docs-scoped metadata
  // block (its own `title:` keys) and the shell call's aria labels
  // ('Documentation', 'Documentation menu'), none of which are nav text and the
  // last of which is legitimately sentence case.
  const start = layout.indexOf('const NAV_SECTIONS');
  const end = layout.indexOf('\n];', start);
  assert.ok(start !== -1 && end > start, 'could not locate the NAV_SECTIONS literal in layout.ts');
  const nav = layout.slice(start, end);
  assert.ok(!nav.includes('generateMetadata'), 'the NAV_SECTIONS slice ran past the end of the literal');

  // `label:` is read on its own rather than anchored to a preceding `href:`.
  // The anchored form yields NOTHING for an entry written
  // `{ label: '...', href: '...' }`, so a key reorder drops that entry from
  // the check. The floor below is too coarse to catch it on its own, since it
  // only fires once four entries are missing. The href count is what makes
  // even a single dropped entry loud: every nav item has one of each.
  const labels = [...nav.matchAll(/\blabel:\s*'([^']+)'/g)].map((m) => m[1]);
  const titles = [...nav.matchAll(/\btitle:\s*'([^']+)'/g)].map((m) => m[1]);
  const hrefs = [...nav.matchAll(/\bhref:\s*'([^']+)'/g)].map((m) => m[1]);

  assert.equal(
    labels.length,
    hrefs.length,
    `parsed ${hrefs.length} hrefs but ${labels.length} labels: a nav entry is written in a shape this test cannot read, so it is silently not being checked`,
  );
  // Floors matching the sibling checks in this file, so a regex that stops
  // matching fails here instead of passing empty.
  assert.ok(labels.length > 40, `sanity: expected the full sidebar, parsed ${labels.length} labels`);
  assert.ok(titles.length > 3, `sanity: expected every section, parsed ${titles.length} titles`);

  const offenders: string[] = [];
  for (const value of [...titles, ...labels]) {
    value.split(/\s+/).forEach((token, i) => {
      // 'Runtime (Node & Bun)', 'Editor Setup (Neovim, VS Code)', 'cache()'
      const word = token.replace(/^\(+|[)(,.]+$/g, '');
      if (!/[A-Za-z]/.test(word)) return; // the bare & in 'Streaming & Suspense'
      if (IDENTIFIERS.has(word)) return;
      if (i > 0 && MINOR_WORDS.has(word.toLowerCase())) return;
      if (!/^[A-Z]/.test(word)) offenders.push(`${value}  ->  '${word}'`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    'these docs sidebar entries are not Title Case (entry -> the lowercase word):\n  ' +
      offenders.join('\n  ') +
      '\n\nThe docs sidebar is Title Case throughout, section titles included. Pick the fix that matches the word:\n' +
      '  1. ORDINARY WORD: recase it in app/docs/layout.ts. This is the fix nearly every\n' +
      '     hit wants, and it is what the last two drifts needed.\n' +
      '  2. A WORD WHOSE CASING IS NOT PROSE: add it to IDENTIFIERS at the top of\n' +
      '     this test, spelled EXACTLY as this message printed it above. Wrapping\n' +
      "     brackets and trailing punctuation are stripped before the lookup, so a\n" +
      "     'cache()' in a label is listed as 'cache'. Two kinds belong there: a code\n" +
      "     token (a package like '@webjsdev/ui', an export like 'createAuth', a\n" +
      "     command like 'webjs check', a filename like 'package.json') and a brand\n" +
      "     that starts lowercase ('macOS', 'iOS', 'npm'). For both, recasing would\n" +
      "     MISSPELL the word, so the label is right and this test is what needs\n" +
      '     updating. Add each word of a multi-word command separately.\n' +
      "  3. LOWERCASE-IN-TITLE WORD this list does not know yet ('amid', 'until'): add it\n" +
      '     to MINOR_WORDS instead.',
  );
});

test('the llms.txt index follows the sidebar order', async () => {
  // The order used to be a hand-copied list that had already drifted from the
  // sidebar, so the AI-facing index put Runtime and Security in an
  // alphabetical tail instead of their sections. It is derived now; this
  // asserts the derivation, so a parser change that silently yields nothing
  // (which would degrade to pure alphabetical) fails here.
  const body = await (await handle('/llms.txt')).text();
  const listed = [...body.matchAll(/\/docs\/([^/]+)\/llms\.txt/g)].map((m) => m[1]);

  const layout = await readFile(resolve(DOCS_ROOT, 'layout.ts'), 'utf8');
  const nav = [...layout.matchAll(/href:\s*'\/docs\/([^']+)'/g)].map((m) => m[1]);

  assert.ok(nav.length > 40, `sanity: expected the full sidebar, found ${nav.length}`);
  // Every listed topic that HAS a sidebar entry must appear in sidebar order.
  const inNavOrder = listed.filter((slug) => nav.includes(slug));
  assert.deepEqual(inNavOrder, nav.filter((slug) => listed.includes(slug)));
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
