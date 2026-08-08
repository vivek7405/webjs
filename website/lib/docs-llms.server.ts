/**
 * llms.txt corpus builder (server-only).
 *
 * Generates the machine-readable agent entrypoints for the documentation,
 * following the open llms.txt standard (llmstxt.org):
 *   /llms.txt        the site index, which links into the docs (app/llms.txt)
 *   /llms-full.txt   the concatenated full prose corpus of every doc page
 *   per-page markdown (one page rendered to markdown)
 *
 * Everything is derived AT REQUEST TIME from the live doc pages under
 * `app/docs/<topic>/page.ts`, reusing the exact extraction approach the
 * search route (`app/api/search/route.ts`) already uses (title regex,
 * heading regex, html-template + tag stripping). No build step, no
 * generator framework, so the output never drifts from the docs.
 *
 * This file has the `.server.ts` infix so its node:fs reads never reach
 * the browser. It is imported only by `route.ts` handlers, which are
 * server-only by construction.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteUrl } from '#lib/env.ts';

// Resolve the app root from THIS module's location, not process.cwd().
// This module lives at `website/lib/docs-llms.server.ts`, so the app root
// is one level up. Anchoring to import.meta.url keeps the file reads
// correct under `webjs start` (cwd = website), inside the
// createRequestHandler test harness (cwd = repo root), and in a
// standalone deploy, all without depending on the working directory.
const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_PAGES_ROOT = join(APP_ROOT, 'app', 'docs');

/** One doc topic, extracted from its page module. */
export type DocPage = {
  /** URL slug under /docs, e.g. "getting-started". */
  slug: string;
  /** Site path, e.g. "/docs/getting-started". */
  path: string;
  /** Clean title with the " | webjs" suffix stripped. */
  title: string;
  /** One-line description (metadata.description, else first <p>). */
  description: string;
  /** Lightweight markdown rendering of the page body. */
  markdown: string;
};

/**
 * The topic order, read from the sidebar so the two cannot disagree.
 *
 * This used to be a hand-copied list, and it had already drifted: it carried
 * a slug that no longer exists and was missing six real pages, so /llms.txt
 * listed Runtime and Security in an alphabetical tail instead of under
 * Getting Started and Infrastructure. Deriving it removes the failure mode
 * rather than correcting one instance of it.
 *
 * Parsed from the layout's SOURCE rather than imported: the layout imports
 * browser components, and this is a server-only module that should stay
 * import-light. The order is the order the hrefs appear, which is the order
 * a reader sees them. A topic with no sidebar entry falls to the end
 * alphabetically (and is separately a test failure, since an unlinked page is
 * unreachable by a human).
 */
const DOCS_LAYOUT = join(DOCS_PAGES_ROOT, 'layout.ts');

/** @type {string[] | null} */
let curatedOrderCache: string[] | null = null;

async function curatedOrder(): Promise<string[]> {
  if (curatedOrderCache) return curatedOrderCache;
  const src = await readFile(DOCS_LAYOUT, 'utf8').catch(() => '');
  const slugs: string[] = [];
  for (const m of src.matchAll(/href:\s*'\/docs\/([^']+)'/g)) {
    if (!slugs.includes(m[1])) slugs.push(m[1]);
  }
  curatedOrderCache = slugs;
  return slugs;
}

/** Lazily built page list, cached in memory (mirrors the search index). */
let pagesCache: DocPage[] | null = null;

/**
 * Resolve the canonical origin for absolute links. Prefer the request
 * origin (correct in dev AND prod, and behind any proxy host), falling
 * back to the production site origin when no request is supplied. The
 * fallback mirrors app/sitemap.ts and app/robots.ts so all three agree.
 */
export function originFor(req?: Request): string {
  if (req) {
    try {
      return new URL(req.url).origin;
    } catch {
      /* fall through */
    }
  }
  return siteUrl();
}

/**
 * Extract the first `export const metadata = { ... }` object literal
 * source (the block BEFORE `export default`), so a `description:` inside
 * an example code block in the page body is never mistaken for the page
 * description.
 */
function metadataBlock(raw: string): string {
  const startIdx = raw.indexOf('export const metadata');
  if (startIdx < 0) return '';
  const braceIdx = raw.indexOf('{', startIdx);
  const defaultIdx = raw.indexOf('export default');
  if (braceIdx < 0) {
    // Single-line `export const metadata = { title: '...' };`
    const lineEnd = raw.indexOf('\n', startIdx);
    return raw.slice(startIdx, lineEnd < 0 ? undefined : lineEnd);
  }
  const end = defaultIdx > braceIdx ? defaultIdx : raw.length;
  return raw.slice(startIdx, end);
}

/**
 * Collapse a fragment to a single trimmed line of plain text.
 *
 * Deliberately does NOT decode entities. Entities are decoded exactly once,
 * at the END of the pipeline (`decodeEntities(body)`), because a decoded `<`
 * re-entering a later tag strip matches from there to the next `>` anywhere
 * in the document and deletes everything between the two. That is what cost
 * /docs/metadata-routes 5 of its 9 samples: one 935-character match that ran
 * from a decoded `&lt;` in one paragraph to a decoded `&lt;title&gt;` sixty
 * lines further down. Decoding belongs after every strip, never before one.
 */
function oneLine(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `oneLine` plus the decode, in the one order that is safe: strip, THEN
 * decode. Exported for the same reason `bodyToMarkdown` is, so a unit test
 * can drive it on a fixture instead of planting scaffolding in a real docs
 * page. The whitespace collapse is re-run after decoding because `&nbsp;`
 * decodes to a literal space, so a run of them is only collapsible once the
 * decode has happened.
 */
export function plainText(s: string): string {
  return decodeEntities(oneLine(s)).replace(/\s+/g, ' ').trim();
}

/** Truncate at a word boundary, appending an ellipsis when cut. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd() + '...';
}

/**
 * Exported for its own unit test. It is a pure string-to-string function, and
 * exporting it is what lets a test drive the extractor on a fixture instead of
 * planting scaffolding in a real docs page that readers would see.
 *
 * Convert a doc page's `html\`...\`` body to lightweight, readable
 * markdown. Reuses the search route's stripping approach but preserves
 * structure: headings become `##`/`###`, list items become `-`, and
 * `<code-block>` samples are fenced, rather than collapsing everything to
 * one blob. Perfection is not required; a clean-ish rendering is.
 */
export function bodyToMarkdown(raw: string): string {
  // Isolate the html template body (between the first `html\`` and its
  // matching closing backtick). Doc pages are a single top-level
  // template, so a simple slice from the first `html\`` to the final
  // backtick is sufficient and conservative.
  let body = raw;
  const tplStart = raw.indexOf('html`');
  if (tplStart >= 0) {
    const lastTick = raw.lastIndexOf('`');
    if (lastTick > tplStart) body = raw.slice(tplStart + 'html`'.length, lastTick);
  }

  // Pull the code samples out first, replacing them with placeholders so
  // their inner whitespace + angle brackets survive the tag stripping.
  // The sentinel is U+E000 (private use), written as an escape rather
  // than a literal: it cannot occur in doc prose, and unlike the raw NUL
  // this used to use it keeps the file TEXT, so git can diff it.
  //
  // A docs page writes <code-block> (components/code-block.ts renders the
  // <pre>), so that is what this reads. <pre> stays matched because this
  // parses SOURCE rather than rendered HTML, and losing a sample here is
  // silent: it does not vanish, it falls through to the prose pipeline,
  // which strips the fence, eats every ${...} hole in the code, and
  // collapses the indentation, leaving output that still reads like prose
  // and teaches code nobody can run. `(?=[\s>])` keeps <pre from matching
  // <preview-tabs.
  //
  // The fencing done here is what the docs search index depends on to tell
  // a sample apart from prose. It recovers its headings from this markdown
  // through lib/utils/doc-headings.ts, which tracks fences with the SAME
  // predicate the whitespace normalisation below uses, so a line-leading
  // "# " shell comment inside a sample is not scored as a heading. That
  // helper keeps its own copy of the predicate (it is import-free and this
  // module is server-only), and two passes over this output that disagreed
  // about where a fence starts would drift silently, so
  // test/lib/doc-headings.test.ts pins the two copies equal.
  //
  // Nothing strips a <code> wrapper out of the captured text any more. That
  // strip existed for the `<pre><code>` shape docs pages used to author, and
  // <code-block> supplies the wrapper itself, so it matched nothing. What it
  // still did was run AFTER decodeEntities, so a sample TEACHING `&lt;code&gt;`
  // had the decoded tags deleted out of it, silently, in the one pipeline
  // whose silent losses this function exists to avoid.
  //
  // The pipeline invariant, and the reason the stages are ordered this way:
  // tags are stripped at EVERY stage, entities are decoded exactly ONCE, at
  // the end. A captured sample decodes on its own path below; prose decodes
  // at `decodeEntities(body)` after the generic strip. Decoding earlier puts
  // a bare `<` in front of a strip that then eats to the next `>`.
  const codeBlocks: string[] = [];
  body = body.replace(/<(?:pre|code-block)(?=[\s>])[^>]*>([\s\S]*?)<\/(?:pre|code-block)>/g, (_m, code) => {
    codeBlocks.push(decodeEntities(String(code)).replace(/\n+$/, ''));
    return `\uE000CODE${codeBlocks.length - 1}\uE000`;
  });

  // Prose template holes that survive rather than being dropped, parked
  // behind a sentinel while the dynamic-hole strip runs. Same U+E001
  // escape-not-literal rule as the code-block sentinel above, so the
  // file stays diffable text.
  const heldHoles: string[] = [];
  const keepHole = (text: string) => `\uE001HOLE${heldHoles.push(text) - 1}\uE001`;

  body = body
    // Headings -> markdown
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/g, (_m, t) => `\n# ${oneLine(t)}\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/g, (_m, t) => `\n## ${oneLine(t)}\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/g, (_m, t) => `\n### ${oneLine(t)}\n`)
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/g, (_m, t) => `\n#### ${oneLine(t)}\n`)
    // List items -> "- "
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/g, (_m, t) => `- ${oneLine(t)}\n`)
    // Paragraphs / blockquotes -> blank-line-separated lines
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/g, (_m, t) => `\n${oneLine(t)}\n`)
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/g, (_m, t) => `\n> ${oneLine(t)}\n`)
    // Drop ul/ol wrappers (items already became "- ")
    .replace(/<\/?(ul|ol)[^>]*>/g, '\n')
    // Strip every remaining tag
    .replace(/<[^>]+>/g, ' ')
    // Template holes in prose. Three shapes, and only one is dynamic:
    //
    //   \${x}      an ESCAPED hole. The `\$` means the page is not
    //              interpolating at all, so the reader sees the literal text
    //              `${x}`. Keep it, minus the escape.
    //   ${"lit"}   a hole whose value is a string literal, so the reader sees
    //              that literal. Keep the literal.
    //   ${x}       a real hole. What it renders is known only at render time,
    //              so there is nothing to put in the corpus. Drop it.
    //
    // All three used to be dropped alike, which deleted the binding out of
    // every sentence teaching `<form action=${action}>` and stranded the
    // escape backslash. On main that damage was hidden, because the runaway
    // strip had already eaten those fragments whole; restoring them exposed
    // 12 corpus lines reading `<form action=\>`, in the one surface whose
    // reader is an LLM and about the exact shape invariant 12 governs.
    //
    // The kept text is parked behind a sentinel so the dynamic-hole strip
    // below cannot eat what these two just preserved, and it is restored
    // before `decodeEntities` so entities inside it decode like any prose.
    .replace(/\\\$\{((?:[^{}]|\{[^}]*\})*)\}/g, (_m, inner) => keepHole('${' + unescapeJs(inner) + '}'))
    .replace(/\$\{"((?:[^"\\]|\\.)*)"\}/g, (_m, lit) => keepHole(unescapeJs(lit)))
    // Brace-aware: `[^}]*` would stop at the FIRST `}`, leaving `"}` debris
    // behind a nested hole.
    .replace(/\$\{(?:[^{}]|\{[^}]*\})*\}/g, '');

  // Restore kept holes. A kept hole can itself contain a parked sentinel (an
  // escaped hole nested inside a string-literal one), so this repeats until
  // none is left. Replacing once emitted the inner sentinel verbatim, which
  // would ship a private-use codepoint in a text/plain response and into the
  // search index. Bounded: a hole can only contain sentinels parked before
  // it, so each pass resolves at least one.
  for (let pass = 0; pass <= heldHoles.length && /\uE001HOLE\d+\uE001/.test(body); pass++) {
    body = body.replace(/\uE001HOLE(\d+)\uE001/g, (_m, i) => heldHoles[Number(i)]);
  }

  body = decodeEntities(body);

  // Restore fenced code blocks.
  body = body.replace(/\uE000CODE(\d+)\uE000/g, (_m, i) => {
    return `\n\`\`\`\n${codeBlocks[Number(i)]}\n\`\`\`\n`;
  });

  // Normalise whitespace OUTSIDE fenced code blocks: collapse runs of
  // spaces and cap blank lines at one. Lines inside a ``` fence are left
  // verbatim so code indentation survives.
  let inFence = false;
  return body
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('```')) {
        inFence = !inFence;
        return line;
      }
      return inFence ? line : line.replace(/[ \t]+/g, ' ').trimEnd();
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Fold JS string escapes out of a source-extracted literal (\' -> ', etc.). */
function unescapeJs(s: string): string {
  return s.replace(/\\(.)/g, '$1');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#123;/g, '{')
    .replace(/&#125;/g, '}')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&hellip;/g, '...')
    .replace(/&mdash;/g, '--')
    .replace(/&nbsp;/g, ' ');
}

/** Read one page module and extract its DocPage shape. */
async function extractPage(file: string): Promise<DocPage> {
  const raw = await readFile(file, 'utf8');
  const slug = basename(dirname(file));

  const meta = metadataBlock(raw);
  // Both extractors must cross an ESCAPED quote rather than stop at it: a
  // description like 'SSR\'d to real HTML...' otherwise truncates at the
  // backslash, and that garbage fragment ships verbatim in /llms.txt and the
  // search index. `(?:\\.|[^'\\])*` consumes any escaped character as a
  // unit; unescapeJs() then folds the backslashes back out of the capture.
  const titleMatch = meta.match(/title:\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`)/);
  const rawTitle = unescapeJs(titleMatch?.[1] ?? titleMatch?.[2] ?? titleMatch?.[3] ?? '') || slug;
  const title = rawTitle.replace(/\s*\|\s*webjs\s*$/i, '').trim();

  // Description: prefer metadata.description, else the first <p> text.
  let description = '';
  const descMatch = meta.match(/description:\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`)/);
  if (descMatch) {
    description = plainText(unescapeJs(descMatch[1] ?? descMatch[2] ?? descMatch[3] ?? ''));
  }
  if (!description) {
    const pMatch = raw.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (pMatch) description = plainText(pMatch[1]);
  }
  description = truncate(description, 200);

  // The body's leading `<h1>` repeats the page title. Drop it so a
  // consumer sees the title once (callers print `# <title>` + a Source
  // line ahead of the body).
  let markdown = bodyToMarkdown(raw);
  markdown = markdown.replace(/^#\s+.+\n+/, '');

  return {
    slug,
    path: '/docs/' + slug,
    title,
    description,
    markdown,
  };
}

/**
 * Walk `app/docs/<topic>/page.ts`, build the ordered DocPage list, and
 * cache it in memory. Only the direct children of `app/docs` are topics
 * (each topic is one folder); the layout.ts at that level is skipped.
 */
export async function getDocPages(): Promise<DocPage[]> {
  if (pagesCache) return pagesCache;

  const dirents = await readdir(DOCS_PAGES_ROOT, { withFileTypes: true });
  const pages: DocPage[] = [];

  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    if (d.name.startsWith('.') || d.name.startsWith('_')) continue;
    for (const ext of ['ts', 'js']) {
      const file = join(DOCS_PAGES_ROOT, d.name, 'page.' + ext);
      try {
        pages.push(await extractPage(file));
        break;
      } catch {
        /* no page.<ext> in this folder, try next ext */
      }
    }
  }

  const order = await curatedOrder();
  const rank = (slug: string) => {
    const i = order.indexOf(slug);
    return i < 0 ? order.length : i;
  };
  pages.sort((a, b) => {
    const ra = rank(a.slug);
    const rb = rank(b.slug);
    if (ra !== rb) return ra - rb;
    return a.slug.localeCompare(b.slug); // uncurated tail: alphabetical
  });

  pagesCache = pages;
  return pages;
}

/** Look up a single page by slug (for the per-page markdown route). */
export async function getDocPage(slug: string): Promise<DocPage | null> {
  const pages = await getDocPages();
  return pages.find((p) => p.slug === slug) ?? null;
}

const SITE_BLURB =
  'AI-first, web-components-first, no-build full-stack framework with a NextJs-like API and Lit-inspired web components, built on web standards.';

/**
 * Render the doc-page bullet list that the site-wide /llms.txt embeds as
 * its `## Documentation` section.
 *
 * There is deliberately ONE llms.txt for the site (app/llms.txt/route.ts).
 * Before the docs moved onto this origin there were two, one per host, and
 * an agent reading webjs.dev/llms.txt got a link to the docs rather than the
 * docs themselves. So the docs enumerate INTO the site index here instead of
 * publishing a competing index of their own.
 *
 * Each entry links the page's raw-markdown variant, since a model asking for
 * llms.txt wants text it can read, not HTML it has to strip.
 */
export async function renderDocsIndexSection(origin: string): Promise<string[]> {
  const pages = await getDocPages();
  return pages.map((p) => {
    const desc = p.description ? ': ' + p.description : '';
    return `- [${p.title}](${origin}${p.path}/llms.txt)${desc}`;
  });
}

/**
 * Render /llms-full.txt: the FULL prose corpus. For each page emit a
 * `# <Title>` heading, its absolute URL, then the page's markdown body.
 *
 * DEPLOYMENT-SAFE SOURCING: the corpus is built from the
 * pages under `app/docs/**`, which always ship with the deployed app. We OPTIONALLY fold in the repo-root WebJs skill at
 * `.agents/skills/webjs/` (SKILL.md + references/) as extra enrichment,
 * but ONLY via a try/catch read that no-ops when the directory is absent
 * (a standalone deploy may not carry the monorepo root). The docs pages
 * always lead; the skill is a bonus that never breaks the deployed app.
 */
export async function renderLlmsFull(req?: Request): Promise<string> {
  const origin = originFor(req);
  const pages = await getDocPages();

  const out: string[] = [];
  out.push('# WebJs documentation (full corpus)');
  out.push('');
  out.push('> ' + SITE_BLURB);
  out.push('');
  out.push(
    'Generated live from the WebJs docs pages, following the llms.txt standard ' +
      '(llmstxt.org). Every documentation page in full, concatenated.'
  );
  out.push('');
  out.push('---');
  out.push('');

  for (const p of pages) {
    out.push(`# ${p.title}`);
    out.push('');
    out.push(`Source: ${origin}${p.path}`);
    out.push('');
    out.push(p.markdown);
    out.push('');
    out.push('---');
    out.push('');
  }

  // Optional enrichment from the monorepo WebJs skill. Wrapped so a
  // standalone deployed docs app (no repo root) simply skips it.
  try {
    const skillRoot = join(APP_ROOT, '..', '.agents', 'skills', 'webjs');
    const refsDir = join(skillRoot, 'references');
    const files = (await readdir(refsDir)).filter((f) => f.endsWith('.md')).sort();
    if (files.length) {
      out.push('# Agent skill (supplementary, monorepo only)');
      out.push('');
      const skillMd = await readFile(join(skillRoot, 'SKILL.md'), 'utf8').catch(() => '');
      if (skillMd) {
        out.push('## .agents/skills/webjs/SKILL.md');
        out.push('');
        out.push(skillMd.trim());
        out.push('');
        out.push('---');
        out.push('');
      }
      for (const f of files) {
        const md = await readFile(join(refsDir, f), 'utf8');
        out.push(`## references/${f}`);
        out.push('');
        out.push(md.trim());
        out.push('');
        out.push('---');
        out.push('');
      }
    }
  } catch {
    /* skill absent in a standalone deploy: docs pages stand alone */
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Render one page's raw markdown (the per-page variant). */
export async function renderPageMarkdown(slug: string, req?: Request): Promise<string | null> {
  const origin = originFor(req);
  const page = await getDocPage(slug);
  if (!page) return null;
  return [`# ${page.title}`, '', `Source: ${origin}${page.path}`, '', page.markdown, ''].join('\n');
}

const TEXT_HEADERS = {
  'content-type': 'text/plain; charset=utf-8',
  // Public, cacheable: the corpus is identical for everyone and changes
  // only when a doc page changes.
  'cache-control': 'public, max-age=300',
  // Keep these out of the search index while leaving them fetchable.
  //
  // Every one of them is the full text of a page that also exists as HTML, so
  // indexing both puts 45 near-duplicates of the docs on the same domain the
  // whole migration exists to consolidate. text/plain cannot carry a
  // `<link rel="canonical">`, so a header is the only way to say it. Agents
  // fetching an llms.txt URL are unaffected: this asks search engines not to
  // list it, not crawlers not to read it.
  //
  // The site index at /llms.txt is deliberately NOT covered (it builds its own
  // response): it is a short link list, not a copy of any page, and the
  // llmstxt.org convention is that it is the discoverable entry point.
  'x-robots-tag': 'noindex',
};

/** Wrap a string body in a text/plain Response. */
export function textResponse(body: string, status = 200): Response {
  // A not-found is NOT cacheable on these terms. The 200 corpus is identical
  // for everyone and changes only when a doc page changes, but a 404 body
  // echoes back the topic that was asked for, and holding one in a shared
  // cache for five minutes means a topic that appears seconds later keeps
  // answering 404 to everyone behind that cache.
  const headers = status === 200
    ? TEXT_HEADERS
    : { ...TEXT_HEADERS, 'cache-control': 'no-store' };
  return new Response(body, { status, headers });
}
