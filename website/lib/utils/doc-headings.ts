/**
 * Heading extraction for the docs search index (app/api/search/route.ts).
 *
 * `lib/docs-llms.server.ts` renders each doc page to markdown, turning
 * <h1> through <h4> into leading-hash lines and wrapping every code sample
 * in a ``` fence. Recovering the headings is therefore a line scan, with
 * one rule that is easy to miss: a docs sample routinely opens a line with
 * `# ` (a shell comment) or `#field` (a JS private class field), and a scan
 * with no fence tracking scores those as section titles. Fifty-three of
 * them were indexed across nine pages before this existed, which is how a
 * query for `localhost` once ranked /docs/backend-only at 16.
 *
 * The fence predicate is byte-identical to the one bodyToMarkdown runs in
 * its normalisation pass (lib/docs-llms.server.ts). Two passes over the
 * same corpus that disagree about where a fence starts would drift
 * silently, so they share the rule rather than each having their own.
 */
export function extractHeadings(markdown: string): string[] {
  const headings: string[] = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.startsWith('#')) headings.push(line.replace(/^#+\s*/, '').trim());
  }
  return headings;
}
