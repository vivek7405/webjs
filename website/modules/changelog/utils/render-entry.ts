/**
 * Markdown body renderer for changelog entries.
 *
 * Pure function. Browser-safe (no node:fs). Tighter typography than
 * the blog post renderer because changelog cards stack multiple
 * entries per page (smaller text, less margin). Sibling
 * `modules/blog/utils/render-post.ts` is the long-form version.
 */

function inline(s: string): string {
  let out = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) =>
    `<a href="${u}" class="text-accent no-underline hover:underline" rel="noopener noreferrer">${t}</a>`);
  out = out.replace(/`([^`]+)`/g, '<code class="font-mono text-[12.5px] bg-fg/8 text-fg px-1 py-0.5 rounded">$1</code>');
  // **bold** non-greedy single-line: must allow asterisks inside the
  // span so titles like "**data-webjs-prop-* side-channel**" still
  // parse. The previous [^*]+ rejected the embedded asterisk and
  // silently left the literal ** in the rendered output.
  out = out.replace(/\*\*([^\n]+?)\*\*/g, '<strong class="font-semibold text-fg">$1</strong>');
  // _italic_ and *italic* (the backfill generator does not emit these,
  // but hand-curated entries can; the previous renderer left the
  // underscores in the rendered HTML).
  out = out.replace(/(^|[^\w])_([^_\s][^_]*[^_\s]|[^_\s])_(?=$|[^\w])/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^*\w])\*([^*\s][^*]*[^*\s]|[^*\s])\*(?=$|[^*\w])/g, '$1<em>$2</em>');
  return out;
}

/** One paragraph of an entry's body, as its soft-wrapped source lines. */
type Para = string[];

/** Render the body of one changelog entry: h1 / h2 / bulleted lists / paragraphs. */
export function renderEntryBody(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  // An entry item is a sequence of PARAGRAPHS, not a flat run of lines. A
  // blank line inside an item is a paragraph BREAK within it (CommonMark
  // reads a 2-space-indented paragraph after a blank as list-item
  // continuation), so it closes the open paragraph rather than the item.
  // Closing the item there is what used to turn one multi-paragraph entry
  // into a stack of sibling bullets: 3 entries rendered as 23 peer items.
  //
  // An indented BULLET is a paragraph too, with its marker dropped. The
  // changelog is one bullet per released change, and a second level of
  // glyphs under half of them is noise: the generator writes each squashed
  // commit subject as its own `*` line, which restated the entry title above
  // it in 119 of the corpus's 378 indented bullets. So indentation controls
  // grouping here, never bullet depth, and no entry body renders a list.
  let itemOpen = false;
  let paras: Para[] = [];
  let open: Para | null = null;

  function startPara(text: string) { open = [text]; paras.push(open); }

  function renderParas(ps: Para[]): string {
    // The overwhelmingly common entry is a single line with no body. Emit it
    // bare so its markup is unchanged by the multi-paragraph support.
    if (ps.length === 1) return inline(ps[0].join(' '));
    return ps.map((lines) =>
      `<p class="my-2 first:mt-0 last:mb-0">${inline(lines.join(' '))}</p>`).join('');
  }

  function flushItem() {
    if (itemOpen) {
      out.push(`<li class="text-fg-muted text-[14px] leading-relaxed">${renderParas(paras)}</li>`);
      itemOpen = false;
      paras = [];
      open = null;
    }
  }
  function endList() {
    flushItem();
    if (inList) { out.push('</ul>'); inList = false; }
  }
  function startList() {
    if (!inList) { out.push('<ul class="list-disc pl-5 space-y-2 my-3">'); inList = true; }
  }

  for (const raw of lines) {
    const line = raw;
    if (/^# /.test(line)) {
      endList();
      out.push(`<h3 class="font-mono text-[16px] font-semibold tracking-tight text-fg mt-0 mb-3">${inline(line.slice(2).trim())}</h3>`);
    } else if (/^## /.test(line)) {
      endList();
      out.push(`<h4 class="font-mono text-[11px] uppercase tracking-[0.15em] font-semibold text-fg-subtle mt-4 mb-1.5">${inline(line.slice(3).trim())}</h4>`);
    } else if (/^- /.test(line)) {
      // A top-level entry, recognised by its column-0 marker. Checking this
      // BEFORE the indented branches is what stops an open item swallowing
      // the entry that follows it.
      flushItem();
      startList();
      itemOpen = true;
      paras = [];
      open = null;
      startPara(line.slice(2).trim());
    } else if (itemOpen && /^ {2,}[-*] /.test(line)) {
      // Its own paragraph, marker dropped. Depth is not read, so a deeper
      // run groups exactly like a 2-space one instead of nesting.
      startPara(line.trim().slice(2).trim());
    } else if (itemOpen && /^ {2,}\S/.test(line)) {
      const text = line.trim();
      // Soft-wrapped continuation of the open paragraph, or the start of a
      // fresh one when a blank line closed the last.
      if (open) open.push(text);
      else startPara(text);
    } else if (line.trim() === '') {
      if (itemOpen) open = null;
      else flushItem();
    } else {
      endList();
      out.push(`<p class="text-fg-muted text-[14px] leading-relaxed my-3">${inline(line.trim())}</p>`);
    }
  }
  endList();
  return out.join('\n');
}
