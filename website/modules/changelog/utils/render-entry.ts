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

/** Render the body of one changelog entry: h1 / h2 / bulleted lists / paragraphs. */
export function renderEntryBody(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let curItem: string[] = [];

  function flushItem() {
    if (curItem.length) {
      out.push(`<li class="text-fg-muted text-[14px] leading-relaxed">${inline(curItem.join(' '))}</li>`);
      curItem = [];
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
      flushItem();
      startList();
      curItem.push(line.slice(2).trim());
    } else if (inList && /^ {2,}\S/.test(line)) {
      curItem.push(line.trim());
    } else if (line.trim() === '') {
      flushItem();
    } else {
      endList();
      out.push(`<p class="text-fg-muted text-[14px] leading-relaxed my-3">${inline(line.trim())}</p>`);
    }
  }
  endList();
  return out.join('\n');
}
