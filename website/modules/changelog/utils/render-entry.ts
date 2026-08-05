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

/**
 * One block of an entry's body: a paragraph of soft-wrapped lines, or a
 * nested bullet list whose items are themselves soft-wrapped lines.
 */
type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul'; marker: string; items: string[][] };

/** Render the body of one changelog entry: h1 / h2 / bulleted lists / paragraphs. */
export function renderEntryBody(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  // An entry item is a sequence of blocks, not a flat run of lines. A blank
  // line inside an item is a paragraph BREAK within it (CommonMark reads a
  // 2-space-indented paragraph after a blank as list-item continuation), so
  // it closes the open block rather than the item. Closing the item there is
  // what used to turn one multi-paragraph entry into a stack of sibling
  // bullets: 3 entries rendered as 23 peer list items.
  let itemOpen = false;
  let blocks: Block[] = [];
  let openBlock: Block | null = null;

  function pushBlock(b: Block) { blocks.push(b); openBlock = b; }

  function renderBlocks(bs: Block[]): string {
    // The overwhelmingly common entry is a single line with no body. Emit it
    // bare so its markup is unchanged by the multi-paragraph support.
    if (bs.length === 1 && bs[0].kind === 'p') return inline(bs[0].lines.join(' '));
    return bs.map((b) => b.kind === 'p'
      ? `<p class="my-2 first:mt-0 last:mb-0">${inline(b.lines.join(' '))}</p>`
      : `<ul class="list-disc pl-5 space-y-1 my-2 last:mb-0">${b.items.map((it) => `<li>${inline(it.join(' '))}</li>`).join('')}</ul>`
    ).join('');
  }

  function flushItem() {
    if (itemOpen) {
      out.push(`<li class="text-fg-muted text-[14px] leading-relaxed">${renderBlocks(blocks)}</li>`);
      itemOpen = false;
      blocks = [];
      openBlock = null;
    }
  }
  function endList() {
    flushItem();
    if (inList) { out.push('</ul>'); inList = false; }
  }
  function startList() {
    if (!inList) { out.push('<ul class="list-disc pl-5 space-y-2 my-3">'); inList = true; }
  }
  function openItem(first: string) {
    itemOpen = true;
    blocks = [];
    openBlock = null;
    pushBlock({ kind: 'p', lines: [first] });
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
      // BEFORE the indented-continuation branch is what stops an open item
      // swallowing the entry that follows it.
      flushItem();
      startList();
      openItem(line.slice(2).trim());
    } else if (itemOpen && /^ {2,}[-*] /.test(line)) {
      const marker = line.trim()[0];
      const text = line.trim().slice(2).trim();
      // Resume the TRAILING nested list rather than the open one. A blank
      // line between indented bullets is a LOOSE list in CommonMark, still
      // one list, and the generator writes exactly that shape (one `*`
      // commit subject per blank-separated line). Keying off the open block
      // would emit a separate single-item list per bullet, each with its own
      // margin, splitting one list into several. A paragraph in between is a
      // different matter, and genuinely does start a new list.
      //
      // The marker has to match to resume, because CommonMark starts a NEW
      // list when the bullet character changes. Merging across that would
      // join two lists the markdown deliberately separated.
      const last = blocks[blocks.length - 1];
      if (last && last.kind === 'ul' && last.marker === marker) { last.items.push([text]); openBlock = last; }
      else pushBlock({ kind: 'ul', marker, items: [[text]] });
    } else if (itemOpen && /^ {2,}\S/.test(line)) {
      const text = line.trim();
      // A lazy continuation of the sub-item when a nested list is open, a
      // soft-wrapped line when a paragraph is, and a fresh paragraph when a
      // blank line closed whatever came before.
      //
      // Indentation DEPTH is deliberately not read here, or in the nested
      // bullet branch above. Every indented bullet in the corpus sits at two
      // spaces, so a deeper run has no instance to render, and honouring
      // depth for real means recursive sub-lists. Reading it in one branch
      // and not the other is worse than ignoring it in both, since a 4-space
      // paragraph would then stay in its bullet while a 4-space bullet is
      // still hoisted to a sibling.
      if (openBlock && openBlock.kind === 'ul') openBlock.items[openBlock.items.length - 1].push(text);
      else if (openBlock && openBlock.kind === 'p') openBlock.lines.push(text);
      else pushBlock({ kind: 'p', lines: [text] });
    } else if (line.trim() === '') {
      if (itemOpen) openBlock = null;
      else flushItem();
    } else {
      endList();
      out.push(`<p class="text-fg-muted text-[14px] leading-relaxed my-3">${inline(line.trim())}</p>`);
    }
  }
  endList();
  return out.join('\n');
}
