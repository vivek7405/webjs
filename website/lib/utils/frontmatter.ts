/**
 * Frontmatter parser shared by /blog and /changelog.
 *
 * Plain string-manipulation, no dependencies. Pulls the `---`-delimited
 * YAML-like block at the top of a markdown file, splits on `:`, and
 * returns a `{ fm, body }` pair. Quoted string values have their quotes
 * stripped; everything else is kept as-is.
 *
 * Browser-safe (no node:fs); the queries that READ the files are
 * .server.ts and import this helper.
 */
export function parseFrontmatter(raw: string): { fm: Record<string, string>; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw };
  const fm: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    fm[k] = v;
  }
  return { fm, body: m[2] };
}
